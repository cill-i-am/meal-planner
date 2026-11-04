import { Schema } from "effect";

import { StationId, Timestamp } from "./model.js";

const Snapshot = { fetchedAt: Timestamp, stationId: StationId };
export const LoadPath = Schema.Int.check(
  Schema.isBetween({ maximum: 65_535, minimum: 0 })
);
export const LoadKey = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256)
);
export const SmartLoadInput = Schema.Struct({
  loadPath: LoadPath,
  stationId: StationId,
});
export type SmartLoadInput = typeof SmartLoadInput.Type;
export const SmartLoad = Schema.Struct({
  controllable: Schema.NullOr(Schema.Boolean),
  key: Schema.NullOr(LoadKey),
  name: Schema.String.check(Schema.isMaxLength(256)),
  path: LoadPath,
  providerCommunicationStatus: Schema.NullOr(Schema.Int),
  providerManualSwitch: Schema.NullOr(Schema.Int),
  providerRunMode: Schema.NullOr(Schema.Int),
});
export const SmartLoads = Schema.Struct({
  ...Snapshot,
  loads: Schema.Array(SmartLoad).check(Schema.isMaxLength(128)),
});
export const SmartLoadState = Schema.Struct({ ...Snapshot, load: SmartLoad });
export const LoadCapabilities = Schema.Struct({
  ...Snapshot,
  controllableLoadPath: Schema.NullOr(LoadPath),
  controllableLoadPortSupported: Schema.Boolean,
  generatorInstalled: Schema.Boolean,
  generatorPortSupported: Schema.Boolean,
  loadHubInverterSupported: Schema.Boolean,
});
const Label = Schema.String.check(Schema.isMaxLength(1024));
export const SystemCards = Schema.Struct({
  ...Snapshot,
  cards: Schema.Array(
    Schema.Struct({
      communicationStatus: Schema.NullOr(Schema.Int),
      hasSwitch: Schema.NullOr(Schema.Boolean),
      loadKey: Schema.NullOr(Label),
      path: Schema.NullOr(Schema.Int),
      providerType: Schema.Int,
      switchOnOff: Schema.NullOr(Schema.Int),
      valueOne: Schema.NullOr(Label),
      valueTwo: Schema.NullOr(Label),
    })
  ).check(Schema.isMaxLength(128)),
});
