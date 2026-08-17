import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  canonicalizeRecipeImportSearch,
  decodeRecipeImportSearch,
  recipeImportIntentRedirectSearch,
  recipeImportProfileSwitchSearch,
} from "./navigation.js";
import {
  RecipeImportProfileAlias,
  RecipeImportPublicProfileConfiguration,
} from "./profiles.js";

const profileA = Schema.decodeUnknownSync(RecipeImportProfileAlias)("home");
const profileB = Schema.decodeUnknownSync(RecipeImportProfileAlias)(
  "test-kitchen"
);
const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "11111111-1111-4111-8111-111111111111"
);
const configuration = Schema.decodeUnknownSync(
  RecipeImportPublicProfileConfiguration
)({
  defaultAlias: profileA,
  profiles: [
    { alias: profileA, label: "Our household" },
    { alias: profileB, label: "Test kitchen" },
  ],
});

describe("recipe import profile navigation", () => {
  it("validates opaque profile and intent search state and fails closed on malformed input", () => {
    expect(decodeRecipeImportSearch({ intentId, profile: profileB })).toEqual({
      intentId,
      profile: profileB,
    });
    expect(() =>
      decodeRecipeImportSearch({ profile: " household A " })
    ).toThrow();
    expect(() =>
      decodeRecipeImportSearch({ profile: profileA, token: "forbidden" })
    ).toThrow();
  });

  it.each([{}, { profile: "unknown" }])(
    "canonicalizes missing or unknown profile search to the configured default",
    (search) => {
      expect(canonicalizeRecipeImportSearch(configuration, search)).toEqual({
        profile: profileA,
      });
    }
  );

  it("clears the old intent on profile switch and preserves profile on intent redirect", () => {
    expect(
      recipeImportProfileSwitchSearch({ intentId, profile: profileA }, profileB)
    ).toEqual({ profile: profileB });
    expect(
      recipeImportIntentRedirectSearch(
        { profile: profileB },
        profileB,
        intentId
      )
    ).toEqual({ intentId, profile: profileB });
  });
});
