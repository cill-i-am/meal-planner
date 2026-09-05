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
} from "@meal-planner/household-api";
import { Effect, Option, Schema } from "effect";

const MealPlanRecipeAuthorityFingerprint = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

export const MealPlanRecipeAuthorityToken = Schema.Struct({
  extractionFingerprint: MealPlanRecipeAuthorityFingerprint,
  reviewVersion: Schema.Number.pipe(
    Schema.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
    )
  ),
  tagsFingerprint: MealPlanRecipeAuthorityFingerprint,
});
export type MealPlanRecipeAuthorityToken =
  typeof MealPlanRecipeAuthorityToken.Type;

interface RankableMealPlanRecipe {
  readonly importId: MealPlanRecipeSnapshot["importId"];
  readonly tags: MealPlanRecipeSnapshot["tags"];
}

export interface MealPlanRecipeCandidate extends RankableMealPlanRecipe {
  readonly authorityToken: MealPlanRecipeAuthorityToken;
}

export interface MealPlanCandidateFrontier {
  readonly policy: MealPlanPolicy;
  readonly rankedCandidatesBySlot: readonly (readonly {
    readonly authorityToken: MealPlanRecipeAuthorityToken;
    readonly importId: MealPlanRecipeCandidate["importId"];
    readonly preferred: boolean;
  }[])[];
  readonly request: MealPlanRequest;
}

export interface MealPlanCandidateSelection {
  readonly assignments: readonly {
    readonly authorityToken: MealPlanRecipeAuthorityToken;
    readonly importId: MealPlanRecipeCandidate["importId"];
    readonly slot: MealPlanSlot;
  }[];
  readonly gaps: readonly MealPlanGap[];
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
    policy: MealPlanPolicy,
    proposal: MealPlanProposal
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
    request: ManualMealSwapRequest,
    replacement: MealPlanRecipeSnapshot | undefined
  ) => Effect.Effect<MealPlanDraft, MealPlanServiceError>;
}

const hasPreferredCuisine = (
  recipe: RankableMealPlanRecipe,
  policy: MealPlanPolicy
): boolean =>
  recipe.tags.cuisines.some((cuisine) =>
    policy.preferredCuisines.includes(cuisine)
  );

export const isRecipeEligibleForSlot = (
  recipe: RankableMealPlanRecipe,
  slot: MealPlanSlot,
  policy: MealPlanPolicy
): boolean =>
  recipe.tags.mealTypes.includes(slot.mealType) &&
  policy.allowedDietaryFit.includes(recipe.tags.dietaryFit) &&
  policy.allowedDifficulties.includes(recipe.tags.difficulty) &&
  policy.allowedTotalTimeBands.includes(recipe.tags.totalTimeBand);

const compareRankedCandidates = (
  left: {
    readonly authorityToken: MealPlanRecipeAuthorityToken;
    readonly importId: MealPlanRecipeCandidate["importId"];
    readonly preferred: boolean;
  },
  right: {
    readonly authorityToken: MealPlanRecipeAuthorityToken;
    readonly importId: MealPlanRecipeCandidate["importId"];
    readonly preferred: boolean;
  }
): number => {
  const preferredDifference = Number(right.preferred) - Number(left.preferred);
  return preferredDifference === 0
    ? left.importId.localeCompare(right.importId)
    : preferredDifference;
};

export const makeMealPlanCandidateFrontier = (input: {
  readonly policy: MealPlanPolicy;
  readonly request: MealPlanRequest;
}): MealPlanCandidateFrontier => ({
  policy: input.policy,
  rankedCandidatesBySlot: input.request.slots.map(() => []),
  request: input.request,
});

/**
 * Retains only the candidates that can still win the deterministic planner.
 *
 * A winner for slot `i` cannot rank below `i + 1` among that slot's eligible
 * candidates: making each higher-ranked candidate unavailable requires at
 * least one earlier assignment. Retaining the best `slotCount` candidates per
 * slot therefore preserves the complete greedy result while bounding the
 * frontier at `slotCount²` candidates (at most 961 for a valid request).
 */
