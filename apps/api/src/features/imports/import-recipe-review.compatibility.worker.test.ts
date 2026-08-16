import { RecipeImportActionId } from "@meal-planner/recipe-import-api";
import { env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Option, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { ImportPrincipal } from "./import-intent.js";
import { makeRecipeReviewCompatibilityRepositoryD1 } from "./import-recipe-review.compatibility.js";
import { ImportId } from "./import.contracts.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
};

const principal = Schema.decodeUnknownSync(ImportPrincipal)({
  actorId: "a".repeat(64),
  householdScopeId: "b".repeat(64),
});
const otherHousehold = "c".repeat(64);
const ownedId = Schema.decodeUnknownSync(ImportId)(
  "29ac1a4e-70bd-420a-8303-e39a66bf9c10"
);
const foreignId = Schema.decodeUnknownSync(ImportId)(
  "ef436158-bc7a-4b1a-b3e0-3af5de6dc7fd"
);
const legacyId = Schema.decodeUnknownSync(ImportId)(
  "5be4c9b5-50a8-4e99-8749-7289e46efc94"
);
const ownedActionId = Schema.decodeUnknownSync(RecipeImportActionId)(
  "d".repeat(64)
);
const foreignActionId = "e".repeat(64);

beforeAll(async () => {
  await testEnv.MealPlannerDatabase.exec(
    "CREATE TABLE recipe_imports (id text PRIMARY KEY, household_scope_id text NOT NULL, submitted_source_url text, active_action_id text, public_status text NOT NULL, public_recipe_id text, succeeded_at text)"
  );
  await testEnv.MealPlannerDatabase.exec(
    "CREATE TABLE recipe_import_intent_history (intent_id text NOT NULL, intent_version integer NOT NULL, event_type text NOT NULL, action_id text, PRIMARY KEY (intent_id, intent_version))"
  );
  await testEnv.MealPlannerDatabase.batch([
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_imports (
         id, household_scope_id, submitted_source_url, active_action_id,
         public_status, public_recipe_id, succeeded_at
       ) VALUES (?, ?, ?, NULL, 'succeeded', ?, ?)`
    ).bind(
      ownedId,
      principal.householdScopeId,
      "https://www.tiktok.com/t/ZOWNED",
      ownedId,
      "2026-08-16T16:00:00.000Z"
    ),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_import_intent_history (
         intent_id, intent_version, event_type, action_id
       ) VALUES (?, 3, 'action_available', ?)`
    ).bind(ownedId, ownedActionId),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_imports (
         id, household_scope_id, submitted_source_url, active_action_id,
         public_status, public_recipe_id, succeeded_at
       ) VALUES (?, ?, ?, NULL, 'succeeded', ?, ?)`
    ).bind(
      foreignId,
      otherHousehold,
      "https://www.tiktok.com/t/ZFOREIGN",
      foreignId,
      "2026-08-16T16:00:01.000Z"
    ),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_import_intent_history (
         intent_id, intent_version, event_type, action_id
       ) VALUES (?, 5, 'action_available', ?)`
    ).bind(foreignId, foreignActionId),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_imports (
         id, household_scope_id, submitted_source_url, active_action_id,
         public_status, public_recipe_id, succeeded_at
       ) VALUES (?, ?, NULL, NULL, 'processing', NULL, NULL)`
    ).bind(legacyId, principal.householdScopeId),
  ]);
});

describe("D1 recipe review compatibility classification", () => {
  it("recovers a completed intent action without exposing another household", async () => {
    const repository = makeRecipeReviewCompatibilityRepositoryD1(
      testEnv.MealPlannerDatabase
    );

    const [owned, foreign, legacy, bank] = await Effect.runPromise(
      Effect.all([
        repository.classify(principal, ownedId),
        repository.classify(principal, foreignId),
        repository.classify(principal, legacyId),
        repository.listSucceededImportIds(principal),
      ])
    );

    expect(owned._tag).toBe("OwnedIntent");
    if (owned._tag !== "OwnedIntent") {
      return;
    }
    expect(Option.getOrThrow(owned.actionId)).toBe(ownedActionId);
    expect(foreign).toEqual({ _tag: "ForeignIntent" });
    expect(legacy).toEqual({ _tag: "Legacy" });
    expect(bank).toEqual([ownedId]);
  });
});
