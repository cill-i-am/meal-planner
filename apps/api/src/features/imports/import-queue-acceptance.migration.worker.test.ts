import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const migrationName = "0026_import_batch_canonical_duplicate.sql";
const timestamp = "2026-08-15T12:00:00.000Z";
const batchId = "018f47ad-91aa-7c35-b6fe-000000002600";
const candidateItemId = "018f47ad-91aa-7c35-b6fe-000000002601";
const retainedItemId = "018f47ad-91aa-7c35-b6fe-000000002602";
const deadLetterItemId = "018f47ad-91aa-7c35-b6fe-000000002603";

const migrationIndex = () =>
  testEnv.TEST_MIGRATIONS.findIndex(({ name }) => name === migrationName);

const insertBatch = (database: AnyD1Database) =>
  database
    .prepare(
      `INSERT INTO import_batches (
         id, idempotency_key_hash, request_fingerprint,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, 'queued', ?, ?)`
    )
    .bind(batchId, "a".repeat(64), "b".repeat(64), timestamp, timestamp)
    .run();

const insertCandidate = (database: AnyD1Database) =>
  database
    .prepare(
      `INSERT INTO import_batch_items (
         id, batch_id, idempotency_key, source_kind, source_canonical_id,
         delivery_mode, correlation_json, status, failure_code,
         attempt_count, import_id, canonical_source_id, import_status_json,
         disposition, created_at, updated_at
       ) VALUES (
         ?, ?, 'candidate-key', 'tiktok', '7520000000000002601',
         'ordinary', NULL, 'queued', NULL, 0, NULL, NULL, NULL, NULL, ?, ?
       )`
    )
    .bind(candidateItemId, batchId, timestamp, timestamp)
    .run();

const settleCanonicalDuplicate = (database: AnyD1Database) =>
  database
    .prepare(
      `UPDATE import_batch_items
          SET status = 'succeeded',
              import_id = '018f47ad-91aa-7c35-b6fe-000000002699',
              canonical_source_id = '7520000000000002601',
              import_status_json = '{"kind":"queued"}',
              disposition = 'canonical_duplicate',
              updated_at = ?
        WHERE id = ?`
    )
    .bind(timestamp, candidateItemId)
    .run();

describe("import batch canonical duplicate migration", () => {
  it("upgrades an applied 0007-era table without losing rows, indexes, or foreign keys", async () => {
    const index = migrationIndex();
    expect(index).toBeGreaterThan(0);
    await applyD1Migrations(
      testEnv.MealPlannerDatabase,
      testEnv.TEST_MIGRATIONS.slice(0, index),
      "d1_migrations"
    );
    await insertBatch(testEnv.MealPlannerDatabase);
    await insertCandidate(testEnv.MealPlannerDatabase);
    await testEnv.MealPlannerDatabase.batch([
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_batch_items (
           id, batch_id, idempotency_key, source_kind, source_canonical_id,
           delivery_mode, correlation_json, status, failure_code,
           attempt_count, import_id, canonical_source_id, import_status_json,
           disposition, created_at, updated_at
         ) VALUES (
           ?, ?, 'retained-key', 'tiktok', '7520000000000002602',
           'ordinary', NULL, 'succeeded', NULL, 1,
           '018f47ad-91aa-7c35-b6fe-000000002698',
           '7520000000000002602', '{"kind":"queued"}', 'created', ?, ?
         )`
      ).bind(retainedItemId, batchId, timestamp, timestamp),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_batch_items (
           id, batch_id, idempotency_key, source_kind, source_canonical_id,
           delivery_mode, correlation_json, status, failure_code,
           attempt_count, import_id, canonical_source_id, import_status_json,
           disposition, created_at, updated_at
         ) VALUES (
           ?, ?, 'dead-letter-key', 'tiktok', '7520000000000002603',
           'ordinary', NULL, 'failed', 'workflow_start_unavailable', 3,
           NULL, NULL, NULL, NULL, ?, ?
         )`
      ).bind(deadLetterItemId, batchId, timestamp, timestamp),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_dead_letters (
           item_id, failure_code, correlation_json, replay_state,
           replay_claim_id, replay_claim_expires_at_epoch_milliseconds,
           replay_import_json, created_at, updated_at
         ) VALUES (
           ?, 'workflow_start_unavailable', '{"retained":true}', 'ready',
           NULL, NULL, NULL, ?, ?
         )`
      ).bind(deadLetterItemId, timestamp, timestamp),
    ]);

    await expect(
      settleCanonicalDuplicate(testEnv.MealPlannerDatabase)
    ).rejects.toThrow(/CHECK constraint failed/u);

    const migration = testEnv.TEST_MIGRATIONS[index];
    if (migration === undefined) {
      throw new Error(`Missing ${migrationName}`);
    }
    await applyD1Migrations(
      testEnv.MealPlannerDatabase,
      [migration],
      "d1_migrations"
    );
    await settleCanonicalDuplicate(testEnv.MealPlannerDatabase);

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT id, status, disposition
           FROM import_batch_items
          ORDER BY id`
      ).all()
    ).resolves.toMatchObject({
      results: [
        {
          disposition: "canonical_duplicate",
          id: candidateItemId,
          status: "succeeded",
        },
        { disposition: "created", id: retainedItemId, status: "succeeded" },
        { disposition: null, id: deadLetterItemId, status: "failed" },
      ],
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "SELECT item_id FROM import_dead_letters WHERE item_id = ?"
      )
        .bind(deadLetterItemId)
        .first()
    ).resolves.toEqual({ item_id: deadLetterItemId });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'index' AND name = 'import_batch_items_batch_id_idx'`
      ).first()
    ).resolves.toEqual({ name: "import_batch_items_batch_id_idx" });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "PRAGMA foreign_key_list(import_dead_letters)"
      ).all<{ readonly table: string }>()
    ).resolves.toMatchObject({
      results: [expect.objectContaining({ table: "import_batch_items" })],
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare("PRAGMA foreign_key_check").all()
    ).resolves.toMatchObject({ results: [] });
  });
});
