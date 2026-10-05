import { Schema } from "effect";

import {
  MealOccasionId,
  MealOption,
  PlanningDate,
  PlanningOptionRef,
  QuantityUnit,
} from "./meal-content.js";
import { HouseholdPersonId } from "./people.js";
import { ProfileVersion } from "./profiles.js";

const Identifier = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(128))
);
const Explanation = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(600))
);
const Version = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const PositiveAmount = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThan(0))
);
export const MealPlanDate = PlanningDate;
export type MealPlanDate = typeof MealPlanDate.Type;
export const MealPlanOccasion = MealOccasionId;
export type MealPlanOccasion = typeof MealPlanOccasion.Type;
export const MealPlanWeeks = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(12))
);
export type MealPlanWeeks = typeof MealPlanWeeks.Type;
export const MealPlanRequestKey = Identifier.pipe(
  Schema.brand("MealPlanRequestKey")
);
export type MealPlanRequestKey = typeof MealPlanRequestKey.Type;
export const MealPlanId = Identifier.pipe(Schema.brand("MealPlanId"));
export type MealPlanId = typeof MealPlanId.Type;
export const MealPlanMutationId = Identifier.pipe(
  Schema.brand("MealPlanMutationId")
);
export type MealPlanMutationId = typeof MealPlanMutationId.Type;
export const MealPlanActorId = Identifier.pipe(Schema.brand("MealPlanActorId"));
export type MealPlanActorId = typeof MealPlanActorId.Type;
export const MealPlanInstant = Schema.DateTimeUtcFromString.pipe(
  Schema.brand("MealPlanInstant")
);
export type MealPlanInstant = typeof MealPlanInstant.Type;

export const MealPlanRequest = Schema.Struct({
  requestKey: MealPlanRequestKey,
  startDate: MealPlanDate,
  weeks: MealPlanWeeks,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type MealPlanRequest = typeof MealPlanRequest.Type;
export const CreateMealPlanPayload = MealPlanRequest;
export type CreateMealPlanPayload = MealPlanRequest;

export const MealPlanRequirementKey = Schema.Struct({
  date: MealPlanDate,
  occasion: MealPlanOccasion,
  personId: HouseholdPersonId,
});
export type MealPlanRequirementKey = typeof MealPlanRequirementKey.Type;
export const MealPlanOptionRef = PlanningOptionRef;
export type MealPlanOptionRef = typeof MealPlanOptionRef.Type;
export const MealPlanQuantity = Schema.Struct({
  amount: PositiveAmount,
  unit: QuantityUnit,
});
export type MealPlanQuantity = typeof MealPlanQuantity.Type;

export const MealPlanResolution = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("MealOption"),
    eventId: Identifier,
    option: MealPlanOptionRef,
    quantity: Schema.NullOr(MealPlanQuantity),
    rationale: Explanation,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Prepared"),
    outputId: Identifier,
    quantity: MealPlanQuantity,
    rationale: Explanation,
  }),
  Schema.Struct({
    _tag: Schema.Literal("External"),
    description: Explanation,
    rationale: Explanation,
  }),
  Schema.Struct({ _tag: Schema.Literal("Skip"), rationale: Explanation }),
  Schema.Struct({ _tag: Schema.Literal("Flexible"), rationale: Explanation }),
  Schema.Struct({
    _tag: Schema.Literal("Gap"),
    rationale: Explanation,
    reason: Schema.Literals([
      "no_compatible_option",
      "routine_conflict",
      "unconfirmed_suitability",
      "preparation_context_unresolved",
      "unavailable_prepared_food",
      "dependent_output_removed",
      "not_planned",
    ]),
  }),
]);
export type MealPlanResolution = typeof MealPlanResolution.Type;
export const MealPlanCoverage = Schema.Struct({
  requirement: MealPlanRequirementKey,
  resolution: MealPlanResolution,
});
export type MealPlanCoverage = typeof MealPlanCoverage.Type;
export const MealPlanCookOutput = Schema.Struct({
  outputId: Identifier,
  quantity: MealPlanQuantity,
  source: Schema.Literal("adult_confirmed"),
});
export type MealPlanCookOutput = typeof MealPlanCookOutput.Type;
export const MealPlanCookEvent = Schema.Struct({
  batchCount: Schema.Int.pipe(
    Schema.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(16)
    )
  ),
  date: MealPlanDate,
  eventId: Identifier,
  option: MealPlanOptionRef,
  outputs: Schema.Array(MealPlanCookOutput),
});
export type MealPlanCookEvent = typeof MealPlanCookEvent.Type;

