import { Data } from "effect";

export class HouseholdAuthorityServiceFailure extends Data.TaggedError(
  "HouseholdAuthorityServiceFailure"
) {}
