import { Schema } from "effect";

import { Percent, StationId, Timestamp } from "./model.js";

const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const Snapshot = { fetchedAt: Timestamp, stationId: StationId };
export const PowerLimit = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unset") }),
  Schema.Struct({ kind: Schema.Literal("unlimited") }),
  Schema.Struct({ kind: Schema.Literal("limited"), watts: NonNegative }),
]);
export type PowerLimit = typeof PowerLimit.Type;

export const BatterySettings = Schema.Struct({
  ...Snapshot,
  backupReservePercent: Percent,
  backupSocPercent: Schema.NullOr(Percent),
  chargeLimit: PowerLimit,
  chargeSocPercent: Schema.NullOr(Percent),
  dischargeLimit: PowerLimit,
  dischargeSocPercent: Schema.NullOr(Percent),
  export: Schema.Struct({
    effectiveEnabled: Schema.Boolean,
    installerEnabled: Schema.NullOr(Schema.Boolean),
    ownerEnabled: Schema.NullOr(Schema.Boolean),
  }),
  ja12SocPercent: Schema.NullOr(Percent),
  peakShavingSocPercent: Schema.NullOr(Percent),
  providerOperationMode: Schema.Number,
});
const GridPowerLimit = Schema.Struct({
  effective: PowerLimit,
  enabled: Schema.Boolean,
  installer: PowerLimit,
  owner: PowerLimit,
});
export const GridSettings = Schema.Struct({
  ...Snapshot,
  connectionCurrent: Schema.Struct({
    effectiveAmps: Schema.NullOr(NonNegative),
    enabled: Schema.Boolean,
    installerAmps: Schema.NullOr(NonNegative),
    ownerAmps: Schema.NullOr(NonNegative),
  }),
  exportPower: GridPowerLimit,
  importPower: GridPowerLimit,
});
export const SolarSettings = Schema.Struct({
  ...Snapshot,
  powerLimit: PowerLimit,
});

export const OperatingModes = Schema.Struct({
  ...Snapshot,
  customProfiles: Schema.Array(
    Schema.Struct({ name: Schema.String, profileId: Schema.Number })
  ),
  modes: Schema.Array(
    Schema.Struct({ label: Schema.String, providerMode: Schema.String })
  ),
});
const TimeOfDay = Schema.String.check(
  Schema.isPattern(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/u)
);
export const PeakShavingSlot = Schema.Struct({
  endTime: TimeOfDay,
  peakPowerW: NonNegative,
  providerDays: Schema.String,
  startTime: TimeOfDay,
});
const AutomationGroup = {
  name: Schema.String,
  providerActiveStatus: Schema.Int,
  providerMode: Schema.Int,
  sourcePriority: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))
  ).check(Schema.isMaxLength(32)),
  windows: Schema.Array(
    Schema.Struct({
      endTime: TimeOfDay,
      providerDays: Schema.String,
      startTime: TimeOfDay,
    })
  ).check(Schema.isMaxLength(64)),
};
export const AutomationSettings = Schema.Struct({
  ...Snapshot,
  batteryEnabled: Schema.Boolean,
  batteryGroups: Schema.Array(
    Schema.Struct({
      ...AutomationGroup,
      chargeCutoffPercent: Schema.NullOr(Percent),
      chargeLimit: PowerLimit,
      dischargeCutoffPercent: Schema.NullOr(Percent),
      dischargeLimit: PowerLimit,
      gridChargeLimit: PowerLimit,
      gridExportLimit: PowerLimit,
    })
  ).check(Schema.isMaxLength(64)),
  gridEnabled: Schema.Boolean,
  gridGroups: Schema.Array(
    Schema.Struct({
      ...AutomationGroup,
      exportLimit: PowerLimit,
      importLimit: PowerLimit,
    })
  ).check(Schema.isMaxLength(64)),
  profileName: Schema.String,
  providerActiveStatus: Schema.Int,
  providerProfileId: Schema.NullOr(Schema.Int),
  timezone: Schema.String,
});
export const PeakShavingSchedule = Schema.Struct({
  ...Snapshot,
  // Preserve unknown control modes instead of interpreting them as disabled.
  providerControlMode: Schema.Number,
  reserveSocPercent: Percent,
  slots: Schema.Array(PeakShavingSlot).check(Schema.isMaxLength(64)),
  timezone: Schema.String,
});
export const ManualOverride = Schema.Struct({
  ...Snapshot,
  batteryPowerW: Schema.NullOr(Schema.Finite),
  batterySocPercent: Schema.NullOr(Percent),
  enabled: Schema.Boolean,
  // The provider's epoch value is retained without guessing its unit or active state.
  providerEndTime: Schema.NullOr(Schema.String),
  providerMode: Schema.NullOr(Schema.String),
});
