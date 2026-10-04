import type {
  AssociateHouseholdAdultInvitationPayload,
  CancelHouseholdAdultDeparturePayload,
  CompleteHouseholdAdultLinkPayload,
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  RenameHouseholdPersonPayload,
  DepartHouseholdAdultPayload,
  HouseholdAdultInvitationResult,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureOperationId,
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdPersonId,
  HouseholdPersonMutationId,
  InviteHouseholdAdultPayload,
  RepairHouseholdAdultLinkPayload,
  RetryHouseholdAdultDeparturePayload,
  ReturnHouseholdAdultPayload,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import { InvitationRejectionReason } from "@meal-planner/household-api";
import { Cause, Option, Schema } from "effect";
import type { Effect } from "effect";

import { queryFailure } from "../api-client/index.js";

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
  "invitation_rejected",
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
  reason: Schema.optional(InvitationRejectionReason),
});

export const decodeHouseholdPeopleOperationFailure = Schema.decodeUnknownOption(
  HouseholdPeopleOperationFailureEnvelope,
  { onExcessProperty: "ignore" }
);

/** Closed browser-facing error used for retry and user-message decisions. */
export class HouseholdPeopleOperationError extends Error {
  readonly _tag = "HouseholdPeopleOperationError" as const;
  readonly code: HouseholdPeopleOperationFailureCode;
  readonly invitationRejection: InvitationRejectionReason | undefined;

  constructor(
    code: HouseholdPeopleOperationFailureCode,
    options?: ErrorOptions
  ) {
    super(code, options);
    this.code = code;
    this.name = "HouseholdPeopleOperationError";
    this.invitationRejection = Option.getOrUndefined(
      decodeHouseholdPeopleOperationFailure(options?.cause)
    )?.reason;
  }
}

const QueryDefect = Schema.Struct({
  _tag: Schema.Literal("EffectQueryDefect"),
});
const QueryFailureCause = Schema.Struct({
  _tag: Schema.Literal("EffectQueryFailure"),
  failureCause: Schema.declare<Cause.Cause<unknown>>(Cause.isCause),
});
const decodeQueryFailureCause = Schema.decodeUnknownOption(QueryFailureCause);

export const householdPeopleFailureCode = (
  error: Error | null
): HouseholdPeopleOperationFailureCode | undefined => {
  const wrapped = decodeQueryFailureCause(error);
  if (
    Schema.is(QueryDefect)(error) ||
    (Option.isSome(wrapped) &&
      (wrapped.value.failureCause.reasons.length !== 1 ||
        wrapped.value.failureCause.reasons.some(
          (reason) => !Cause.isFailReason(reason)
        )))
  ) {
    return "transport_unavailable";
  }
  return Option.getOrUndefined(
    decodeHouseholdPeopleOperationFailure(queryFailure(error))
  )?.code;
};

export const isAmbiguousHouseholdPeopleFailure = (error: Error | null) => {
  const code = householdPeopleFailureCode(error);
  return (
    code === "control_plane_unavailable" ||
    code === "internal_error" ||
    code === "people_unavailable" ||
    code === "transport_unavailable"
  );
};

/** Generated-client operations shared by screens and their test adapters. */
export interface HouseholdPeopleEffectOperations {
  readonly rename: (
    personId: HouseholdPersonId,
    payload: RenameHouseholdPersonPayload
  ) => Effect.Effect<HouseholdPerson, HouseholdPeopleOperationError>;
  readonly associateInvitation: (
    payload: AssociateHouseholdAdultInvitationPayload
  ) => Effect.Effect<HouseholdPerson, HouseholdPeopleOperationError>;
  readonly remove: (
    personId: HouseholdPersonId,
    payload: TransitionHouseholdPersonPayload
  ) => Effect.Effect<HouseholdPerson, HouseholdPeopleOperationError>;
  readonly archive: (
    personId: HouseholdPersonId,
    payload: TransitionHouseholdPersonPayload
  ) => Effect.Effect<HouseholdPerson, HouseholdPeopleOperationError>;
  readonly bootstrapCreator: (
    payload: BootstrapHouseholdCreatorPayload
  ) => Effect.Effect<HouseholdPerson, HouseholdPeopleOperationError>;
  readonly create: (
    payload: CreateHouseholdPersonPayload
  ) => Effect.Effect<HouseholdPerson, HouseholdPeopleOperationError>;
  readonly completeAdultLink: (
    payload: CompleteHouseholdAdultLinkPayload
  ) => Effect.Effect<HouseholdPerson, HouseholdPeopleOperationError>;
  readonly cancelDeparture: (
    operationId: HouseholdMemberDepartureOperationId,
    payload: CancelHouseholdAdultDeparturePayload
  ) => Effect.Effect<
    HouseholdMemberDepartureOperation,
    HouseholdPeopleOperationError
  >;
  readonly departAdult: (
    payload: DepartHouseholdAdultPayload
  ) => Effect.Effect<
    HouseholdMemberDepartureOperation,
    HouseholdPeopleOperationError
  >;
  readonly getDeparture: (
    operationId: HouseholdMemberDepartureOperationId
  ) => Effect.Effect<
    HouseholdMemberDepartureOperation,
    HouseholdPeopleOperationError
  >;
  readonly getDepartureByMutation: (
    mutationId: HouseholdPersonMutationId
  ) => Effect.Effect<
    HouseholdMemberDepartureOperation,
    HouseholdPeopleOperationError
  >;
  readonly inviteAdult: (
    payload: InviteHouseholdAdultPayload
  ) => Effect.Effect<
    HouseholdAdultInvitationResult,
    HouseholdPeopleOperationError
  >;
  readonly list: (
    includeArchived: boolean
  ) => Effect.Effect<HouseholdPeopleRoster, HouseholdPeopleOperationError>;
  readonly repairAdultLink: (
    payload: RepairHouseholdAdultLinkPayload
  ) => Effect.Effect<HouseholdPerson, HouseholdPeopleOperationError>;
  readonly retryDeparture: (
    operationId: HouseholdMemberDepartureOperationId,
    payload: RetryHouseholdAdultDeparturePayload
  ) => Effect.Effect<
    HouseholdMemberDepartureOperation,
    HouseholdPeopleOperationError
  >;
  readonly returnAdult: (
    payload: ReturnHouseholdAdultPayload
  ) => Effect.Effect<HouseholdPerson, HouseholdPeopleOperationError>;
  readonly restore: (
    personId: HouseholdPersonId,
    payload: TransitionHouseholdPersonPayload
  ) => Effect.Effect<HouseholdPerson, HouseholdPeopleOperationError>;
}
