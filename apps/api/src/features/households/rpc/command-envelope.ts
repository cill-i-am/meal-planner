import {
  HouseholdCreatorAuthority,
  HouseholdOrganizationId,
  HouseholdPeopleAuditActorId,
  HouseholdPersonLinkageSubject,
} from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

export const HouseholdActorId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u)),
  Schema.brand("HouseholdActorId")
);
export type HouseholdActorId = typeof HouseholdActorId.Type;

export const HouseholdSystemPurpose = Schema.Literals([
  "batch_item_dispatch",
  "import_workflow_dispatch",
  "member_departure_finalize",
  "person_invitation_acceptance",
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

export const HouseholdPeopleMemberActor = Schema.Struct({
  _tag: Schema.Literal("PeopleMember"),
  actorId: HouseholdPeopleAuditActorId,
  linkageSubject: HouseholdPersonLinkageSubject,
});
export type HouseholdPeopleMemberActor = typeof HouseholdPeopleMemberActor.Type;

export const HouseholdPeopleCreatorActor = Schema.Struct({
  _tag: Schema.Literal("PeopleCreator"),
  actorId: HouseholdPeopleAuditActorId,
  authority: HouseholdCreatorAuthority,
  linkageSubject: HouseholdPersonLinkageSubject,
});
export type HouseholdPeopleCreatorActor =
  typeof HouseholdPeopleCreatorActor.Type;

export const HouseholdPeopleMemberAdmission = Schema.Struct({
  actor: HouseholdPeopleMemberActor,
  organizationId: HouseholdOrganizationId,
});
export type HouseholdPeopleMemberAdmission =
  typeof HouseholdPeopleMemberAdmission.Type;

export const HouseholdPeopleCreatorAdmission = Schema.Struct({
  actor: HouseholdPeopleCreatorActor,
  organizationId: HouseholdOrganizationId,
});
export type HouseholdPeopleCreatorAdmission =
  typeof HouseholdPeopleCreatorAdmission.Type;

export const HouseholdSystemAdmission = Schema.Struct({
  actor: HouseholdSystemActor,
  organizationId: HouseholdOrganizationId,
});
export type HouseholdSystemAdmission = typeof HouseholdSystemAdmission.Type;

export const HouseholdCommandAdmission = Schema.Union([
  HouseholdMemberAdmission,
  HouseholdPeopleMemberAdmission,
  HouseholdPeopleCreatorAdmission,
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

export const makeHouseholdPeopleAdmission = (input: {
  readonly actorId: typeof HouseholdPeopleAuditActorId.Type;
  readonly linkageSubject: typeof HouseholdPersonLinkageSubject.Type;
  readonly organizationId: HouseholdOrganizationId;
}) =>
  Schema.decodeUnknownEffect(HouseholdPeopleMemberAdmission)({
    actor: {
      _tag: "PeopleMember",
      actorId: input.actorId,
      linkageSubject: input.linkageSubject,
    },
    organizationId: input.organizationId,
  });

export const makeHouseholdPeopleCreatorAdmission = (input: {
  readonly actorId: typeof HouseholdPeopleAuditActorId.Type;
  readonly creatorAuthority: typeof HouseholdCreatorAuthority.Type;
  readonly linkageSubject: typeof HouseholdPersonLinkageSubject.Type;
  readonly organizationId: HouseholdOrganizationId;
}) =>
  Schema.decodeUnknownEffect(HouseholdPeopleCreatorAdmission)({
    actor: {
      _tag: "PeopleCreator",
      actorId: input.actorId,
      authority: input.creatorAuthority,
      linkageSubject: input.linkageSubject,
    },
    organizationId: input.organizationId,
  });

export const HouseholdCommandPurpose = Schema.Literals([
  "admit_import_batch",
  "admit_recipe_import",
  "answer_recipe_import_action",
  "approve_meal_plan",
  "archive_household_person",
  "associate_adult_invitation",
  "bootstrap_creator_person",
  "cancel_member_departure",
  "cancel_recipe_import",
  "claim_import_batch_item",
  "claim_acquisition_attempt",
  "commit_acquisition_evidence",
  "mutate_evidence_stage",
  "commit_recipe_import_draft",
  "complete_accepted_adult_link",
  "confirm_adult_invitation_recipient",
  "confirm_member_access_revoked",
  "create_household_person",
  "create_meal_plan_from_recipe_bank",
  "ensure_household",
  "confirm_recipe_import_action",
  "complete_import_batch_item",
  "fail_import_batch_item",
  "finalize_member_departure",
  "get_member_departure",
  "list_recipe_bank",
  "list_household_people",
  "mark_member_departure_repair_required",
  "observe_evidence_reference",
  "prepare_member_departure",
  "prepare_recipe_recovery",
  "read_recipe",
  "get_household_person",
  "read_recipe_import",
  "read_recipe_import_action",
  "read_recipe_import_execution",
  "read_evidence_references",
  "read_acquisition_attempts",
  "read_evidence_stage",
  "read_import_terminal_checkpoint",
  "read_recipe_recovery_attempt",
  "read_recipe_import_timeline",
  "read_import_batch",
  "record_import_batch_dispatch",
  "record_recipe_import_dispatch",
  "read_meal_plan",
  "reject_meal_plan",
  "resolve_recipe_import_source",
  "repair_adult_account_link",
  "restore_returning_adult_link",
  "restore_household_person",
  "retry_member_departure",
  "start_member_departure",
  "swap_meal_plan_from_recipe_bank",
  "transition_recipe_import_lifecycle",
]);

const householdPeoplePurposes: ReadonlySet<HouseholdCommandPurpose> = new Set([
  "archive_household_person",
  "cancel_member_departure",
  "complete_accepted_adult_link",
  "create_household_person",
  "get_household_person",
  "get_member_departure",
  "list_household_people",
  "prepare_member_departure",
  "restore_returning_adult_link",
  "restore_household_person",
  "retry_member_departure",
  "start_member_departure",
]);
export type HouseholdCommandPurpose = typeof HouseholdCommandPurpose.Type;

const householdPeopleOwnerPurposes: ReadonlySet<HouseholdCommandPurpose> =
  new Set([
    ...householdPeoplePurposes,
    "associate_adult_invitation",
    "bootstrap_creator_person",
    "repair_adult_account_link",
  ]);

export const HouseholdAuthorizationFailure = Schema.TaggedStruct(
  "HouseholdAuthorizationFailure",
  {}
);
export type HouseholdAuthorizationFailure =
  typeof HouseholdAuthorizationFailure.Type;

const memberPurposes: ReadonlySet<HouseholdCommandPurpose> = new Set([
  "admit_import_batch",
  "admit_recipe_import",
  "answer_recipe_import_action",
  "approve_meal_plan",
  "cancel_recipe_import",
  "create_meal_plan_from_recipe_bank",
  "ensure_household",
  "confirm_recipe_import_action",
  "list_recipe_bank",
  "read_recipe",
  "read_recipe_import",
  "read_recipe_import_action",
  "read_recipe_import_timeline",
  "read_import_batch",
  "read_meal_plan",
  "reject_meal_plan",
  "swap_meal_plan_from_recipe_bank",
]);

const lifecycleCommitPurposes: ReadonlySet<HouseholdCommandPurpose> = new Set([
  "claim_acquisition_attempt",
  "commit_acquisition_evidence",
  "commit_recipe_import_draft",
  "mutate_evidence_stage",
  "observe_evidence_reference",
  "prepare_recipe_recovery",
  "read_evidence_references",
  "read_acquisition_attempts",
  "read_evidence_stage",
  "read_import_terminal_checkpoint",
  "read_recipe_import_execution",
  "read_recipe_recovery_attempt",
  "resolve_recipe_import_source",
  "transition_recipe_import_lifecycle",
]);

const batchDispatchPurposes: ReadonlySet<HouseholdCommandPurpose> = new Set([
  "claim_import_batch_item",
  "complete_import_batch_item",
  "fail_import_batch_item",
  "record_import_batch_dispatch",
]);

export const requireHouseholdCommandAdmission = (
  admission: HouseholdCommandAdmission,
  purpose: HouseholdCommandPurpose
): Effect.Effect<HouseholdCommandAdmission, HouseholdAuthorizationFailure> => {
  const permitted = (() => {
    switch (admission.actor._tag) {
      case "Member": {
        return memberPurposes.has(purpose);
      }
      case "PeopleMember": {
        return householdPeoplePurposes.has(purpose);
      }
      case "PeopleCreator": {
        return householdPeopleOwnerPurposes.has(purpose);
      }
      case "System": {
        return (
          (admission.actor.purpose === "recipe_import_lifecycle_commit" &&
            lifecycleCommitPurposes.has(purpose)) ||
          (admission.actor.purpose === "import_workflow_dispatch" &&
            purpose === "record_recipe_import_dispatch") ||
          (admission.actor.purpose === "member_departure_finalize" &&
            (purpose === "confirm_member_access_revoked" ||
              purpose === "finalize_member_departure" ||
              purpose === "get_member_departure" ||
              purpose === "mark_member_departure_repair_required")) ||
          (admission.actor.purpose === "person_invitation_acceptance" &&
            purpose === "confirm_adult_invitation_recipient") ||
          (admission.actor.purpose === "batch_item_dispatch" &&
            batchDispatchPurposes.has(purpose))
        );
      }
      default: {
        return false;
      }
    }
  })();
  return permitted
    ? Effect.succeed(admission)
    : Effect.fail(HouseholdAuthorizationFailure.make({}));
};
