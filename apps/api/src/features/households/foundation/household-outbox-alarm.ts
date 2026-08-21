import type { RuntimeContext } from "alchemy";
import { Context, Data, Effect } from "effect";

export class HouseholdOutboxAlarmFailure extends Data.TaggedError(
  "HouseholdOutboxAlarmFailure"
) {}

export interface HouseholdOutboxAlarmService {
  readonly schedule: (
    scheduledAtEpochMs: number
  ) => Effect.Effect<void, HouseholdOutboxAlarmFailure, RuntimeContext>;
}

export class HouseholdOutboxAlarm extends Context.Service<
  HouseholdOutboxAlarm,
  HouseholdOutboxAlarmService
>()("meal-planner/households/HouseholdOutboxAlarm") {}
