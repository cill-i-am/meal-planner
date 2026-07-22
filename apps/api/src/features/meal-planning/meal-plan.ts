import { Effect, Option, Schema } from "effect";

import type {
  RecipeReviewServiceError,
  RecipeReviewServiceShape,
} from "../imports/import-recipe-review.js";
import {
  ApprovedRecipe,
  PlanningDietaryFit,
  PlanningDifficulty,
  PlanningMealType,
  PlanningTags,
  PlanningTotalTimeBand,
} from "../imports/import-recipe-review.js";
import { ImportId, ImportTimestamp } from "../imports/import.contracts.js";

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);
const ShortIdentifier = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(128))
);
const PositiveInteger = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);

export const MealPlanRequestKey = ShortIdentifier.pipe(
  Schema.brand("MealPlanRequestKey")
);
export type MealPlanRequestKey = typeof MealPlanRequestKey.Type;

export const MealPlanDraftId = ShortIdentifier.pipe(
  Schema.brand("MealPlanDraftId")
);
export type MealPlanDraftId = typeof MealPlanDraftId.Type;

export const MealPlanPolicyVersion = ShortIdentifier.pipe(
  Schema.brand("MealPlanPolicyVersion")
);
export type MealPlanPolicyVersion = typeof MealPlanPolicyVersion.Type;

export const MealPlanSlotId = ShortIdentifier.pipe(
  Schema.brand("MealPlanSlotId")
);
export type MealPlanSlotId = typeof MealPlanSlotId.Type;

export const MealPlanActorId = ShortIdentifier.pipe(
  Schema.brand("MealPlanActorId")
);
export type MealPlanActorId = typeof MealPlanActorId.Type;

export const MealPlanMutationId = ShortIdentifier.pipe(
  Schema.brand("MealPlanMutationId")
);
export type MealPlanMutationId = typeof MealPlanMutationId.Type;

export const MealPlanSlot = Schema.Struct({
  date: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u))
  ),
  mealType: PlanningMealType,
  servings: PositiveInteger,
  slotId: MealPlanSlotId,
});
export type MealPlanSlot = typeof MealPlanSlot.Type;

export const MealPlanRequest = Schema.Struct({
  requestKey: MealPlanRequestKey,
  slots: Schema.NonEmptyArray(MealPlanSlot),
}).check(
  Schema.makeFilter((request) =>
    new Set(request.slots.map(({ slotId }) => slotId)).size ===
    request.slots.length
      ? undefined
      : { issue: "Meal-plan slot IDs must be unique", path: ["slots"] }
  )
);
export type MealPlanRequest = typeof MealPlanRequest.Type;

export const MealPlanPolicy = Schema.Struct({
  allowedDietaryFit: Schema.NonEmptyArray(PlanningDietaryFit),
  allowedDifficulties: Schema.NonEmptyArray(PlanningDifficulty),
  allowedTotalTimeBands: Schema.NonEmptyArray(PlanningTotalTimeBand),
  maxRecipeUses: PositiveInteger,
  preferredCuisines: Schema.Array(TrimmedNonEmptyString),
  version: MealPlanPolicyVersion,
});
export type MealPlanPolicy = typeof MealPlanPolicy.Type;

export const MealPlanReason = Schema.Literals([
  "approved_recipe",
  "meal_type_match",
  "hard_constraints_satisfied",
  "preferred_cuisine",
]);
export type MealPlanReason = typeof MealPlanReason.Type;

export const PlannedMeal = Schema.Struct({
  date: MealPlanSlot.fields.date,
  mealType: PlanningMealType,
  reasons: Schema.NonEmptyArray(MealPlanReason),
  relevantTags: PlanningTags,
  servings: PositiveInteger,
  slotId: MealPlanSlotId,
  sourceRecipe: ApprovedRecipe,
});
export type PlannedMeal = typeof PlannedMeal.Type;

export const MealPlanGap = Schema.Struct({
  reason: Schema.Literal("no_eligible_approved_recipe"),
  slotId: MealPlanSlotId,
});
export type MealPlanGap = typeof MealPlanGap.Type;

export const ManualSwapAudit = Schema.Struct({
  actorId: MealPlanActorId,
  fromRecipe: ApprovedRecipe,
  mutationId: MealPlanMutationId,
  reason: TrimmedNonEmptyString,
  slotId: MealPlanSlotId,
  swappedAt: ImportTimestamp,
  toRecipe: ApprovedRecipe,
});
export type ManualSwapAudit = typeof ManualSwapAudit.Type;

