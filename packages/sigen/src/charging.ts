import { Schema } from "effect";

import { Percent, SerialNumber, StationId, Timestamp } from "./model.js";

export const ChargerKind = Schema.Literals(["ac", "dc"]);
export const ChargerInput = Schema.Struct({
  kind: ChargerKind,
  serialNumber: SerialNumber,
  stationId: StationId,
});
export type ChargerInput = typeof ChargerInput.Type;
const Inventory = Schema.Struct({
  availability: Schema.Literals(["known", "unknown"]),
  serialNumbers: Schema.Array(SerialNumber).check(Schema.isMaxLength(128)),
});
export const Chargers = Schema.Struct({
  ac: Inventory,
  dc: Inventory,
  fetchedAt: Timestamp,
  stationId: StationId,
});
export const ChargerStatus = Schema.Struct({
  ...ChargerInput.fields,
  batteryCutoffSocPercent: Schema.NullOr(Percent),
  fetchedAt: Timestamp,
  fromBatteryEnabled: Schema.NullOr(Schema.Boolean),
  fromGridEnabled: Schema.NullOr(Schema.Boolean),
  lowerSocPercent: Schema.NullOr(Percent),
  pluggedIn: Schema.Boolean,
  providerChargeMode: Schema.NullOr(Schema.Int),
  upperSocPercent: Schema.NullOr(Percent),
});
export const AcChargerCurrent = Schema.Struct({
  ...ChargerInput.fields,
  fetchedAt: Timestamp,
  kind: Schema.Literal("ac"),
  lastSetCurrent: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("unset") }),
    Schema.Struct({ kind: Schema.Literal("unknown") }),
    Schema.Struct({
      kind: Schema.Literal("amperes"),
      value: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ]),
  maximumAmperes: Schema.NullOr(Schema.Finite),
  providerDlmStatus: Schema.NullOr(Schema.Int),
});
export const DcChargerSettings = Schema.Struct({
  ...ChargerInput.fields,
  chargeCutoffSocPercent: Schema.NullOr(Percent),
  dischargeCutoffSocPercent: Schema.NullOr(Percent),
  fetchedAt: Timestamp,
  kind: Schema.Literal("dc"),
  powerUnit: Schema.Literal("provider_unit_unverified"),
  providerAllowedChargePower: Schema.NullOr(Schema.Finite),
  providerRatedPower: Schema.NullOr(Schema.Finite),
});

/** Device settings retain provider codes; option labels and installer changes are not exposed. */
export const AcChargerSettings = Schema.Struct({
  ...ChargerInput.fields,
  fetchedAt: Timestamp,
  kind: Schema.Literal("ac"),
  providerChargingOutputCurrent: Schema.NullOr(Schema.Finite),
  providerDlmStatus: Schema.NullOr(Schema.Int),
  providerHomeCircuitBreaker: Schema.NullOr(Schema.Finite),
  providerMeterPhase: Schema.NullOr(Schema.Int),
  providerOffGridCharge: Schema.NullOr(Schema.Int),
  providerPhaseAutoSwitch: Schema.NullOr(Schema.Int),
  providerPhaseType: Schema.NullOr(Schema.Int),
  providerPileCircuitBreaker: Schema.NullOr(Schema.Finite),
  providerRunStatus: Schema.NullOr(Schema.Int),
  supportsThreePhase: Schema.NullOr(Schema.Boolean),
});
const Label = Schema.NullOr(Schema.String.check(Schema.isMaxLength(256)));
export const ChargerSchedule = Schema.Struct({
  batteryCutoffSocPercent: Schema.NullOr(Percent),
  endTime: Label,
  fromGridEnabled: Schema.NullOr(Schema.Boolean),
  id: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  name: Label,
  nextDay: Schema.NullOr(Schema.Boolean),
  providerChargeMode: Schema.NullOr(Schema.Int),
  providerDays: Label,
  providerEnableFromPack: Schema.NullOr(Schema.Int),
  providerFrequency: Schema.NullOr(Schema.Int),
  providerMaxGridPower: Schema.NullOr(Schema.Finite),
  providerOpen: Schema.NullOr(Schema.Int),
  providerSettingMode: Schema.NullOr(Schema.Int),
  providerTime: Label,
  startTime: Label,
});
export const ChargerSchedules = Schema.Struct({
  ...ChargerInput.fields,
  fetchedAt: Timestamp,
  powerUnit: Schema.Literal("provider_unit_unverified"),
  schedules: Schema.NullOr(
    Schema.Array(ChargerSchedule).check(Schema.isMaxLength(128))
  ),
  timezone: Schema.String,
});
