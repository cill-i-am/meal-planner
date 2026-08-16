import { PlanningTags as PlanningTagsSchema } from "@meal-planner/recipe-import-api";
import type {
  CorrectedRecipe as CorrectedRecipeType,
  PlanningTags as PlanningTagsType,
} from "@meal-planner/recipe-import-api";
import { Context, DateTime, Effect, Option, Schema } from "effect";

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

export const RecipeReviewMutationId = TrimmedNonEmptyString.pipe(
  Schema.check(
    Schema.isMaxLength(128),
    Schema.isPattern(/^[a-z\d][a-z\d._:-]*$/iu)
  ),
  Schema.brand("RecipeReviewMutationId")
);
export type RecipeReviewMutationId = typeof RecipeReviewMutationId.Type;

export const RecipeReviewCommandDigest = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u)),
  Schema.brand("RecipeReviewCommandDigest")
);
export type RecipeReviewCommandDigest = typeof RecipeReviewCommandDigest.Type;

export const RecipeCorrectionValue = Schema.Union([
  ShortText,
  SafeInteger,
  Schema.NonEmptyArray(ShortText).pipe(Schema.check(Schema.isMaxLength(256))),
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

const RecipeCorrectionRequestDetails = {
  reason: ShortText,
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

export const CorrectRecipeDraftRequest = Schema.Struct({
  correction: Schema.Union([
    Schema.Struct({
      ...RecipeCorrectionRequestDetails,
      field: TextRecipeCorrectionField,
      value: ShortText,
    }),
    Schema.Struct({
      ...RecipeCorrectionRequestDetails,
      field: IntegerRecipeCorrectionField,
      value: SafeInteger,
    }),
    Schema.Struct({
      ...RecipeCorrectionRequestDetails,
      field: ListRecipeCorrectionField,
      value: Schema.NonEmptyArray(ShortText).pipe(
        Schema.check(Schema.isMaxLength(256))
      ),
    }),
  ]),
  expectedVersion: RecipeReviewVersion,
  mutationId: RecipeReviewMutationId,
  tags: PlanningTagsSchema,
});
export type CorrectRecipeDraftRequest = typeof CorrectRecipeDraftRequest.Type;

export const TransitionRecipeDraftRequest = Schema.Struct({
  expectedVersion: RecipeReviewVersion,
  mutationId: RecipeReviewMutationId,
  reason: ShortText,
});
export type TransitionRecipeDraftRequest =
  typeof TransitionRecipeDraftRequest.Type;

export const RecipeReviewCommand = Schema.TaggedUnion({
  Correction: {
    actorId: RecipeReviewerActorId,
    correction: CorrectRecipeDraftRequest.fields.correction,
    expectedVersion: RecipeReviewVersion,
    extractionFingerprint: Schema.String.pipe(
      Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
    ),
    tags: PlanningTagsSchema,
  },
  Transition: {
    actorId: RecipeReviewerActorId,
    expectedVersion: RecipeReviewVersion,
    extractionFingerprint: Schema.String.pipe(
      Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
    ),
    reason: ShortText,
    to: RecipeReviewLifecycle,
  },
});
export type RecipeReviewCommand = typeof RecipeReviewCommand.Type;

const canonicalRecipeReviewCommand = (command: RecipeReviewCommand): string => {
  switch (command._tag) {
    case "Correction": {
      return JSON.stringify({
        actorId: command.actorId,
        correction: {
          field: command.correction.field,
          reason: command.correction.reason,
          value: command.correction.value,
        },
        expectedVersion: command.expectedVersion,
        kind: "correction",
        reviewIdentity: command.extractionFingerprint,
        tags: {
          cuisines: command.tags.cuisines,
          dietaryFit: command.tags.dietaryFit,
          difficulty: command.tags.difficulty,
          leftovers: command.tags.leftovers,
          mealTypes: command.tags.mealTypes,
          totalTimeBand: command.tags.totalTimeBand,
        },
      });
    }
    case "Transition": {
      return JSON.stringify({
        actorId: command.actorId,
        expectedVersion: command.expectedVersion,
        kind: "transition",
        reason: command.reason,
        reviewIdentity: command.extractionFingerprint,
        to: command.to,
      });
    }
    default: {
      return command satisfies never;
    }
  }
};

const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

export const recipeReviewCommandDigest = Effect.fn(
  "RecipeReview.commandDigest"
)((command: RecipeReviewCommand) =>
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonicalRecipeReviewCommand(command))
    )
  ).pipe(
    Effect.map(bytesToHex),
    Effect.map(Schema.decodeUnknownSync(RecipeReviewCommandDigest))
  )
);

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

