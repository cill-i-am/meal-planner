import {
  emptyRecipeDetails,
  recipeIngredientFromText,
  recipeInstructionFromText,
} from "@meal-planner/recipe-domain";
import { ActiveRecipeImportAction } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { projectRecipeDraftReviewActionView } from "./import-intent-review-action.js";
import { RecipeDraft } from "./import-recipe-draft.repository.js";

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

it("projects a blocked initial draft without leaking provider or evidence metadata", () => {
  const review = projectRecipeDraftReviewActionView(draft);
  expect(
    Schema.decodeUnknownSync(ActiveRecipeImportAction.fields.review)(review)
  ).toEqual(review);
  expect(review).toMatchObject({
    answers: [],
    blockers: { invalidFields: [], unresolvedRequiredFields: ["name"] },
    recipe: draft.extraction.recipe,
    tags: null,
  });
  const serialized = JSON.stringify(review);
  for (const forbidden of [
    ...Object.values(privateValues),
    "private-transcript-sentinel",
    "private-model-sentinel",
    "private-schema-sentinel",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
});
