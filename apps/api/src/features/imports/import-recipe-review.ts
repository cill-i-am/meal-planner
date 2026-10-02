import {
  PlanningTags as PlanningTagsSchema,
  RecipeContent,
  RecipeDraftContent,
  recipeContentBlockers,
} from "@meal-planner/recipe-domain";
import {
  RecipeReviewAnswer,
  RecipeEditableField,
} from "@meal-planner/recipe-import-api";
import type { CorrectedRecipe as CorrectedRecipeType } from "@meal-planner/recipe-import-api";
import { Option, Schema } from "effect";

import { RecipeDraft } from "./import-recipe-draft.repository.js";
import { RecipeUnresolvedField } from "./import-recipe-extractor.js";
import {
  EvidenceReference,
  ImportId,
  ImportTimestamp,
} from "./import.contracts.js";

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);
const ShortText = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(4096))
);
const SafeInteger = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);

export const RecipeReviewVersion = SafeInteger;
export type RecipeReviewVersion = typeof RecipeReviewVersion.Type;

export const RecipeReviewerActorId = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(128)),
  Schema.brand("RecipeReviewerActorId")
);
export type RecipeReviewerActorId = typeof RecipeReviewerActorId.Type;

const RecipeCorrectionDetails = {
  actorId: RecipeReviewerActorId,
  correctedAt: ImportTimestamp,
  reason: ShortText,
  version: RecipeReviewVersion,
} as const;
export const RecipeCorrection = Schema.Union(
  RecipeReviewAnswer.members.map((answer) =>
    Schema.Struct({
      ...RecipeCorrectionDetails,
      after: answer.fields.value,
      before: Schema.NullOr(answer.fields.value),
      field: answer.fields.field,
    })
  )
);
export type RecipeCorrection = typeof RecipeCorrection.Type;

const RecipeReviewTransitionDetails = {
  actorId: RecipeReviewerActorId,
  reason: ShortText,
  transitionedAt: ImportTimestamp,
  version: RecipeReviewVersion,
} as const;

export const RecipeReviewTransition = Schema.Union([
  Schema.Struct({
    ...RecipeReviewTransitionDetails,
    from: Schema.Literal("needs_review"),
    to: Schema.Literal("approved"),
  }),
  Schema.Struct({
    ...RecipeReviewTransitionDetails,
    from: Schema.Literal("needs_review"),
    to: Schema.Literal("rejected"),
  }),
  Schema.Struct({
    ...RecipeReviewTransitionDetails,
    from: Schema.Literal("approved"),
    to: Schema.Literal("needs_review"),
  }),
  Schema.Struct({
    ...RecipeReviewTransitionDetails,
    from: Schema.Literal("rejected"),
    to: Schema.Literal("needs_review"),
  }),
]);
export type RecipeReviewTransition = typeof RecipeReviewTransition.Type;

export const RecipeReviewLifecycle = Schema.Literals([
  "needs_review",
  "approved",
  "rejected",
]);
export type RecipeReviewLifecycle = typeof RecipeReviewLifecycle.Type;

export const ApprovalBlockers = Schema.Struct({
  invalidFields: Schema.Array(RecipeUnresolvedField),
  unresolvedRequiredFields: Schema.Array(RecipeUnresolvedField),
});
export type ApprovalBlockers = typeof ApprovalBlockers.Type;

export const RecipeReviewView = Schema.Struct({
  corrections: Schema.Array(RecipeCorrection),
  draft: RecipeDraft,
  evidence: Schema.Array(EvidenceReference),
  lifecycle: RecipeReviewLifecycle,
  nullablePolicy: Schema.Array(RecipeUnresolvedField),
  tags: Schema.NullOr(PlanningTagsSchema),
  transitions: Schema.Array(RecipeReviewTransition),
  unresolvedRequiredFields: Schema.Array(RecipeUnresolvedField),
  version: RecipeReviewVersion,
});
export type RecipeReviewView = typeof RecipeReviewView.Type;

