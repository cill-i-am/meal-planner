import { Context, Effect, Option, Schema } from "effect";

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
import { importPersistenceCorrupt } from "./import.errors.js";

export { importPersistenceUnavailable as recipeReviewPersistenceUnavailable } from "./import.errors.js";

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
]);
export type RecipeCorrectionValue = typeof RecipeCorrectionValue.Type;

export const PlanningDietaryFit = Schema.Literals([
  "household_match",
  "needs_adaptation",
  "not_suitable",
]);
export type PlanningDietaryFit = typeof PlanningDietaryFit.Type;

export const PlanningDifficulty = Schema.Literals(["easy", "medium", "hard"]);
export type PlanningDifficulty = typeof PlanningDifficulty.Type;

export const PlanningLeftovers = Schema.Literals([
  "none",
  "one_meal",
  "two_plus_meals",
]);
export type PlanningLeftovers = typeof PlanningLeftovers.Type;

export const PlanningMealType = Schema.Literals([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "dessert",
]);
export type PlanningMealType = typeof PlanningMealType.Type;

export const PlanningTotalTimeBand = Schema.Literals([
  "under_30_minutes",
  "30_to_60_minutes",
  "over_60_minutes",
  "unknown",
]);
export type PlanningTotalTimeBand = typeof PlanningTotalTimeBand.Type;

export const PlanningTags = Schema.Struct({
  cuisines: Schema.NonEmptyArray(TrimmedNonEmptyString).pipe(
    Schema.check(Schema.isMaxLength(8))
  ),
  dietaryFit: PlanningDietaryFit,
  difficulty: PlanningDifficulty,
  leftovers: PlanningLeftovers,
  mealTypes: Schema.NonEmptyArray(PlanningMealType).pipe(
    Schema.check(Schema.isMaxLength(5))
  ),
  totalTimeBand: PlanningTotalTimeBand,
});
export type PlanningTags = typeof PlanningTags.Type;

export const RecipeCorrection = Schema.Struct({
  actorId: RecipeReviewerActorId,
  after: RecipeCorrectionValue,
  before: Schema.NullOr(RecipeCorrectionValue),
  correctedAt: ImportTimestamp,
  field: RecipeUnresolvedField,
  reason: ShortText,
  version: RecipeReviewVersion,
});
export type RecipeCorrection = typeof RecipeCorrection.Type;

export const RecipeReviewTransition = Schema.Struct({
  actorId: RecipeReviewerActorId,
  from: Schema.Literals(["needs_review", "approved", "rejected"]),
  reason: ShortText,
  to: Schema.Literals(["needs_review", "approved", "rejected"]),
  transitionedAt: ImportTimestamp,
  version: RecipeReviewVersion,
});
export type RecipeReviewTransition = typeof RecipeReviewTransition.Type;

export const RecipeReviewLifecycle = Schema.Literals([
  "needs_review",
  "approved",
  "rejected",
]);
export type RecipeReviewLifecycle = typeof RecipeReviewLifecycle.Type;

export const CorrectedRecipe = Schema.Struct({
  author: Schema.NullOr(ShortText),
  category: Schema.NullOr(ShortText),
  cookTimeMinutes: Schema.NullOr(SafeInteger),
  cuisine: Schema.NullOr(ShortText),
  description: Schema.NullOr(ShortText),
  ingredientLines: Schema.NullOr(Schema.NonEmptyArray(ShortText)),
  ingredientQuantities: Schema.NullOr(Schema.NonEmptyArray(ShortText)),
  ingredientUnits: Schema.NullOr(Schema.NonEmptyArray(ShortText)),
  instructions: Schema.NullOr(Schema.NonEmptyArray(ShortText)),
  name: Schema.NullOr(ShortText),
  nutrition: Schema.NullOr(ShortText),
  prepTimeMinutes: Schema.NullOr(SafeInteger),
  temperatureCelsius: Schema.NullOr(SafeInteger),
  tools: Schema.NullOr(Schema.NonEmptyArray(ShortText)),
  totalTimeMinutes: Schema.NullOr(SafeInteger),
  yield: Schema.NullOr(ShortText),
});
export type CorrectedRecipe = typeof CorrectedRecipe.Type;

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
  tags: Schema.NullOr(PlanningTags),
  transitions: Schema.Array(RecipeReviewTransition),
  unresolvedRequiredFields: Schema.Array(RecipeUnresolvedField),
  version: RecipeReviewVersion,
});
export type RecipeReviewView = typeof RecipeReviewView.Type;

export const GetRecipeReviewResponse = Schema.Struct({
  review: RecipeReviewView,
});

