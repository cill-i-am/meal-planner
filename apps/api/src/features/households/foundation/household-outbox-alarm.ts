import type { RuntimeContext } from "alchemy";
import { Context } from "effect";
import type { Effect } from "effect";

import type { HouseholdOutboxAlarmFailure } from "./household-outbox-alarm-failure.js";

export { HouseholdOutboxAlarmFailure } from "./household-outbox-alarm-failure.js";

export interface HouseholdOutboxAlarmService {
  readonly schedule: (
    scheduledAtEpochMs: number
  ) => Effect.Effect<void, HouseholdOutboxAlarmFailure, RuntimeContext>;
}

export class HouseholdOutboxAlarm extends Context.Service<
  HouseholdOutboxAlarm,
  HouseholdOutboxAlarmService
>()("meal-planner/households/HouseholdOutboxAlarm") {}
