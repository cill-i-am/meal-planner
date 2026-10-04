import {
  AssociateAdultInvitationPayload,
  BootstrapHouseholdCreatorPayload,
  CancelMemberDeparturePayload,
  CompleteAcceptedAdultLinkPayload,
  CreateHouseholdPersonPayload,
  RenameHouseholdPersonPayload,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureOperationId,
  HouseholdPeopleRoster,
  HouseholdInvitationDigest,
  HouseholdPersonId,
  HouseholdPerson,
  HouseholdPersonLinkageSubject,
  HouseholdPersonMutationId,
  ListHouseholdPeopleUrlParams,
  PrepareMemberDeparturePayload,
  RepairAdultAccountLinkPayload,
  RestoreReturningAdultLinkPayload,
  RetryMemberDeparturePayload,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import {
  HouseholdPeopleCreatorAdmission,
  HouseholdPeopleMemberAdmission,
  HouseholdSystemAdmission,
} from "../rpc/command-envelope.js";

/** Closed private creator bootstrap input. */
export const HouseholdBootstrapCreatorPersonInput = Schema.Struct({
  admission: HouseholdPeopleCreatorAdmission,
  payload: BootstrapHouseholdCreatorPayload,
});
export type HouseholdBootstrapCreatorPersonInput =
  typeof HouseholdBootstrapCreatorPersonInput.Type;

/** Closed private owner-authorized invitation association input. */
export const HouseholdAssociateAdultInvitationInput = Schema.Struct({
  admission: HouseholdPeopleCreatorAdmission,
  payload: AssociateAdultInvitationPayload,
});
export type HouseholdAssociateAdultInvitationInput =
  typeof HouseholdAssociateAdultInvitationInput.Type;

/** Closed private accepted-member account-link completion input. */
export const HouseholdCompleteAcceptedAdultLinkInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: CompleteAcceptedAdultLinkPayload,
});
export type HouseholdCompleteAcceptedAdultLinkInput =
  typeof HouseholdCompleteAcceptedAdultLinkInput.Type;

/** Exact-recipient proof captured after Better Auth authenticates invitation acceptance. */
export const HouseholdConfirmAdultInvitationRecipientInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  invitationDigest: CompleteAcceptedAdultLinkPayload.fields.invitationDigest,
  linkageSubject: HouseholdPersonLinkageSubject,
});
export type HouseholdConfirmAdultInvitationRecipientInput =
  typeof HouseholdConfirmAdultInvitationRecipientInput.Type;

const HouseholdPeopleCallerAdmission = Schema.Union([
  HouseholdPeopleCreatorAdmission,
  HouseholdPeopleMemberAdmission,
]);

/** Closed private owner-authorized account-link repair input. */
export const HouseholdRepairAdultAccountLinkInput = Schema.Struct({
  admission: HouseholdPeopleCreatorAdmission,
  payload: RepairAdultAccountLinkPayload,
  targetLinkageSubject: HouseholdPersonLinkageSubject,
});
export type HouseholdRepairAdultAccountLinkInput =
  typeof HouseholdRepairAdultAccountLinkInput.Type;

/** Closed private member-or-owner departure preparation input. */
export const HouseholdPrepareMemberDepartureInput = Schema.Struct({
  admission: HouseholdPeopleCallerAdmission,
  payload: PrepareMemberDeparturePayload,
  removalMutationId: Schema.optionalKey(HouseholdPersonMutationId),
  targetLinkageSubject: HouseholdPersonLinkageSubject,
});
export type HouseholdPrepareMemberDepartureInput =
  typeof HouseholdPrepareMemberDepartureInput.Type;

/** Closed private departure start input. */
export const HouseholdStartMemberDepartureInput = Schema.Struct({
  admission: HouseholdPeopleCallerAdmission,
  expectedOperationVersion: HouseholdMemberDepartureOperation.fields.version,
  operationId: HouseholdMemberDepartureOperationId,
});
export type HouseholdStartMemberDepartureInput =
  typeof HouseholdStartMemberDepartureInput.Type;

/** Closed private prepared-departure cancellation input. */
export const HouseholdCancelMemberDepartureInput = Schema.Struct({
  admission: HouseholdPeopleCallerAdmission,
  operationId: HouseholdMemberDepartureOperationId,
  payload: CancelMemberDeparturePayload,
});
export type HouseholdCancelMemberDepartureInput =
  typeof HouseholdCancelMemberDepartureInput.Type;

/** Closed private owner-or-self departure repair input. */
export const HouseholdRetryMemberDepartureInput = Schema.Struct({
  admission: HouseholdPeopleCallerAdmission,
  operationId: HouseholdMemberDepartureOperationId,
  payload: RetryMemberDeparturePayload,
  targetLinkageSubject: Schema.NullOr(HouseholdPersonLinkageSubject),
});
export type HouseholdRetryMemberDepartureInput =
  typeof HouseholdRetryMemberDepartureInput.Type;

/** Closed private accepted-return input for the same historical person. */
export const HouseholdRestoreReturningAdultLinkInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: RestoreReturningAdultLinkPayload,
});
export type HouseholdRestoreReturningAdultLinkInput =
  typeof HouseholdRestoreReturningAdultLinkInput.Type;