const MealPlanRecordFields = {
  audit: Schema.Array(ManualSwapAudit),
  draftId: MealPlanDraftId,
  gaps: Schema.Array(MealPlanGap),
  meals: Schema.Array(PlannedMeal),
  policy: MealPlanPolicy,
  request: MealPlanRequest,
  revision: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  ),
} as const;

export const MealPlanDraft = Schema.Struct({
  ...MealPlanRecordFields,
  _tag: Schema.Literal("Draft"),
});
export type MealPlanDraft = typeof MealPlanDraft.Type;

const MealPlanDecisionFields = {
  actorId: MealPlanActorId,
  decidedAt: ImportTimestamp,
  mutationId: MealPlanMutationId,
  reason: TrimmedNonEmptyString,
} as const;

export const MealPlanApproved = Schema.Struct({
  ...MealPlanRecordFields,
  _tag: Schema.Literal("Approved"),
  decision: Schema.Struct({
    ...MealPlanDecisionFields,
    outcome: Schema.Literal("approved"),
  }),
});
export type MealPlanApproved = typeof MealPlanApproved.Type;

export const MealPlanRejected = Schema.Struct({
  ...MealPlanRecordFields,
  _tag: Schema.Literal("Rejected"),
  decision: Schema.Struct({
    ...MealPlanDecisionFields,
    outcome: Schema.Literal("rejected"),
  }),
});
export type MealPlanRejected = typeof MealPlanRejected.Type;

export const MealPlan = Schema.Union([
  MealPlanDraft,
  MealPlanApproved,
  MealPlanRejected,
]);
export type MealPlan = typeof MealPlan.Type;

export const MealPlanProposal = Schema.Struct({
  gaps: Schema.Array(MealPlanGap),
  meals: Schema.Array(PlannedMeal),
});
export type MealPlanProposal = typeof MealPlanProposal.Type;

export interface MealPlanPlannerShape {
  readonly plan: (input: {
    readonly approvedRecipes: readonly ApprovedRecipe[];
    readonly policy: MealPlanPolicy;
    readonly request: MealPlanRequest;
  }) => Effect.Effect<MealPlanProposal>;
}

export const ManualMealSwapRequest = Schema.Struct({
  actorId: MealPlanActorId,
  draftId: MealPlanDraftId,
  expectedRevision: MealPlanRecordFields.revision,
  mutationId: MealPlanMutationId,
  reason: TrimmedNonEmptyString,
  replacementImportId: ImportId,
  slotId: MealPlanSlotId,
  swappedAt: ImportTimestamp,
});
export type ManualMealSwapRequest = typeof ManualMealSwapRequest.Type;

export const MealPlanDecisionRequest = Schema.Struct({
  actorId: MealPlanActorId,
  decidedAt: ImportTimestamp,
  draftId: MealPlanDraftId,
  expectedRevision: MealPlanRecordFields.revision,
  mutationId: MealPlanMutationId,
  reason: TrimmedNonEmptyString,
});
export type MealPlanDecisionRequest = typeof MealPlanDecisionRequest.Type;

export const MealPlanRequestConflict = Schema.TaggedStruct(
  "MealPlanRequestConflict",
  { draftId: MealPlanDraftId }
);
export type MealPlanRequestConflict = typeof MealPlanRequestConflict.Type;

export const MealPlanNotFound = Schema.TaggedStruct("MealPlanNotFound", {
  draftId: MealPlanDraftId,
});
export type MealPlanNotFound = typeof MealPlanNotFound.Type;

export const MealPlanVersionConflict = Schema.TaggedStruct(
  "MealPlanVersionConflict",
  {
    actualRevision: MealPlanRecordFields.revision,
    expectedRevision: MealPlanRecordFields.revision,
  }
);
export type MealPlanVersionConflict = typeof MealPlanVersionConflict.Type;

export const MealPlanTransitionRejected = Schema.TaggedStruct(
  "MealPlanTransitionRejected",
  { lifecycle: Schema.Literals(["Draft", "Approved", "Rejected"]) }
);
export type MealPlanTransitionRejected = typeof MealPlanTransitionRejected.Type;

export const MealPlanSwapRejected = Schema.TaggedStruct(
  "MealPlanSwapRejected",
  {
    reason: Schema.Literals([
      "slot_not_found",
      "recipe_not_approved",
      "hard_constraint_violation",
      "same_recipe",
    ]),
  }
);
export type MealPlanSwapRejected = typeof MealPlanSwapRejected.Type;

export const MealPlanMutationConflict = Schema.TaggedStruct(
  "MealPlanMutationConflict",
  { mutationId: MealPlanMutationId }
);
export type MealPlanMutationConflict = typeof MealPlanMutationConflict.Type;

