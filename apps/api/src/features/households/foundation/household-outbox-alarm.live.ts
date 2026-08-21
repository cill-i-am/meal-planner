import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import {
  HouseholdOutboxAlarm,
  HouseholdOutboxAlarmFailure,
} from "./household-outbox-alarm.js";

export const makeHouseholdOutboxAlarm = (
  state: Cloudflare.DurableObjectState["Service"]
) =>
  HouseholdOutboxAlarm.of({
    schedule: (scheduledAtEpochMs) =>
      state.storage
        .setAlarm(scheduledAtEpochMs)
        .pipe(Effect.mapError(() => new HouseholdOutboxAlarmFailure())),
  });
