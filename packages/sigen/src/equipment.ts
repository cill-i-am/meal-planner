import { Schema } from "effect";

import { SerialNumber, StationId, Timestamp } from "./model.js";

export const DeviceInput = Schema.Struct({
  serialNumber: SerialNumber,
  stationId: StationId,
});
export type DeviceInput = typeof DeviceInput.Type;
const Snapshot = { fetchedAt: Timestamp, stationId: StationId };
export const Device = Schema.Struct({
  model: Schema.String,
  name: Schema.String,
  parentSerialNumber: Schema.NullOr(SerialNumber),
  providerCommunicationStatus: Schema.Number,
  providerDeviceType: Schema.Number,
  providerStatus: Schema.Number,
  serialNumber: SerialNumber,
  typeLabel: Schema.String,
});
export const Topology = Schema.Struct({
  ...Snapshot,
  devices: Schema.Array(Device),
  providerStationStatus: Schema.Number,
});
export const StationStatus = Schema.Struct({
  ...Snapshot,
  devices: Schema.Array(
    Schema.Struct({
      providerCommunicationStatus: Schema.Number,
      providerStatus: Schema.Number,
      serialNumber: SerialNumber,
    })
  ),
  onGrid: Schema.Boolean,
  providerNetworkType: Schema.Number,
  providerStatus: Schema.Number,
});
// Labels and units are provider display data, not stable metric identifiers.
export const DisplayParameter = Schema.Struct({
  label: Schema.String,
  text: Schema.String,
  unit: Schema.NullOr(Schema.String),
  value: Schema.String,
});
export const DeviceInfo = Schema.Struct({
  ...Snapshot,
  freshness: Schema.Literals(["provider_timestamp", "unknown"]),
  parameters: Schema.Array(DisplayParameter),
  providerDeviceType: Schema.Number,
  providerRunStatus: Schema.Number,
  providerTimestamp: Schema.NullOr(Timestamp),
  serialNumber: SerialNumber,
  softwareVersion: Schema.String,
  staticParameters: Schema.Array(DisplayParameter),
});
export const DeviceValues = Schema.Struct({
  ...Snapshot,
  aioSerialNumber: SerialNumber,
  readings: Schema.Array(
    Schema.Struct({
      providerDeviceType: Schema.Number,
      providerTimestamp: Schema.NullOr(Timestamp),
      providerValue: Schema.String,
      serialNumber: SerialNumber,
      // Unknown device types remain uninterpreted.
      unit: Schema.Literals(["W", "%", "unknown"]),
      value: Schema.NullOr(Schema.Finite),
    })
  ),
});
export const Gateway = Schema.Struct({
  ...Snapshot,
  generator: Schema.Array(DisplayParameter),
  grid: Schema.Array(DisplayParameter),
  inverter: Schema.Array(DisplayParameter),
  model: Schema.String,
  providerCommunicationStatus: Schema.Number,
  serialNumber: SerialNumber,
  softwareVersion: Schema.String,
});
export const GridDevices = Schema.Struct({
  ...Snapshot,
  devices: Schema.Array(
    Schema.Struct({
      model: Schema.String,
      providerCommunicationStatus: Schema.Number,
      providerDeviceType: Schema.Number,
      providerStatus: Schema.Number,
      serialNumber: SerialNumber,
    })
  ),
});
