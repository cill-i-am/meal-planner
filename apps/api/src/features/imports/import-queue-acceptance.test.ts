import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, Effect, Exit, Schema } from "effect";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ImportBatchId,
  ImportBatchItemId,
  ImportBatchQueueMessage,
} from "./import-batch.contracts.js";
import {
  OperationalCorrelation,
  OperationalPrincipal,
  makeImportOperationsService,
} from "./import-operations.js";
import { makeD1ImportQueueAcceptance } from "./import-queue-acceptance.d1.js";
import { IdempotencyKey, SourceDescriptor } from "./import.contracts.js";
import { makeProviderFreeSyntheticImportService } from "./import.synthetic.js";

let database: AnyD1Database;
let persistenceDirectory: string;
let runtime: Miniflare;

const acceptanceNow = () => "2026-07-23T08:00:00.000Z" as const;

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
    `${tmpdir()}/meal-planner-gaia-117-queue-`
  );
  runtime = new Miniflare({
    compatibilityDate: "2026-07-14",
    d1Databases: { MealPlannerDatabase: "gaia-117-queue-acceptance" },
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

afterAll(async () => {
  await runtime.dispose();
  await rm(persistenceDirectory, { force: true, recursive: true });
});

describe("durable provider-free queue acceptance", () => {
  it("installs the ordered batch, dead-letter, and operational audit boundary", async () => {
    const tables = await database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      )
      .all<{ readonly name: string }>();
    const ledger = await database
      .prepare("SELECT name FROM d1_migrations ORDER BY id")
      .all<{ readonly name: string }>();
    const itemColumns = await database
      .prepare("PRAGMA table_info(import_batch_items)")
      .all<{ readonly name: string }>();

    expect(
      tables.results.map(({ name }: { readonly name: string }) => name)
    ).toEqual(
      expect.arrayContaining([
        "import_batches",
        "import_batch_items",
        "import_dead_letters",
        "import_operational_events",
      ])
    );
    expect(
      ledger.results.map(({ name }: { readonly name: string }) => name)
    ).toEqual([
      "0000_recipe_imports.sql",
      "0001_import_media_acquisition.sql",
      "0002_import_speech_transcription.sql",
      "0003_import_visual_evidence.sql",
      "0004_import_recipe_extractions.sql",
      "0005_recipe_reviews.sql",
      "0006_import_carousel_evidence.sql",
      "0007_import_queue_acceptance.sql",
    ]);
    expect(
      itemColumns.results.map(({ name }: { readonly name: string }) => name)
    ).not.toContain("source_url");
  });

  it("rolls back an adversarial seed atomically without corrupting migration history or foreign keys", async () => {
    const batchId = Schema.decodeUnknownSync(ImportBatchId)(
      "018f47ad-91aa-7c35-b6fe-000000000711"
    );
    const duplicateItemId = Schema.decodeUnknownSync(ImportBatchItemId)(
      "018f47ad-91aa-7c35-b6fe-000000000712"
    );
    const source = Schema.decodeUnknownSync(SourceDescriptor)({
      kind: "tiktok",
      url: "https://synthetic.invalid/imports/7520000000000000712",
    });
    const idempotencyKey = Schema.decodeUnknownSync(IdempotencyKey)(
      "gaia-117:atomic-seed:712"
    );
    const ordinary = makeProviderFreeSyntheticImportService({
      database,
      now: () => "2026-07-23T08:00:00.000Z",
    });
    const acceptance = makeD1ImportQueueAcceptance({
      database,
      imports: ordinary,
      maximumDeliveryAttempts: 3,
      now: () => "2026-07-23T08:00:00.000Z",
    });

    const failedSeed = await Effect.runPromiseExit(
      acceptance.seedBatch({
        batchId,
        idempotencyKey: "gaia-117:atomic-batch:711",
        items: [
          {
            deliveryMode: "ordinary",
            id: duplicateItemId,
            idempotencyKey,
            source,
          },
          {
            deliveryMode: "ordinary",
            id: duplicateItemId,
            idempotencyKey: Schema.decodeUnknownSync(IdempotencyKey)(
              "gaia-117:atomic-seed:713"
            ),
            source,
          },
        ],
      })
    );
    expect(Exit.isFailure(failedSeed)).toBe(true);

    const partialBatch = await database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM import_batches WHERE id = ?) AS batches,
           (SELECT COUNT(*) FROM import_batch_items WHERE batch_id = ?) AS items`
      )
      .bind(batchId, batchId)
      .first<{ readonly batches: number; readonly items: number }>();
    expect(partialBatch).toEqual({ batches: 0, items: 0 });
    await expect(
      database
        .prepare(
          `INSERT INTO import_batch_items (
             id, batch_id, idempotency_key, source_kind, source_canonical_id,
             delivery_mode, correlation_json, status, failure_code,
             attempt_count, import_id, canonical_source_id,
             import_status_json, disposition, created_at, updated_at
           ) VALUES (?, ?, ?, 'tiktok', ?, 'ordinary', NULL, 'queued', NULL,
                     0, NULL, NULL, NULL, NULL, ?, ?)`
        )
        .bind(
          duplicateItemId,
          batchId,
          idempotencyKey,
          "7520000000000000712",
          "2026-07-23T08:00:00.000Z",
          "2026-07-23T08:00:00.000Z"
        )
        .run()
    ).rejects.toThrow();

    const ledger = await database
      .prepare(
        `SELECT name, COUNT(*) AS count
           FROM d1_migrations
          GROUP BY name
          ORDER BY name`
      )
      .all<{ readonly name: string; readonly count: number }>();
    expect(ledger.results).toHaveLength(8);
    expect(
      ledger.results.every(
        ({ count }: { readonly count: number }) => count === 1
      )
    ).toBe(true);
    const foreignKeyViolations = await database
      .prepare("PRAGMA foreign_key_check")
      .all();
    expect(foreignKeyViolations.results).toEqual([]);
  });

  it("survives redelivery and replays one poisoned item through the ordinary service exactly once", async () => {
    const batchId = Schema.decodeUnknownSync(ImportBatchId)(
      "018f47ad-91aa-7c35-b6fe-000000000701"
    );
    const happyItemId = Schema.decodeUnknownSync(ImportBatchItemId)(
      "018f47ad-91aa-7c35-b6fe-000000000702"
    );
    const poisonItemId = Schema.decodeUnknownSync(ImportBatchItemId)(
      "018f47ad-91aa-7c35-b6fe-000000000703"
    );
    const happySource = Schema.decodeUnknownSync(SourceDescriptor)({
      kind: "tiktok",
      url: "https://synthetic.invalid/imports/7520000000000000702",
    });
    const poisonSource = Schema.decodeUnknownSync(SourceDescriptor)({
      kind: "tiktok",
      url: "https://synthetic.invalid/imports/7520000000000000703",
    });
    const happyKey =
      Schema.decodeUnknownSync(IdempotencyKey)("gaia-117:happy:702");
    const poisonKey = Schema.decodeUnknownSync(IdempotencyKey)(
      "gaia-117:poison:703"
    );
    const correlation = Schema.decodeUnknownSync(OperationalCorrelation)({
      batchId,
      evidence: {
        kind: "recipe_draft",
        referenceId: "synthetic-evidence:gaia-117:703",
      },
      importId: "018f47ad-91aa-7c35-b6fe-000000000703",
      mealPlanId: "synthetic-meal-plan:gaia-117",
      recipeId: "018f47ad-91aa-7c35-b6fe-000000000703",
    });
    const operator = Schema.decodeUnknownSync(OperationalPrincipal)({
      actorId: "gaia-117-synthetic-operator",
      role: "operator",
    });
    const viewer = Schema.decodeUnknownSync(OperationalPrincipal)({
      actorId: "gaia-117-synthetic-viewer",
      role: "viewer",
    });
    const providerFreeObservations = {
      availabilityValidations: 0,
      identityResolutions: 0,
      workflowReconciliations: 0,
    };
    const ordinary = makeProviderFreeSyntheticImportService({
      database,
      now: acceptanceNow,
      observe: {
        availabilityValidation: () => {
          providerFreeObservations.availabilityValidations += 1;
        },
        identityResolution: () => {
          providerFreeObservations.identityResolutions += 1;
        },
        workflowReconciliation: () => {
          providerFreeObservations.workflowReconciliations += 1;
        },
      },
    });
    const acceptance = makeD1ImportQueueAcceptance({
      database,
      imports: ordinary,
      maximumDeliveryAttempts: 3,
      now: acceptanceNow,
    });

    await Effect.runPromise(
      acceptance.seedBatch({
        batchId,
        idempotencyKey: "gaia-117:batch:701",
        items: [
          {
            deliveryMode: "ordinary",
            id: happyItemId,
            idempotencyKey: happyKey,
            source: happySource,
          },
          {
            correlation,
            deliveryMode: "poison",
            id: poisonItemId,
            idempotencyKey: poisonKey,
            source: poisonSource,
          },
        ],
      })
    );

    const happyMessage = Schema.decodeUnknownSync(ImportBatchQueueMessage)({
      batchId,
      itemId: happyItemId,
    });
    let ordinaryCreateCalls = 0;
    const interrupted = makeD1ImportQueueAcceptance({
      database,
      imports: {
        create: (request, idempotencyKey) =>
          ordinary.create(request, idempotencyKey).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                ordinaryCreateCalls += 1;
              })
            ),
            Effect.andThen(Effect.interrupt)
          ),
        get: ordinary.get,
      },
      maximumDeliveryAttempts: 3,
      now: acceptanceNow,
    });
    const interruptedExit = await Effect.runPromiseExit(
      interrupted.consume(happyMessage)
    );
    expect(
      Exit.isFailure(interruptedExit) &&
        Cause.hasInterrupts(interruptedExit.cause)
    ).toBe(true);

    ordinaryCreateCalls = 0;
    const redelivered = makeD1ImportQueueAcceptance({
      database,
      imports: {
        create: (request, idempotencyKey) => {
          ordinaryCreateCalls += 1;
          return ordinary.create(request, idempotencyKey);
        },
        get: ordinary.get,
      },
      maximumDeliveryAttempts: 3,
      now: acceptanceNow,
    });
    await Effect.runPromise(redelivered.consume(happyMessage));
    await Effect.runPromise(redelivered.consume(happyMessage));
    expect(ordinaryCreateCalls).toBe(1);

    const poisonMessage = Schema.decodeUnknownSync(ImportBatchQueueMessage)({
      batchId,
      itemId: poisonItemId,
    });
    await runSequentially([1, 2, 3], async () => {
      const exit = await Effect.runPromiseExit(
        acceptance.consume(poisonMessage)
      );
      expect(Exit.isFailure(exit)).toBe(true);
    });
    const deadLetterState = await database
      .prepare(
        `SELECT i.attempt_count AS attemptCount,
                i.status,
                d.replay_state AS replayState
           FROM import_batch_items i
           JOIN import_dead_letters d ON d.item_id = i.id
          WHERE i.id = ?`
      )
      .bind(poisonItemId)
      .first<{
        readonly attemptCount: number;
        readonly replayState: string;
        readonly status: string;
      }>();
    expect(deadLetterState).toEqual({
      attemptCount: 3,
      replayState: "ready",
      status: "failed",
    });
    await expect(
      Effect.runPromise(acceptance.getBatch(batchId))
    ).resolves.toMatchObject({
      counts: { failed: 1, succeeded: 1, total: 2 },
      status: "partial_failure",
    });

    const denied = await Effect.runPromiseExit(
      makeImportOperationsService({
        artifacts: { expireDue: () => Effect.succeed([]) },
        deadLetters: acceptance.deadLetters,
        events: acceptance.events,
        imports: ordinary,
        replayQuotaLimit: 1,
      }).inspectDeadLetter({ itemId: poisonItemId, principal: viewer })
    );
    expect(Exit.isFailure(denied)).toBe(true);

    const operations = makeImportOperationsService({
      artifacts: { expireDue: () => Effect.succeed([]) },
      deadLetters: acceptance.deadLetters,
      events: acceptance.events,
      imports: ordinary,
      replayQuotaLimit: 1,
    });
    const inspection = await Effect.runPromise(
      operations.inspectDeadLetter({
        itemId: poisonItemId,
        principal: operator,
      })
    );
    expect(inspection).toEqual({
      code: "workflow_start_unavailable",
      correlation,
      itemId: poisonItemId,
    });

    const interruptedReplay = await Effect.runPromiseExit(
      makeImportOperationsService({
        artifacts: { expireDue: () => Effect.succeed([]) },
        deadLetters: acceptance.deadLetters,
        events: acceptance.events,
        imports: {
          create: () => Effect.interrupt,
          get: ordinary.get,
        },
        replayQuotaLimit: 1,
      }).replayDeadLetter({
        itemId: poisonItemId,
        principal: operator,
        quotaUnits: 1,
      })
    );
    expect(
      Exit.isFailure(interruptedReplay) &&
        Cause.hasInterrupts(interruptedReplay.cause)
    ).toBe(true);
    const releasedClaim = await database
      .prepare(
        "SELECT replay_state AS replayState FROM import_dead_letters WHERE item_id = ?"
      )
      .bind(poisonItemId)
      .first<{ readonly replayState: string }>();
    expect(releasedClaim).toEqual({ replayState: "ready" });

    const createSpy = vi.fn(ordinary.create);
    const replayOperations = makeImportOperationsService({
      artifacts: { expireDue: () => Effect.succeed([]) },
      deadLetters: acceptance.deadLetters,
      events: acceptance.events,
      imports: { create: createSpy, get: ordinary.get },
      replayQuotaLimit: 1,
    });
    const quotaRejected = await Effect.runPromiseExit(
      replayOperations.replayDeadLetter({
        itemId: poisonItemId,
        principal: operator,
        quotaUnits: 2,
      })
    );
    expect(Exit.isFailure(quotaRejected)).toBe(true);
    expect(createSpy).not.toHaveBeenCalled();

    const firstReplay = await Effect.runPromise(
      replayOperations.replayDeadLetter({
        itemId: poisonItemId,
        principal: operator,
        quotaUnits: 1,
      })
    );
    const duplicateReplay = await Effect.runPromise(
      replayOperations.replayDeadLetter({
        itemId: poisonItemId,
        principal: operator,
        quotaUnits: 1,
      })
    );
    expect(firstReplay.disposition).toBe("replayed");
    expect(duplicateReplay.disposition).toBe("already_replayed");
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(providerFreeObservations).toEqual({
      availabilityValidations: 2,
      identityResolutions: 2,
      workflowReconciliations: 3,
    });

    const finalBatch = await Effect.runPromise(acceptance.getBatch(batchId));
    expect(finalBatch).toMatchObject({
      counts: {
        failed: 0,
        queued: 0,
        running: 0,
        succeeded: 2,
        total: 2,
      },
      status: "completed",
    });

    const importRows = await database
      .prepare(
        `SELECT canonical_source_id AS canonicalSourceId, COUNT(*) AS count
         FROM recipe_imports
        WHERE canonical_source_id IN (?, ?)
        GROUP BY canonical_source_id
        ORDER BY canonical_source_id`
      )
      .bind("7520000000000000702", "7520000000000000703")
      .all<{ readonly canonicalSourceId: string; readonly count: number }>();
    expect(importRows.results).toEqual([
      { canonicalSourceId: "7520000000000000702", count: 1 },
      { canonicalSourceId: "7520000000000000703", count: 1 },
    ]);

    const eventRows = await database
      .prepare(
        "SELECT event_json AS eventJson FROM import_operational_events ORDER BY id"
      )
      .all<{ readonly eventJson: string }>();
    const serializedEvents = eventRows.results
      .map(({ eventJson }: { readonly eventJson: string }) => eventJson)
      .join("\n");
    expect(serializedEvents).toContain("DeadLetterReplayDenied");
    expect(serializedEvents).toContain("DeadLetterReplayQuotaRejected");
    expect(serializedEvents).toContain("DeadLetterReplayed");
    expect(serializedEvents).not.toContain("synthetic.invalid");
    expect(serializedEvents).not.toContain(happyKey);
    expect(serializedEvents).not.toContain(poisonKey);

    const foreignKeyViolations = await database
      .prepare("PRAGMA foreign_key_check")
      .all();
    expect(foreignKeyViolations.results).toEqual([]);
  });
});
