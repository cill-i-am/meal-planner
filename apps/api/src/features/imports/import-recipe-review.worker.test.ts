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

describe("provider-free D1 recipe review boundary", () => {
  it("does not install household review or Recipe Bank authority in shared D1", async () => {
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT name
           FROM sqlite_schema
          WHERE name LIKE 'recipe_review%'
             OR name LIKE 'approved_recipe%'
          ORDER BY name`
      ).all()
    ).resolves.toMatchObject({ results: [] });
  });
});
