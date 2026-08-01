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

describe("recipe terminal truth migration", () => {
  it("backfills one exact checkpoint and projection for a durable failed recipe", async () => {
    const migrationIndex = testEnv.TEST_MIGRATIONS.findIndex(
      ({ name }) => name === "0025_recipe_terminal_truth.sql"
    );
    expect(migrationIndex).toBeGreaterThan(0);
    await applyD1Migrations(
      testEnv.MealPlannerDatabase,
      testEnv.TEST_MIGRATIONS.slice(0, migrationIndex),
      "d1_migrations"
    );

    const importId = "00000000-0000-4000-8000-000000000241";
    const createdAt = "2026-08-01T10:00:00.000Z";
    const completedAt = "2026-08-01T10:00:30.000Z";
    const ownershipId = "9".repeat(64);
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_imports (
         acquisition_generation, canonical_source_id,
         compatibility_fingerprint, created_at, evidence_references_json, id,
         recovery_action, source_kind, status, status_code, updated_at
       ) VALUES (1, 'terminal-truth', ?, ?, '[]', ?, NULL, 'tiktok_video',
                 'queued', NULL, ?)`
    )
      .bind("8".repeat(64), createdAt, importId, createdAt)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, failure_code, completed_at, created_at,
         updated_at
       ) VALUES (?, ?, 1, ?, 'cloudflare-workers-ai', 'recipe-model',
                 'installed-v1', 'failed', 'invalid_schema', ?, ?, ?)`
    )
      .bind(
        ownershipId,
        importId,
        "7".repeat(64),
        completedAt,
        createdAt,
        completedAt
      )
      .run();

    const migration = testEnv.TEST_MIGRATIONS[migrationIndex];
    if (migration === undefined) {
      throw new Error("Missing recipe terminal truth migration");
    }
    await testEnv.MealPlannerDatabase.batch(
      migration.queries.map((query) =>
        testEnv.MealPlannerDatabase.prepare(query)
      )
    );

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT ownership_id, failure_code, completed_at
           FROM import_provider_terminal_checkpoints
          WHERE import_id = ? AND provider_stage = 'recipe'`
      )
        .bind(importId)
        .first()
    ).resolves.toEqual({
      completed_at: completedAt,
      failure_code: "invalid_schema",
      ownership_id: ownershipId,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT ownership_id, projected_at, status, status_code
           FROM import_recipe_terminal_projections
          WHERE import_id = ? AND acquisition_generation = 1`
      )
        .bind(importId)
        .first()
    ).resolves.toEqual({
      ownership_id: ownershipId,
      projected_at: completedAt,
      status: "failed",
      status_code: "recipe_extraction_failed",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare("PRAGMA foreign_key_check").all()
    ).resolves.toMatchObject({ results: [] });

    await testEnv.MealPlannerDatabase.batch(
      migration.queries.map((query) =>
        testEnv.MealPlannerDatabase.prepare(query)
      )
    );
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT
           (SELECT count(*) FROM import_provider_terminal_checkpoints
             WHERE import_id = ? AND provider_stage = 'recipe') AS checkpoints,
           (SELECT count(*) FROM import_recipe_terminal_projections
             WHERE import_id = ? AND acquisition_generation = 1) AS projections`
      )
        .bind(importId, importId)
        .first()
    ).resolves.toEqual({ checkpoints: 1, projections: 1 });
  });
});