/** Closed member-visible departure-operation query. */
export const HouseholdGetMemberDepartureInput = Schema.Struct({
  admission: HouseholdPeopleCallerAdmission,
  operationId: HouseholdMemberDepartureOperationId,
});
export type HouseholdGetMemberDepartureInput =
  typeof HouseholdGetMemberDepartureInput.Type;

/** Closed member-visible lookup of the operation created by one retained mutation. */
export const HouseholdGetMemberDepartureByMutationInput = Schema.Struct({
  admission: HouseholdPeopleCallerAdmission,
  mutationId: HouseholdPersonMutationId,
});
export type HouseholdGetMemberDepartureByMutationInput =
  typeof HouseholdGetMemberDepartureByMutationInput.Type;

/** Exact-purpose system query used by the dedicated departure Workflow. */
export const HouseholdReadMemberDepartureSystemInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  operationId: HouseholdMemberDepartureOperationId,
});
export type HouseholdReadMemberDepartureSystemInput =
  typeof HouseholdReadMemberDepartureSystemInput.Type;

/** Privacy-safe authority needed by the departure Workflow to reconcile membership. */
export const HouseholdMemberDepartureSystemState = Schema.Struct({
  operation: HouseholdMemberDepartureOperation,
  targetLinkageSubject: HouseholdPersonLinkageSubject,
});
export type HouseholdMemberDepartureSystemState =
  typeof HouseholdMemberDepartureSystemState.Type;

/** Exact-purpose system transition after canonical membership absence. */
export const HouseholdConfirmMemberAccessRevokedInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedOperationVersion: HouseholdMemberDepartureOperation.fields.version,
  operationId: HouseholdMemberDepartureOperationId,
});
export type HouseholdConfirmMemberAccessRevokedInput =
  typeof HouseholdConfirmMemberAccessRevokedInput.Type;

/** Exact-purpose system finalization after a final absence read. */
export const HouseholdFinalizeMemberDepartureInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedOperationVersion: HouseholdMemberDepartureOperation.fields.version,
  operationId: HouseholdMemberDepartureOperationId,
});
export type HouseholdFinalizeMemberDepartureInput =
  typeof HouseholdFinalizeMemberDepartureInput.Type;

/** Exact-purpose bounded failure transition owned by the departure Workflow. */
export const HouseholdMarkMemberDepartureRepairRequiredInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedOperationVersion: HouseholdMemberDepartureOperation.fields.version,
  operationId: HouseholdMemberDepartureOperationId,
  phase: Schema.Literals(["finalization", "revocation"]),
});
export type HouseholdMarkMemberDepartureRepairRequiredInput =
  typeof HouseholdMarkMemberDepartureRepairRequiredInput.Type;

/** Closed private unlinked-person creation input. */
export const HouseholdCreatePersonInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: CreateHouseholdPersonPayload,
});
export type HouseholdCreatePersonInput = typeof HouseholdCreatePersonInput.Type;

/** Closed private roster-list input. */
export const HouseholdListPeopleInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  query: Schema.toEncoded(ListHouseholdPeopleUrlParams),
});
export type HouseholdListPeopleInput = typeof HouseholdListPeopleInput.Type;

/** Closed private person-read input. */
export const HouseholdGetPersonInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  personId: HouseholdPersonId,
});
export type HouseholdGetPersonInput = typeof HouseholdGetPersonInput.Type;

/** Closed private lifecycle-transition input. */
export const HouseholdTransitionPersonInput = Schema.Struct({
  admission: HouseholdPeopleCallerAdmission,
  cancelledInvitationDigest: Schema.optionalKey(HouseholdInvitationDigest),
  payload: TransitionHouseholdPersonPayload,
  personId: HouseholdPersonId,
});
export type HouseholdTransitionPersonInput =
  typeof HouseholdTransitionPersonInput.Type;

export const HouseholdRenamePersonInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: RenameHouseholdPersonPayload,
  personId: HouseholdPersonId,
});
export type HouseholdRenamePersonInput = typeof HouseholdRenamePersonInput.Type;

/** Private roster carries invitation identities only between the DO and API. */
export const HouseholdPeoplePrivateRoster = Schema.Struct({
  pendingInvitations: Schema.Array(
    Schema.Struct({
      invitationDigest: HouseholdInvitationDigest,
      personId: HouseholdPersonId,
    })
  ),
  roster: HouseholdPeopleRoster,
});

/** Retained private authority for one owner-requested removal. */
export const HouseholdPersonRemovalPlan = Schema.Struct({
  action: Schema.Union([
    Schema.TaggedStruct("archive", {}),
    Schema.TaggedStruct("cancel_invitation", {
      invitationDigest: HouseholdInvitationDigest,
    }),
    Schema.TaggedStruct("depart", {
      linkVersion: HouseholdMemberDepartureOperation.fields.version,
      linkageSubject: HouseholdPersonLinkageSubject,
    }),
  ]),
  completedPerson: Schema.NullOr(HouseholdPerson),
  person: HouseholdPerson,
});
export type HouseholdPersonRemovalPlan = typeof HouseholdPersonRemovalPlan.Type;
export const HouseholdPreparePersonRemovalInput = Schema.Struct({
  admission: HouseholdPeopleCreatorAdmission,
  payload: TransitionHouseholdPersonPayload,
  personId: HouseholdPersonId,
});
export type HouseholdPreparePersonRemovalInput =
  typeof HouseholdPreparePersonRemovalInput.Type;
