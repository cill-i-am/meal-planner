import {
  emptyRecipeDetails,
  recipeIngredientFromText,
  recipeInstructionFromText,
} from "@meal-planner/recipe-domain";
import { DateTime, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { RecipeDraft } from "./import-recipe-draft.repository.js";
import {
  RecipeCorrection,
  RecipeReviewView,
  approvalBlockers,
  applyCorrectionOverlay,
  projectApprovedReview,
  refineRecipeReview,
} from "./import-recipe-review.js";

const correctionPairs = [
  { field: "author", value: { name: "Corrected author", url: null } },
  { field: "categories", value: ["Soup"] },
  { field: "cuisines", value: ["Irish"] },
  { field: "description", value: "Corrected description" },
  { field: "ingredients", value: [recipeIngredientFromText("1 onion")] },
  {
    field: "instructions",
    value: [recipeInstructionFromText("Cook the onion.", 1)],
  },
  { field: "name", value: "Corrected name" },
  { field: "nutrition", value: null },
  {
    field: "times",
    value: { cook: null, inactive: null, prep: { seconds: 660 }, total: null },
  },
  { field: "equipment", value: ["Saucepan"] },
  {
    field: "servings",
    value: { max: null, original: "Serves 3", quantity: 3, unit: "serving" },
  },
];
const mismatchedCorrectionPairs = [
  { field: "author", value: 1 },
  { field: "times", value: "twenty minutes" },
  { field: "ingredients", value: "1 onion" },
];
const supportedString = (value: string) => ({
  citations: [
    {
      confidence: 1,
      evidenceId: "caption:fixture",
      origin: "creator_provided",
    },
  ],
  origin: "creator_provided",
  state: "supported",
  value,
});

const draft = Schema.decodeUnknownSync(RecipeDraft)({
  createdAt: "2026-07-22T10:00:00.000Z",
  evidenceFingerprint:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  extraction: {
    cost: {
      certainty: "known",
      currency: "USD",
      estimatedMicroUsd: 0,
    },
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
      notes: ["Refrigerate leftovers."],
      servings: {
        max: null,
        original: "2 servings",
        quantity: 2,
        unit: "serving",
      },
      times: {
        cook: { seconds: 1200 },
        inactive: null,
        prep: { seconds: 600 },
        total: { seconds: 1800 },
      },
    },
    sourceUrl: supportedString(
      "https://www.tiktok.com/@fixture/video/7520000000000000001"
    ),
    unresolvedFields: ["name", "nutrition"],
    usage: {
      inputEvidenceItems: 1,
      inputTokens: 0,
      latencyMilliseconds: 0,
      modelCalls: 1,
      outputTokens: 0,
    },
  },
  extractionFingerprint:
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  extractor: {
    model: "fixture-v1",
    provider: "deterministic_fake",
    version: "schema-1",
  },
  generation: 1,
  importId: "018f47ad-91aa-7c35-b6fe-000000000301",
  lifecycle: "needs_review",
  schemaVersion: 1,
  transcript: { status: "available" },
});

