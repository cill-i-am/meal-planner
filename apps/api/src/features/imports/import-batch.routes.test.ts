import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Redacted, Schema } from "effect";
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
} from "vitest";

import { ImportBatchId, ImportBatchItemId } from "./import-batch.contracts.js";
import type { ImportBatchQueueMessage } from "./import-batch.contracts.js";
import { ImportBatchRoutes } from "./import-batch.routes.js";
import {
  ImportBatchService,
  makeImportBatchService,
} from "./import-batch.service.js";
import type { ImportBatchQueueShape } from "./import-batch.service.js";
import { makeD1ImportBatchStore } from "./import-queue-acceptance.d1.js";
import { ImportAuthorizer, makeImportAuthorizer } from "./import.auth.js";
import { ImportTimestamp, SourceCanonicalId } from "./import.contracts.js";
import { invalidSource } from "./import.errors.js";
import type { CanonicalSourceIdentityResolverShape } from "./source-identity.js";
import { ValidatedVideoUrl } from "./source-identity.js";

const apiToken = "durable-batch-test-token";
const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(
  "2026-08-15T09:00:00.000Z"
);
const decodeBatchId = Schema.decodeUnknownSync(ImportBatchId);
const decodeItemId = Schema.decodeUnknownSync(ImportBatchItemId);
const decodeCanonicalId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodeVideoUrl = Schema.decodeUnknownSync(ValidatedVideoUrl);

let database: AnyD1Database;
let persistenceDirectory: string;
let runtime: Miniflare;
const applications: { readonly dispose: () => Promise<void> }[] = [];

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
    `${tmpdir()}/meal-planner-durable-batch-routes-`
  );
  runtime = new Miniflare({
    compatibilityDate: "2026-07-14",
    d1Databases: { MealPlannerDatabase: "durable-batch-routes" },
    d1Persist: persistenceDirectory,
    modules: true,
    script:
      "export default { fetch() { return new Response('local D1 test'); } }",
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
}, 30_000);

