import { Schema } from "effect";

import { StationId, Timestamp } from "./model.js";

// Keep raw provider values readable, including unfamiliar industrial variants.
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
      providerChargingPower: Schema.NullOr(ProviderValue),
      providerDischargePower: Schema.NullOr(ProviderValue),
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

// Residential app schedules use minutes since local midnight and ISO weekdays.
// Live residential readback replaces the null power fields sent by the app with blanks.
export const isUnusedResidentialPreheatingPower = (
  value: (typeof PreheatingConfiguration.Type.slots)[number]["providerChargingPower"]
): boolean => value === null || value === "";
const MinuteValue = Schema.Union([
  Schema.Int.check(Schema.isBetween({ maximum: 1440, minimum: 0 })),
  Schema.String.check(
    Schema.isPattern(/^\d{1,4}$/u),
    Schema.makeFilter((value) => Number(value) <= 1440)
  ),
]);
const validResidentialSlot = (
  slot: (typeof PreheatingConfiguration.Type.slots)[number]
) =>
  Schema.is(MinuteValue)(slot.providerStartTime) &&
  Schema.is(MinuteValue)(slot.providerDuration) &&
  Number(slot.providerDuration) > 0 &&
  Number(slot.providerStartTime) + Number(slot.providerDuration) <= 1440 &&
  slot.providerPeriods.length > 0 &&
  new Set(slot.providerPeriods).size === slot.providerPeriods.length &&
  slot.providerPeriods.every((day) => day >= 1 && day <= 7) &&
  isUnusedResidentialPreheatingPower(slot.providerChargingPower) &&
  isUnusedResidentialPreheatingPower(slot.providerDischargePower);
export const writableResidentialPreheating = (
  value: typeof PreheatingConfiguration.Type
): boolean =>
  !value.industrial &&
  [0, 1].includes(value.providerSwitch) &&
  // Templates retain residential mode 1 while the standalone endpoint returns null.
  [null, 1].includes(value.providerMode) &&
  value.providerEnableSwitch === null &&
  value.slots.length <= 4 &&
  value.slots.every(validResidentialSlot) &&
  value.slots.every((slot, index) =>
    value.slots
      .slice(index + 1)
      .every(
        (other) =>
          !slot.providerPeriods.some((day) =>
            other.providerPeriods.includes(day)
          ) ||
          Number(slot.providerStartTime) + Number(slot.providerDuration) <=
            Number(other.providerStartTime) ||
          Number(other.providerStartTime) + Number(other.providerDuration) <=
            Number(slot.providerStartTime)
      )
  );
