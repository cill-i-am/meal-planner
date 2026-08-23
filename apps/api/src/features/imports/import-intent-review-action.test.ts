import {
  RecipeImportAction,
  RecipeImportActionId,
  RecipeImportActionVersion,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { projectActiveRecipeImportAction } from "./import-intent-review-action.js";
import { RecipeDraft } from "./import-recipe-draft.repository.js";
import {
  PlanningTags,
  RecipeCorrection,
  RecipeReviewView,
  refineRecipeReview,
} from "./import-recipe-review.js";

const privateValues = {
  actor: "private-reviewer-sentinel",
  evidence: "d".repeat(64),
  extraction: "e".repeat(64),
  provider: "private-provider-sentinel",
  r2: "private-r2-evidence-sentinel",
  sourceUrl:
    "https://www.tiktok.com/@private-source-sentinel/video/7520000000000000001",
};

const citation = {
  citations: [
    {
      confidence: 1,
      evidenceId: "private-transcript-sentinel",
      origin: "creator_provided" as const,
    },
  ],
  origin: "creator_provided" as const,
  state: "supported" as const,
};
const supportedString = (value: string) => ({ ...citation, value });
const supportedNumber = (value: number) => ({ ...citation, value });
const supportedList = (values: readonly string[]) => ({
  items: values.map(supportedString),
  state: "supported" as const,
});
const unresolved = (reason: string) => ({
  citations: [] as const,
  origin: "unresolved" as const,
  reason,
  state: "unresolved" as const,
});

const draft = Schema.decodeUnknownSync(RecipeDraft)({
  createdAt: "2026-08-16T10:00:00.000Z",
  evidenceFingerprint: privateValues.evidence,
  extraction: {
    author: supportedString("Fixture Cook"),
    category: supportedString("Dinner"),
    cookTimeMinutes: supportedNumber(20),
    cost: {
      certainty: "known",
      currency: "USD",
      estimatedMicroUsd: 0,
    },
    cuisine: supportedString("Irish"),
    description: supportedString("A deterministic fixture."),
    ingredientLines: supportedList(["1 onion", "2 tomatoes"]),
    instructions: supportedList(["Chop the onion.", "Simmer for 20 minutes."]),
    name: unresolved("The title was not visible."),
    nutrition: unresolved("Nutrition was not stated."),
    prepTimeMinutes: supportedNumber(10),
    sourceUrl: supportedString(privateValues.sourceUrl),
    supportedClaims: supportedList(["Simmer for 20 minutes."]),
    temperatureCelsius: unresolved("Temperature was not stated."),
    tools: supportedList(["Saucepan"]),
    totalTimeMinutes: supportedNumber(30),
    unresolvedFields: [
      "name",
      "nutrition",
      "temperature_celsius",
      "ingredient_quantities",
      "ingredient_units",
    ],
    usage: {
      inputEvidenceItems: 1,
      inputTokens: 0,
      latencyMilliseconds: 0,
      modelCalls: 1,
      outputTokens: 0,
    },
    yield: supportedString("2 servings"),
  },
  extractionFingerprint: privateValues.extraction,
  extractor: {
    model: "private-model-sentinel",
    provider: privateValues.provider,
    version: "private-schema-sentinel",
  },
  generation: 1,
  importId: "018f47ad-91aa-7c35-b6fe-000000000401",
  lifecycle: "needs_review",
  schemaVersion: 1,
});

const tags = Schema.decodeUnknownSync(PlanningTags)({
  cuisines: ["Irish"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["dinner"],
  totalTimeBand: "30_to_60_minutes",
});
const correction = Schema.decodeUnknownSync(RecipeCorrection)({
  actorId: privateValues.actor,
  after: "Tomato and Onion Stew",
  before: null,
  correctedAt: "2026-08-16T10:01:00.000Z",
  field: "name",
  reason: "private-correction-reason-sentinel",
  version: 1,
});
const review = refineRecipeReview(
  Schema.decodeUnknownSync(RecipeReviewView)({
    corrections: [Schema.encodeSync(RecipeCorrection)(correction)],
    draft: Schema.encodeSync(RecipeDraft)(draft),
    evidence: [
      {
        kind: "original_media",
        referenceId: privateValues.r2,
      },
    ],
    lifecycle: "needs_review",
    nullablePolicy: [
      "nutrition",
      "temperature_celsius",
      "ingredient_quantities",
      "ingredient_units",
    ],
    tags,
    transitions: [],
    unresolvedRequiredFields: [],
    version: 1,
  })
);

const actionId = Schema.decodeUnknownSync(RecipeImportActionId)("a".repeat(64));
const actionVersion = Schema.decodeUnknownSync(RecipeImportActionVersion)(2);
const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "018f47ad-91aa-7c35-b6fe-000000000401"
);

describe("recipe import review action projection", () => {
  it("whitelists only public review fields while preserving current answers", () => {
    expect(Option.isSome(review)).toBe(true);
    if (Option.isNone(review) || review.value._tag !== "NeedsReview") {
      throw new Error("Expected a needs-review fixture");
    }

    const action = projectActiveRecipeImportAction({
      actionId,
      actionVersion,
      intentId,
      review: review.value,
    });

    expect(Schema.decodeUnknownSync(RecipeImportAction)(action)).toEqual(
      action
    );
    expect(action).toEqual({
      actionVersion: 2,
      id: "a".repeat(64),
      intentId: "018f47ad-91aa-7c35-b6fe-000000000401",
      object: "recipe_import_action",
      review: {
        answers: [
          { field: "name", value: "Tomato and Onion Stew" },
          { field: "tags", value: tags },
        ],
        blockers: {
          invalidFields: [],
          unresolvedRequiredFields: [],
        },
        editableFields: [
          "author",
          "category",
          "cook_time_minutes",
          "cuisine",
          "description",
          "ingredient_lines",
          "ingredient_quantities",
          "ingredient_units",
          "instructions",
          "name",
          "nutrition",
          "prep_time_minutes",
          "temperature_celsius",
          "tools",
          "total_time_minutes",
          "yield",
          "tags",
        ],
        recipe: {
          author: "Fixture Cook",
          category: "Dinner",
          cookTimeMinutes: 20,
          cuisine: "Irish",
          description: "A deterministic fixture.",
          ingredientLines: ["1 onion", "2 tomatoes"],
          ingredientQuantities: null,
          ingredientUnits: null,
          instructions: ["Chop the onion.", "Simmer for 20 minutes."],
          name: "Tomato and Onion Stew",
          nutrition: null,
          prepTimeMinutes: 10,
          temperatureCelsius: null,
          tools: ["Saucepan"],
          totalTimeMinutes: 30,
          yield: "2 servings",
        },
        tags,
      },
      status: "active",
      type: "review_recipe",
    });

    const serialized = JSON.stringify(action);
    for (const forbidden of Object.values(privateValues)) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain("private-transcript-sentinel");
    expect(serialized).not.toContain("private-correction-reason-sentinel");
    expect(serialized).not.toContain("private-model-sentinel");
    expect(serialized).not.toContain("private-schema-sentinel");
  });
});
