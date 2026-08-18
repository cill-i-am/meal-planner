import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Exit, Layer, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { Miniflare } from "miniflare";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { makeCloudflareImportBatchQueue } from "../../infrastructure/import-batch-queue.js";
import {
  ImportBatchDeliveryAttempt,
  ImportBatchId,
  ImportBatchItemId,
  ImportBatchQueueMessage,
} from "./import-batch.contracts.js";
import { ImportBatchRoutes } from "./import-batch.routes.js";
import {
  ImportBatchService,
  makeImportBatchService,
} from "./import-batch.service.js";
import { makeImportIntentApplication } from "./import-intent.js";
import { DeadLetterReplayClaimId } from "./import-operations.js";
import { makeD1ImportQueueAcceptance } from "./import-queue-acceptance.d1.js";
import type { ImportSystemAuthorizerShape } from "./import-system.auth.js";
import { ImportSystemAuthorizer } from "./import-system.auth.js";
import { ImportTimestamp, SourceCanonicalId } from "./import.contracts.js";
import { invalidSource, workflowStartUnavailable } from "./import.errors.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import {
  makeTestSystemAuthorizer,
  TestImportPrincipal,
  TestImportTrace,
} from "./import.test-fixtures.js";
import type { ImportWorkflowReconcilerShape } from "./import.workflow.js";
import type { CanonicalSourceIdentityResolverShape } from "./source-identity.js";
import { ValidatedVideoUrl } from "./source-identity.js";

const apiToken = "durable-queue-test-token";
const primaryQueueName = "durable-import-batches";
const deadLetterQueueName = "durable-import-batches-dlq";
const timestampText = "2026-08-15T10:00:00.000Z";
const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(timestampText);
const decodeBatchId = Schema.decodeUnknownSync(ImportBatchId);
const decodeItemId = Schema.decodeUnknownSync(ImportBatchItemId);
const decodeDeliveryAttempt = Schema.decodeUnknownSync(
  ImportBatchDeliveryAttempt
);
const decodeCanonicalId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodeVideoUrl = Schema.decodeUnknownSync(ValidatedVideoUrl);
const decodeQueueMessage = Schema.decodeUnknownSync(ImportBatchQueueMessage);
const decodeIntentId = Schema.decodeUnknownSync(RecipeImportIntentId);

let authorizer: ImportSystemAuthorizerShape;
let database: AnyD1Database;
let persistenceDirectory: string;
let runtime: Miniflare;
const applications: { readonly dispose: () => Promise<void> }[] = [];
let replayClaimSequence = 0;
let intentSequence = 0;

const queueRecordingWorker = `
export default {
  fetch() {
    return new Response("local queue test");
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      await env.MealPlannerDatabase.prepare(
        "INSERT INTO test_queue_deliveries (queue_name, body_json, attempt) VALUES (?, ?, ?)"
      ).bind(batch.queue, JSON.stringify(message.body), message.attempts).run();
      const configuredFailure = batch.queue === "${primaryQueueName}"
        ? await env.MealPlannerDatabase.prepare(
            "SELECT item_id FROM test_queue_failures WHERE item_id = ?"
          ).bind(message.body.itemId).first()
        : null;
      if (configuredFailure === null) message.ack();
      else message.retry({ delaySeconds: 0 });
    }
  }
};`;

const runSequentially = <A>(
  values: readonly A[],
  run: (value: A) => Promise<void>
): Promise<void> => {
  const [value, ...remaining] = values;
  return value === undefined
    ? Promise.resolve()
    : run(value).then(() => runSequentially(remaining, run));
};

