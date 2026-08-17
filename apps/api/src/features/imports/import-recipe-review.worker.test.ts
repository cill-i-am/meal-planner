import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

describe("provider-free D1 recipe review tracer", () => {
  it("installs the fresh review schema with only the durable mutation ledger identity", async () => {
    const reviewColumns = await testEnv.MealPlannerDatabase.prepare(
      "PRAGMA table_info(recipe_reviews)"
    ).all<{ readonly name: string }>();
    expect(
      reviewColumns.results.map((row: { readonly name: string }) => row.name)
    ).not.toContain("last_mutation_id");

    const mutationColumns = await testEnv.MealPlannerDatabase.prepare(
      "PRAGMA table_info(recipe_review_mutations)"
    ).all<{ readonly name: string }>();
    expect(
      mutationColumns.results.map((row: { readonly name: string }) => row.name)
    ).toEqual([
      "extraction_fingerprint",
      "mutation_id",
      "command_kind",
      "command_digest",
      "resulting_version",
      "applied_at",
      "item_count",
    ]);
  });
});
