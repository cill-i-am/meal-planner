import { Schema } from "effect";

import { StationId, Timestamp } from "./model.js";

// Units and day-code semantics are not established by an empty live schedule.
// Keep the provider values explicit instead of assigning guessed units.
const ProviderValue = Schema.Union([
  Schema.Finite,
  Schema.String.check(Schema.isMaxLength(64)),
]);
export const PreheatingConfiguration = Schema.Struct({
  automaticModeValid: Schema.NullOr(Schema.Boolean),
  industrial: Schema.Boolean,
  providerEnableSwitch: Schema.NullOr(Schema.Int),
  providerMode: Schema.NullOr(Schema.Int),
  providerSwitch: Schema.Int,
  slots: Schema.Array(
    Schema.Struct({
      providerChargingPower: ProviderValue,
      providerDischargePower: ProviderValue,
      providerDuration: ProviderValue,
      providerPeriods: Schema.Array(Schema.Int).check(Schema.isMaxLength(7)),
      providerStartTime: ProviderValue,
    })
  ).check(Schema.isMaxLength(64)),
});
export const PreheatingSettings = Schema.Struct({
  ...PreheatingConfiguration.fields,
  fetchedAt: Timestamp,
  stationId: StationId,
});
