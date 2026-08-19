import {
  MealPlanDecisionRequest,
  MealPlanDraftId,
  MealPlanPolicy,
  MealPlanRequest,
  ManualMealSwapRequest,
} from "@meal-planner/household-api";
import type {
  MealPlan,
  MealPlanApproved,
  MealPlanDraft,
  MealPlanGap,
  MealPlanMutationConflict,
  MealPlanMutationId,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanProposal,
  MealPlanReason,
  MealPlanRecipeSnapshot,
  MealPlanRejected,
  MealPlanRequestConflict,
  MealPlanSlot,
  MealPlanSwapRejected,
  MealPlanTransitionRejected,
  MealPlanVersionConflict,
  PlannedMeal,
} from "@meal-planner/household-api";
import { Effect, Option, Schema } from "effect";

export {
  CreateMealPlanPayload,
  DecideMealPlanPayload,
  ManualMealSwapRequest,
  ManualSwapAudit,
  MealPlan,
  MealPlanActorId,
  MealPlanApproved,
  MealPlanDecisionRequest,
  MealPlanDraft,
  MealPlanDraftId,
  MealPlanDietaryFit,
  MealPlanDifficulty,
  MealPlanGap,
  MealPlanInstant,
  MealPlanLeftovers,
  MealPlanMealType,
  MealPlanMutationConflict,
  MealPlanMutationId,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanPolicy,
  MealPlanPolicyVersion,
  MealPlanProposal,
  MealPlanReason,
  MealPlanRecipeSnapshot,
  MealPlanRecipeSnapshotId,
  MealPlanRejected,
  MealPlanRequest,
  MealPlanRequestConflict,
  MealPlanRequestKey,
  MealPlanSlot,
  MealPlanSlotId,
  MealPlanSwapRejected,
  MealPlanTags,
  MealPlanTotalTimeBand,
  MealPlanTransitionRejected,
  MealPlanVersionConflict,
  PlannedMeal,
  SwapMealPlanPayload,
} from "@meal-planner/household-api";

export interface MealPlanPlanner {
  readonly plan: (input: {
    readonly approvedRecipes: readonly MealPlanRecipeSnapshot[];
    readonly policy: MealPlanPolicy;
    readonly request: MealPlanRequest;
  }) => Effect.Effect<MealPlanProposal>;
}

export interface MealPlanRecipeSource {
  readonly listApproved: () => Effect.Effect<
    readonly MealPlanRecipeSnapshot[],
    MealPlanPersistenceFailure
  >;
}

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
  | MealPlanPersistenceFailure
  | MealPlanTransitionRejected
  | MealPlanVersionConflict;

export interface MealPlanDraftRepository {
  readonly create: (input: {
    readonly draft: MealPlanDraft;
    readonly requestFingerprint: string;
  }) => Effect.Effect<
    MealPlan,
    MealPlanPersistenceFailure | MealPlanRequestConflict
  >;
  readonly find: (
    draftId: MealPlanDraftId
  ) => Effect.Effect<Option.Option<MealPlan>, MealPlanPersistenceFailure>;
  readonly findMutation: (input: {
    readonly draftId: MealPlanDraftId;
    readonly mutationFingerprint: string;
    readonly mutationId: MealPlanMutationId;
  }) => Effect.Effect<
    Option.Option<MealPlan>,
    MealPlanMutationConflict | MealPlanPersistenceFailure
  >;
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
  | MealPlanPersistenceFailure
  | MealPlanRequestConflict
  | MealPlanSwapRejected
  | MealPlanTransitionRejected
  | MealPlanVersionConflict;

export interface MealPlanService {
  readonly create: (
    request: MealPlanRequest,
    policy: MealPlanPolicy
  ) => Effect.Effect<MealPlan, MealPlanServiceError>;
  readonly read: (
    draftId: MealPlanDraftId
  ) => Effect.Effect<Option.Option<MealPlan>, MealPlanServiceError>;
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
  recipe: MealPlanRecipeSnapshot,
  policy: MealPlanPolicy
): boolean =>
  recipe.tags.cuisines.some((cuisine) =>
    policy.preferredCuisines.includes(cuisine)
  );

export const isRecipeEligibleForSlot = (
  recipe: MealPlanRecipeSnapshot,
  slot: MealPlanSlot,
  policy: MealPlanPolicy
): boolean =>
  includes(recipe.tags.mealTypes, slot.mealType) &&
  includes(policy.allowedDietaryFit, recipe.tags.dietaryFit) &&
  includes(policy.allowedDifficulties, recipe.tags.difficulty) &&
  includes(policy.allowedTotalTimeBands, recipe.tags.totalTimeBand);

const compareCandidates =
  (policy: MealPlanPolicy) =>
  (left: MealPlanRecipeSnapshot, right: MealPlanRecipeSnapshot): number => {
    const preferredDifference =
      Number(hasPreferredCuisine(right, policy)) -
      Number(hasPreferredCuisine(left, policy));
    return preferredDifference === 0
      ? left.importId.localeCompare(right.importId)
      : preferredDifference;
  };

export const makeDeterministicMealPlanPlanner = (): MealPlanPlanner => ({
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

const getPlan = (drafts: MealPlanDraftRepository, draftId: MealPlanDraftId) =>
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
  recipe: MealPlanRecipeSnapshot,
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
  readonly drafts: MealPlanDraftRepository;
  readonly planner: MealPlanPlanner;
  readonly recipeReviews: MealPlanRecipeSource;
}): MealPlanService => {
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