export const MealPlanPersonPin = Schema.Struct({
  personId: HouseholdPersonId,
  profileVersion: ProfileVersion,
  safetyState: Schema.Literals([
    "confirmed_none",
    "has_constraints",
    "unknown",
  ]),
});
export type MealPlanPersonPin = typeof MealPlanPersonPin.Type;
export const MealPlanRoutinePin = Schema.Struct({
  routineId: Identifier,
  routineVersion: Version,
});
export type MealPlanRoutinePin = typeof MealPlanRoutinePin.Type;
export const MealPlanPins = Schema.Struct({
  configVersion: Version,
  content: Schema.Array(MealPlanOptionRef),
  contentSnapshots: Schema.Array(MealOption),
  people: Schema.Array(MealPlanPersonPin),
  preparedSources: Schema.Array(
    Schema.Struct({
      optionRef: Schema.NullOr(MealPlanOptionRef),
      outputId: Identifier,
    })
  ),
  routines: Schema.Array(MealPlanRoutinePin),
});
export type MealPlanPins = typeof MealPlanPins.Type;
export const MealPlanVersion = Schema.Struct({
  cookEvents: Schema.Array(MealPlanCookEvent),
  coverage: Schema.Array(MealPlanCoverage).pipe(
    Schema.check(Schema.isMaxLength(16_384))
  ),
  number: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
  pins: MealPlanPins,
});
export type MealPlanVersion = typeof MealPlanVersion.Type;
export const MealPlanAudit = Schema.Struct({
  action: Schema.Literals([
    "change_coverage",
    "refresh_inputs",
    "set_cook_event",
    "remove_cook_event",
    "approve",
    "propose_revision",
    "accept_revision",
    "reject_revision",
  ]),
  actorId: MealPlanActorId,
  at: MealPlanInstant,
  changedRequirements: Schema.Array(MealPlanRequirementKey),
  mutationId: MealPlanMutationId,
  reason: Explanation,
});
export type MealPlanAudit = typeof MealPlanAudit.Type;

const SharedFields = {
  audit: Schema.Array(MealPlanAudit),
  planId: MealPlanId,
  request: MealPlanRequest,
  revision: Version,
} as const;
export const MealPlanDraft = Schema.Struct({
  ...SharedFields,
  _tag: Schema.Literal("Draft"),
  proposed: MealPlanVersion,
});
export type MealPlanDraft = typeof MealPlanDraft.Type;
export const MealPlanApproved = Schema.Struct({
  ...SharedFields,
  _tag: Schema.Literal("Approved"),
  active: MealPlanVersion,
});
export type MealPlanApproved = typeof MealPlanApproved.Type;
export const MealPlanProposedRevision = Schema.Struct({
  ...SharedFields,
  _tag: Schema.Literal("ProposedRevision"),
  active: MealPlanVersion,
  proposed: MealPlanVersion,
});
export type MealPlanProposedRevision = typeof MealPlanProposedRevision.Type;
export const MealPlan = Schema.Union([
  MealPlanDraft,
  MealPlanApproved,
  MealPlanProposedRevision,
]);
export type MealPlan = typeof MealPlan.Type;
export const MealPlanSummary = Schema.Struct({
  activeVersion: Schema.NullOr(MealPlanVersion.fields.number),
  planId: MealPlanId,
  proposedGapCount: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  revision: Version,
  startDate: MealPlanDate,
  state: Schema.Literals(["Draft", "Approved", "ProposedRevision"]),
  weeks: MealPlanWeeks,
});
export type MealPlanSummary = typeof MealPlanSummary.Type;

