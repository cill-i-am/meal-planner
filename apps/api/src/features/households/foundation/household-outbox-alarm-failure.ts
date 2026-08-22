import { Data } from "effect";

export class HouseholdOutboxAlarmFailure extends Data.TaggedError(
  "HouseholdOutboxAlarmFailure"
) {}
