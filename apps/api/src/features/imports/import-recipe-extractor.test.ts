import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  GroundedRecipeFacts,
  RecipeCandidate,
  RecipeExtractionFailure,
} from "./import-recipe-extractor.js";
import type {
  GroundedRecipeFacts as GroundedRecipeFactsType,
  RecipeCandidate as RecipeCandidateType,
} from "./import-recipe-extractor.js";

const candidate = {
  category: "pasta",
  cookTimeMinutes: 12,
  cuisine: null,
  description: "quick tomato pasta",
  ingredientLines: ["tomatoes", "pasta"],
  instructions: ["boil the pasta"],
  name: "tomato pasta",
  nutrition: null,
  prepTimeMinutes: null,
  supportedClaims: ["ready in 12 minutes"],
  temperatureCelsius: null,
  tools: ["pan"],
  totalTimeMinutes: 12,
  yield: null,
} as const;

describe("recipe extraction contracts", () => {
  it("keeps untrusted candidates structurally distinct from grounded facts", () => {
    expectTypeOf<RecipeCandidateType>().not.toMatchTypeOf<GroundedRecipeFactsType>();
    expectTypeOf<GroundedRecipeFactsType>().not.toMatchTypeOf<RecipeCandidateType>();

    expect(Schema.is(RecipeCandidate)(candidate)).toBe(true);
    expect(Schema.is(GroundedRecipeFacts)(candidate)).toBe(false);
  });

  it.each([
    ["citations", { ...candidate, citations: [] }],
    [
      "nested citation authority",
      {
        ...candidate,
        name: {
          citations: [
            {
              confidence: 1,
              evidenceId: "provider-evidence",
              origin: "creator_provided",
            },
          ],
          state: "supported",
          value: "tomato pasta",
        },
      },
    ],
    ["origin authority", { ...candidate, origin: "creator_provided" }],
    ["unresolved bookkeeping", { ...candidate, unresolvedFields: [] }],
  ])("rejects provider-owned %s", (_label, value) => {
    expect(
      Schema.decodeUnknownResult(RecipeCandidate, {
        onExcessProperty: "error",
      })(value)._tag
    ).toBe("Failure");
  });

  it("rejects malformed candidate shapes and unknown members", () => {
    const malformed = {
      ...candidate,
      ingredientLines: "tomatoes",
      providerPrivateCanary: "must-not-escape",
    };

    expect(
      Schema.decodeUnknownResult(RecipeCandidate, {
        onExcessProperty: "error",
      })(malformed)._tag
    ).toBe("Failure");
  });

  it("owns extraction failures as a schema-backed tagged error", () => {
    const failure = new RecipeExtractionFailure({
      code: "malformed_response",
    });

    expect(failure).toMatchObject({
      _tag: "RecipeExtractionFailure",
      code: "malformed_response",
    });
    expect(Schema.is(RecipeExtractionFailure)(failure)).toBe(true);
  });
});
