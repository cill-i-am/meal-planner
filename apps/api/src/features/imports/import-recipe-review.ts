import { PlanningTags as PlanningTagsSchema } from "@meal-planner/recipe-import-api";
import type { CorrectedRecipe as CorrectedRecipeType } from "@meal-planner/recipe-import-api";
import { Option, Schema } from "effect";
import type { Effect } from "effect";

import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import { RecipeUnresolvedField } from "./import-recipe-extractor.js";
import {
  EvidenceReference,
  ImportId,
  ImportTimestamp,
} from "./import.contracts.js";
import type {
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
} from "./import.errors.js";

export { importPersistenceUnavailable as recipeReviewPersistenceUnavailable } from "./import.errors.js";
export {
  CorrectedRecipe,
  PlanningDietaryFit,
  PlanningDifficulty,
  PlanningLeftovers,
  PlanningMealType,
  PlanningTags,
  PlanningTotalTimeBand,
} from "@meal-planner/recipe-import-api";

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

export const RecipeCorrectionValue = Schema.Union([
  ShortText,
  SafeInteger,
  Schema.NonEmptyArray(ShortText).pipe(Schema.check(Schema.isMaxLength(256))),
  PlanningTagsSchema,
]);
export type RecipeCorrectionValue = typeof RecipeCorrectionValue.Type;

const TextRecipeCorrectionField = Schema.Literals([
  "author",
  "category",
  "cuisine",
  "description",
  "name",
  "nutrition",
  "yield",
]);
const IntegerRecipeCorrectionField = Schema.Literals([
  "cook_time_minutes",
  "prep_time_minutes",
  "temperature_celsius",
  "total_time_minutes",
]);
const ListRecipeCorrectionField = Schema.Literals([
  "ingredient_lines",
  "ingredient_quantities",
  "ingredient_units",
  "instructions",
  "tools",
]);

const RecipeCorrectionDetails = {
  actorId: RecipeReviewerActorId,
  correctedAt: ImportTimestamp,
  reason: ShortText,
  version: RecipeReviewVersion,
} as const;

export const RecipeCorrection = Schema.Union([
  Schema.Struct({
    ...RecipeCorrectionDetails,
    after: ShortText,
    before: Schema.NullOr(ShortText),
    field: TextRecipeCorrectionField,
  }),
  Schema.Struct({
    ...RecipeCorrectionDetails,
    after: SafeInteger,
    before: Schema.NullOr(SafeInteger),
    field: IntegerRecipeCorrectionField,
  }),
  Schema.Struct({
    ...RecipeCorrectionDetails,
    after: Schema.NonEmptyArray(ShortText).pipe(
      Schema.check(Schema.isMaxLength(256))
    ),
    before: Schema.NullOr(
      Schema.NonEmptyArray(ShortText).pipe(
        Schema.check(Schema.isMaxLength(256))
      )
    ),
    field: ListRecipeCorrectionField,
  }),
  Schema.Struct({
    ...RecipeCorrectionDetails,
    after: PlanningTagsSchema,
    before: Schema.NullOr(PlanningTagsSchema),
    field: Schema.Literal("tags"),
  }),
]);
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

export const RecipeReviewTransitionPolicy = Schema.Union([
  Schema.Struct({
    from: Schema.Literal("needs_review"),
    to: Schema.Literal("approved"),
  }),
  Schema.Struct({
    from: Schema.Literal("needs_review"),
    to: Schema.Literal("rejected"),
  }),
  Schema.Struct({
    from: Schema.Literal("approved"),
    to: Schema.Literal("needs_review"),
  }),
  Schema.Struct({
    from: Schema.Literal("rejected"),
    to: Schema.Literal("needs_review"),
  }),
]);
export type RecipeReviewTransitionPolicy =
  typeof RecipeReviewTransitionPolicy.Type;

export const recipeReviewTransitionPolicy = (
  from: RecipeReviewLifecycle,
  to: RecipeReviewLifecycle
): Option.Option<RecipeReviewTransitionPolicy> =>
  Schema.decodeUnknownOption(RecipeReviewTransitionPolicy)({ from, to });

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
  recipe: Schema.Struct({
    ingredientLines: Schema.NonEmptyArray(ShortText),
    instructions: Schema.NonEmptyArray(ShortText),
    name: ShortText,
  }),
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
    recipe: ApprovedRecipe.fields.recipe,
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

export const GetRecipeReviewResponse = Schema.Struct({
  review: Review,
});

export const ApprovedRecipeBankResponse = Schema.Struct({
  recipes: Schema.Array(ApprovedRecipe),
});

const requiredFields = [
  "name",
  "ingredient_lines",
  "instructions",
] as const satisfies readonly RecipeUnresolvedField[];

export const recipeReviewNullablePolicy = [
  "author",
  "category",
  "cook_time_minutes",
  "cuisine",
  "description",
  "ingredient_quantities",
  "ingredient_units",
  "nutrition",
  "prep_time_minutes",
  "temperature_celsius",
  "tools",
  "total_time_minutes",
  "yield",
] as const satisfies readonly RecipeUnresolvedField[];

const factValue = <A>(fact: {
  readonly state: "supported" | "unresolved";
  readonly value?: A;
}) => (fact.state === "supported" ? (fact.value ?? null) : null);

