import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

const migrationName = "0028_recipe_recovery_attempt_ledger.sql";
const runtimeStage = "pilot-gaia-118";

const legacyTables = [
  "pilot_provider_recipe_recoveries",
  "pilot_provider_recipe_second_recoveries",
  "pilot_provider_recipe_third_recoveries",
  "pilot_provider_recipe_fourth_recoveries",
  "pilot_provider_recipe_fifth_recoveries",
  "pilot_provider_recipe_sixth_recoveries",
  "pilot_provider_recipe_seventh_recoveries",
  "pilot_provider_recipe_eighth_recoveries",
] as const;

const ordinalWords = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
] as const;

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

interface HistoricalChain {
  readonly currentDispatchIds: readonly string[];
  readonly currentExtractionFingerprints: readonly string[];
  readonly importId: string;
  readonly rootDispatchId: string;
  readonly rootExtractionFingerprint: string;
  readonly sourceSha256: string;
}

const applyPreLedgerMigrations = async () => {
  const migrationIndex = testEnv.TEST_MIGRATIONS.findIndex(
    ({ name }) => name === migrationName
  );
  expect(migrationIndex).toBeGreaterThan(0);
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    testEnv.TEST_MIGRATIONS.slice(0, migrationIndex),
    "d1_migrations"
  );
  return migrationIndex;
};

