import type {
  MealPlan,
  MealPlanDraftId,
  ManualMealSwapRequest,
} from "@meal-planner/household-api";
import {
  MealPlanRecipeSnapshot,
  MealPlanRecipeSnapshotId,
  MealPlanPolicy,
  MealPlanRequest,
} from "@meal-planner/household-api";
import { PlanningTags } from "@meal-planner/recipe-domain";
import { Effect, Option, Schema } from "effect";

import {
  addMealPlanCandidatePage,
  makeMealPlanCandidateFrontier,
  makeMealPlanProposal,
  selectMealPlanCandidates,
  makeMealPlanService,
  mealPlanMutationConflict,
  mealPlanNotFound,
  mealPlanRequestConflict,
  mealPlanTransitionRejected,
  mealPlanVersionConflict,
} from "./meal-plan.js";
import type { MealPlanDraftRepository } from "./meal-plan.js";

const decodeRecipeId = Schema.decodeUnknownSync(MealPlanRecipeSnapshotId);
const decodeTags = Schema.decodeUnknownSync(PlanningTags);
const mediterraneanDinnerTags = decodeTags({
  cuisines: ["Synthetic Mediterranean"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["dinner"],
  totalTimeBand: "under_30_minutes",
});

const replacementDinnerTags = decodeTags({
  cuisines: ["Synthetic Weeknight"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "two_plus_meals",
  mealTypes: ["dinner"],
  totalTimeBand: "under_30_minutes",
});

const hardDinnerTags = decodeTags({
  cuisines: ["Synthetic Weekend"],
  dietaryFit: "household_match",
  difficulty: "hard",
  leftovers: "none",
  mealTypes: ["dinner"],
  totalTimeBand: "under_30_minutes",
});

export const syntheticReplacementRecipeId = decodeRecipeId(
  "018f47ad-91aa-7c35-b6fe-000000000403"
);
export const syntheticHardConstraintRecipeId = decodeRecipeId(
  "018f47ad-91aa-7c35-b6fe-000000000404"
);
export const syntheticRejectedRecipeId = decodeRecipeId(
  "018f47ad-91aa-7c35-b6fe-000000000402"
);

export const syntheticApprovedRecipes = [
  {
    fingerprint: "b",
    importId: "018f47ad-91aa-7c35-b6fe-000000000401",
    name: "Synthetic Tomato Orzo",
    tags: mediterraneanDinnerTags,
  },
  {
    fingerprint: "d",
    importId: syntheticReplacementRecipeId,
    name: "Synthetic Bean Traybake",
    tags: replacementDinnerTags,
  },
  {
    fingerprint: "e",
    importId: syntheticHardConstraintRecipeId,
    name: "Synthetic Elaborate Pie",
    tags: hardDinnerTags,
  },
].map(({ importId, name, tags, fingerprint }) =>
  Schema.decodeUnknownSync(MealPlanRecipeSnapshot)({
    approvedAt: "2026-07-22T10:01:00.000Z",
    extractionFingerprint: fingerprint.repeat(64),
    importId,
    recipe: {
      ingredientLines: ["1 synthetic ingredient"],
      instructions: ["Assemble the synthetic recipe."],
      name,
    },
    source: {
      evidenceFingerprint: "a".repeat(64),
      sourceUrl: `https://example.test/recipes/${importId}`,
    },
    tags,
    version: 1,
  })
);

export const syntheticPlanningPolicy = Schema.decodeUnknownSync(MealPlanPolicy)(
  {
    allowedDietaryFit: ["household_match"],
    allowedDifficulties: ["easy"],
    allowedTotalTimeBands: ["under_30_minutes"],
    maxRecipeUses: 1,
    preferredCuisines: ["Synthetic Mediterranean"],
    version: "synthetic-policy-v1",
  }
);

export const syntheticMealPlanRequest = Schema.decodeUnknownSync(
  MealPlanRequest
)({
  requestKey: "synthetic-week-1",
  slots: [
    {
      date: "2026-07-27",
      mealType: "dinner",
      servings: 2,
      slotId: "synthetic-dinner",
    },
    {
      date: "2026-07-28",
      mealType: "breakfast",
      servings: 2,
      slotId: "synthetic-breakfast",
    },
  ],
});

const mutationKey = (draftId: string, mutationId: string) =>
  `${draftId}:${mutationId}`;

export const makeInMemoryMealPlanDraftRepository = (): {
  readonly drafts: MealPlan[];
  readonly repository: MealPlanDraftRepository;
} => {
  const drafts: MealPlan[] = [];
  const requestFingerprints = new Map<string, string>();
  const mutations = new Map<
    string,
    { readonly fingerprint: string; readonly result: MealPlan }
  >();
  return {
    drafts,
    repository: {
      create: ({ draft, requestFingerprint }) =>
        Effect.gen(function* createSyntheticDraft() {
          const existing = drafts.find(
            ({ draftId }) => draftId === draft.draftId
          );
          if (existing !== undefined) {
            return requestFingerprints.get(draft.draftId) === requestFingerprint
              ? existing
              : yield* Effect.fail(mealPlanRequestConflict(draft.draftId));
          }
          drafts.push(draft);
          requestFingerprints.set(draft.draftId, requestFingerprint);
          return draft;
        }),
      find: (draftId: MealPlanDraftId) =>
        Effect.succeed(
          Option.fromNullishOr(
            drafts.find((draft) => draft.draftId === draftId)
          )
        ),
      findMutation: ({ draftId, mutationFingerprint, mutationId }) =>
        Effect.gen(function* findSyntheticMutation() {
          const mutation = mutations.get(mutationKey(draftId, mutationId));
          if (mutation === undefined) {
            return Option.none<MealPlan>();
          }
          return mutation.fingerprint === mutationFingerprint
            ? Option.some(mutation.result)
            : yield* Effect.fail(mealPlanMutationConflict(mutationId));
        }),
      save: (input) =>
        Effect.gen(function* saveSyntheticMealPlan() {
          const key = mutationKey(input.next.draftId, input.mutationId);
          const replay = mutations.get(key);
          if (replay !== undefined) {
            return replay.fingerprint === input.mutationFingerprint
              ? replay.result
              : yield* Effect.fail(mealPlanMutationConflict(input.mutationId));
          }

          const index = drafts.findIndex(
            ({ draftId }) => draftId === input.next.draftId
          );
          const current = drafts[index];
          if (current === undefined) {
            return yield* Effect.fail(mealPlanNotFound(input.next.draftId));
          }
          if (current._tag !== "Draft") {
            return yield* Effect.fail(mealPlanTransitionRejected(current._tag));
          }
          if (current.revision !== input.expectedRevision) {
            return yield* Effect.fail(
              mealPlanVersionConflict(input.expectedRevision, current.revision)
            );
          }
          if (input.next.revision !== current.revision + 1) {
            return yield* Effect.die("Synthetic revision invariant failed");
          }

          drafts[index] = input.next;
          mutations.set(key, {
            fingerprint: input.mutationFingerprint,
            result: input.next,
          });
          return input.next;
        }),
    },
  };
};

export const makeSyntheticMealPlanTracer = () => {
  const draftRepository = makeInMemoryMealPlanDraftRepository();
  const service = makeMealPlanService({ drafts: draftRepository.repository });
  return {
    drafts: draftRepository.drafts,
    service: {
      ...service,
      create: (request: MealPlanRequest, policy: MealPlanPolicy) => {
        const recipes = syntheticApprovedRecipes;
        const selection = selectMealPlanCandidates(
          addMealPlanCandidatePage(
            makeMealPlanCandidateFrontier({ policy, request }),
            recipes.map((recipe) => ({
              authorityToken: {
                extractionFingerprint: recipe.extractionFingerprint,
                reviewVersion: recipe.version,
                tagsFingerprint: recipe.extractionFingerprint,
              },
              importId: recipe.importId,
              tags: recipe.tags,
            }))
          )
        );
        return service.create(
          request,
          policy,
          makeMealPlanProposal(
            selection,
            new Map(recipes.map((recipe) => [recipe.importId, recipe])),
            policy
          )
        );
      },
      swap: (request: ManualMealSwapRequest) =>
        service.swap(
          request,
          syntheticApprovedRecipes.find(
            ({ importId }) => importId === request.replacementImportId
          )
        ),
    },
  };
};
