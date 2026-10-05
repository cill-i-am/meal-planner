import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeRecipeContent,
  PublishedRecipeSnapshot,
  recipeIngredientFromText,
  recipeInstructionFromText,
} from "./index.js";

const published = {
  approvedAt: "2026-10-04T12:00:00.000Z",
  extractionFingerprint: "extraction-fingerprint",
  importId: "a9f513cb-d1cc-4ae8-99fb-20113da1b83a",
  recipe: makeRecipeContent({
    ingredients: [recipeIngredientFromText("2 tomatoes")],
    instructions: [recipeInstructionFromText("Simmer the tomatoes.", 1)],
    name: "Tomato stew",
  }),
  source: {
    evidenceFingerprint: "evidence-fingerprint",
    sourceUrl: "https://example.com/tomato-stew",
  },
  tags: {
    cuisines: ["Irish"],
    difficulty: "easy",
    leftovers: "one_meal",
    mealTypes: ["dinner"],
    totalTimeBand: "under_30_minutes",
  },
  version: 1,
} as const;

describe("published recipe snapshot", () => {
  it("preserves structured content and source evidence through persistence encoding", () => {
    const decoded = Schema.decodeUnknownSync(PublishedRecipeSnapshot)(
      published
    );
    const stored = Schema.encodeSync(
      Schema.fromJsonString(PublishedRecipeSnapshot)
    )(decoded);
    const restored = Schema.decodeUnknownSync(
      Schema.fromJsonString(PublishedRecipeSnapshot)
    )(stored);

    expect(restored.recipe.ingredients[0]?.original).toBe("2 tomatoes");
    expect(restored.recipe.instructions[0]?.text).toBe("Simmer the tomatoes.");
    expect(restored.source).toEqual(published.source);
  });

  it("rejects obsolete flat recipe content and broken ingredient references", () => {
    expect(
      Schema.is(PublishedRecipeSnapshot)({
        ...published,
        recipe: {
          ingredientLines: ["2 tomatoes"],
          instructions: ["Simmer the tomatoes."],
          name: "Tomato stew",
        },
      })
    ).toBe(false);
    expect(
      Schema.is(PublishedRecipeSnapshot)({
        ...published,
        recipe: {
          ...published.recipe,
          instructions: [
            {
              ...published.recipe.instructions[0],
              ingredients: ["missing-ingredient-id"],
            },
          ],
        },
      })
    ).toBe(false);
  });
});
