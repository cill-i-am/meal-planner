import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: readonly {
    readonly name: string;
    readonly queries: readonly string[];
  }[];
};

const canonicalTables = [
  "import_batch_items",
  "import_batches",
  "import_carousel_evidence",
  "import_dead_letters",
  "import_operational_events",
  "import_provider_terminal_checkpoints",
  "import_recipe_executor_terminal_checkpoints",
  "import_recipe_extractions",
  "import_requests",
  "import_transcriptions",
  "import_visual_evidence",
  "pilot_provider_budget_conservative_settlements",
  "pilot_provider_budget_dispatches",
  "pilot_provider_budget_reconciliations",
  "pilot_provider_recipe_recovery_attempts",
  "pilot_provider_recipe_replay_values",
  "pilot_provider_speech_recoveries",
  "pilot_provider_stage_budget",
  "pilot_provider_visual_recoveries",
  "pilot_provider_visual_second_recoveries",
  "recipe_import_intent_history",
  "recipe_imports",
  "recipe_review_corrections",
  "recipe_review_mutations",
  "recipe_review_transitions",
  "recipe_reviews",
] as const;

describe("canonical recipe import baseline", () => {
  it("creates the exact fresh schema from one migration with valid foreign keys", async () => {
    expect(testEnv.TEST_MIGRATIONS.map(({ name }) => name)).toEqual([
      "0000_recipe_imports.sql",
    ]);

    await applyD1Migrations(
      testEnv.MealPlannerDatabase,
      testEnv.TEST_MIGRATIONS.map(({ name, queries }) => ({
        name,
        queries: [...queries],
      })),
      "d1_migrations"
    );

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT name
           FROM sqlite_schema
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
            AND name NOT LIKE '_cf_%'
            AND name <> 'd1_migrations'
          ORDER BY name`
      ).all()
    ).resolves.toMatchObject({
      results: canonicalTables.map((name) => ({ name })),
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare("PRAGMA foreign_key_check").all()
    ).resolves.toMatchObject({ results: [] });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "PRAGMA foreign_key_list('recipe_review_transitions')"
      ).all()
    ).resolves.toMatchObject({
      results: expect.arrayContaining([
        expect.objectContaining({ table: "recipe_reviews" }),
      ]),
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT budget_cap_micro_usd, reserved_micro_usd,
                runtime_stage, settled_micro_usd, state
           FROM pilot_provider_stage_budget`
      ).all()
    ).resolves.toMatchObject({
      results: [
        {
          budget_cap_micro_usd: 10_000_000,
          reserved_micro_usd: 0,
          runtime_stage: "pilot-gaia-118",
          settled_micro_usd: 0,
          state: "open",
        },
      ],
    });

    const recipeImportColumns = await testEnv.MealPlannerDatabase.prepare(
      "PRAGMA table_info(recipe_imports)"
    ).all<{
      readonly dflt_value: string | null;
      readonly name: string;
      readonly notnull: number;
    }>();
    expect(recipeImportColumns.results).not.toContainEqual(
      expect.objectContaining({ name: "canonical_source_id" })
    );
    expect(recipeImportColumns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "compatibility_fingerprint",
          notnull: 0,
        }),
        expect.objectContaining({ name: "correlation_id", notnull: 1 }),
        expect.objectContaining({
          dflt_value: null,
          name: "household_scope_id",
          notnull: 1,
        }),
        expect.objectContaining({
          dflt_value: null,
          name: "actor_id",
          notnull: 1,
        }),
        expect.objectContaining({
          name: "submitted_source_url",
          notnull: 1,
        }),
        expect.objectContaining({
          name: "resolved_canonical_source_id",
          notnull: 0,
        }),
      ])
    );

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT name
           FROM pragma_table_info('import_recipe_executor_terminal_checkpoints')
          ORDER BY cid`
      ).all()
    ).resolves.toMatchObject({
      results: [
        { name: "acquisition_generation" },
        { name: "evidence_references_json" },
        { name: "import_id" },
        { name: "ownership_id" },
        { name: "checkpointed_at" },
      ],
    });

    const reviewMutationColumns = await testEnv.MealPlannerDatabase.prepare(
      "PRAGMA table_info(recipe_review_mutations)"
    ).all<{ readonly name: string; readonly notnull: number }>();
    expect(reviewMutationColumns.results).toContainEqual(
      expect.objectContaining({ name: "item_count", notnull: 1 })
    );

    const schemaRows = await testEnv.MealPlannerDatabase.prepare(
      `SELECT name, sql
         FROM sqlite_schema
        WHERE name IN (
          'recipe_import_intent_history',
          'recipe_imports_legacy_canonical_identity_unique'
        )
        ORDER BY name`
    ).all<{ readonly name: string; readonly sql: string }>();
    expect(schemaRows.results).toEqual([
      expect.objectContaining({ name: "recipe_import_intent_history" }),
    ]);
    expect(schemaRows.results[0]?.sql).not.toContain("migration_snapshot");
    expect(schemaRows.results[0]?.sql).not.toContain("'migration'");
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT name
           FROM sqlite_schema
          WHERE sql GLOB '*__new_*'`
      ).all()
    ).resolves.toMatchObject({ results: [] });
  });
});
