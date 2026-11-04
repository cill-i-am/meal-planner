import { Schema } from "effect";

import { StationId, Timestamp } from "./model.js";

const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
export const Stations = Schema.Struct({
  fetchedAt: Timestamp,
  stations: Schema.Array(
    Schema.Struct({
      batteryCapacityWh: Schema.NullOr(NonNegative),
      enrolled: Schema.Boolean,
      name: Schema.String.check(Schema.isMaxLength(256)),
      providerStatus: Schema.Int,
      providerType: Schema.Int,
      solarCapacityW: Schema.NullOr(NonNegative),
      stationId: StationId,
    })
  ).check(Schema.isMaxLength(256)),
});
export const StationCapabilities = Schema.Struct({
  backupSupported: Schema.Boolean,
  fetchedAt: Timestamp,
  hasAcCharger: Schema.Boolean,
  hasGateway: Schema.Boolean,
  hasInnerGateway: Schema.Boolean,
  hasMeter: Schema.Boolean,
  hasSolar: Schema.Boolean,
  hasThirdPartyInverter: Schema.Boolean,
  instantManualSupported: Schema.Boolean,
  powerSheddingSupported: Schema.Boolean,
  providerHasEv: Schema.Boolean,
  stationId: StationId,
  virtualBatterySupported: Schema.Boolean,
});
