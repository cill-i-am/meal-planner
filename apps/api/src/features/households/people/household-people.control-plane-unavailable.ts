import { Data } from "effect";

export class HouseholdPeopleControlPlaneUnavailable extends Data.TaggedError(
  "HouseholdPeopleControlPlaneUnavailable"
) {}