export const addMealPlanCandidatePage = (
  frontier: MealPlanCandidateFrontier,
  page: readonly MealPlanRecipeCandidate[]
): MealPlanCandidateFrontier => {
  const rankedCandidatesBySlot = frontier.rankedCandidatesBySlot.map(
    (candidates) => [...candidates]
  );
  const maximumCandidatesPerSlot = frontier.request.slots.length;
  for (const candidate of page) {
    const preferred = hasPreferredCuisine(candidate, frontier.policy);
    for (const [slotIndex, slot] of frontier.request.slots.entries()) {
      if (!isRecipeEligibleForSlot(candidate, slot, frontier.policy)) {
        continue;
      }
      const rankedCandidates = rankedCandidatesBySlot[slotIndex];
      if (
        rankedCandidates === undefined ||
        rankedCandidates.some(({ importId }) => importId === candidate.importId)
      ) {
        continue;
      }
      rankedCandidates.push({
        authorityToken: candidate.authorityToken,
        importId: candidate.importId,
        preferred,
      });
      rankedCandidates.sort(compareRankedCandidates);
      if (rankedCandidates.length > maximumCandidatesPerSlot) {
        rankedCandidates.pop();
      }
    }
  }

  return {
    ...frontier,
    rankedCandidatesBySlot,
  };
};

export const selectMealPlanCandidates = (
  frontier: MealPlanCandidateFrontier
): MealPlanCandidateSelection => {
  const assignments: {
    readonly authorityToken: MealPlanRecipeAuthorityToken;
    readonly importId: MealPlanRecipeCandidate["importId"];
    readonly slot: MealPlanSlot;
  }[] = [];
  const gaps: MealPlanGap[] = [];
  const uses = new Map<string, number>();

  for (const [slotIndex, slot] of frontier.request.slots.entries()) {
    const candidate = frontier.rankedCandidatesBySlot[slotIndex]?.find(
      ({ importId }) =>
        (uses.get(importId) ?? 0) < frontier.policy.maxRecipeUses
    );
    if (candidate === undefined) {
      gaps.push({
        reason: "no_eligible_approved_recipe",
        slotId: slot.slotId,
      });
      continue;
    }

    uses.set(candidate.importId, (uses.get(candidate.importId) ?? 0) + 1);
    assignments.push({
      authorityToken: candidate.authorityToken,
      importId: candidate.importId,
      slot,
    });
  }

  return { assignments, gaps };
};

const draftIdFor = (request: MealPlanRequest): MealPlanDraftId =>
  Schema.decodeUnknownSync(MealPlanDraftId)(`draft-${request.requestKey}`);

const fingerprint = <S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  value: S["Type"]
): string => JSON.stringify(Schema.encodeSync(schema)(value));

const ManualMealSwapFingerprint = Schema.Struct({
  actorId: ManualMealSwapRequest.fields.actorId,
  draftId: ManualMealSwapRequest.fields.draftId,
  expectedRevision: ManualMealSwapRequest.fields.expectedRevision,
  mutationId: ManualMealSwapRequest.fields.mutationId,
  reason: ManualMealSwapRequest.fields.reason,
  replacementImportId: ManualMealSwapRequest.fields.replacementImportId,
  slotId: ManualMealSwapRequest.fields.slotId,
});

const MealPlanDecisionFingerprint = Schema.Struct({
  actorId: MealPlanDecisionRequest.fields.actorId,
  draftId: MealPlanDecisionRequest.fields.draftId,
  expectedRevision: MealPlanDecisionRequest.fields.expectedRevision,
  mutationId: MealPlanDecisionRequest.fields.mutationId,
  reason: MealPlanDecisionRequest.fields.reason,
});

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

export const makeMealPlanProposal = (
  selection: MealPlanCandidateSelection,
  recipes: ReadonlyMap<string, MealPlanRecipeSnapshot>,
  policy: MealPlanPolicy
): MealPlanProposal => ({
  gaps: selection.gaps,
  meals: selection.assignments.map(({ importId, slot }) => {
    const recipe = recipes.get(importId);
    if (recipe === undefined) {
      throw new Error("Selected meal-plan recipe is unavailable");
    }
    return {
      date: slot.date,
      mealType: slot.mealType,
      reasons: reasonsFor(recipe, policy),
      relevantTags: recipe.tags,
      servings: slot.servings,
      slotId: slot.slotId,
      sourceRecipe: recipe,
    };
  }),
});

export const makeMealPlanService = (input: {
  readonly drafts: MealPlanDraftRepository;
}): MealPlanService => {
  const decide = (
    request: MealPlanDecisionRequest,
    outcome: "approved" | "rejected"
  ) =>
    Effect.gen(function* decideMealPlanDraft() {
      const mutationFingerprint = `${outcome}:${fingerprint(
        MealPlanDecisionFingerprint,
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
    create: (request, policy, proposal) =>
      Effect.gen(function* createMealPlanDraft() {
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
    swap: (request, replacement) =>
      Effect.gen(function* swapMealPlanRecipe() {
        const mutationFingerprint = fingerprint(
          ManualMealSwapFingerprint,
          request
        );
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