export const ApprovedRecipe = Schema.Struct({
  approvedAt: ImportTimestamp,
  extractionFingerprint: Schema.String,
  importId: ImportId,
  recipe: RecipeContent,
  source: Schema.Struct({
    evidenceFingerprint: Schema.String,
    sourceUrl: Schema.NullOr(ShortText),
  }),
  tags: PlanningTagsSchema,
  version: RecipeReviewVersion,
});
export type ApprovedRecipe = typeof ApprovedRecipe.Type;

export const Review = Schema.TaggedUnion({
  Approved: {
    ...RecipeReviewView.fields,
    actorId: RecipeReviewerActorId,
    approvedAt: ImportTimestamp,
    evidence: Schema.Array(EvidenceReference),
    lifecycle: Schema.Literal("approved"),
    recipe: RecipeContent,
    tags: PlanningTagsSchema,
  },
  NeedsReview: {
    ...RecipeReviewView.fields,
    lifecycle: Schema.Literal("needs_review"),
  },
  Rejected: {
    ...RecipeReviewView.fields,
    lifecycle: Schema.Literal("rejected"),
  },
});
export type Review = typeof Review.Type;
export type ApprovedReview = Extract<Review, { readonly _tag: "Approved" }>;

export const recipeReviewNullablePolicy = RecipeEditableField.literals.filter(
  (field) =>
    field !== "name" && field !== "ingredients" && field !== "instructions"
);

export const applyCorrectionOverlay = (
  draft: RecipeDraft,
  corrections: readonly RecipeCorrection[]
): CorrectedRecipeType => {
  const recipe = { ...draft.extraction.recipe };
  for (const correction of corrections) {
    if (correction.field !== "tags") {
      Object.assign(recipe, { [correction.field]: correction.after });
    }
  }
  return Schema.decodeUnknownSync(RecipeDraftContent)(recipe);
};

export const refineRecipeReview = (
  review: RecipeReviewView
): Option.Option<Review> => {
  switch (review.lifecycle) {
    case "needs_review": {
      return Option.some(
        Review.make({
          ...review,
          _tag: "NeedsReview",
          lifecycle: "needs_review",
        })
      );
    }
    case "rejected": {
      return Option.some(
        Review.make({
          ...review,
          _tag: "Rejected",
          lifecycle: "rejected",
        })
      );
    }
    case "approved": {
      const approval = review.transitions.at(-1);
      const recipe = applyCorrectionOverlay(review.draft, review.corrections);
      const { tags } = review;
      if (
        approval === undefined ||
        approval.to !== "approved" ||
        approval.version !== review.version ||
        tags === null ||
        recipe.name === null ||
        recipe.ingredients === null ||
        recipe.instructions === null ||
        recipeContentBlockers(recipe).invalidFields.length > 0
      ) {
        return Option.none();
      }
      return Option.some(
        Review.make({
          ...review,
          _tag: "Approved",
          actorId: approval.actorId,
          approvedAt: approval.transitionedAt,
          lifecycle: "approved",
          recipe: Schema.decodeUnknownSync(RecipeContent)(recipe),
          tags,
        })
      );
    }
    default: {
      return review.lifecycle satisfies never;
    }
  }
};

export const approvalBlockers = (
  draft: RecipeDraft,
  corrections: readonly RecipeCorrection[]
): ApprovalBlockers => {
  const recipe = applyCorrectionOverlay(draft, corrections);
  return recipeContentBlockers(recipe);
};

export const projectApprovedReview = (
  review: ApprovedReview
): ApprovedRecipe => ({
  approvedAt: review.approvedAt,
  extractionFingerprint: review.draft.extractionFingerprint,
  importId: review.draft.importId,
  recipe: review.recipe,
  source: {
    evidenceFingerprint: review.draft.evidenceFingerprint,
    sourceUrl:
      review.draft.extraction.sourceUrl.state === "supported"
        ? review.draft.extraction.sourceUrl.value
        : null,
  },
  tags: review.tags,
  version: review.version,
});
