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

const migrationName = "0027_recipe_review_mutation_ledger.sql";
const importId = "018f47ad-91aa-7c35-b6fe-000000002700";
const extractionFingerprint = "d".repeat(64);
const timestamp = "2026-08-16T00:00:00.000Z";
const tagsJson = JSON.stringify({
  cuisines: ["Irish"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["dinner"],
  totalTimeBand: "30_to_60_minutes",
});

describe("recipe review mutation ledger migration", () => {
  it("upgrades populated historical review state without fabricating mutation identities", async () => {
    const migrationIndex = testEnv.TEST_MIGRATIONS.findIndex(
      ({ name }) => name === migrationName
    );
    expect(migrationIndex).toBeGreaterThan(0);
    await applyD1Migrations(
      testEnv.MealPlannerDatabase,
      testEnv.TEST_MIGRATIONS.slice(0, migrationIndex),
      "d1_migrations"
    );

    const evidence = JSON.stringify([
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
    await testEnv.MealPlannerDatabase.batch([
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_imports (
           id, acquisition_generation, canonical_source_id,
           compatibility_fingerprint, created_at, evidence_references_json,
           recovery_action, source_kind, status, status_code, updated_at
         ) VALUES (?, 1, '752000000000002700', ?, ?, ?, NULL,
                   'tiktok', 'transcribed', NULL, ?)`
      ).bind(importId, "c".repeat(64), timestamp, evidence, timestamp),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_recipe_extractions (
           extraction_fingerprint, import_id, acquisition_generation,
           evidence_fingerprint, extractor_provider, extractor_model,
           extractor_version, state, draft_json, failure_code,
           input_evidence_items, input_tokens, output_tokens, model_calls,
           latency_milliseconds, estimated_cost_micro_usd, cost_currency,
           cost_certainty, is_current, created_at, updated_at, completed_at
         ) VALUES (?, ?, 1, ?, 'deterministic_fake', 'fixture-v1', 'schema-1',
                   'needs_review', '{}', NULL, 1, 0, 0, 1, 0, 0, 'USD',
                   'known', 1, ?, ?, ?)`
      ).bind(
        extractionFingerprint,
        importId,
        "e".repeat(64),
        timestamp,
        timestamp,
        timestamp
      ),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_reviews (
           extraction_fingerprint, lifecycle, version, tags_json,
           last_mutation_id, created_at, updated_at
         ) VALUES (?, 'rejected', 2, ?, 'historical-transition', ?, ?)`
      ).bind(extractionFingerprint, tagsJson, timestamp, timestamp),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_review_corrections (
           extraction_fingerprint, version, actor_id, field, before_json,
           after_json, reason, tags_before_json, tags_after_json, corrected_at
         ) VALUES (?, 1, 'private_api_credential', 'name', 'null',
                   '"Historical Stew"', 'Historical correction.', 'null', ?, ?)`
      ).bind(extractionFingerprint, tagsJson, timestamp),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_review_transitions (
           extraction_fingerprint, version, actor_id, from_lifecycle,
           to_lifecycle, reason, transitioned_at
         ) VALUES (?, 2, 'private_api_credential', 'needs_review', 'rejected',
                   'Historical rejection.', ?)`
      ).bind(extractionFingerprint, timestamp),
    ]);

    const migration = testEnv.TEST_MIGRATIONS[migrationIndex];
    if (migration === undefined) {
      throw new Error(`Missing ${migrationName}`);
    }
    await applyD1Migrations(
      testEnv.MealPlannerDatabase,
      [migration],
      "d1_migrations"
    );

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT extraction_fingerprint, lifecycle, version, tags_json,
                created_at, updated_at
           FROM recipe_reviews
          WHERE extraction_fingerprint = ?`
      )
        .bind(extractionFingerprint)
        .first()
    ).resolves.toEqual({
      created_at: timestamp,
      extraction_fingerprint: extractionFingerprint,
      lifecycle: "rejected",
      tags_json: tagsJson,
      updated_at: timestamp,
      version: 2,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT extraction_fingerprint, version, actor_id, field, before_json,
                after_json, reason, tags_before_json, tags_after_json,
                corrected_at
           FROM recipe_review_corrections
          WHERE extraction_fingerprint = ?`
      )
        .bind(extractionFingerprint)
        .all()
    ).resolves.toMatchObject({
      results: [
        {
          actor_id: "private_api_credential",
          after_json: '"Historical Stew"',
          before_json: "null",
          corrected_at: timestamp,
          extraction_fingerprint: extractionFingerprint,
          field: "name",
          reason: "Historical correction.",
          tags_after_json: tagsJson,
          tags_before_json: "null",
          version: 1,
        },
      ],
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT extraction_fingerprint, version, actor_id, from_lifecycle,
                to_lifecycle, reason, transitioned_at
           FROM recipe_review_transitions
          WHERE extraction_fingerprint = ?`
      )
        .bind(extractionFingerprint)
        .all()
    ).resolves.toMatchObject({
      results: [
        {
          actor_id: "private_api_credential",
          extraction_fingerprint: extractionFingerprint,
          from_lifecycle: "needs_review",
          reason: "Historical rejection.",
          to_lifecycle: "rejected",
          transitioned_at: timestamp,
          version: 2,
        },
      ],
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "SELECT count(*) AS count FROM recipe_review_mutations"
      ).first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "PRAGMA table_info(recipe_reviews)"
      ).all<{ readonly name: string }>()
    ).resolves.not.toMatchObject({
      results: expect.arrayContaining([{ name: "last_mutation_id" }]),
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "PRAGMA foreign_key_list(recipe_review_corrections)"
      ).all<{ readonly table: string }>()
    ).resolves.toMatchObject({
      results: [expect.objectContaining({ table: "recipe_reviews" })],
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "PRAGMA foreign_key_list(recipe_review_mutations)"
      ).all<{ readonly table: string }>()
    ).resolves.toMatchObject({
      results: [expect.objectContaining({ table: "recipe_reviews" })],
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare("PRAGMA foreign_key_check").all()
    ).resolves.toMatchObject({ results: [] });
  });
});