beforeAll(async () => {
  persistenceDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-durable-batch-queue-`
  );
  runtime = new Miniflare({
    compatibilityDate: "2026-07-14",
    d1Databases: { MealPlannerDatabase: "durable-batch-queue" },
    d1Persist: persistenceDirectory,
    modules: true,
    queueConsumers: {
      [deadLetterQueueName]: {
        maxBatchSize: 1,
        maxBatchTimeout: 0,
      },
      [primaryQueueName]: {
        deadLetterQueue: deadLetterQueueName,
        maxBatchSize: 1,
        maxBatchTimeout: 0,
        maxRetries: 2,
        retryDelay: 0,
      },
    },
    queueProducers: {
      PRIMARY_QUEUE: { queueName: primaryQueueName },
    },
    script: queueRecordingWorker,
  });
  database = await runtime.getD1Database("MealPlannerDatabase");
  await database
    .prepare(
      `CREATE TABLE d1_migrations (
         id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
         name TEXT NOT NULL UNIQUE,
         applied_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
       )`
    )
    .run();
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("../../../migrations", import.meta.url))
  );
  await runSequentially(migrations, async (migration) => {
    await database.batch([
      ...migration.queries.map((query) => database.prepare(query)),
      database
        .prepare("INSERT INTO d1_migrations (name) VALUES (?)")
        .bind(migration.name),
    ]);
  });
  await database.batch([
    database.prepare(
      `CREATE TABLE test_queue_deliveries (
         id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
         queue_name TEXT NOT NULL,
         body_json TEXT NOT NULL,
         attempt INTEGER NOT NULL
       )`
    ),
    database.prepare(
      `CREATE TABLE test_queue_failures (
         item_id TEXT PRIMARY KEY NOT NULL
       )`
    ),
  ]);
  authorizer = await Effect.runPromise(makeTestSystemAuthorizer(apiToken));
}, 30_000);

beforeEach(async () => {
  replayClaimSequence = 0;
  await database.batch([
    database.prepare("DELETE FROM test_queue_failures"),
    database.prepare("DELETE FROM test_queue_deliveries"),
    database.prepare("DELETE FROM import_dead_letters"),
    database.prepare("DELETE FROM import_batch_items"),
    database.prepare("DELETE FROM import_batches"),
  ]);
});

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ dispose }) => dispose()));
});

afterAll(async () => {
  await runtime.dispose();
  await rm(persistenceDirectory, { force: true, recursive: true });
});

const batchIdFor = (sequence: number) =>
  decodeBatchId(
    `018f47ad-91aa-7c35-b6fe-${String(500_000 + sequence).padStart(12, "0")}`
  );

const itemIdFor = (sequence: number) =>
  decodeItemId(
    `018f47ad-91aa-7c35-b6fe-${String(600_000 + sequence).padStart(12, "0")}`
  );

const newReplayClaimId = () => {
  replayClaimSequence += 1;
  return Schema.decodeUnknownSync(DeadLetterReplayClaimId)(
    `018f47ad-91aa-7c35-b6fe-${String(700_000 + replayClaimSequence).padStart(12, "0")}`
  );
};

const identityResolver: CanonicalSourceIdentityResolverShape = {
  resolve: (source) => {
    const match = /\/(?<kind>photo|video)\/(?<id>\d+)/u.exec(source.url);
    const canonicalId = match?.groups?.["id"];
    if (canonicalId === undefined) {
      return Effect.fail(invalidSource());
    }
    const identity = {
      canonicalId: decodeCanonicalId(canonicalId),
      kind: "tiktok" as const,
    };
    if (match?.groups?.["kind"] === "photo") {
      return Effect.succeed({
        _tag: "UnsupportedIdentity" as const,
        identity,
      });
    }
    return Effect.succeed({
      _tag: "VideoIdentity" as const,
      identity,
      videoUrl: decodeVideoUrl(source.url),
    });
  },
};

const makeAcceptance = (options?: {
  readonly workflowStarter?: Pick<
    ImportWorkflowReconcilerShape,
    "ensureStarted"
  >;
}) => {
  const workflowStarts: string[] = [];
  const workflowStarter = options?.workflowStarter ?? {
    ensureStarted: (importId: string) =>
      Effect.sync(() => {
        workflowStarts.push(importId);
        return "created" as const;
      }),
  };
  const application = makeImportIntentApplication(
    makeD1ImportRepository(database),
    workflowStarter,
    TestImportTrace
  );
  const acceptance = makeD1ImportQueueAcceptance({
    application,
    database,
    newIntentId: () => {
      intentSequence += 1;
      return decodeIntentId(
        `018f47ad-91aa-7c35-b6fe-${String(800_000 + intentSequence).padStart(12, "0")}`
      );
    },
    newReplayClaimId,
    now: () => timestampText,
    principal: TestImportPrincipal,
    replayClaimLeaseMilliseconds: 60_000,
  });
  return { ...acceptance, workflowStarts };
};

const makeHttpHarness = async () => {
  const sender = await runtime.getQueueProducer<unknown>("PRIMARY_QUEUE");
  let nextBatchId = 0;
  let nextItemId = 0;
  const service = makeImportBatchService({
    identityResolver,
    newBatchId: () => {
      nextBatchId += 1;
      return batchIdFor(nextBatchId);
    },
    newItemId: () => {
      nextItemId += 1;
      return itemIdFor(nextItemId);
    },
    now: () => timestamp,
    queue: makeCloudflareImportBatchQueue({
      sendBatch: (messages) => sender.sendBatch(messages),
    }),
    store: makeAcceptance().store,
  });
  const app = HttpRouter.toWebHandler(
    Layer.mergeAll(
      ImportBatchRoutes,
      Layer.succeed(
        ImportSystemAuthorizer,
        ImportSystemAuthorizer.of(authorizer)
      ),
      Layer.succeed(ImportBatchService, ImportBatchService.of(service))
    ),
    { disableLogger: true }
  );
  applications.push(app);
  return app;
};

const postBatchSources = (
  app: Awaited<ReturnType<typeof makeHttpHarness>>,
  idempotencyKey: string,
  sourcePaths: readonly string[]
) =>
  app.handler(
    new Request("https://meal-planner.test/import-batches", {
      body: JSON.stringify({
        items: sourcePaths.map((sourcePath, index) => ({
          idempotencyKey: `${idempotencyKey}-item-${index + 1}`,
          source: {
            kind: "tiktok",
            url: `https://www.tiktok.com/@cook/${sourcePath}`,
          },
        })),
      }),
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      method: "POST",
    })
  );