const listValue = (fact: RecipeDraft["extraction"]["ingredientLines"]) =>
  fact.state === "supported"
    ? (() => {
        const values = fact.items.flatMap((item) =>
          item.state === "supported" ? [item.value] : []
        );
        return values.length === 0 ? null : (values as [string, ...string[]]);
      })()
    : null;

type MutableCorrectedRecipe = {
  -readonly [K in keyof CorrectedRecipeType]: CorrectedRecipeType[K];
};

export const applyCorrectionOverlay = (
  draft: RecipeDraft,
  corrections: readonly RecipeCorrection[]
): CorrectedRecipeType => {
  const { extraction } = draft;
  const recipe: MutableCorrectedRecipe = {
    author: factValue(extraction.author),
    category: factValue(extraction.category),
    cookTimeMinutes: factValue(extraction.cookTimeMinutes),
    cuisine: factValue(extraction.cuisine),
    description: factValue(extraction.description),
    ingredientLines: listValue(extraction.ingredientLines),
    ingredientQuantities: null,
    ingredientUnits: null,
    instructions: listValue(extraction.instructions),
    name: factValue(extraction.name),
    nutrition: factValue(extraction.nutrition),
    prepTimeMinutes: factValue(extraction.prepTimeMinutes),
    temperatureCelsius: factValue(extraction.temperatureCelsius),
    tools: listValue(extraction.tools),
    totalTimeMinutes: factValue(extraction.totalTimeMinutes),
    yield: factValue(extraction.yield),
  };

  for (const correction of corrections) {
    switch (correction.field) {
      case "author": {
        recipe.author = correction.after;
        break;
      }
      case "category": {
        recipe.category = correction.after;
        break;
      }
      case "cook_time_minutes": {
        recipe.cookTimeMinutes = correction.after;
        break;
      }
      case "cuisine": {
        recipe.cuisine = correction.after;
        break;
      }
      case "description": {
        recipe.description = correction.after;
        break;
      }
      case "ingredient_lines": {
        recipe.ingredientLines = correction.after;
        break;
      }
      case "ingredient_quantities": {
        recipe.ingredientQuantities = correction.after;
        break;
      }
      case "ingredient_units": {
        recipe.ingredientUnits = correction.after;
        break;
      }
      case "instructions": {
        recipe.instructions = correction.after;
        break;
      }
      case "name": {
        recipe.name = correction.after;
        break;
      }
      case "nutrition": {
        recipe.nutrition = correction.after;
        break;
      }
      case "prep_time_minutes": {
        recipe.prepTimeMinutes = correction.after;
        break;
      }
      case "temperature_celsius": {
        recipe.temperatureCelsius = correction.after;
        break;
      }
      case "tools": {
        recipe.tools = correction.after;
        break;
      }
      case "total_time_minutes": {
        recipe.totalTimeMinutes = correction.after;
        break;
      }
      case "yield": {
        recipe.yield = correction.after;
        break;
      }
      case "tags": {
        break;
      }
      default: {
        correction satisfies never;
      }
    }
  }
  return recipe;
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
        recipe.ingredientLines === null ||
        recipe.instructions === null
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
          recipe: {
            ingredientLines: recipe.ingredientLines,
            instructions: recipe.instructions,
            name: recipe.name,
          },
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
  const correctedFields = new Set(corrections.map(({ field }) => field));
  const unresolvedRequiredFields = requiredFields.filter(
    (field) =>
      draft.extraction.unresolvedFields.includes(field) &&
      !correctedFields.has(field)
  );
  const invalidFields: RecipeUnresolvedField[] = [];
  if (
    recipe.prepTimeMinutes !== null &&
    recipe.cookTimeMinutes !== null &&
    recipe.totalTimeMinutes !== null &&
    recipe.totalTimeMinutes < recipe.prepTimeMinutes + recipe.cookTimeMinutes
  ) {
    invalidFields.push("total_time_minutes");
  }
  return { invalidFields, unresolvedRequiredFields };
};

export type RecipeReviewPersistenceError =
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable;

export interface RecipeReviewRepository {
  readonly find: (
    importId: ImportId
  ) => Effect.Effect<Option.Option<Review>, RecipeReviewPersistenceError>;
  readonly listApproved: () => Effect.Effect<
    readonly Review[],
    RecipeReviewPersistenceError
  >;
}

export type RecipeReviewServiceError = RecipeReviewPersistenceError;

export interface RecipeReviewService {
  readonly listApproved: () => Effect.Effect<
    readonly ApprovedRecipe[],
    RecipeReviewServiceError
  >;
}

export const projectApprovedReview = (
  review: ApprovedReview
): ApprovedRecipe => ({
  approvedAt: review.approvedAt,
  extractionFingerprint: review.draft.extractionFingerprint,
  importId: review.draft.importId,
  recipe: review.recipe,
  source: {
    evidenceFingerprint: review.draft.evidenceFingerprint,
    sourceUrl: factValue(review.draft.extraction.sourceUrl),
  },
  tags: review.tags,
  version: review.version,
});

export const projectApprovedRecipe = (
  review: RecipeReviewView
): ApprovedRecipe => {
  const refined = refineRecipeReview(review);
  if (Option.isNone(refined) || refined.value._tag !== "Approved") {
    throw new Error("Approved recipe invariant was not satisfied");
  }
  return projectApprovedReview(refined.value);
};