beforeEach(async () => {
  await database.batch([
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
    `018f47ad-91aa-7c35-b6fe-${String(100_000 + sequence).padStart(12, "0")}`
  );

const itemIdFor = (sequence: number) =>
  decodeItemId(
    `018f47ad-91aa-7c35-b6fe-${String(200_000 + sequence).padStart(12, "0")}`
  );

const makeHarness = async () => {
  const enqueued: ImportBatchQueueMessage[] = [];
  let queueAvailable = true;
  let identityCalls = 0;
  let nextBatchId = 0;
  let nextItemId = 0;
  const identityResolver: CanonicalSourceIdentityResolverShape = {
    resolve: (source) => {
      const canonicalId = /\/video\/(?<id>\d+)/u.exec(source.url)?.groups?.[
        "id"
      ];
      if (canonicalId === undefined) {
        return Effect.fail(invalidSource());
      }
      return Effect.sync(() => {
        identityCalls += 1;
        return {
          _tag: "VideoIdentity" as const,
          identity: {
            canonicalId: decodeCanonicalId(canonicalId),
            kind: "tiktok" as const,
          },
          videoUrl: decodeVideoUrl(source.url),
        };
      });
    },
  };
  const queue: ImportBatchQueueShape = {
    enqueue: (messages) =>
      queueAvailable
        ? Effect.sync(() => {
            enqueued.push(...messages);
          })
        : Effect.fail({ _tag: "ImportBatchQueueUnavailable" as const }),
  };
  const authorizer = await Effect.runPromise(
    makeImportAuthorizer(Redacted.make(apiToken))
  );
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
    queue,
    store: makeD1ImportBatchStore(database),
  });
  const app = HttpRouter.toWebHandler(
    Layer.mergeAll(
      ImportBatchRoutes,
      Layer.succeed(ImportAuthorizer, ImportAuthorizer.of(authorizer)),
      Layer.succeed(ImportBatchService, ImportBatchService.of(service))
    ),
    { disableLogger: true }
  );
  applications.push(app);
  return {
    app,
    enqueued,
    get identityCalls() {
      return identityCalls;
    },
    setQueueAvailable: (available: boolean) => {
      queueAvailable = available;
    },
  };
};

const postBatch = (
  app: Awaited<ReturnType<typeof makeHarness>>["app"],
  idempotencyKey: string,
  items: readonly unknown[]
) =>
  app.handler(
    new Request("https://meal-planner.test/import-batches", {
      body: JSON.stringify({ items }),
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      method: "POST",
    })
  );

const item = (idempotencyKey: string, canonicalId: string) => ({
  idempotencyKey,
  source: {
    kind: "tiktok",
    url: `https://www.tiktok.com/@cook/video/${canonicalId}`,
  },
});

describe("durable import batch routes", () => {
  it("persists a normal TikTok URL and enqueues only durable identities", async () => {
    const harness = await makeHarness();

    const response = await postBatch(harness.app, "batch-url-admission", [
      item("item-url-admission", "7520000000000000001"),
    ]);
    const body = await response.json();
    const persisted = await database
      .prepare(
        `SELECT source_canonical_id AS canonicalId,
                source_identity_kind AS identityKind,
                delivery_mode AS deliveryMode
           FROM import_batch_items`
      )
      .first();
    const columns = await database
      .prepare("PRAGMA table_info(import_batch_items)")
      .all<{ readonly name: string }>();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      batch: {
        counts: { failed: 0, queued: 1, running: 0, succeeded: 0, total: 1 },
        id: batchIdFor(1),
        status: "queued",
      },
      disposition: "created",
    });
    expect(harness.enqueued).toEqual([
      { batchId: batchIdFor(1), itemId: itemIdFor(1) },
    ]);
    expect(persisted).toEqual({
      canonicalId: "7520000000000000001",
      deliveryMode: "ordinary",
      identityKind: "video",
    });
    expect(
      columns.results.map(({ name }: { readonly name: string }) => name)
    ).not.toContain("source_url");
    expect(JSON.stringify(harness.enqueued)).not.toMatch(/tiktok|url|source/iu);
  });

  it("replays the same pending D1 batch without resolving its URL again", async () => {
    const harness = await makeHarness();
    const request = [item("item-replay", "7520000000000000002")];

    const first = await postBatch(harness.app, "batch-replay", request);
    const replay = await postBatch(harness.app, "batch-replay", request);

    expect(first.status).toBe(202);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      batch: { id: batchIdFor(1), status: "queued" },
      disposition: "idempotency_replay",
    });
    expect(harness.identityCalls).toBe(1);
    expect(harness.enqueued).toEqual([
      { batchId: batchIdFor(1), itemId: itemIdFor(1) },
      { batchId: batchIdFor(1), itemId: itemIdFor(1) },
    ]);
  });

  it("rejects a conflicting request before a second source lookup", async () => {
    const harness = await makeHarness();
    await postBatch(harness.app, "batch-conflict", [
      item("item-conflict", "7520000000000000003"),
    ]);

    const conflict = await postBatch(harness.app, "batch-conflict", [
      item("item-conflict", "7520000000000000004"),
    ]);

    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: {
        code: "idempotency_conflict",
        message:
          "The idempotency key was already used for another batch request.",
      },
    });
    expect(harness.identityCalls).toBe(1);
  });

  it("keeps D1 truth replayable when initial queue delivery is unavailable", async () => {
    const harness = await makeHarness();
    const request = [item("item-recovery", "7520000000000000005")];
    harness.setQueueAvailable(false);

    const unavailable = await postBatch(
      harness.app,
      "batch-queue-recovery",
      request
    );
    harness.setQueueAvailable(true);
    const replay = await postBatch(
      harness.app,
      "batch-queue-recovery",
      request
    );

    expect(unavailable.status).toBe(503);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      batch: { id: batchIdFor(1), status: "queued" },
      disposition: "idempotency_replay",
    });
    expect(harness.identityCalls).toBe(1);
    expect(harness.enqueued).toEqual([
      { batchId: batchIdFor(1), itemId: itemIdFor(1) },
    ]);
  });

  it("derives empty completion from D1 and rejects more than fifty items", async () => {
    const harness = await makeHarness();
    const empty = await postBatch(harness.app, "batch-empty", []);
    const tooLarge = await postBatch(
      harness.app,
      "batch-too-large",
      Array.from({ length: 51 }, (_, index) =>
        item(
          `item-${index}`,
          String(7_520_000_000_000_000_100n + BigInt(index))
        )
      )
    );

    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({
      batch: {
        counts: { failed: 0, queued: 0, running: 0, succeeded: 0, total: 0 },
        status: "completed",
      },
      disposition: "created",
    });
    expect(tooLarge.status).toBe(400);
    expect(harness.enqueued).toEqual([]);
  });
});
