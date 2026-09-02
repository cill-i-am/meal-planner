import { Data } from "effect";

export class HouseholdPeopleControlPlaneNotFound extends Data.TaggedError(
  "HouseholdPeopleControlPlaneNotFound"
) {}