export const mealPlanRequestConflict = (
  draftId: MealPlanDraftId
): MealPlanRequestConflict => ({
  _tag: "MealPlanRequestConflict",
  draftId,
});
export const mealPlanNotFound = (
  draftId: MealPlanDraftId
): MealPlanNotFound => ({
  _tag: "MealPlanNotFound",
  draftId,
});
export const mealPlanVersionConflict = (
  expectedRevision: number,
  actualRevision: number
): MealPlanVersionConflict => ({
  _tag: "MealPlanVersionConflict",
  actualRevision,
  expectedRevision,
});
export const mealPlanTransitionRejected = (
  lifecycle: MealPlan["_tag"]
): MealPlanTransitionRejected => ({
  _tag: "MealPlanTransitionRejected",
  lifecycle,
});
export const mealPlanSwapRejected = (
  reason: MealPlanSwapRejected["reason"]
): MealPlanSwapRejected => ({ _tag: "MealPlanSwapRejected", reason });
export const mealPlanMutationConflict = (
  mutationId: MealPlanMutationId
): MealPlanMutationConflict => ({
  _tag: "MealPlanMutationConflict",
  mutationId,
});

export type MealPlanRepositoryError =
  | MealPlanMutationConflict
  | MealPlanNotFound
  | MealPlanTransitionRejected
  | MealPlanVersionConflict;

export interface MealPlanDraftRepositoryShape {
  readonly create: (input: {
    readonly draft: MealPlanDraft;
    readonly requestFingerprint: string;
  }) => Effect.Effect<MealPlan, MealPlanRequestConflict>;
  readonly find: (
    draftId: MealPlanDraftId
  ) => Effect.Effect<Option.Option<MealPlan>>;
  readonly findMutation: (input: {
    readonly draftId: MealPlanDraftId;
    readonly mutationFingerprint: string;
    readonly mutationId: MealPlanMutationId;
  }) => Effect.Effect<Option.Option<MealPlan>, MealPlanMutationConflict>;
  readonly save: (input: {
    readonly expectedRevision: number;
    readonly mutationFingerprint: string;
    readonly mutationId: MealPlanMutationId;
    readonly next: MealPlan;
  }) => Effect.Effect<MealPlan, MealPlanRepositoryError>;
}

export type MealPlanServiceError =
  | MealPlanMutationConflict
  | MealPlanNotFound
  | MealPlanRequestConflict
  | MealPlanSwapRejected
  | MealPlanTransitionRejected
  | MealPlanVersionConflict
  | RecipeReviewServiceError;

export interface MealPlanServiceShape {
  readonly create: (
    request: MealPlanRequest,
    policy: MealPlanPolicy
  ) => Effect.Effect<MealPlan, MealPlanServiceError>;
  readonly read: (
    draftId: MealPlanDraftId
  ) => Effect.Effect<Option.Option<MealPlan>>;
  readonly approve: (
    request: MealPlanDecisionRequest
  ) => Effect.Effect<MealPlanApproved, MealPlanServiceError>;
  readonly reject: (
    request: MealPlanDecisionRequest
  ) => Effect.Effect<MealPlanRejected, MealPlanServiceError>;
  readonly swap: (
    request: ManualMealSwapRequest
  ) => Effect.Effect<MealPlanDraft, MealPlanServiceError>;
}

const includes = <A>(values: readonly A[], value: A): boolean =>
  values.includes(value);

const hasPreferredCuisine = (
  recipe: ApprovedRecipe,
  policy: MealPlanPolicy
): boolean =>
  recipe.tags.cuisines.some((cuisine) =>
    policy.preferredCuisines.includes(cuisine)
  );

export const isRecipeEligibleForSlot = (
  recipe: ApprovedRecipe,
  slot: MealPlanSlot,
  policy: MealPlanPolicy
): boolean =>
  includes(recipe.tags.mealTypes, slot.mealType) &&
  includes(policy.allowedDietaryFit, recipe.tags.dietaryFit) &&
  includes(policy.allowedDifficulties, recipe.tags.difficulty) &&
  includes(policy.allowedTotalTimeBands, recipe.tags.totalTimeBand);

const compareCandidates =
  (policy: MealPlanPolicy) =>
  (left: ApprovedRecipe, right: ApprovedRecipe): number => {
    const preferredDifference =
      Number(hasPreferredCuisine(right, policy)) -
      Number(hasPreferredCuisine(left, policy));
    return preferredDifference === 0
      ? left.importId.localeCompare(right.importId)
      : preferredDifference;
  };

