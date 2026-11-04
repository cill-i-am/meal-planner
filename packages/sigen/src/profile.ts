import { Schema } from "effect";

import { Percent, StationId, Timestamp } from "./model.js";
import { PreheatingConfiguration } from "./preheating.js";
import { AutomationSettings, PeakShavingSlot, PowerLimit } from "./settings.js";

const Snapshot = { fetchedAt: Timestamp, stationId: StationId };
const SourceCodes = Schema.Array(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))
).check(Schema.isMaxLength(32));
export const EnergyProfileFeatures = Schema.Struct({
  hasBackupSetting: Schema.Boolean,
  hasBatteryAutomation: Schema.Boolean,
  hasBatteryPriority: Schema.Boolean,
  hasBatterySetting: Schema.Boolean,
  hasEVACSetting: Schema.Boolean,
  hasEVDCSetting: Schema.Boolean,
  hasGridAutomation: Schema.Boolean,
  hasGridPriority: Schema.Boolean,
  hasPVPriority: Schema.Boolean,
  isIndustry: Schema.Boolean,
  support: Schema.Boolean,
  supportFreePowerOptimization: Schema.Boolean,
  supportZeroFeedInControl: Schema.Boolean,
});
export const EnergyCapabilities = Schema.Struct({
  ...Snapshot,
  batterySourceOptions: SourceCodes,
  emsUpgradeSupported: Schema.Boolean,
  gridSourceOptions: SourceCodes,
  providerFeatures: EnergyProfileFeatures,
});
export const BatteryDischargePriority = Schema.Struct({
  ...Snapshot,
  providerSources: SourceCodes,
});

export const ProfileId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(-1));
export const ProfileTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("current") }),
  Schema.Struct({
    kind: Schema.Literal("custom"),
    profileId: ProfileId.check(Schema.isGreaterThan(0)),
  }),
  Schema.Struct({
    kind: Schema.Literal("template"),
    profileId: ProfileId,
    providerMode: Schema.Int,
  }),
]);
export const EnergyProfileInput = Schema.Struct({
  stationId: StationId,
  target: ProfileTarget,
});
export type EnergyProfileInput = typeof EnergyProfileInput.Type;
export const ProfileTemplates = Schema.Struct({
  ...Snapshot,
  templates: Schema.Array(
    Schema.Struct({
      description: Schema.String.check(Schema.isMaxLength(8192)),
      name: Schema.String.check(Schema.isMaxLength(256)),
      profileId: ProfileId,
      providerMode: Schema.Int,
    })
  ).check(Schema.isMaxLength(256)),
});

// A path retains group nesting and provider order without exposing an unbounded recursive schema.
export const SolarPriorityEntry = Schema.Struct({
  group: Schema.Boolean,
  groupPath: Schema.Array(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  ).check(Schema.isMaxLength(5)),
  loadKey: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  loadName: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  providerDeviceType: Schema.NullOr(Schema.Int),
  providerLoadType: Schema.Int,
  providerPriority: Schema.Int,
  providerStatus: Schema.Int,
  smartLoadKey: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  smartLoadName: Schema.String.check(Schema.isMaxLength(256)),
  smartLoadPath: Schema.NullOr(Schema.Int),
  smartLoadStatus: Schema.NullOr(Schema.Int),
});
export const SolarPriority = Schema.Struct({
  ...Snapshot,
  entries: Schema.Array(SolarPriorityEntry).check(Schema.isMaxLength(128)),
});
export const EnergyProfile = Schema.Struct({
  ...AutomationSettings.fields,
  backupSocPercent: Schema.NullOr(Percent),
  batteryChargeLimit: PowerLimit,
  batteryDischargeLimit: PowerLimit,
  batteryDischargeSources: BatteryDischargePriority.fields.providerSources,
  chargeSocPercent: Schema.NullOr(Percent),
  description: Schema.String.check(Schema.isMaxLength(8192)),
  dischargeSocPercent: Schema.NullOr(Percent),
  gridExportEnabled: Schema.Boolean,
  gridExportLimit: PowerLimit,
  gridImportEnabled: Schema.Boolean,
  gridImportLimit: PowerLimit,
  industrial: Schema.Boolean,
  peakShaving: Schema.Struct({
    providerControlMode: Schema.Int,
    reserveSocPercent: Percent,
    slots: Schema.Array(PeakShavingSlot).check(Schema.isMaxLength(64)),
  }),
  preheating: PreheatingConfiguration,
  solarLimit: PowerLimit,
  solarPriority: SolarPriority.fields.entries,
  target: ProfileTarget,
});
