import {
  PlanningDietaryFit,
  PlanningDifficulty,
  PlanningMealType,
  PlanningTotalTimeBand,
  PlanningTags,
} from "@meal-planner/recipe-domain";
import { Schema } from "effect";

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);
const ShortIdentifier = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(128))
);
const ShortText = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(4096))
);
const PositiveInteger = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const NonNegativeInteger = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const CalendarDate = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u),
    Schema.makeFilter((date) => {
      const instant = new Date(`${date}T00:00:00.000Z`);
      return !Number.isNaN(instant.getTime()) &&
        instant.toISOString().slice(0, 10) === date
        ? undefined
        : "Expected a real calendar date";
    })
  )
);

export const MealPlanRecipeSnapshotId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("MealPlanRecipeSnapshotId")
);
export type MealPlanRecipeSnapshotId = typeof MealPlanRecipeSnapshotId.Type;

export const MealPlanInstant = Schema.DateTimeUtcFromString.pipe(
  Schema.brand("MealPlanInstant")
);
export type MealPlanInstant = typeof MealPlanInstant.Type;

export const MealPlanRequestKey = ShortIdentifier.pipe(
  Schema.brand("MealPlanRequestKey")
);
export type MealPlanRequestKey = typeof MealPlanRequestKey.Type;

export const MealPlanDraftId = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(134)),
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
  date: CalendarDate,
  mealType: PlanningMealType,
  servings: PositiveInteger,
  slotId: MealPlanSlotId,
});
export type MealPlanSlot = typeof MealPlanSlot.Type;

export const MaximumMealPlanSlots = 31;
export const MaximumPreferredCuisines = 8;

export const MealPlanRequest = Schema.Struct({
  requestKey: MealPlanRequestKey,
  slots: Schema.NonEmptyArray(MealPlanSlot).pipe(
    Schema.check(Schema.isMaxLength(MaximumMealPlanSlots))
  ),
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
  allowedDietaryFit: Schema.NonEmptyArray(PlanningDietaryFit).pipe(
    Schema.check(Schema.isMaxLength(3))
  ),
  allowedDifficulties: Schema.NonEmptyArray(PlanningDifficulty).pipe(
    Schema.check(Schema.isMaxLength(3))
  ),
  allowedTotalTimeBands: Schema.NonEmptyArray(PlanningTotalTimeBand).pipe(
    Schema.check(Schema.isMaxLength(4))
  ),
  maxRecipeUses: PositiveInteger,
  preferredCuisines: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.check(Schema.isMaxLength(MaximumPreferredCuisines))
  ),
  version: MealPlanPolicyVersion,
});
export type MealPlanPolicy = typeof MealPlanPolicy.Type;

/** Safe immutable recipe snapshot embedded in a household-owned plan. */
export const MealPlanRecipeSnapshot = Schema.Struct({
  approvedAt: MealPlanInstant,
  extractionFingerprint: TrimmedNonEmptyString,
  importId: MealPlanRecipeSnapshotId,
  recipe: Schema.Struct({
    ingredientLines: Schema.NonEmptyArray(ShortText),
    instructions: Schema.NonEmptyArray(ShortText),
    name: ShortText,
  }),
  source: Schema.Struct({
    evidenceFingerprint: TrimmedNonEmptyString,
    sourceUrl: Schema.NullOr(ShortText),
  }),
  tags: PlanningTags,
  version: PositiveInteger,
});
export type MealPlanRecipeSnapshot = typeof MealPlanRecipeSnapshot.Type;

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
  sourceRecipe: MealPlanRecipeSnapshot,
});
export type PlannedMeal = typeof PlannedMeal.Type;

export const MealPlanGap = Schema.Struct({
  reason: Schema.Literal("no_eligible_approved_recipe"),
  slotId: MealPlanSlotId,
});
export type MealPlanGap = typeof MealPlanGap.Type;

export const ManualSwapAudit = Schema.Struct({
  actorId: MealPlanActorId,
  fromRecipe: MealPlanRecipeSnapshot,
  mutationId: MealPlanMutationId,
  reason: ShortText,
  slotId: MealPlanSlotId,
  swappedAt: MealPlanInstant,
  toRecipe: MealPlanRecipeSnapshot,
});
export type ManualSwapAudit = typeof ManualSwapAudit.Type;

const MealPlanRecordFields = {
  audit: Schema.Array(ManualSwapAudit),
  draftId: MealPlanDraftId,
  gaps: Schema.Array(MealPlanGap),
  meals: Schema.Array(PlannedMeal),
  policy: MealPlanPolicy,
  request: MealPlanRequest,
  revision: NonNegativeInteger,
} as const;

export const MealPlanDraft = Schema.Struct({
  ...MealPlanRecordFields,
  _tag: Schema.Literal("Draft"),
});
export type MealPlanDraft = typeof MealPlanDraft.Type;

const MealPlanDecisionFields = {
  actorId: MealPlanActorId,
  decidedAt: MealPlanInstant,
  mutationId: MealPlanMutationId,
  reason: ShortText,
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

export const ManualMealSwapRequest = Schema.Struct({
  actorId: MealPlanActorId,
  draftId: MealPlanDraftId,
  expectedRevision: NonNegativeInteger,
  mutationId: MealPlanMutationId,
  reason: ShortText,
  replacementImportId: MealPlanRecipeSnapshotId,
  slotId: MealPlanSlotId,
  swappedAt: MealPlanInstant,
});
export type ManualMealSwapRequest = typeof ManualMealSwapRequest.Type;

export const MealPlanDecisionRequest = Schema.Struct({
  actorId: MealPlanActorId,
  decidedAt: MealPlanInstant,
  draftId: MealPlanDraftId,
  expectedRevision: NonNegativeInteger,
  mutationId: MealPlanMutationId,
  reason: ShortText,
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
    actualRevision: NonNegativeInteger,
    expectedRevision: NonNegativeInteger,
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

export const MealPlanPersistenceFailure = Schema.TaggedStruct(
  "MealPlanPersistenceFailure",
  { operation: Schema.Literals(["create", "read", "save"]) }
);
export type MealPlanPersistenceFailure = typeof MealPlanPersistenceFailure.Type;

export const CreateMealPlanPayload = Schema.Struct({
  policy: MealPlanPolicy,
  request: MealPlanRequest,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type CreateMealPlanPayload = typeof CreateMealPlanPayload.Type;

export const SwapMealPlanPayload = Schema.Struct({
  expectedRevision: NonNegativeInteger,
  mutationId: MealPlanMutationId,
  reason: ShortText,
  replacementImportId: MealPlanRecipeSnapshotId,
  slotId: MealPlanSlotId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type SwapMealPlanPayload = typeof SwapMealPlanPayload.Type;

export const DecideMealPlanPayload = Schema.Struct({
  expectedRevision: NonNegativeInteger,
  mutationId: MealPlanMutationId,
  reason: ShortText,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type DecideMealPlanPayload = typeof DecideMealPlanPayload.Type;
