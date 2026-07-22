import { Effect, Option, Schema } from "effect";

import { RecipeDraft } from "../imports/import-recipe-draft.repository.d1.js";
import {
  PlanningTags,
  RecipeReviewView,
  projectApprovedRecipe,
} from "../imports/import-recipe-review.js";
import { ImportId } from "../imports/import.contracts.js";
import {
  MealPlanPolicy,
  MealPlanRequest,
  makeDeterministicMealPlanPlanner,
  makeMealPlanService,
  mealPlanMutationConflict,
  mealPlanNotFound,
  mealPlanRequestConflict,
  mealPlanTransitionRejected,
  mealPlanVersionConflict,
} from "./meal-plan.js";
import type {
  MealPlan,
  MealPlanDraftId,
  MealPlanDraftRepositoryShape,
} from "./meal-plan.js";

const decodeImportId = Schema.decodeUnknownSync(ImportId);
const decodeTags = Schema.decodeUnknownSync(PlanningTags);

const citation = {
  citations: [
    {
      confidence: 1,
      evidenceId: "synthetic:fixture",
      origin: "creator_provided" as const,
    },
  ],
  origin: "creator_provided" as const,
  state: "supported" as const,
};
const supportedString = (value: string) => ({ ...citation, value });
const supportedNumber = (value: number) => ({ ...citation, value });
const supportedList = (values: readonly string[]) => ({
  items: values.map(supportedString),
  state: "supported" as const,
});
const unresolved = (reason: string) => ({
  citations: [] as const,
  origin: "unresolved" as const,
  reason,
  state: "unresolved" as const,
});

const fixtureHash = (character: string) => character.repeat(64);

const makeSyntheticDraft = (input: {
  readonly fingerprintCharacter: string;
  readonly importId: string;
  readonly name: string;
}) =>
  Schema.decodeUnknownSync(RecipeDraft)({
    createdAt: "2026-07-22T10:00:00.000Z",
    evidenceFingerprint: fixtureHash("a"),
    extraction: {
      author: supportedString("Synthetic Cook"),
      category: supportedString("Synthetic recipe"),
      cookTimeMinutes: supportedNumber(15),
      cost: {
        certainty: "known",
        currency: "USD",
        estimatedMicroUsd: 0,
      },
      cuisine: supportedString("Synthetic cuisine"),
      description: supportedString("Provider-free synthetic test data."),
      ingredientLines: supportedList(["1 synthetic ingredient"]),
      instructions: supportedList(["Assemble the synthetic recipe."]),
      name: supportedString(input.name),
      nutrition: unresolved("Not relevant to the synthetic tracer."),
      prepTimeMinutes: supportedNumber(10),
      sourceUrl: supportedString(
        `https://example.test/recipes/${input.importId}`
      ),
      supportedClaims: supportedList(["Synthetic fixture only."]),
      temperatureCelsius: unresolved("Not relevant to the synthetic tracer."),
      tools: supportedList(["Synthetic pan"]),
      totalTimeMinutes: supportedNumber(25),
      unresolvedFields: [
        "nutrition",
        "temperature_celsius",
        "ingredient_quantities",
        "ingredient_units",
      ],
      usage: {
        inputEvidenceItems: 1,
        inputTokens: 0,
        latencyMilliseconds: 0,
        modelCalls: 1,
        outputTokens: 0,
      },
      yield: supportedString("2 servings"),
    },
    extractionFingerprint: fixtureHash(input.fingerprintCharacter),
    extractor: {
      model: "none",
      provider: "synthetic_fixture",
      version: "1",
    },
    generation: 1,
    importId: input.importId,
    lifecycle: "needs_review",
    schemaVersion: 1,
  });

const makeSyntheticReview = (input: {
  readonly fingerprintCharacter: string;
  readonly importId: string;
  readonly lifecycle: "approved" | "rejected";
  readonly name: string;
  readonly tags: PlanningTags;
}): RecipeReviewView => {
  const draft = makeSyntheticDraft(input);
  return Schema.decodeUnknownSync(RecipeReviewView)({
    corrections: [],
    draft: Schema.encodeSync(RecipeDraft)(draft),
    evidence: [],
    lifecycle: input.lifecycle,
    nullablePolicy: [
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
    ],
    tags: input.tags,
    transitions: [
      {
        actorId: "synthetic_reviewer",
        from: "needs_review",
        reason: "Synthetic fixture lifecycle.",
        to: input.lifecycle,
        transitionedAt: "2026-07-22T10:01:00.000Z",
        version: 1,
      },
    ],
    unresolvedRequiredFields: [],
    version: 1,
  });
};

const mediterraneanDinnerTags = decodeTags({
  cuisines: ["Synthetic Mediterranean"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["dinner"],
  totalTimeBand: "under_30_minutes",
});

const breakfastTags = decodeTags({
  cuisines: ["Synthetic Breakfast"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "none",
  mealTypes: ["breakfast"],
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

export const syntheticReplacementRecipeId = decodeImportId(
  "018f47ad-91aa-7c35-b6fe-000000000403"
);
export const syntheticHardConstraintRecipeId = decodeImportId(
  "018f47ad-91aa-7c35-b6fe-000000000404"
);
export const syntheticRejectedRecipeId = decodeImportId(
  "018f47ad-91aa-7c35-b6fe-000000000402"
);

export const syntheticRecipeReviews: readonly RecipeReviewView[] = [
  makeSyntheticReview({
    fingerprintCharacter: "b",
    importId: "018f47ad-91aa-7c35-b6fe-000000000401",
    lifecycle: "approved",
    name: "Synthetic Tomato Orzo",
    tags: mediterraneanDinnerTags,
  }),
  makeSyntheticReview({
    fingerprintCharacter: "c",
    importId: "018f47ad-91aa-7c35-b6fe-000000000402",
    lifecycle: "rejected",
    name: "Synthetic Rejected Pancakes",
    tags: breakfastTags,
  }),
  makeSyntheticReview({
    fingerprintCharacter: "d",
    importId: syntheticReplacementRecipeId,
    lifecycle: "approved",
    name: "Synthetic Bean Traybake",
    tags: replacementDinnerTags,
  }),
  makeSyntheticReview({
    fingerprintCharacter: "e",
    importId: syntheticHardConstraintRecipeId,
    lifecycle: "approved",
    name: "Synthetic Elaborate Pie",
    tags: hardDinnerTags,
  }),
];

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

export const makeInMemoryRecipeReviewRepository = (
  initial: readonly RecipeReviewView[]
): {
  readonly listApproved: () => Effect.Effect<
    readonly ReturnType<typeof projectApprovedRecipe>[]
  >;
  readonly reviews: readonly RecipeReviewView[];
} => {
  const reviews = [...initial];
  return {
    listApproved: () =>
      Effect.succeed(
        reviews
          .filter(({ lifecycle }) => lifecycle === "approved")
          .map(projectApprovedRecipe)
      ),
    reviews,
  };
};

const mutationKey = (draftId: string, mutationId: string) =>
  `${draftId}:${mutationId}`;

export const makeInMemoryMealPlanDraftRepository = (): {
  readonly drafts: MealPlan[];
  readonly repository: MealPlanDraftRepositoryShape;
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
  const recipeRepository = makeInMemoryRecipeReviewRepository(
    syntheticRecipeReviews
  );
  const draftRepository = makeInMemoryMealPlanDraftRepository();
  return {
    drafts: draftRepository.drafts,
    recipeRepository,
    service: makeMealPlanService({
      drafts: draftRepository.repository,
      planner: makeDeterministicMealPlanPlanner(),
      recipeReviews: recipeRepository,
    }),
  };
};