export const RecipeReviewMutationOutcome = Schema.TaggedUnion({
  Applied: {
    mutationId: RecipeReviewMutationId,
    resultingVersion: RecipeReviewVersion,
    review: Review,
  },
  Replayed: {
    mutationId: RecipeReviewMutationId,
    resultingVersion: RecipeReviewVersion,
    review: Review,
  },
});
export type RecipeReviewMutationOutcome =
  typeof RecipeReviewMutationOutcome.Type;

export const GetRecipeReviewResponse = Schema.Struct({
  review: Review,
});

export const RecipeReviewMutationResponse = Schema.Struct({
  outcome: RecipeReviewMutationOutcome,
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

export interface RecipeReviewMutationConflict {
  readonly _tag: "RecipeReviewMutationConflict";
  readonly mutationId: RecipeReviewMutationId;
}
export const RecipeReviewMutationConflict =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeReviewMutationConflict>()(
    "RecipeReviewMutationConflict",
    { mutationId: RecipeReviewMutationId }
  );

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
  | RecipeReviewMutationConflict
  | RecipeReviewTransitionRejected
  | RecipeReviewVersionConflict;
export type RecipeReviewServiceError =
  | InvalidRecipeCorrection
  | RecipeApprovalBlocked
  | RecipeReviewNotFound
  | RecipeReviewWriteError;

export interface RecipeReviewRepositoryShape {
  readonly correct: (input: {
    readonly commandDigest: RecipeReviewCommandDigest;
    readonly correction: RecipeCorrection;
    readonly expectedVersion: RecipeReviewVersion;
    readonly extractionFingerprint: string;
    readonly mutationId: RecipeReviewMutationId;
    readonly previousTags: PlanningTagsType | null;
    readonly tags: PlanningTagsType;
  }) => Effect.Effect<RecipeReviewMutationOutcome, RecipeReviewWriteError>;
  readonly find: (
    importId: ImportId
  ) => Effect.Effect<Option.Option<Review>, RecipeReviewPersistenceError>;
  readonly findMutationOutcome: (input: {
    readonly commandDigest: RecipeReviewCommandDigest;
    readonly extractionFingerprint: string;
    readonly mutationId: RecipeReviewMutationId;
  }) => Effect.Effect<
    Option.Option<RecipeReviewMutationOutcome>,
    RecipeReviewMutationConflict | RecipeReviewPersistenceError
  >;
  readonly listApproved: () => Effect.Effect<
    readonly Review[],
    RecipeReviewPersistenceError
  >;
  readonly transition: (input: {
    readonly commandDigest: RecipeReviewCommandDigest;
    readonly expectedVersion: RecipeReviewVersion;
    readonly extractionFingerprint: string;
    readonly mutationId: RecipeReviewMutationId;
    readonly transition: RecipeReviewTransition;
  }) => Effect.Effect<RecipeReviewMutationOutcome, RecipeReviewWriteError>;
}

export const authenticatedRecipeReviewer = Schema.decodeUnknownSync(
  RecipeReviewerActorId
)("private_api_credential");

const currentValueFor = (
  review: Review,
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
  review: Review,
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
  ) => Effect.Effect<RecipeReviewMutationOutcome, RecipeReviewServiceError>;
  readonly correct: (
    importId: ImportId,
    request: CorrectRecipeDraftRequest,
    actorId: RecipeReviewerActorId
  ) => Effect.Effect<RecipeReviewMutationOutcome, RecipeReviewServiceError>;
  readonly get: (
    importId: ImportId
  ) => Effect.Effect<Review, RecipeReviewServiceError>;
  readonly listApproved: () => Effect.Effect<
    readonly ApprovedRecipe[],
    RecipeReviewServiceError
  >;
  readonly reject: (
    importId: ImportId,
    request: TransitionRecipeDraftRequest,
    actorId: RecipeReviewerActorId
  ) => Effect.Effect<RecipeReviewMutationOutcome, RecipeReviewServiceError>;
  readonly returnToReview: (
    importId: ImportId,
    request: TransitionRecipeDraftRequest,
    actorId: RecipeReviewerActorId
  ) => Effect.Effect<RecipeReviewMutationOutcome, RecipeReviewServiceError>;
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

export const makeRecipeReviewService = (input: {
  readonly now: () => ImportTimestamp;
  readonly repository: RecipeReviewRepositoryShape;
}): RecipeReviewServiceShape => {
  const transition = Effect.fn("RecipeReview.transition")(
    function* transitionRecipeReview(
      importId: ImportId,
      request: TransitionRecipeDraftRequest,
      actorId: RecipeReviewerActorId,
      to: RecipeReviewLifecycle
    ) {
      const review = yield* getReview(input.repository, importId);
      const command = RecipeReviewCommand.make({
        _tag: "Transition",
        actorId,
        expectedVersion: request.expectedVersion,
        extractionFingerprint: review.draft.extractionFingerprint,
        reason: request.reason,
        to,
      });
      const commandDigest = yield* recipeReviewCommandDigest(command);
      yield* Effect.annotateCurrentSpan({
        "recipeReview.commandDigest": commandDigest,
        "recipeReview.mutationId": request.mutationId,
        "recipeReview.reviewIdentity": review.draft.extractionFingerprint,
      });
      const existing = yield* input.repository.findMutationOutcome({
        commandDigest,
        extractionFingerprint: review.draft.extractionFingerprint,
        mutationId: request.mutationId,
      });
      if (Option.isSome(existing)) {
        yield* Effect.annotateCurrentSpan(
          "recipeReview.result",
          existing.value._tag
        );
        return existing.value;
      }
      yield* assertExpectedVersion(review, request.expectedVersion);
      const policy = recipeReviewTransitionPolicy(review.lifecycle, to);
      if (Option.isNone(policy)) {
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
      const outcome = yield* input.repository.transition({
        commandDigest,
        expectedVersion: request.expectedVersion,
        extractionFingerprint: review.draft.extractionFingerprint,
        mutationId: request.mutationId,
        transition: Schema.decodeUnknownSync(RecipeReviewTransition)({
          actorId,
          from: policy.value.from,
          reason: request.reason,
          to: policy.value.to,
          transitionedAt: DateTime.formatIso(input.now()),
          version: nextVersion,
        }),
      });
      yield* Effect.annotateCurrentSpan("recipeReview.result", outcome._tag);
      return outcome;
    }
  );

  const correct = Effect.fn("RecipeReview.correct")(
    function* correctRecipeReview(
      importId: ImportId,
      request: CorrectRecipeDraftRequest,
      actorId: RecipeReviewerActorId
    ) {
      const review = yield* getReview(input.repository, importId);
      const command = RecipeReviewCommand.make({
        _tag: "Correction",
        actorId,
        correction: request.correction,
        expectedVersion: request.expectedVersion,
        extractionFingerprint: review.draft.extractionFingerprint,
        tags: request.tags,
      });
      const commandDigest = yield* recipeReviewCommandDigest(command);
      yield* Effect.annotateCurrentSpan({
        "recipeReview.commandDigest": commandDigest,
        "recipeReview.mutationId": request.mutationId,
        "recipeReview.reviewIdentity": review.draft.extractionFingerprint,
      });
      const existing = yield* input.repository.findMutationOutcome({
        commandDigest,
        extractionFingerprint: review.draft.extractionFingerprint,
        mutationId: request.mutationId,
      });
      if (Option.isSome(existing)) {
        yield* Effect.annotateCurrentSpan(
          "recipeReview.result",
          existing.value._tag
        );
        return existing.value;
      }
      yield* assertExpectedVersion(review, request.expectedVersion);
      if (review.lifecycle !== "needs_review") {
        return yield* Effect.fail(
          recipeReviewTransitionRejected(review.lifecycle)
        );
      }
      const nextVersion = request.expectedVersion + 1;
      const outcome = yield* input.repository.correct({
        commandDigest,
        correction: Schema.decodeUnknownSync(RecipeCorrection)({
          actorId,
          after: request.correction.value,
          before: currentValueFor(review, request.correction.field),
          correctedAt: DateTime.formatIso(input.now()),
          field: request.correction.field,
          reason: request.correction.reason,
          version: nextVersion,
        }),
        expectedVersion: request.expectedVersion,
        extractionFingerprint: review.draft.extractionFingerprint,
        mutationId: request.mutationId,
        previousTags: review.tags,
        tags: request.tags,
      });
      yield* Effect.annotateCurrentSpan("recipeReview.result", outcome._tag);
      return outcome;
    }
  );

  return {
    approve: (importId, request, actorId) =>
      transition(importId, request, actorId, "approved"),
    correct,
    get: (importId) => getReview(input.repository, importId),
    listApproved: () =>
      input.repository.listApproved().pipe(
        Effect.filterOrFail(
          (reviews) => reviews.every((review) => review._tag === "Approved"),
          importPersistenceCorrupt
        ),
        Effect.map((reviews) =>
          reviews.map((review) => projectApprovedReview(review))
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