describe("recipe review approval policy", () => {
  it.each([
    { status: "available" },
    { reason: "source_type_carousel", status: "not_applicable" },
  ])(
    "reads current recipe drafts with transcript disposition $status",
    (transcript) => {
      const restored = Schema.decodeUnknownSync(RecipeDraft)({
        ...Schema.encodeSync(RecipeDraft)(draft),
        transcript,
      });
      expect(approvalBlockers(restored, [])).toEqual({
        invalidFields: [],
        unresolvedRequiredFields: ["name"],
      });
    }
  );

  it.each([undefined, { status: "not_applicable" }, { status: "unknown" }])(
    "rejects a draft without a valid transcript disposition",
    (transcript) => {
      expect(() =>
        Schema.decodeUnknownSync(RecipeDraft)({
          ...Schema.encodeSync(RecipeDraft)(draft),
          transcript,
        })
      ).toThrow();
    }
  );

  it("decodes every correction field/value pairing and rejects mismatches", () => {
    for (const correction of correctionPairs) {
      expect(
        Schema.decodeUnknownSync(RecipeCorrection)({
          actorId: "private_api_credential",
          after: correction.value,
          before: null,
          correctedAt: "2026-07-22T10:01:00.000Z",
          field: correction.field,
          reason: "The correction is visible in the cited caption frame.",
          version: 1,
        })
      ).toMatchObject({ after: correction.value, field: correction.field });
    }

    for (const correction of mismatchedCorrectionPairs) {
      expect(() =>
        Schema.decodeUnknownSync(RecipeCorrection)({
          actorId: "private_api_credential",
          after: correction.value,
          before: null,
          correctedAt: "2026-07-22T10:01:00.000Z",
          field: correction.field,
          reason: "The duration is visible in the cited caption frame.",
          version: 1,
        })
      ).toThrow();
    }
  });

  it("blocks only unresolved planning-required fields", () => {
    expect(approvalBlockers(draft, [])).toEqual({
      invalidFields: [],
      unresolvedRequiredFields: ["name"],
    });
  });

  it("uses an audited typed correction overlay without mutating extraction", () => {
    const correction = Schema.decodeUnknownSync(RecipeCorrection)({
      actorId: "private_api_credential",
      after: "Tomato and Onion Stew",
      before: null,
      correctedAt: "2026-07-22T10:01:00.000Z",
      field: "name",
      reason: "The title is visible in the cited caption frame.",
      version: 1,
    });

    expect(applyCorrectionOverlay(draft, [correction]).name).toBe(
      "Tomato and Onion Stew"
    );
    expect(approvalBlockers(draft, [correction])).toEqual({
      invalidFields: [],
      unresolvedRequiredFields: [],
    });
    expect(draft.extraction.recipe.name).toBeNull();
  });

  it("refines approved rows into a total approved recipe projection", () => {
    const correction = Schema.decodeUnknownSync(RecipeCorrection)({
      actorId: "private_api_credential",
      after: "Tomato and Onion Stew",
      before: null,
      correctedAt: "2026-07-22T10:01:00.000Z",
      field: "name",
      reason: "The title is visible in the cited caption frame.",
      version: 1,
    });
    const review = Schema.decodeUnknownSync(RecipeReviewView)({
      corrections: [Schema.encodeSync(RecipeCorrection)(correction)],
      draft: Schema.encodeSync(RecipeDraft)(draft),
      evidence: [],
      lifecycle: "approved",
      nullablePolicy: [],
      tags: {
        cuisines: ["Irish"],
        difficulty: "easy",
        leftovers: "one_meal",
        mealTypes: ["dinner"],
        totalTimeBand: "30_to_60_minutes",
      },
      transitions: [
        {
          actorId: "private_api_credential",
          from: "needs_review",
          reason: "Validated and ready for planning.",
          to: "approved",
          transitionedAt: "2026-07-22T10:02:00.000Z",
          version: 2,
        },
      ],
      unresolvedRequiredFields: [],
      version: 2,
    });
    const refined = refineRecipeReview(review);

    expect(Option.isSome(refined)).toBe(true);
    if (Option.isNone(refined)) {
      throw new Error("Approved review did not refine");
    }
    if (refined.value._tag !== "Approved") {
      throw new Error("Review did not refine to Approved");
    }
    const approved = refined.value;

    expect(approved).toMatchObject({
      _tag: "Approved",
      actorId: "private_api_credential",
      recipe: { name: "Tomato and Onion Stew" },
    });
    expect(DateTime.formatIso(approved.approvedAt)).toBe(
      "2026-07-22T10:02:00.000Z"
    );

    const projected = projectApprovedReview(approved);

    expect(projected).toMatchObject({
      recipe: {
        name: "Tomato and Onion Stew",
        notes: ["Refrigerate leftovers."],
        servings: draft.extraction.recipe.servings,
        times: draft.extraction.recipe.times,
      },
    });
    expect(DateTime.formatIso(projected.approvedAt)).toBe(
      "2026-07-22T10:02:00.000Z"
    );
  });

  it("rejects an approved row whose terminal transition is no longer approval", () => {
    const review = Schema.decodeUnknownSync(RecipeReviewView)({
      corrections: [],
      draft: Schema.encodeSync(RecipeDraft)(draft),
      evidence: [],
      lifecycle: "approved",
      nullablePolicy: [],
      tags: {
        cuisines: ["Irish"],
        difficulty: "easy",
        leftovers: "one_meal",
        mealTypes: ["dinner"],
        totalTimeBand: "30_to_60_minutes",
      },
      transitions: [
        {
          actorId: "private_api_credential",
          from: "needs_review",
          reason: "Initially approved.",
          to: "approved",
          transitionedAt: "2026-07-22T10:01:00.000Z",
          version: 1,
        },
        {
          actorId: "private_api_credential",
          from: "approved",
          reason: "Returned for correction.",
          to: "needs_review",
          transitionedAt: "2026-07-22T10:02:00.000Z",
          version: 2,
        },
        {
          actorId: "private_api_credential",
          from: "needs_review",
          reason: "Rejected after review.",
          to: "rejected",
          transitionedAt: "2026-07-22T10:03:00.000Z",
          version: 3,
        },
      ],
      unresolvedRequiredFields: [],
      version: 3,
    });

    expect(Option.isNone(refineRecipeReview(review))).toBe(true);
  });
});
