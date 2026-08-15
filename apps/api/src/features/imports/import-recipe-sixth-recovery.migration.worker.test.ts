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

const replayTriggerNames = [
  "import_recipe_extractions_cleanup_replay_insert",
  "import_recipe_extractions_cleanup_replay_update",
  "pilot_provider_recipe_replay_values_budget_insert_cleanup",
  "pilot_provider_recipe_replay_values_budget_update_cleanup",
  "pilot_provider_recipe_replay_values_expired_cleanup",
  "pilot_provider_recipe_replay_values_guarded_delete",
  "pilot_provider_recipe_replay_values_immutable_update",
] as const;

describe("recipe sixth recovery migration", () => {
  it("preserves an existing replay and extends the immutable identity only through recovery:6", async () => {
    const migrationIndex = testEnv.TEST_MIGRATIONS.findIndex(
      ({ name }) => name === "0022_recipe_sixth_recovery.sql"
    );
    expect(migrationIndex).toBeGreaterThan(0);
    await applyD1Migrations(
      testEnv.MealPlannerDatabase,
      testEnv.TEST_MIGRATIONS.slice(0, migrationIndex),
      "d1_migrations"
    );

    const importId = "00000000-0000-4000-8000-000000000234";
    const evidenceFingerprint = "a".repeat(64);
    const dispatchId = `recipe:${importId}:1:${evidenceFingerprint}`;
    const timestamp = "2026-07-30T10:00:00.000Z";
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_budget_dispatches (
         runtime_stage, dispatch_id, run_id, provider_stage_id,
         maximum_cost_micro_usd, actual_cost_micro_usd, state, created_at,
         updated_at, invocation_started_at, completed_at
       ) VALUES (
         'pilot-gaia-118', ?, 'retained-0021-replay', 'recipe-extraction',
         100000, NULL, 'settled_unknown', ?, ?, ?, ?
       )`
    )
      .bind(dispatchId, timestamp, timestamp, timestamp, timestamp)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_budget_conservative_settlements (
         actual_cost_was_unknown, authority, conservative_charge_micro_usd,
         created_at, dispatch_id, runtime_stage
       ) VALUES (
         1, 'schema_valid_provider_response', 100000, ?, ?,
         'pilot-gaia-118'
       )`
    )
      .bind(timestamp, dispatchId)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_recipe_replay_values (
         created_at, dispatch_id, evidence_fingerprint, expires_at, generation,
         import_id, runtime_stage, value_json, value_sha256
       ) VALUES (
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, ?,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days'), 1, ?,
         'pilot-gaia-118', '{"title":"retained"}', ?
       )`
    )
      .bind(dispatchId, evidenceFingerprint, importId, "b".repeat(64))
      .run();

    const migration = testEnv.TEST_MIGRATIONS[migrationIndex];
    if (migration === undefined) {
      throw new Error("Missing recipe sixth recovery migration");
    }
    await applyD1Migrations(
      testEnv.MealPlannerDatabase,
      [migration],
      "d1_migrations"
    );

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT dispatch_id, value_json
           FROM pilot_provider_recipe_replay_values
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({
      dispatch_id: dispatchId,
      value_json: '{"title":"retained"}',
    });
    const replayTable = await testEnv.MealPlannerDatabase.prepare(
      `SELECT sql
         FROM sqlite_master
        WHERE type = 'table'
          AND name = 'pilot_provider_recipe_replay_values'`
    ).first<{ readonly sql: string }>();
    expect(replayTable?.sql).toContain(":recovery:6");
    expect(replayTable?.sql).not.toContain(":recovery:7");
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT name
           FROM sqlite_master
          WHERE type = 'trigger'
            AND name IN (${replayTriggerNames.map(() => "?").join(", ")})
          ORDER BY name`
      )
        .bind(...replayTriggerNames)
        .all<{ readonly name: string }>()
    ).resolves.toMatchObject({
      results: replayTriggerNames.toSorted().map((name) => ({ name })),
      success: true,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT name
           FROM sqlite_master
          WHERE type = 'table'
            AND name = 'pilot_provider_recipe_sixth_recoveries'`
      ).first()
    ).resolves.toEqual({
      name: "pilot_provider_recipe_sixth_recoveries",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare("PRAGMA foreign_key_check").all()
    ).resolves.toMatchObject({ results: [] });
  });
});
