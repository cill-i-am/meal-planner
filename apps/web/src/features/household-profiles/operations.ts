import type {
  HouseholdPersonId,
  HouseholdProfileRejected,
  MutatePersonProfilePayload,
  PersonProfile,
  ProfileVersionPage,
} from "@meal-planner/household-api";

export interface HouseholdProfileOperations {
  readonly get: (personId: HouseholdPersonId) => Promise<PersonProfile>;
  readonly versions: (
    personId: HouseholdPersonId,
    beforeVersion?: number
  ) => Promise<ProfileVersionPage>;
  readonly mutate: (
    personId: HouseholdPersonId,
    payload: MutatePersonProfilePayload
  ) => Promise<PersonProfile>;
}

export class ProfileOperationError extends Error {
  readonly code: "ambiguous" | HouseholdProfileRejected["reason"];
  constructor(
    code: "ambiguous" | HouseholdProfileRejected["reason"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "ProfileOperationError";
    this.code = code;
  }
}

export const isAmbiguousProfileError = (error: Error) =>
  !(error instanceof ProfileOperationError) || error.code === "ambiguous";