export const CorrectRecipeDraftRequest = Schema.Struct({
  correction: Schema.Struct({
    field: RecipeUnresolvedField,
    reason: ShortText,
    value: RecipeCorrectionValue,
  }),
  expectedVersion: RecipeReviewVersion,
  tags: PlanningTags,
});
export type CorrectRecipeDraftRequest = typeof CorrectRecipeDraftRequest.Type;

export const TransitionRecipeDraftRequest = Schema.Struct({
  expectedVersion: RecipeReviewVersion,
  reason: ShortText,
});
export type TransitionRecipeDraftRequest =
  typeof TransitionRecipeDraftRequest.Type;

export const RecipeReviewMutationResponse = Schema.Struct({
  review: RecipeReviewView,
});

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
  tags: PlanningTags,
  version: RecipeReviewVersion,
});
export type ApprovedRecipe = typeof ApprovedRecipe.Type;

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
  -readonly [K in keyof CorrectedRecipe]: CorrectedRecipe[K];
};

export const applyCorrectionOverlay = (
  draft: RecipeDraft,
  corrections: readonly RecipeCorrection[]
): CorrectedRecipe => {
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
        recipe.author = correction.after as string;
        break;
      }
      case "category": {
        recipe.category = correction.after as string;
        break;
      }
      case "cook_time_minutes": {
        recipe.cookTimeMinutes = correction.after as number;
        break;
      }
      case "cuisine": {
        recipe.cuisine = correction.after as string;
        break;
      }
      case "description": {
        recipe.description = correction.after as string;
        break;
      }
      case "ingredient_lines": {
        recipe.ingredientLines = correction.after as readonly [
          string,
          ...string[],
        ];
        break;
      }
      case "ingredient_quantities": {
        recipe.ingredientQuantities = correction.after as readonly [
          string,
          ...string[],
        ];
        break;
      }
      case "ingredient_units": {
        recipe.ingredientUnits = correction.after as readonly [
          string,
          ...string[],
        ];
        break;
      }
      case "instructions": {
        recipe.instructions = correction.after as readonly [
          string,
          ...string[],
        ];
        break;
      }
      case "name": {
        recipe.name = correction.after as string;
        break;
      }
      case "nutrition": {
        recipe.nutrition = correction.after as string;
        break;
      }
      case "prep_time_minutes": {
        recipe.prepTimeMinutes = correction.after as number;
        break;
      }
      case "temperature_celsius": {
        recipe.temperatureCelsius = correction.after as number;
        break;
      }
      case "tools": {
        recipe.tools = correction.after as readonly [string, ...string[]];
        break;
      }
      case "total_time_minutes": {
        recipe.totalTimeMinutes = correction.after as number;
        break;
      }
      case "yield": {
        recipe.yield = correction.after as string;
        break;
      }
      default: {
        correction.field satisfies never;
      }
    }
  }
  return recipe;
};