export const makeDeterministicMealPlanPlanner = (): MealPlanPlannerShape => ({
  plan: ({ approvedRecipes, policy, request }) =>
    Effect.sync(() => {
      const meals: PlannedMeal[] = [];
      const gaps: MealPlanGap[] = [];
      const uses = new Map<string, number>();

      for (const slot of request.slots) {
        const [recipe] = approvedRecipes
          .filter(
            (candidate) =>
              isRecipeEligibleForSlot(candidate, slot, policy) &&
              (uses.get(candidate.importId) ?? 0) < policy.maxRecipeUses
          )
          .toSorted(compareCandidates(policy));

        if (recipe === undefined) {
          gaps.push({
            reason: "no_eligible_approved_recipe",
            slotId: slot.slotId,
          });
          continue;
        }

        uses.set(recipe.importId, (uses.get(recipe.importId) ?? 0) + 1);
        const reasons: [MealPlanReason, ...MealPlanReason[]] = [
          "approved_recipe",
          "meal_type_match",
          "hard_constraints_satisfied",
        ];
        if (hasPreferredCuisine(recipe, policy)) {
          reasons.push("preferred_cuisine");
        }
        meals.push({
          date: slot.date,
          mealType: slot.mealType,
          reasons,
          relevantTags: recipe.tags,
          servings: slot.servings,
          slotId: slot.slotId,
          sourceRecipe: recipe,
        });
      }

      return { gaps, meals };
    }),
});

const draftIdFor = (request: MealPlanRequest): MealPlanDraftId =>
  Schema.decodeUnknownSync(MealPlanDraftId)(`draft-${request.requestKey}`);

const fingerprint = <S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  value: S["Type"]
): string => JSON.stringify(Schema.encodeSync(schema)(value));

const getPlan = (
  drafts: MealPlanDraftRepositoryShape,
  draftId: MealPlanDraftId
) =>
  drafts.find(draftId).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(mealPlanNotFound(draftId)),
        onSome: Effect.succeed,
      })
    )
  );

const assertDraft = (plan: MealPlan) =>
  plan._tag === "Draft"
    ? Effect.succeed(plan)
    : Effect.fail(mealPlanTransitionRejected(plan._tag));

const assertRevision = (plan: MealPlan, expectedRevision: number) =>
  plan.revision === expectedRevision
    ? Effect.void
    : Effect.fail(mealPlanVersionConflict(expectedRevision, plan.revision));

const reasonsFor = (
  recipe: ApprovedRecipe,
  policy: MealPlanPolicy
): readonly [MealPlanReason, ...MealPlanReason[]] => {
  const reasons: [MealPlanReason, ...MealPlanReason[]] = [
    "approved_recipe",
    "meal_type_match",
    "hard_constraints_satisfied",
  ];
  if (hasPreferredCuisine(recipe, policy)) {
    reasons.push("preferred_cuisine");
  }
  return reasons;
};