const postBatch = (
  app: Awaited<ReturnType<typeof makeHttpHarness>>,
  idempotencyKey: string,
  canonicalIds: readonly string[]
) =>
  postBatchSources(
    app,
    idempotencyKey,
    canonicalIds.map((canonicalId) => `video/${canonicalId}`)
  );

const getBatch = (
  app: Awaited<ReturnType<typeof makeHttpHarness>>,
  batchId: string
) =>
  app.handler(
    new Request(`https://meal-planner.test/import-batches/${batchId}`, {
      headers: { authorization: `Bearer ${apiToken}` },
    })
  );

interface RecordedDelivery {
  readonly attempt: number;
  readonly bodyJson: string;
  readonly queueName: string;
}

const recordedDeliveries = () =>
  database
    .prepare(
      `SELECT attempt, body_json AS bodyJson, queue_name AS queueName
         FROM test_queue_deliveries
        ORDER BY id`
    )
    .all<RecordedDelivery>();

const waitForDeliveries = (
  queueName: string,
  minimum: number
): Promise<readonly RecordedDelivery[]> =>
  vi.waitFor(
    async () => {
      const { results } = await recordedDeliveries();
      const rows = results.filter(
        (delivery: RecordedDelivery) => delivery.queueName === queueName
      );
      expect(rows.length).toBeGreaterThanOrEqual(minimum);
      return rows;
    },
    { interval: 20, timeout: 10_000 }
  );

const messageFrom = (delivery: RecordedDelivery) =>
  decodeQueueMessage(JSON.parse(delivery.bodyJson));

