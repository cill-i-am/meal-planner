import { Effect, Schema } from "effect";
import type { Option } from "effect";

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
});
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
  actorId: ShortIdentifier,
  fromRecipe: ApprovedRecipe,
  mutationId: ShortIdentifier,
  reason: TrimmedNonEmptyString,
  slotId: MealPlanSlotId,
  swappedAt: Schema.String,
  toRecipe: ApprovedRecipe,
});
export type ManualSwapAudit = typeof ManualSwapAudit.Type;

export const MealPlanDraft = Schema.Struct({
  _tag: Schema.Literal("Draft"),
  audit: Schema.Array(ManualSwapAudit),
  draftId: MealPlanDraftId,
  gaps: Schema.Array(MealPlanGap),
  meals: Schema.Array(PlannedMeal),
  policy: MealPlanPolicy,
  request: MealPlanRequest,
  revision: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  ),
});
export type MealPlanDraft = typeof MealPlanDraft.Type;

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

export class MealPlanRequestConflict extends Schema.TaggedErrorClass<MealPlanRequestConflict>()(
  "MealPlanRequestConflict",
  { draftId: MealPlanDraftId }
) {}

export interface MealPlanDraftRepositoryShape {
  readonly create: (
    draft: MealPlanDraft
  ) => Effect.Effect<MealPlanDraft, MealPlanRequestConflict>;
  readonly find: (
    draftId: MealPlanDraftId
  ) => Effect.Effect<Option.Option<MealPlanDraft>>;
}

export type MealPlanServiceError =
  | MealPlanRequestConflict
  | RecipeReviewServiceError;

export interface MealPlanServiceShape {
  readonly create: (
    request: MealPlanRequest,
    policy: MealPlanPolicy
  ) => Effect.Effect<MealPlanDraft, MealPlanServiceError>;
  readonly read: (
    draftId: MealPlanDraftId
  ) => Effect.Effect<Option.Option<MealPlanDraft>>;
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

const isEligible = (
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
              isEligible(candidate, slot, policy) &&
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

export const makeMealPlanService = (input: {
  readonly drafts: MealPlanDraftRepositoryShape;
  readonly planner: MealPlanPlannerShape;
  readonly recipeReviews: Pick<RecipeReviewServiceShape, "listApproved">;
}): MealPlanServiceShape => ({
  create: (request, policy) =>
    Effect.gen(function* createMealPlanDraft() {
      const approvedRecipes = yield* input.recipeReviews.listApproved();
      const proposal = yield* input.planner.plan({
        approvedRecipes,
        policy,
        request,
      });
      return yield* input.drafts.create({
        _tag: "Draft",
        audit: [],
        draftId: draftIdFor(request),
        gaps: proposal.gaps,
        meals: proposal.meals,
        policy,
        request,
        revision: 0,
      });
    }),
  read: input.drafts.find,
});
