import { Schema } from "effect";

import { StationId, Timestamp } from "./model.js";

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