const seedHistoricalChain = async (): Promise<HistoricalChain> => {
  const database = testEnv.MealPlannerDatabase;
  const importId = "00000000-0000-4000-8000-000000000209";
  const timestamp = "2026-08-09T09:00:00.000Z";
  const evidenceFingerprint = "b".repeat(64);
  const rootExtractionFingerprint = "a".repeat(64);
  const rootDispatchId = `recipe:${importId}:1:${evidenceFingerprint}`;
  const transcriptSha256 = "c".repeat(64);
  const visualManifestSha256 = "d".repeat(64);
  const sourceSha256 = "e".repeat(64);
  const evidenceReferencesJson = JSON.stringify([
    {
      kind: "original_media",
      referenceId: `imports/${importId}/acquisition/v1/generations/1/original.mp4`,
    },
    {
      kind: "acquisition_manifest",
      referenceId: `imports/${importId}/acquisition/v1/generations/1/manifest.json`,
    },
    {
      kind: "speech_transcript",
      referenceId: `imports/${importId}/transcription/v1/generations/1/transcript.json`,
    },
  ]);

  await database.batch([
    database
      .prepare(
        `INSERT INTO recipe_imports (
           acquisition_generation, canonical_source_id,
           compatibility_fingerprint, created_at, evidence_references_json, id,
           recovery_action, source_kind, status, status_code, updated_at
         ) VALUES (
           1, 's09-historical-chain', ?, ?, ?, ?, NULL, 'tiktok_video',
           'transcribed', NULL, ?
         )`
      )
      .bind(
        "f".repeat(64),
        timestamp,
        evidenceReferencesJson,
        importId,
        timestamp
      ),
    database
      .prepare(
        `INSERT INTO import_transcriptions (
           import_id, acquisition_generation, dispatch_id, source_media_sha256,
           state, transcript_key, transcript_sha256, provider, model,
           detected_language, usage_audio_milliseconds, usage_input_bytes,
           estimated_cost_micro_usd, cost_currency, cost_certainty,
           segments_count, failure_code, created_at, updated_at, completed_at
         ) VALUES (
           ?, 1, ?, ?, 'transcribed', ?, ?, 'cloudflare-workers-ai',
           'speech-model', 'en', 1000, 100, 1, 'USD', 'known', 1, NULL,
           ?, ?, ?
         )`
      )
      .bind(
        importId,
        `speech:${importId}:1`,
        sourceSha256,
        `imports/${importId}/transcription/v1/generations/1/transcript.json`,
        transcriptSha256,
        timestamp,
        timestamp,
        timestamp
      ),
    database
      .prepare(
        `INSERT INTO import_visual_evidence (
           import_id, acquisition_generation, dispatch_id, source_media_sha256,
           state, outcome, manifest_key, manifest_sha256, provider, model,
           input_frames, input_bytes, model_calls, estimated_cost_micro_usd,
           cost_currency, cost_certainty, observations_count, failure_code,
           created_at, updated_at, completed_at
         ) VALUES (
           ?, 1, ?, ?, 'completed', 'found', ?, ?,
           'cloudflare-workers-ai', 'visual-model', 1, 100, 1, 1, 'USD',
           'known', 1, NULL, ?, ?, ?
         )`
      )
      .bind(
        importId,
        `visual:${importId}:1:evidence`,
        sourceSha256,
        `imports/${importId}/visual/v1/generations/1/manifest.json`,
        visualManifestSha256,
        timestamp,
        timestamp,
        timestamp
      ),
    database
      .prepare(
        `INSERT INTO import_recipe_extractions (
           extraction_fingerprint, import_id, acquisition_generation,
           evidence_fingerprint, extractor_provider, extractor_model,
           extractor_version, state, failure_code, completed_at, created_at,
           updated_at
         ) VALUES (
           ?, ?, 1, ?, 'cloudflare-workers-ai', 'recipe-model',
           'installed-v1', 'failed', 'provider_error', ?, ?, ?
         )`
      )
      .bind(
        rootExtractionFingerprint,
        importId,
        evidenceFingerprint,
        timestamp,
        timestamp,
        timestamp
      ),
    database
      .prepare(
        `INSERT INTO pilot_provider_budget_dispatches (
           runtime_stage, dispatch_id, run_id, provider_stage_id,
           maximum_cost_micro_usd, actual_cost_micro_usd, state, created_at,
           updated_at, invocation_started_at, completed_at
         ) VALUES (
           ?, ?, ?, 'recipe-extraction', 100000, NULL, 'settled_unknown',
           ?, ?, ?, ?
         )`
      )
      .bind(
        runtimeStage,
        rootDispatchId,
        `gaia-118:${importId}`,
        timestamp,
        timestamp,
        timestamp,
        timestamp
      ),
    database
      .prepare(
        `INSERT INTO pilot_provider_budget_reconciliations (
           runtime_stage, dispatch_id, conservative_charge_micro_usd,
           actual_cost_was_unknown, authority, created_at
         ) VALUES (?, ?, 100000, 1, 'authenticated_operator', ?)`
      )
      .bind(runtimeStage, rootDispatchId, timestamp),
    database
      .prepare(
        `UPDATE pilot_provider_stage_budget
            SET settled_micro_usd = 100000, reserved_micro_usd = 0,
                state = 'open', invoking_dispatch_id = NULL,
                poison_dispatch_id = NULL, updated_at = ?
          WHERE runtime_stage = ?`
      )
      .bind(timestamp, runtimeStage),
    database
      .prepare(
        `INSERT INTO import_provider_terminal_checkpoints (
           import_id, acquisition_generation, provider_stage, ownership_id,
           failure_code, completed_at, created_at
         ) VALUES (?, 1, 'recipe', ?, 'outcome_unknown', ?, ?)`
      )
      .bind(importId, rootExtractionFingerprint, timestamp, timestamp),
  ]);

  const currentDispatchIds = Array.from(
    { length: 8 },
    (_, index) => `${rootDispatchId}:recovery:${index + 1}`
  );
  const currentExtractionFingerprints = Array.from({ length: 8 }, (_, index) =>
    String(index + 1).repeat(64)
  );

  for (let index = 0; index < legacyTables.length; index += 1) {
    const ordinal = index + 1;
    const table = legacyTables[index];
    const currentDispatchId = currentDispatchIds[index];
    const currentExtractionFingerprint = currentExtractionFingerprints[index];
    if (
      table === undefined ||
      currentDispatchId === undefined ||
      currentExtractionFingerprint === undefined
    ) {
      throw new Error("Invalid historical recovery fixture");
    }
    const createdAt = `2026-08-09T09:${String(ordinal).padStart(2, "0")}:00.000Z`;
    if (ordinal === 1) {
      // eslint-disable-next-line no-await-in-loop -- The first immutable ordinal must exist before any descendant is seeded.
      await database
        .prepare(
          `INSERT INTO pilot_provider_recipe_recoveries (
             runtime_stage, import_id, acquisition_generation,
             recovery_ordinal, recovery_identity, original_dispatch_id,
             recovery_dispatch_id, evidence_fingerprint,
             original_extraction_fingerprint,
             recovery_extraction_fingerprint, transcript_sha256,
             visual_manifest_sha256, evidence_references_json, created_at
           ) VALUES (?, ?, 1, 1, 'recovery:1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          runtimeStage,
          importId,
          rootDispatchId,
          currentDispatchId,
          evidenceFingerprint,
          rootExtractionFingerprint,
          currentExtractionFingerprint,
          transcriptSha256,
          visualManifestSha256,
          evidenceReferencesJson,
          createdAt
        )
        .run();
    } else {
      const predecessorWord = ordinalWords[index - 1];
      const historicalDispatchColumns = ordinalWords
        .slice(0, index)
        .map((word) => `${word}_recovery_dispatch_id`);
      if (predecessorWord === undefined) {
        throw new Error("Missing predecessor word");
      }
      const columns = [
        "runtime_stage",
        "import_id",
        "acquisition_generation",
        "original_dispatch_id",
        ...historicalDispatchColumns,
        "recovery_dispatch_id",
        "evidence_fingerprint",
        `${predecessorWord}_recovery_extraction_fingerprint`,
        "recovery_extraction_fingerprint",
        "transcript_sha256",
        "visual_manifest_sha256",
        "evidence_references_json",
        "created_at",
      ];
      const values = [
        runtimeStage,
        importId,
        1,
        rootDispatchId,
        ...currentDispatchIds.slice(0, index),
        currentDispatchId,
        evidenceFingerprint,
        currentExtractionFingerprints[index - 1],
        currentExtractionFingerprint,
        transcriptSha256,
        visualManifestSha256,
        evidenceReferencesJson,
        createdAt,
      ];
      // eslint-disable-next-line no-await-in-loop -- Each legacy ordinal has a foreign-key ancestry dependency on the preceding ordinal.
      await database
        .prepare(
          `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns
            .map(() => "?")
            .join(", ")})`
        )
        .bind(...values)
        .run();
    }

    if (ordinal < 8) {
      // eslint-disable-next-line no-await-in-loop -- The terminal truth for ordinal N must exist before the ordinal N+1 fixture is admitted.
      await database.batch([
        database
          .prepare(
            `INSERT INTO import_recipe_extractions (
               extraction_fingerprint, import_id, acquisition_generation,
               evidence_fingerprint, extractor_provider, extractor_model,
               extractor_version, state, failure_code, completed_at,
               created_at, updated_at
             ) VALUES (
               ?, ?, 1, ?, 'cloudflare-workers-ai', 'recipe-model',
               'installed-v1', 'failed', 'provider_error', ?, ?, ?
             )`
          )
          .bind(
            currentExtractionFingerprint,
            importId,
            evidenceFingerprint,
            createdAt,
            createdAt,
            createdAt
          ),
        database
          .prepare(
            `INSERT INTO pilot_provider_budget_dispatches (
               runtime_stage, dispatch_id, run_id, provider_stage_id,
               maximum_cost_micro_usd, actual_cost_micro_usd, state,
               created_at, updated_at, invocation_started_at, completed_at
             ) VALUES (
               ?, ?, ?, 'recipe-extraction', 100000, NULL, 'settled_unknown',
               ?, ?, ?, ?
             )`
          )
          .bind(
            runtimeStage,
            currentDispatchId,
            `gaia-118:recipe-recovery:${importId}`,
            createdAt,
            createdAt,
            createdAt,
            createdAt
          ),
        database
          .prepare(
            `INSERT INTO pilot_provider_budget_reconciliations (
               runtime_stage, dispatch_id, conservative_charge_micro_usd,
               actual_cost_was_unknown, authority, created_at
             ) VALUES (?, ?, 100000, 1, 'authenticated_operator', ?)`
          )
          .bind(runtimeStage, currentDispatchId, createdAt),
        database
          .prepare(
            `UPDATE pilot_provider_stage_budget
                SET settled_micro_usd = settled_micro_usd + 100000,
                    reserved_micro_usd = 0,
                    updated_at = ?
              WHERE runtime_stage = ?`
          )
          .bind(createdAt, runtimeStage),
      ]);
    }
  }

  return {
    currentDispatchIds,
    currentExtractionFingerprints,
    importId,
    rootDispatchId,
    rootExtractionFingerprint,
    sourceSha256,
  };
};

const applyLedgerMigration = async (migrationIndex: number) => {
  const migration = testEnv.TEST_MIGRATIONS[migrationIndex];
  if (migration === undefined) {
    throw new Error(`Missing ${migrationName}`);
  }
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [migration],
    "d1_migrations"
  );
};

describe("recipe recovery attempt ledger migration", () => {
  it("rejects gapped history atomically, then preserves all eight valid attempts", async () => {
    const migrationIndex = await applyPreLedgerMigrations();
    const chain = await seedHistoricalChain();
    const [, skippedPredecessor, correctPredecessor] =
      chain.currentExtractionFingerprints;
    if (skippedPredecessor === undefined || correctPredecessor === undefined) {
      throw new Error("Historical recovery fixture is incomplete");
    }

    await testEnv.MealPlannerDatabase.prepare(
      "DROP TRIGGER pilot_provider_recipe_fourth_recoveries_immutable_update"
    ).run();
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_recipe_fourth_recoveries
          SET third_recovery_extraction_fingerprint = ?
        WHERE import_id = ?`
    )
      .bind(skippedPredecessor, chain.importId)
      .run();

    await expect(applyLedgerMigration(migrationIndex)).rejects.toThrow();

    const failedLedger = await testEnv.MealPlannerDatabase.prepare(
      `SELECT name
         FROM sqlite_master
        WHERE type = 'table'
          AND name = 'pilot_provider_recipe_recovery_attempts'`
    ).first();
    if (failedLedger !== null) {
      await expect(
        testEnv.MealPlannerDatabase.prepare(
          "SELECT count(*) AS attempt_count FROM pilot_provider_recipe_recovery_attempts"
        ).first()
      ).resolves.toEqual({ attempt_count: 0 });
    }
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT count(*) AS legacy_count
           FROM sqlite_master
          WHERE type = 'table'
            AND name IN (${legacyTables.map(() => "?").join(", ")})`
      )
        .bind(...legacyTables)
        .first()
    ).resolves.toEqual({ legacy_count: 8 });

    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_recipe_fourth_recoveries
          SET third_recovery_extraction_fingerprint = ?
        WHERE import_id = ?`
    )
      .bind(correctPredecessor, chain.importId)
      .run();
    await applyLedgerMigration(migrationIndex);

    const rows = await testEnv.MealPlannerDatabase.prepare(
      `SELECT recovery_ordinal, root_dispatch_id, predecessor_dispatch_id,
              current_dispatch_id, root_extraction_fingerprint,
              predecessor_extraction_fingerprint,
              current_extraction_fingerprint, source_media_sha256
         FROM pilot_provider_recipe_recovery_attempts
        WHERE runtime_stage = ? AND import_id = ?
          AND acquisition_generation = 1
        ORDER BY recovery_ordinal`
    )
      .bind(runtimeStage, chain.importId)
      .all();
    expect(rows.results).toEqual(
      chain.currentDispatchIds.map((currentDispatchId, index) => ({
        current_dispatch_id: currentDispatchId,
        current_extraction_fingerprint:
          chain.currentExtractionFingerprints[index],
        predecessor_dispatch_id:
          index === 0
            ? chain.rootDispatchId
            : chain.currentDispatchIds[index - 1],
        predecessor_extraction_fingerprint:
          index === 0
            ? chain.rootExtractionFingerprint
            : chain.currentExtractionFingerprints[index - 1],
        recovery_ordinal: index + 1,
        root_dispatch_id: chain.rootDispatchId,
        root_extraction_fingerprint: chain.rootExtractionFingerprint,
        source_media_sha256: chain.sourceSha256,
      }))
    );
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT recovery_ordinal, count(*) AS attempt_count
           FROM pilot_provider_recipe_recovery_attempts
          WHERE import_id = ?
          GROUP BY recovery_ordinal
          ORDER BY recovery_ordinal`
      )
        .bind(chain.importId)
        .all()
    ).resolves.toMatchObject({
      results: Array.from({ length: 8 }, (_, index) => ({
        attempt_count: 1,
        recovery_ordinal: index + 1,
      })),
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare("PRAGMA foreign_key_check").all()
    ).resolves.toMatchObject({ results: [] });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_recipe_recovery_attempts
            SET created_at = created_at
          WHERE import_id = ?`
      )
        .bind(chain.importId)
        .run()
    ).rejects.toThrow(/immutable/iu);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `DELETE FROM pilot_provider_recipe_recovery_attempts
          WHERE import_id = ?`
      )
        .bind(chain.importId)
        .run()
    ).rejects.toThrow(/immutable/iu);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT name
           FROM sqlite_master
          WHERE type = 'table'
            AND name IN (${legacyTables.map(() => "?").join(", ")})`
      )
        .bind(...legacyTables)
        .all()
    ).resolves.toMatchObject({ results: [] });
  });
});
