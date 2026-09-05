import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { decodeRecipeImportSearch } from "./navigation.js";

const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "11111111-1111-4111-8111-111111111111"
);

describe("recipe import navigation", () => {
  it("accepts only the optional intent identifier", () => {
    expect(decodeRecipeImportSearch({ intentId })).toEqual({ intentId });
    expect(() => decodeRecipeImportSearch({ profile: "legacy" })).toThrow();
  });
});
