import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

export const HouseholdActorId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u)),
  Schema.brand("HouseholdActorId")
);
export type HouseholdActorId = typeof HouseholdActorId.Type;

export const HouseholdSystemPurpose = Schema.Literals([
  "import_workflow_dispatch",
  "recipe_import_lifecycle_commit",
]);
export type HouseholdSystemPurpose = typeof HouseholdSystemPurpose.Type;

export const HouseholdMemberActor = Schema.Struct({
  _tag: Schema.Literal("Member"),
  actorId: HouseholdActorId,
});
export type HouseholdMemberActor = typeof HouseholdMemberActor.Type;

export const HouseholdSystemActor = Schema.Struct({
  _tag: Schema.Literal("System"),
  purpose: HouseholdSystemPurpose,
});
export type HouseholdSystemActor = typeof HouseholdSystemActor.Type;

export const HouseholdMemberAdmission = Schema.Struct({
  actor: HouseholdMemberActor,
  organizationId: HouseholdOrganizationId,
});
export type HouseholdMemberAdmission = typeof HouseholdMemberAdmission.Type;

export const HouseholdSystemAdmission = Schema.Struct({
  actor: HouseholdSystemActor,
  organizationId: HouseholdOrganizationId,
});
export type HouseholdSystemAdmission = typeof HouseholdSystemAdmission.Type;

export const HouseholdCommandAdmission = Schema.Union([
  HouseholdMemberAdmission,
  HouseholdSystemAdmission,
]);
export type HouseholdCommandAdmission = typeof HouseholdCommandAdmission.Type;

export const makeHouseholdMemberAdmission = (input: {
  readonly actorId: string;
  readonly organizationId: HouseholdOrganizationId;
}) =>
  Schema.decodeUnknownEffect(HouseholdMemberAdmission)({
    actor: { _tag: "Member", actorId: input.actorId },
    organizationId: input.organizationId,
  });

export const HouseholdCommandPurpose = Schema.Literals([
  "admit_recipe_import",
  "answer_recipe_import_action",
  "approve_meal_plan",
  "cancel_recipe_import",
  "commit_acquisition_evidence",
  "mutate_evidence_stage",
  "commit_recipe_import_draft",
  "create_meal_plan",
  "create_meal_plan_from_recipe_bank",
  "ensure_household",
  "confirm_recipe_import_action",
  "list_recipe_bank",
  "observe_evidence_reference",
  "prepare_recipe_recovery",
  "read_recipe",
  "read_recipe_import",
  "read_recipe_import_action",
  "read_recipe_import_execution",
  "read_evidence_references",
  "read_evidence_stage",
  "read_import_terminal_checkpoint",
  "read_recipe_recovery_attempt",
  "read_recipe_import_timeline",
  "record_recipe_import_dispatch",
  "read_meal_plan",
  "reject_meal_plan",
  "resolve_recipe_import_source",
  "swap_meal_plan",
  "swap_meal_plan_from_recipe_bank",
  "transition_recipe_import_lifecycle",
]);
export type HouseholdCommandPurpose = typeof HouseholdCommandPurpose.Type;

export const HouseholdAuthorizationFailure = Schema.TaggedStruct(
  "HouseholdAuthorizationFailure",
  {}
);
export type HouseholdAuthorizationFailure =
  typeof HouseholdAuthorizationFailure.Type;

const memberPurposes: ReadonlySet<HouseholdCommandPurpose> = new Set([
  "admit_recipe_import",
  "answer_recipe_import_action",
  "approve_meal_plan",
  "cancel_recipe_import",
  "create_meal_plan",
  "create_meal_plan_from_recipe_bank",
  "ensure_household",
  "confirm_recipe_import_action",
  "list_recipe_bank",
  "read_recipe",
  "read_recipe_import",
  "read_recipe_import_action",
  "read_recipe_import_timeline",
  "read_meal_plan",
  "reject_meal_plan",
  "swap_meal_plan",
  "swap_meal_plan_from_recipe_bank",
]);

export const requireHouseholdCommandAdmission = (
  admission: HouseholdCommandAdmission,
  purpose: HouseholdCommandPurpose
): Effect.Effect<HouseholdCommandAdmission, HouseholdAuthorizationFailure> => {
  const permitted =
    admission.actor._tag === "Member"
      ? memberPurposes.has(purpose)
      : (admission.actor.purpose === "recipe_import_lifecycle_commit" &&
          (purpose === "commit_acquisition_evidence" ||
            purpose === "commit_recipe_import_draft" ||
            purpose === "observe_evidence_reference" ||
            purpose === "prepare_recipe_recovery" ||
            purpose === "read_evidence_references" ||
            purpose === "mutate_evidence_stage" ||
            purpose === "read_evidence_stage" ||
            purpose === "read_import_terminal_checkpoint" ||
            purpose === "read_recipe_recovery_attempt" ||
            purpose === "read_recipe_import_execution" ||
            purpose === "resolve_recipe_import_source" ||
            purpose === "transition_recipe_import_lifecycle")) ||
        (admission.actor.purpose === "import_workflow_dispatch" &&
          purpose === "record_recipe_import_dispatch");
  return permitted
    ? Effect.succeed(admission)
    : Effect.fail(HouseholdAuthorizationFailure.make({}));
};
