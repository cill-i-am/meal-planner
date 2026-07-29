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

describe("recipe terminal projection migration", () => {
  it("preserves retained children and backfills an existing recipe checkpoint", async () => {
    const migrationIndex = testEnv.TEST_MIGRATIONS.findIndex(
      ({ name }) => name === "0016_recipe_terminal_projection.sql"
    );
    expect(migrationIndex).toBeGreaterThan(0);
    await applyD1Migrations(
      testEnv.MealPlannerDatabase,
      testEnv.TEST_MIGRATIONS.slice(0, migrationIndex),
      "d1_migrations"
    );

    const importId = "00000000-0000-4000-8000-000000000222";
    const timestamp = "2026-07-29T18:00:00.000Z";
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_imports (
         acquisition_generation, canonical_source_id,
         compatibility_fingerprint, created_at, evidence_references_json, id,
         recovery_action, source_kind, status, status_code, updated_at
       ) VALUES (1, 'retained-recipe', ?, ?, '[]', ?, NULL, 'tiktok_video',
                 'queued', NULL, ?)`
    )
      .bind("f".repeat(64), timestamp, importId, timestamp)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_requests (
         created_at, idempotency_key_hash, import_id, request_fingerprint,
         source_locator_hash
       ) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(timestamp, "a".repeat(64), importId, "b".repeat(64), "c".repeat(64))
      .run();
    const ownershipId = "d".repeat(64);
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, created_at, updated_at
       ) VALUES (?, ?, 1, ?, 'cloudflare-workers-ai', 'recipe-model',
                 'installed-v1', 'dispatching', ?, ?)`
    )
      .bind(ownershipId, importId, "e".repeat(64), timestamp, timestamp)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_provider_terminal_checkpoints (
         import_id, acquisition_generation, provider_stage, ownership_id,
         failure_code, completed_at, created_at
       ) VALUES (?, 1, 'recipe', ?, 'retry_exhausted', ?, ?)`
    )
      .bind(importId, ownershipId, timestamp, timestamp)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_transcriptions (
         import_id, acquisition_generation, dispatch_id, source_media_sha256,
         state, failure_code, created_at, updated_at, completed_at
       ) VALUES (?, 1, 'retained-speech', ?, 'failed',
                 'transcription_failed', ?, ?, ?)`
    )
      .bind(importId, "1".repeat(64), timestamp, timestamp, timestamp)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_visual_evidence (
         import_id, acquisition_generation, dispatch_id, source_media_sha256,
         state, failure_code, created_at, updated_at, completed_at
       ) VALUES (?, 1, 'retained-visual', ?, 'failed',
                 'visual_evidence_failed', ?, ?, ?)`
    )
      .bind(importId, "2".repeat(64), timestamp, timestamp, timestamp)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_carousel_evidence (
         import_id, acquisition_generation, descriptor_fingerprint,
         dispatch_id, state, failure_code, recovery_action, created_at,
         updated_at, completed_at
       ) VALUES (?, 1, ?, 'retained-carousel', 'failed',
                 'carousel_inaccessible', 'check_source_visibility', ?, ?, ?)`
    )
      .bind(importId, "3".repeat(64), timestamp, timestamp, timestamp)
      .run();

    for (const dispatchId of [
      "retained-recovery-original",
      "retained-recovery-original:recovery:1",
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Retained migration fixtures must be created in dependency order.
      await testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO pilot_provider_budget_dispatches (
           runtime_stage, dispatch_id, run_id, provider_stage_id,
           maximum_cost_micro_usd, state, created_at, updated_at
         ) VALUES (
           'pilot-gaia-118', ?, 'retained-migration', 'visual-evidence',
           1, 'reserved', ?, ?
         )`
      )
        .bind(dispatchId, timestamp, timestamp)
        .run();
    }
    const recoveryTriggerNames = [
      "pilot_provider_speech_recoveries_prepare",
      "pilot_provider_visual_recoveries_prepare",
      "pilot_provider_visual_second_recoveries_prepare",
    ] as const;
    const recoveryTriggers = await Promise.all(
      recoveryTriggerNames.map(async (name) => {
        const row = await testEnv.MealPlannerDatabase.prepare(
          `SELECT sql FROM sqlite_master
            WHERE type = 'trigger' AND name = ?`
        )
          .bind(name)
          .first<{ readonly sql: string }>();
        if (row === null) {
          throw new Error(`Missing retained-data trigger ${name}`);
        }
        await testEnv.MealPlannerDatabase.prepare(`DROP TRIGGER ${name}`).run();
        return row.sql;
      })
    );
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_speech_recoveries (
         runtime_stage, import_id, acquisition_generation,
         original_dispatch_id, recovery_dispatch_id, created_at
       ) VALUES (
         'pilot-gaia-118', ?, 1, 'retained-recovery-original',
         'retained-speech-recovery', ?
       )`
    )
      .bind(importId, timestamp)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_visual_recoveries (
         runtime_stage, import_id, acquisition_generation,
         original_dispatch_id, recovery_dispatch_id, created_at
       ) VALUES (
         'pilot-gaia-118', ?, 1, 'retained-recovery-original',
         'retained-recovery-original:recovery:1', ?
       )`
    )
      .bind(importId, timestamp)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_visual_second_recoveries (
         runtime_stage, import_id, acquisition_generation,
         original_dispatch_id, first_recovery_dispatch_id,
         recovery_dispatch_id, created_at
       ) VALUES (
         'pilot-gaia-118', ?, 1, 'retained-recovery-original',
         'retained-recovery-original:recovery:1',
         'retained-recovery-original:recovery:2', ?
       )`
    )
      .bind(importId, timestamp)
      .run();
    for (const triggerSql of recoveryTriggers) {
      // eslint-disable-next-line no-await-in-loop -- D1 triggers must be restored in their declared order.
      await testEnv.MealPlannerDatabase.prepare(triggerSql).run();
    }

    const directChildren = [
      "import_carousel_evidence",
      "import_provider_terminal_checkpoints",
      "import_recipe_extractions",
      "import_requests",
      "import_transcriptions",
      "import_visual_evidence",
      "pilot_provider_speech_recoveries",
      "pilot_provider_visual_recoveries",
      "pilot_provider_visual_second_recoveries",
    ] as const;

    const migration = testEnv.TEST_MIGRATIONS[migrationIndex];
    if (migration === undefined) {
      throw new Error("Missing recipe terminal projection migration");
    }
    await testEnv.MealPlannerDatabase.batch(
      migration.queries.map((query) =>
        testEnv.MealPlannerDatabase.prepare(query)
      )
    );

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "SELECT import_id FROM import_requests WHERE import_id = ?"
      )
        .bind(importId)
        .first()
    ).resolves.toEqual({ import_id: importId });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT ownership_id, status, status_code, recovery_action
           FROM import_recipe_terminal_projections
          WHERE import_id = ? AND acquisition_generation = 1`
      )
        .bind(importId)
        .first()
    ).resolves.toEqual({
      ownership_id: ownershipId,
      recovery_action: "operator_reconcile",
      status: "failed",
      status_code: "recipe_extraction_failed",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, failure_code
           FROM import_recipe_extractions
          WHERE extraction_fingerprint = ?`
      )
        .bind(ownershipId)
        .first()
    ).resolves.toEqual({
      failure_code: "provider_error",
      state: "failed",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare("PRAGMA foreign_key_check").all()
    ).resolves.toMatchObject({ results: [] });
    for (const table of directChildren) {
      // eslint-disable-next-line no-await-in-loop -- Sequential table assertions keep each D1 failure attributable.
      await expect(
        testEnv.MealPlannerDatabase.prepare(
          `SELECT count(*) AS count FROM ${table} WHERE import_id = ?`
        )
          .bind(importId)
          .first()
      ).resolves.toEqual({ count: 1 });
    }
  });
});
