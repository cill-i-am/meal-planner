import type {
  RecipeImportAction,
  RecipeImportActionId,
  RecipeImportActionVersion,
  RecipeImportIntentId,
  RecipeReviewAnswer,
  RecipeReviewEditableField,
} from "@meal-planner/recipe-import-api";
import {
  Instant,
  RecipeReviewAnswer as RecipeReviewAnswerSchema,
} from "@meal-planner/recipe-import-api";
import { DateTime, Schema } from "effect";

import type { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import type { ApprovedReview } from "./import-recipe-review.js";
import {
  approvalBlockers,
  applyCorrectionOverlay,
  recipeReviewNullablePolicy,
  Review,
} from "./import-recipe-review.js";

const editableFields = [
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
] as const satisfies readonly RecipeReviewEditableField[];

type NeedsReview = Extract<Review, { readonly _tag: "NeedsReview" }>;
type PubliclyProjectableReview = ApprovedReview | NeedsReview;

const projectCurrentAnswers = (
  review: PubliclyProjectableReview
): readonly RecipeReviewAnswer[] => {
  const latestByField = new Map(
    review.corrections.map((correction) => [correction.field, correction])
  );
  const decodeAnswer = Schema.decodeUnknownSync(RecipeReviewAnswerSchema);
  const answers: RecipeReviewAnswer[] = [];
  for (const field of editableFields) {
    if (field === "tags") {
      if (review.tags !== null) {
        answers.push(decodeAnswer({ field, value: review.tags }));
      }
      continue;
    }
    const correction = latestByField.get(field);
    if (correction !== undefined) {
      answers.push(
        decodeAnswer({ field: correction.field, value: correction.after })
      );
    }
  }
  return answers;
};

const projectReview = (review: PubliclyProjectableReview) => ({
  answers: projectCurrentAnswers(review),
  blockers: approvalBlockers(review.draft, review.corrections),
  editableFields,
  recipe: applyCorrectionOverlay(review.draft, review.corrections),
  tags: review.tags,
});

/** Project the provider result into the closed draft snapshot admitted by HouseholdObject. */
export const projectRecipeDraftReviewActionView = (draft: RecipeDraft) => {
  const review = Review.make({
    _tag: "NeedsReview",
    corrections: [],
    draft,
    evidence: [],
    lifecycle: "needs_review",
    nullablePolicy: recipeReviewNullablePolicy,
    tags: null,
    transitions: [],
    unresolvedRequiredFields: draft.extraction.unresolvedFields,
    version: 0,
  });
  if (review._tag !== "NeedsReview") {
    throw new Error("Recipe draft projection produced an invalid lifecycle");
  }
  return projectReview(review);
};

export const projectActiveRecipeImportAction = (input: {
  readonly actionId: RecipeImportActionId;
  readonly actionVersion: RecipeImportActionVersion;
  readonly intentId: RecipeImportIntentId;
  readonly review: NeedsReview;
}): RecipeImportAction => ({
  actionVersion: input.actionVersion,
  id: input.actionId,
  intentId: input.intentId,
  object: "recipe_import_action",
  review: projectReview(input.review),
  status: "active",
  type: "review_recipe",
});

export const projectCompletedRecipeImportAction = (input: {
  readonly actionId: RecipeImportActionId;
  readonly actionVersion: RecipeImportActionVersion;
  readonly intentId: RecipeImportIntentId;
  readonly review: ApprovedReview;
}): RecipeImportAction => ({
  actionVersion: input.actionVersion,
  completion: {
    confirmedAt: Schema.decodeUnknownSync(Instant)(
      DateTime.formatIso(input.review.approvedAt)
    ),
    type: "confirmed",
  },
  id: input.actionId,
  intentId: input.intentId,
  object: "recipe_import_action",
  review: projectReview(input.review),
  status: "completed",
  type: "review_recipe",
});
