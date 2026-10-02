import {
  emptyRecipeDetails,
  recipeIngredientFromText,
  recipeInstructionFromText,
  PlanningTags,
} from "@meal-planner/recipe-domain";
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

const draft = Schema.decodeUnknownSync(RecipeDraft)({
  createdAt: "2026-08-16T10:00:00.000Z",
  evidenceFingerprint: privateValues.evidence,
  extraction: {
    cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
    evidence: [],
    recipe: {
      ...emptyRecipeDetails,
      ingredients: [
        recipeIngredientFromText("1 onion"),
        recipeIngredientFromText("2 tomatoes"),
      ],
      instructions: [
        recipeInstructionFromText("Chop the onion.", 1),
        recipeInstructionFromText("Simmer for 20 minutes.", 2),
      ],
      name: null,
    },
    sourceUrl: {
      citations: [
        {
          confidence: 1,
          evidenceId: "private-transcript-sentinel",
          origin: "observed",
        },
      ],
      origin: "observed",
      state: "supported",
      value: privateValues.sourceUrl,
    },
    unresolvedFields: ["name", "nutrition"],
    usage: {
      inputEvidenceItems: 1,
      inputTokens: 0,
      latencyMilliseconds: 0,
      modelCalls: 1,
      outputTokens: 0,
    },
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
  transcript: { status: "available" },
});

const tags = Schema.decodeUnknownSync(PlanningTags)({
  cuisines: ["Irish"],
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
    nullablePolicy: ["nutrition"],
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
    expect(action).toMatchObject({
      actionVersion: 2,
      id: "a".repeat(64),
      intentId: "018f47ad-91aa-7c35-b6fe-000000000401",
      review: {
        answers: [
          { field: "name", value: "Tomato and Onion Stew" },
          { field: "tags", value: tags },
        ],
        blockers: { invalidFields: [], unresolvedRequiredFields: [] },
        recipe: { ...draft.extraction.recipe, name: "Tomato and Onion Stew" },
        tags,
      },
      status: "active",
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