export const makeMealPlanService = (input: {
  readonly drafts: MealPlanDraftRepositoryShape;
  readonly planner: MealPlanPlannerShape;
  readonly recipeReviews: Pick<RecipeReviewServiceShape, "listApproved">;
}): MealPlanServiceShape => {
  const decide = (
    request: MealPlanDecisionRequest,
    outcome: "approved" | "rejected"
  ) =>
    Effect.gen(function* decideMealPlanDraft() {
      const mutationFingerprint = `${outcome}:${fingerprint(
        MealPlanDecisionRequest,
        request
      )}`;
      const replay = yield* input.drafts.findMutation({
        draftId: request.draftId,
        mutationFingerprint,
        mutationId: request.mutationId,
      });
      if (Option.isSome(replay)) {
        const expectedTag = outcome === "approved" ? "Approved" : "Rejected";
        return replay.value._tag === expectedTag
          ? replay.value
          : yield* Effect.die("Stored decision replay has an invalid outcome");
      }

      const current = yield* getPlan(input.drafts, request.draftId);
      const draft = yield* assertDraft(current);
      yield* assertRevision(draft, request.expectedRevision);
      const revision = draft.revision + 1;
      const next: MealPlan =
        outcome === "approved"
          ? {
              ...draft,
              _tag: "Approved",
              decision: {
                actorId: request.actorId,
                decidedAt: request.decidedAt,
                mutationId: request.mutationId,
                outcome: "approved",
                reason: request.reason,
              },
              revision,
            }
          : {
              ...draft,
              _tag: "Rejected",
              decision: {
                actorId: request.actorId,
                decidedAt: request.decidedAt,
                mutationId: request.mutationId,
                outcome: "rejected",
                reason: request.reason,
              },
              revision,
            };
      return yield* input.drafts.save({
        expectedRevision: request.expectedRevision,
        mutationFingerprint,
        mutationId: request.mutationId,
        next,
      });
    });

  return {
    approve: (request) =>
      decide(request, "approved").pipe(
        Effect.flatMap((plan) =>
          plan._tag === "Approved"
            ? Effect.succeed(plan)
            : Effect.die("Approved decision returned an invalid lifecycle")
        )
      ),
    create: (request, policy) =>
      Effect.gen(function* createMealPlanDraft() {
        const approvedRecipes = yield* input.recipeReviews.listApproved();
        const proposal = yield* input.planner.plan({
          approvedRecipes,
          policy,
          request,
        });
        const draft: MealPlanDraft = {
          _tag: "Draft",
          audit: [],
          draftId: draftIdFor(request),
          gaps: proposal.gaps,
          meals: proposal.meals,
          policy,
          request,
          revision: 0,
        };
        return yield* input.drafts.create({
          draft,
          requestFingerprint: fingerprint(
            Schema.Struct({ policy: MealPlanPolicy, request: MealPlanRequest }),
            { policy, request }
          ),
        });
      }),
    read: input.drafts.find,
    reject: (request) =>
      decide(request, "rejected").pipe(
        Effect.flatMap((plan) =>
          plan._tag === "Rejected"
            ? Effect.succeed(plan)
            : Effect.die("Rejected decision returned an invalid lifecycle")
        )
      ),
    swap: (request) =>
      Effect.gen(function* swapMealPlanRecipe() {
        const mutationFingerprint = fingerprint(ManualMealSwapRequest, request);
        const replay = yield* input.drafts.findMutation({
          draftId: request.draftId,
          mutationFingerprint,
          mutationId: request.mutationId,
        });
        if (Option.isSome(replay)) {
          return replay.value._tag === "Draft"
            ? replay.value
            : yield* Effect.die("Stored swap replay has an invalid lifecycle");
        }

        const current = yield* getPlan(input.drafts, request.draftId);
        const draft = yield* assertDraft(current);
        yield* assertRevision(draft, request.expectedRevision);
        const mealIndex = draft.meals.findIndex(
          ({ slotId }) => slotId === request.slotId
        );
        const currentMeal = draft.meals[mealIndex];
        const slot = draft.request.slots.find(
          ({ slotId }) => slotId === request.slotId
        );
        if (currentMeal === undefined || slot === undefined) {
          return yield* Effect.fail(mealPlanSwapRejected("slot_not_found"));
        }

        const approvedRecipes = yield* input.recipeReviews.listApproved();
        const replacement = approvedRecipes.find(
          ({ importId }) => importId === request.replacementImportId
        );
        if (replacement === undefined) {
          return yield* Effect.fail(
            mealPlanSwapRejected("recipe_not_approved")
          );
        }
        const existingReplacementUses = draft.meals.filter(
          ({ slotId, sourceRecipe }) =>
            slotId !== request.slotId &&
            sourceRecipe.importId === replacement.importId
        ).length;
        if (
          !isRecipeEligibleForSlot(replacement, slot, draft.policy) ||
          existingReplacementUses >= draft.policy.maxRecipeUses
        ) {
          return yield* Effect.fail(
            mealPlanSwapRejected("hard_constraint_violation")
          );
        }
        if (replacement.importId === currentMeal.sourceRecipe.importId) {
          return yield* Effect.fail(mealPlanSwapRejected("same_recipe"));
        }

        const meals = [...draft.meals];
        meals[mealIndex] = {
          ...currentMeal,
          reasons: reasonsFor(replacement, draft.policy),
          relevantTags: replacement.tags,
          sourceRecipe: replacement,
        };
        const next: MealPlanDraft = {
          ...draft,
          audit: [
            ...draft.audit,
            {
              actorId: request.actorId,
              fromRecipe: currentMeal.sourceRecipe,
              mutationId: request.mutationId,
              reason: request.reason,
              slotId: request.slotId,
              swappedAt: request.swappedAt,
              toRecipe: replacement,
            },
          ],
          meals,
          revision: draft.revision + 1,
        };
        const saved = yield* input.drafts.save({
          expectedRevision: request.expectedRevision,
          mutationFingerprint,
          mutationId: request.mutationId,
          next,
        });
        return saved._tag === "Draft"
          ? saved
          : yield* Effect.die("Swap returned an invalid lifecycle");
      }),
  };
};
