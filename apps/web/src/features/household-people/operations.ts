import type {
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdPersonId,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import { Option, Schema } from "effect";

export const HouseholdPeopleOperationFailureCode = Schema.Literals([
  "bootstrap_conflict",
  "creator_required",
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
  readonly list: (includeArchived: boolean) => Promise<HouseholdPeopleRoster>;
  readonly restore: (
    personId: HouseholdPersonId,
    payload: TransitionHouseholdPersonPayload
  ) => Promise<HouseholdPerson>;
}
