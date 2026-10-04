import type { HouseholdProfileRejected } from "@meal-planner/household-api";
import { Cause, Option } from "effect";

import { queryFailure, queryFailureCause } from "../api-client/index.js";

export type { HouseholdProfileOperations } from "./browser-operations.js";

export class ProfileOperationError extends Error {
  readonly _tag = "ProfileOperationError" as const;
  readonly code:
    | "ambiguous"
    | "authentication_required"
    | HouseholdProfileRejected["reason"];
  constructor(
    code:
      | "ambiguous"
      | "authentication_required"
      | HouseholdProfileRejected["reason"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "ProfileOperationError";
    this.code = code;
  }
}

/** Native query wrappers may hold multiple reasons; only a sole typed rejection is definitive. */
export const profileOperationFailure = (
  error: Error | null
): ProfileOperationError | undefined => {
  const cause = queryFailureCause(error);
  if (
    Option.isSome(cause) &&
    (cause.value.reasons.length !== 1 ||
      !cause.value.reasons.every(Cause.isFailReason))
  ) {
    return undefined;
  }
  const failure = queryFailure(error);
  return failure instanceof ProfileOperationError ? failure : undefined;
};

export const isAmbiguousProfileError = (error: Error) => {
  const failure = profileOperationFailure(error);
  return failure === undefined || failure.code === "ambiguous";
};