describe("durable import batch queue acceptance", () => {
  it("preserves a carousel identity through D1 and canonical intent admission", async () => {
    const app = await makeHttpHarness();
    const canonicalId = "7520000000000000051";
    const acceptance = makeAcceptance();

    const admitted = await postBatchSources(app, "batch-photo", [
      `photo/${canonicalId}`,
    ]);
    const [delivery] = await waitForDeliveries(primaryQueueName, 1);
    if (delivery === undefined) {
      throw new Error("Expected photo queue delivery");
    }
    const stored = await database
      .prepare(
        `SELECT source_canonical_id AS canonicalId,
                source_identity_kind AS identityKind
           FROM import_batch_items
          WHERE id = ?`
      )
      .bind(messageFrom(delivery).itemId)
      .first();
    await Effect.runPromise(
      acceptance.consume(
        messageFrom(delivery),
        decodeDeliveryAttempt(delivery.attempt)
      )
    );

    expect(admitted.status).toBe(202);
    expect(stored).toEqual({
      canonicalId,
      identityKind: "carousel",
    });
    const intent = await database
      .prepare(
        `SELECT resolved_canonical_source_id AS canonicalId,
                public_source_url AS canonicalUrl,
                public_source_kind AS sourceKind
           FROM recipe_imports
          WHERE resolved_canonical_source_id = ?`
      )
      .bind(canonicalId)
      .first();
    expect(intent).toEqual({
      canonicalId,
      canonicalUrl: `https://www.tiktok.com/@source/photo/${canonicalId}`,
      sourceKind: "carousel",
    });
  });

  it("proves HTTP to D1 to workerd Queue to unordered consumer to D1 to GET", async () => {
    const app = await makeHttpHarness();
    let starts = 0;
    const acceptance = makeAcceptance({
      workflowStarter: {
        ensureStarted: () => {
          starts += 1;
          return starts === 2
            ? Effect.fail(workflowStartUnavailable())
            : Effect.succeed("created" as const);
        },
      },
    });

    const admitted = await postBatch(app, "batch-partial", [
      "7520000000000000101",
      "7520000000000000102",
    ]);
    const primaryDeliveries = await waitForDeliveries(primaryQueueName, 2);
    const messages = primaryDeliveries.map(messageFrom);

    expect(admitted.status).toBe(202);
    expect(messages).toEqual([
      { batchId: batchIdFor(1), itemId: itemIdFor(1) },
      { batchId: batchIdFor(1), itemId: itemIdFor(2) },
    ]);
    expect(JSON.stringify(messages)).not.toMatch(/tiktok|url|source/iu);

    await runSequentially(primaryDeliveries.toReversed(), (delivery) =>
      Effect.runPromise(
        acceptance.consume(
          messageFrom(delivery),
          decodeDeliveryAttempt(delivery.attempt)
        )
      )
    );
    await runSequentially(primaryDeliveries, (delivery) =>
      Effect.runPromise(
        acceptance.consume(
          messageFrom(delivery),
          decodeDeliveryAttempt(delivery.attempt)
        )
      )
    );

    const polled = await getBatch(app, batchIdFor(1));
    expect(polled.status).toBe(200);
    await expect(polled.json()).resolves.toMatchObject({
      batch: {
        counts: { failed: 1, queued: 0, running: 0, succeeded: 1, total: 2 },
        items: [
          {
            code: "workflow_start_unavailable",
            deadLettered: false,
            id: itemIdFor(1),
            status: "failed",
          },
          {
            disposition: "created",
            id: itemIdFor(2),
            intentId: expect.any(String),
            status: "succeeded",
          },
        ],
        status: "partial_failure",
      },
    });
    expect(starts).toBe(2);
  });

  it("recovers an interrupted settlement through canonical intent idempotency", async () => {
    const app = await makeHttpHarness();
    const admitted = await postBatch(app, "batch-redelivery", [
      "7520000000000000201",
    ]);
    const [delivery] = await waitForDeliveries(primaryQueueName, 1);
    if (delivery === undefined) {
      throw new Error("Expected queue delivery");
    }
    let calls = 0;
    const acceptance = makeAcceptance({
      workflowStarter: {
        ensureStarted: () => {
          calls += 1;
          return calls === 1
            ? Effect.interrupt
            : Effect.succeed("created" as const);
        },
      },
    });
    const message = messageFrom(delivery);

    expect(admitted.status).toBe(202);
    const interrupted = await Effect.runPromiseExit(
      acceptance.consume(message, decodeDeliveryAttempt(1))
    );
    expect(Exit.isFailure(interrupted)).toBe(true);
    await Effect.runPromise(
      acceptance.consume(message, decodeDeliveryAttempt(2))
    );
    await Effect.runPromise(
      acceptance.consume(message, decodeDeliveryAttempt(1))
    );
    await Effect.runPromise(
      acceptance.consume(message, decodeDeliveryAttempt(2))
    );

    const polled = await getBatch(app, batchIdFor(1));
    await expect(polled.json()).resolves.toMatchObject({
      batch: {
        counts: { failed: 0, queued: 0, running: 0, succeeded: 1, total: 1 },
        items: [
          {
            disposition: "idempotency_replay",
            status: "succeeded",
          },
        ],
        status: "completed",
      },
    });
    expect(calls).toBe(2);
    const intentRows = await database
      .prepare(
        `SELECT COUNT(*) AS count
           FROM recipe_imports
          WHERE resolved_canonical_source_id = ?`
      )
      .bind("7520000000000000201")
      .first<{ readonly count: number }>();
    expect(intentRows?.count).toBe(1);
  });

  it("settles same-household duplicates as independently addressable intents", async () => {
    const app = await makeHttpHarness();
    await postBatch(app, "batch-canonical-duplicate", [
      "7520000000000000251",
      "7520000000000000251",
    ]);
    const primaryDeliveries = await waitForDeliveries(primaryQueueName, 2);
    const acceptance = makeAcceptance();

    await runSequentially(primaryDeliveries, (delivery) =>
      Effect.runPromise(
        acceptance.consume(
          messageFrom(delivery),
          decodeDeliveryAttempt(delivery.attempt)
        )
      )
    );

    const polled = await getBatch(app, batchIdFor(1));
    await expect(polled.json()).resolves.toMatchObject({
      batch: {
        counts: { failed: 0, queued: 0, running: 0, succeeded: 2, total: 2 },
        items: [
          {
            disposition: "created",
            intentId: expect.any(String),
            status: "succeeded",
          },
          {
            disposition: "created",
            intentId: expect.any(String),
            status: "succeeded",
          },
        ],
        status: "completed",
      },
    });
    const duplicateIntents = await database
      .prepare(
        `SELECT id, public_status AS status
           FROM recipe_imports
          WHERE resolved_canonical_source_id = ?
          ORDER BY created_at, id`
      )
      .bind("7520000000000000251")
      .all<{ readonly id: string; readonly status: string }>();
    expect(duplicateIntents.results).toHaveLength(2);
    expect(
      duplicateIntents.results.map(
        ({ status }: { readonly status: string }) => status
      )
    ).toEqual(["processing", "redirected"]);
    expect(
      new Set(
        duplicateIntents.results.map(({ id }: { readonly id: string }) => id)
      ).size
    ).toBe(2);
  });

  it("surfaces a real Queue retry exhaustion through the durable DLQ", async () => {
    const app = await makeHttpHarness();
    const doomedItemId = itemIdFor(1);
    await database
      .prepare("INSERT INTO test_queue_failures (item_id) VALUES (?)")
      .bind(doomedItemId)
      .run();

    const admitted = await postBatch(app, "batch-dlq", ["7520000000000000301"]);
    const primaryDeliveries = await waitForDeliveries(primaryQueueName, 2);
    const [deadLetterDelivery] = await waitForDeliveries(
      deadLetterQueueName,
      1
    );
    if (deadLetterDelivery === undefined) {
      throw new Error("Expected final dead-letter delivery");
    }
    const acceptance = makeAcceptance();
    const message = messageFrom(deadLetterDelivery);

    expect(admitted.status).toBe(202);
    expect(primaryDeliveries.map(({ attempt }) => attempt)).toEqual(
      expect.arrayContaining([1, 2])
    );
    expect(message).toEqual({
      batchId: batchIdFor(1),
      itemId: doomedItemId,
    });
    await Effect.runPromise(acceptance.deadLetter(message));
    await Effect.runPromise(acceptance.deadLetter(message));

    const polled = await getBatch(app, batchIdFor(1));
    await expect(polled.json()).resolves.toMatchObject({
      batch: {
        counts: { failed: 1, queued: 0, running: 0, succeeded: 0, total: 1 },
        items: [
          {
            code: "workflow_start_unavailable",
            deadLettered: true,
            id: doomedItemId,
            status: "failed",
          },
        ],
        status: "failed",
      },
    });
    const deadLetters = await database
      .prepare(
        `SELECT failure_code AS failureCode, replay_state AS replayState
           FROM import_dead_letters
          WHERE item_id = ?`
      )
      .bind(doomedItemId)
      .all();
    expect(deadLetters.results).toEqual([
      {
        failureCode: "workflow_start_unavailable",
        replayState: "ready",
      },
    ]);
  });

  it("rejects a queue identity that was never admitted", async () => {
    const acceptance = makeAcceptance();
    const missing = decodeQueueMessage({
      batchId: batchIdFor(99),
      itemId: itemIdFor(99),
    });

    const failure = await Effect.runPromise(
      Effect.flip(acceptance.consume(missing, decodeDeliveryAttempt(1)))
    );

    expect(failure).toEqual({
      _tag: "ImportBatchQueueMessageNotFound",
      batchId: batchIdFor(99),
      itemId: itemIdFor(99),
    });
  });
});
