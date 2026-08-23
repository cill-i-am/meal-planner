import { DateTime, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { RecipeDraft } from "./import-recipe-draft.repository.js";
import {
  RecipeCorrection,
  RecipeReviewView,
  approvalBlockers,
  applyCorrectionOverlay,
  projectApprovedReview,
  recipeReviewTransitionPolicy,
  refineRecipeReview,
} from "./import-recipe-review.js";

const correctionPairs = [
  { field: "author", value: "Corrected author" },
  { field: "category", value: "Corrected category" },
  { field: "cook_time_minutes", value: 21 },
  { field: "cuisine", value: "Corrected cuisine" },
  { field: "description", value: "Corrected description" },
  { field: "ingredient_lines", value: ["1 corrected ingredient"] },
  { field: "ingredient_quantities", value: ["1"] },
  { field: "ingredient_units", value: ["cup"] },
  { field: "instructions", value: ["Follow the corrected instruction."] },
  { field: "name", value: "Corrected name" },
  { field: "nutrition", value: "Corrected nutrition" },
  { field: "prep_time_minutes", value: 11 },
  { field: "temperature_celsius", value: 180 },
  { field: "tools", value: ["Corrected tool"] },
  { field: "total_time_minutes", value: 31 },
  { field: "yield", value: "3 servings" },
];

const mismatchedCorrectionPairs = [
  { field: "author", value: 1 },
  { field: "cook_time_minutes", value: "twenty minutes" },
  { field: "ingredient_lines", value: "1 corrected ingredient" },
];

const citation = {
  citations: [
    {
      confidence: 1,
      evidenceId: "caption:fixture",
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
  createdAt: "2026-07-22T10:00:00.000Z",
  evidenceFingerprint:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
    sourceUrl: supportedString(
      "https://www.tiktok.com/@fixture/video/7520000000000000001"
    ),
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
});

describe("recipe review approval policy", () => {
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
    expect(draft.extraction.name.state).toBe("unresolved");
  });

  it("allows exactly the exhaustive review transition policy", () => {
    const lifecycles = ["needs_review", "approved", "rejected"] as const;
    const allowed = new Set([
      "needs_review:approved",
      "needs_review:rejected",
      "approved:needs_review",
      "rejected:needs_review",
    ]);

    for (const from of lifecycles) {
      for (const to of lifecycles) {
        expect(Option.isSome(recipeReviewTransitionPolicy(from, to))).toBe(
          allowed.has(`${from}:${to}`)
        );
      }
    }
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
        dietaryFit: "household_match",
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
      recipe: { name: "Tomato and Onion Stew" },
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
        dietaryFit: "household_match",
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
