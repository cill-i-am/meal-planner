import { Effect, Option, Schema } from "effect";

import { RecipeDraft } from "../imports/import-recipe-draft.repository.d1.js";
import {
  PlanningTags,
  RecipeReviewView,
  makeRecipeReviewService,
  recipeReviewTransitionRejected,
  recipeReviewVersionConflict,
} from "../imports/import-recipe-review.js";
import type {
  RecipeReviewRepositoryShape,
  RecipeReviewTransition,
} from "../imports/import-recipe-review.js";
import { ImportTimestamp } from "../imports/import.contracts.js";
import {
  MealPlanDraft,
  MealPlanPolicy,
  MealPlanRequest,
  MealPlanRequestConflict,
  makeDeterministicMealPlanPlanner,
  makeMealPlanService,
} from "./meal-plan.js";
import type {
  MealPlanDraftId,
  MealPlanDraftRepositoryShape,
} from "./meal-plan.js";

const decodeTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
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
): RecipeReviewRepositoryShape => {
  const reviews = [...initial];
  const indexForFingerprint = (fingerprint: string) =>
    reviews.findIndex(
      ({ draft }) => draft.extractionFingerprint === fingerprint
    );

  return {
    correct: (input) =>
      Effect.gen(function* correctSyntheticReview() {
        const index = indexForFingerprint(input.extractionFingerprint);
        const current = reviews[index];
        if (current === undefined) {
          return yield* Effect.die("Synthetic review was not found");
        }
        if (current.version !== input.expectedVersion) {
          return yield* Effect.fail(
            recipeReviewVersionConflict(input.expectedVersion, current.version)
          );
        }
        if (current.lifecycle !== "needs_review") {
          return yield* Effect.fail(
            recipeReviewTransitionRejected(current.lifecycle)
          );
        }
        const updated: RecipeReviewView = {
          ...current,
          corrections: [...current.corrections, input.correction],
          tags: input.tags,
          version: input.correction.version,
        };
        reviews[index] = updated;
        return updated;
      }),
    find: (importId) =>
      Effect.succeed(
        Option.fromNullishOr(
          reviews.find(({ draft }) => draft.importId === importId)
        )
      ),
    listApproved: () =>
      Effect.succeed(
        reviews.filter(({ lifecycle }) => lifecycle === "approved")
      ),
    transition: (input) =>
      Effect.gen(function* transitionSyntheticReview() {
        const index = indexForFingerprint(input.extractionFingerprint);
        const current = reviews[index];
        if (current === undefined) {
          return yield* Effect.die("Synthetic review was not found");
        }
        if (current.version !== input.expectedVersion) {
          return yield* Effect.fail(
            recipeReviewVersionConflict(input.expectedVersion, current.version)
          );
        }
        const { transition }: { readonly transition: RecipeReviewTransition } =
          input;
        if (transition.from !== current.lifecycle) {
          return yield* Effect.fail(
            recipeReviewTransitionRejected(current.lifecycle)
          );
        }
        const updated: RecipeReviewView = {
          ...current,
          lifecycle: transition.to,
          transitions: [...current.transitions, transition],
          version: transition.version,
        };
        reviews[index] = updated;
        return updated;
      }),
  };
};

const sameDraft = (left: MealPlanDraft, right: MealPlanDraft): boolean =>
  JSON.stringify(Schema.encodeSync(MealPlanDraft)(left)) ===
  JSON.stringify(Schema.encodeSync(MealPlanDraft)(right));

export const makeInMemoryMealPlanDraftRepository = (): {
  readonly drafts: MealPlanDraft[];
  readonly repository: MealPlanDraftRepositoryShape;
} => {
  const drafts: MealPlanDraft[] = [];
  return {
    drafts,
    repository: {
      create: (draft) =>
        Effect.gen(function* createSyntheticDraft() {
          const existing = drafts.find(
            ({ draftId }) => draftId === draft.draftId
          );
          if (existing !== undefined) {
            return sameDraft(existing, draft)
              ? existing
              : yield* Effect.fail(
                  new MealPlanRequestConflict({ draftId: draft.draftId })
                );
          }
          drafts.push(draft);
          return draft;
        }),
      find: (draftId: MealPlanDraftId) =>
        Effect.succeed(
          Option.fromNullishOr(
            drafts.find((draft) => draft.draftId === draftId)
          )
        ),
    },
  };
};

export const makeSyntheticMealPlanTracer = () => {
  const recipeRepository = makeInMemoryRecipeReviewRepository(
    syntheticRecipeReviews
  );
  const recipeReviews = makeRecipeReviewService({
    now: () => decodeTimestamp("2026-07-22T10:02:00.000Z"),
    repository: recipeRepository,
  });
  const draftRepository = makeInMemoryMealPlanDraftRepository();
  return {
    drafts: draftRepository.drafts,
    recipeRepository,
    service: makeMealPlanService({
      drafts: draftRepository.repository,
      planner: makeDeterministicMealPlanPlanner(),
      recipeReviews,
    }),
  };
};