const correctionValueMatchesField = (
  field: RecipeUnresolvedField,
  value: RecipeCorrectionValue
) => {
  switch (field) {
    case "cook_time_minutes":
    case "prep_time_minutes":
    case "temperature_celsius":
    case "total_time_minutes": {
      return typeof value === "number";
    }
    case "ingredient_lines":
    case "ingredient_quantities":
    case "ingredient_units":
    case "instructions":
    case "tools": {
      return Array.isArray(value);
    }
    default: {
      return typeof value === "string";
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

export interface RecipeReviewNotFound {
  readonly _tag: "RecipeReviewNotFound";
}
export interface InvalidRecipeCorrection {
  readonly _tag: "InvalidRecipeCorrection";
  readonly field: RecipeUnresolvedField;
}
export interface RecipeReviewVersionConflict {
  readonly _tag: "RecipeReviewVersionConflict";
  readonly actualVersion: RecipeReviewVersion;
  readonly expectedVersion: RecipeReviewVersion;
}
export interface RecipeReviewTransitionRejected {
  readonly _tag: "RecipeReviewTransitionRejected";
  readonly lifecycle: RecipeReviewLifecycle;
}
export interface RecipeApprovalBlocked {
  readonly _tag: "RecipeApprovalBlocked";
  readonly blockers: ApprovalBlockers;
  readonly tagsRequired: boolean;
}

export const recipeReviewNotFound = (): RecipeReviewNotFound => ({
  _tag: "RecipeReviewNotFound",
});
export const invalidRecipeCorrection = (
  field: RecipeUnresolvedField
): InvalidRecipeCorrection => ({ _tag: "InvalidRecipeCorrection", field });
export const recipeReviewVersionConflict = (
  expectedVersion: RecipeReviewVersion,
  actualVersion: RecipeReviewVersion
): RecipeReviewVersionConflict => ({
  _tag: "RecipeReviewVersionConflict",
  actualVersion,
  expectedVersion,
});
export const recipeReviewTransitionRejected = (
  lifecycle: RecipeReviewLifecycle
): RecipeReviewTransitionRejected => ({
  _tag: "RecipeReviewTransitionRejected",
  lifecycle,
});
export const recipeApprovalBlocked = (
  blockers: ApprovalBlockers,
  tagsRequired: boolean
): RecipeApprovalBlocked => ({
  _tag: "RecipeApprovalBlocked",
  blockers,
  tagsRequired,
});

export type RecipeReviewPersistenceError =
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable;
export type RecipeReviewWriteError =
  | RecipeReviewPersistenceError
  | RecipeReviewTransitionRejected
  | RecipeReviewVersionConflict;
export type RecipeReviewServiceError =
  | InvalidRecipeCorrection
  | RecipeApprovalBlocked
  | RecipeReviewNotFound
  | RecipeReviewWriteError;

export interface RecipeReviewRepositoryShape {
  readonly correct: (input: {
    readonly correction: RecipeCorrection;
    readonly expectedVersion: RecipeReviewVersion;
    readonly extractionFingerprint: string;
    readonly previousTags: PlanningTags | null;
    readonly tags: PlanningTags;
  }) => Effect.Effect<RecipeReviewView, RecipeReviewWriteError>;
  readonly find: (
    importId: ImportId
  ) => Effect.Effect<
    Option.Option<RecipeReviewView>,
    RecipeReviewPersistenceError
  >;
  readonly listApproved: () => Effect.Effect<
    readonly RecipeReviewView[],
    RecipeReviewPersistenceError
  >;
  readonly transition: (input: {
    readonly expectedVersion: RecipeReviewVersion;
    readonly extractionFingerprint: string;
    readonly transition: RecipeReviewTransition;
  }) => Effect.Effect<RecipeReviewView, RecipeReviewWriteError>;
}

export const authenticatedRecipeReviewer = Schema.decodeUnknownSync(
  RecipeReviewerActorId
)("private_api_credential");

const currentValueFor = (
  review: RecipeReviewView,
  field: RecipeUnresolvedField
): RecipeCorrectionValue | null => {
  const recipe = applyCorrectionOverlay(review.draft, review.corrections);
  switch (field) {
    case "author": {
      return recipe.author;
    }
    case "category": {
      return recipe.category;
    }
    case "cook_time_minutes": {
      return recipe.cookTimeMinutes;
    }
    case "cuisine": {
      return recipe.cuisine;
    }
    case "description": {
      return recipe.description;
    }
    case "ingredient_lines": {
      return recipe.ingredientLines;
    }
    case "ingredient_quantities": {
      return recipe.ingredientQuantities;
    }
    case "ingredient_units": {
      return recipe.ingredientUnits;
    }
    case "instructions": {
      return recipe.instructions;
    }
    case "name": {
      return recipe.name;
    }
    case "nutrition": {
      return recipe.nutrition;
    }
    case "prep_time_minutes": {
      return recipe.prepTimeMinutes;
    }
    case "temperature_celsius": {
      return recipe.temperatureCelsius;
    }
    case "tools": {
      return recipe.tools;
    }
    case "total_time_minutes": {
      return recipe.totalTimeMinutes;
    }
    case "yield": {
      return recipe.yield;
    }
    default: {
      return field satisfies never;
    }
  }
};

const getReview = (
  repository: RecipeReviewRepositoryShape,
  importId: ImportId
) =>
  repository.find(importId).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(recipeReviewNotFound()),
        onSome: Effect.succeed,
      })
    )
  );

const assertExpectedVersion = (
  review: RecipeReviewView,
  expectedVersion: RecipeReviewVersion
) =>
  review.version === expectedVersion
    ? Effect.void
    : Effect.fail(recipeReviewVersionConflict(expectedVersion, review.version));

export interface RecipeReviewServiceShape {
  readonly approve: (
    importId: ImportId,
    request: TransitionRecipeDraftRequest,
    actorId: RecipeReviewerActorId
  ) => Effect.Effect<RecipeReviewView, RecipeReviewServiceError>;
  readonly correct: (
    importId: ImportId,
    request: CorrectRecipeDraftRequest,
    actorId: RecipeReviewerActorId
  ) => Effect.Effect<RecipeReviewView, RecipeReviewServiceError>;
  readonly get: (
    importId: ImportId
  ) => Effect.Effect<RecipeReviewView, RecipeReviewServiceError>;
  readonly listApproved: () => Effect.Effect<
    readonly ApprovedRecipe[],
    RecipeReviewServiceError
  >;
  readonly reject: (
    importId: ImportId,
    request: TransitionRecipeDraftRequest,
    actorId: RecipeReviewerActorId
  ) => Effect.Effect<RecipeReviewView, RecipeReviewServiceError>;
  readonly returnToReview: (
    importId: ImportId,
    request: TransitionRecipeDraftRequest,
    actorId: RecipeReviewerActorId
  ) => Effect.Effect<RecipeReviewView, RecipeReviewServiceError>;
}