export const toMealPlanSummary = (plan: MealPlan): MealPlanSummary => ({
  activeVersion: plan._tag === "Draft" ? null : plan.active.number,
  planId: plan.planId,
  proposedGapCount:
    plan._tag === "Approved"
      ? 0
      : plan.proposed.coverage.filter(
          ({ resolution }) => resolution._tag === "Gap"
        ).length,
  revision: plan.revision,
  startDate: plan.request.startDate,
  state: plan._tag,
  weeks: plan.request.weeks,
});

export const MealPlanChange = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("RefreshInputs") }),
  Schema.Struct({
    _tag: Schema.Literal("ReplaceDraftPlan"),
    cookEvents: MealPlanVersion.fields.cookEvents,
    coverage: MealPlanVersion.fields.coverage,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetCoverage"),
    requirement: MealPlanRequirementKey,
    resolution: MealPlanResolution,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ReplaceMealEvent"),
    eventId: Identifier,
    option: MealPlanOptionRef,
    rationale: Explanation,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetCookEvent"),
    event: MealPlanCookEvent,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RemoveCookEvent"),
    eventId: Identifier,
  }),
]);
export type MealPlanChange = typeof MealPlanChange.Type;
export const ChangeMealPlanPayload = Schema.Struct({
  change: MealPlanChange,
  expectedRevision: Version,
  mutationId: MealPlanMutationId,
  reason: Explanation,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ChangeMealPlanPayload = typeof ChangeMealPlanPayload.Type;
export const DecideMealPlanPayload = Schema.Struct({
  expectedRevision: Version,
  mutationId: MealPlanMutationId,
  reason: Explanation,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type DecideMealPlanPayload = typeof DecideMealPlanPayload.Type;

export const MealPlanRequestConflict = Schema.TaggedStruct(
  "MealPlanRequestConflict",
  { planId: MealPlanId }
);
export type MealPlanRequestConflict = typeof MealPlanRequestConflict.Type;
export const MealPlanNotFound = Schema.TaggedStruct("MealPlanNotFound", {
  planId: MealPlanId,
});
export type MealPlanNotFound = typeof MealPlanNotFound.Type;
export const MealPlanVersionConflict = Schema.TaggedStruct(
  "MealPlanVersionConflict",
  {
    actualRevision: Version,
    expectedRevision: Version,
  }
);
export type MealPlanVersionConflict = typeof MealPlanVersionConflict.Type;
export const MealPlanTransitionRejected = Schema.TaggedStruct(
  "MealPlanTransitionRejected",
  {
    lifecycle: Schema.Literals(["Draft", "Approved", "ProposedRevision"]),
  }
);
export type MealPlanTransitionRejected = typeof MealPlanTransitionRejected.Type;
export const MealPlanMutationConflict = Schema.TaggedStruct(
  "MealPlanMutationConflict",
  {
    mutationId: MealPlanMutationId,
  }
);
export type MealPlanMutationConflict = typeof MealPlanMutationConflict.Type;
export const MealPlanRuleViolation = Schema.TaggedStruct(
  "MealPlanRuleViolation",
  {
    reason: Schema.Literals([
      "invalid_requirement_matrix",
      "requirement_not_found",
      "unresolved_gap",
      "unreviewed_suitability",
      "incompatible_option",
      "content_version_changed",
      "profile_version_changed",
      "config_version_changed",
      "prepared_overallocated",
      "prepared_output_missing",
      "quantity_unit_mismatch",
      "cook_event_conflict",
      "invalid_cook_output",
      "unresolved_shopping",
      "unresolved_allocation",
      "config_missing",
      "availability_unknown",
      "preparation_unknown",
      "missing_equipment",
      "preparation_window_conflict",
      "cooking_capacity_exceeded",
    ]),
  }
);
export type MealPlanRuleViolation = typeof MealPlanRuleViolation.Type;
export const MealPlanPersistenceFailure = Schema.TaggedStruct(
  "MealPlanPersistenceFailure",
  {
    operation: Schema.Literals(["create", "read", "save"]),
  }
);
export type MealPlanPersistenceFailure = typeof MealPlanPersistenceFailure.Type;
