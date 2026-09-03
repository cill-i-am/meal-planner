import type {
  AssociateHouseholdAdultInvitationPayload,
  CancelHouseholdAdultDeparturePayload,
  CompleteHouseholdAdultLinkPayload,
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  DepartHouseholdAdultPayload,
  HouseholdAdultInvitationResult,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureOperationId,
  HouseholdPendingAdultInvitations,
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdPersonId,
  InviteHouseholdAdultPayload,
  RepairHouseholdAdultLinkPayload,
  RetryHouseholdAdultDeparturePayload,
  ReturnHouseholdAdultPayload,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import { Option, Schema } from "effect";

export const HouseholdPeopleOperationFailureCode = Schema.Literals([
  "bootstrap_conflict",
  "creator_required",
  "organizer_required",
  "association_conflict",
  "association_stale",
  "control_plane_resource_not_found",
  "control_plane_unavailable",
  "departure_conflict",
  "internal_error",
  "invalid_request",
  "lifecycle_conflict",
  "mutation_collision",
  "people_unavailable",
  "person_not_found",
  "stale_version",
  "transport_unavailable",
  "unauthorized",
  "unexpected_failure",
]);
export type HouseholdPeopleOperationFailureCode =
  typeof HouseholdPeopleOperationFailureCode.Type;

const HouseholdPeopleOperationFailureEnvelope = Schema.Struct({
  code: HouseholdPeopleOperationFailureCode,
});

export const decodeHouseholdPeopleOperationFailure = Schema.decodeUnknownOption(
  HouseholdPeopleOperationFailureEnvelope,
  { onExcessProperty: "ignore" }
);

/** Closed browser-facing error used for retry and user-message decisions. */
export class HouseholdPeopleOperationError extends Error {
  readonly code: HouseholdPeopleOperationFailureCode;

  constructor(
    code: HouseholdPeopleOperationFailureCode,
    options?: ErrorOptions
  ) {
    super(code, options);
    this.code = code;
    this.name = "HouseholdPeopleOperationError";
  }
}

export const householdPeopleFailureCode = (
  error: Error | null
): HouseholdPeopleOperationFailureCode | undefined =>
  Option.getOrUndefined(decodeHouseholdPeopleOperationFailure(error))?.code;

export const isAmbiguousHouseholdPeopleFailure = (error: Error | null) => {
  const code = householdPeopleFailureCode(error);
  return (
    code === "internal_error" ||
    code === "people_unavailable" ||
    code === "transport_unavailable"
  );
};

/** Browser-facing household people operations. */
export interface HouseholdPeopleOperations {
  readonly associateInvitation?: (
    payload: AssociateHouseholdAdultInvitationPayload
  ) => Promise<HouseholdPerson>;
  readonly archive: (
    personId: HouseholdPersonId,
    payload: TransitionHouseholdPersonPayload
  ) => Promise<HouseholdPerson>;
  readonly bootstrapCreator: (
    payload: BootstrapHouseholdCreatorPayload
  ) => Promise<HouseholdPerson>;
  readonly create: (
    payload: CreateHouseholdPersonPayload
  ) => Promise<HouseholdPerson>;
  readonly completeAdultLink?: (
    payload: CompleteHouseholdAdultLinkPayload
  ) => Promise<HouseholdPerson>;
  readonly cancelDeparture?: (
    operationId: HouseholdMemberDepartureOperationId,
    payload: CancelHouseholdAdultDeparturePayload
  ) => Promise<HouseholdMemberDepartureOperation>;
  readonly departAdult?: (
    payload: DepartHouseholdAdultPayload
  ) => Promise<HouseholdMemberDepartureOperation>;
  readonly getDeparture?: (
    operationId: HouseholdMemberDepartureOperationId
  ) => Promise<HouseholdMemberDepartureOperation>;
  readonly inviteAdult?: (
    payload: InviteHouseholdAdultPayload
  ) => Promise<HouseholdAdultInvitationResult>;
  readonly list: (includeArchived: boolean) => Promise<HouseholdPeopleRoster>;
  readonly listPendingInvitations?: () => Promise<HouseholdPendingAdultInvitations>;
  readonly repairAdultLink?: (
    payload: RepairHouseholdAdultLinkPayload
  ) => Promise<HouseholdPerson>;
  readonly retryDeparture?: (
    operationId: HouseholdMemberDepartureOperationId,
    payload: RetryHouseholdAdultDeparturePayload
  ) => Promise<HouseholdMemberDepartureOperation>;
  readonly returnAdult?: (
    payload: ReturnHouseholdAdultPayload
  ) => Promise<HouseholdPerson>;
  readonly restore: (
    personId: HouseholdPersonId,
    payload: TransitionHouseholdPersonPayload
  ) => Promise<HouseholdPerson>;
}