export const projectApprovedRecipe = (
  review: RecipeReviewView
): ApprovedRecipe => {
  const recipe = applyCorrectionOverlay(review.draft, review.corrections);
  const approved = [...review.transitions]
    .toReversed()
    .find(({ to }) => to === "approved");
  if (
    review.lifecycle !== "approved" ||
    review.tags === null ||
    approved === undefined ||
    recipe.name === null ||
    recipe.ingredientLines === null ||
    recipe.instructions === null
  ) {
    throw new Error("Approved recipe invariant was not satisfied");
  }
  return {
    approvedAt: approved.transitionedAt,
    extractionFingerprint: review.draft.extractionFingerprint,
    importId: review.draft.importId,
    recipe: {
      ingredientLines: recipe.ingredientLines,
      instructions: recipe.instructions,
      name: recipe.name,
    },
    source: {
      evidenceFingerprint: review.draft.evidenceFingerprint,
      sourceUrl: factValue(review.draft.extraction.sourceUrl),
    },
    tags: review.tags,
    version: review.version,
  };
};

export const makeRecipeReviewService = (input: {
  readonly now: () => ImportTimestamp;
  readonly repository: RecipeReviewRepositoryShape;
}): RecipeReviewServiceShape => {
  const transition = (
    importId: ImportId,
    request: TransitionRecipeDraftRequest,
    actorId: RecipeReviewerActorId,
    to: RecipeReviewLifecycle
  ) =>
    Effect.gen(function* transitionRecipeReview() {
      const review = yield* getReview(input.repository, importId);
      yield* assertExpectedVersion(review, request.expectedVersion);
      const allowed =
        (to === "approved" && review.lifecycle === "needs_review") ||
        (to === "rejected" && review.lifecycle === "needs_review") ||
        (to === "needs_review" && review.lifecycle !== "needs_review");
      if (!allowed) {
        return yield* Effect.fail(
          recipeReviewTransitionRejected(review.lifecycle)
        );
      }
      if (to === "approved") {
        const blockers = approvalBlockers(review.draft, review.corrections);
        if (
          blockers.invalidFields.length > 0 ||
          blockers.unresolvedRequiredFields.length > 0 ||
          review.tags === null
        ) {
          return yield* Effect.fail(
            recipeApprovalBlocked(blockers, review.tags === null)
          );
        }
      }
      const nextVersion = request.expectedVersion + 1;
      return yield* input.repository.transition({
        expectedVersion: request.expectedVersion,
        extractionFingerprint: review.draft.extractionFingerprint,
        transition: {
          actorId,
          from: review.lifecycle,
          reason: request.reason,
          to,
          transitionedAt: input.now(),
          version: nextVersion,
        },
      });
    });

  return {
    approve: (importId, request, actorId) =>
      transition(importId, request, actorId, "approved"),
    correct: (importId, request, actorId) =>
      Effect.gen(function* correctRecipeDraft() {
        const review = yield* getReview(input.repository, importId);
        yield* assertExpectedVersion(review, request.expectedVersion);
        if (review.lifecycle !== "needs_review") {
          return yield* Effect.fail(
            recipeReviewTransitionRejected(review.lifecycle)
          );
        }
        if (
          !correctionValueMatchesField(
            request.correction.field,
            request.correction.value
          )
        ) {
          return yield* Effect.fail(
            invalidRecipeCorrection(request.correction.field)
          );
        }
        const nextVersion = request.expectedVersion + 1;
        return yield* input.repository.correct({
          correction: {
            actorId,
            after: request.correction.value,
            before: currentValueFor(review, request.correction.field),
            correctedAt: input.now(),
            field: request.correction.field,
            reason: request.correction.reason,
            version: nextVersion,
          },
          expectedVersion: request.expectedVersion,
          extractionFingerprint: review.draft.extractionFingerprint,
          previousTags: review.tags,
          tags: request.tags,
        });
      }),
    get: (importId) => getReview(input.repository, importId),
    listApproved: () =>
      input.repository.listApproved().pipe(
        Effect.filterOrFail(
          (reviews) =>
            reviews.every((review) => review.lifecycle === "approved"),
          importPersistenceCorrupt
        ),
        Effect.flatMap((reviews) =>
          Effect.try({
            catch: importPersistenceCorrupt,
            try: () => reviews.map(projectApprovedRecipe),
          })
        )
      ),
    reject: (importId, request, actorId) =>
      transition(importId, request, actorId, "rejected"),
    returnToReview: (importId, request, actorId) =>
      transition(importId, request, actorId, "needs_review"),
  };
};

export class RecipeReviewService extends Context.Service<
  RecipeReviewService,
  RecipeReviewServiceShape
>()("meal-planner/RecipeReviewService") {}
