import {
  AssociateAdultInvitationPayload,
  BootstrapHouseholdCreatorPayload,
  CancelMemberDeparturePayload,
  CompleteAcceptedAdultLinkPayload,
  CreateHouseholdPersonPayload,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureOperationId,
  HouseholdMemberDepartureStart,
  HouseholdPerson,
  HouseholdPersonId,
  HouseholdPersonLinkageSubject,
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

const PersonWire = Schema.toEncoded(HouseholdPerson);

/** Closed private creator bootstrap input. */
export const HouseholdBootstrapCreatorPersonInput = Schema.Struct({
  admission: HouseholdPeopleCreatorAdmission,
  payload: BootstrapHouseholdCreatorPayload,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdBootstrapCreatorPersonInput =
  typeof HouseholdBootstrapCreatorPersonInput.Type;

/** Closed private owner-authorized invitation association input. */
export const HouseholdAssociateAdultInvitationInput = Schema.Struct({
  admission: HouseholdPeopleCreatorAdmission,
  payload: AssociateAdultInvitationPayload,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdAssociateAdultInvitationInput =
  typeof HouseholdAssociateAdultInvitationInput.Type;

/** Closed private accepted-member account-link completion input. */
export const HouseholdCompleteAcceptedAdultLinkInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: CompleteAcceptedAdultLinkPayload,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdCompleteAcceptedAdultLinkInput =
  typeof HouseholdCompleteAcceptedAdultLinkInput.Type;

/** Exact-recipient proof captured after Better Auth authenticates invitation acceptance. */
export const HouseholdConfirmAdultInvitationRecipientInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  invitationDigest: CompleteAcceptedAdultLinkPayload.fields.invitationDigest,
  linkageSubject: HouseholdPersonLinkageSubject,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
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
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdRepairAdultAccountLinkInput =
  typeof HouseholdRepairAdultAccountLinkInput.Type;

/** Closed private member-or-owner departure preparation input. */
export const HouseholdPrepareMemberDepartureInput = Schema.Struct({
  admission: HouseholdPeopleCallerAdmission,
  payload: PrepareMemberDeparturePayload,
  targetLinkageSubject: HouseholdPersonLinkageSubject,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdPrepareMemberDepartureInput =
  typeof HouseholdPrepareMemberDepartureInput.Type;

/** Closed private departure start input. */
export const HouseholdStartMemberDepartureInput = Schema.Struct({
  admission: HouseholdPeopleCallerAdmission,
  expectedOperationVersion: HouseholdMemberDepartureOperation.fields.version,
  operationId: HouseholdMemberDepartureOperationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdStartMemberDepartureInput =
  typeof HouseholdStartMemberDepartureInput.Type;

/** Closed private prepared-departure cancellation input. */
export const HouseholdCancelMemberDepartureInput = Schema.Struct({
  admission: HouseholdPeopleCallerAdmission,
  operationId: HouseholdMemberDepartureOperationId,
  payload: CancelMemberDeparturePayload,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdCancelMemberDepartureInput =
  typeof HouseholdCancelMemberDepartureInput.Type;

/** Closed private owner-or-self departure repair input. */
export const HouseholdRetryMemberDepartureInput = Schema.Struct({
  admission: HouseholdPeopleCallerAdmission,
  operationId: HouseholdMemberDepartureOperationId,
  payload: RetryMemberDeparturePayload,
  targetLinkageSubject: Schema.NullOr(HouseholdPersonLinkageSubject),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdRetryMemberDepartureInput =
  typeof HouseholdRetryMemberDepartureInput.Type;

/** Closed private accepted-return input for the same historical person. */
export const HouseholdRestoreReturningAdultLinkInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: RestoreReturningAdultLinkPayload,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdRestoreReturningAdultLinkInput =
  typeof HouseholdRestoreReturningAdultLinkInput.Type;

/** Closed member-visible departure-operation query. */
export const HouseholdGetMemberDepartureInput = Schema.Struct({
  admission: HouseholdPeopleCallerAdmission,
  operationId: HouseholdMemberDepartureOperationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdGetMemberDepartureInput =
  typeof HouseholdGetMemberDepartureInput.Type;

/** Exact-purpose system query used by the dedicated departure Workflow. */
export const HouseholdReadMemberDepartureSystemInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  operationId: HouseholdMemberDepartureOperationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
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
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdConfirmMemberAccessRevokedInput =
  typeof HouseholdConfirmMemberAccessRevokedInput.Type;

/** Exact-purpose system finalization after a final absence read. */
export const HouseholdFinalizeMemberDepartureInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedOperationVersion: HouseholdMemberDepartureOperation.fields.version,
  operationId: HouseholdMemberDepartureOperationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdFinalizeMemberDepartureInput =
  typeof HouseholdFinalizeMemberDepartureInput.Type;

/** Exact-purpose bounded failure transition owned by the departure Workflow. */
export const HouseholdMarkMemberDepartureRepairRequiredInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedOperationVersion: HouseholdMemberDepartureOperation.fields.version,
  operationId: HouseholdMemberDepartureOperationId,
  phase: Schema.Literals(["finalization", "revocation"]),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdMarkMemberDepartureRepairRequiredInput =
  typeof HouseholdMarkMemberDepartureRepairRequiredInput.Type;

/** Closed private unlinked-person creation input. */
export const HouseholdCreatePersonInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: CreateHouseholdPersonPayload,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdCreatePersonInput = typeof HouseholdCreatePersonInput.Type;

/** Closed private roster-list input. */
export const HouseholdListPeopleInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  query: Schema.toEncoded(ListHouseholdPeopleUrlParams),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdListPeopleInput = typeof HouseholdListPeopleInput.Type;

/** Closed private person-read input. */
export const HouseholdGetPersonInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  personId: HouseholdPersonId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdGetPersonInput = typeof HouseholdGetPersonInput.Type;

/** Closed private lifecycle-transition input. */
export const HouseholdTransitionPersonInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: TransitionHouseholdPersonPayload,
  personId: HouseholdPersonId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdTransitionPersonInput =
  typeof HouseholdTransitionPersonInput.Type;

/** Encoded privacy-safe person result crossing the private Worker boundary. */
export const HouseholdPersonWire = PersonWire;

/** Encoded privacy-safe departure operation crossing the private Worker boundary. */
export const HouseholdMemberDepartureOperationWire = Schema.toEncoded(
  HouseholdMemberDepartureOperation
);

/** Encoded privacy-safe Workflow authority crossing the private Worker boundary. */
export const HouseholdMemberDepartureSystemStateWire = Schema.toEncoded(
  HouseholdMemberDepartureSystemState
);

/** Encoded privacy-safe departure start crossing the private Worker boundary. */
export const HouseholdMemberDepartureStartWire = Schema.toEncoded(
  HouseholdMemberDepartureStart
);
