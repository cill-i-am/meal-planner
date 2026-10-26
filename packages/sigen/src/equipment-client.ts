import { Clock, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import {
  DeviceInfo,
  DeviceValues,
  Gateway,
  GridDevices,
  StationStatus,
  Topology,
} from "./equipment.js";
import type { DeviceInput, Device } from "./equipment.js";
import { SerialNumber, failure } from "./model.js";
import type { StationId } from "./model.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";

const Node = Schema.Struct({
  communicateStatus: Schema.Number,
  deviceModel: Schema.String,
  deviceName: Schema.String,
  deviceStatus: Schema.Number,
  deviceType: Schema.Number,
  deviceTypeDesc: Schema.String,
  nodeList: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(256)),
  snCode: SerialNumber,
  stationId: Schema.Number,
});
const Parameter = Schema.Struct({
  paramKey: Schema.String,
  paramValue: Schema.String,
  paramValueText: Schema.optionalKey(Schema.String),
  paramValueUnit: Schema.optionalKey(Schema.String),
});
const parameters = (values: readonly (typeof Parameter.Type)[]) =>
  values.map((value) => ({
    label: value.paramKey,
    text: value.paramValue,
    unit: value.paramValueUnit ?? null,
    value: value.paramValueText ?? value.paramValue,
  }));
const ProviderTimestamp = Schema.String.check(
  Schema.isPattern(/^(?:[0-9]{13})?$/u)
);
const timestamp = (value: string) => (value === "" ? null : Number(value));

export const makeEquipmentClient = (read: ProviderRead) => {
  const get = <S extends Schema.Top>(
    path: string,
    token: Redacted.Redacted<string>,
    schema: S
  ) => read(path, token).pipe(Effect.flatMap(decodeProvider(schema)));
  const topology = (id: StationId, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readTopology() {
      const data = yield* get(
        `/device/devicetreepanel/topology?stationId=${id}`,
        token,
        Schema.Struct({
          nodeList: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(256)),
          stationId: Schema.Number,
          stationStatus: Schema.Number,
        })
      );
      if (String(data.stationId) !== id) {
        return yield* failure("PermissionDenied");
      }
      const devices: (typeof Device.Type)[] = [];
      const seen = new Set<string>();
      // Decode each node at the provider boundary, with explicit tree and response bounds.
      const pending: {
        value: unknown;
        parent: typeof SerialNumber.Type | null;
        depth: number;
      }[] = data.nodeList.map((value) => ({ depth: 0, parent: null, value }));
      while (pending.length > 0) {
        const next = pending.pop();
        if (!next) {
          break;
        }
        if (next.depth > 16 || devices.length + pending.length >= 256) {
          return yield* failure("SchemaMismatch");
        }
        const node = yield* decodeProvider(Node)(next.value);
        if (String(node.stationId) !== id) {
          return yield* failure("PermissionDenied");
        }
        if (seen.has(node.snCode)) {
          return yield* failure("SchemaMismatch");
        }
        seen.add(node.snCode);
        devices.push({
          model: node.deviceModel,
          name: node.deviceName,
          parentSerialNumber: next.parent,
          providerCommunicationStatus: node.communicateStatus,
          providerDeviceType: node.deviceType,
          providerStatus: node.deviceStatus,
          serialNumber: node.snCode,
          typeLabel: node.deviceTypeDesc,
        });
        if (devices.length + pending.length + node.nodeList.length > 256) {
          return yield* failure("SchemaMismatch");
        }
        pending.push(
          ...node.nodeList.map((value) => ({
            depth: next.depth + 1,
            parent: node.snCode,
            value,
          }))
        );
      }
      return yield* decodeProvider(Topology)({
        devices,
        fetchedAt: yield* Clock.currentTimeMillis,
        providerStationStatus: data.stationStatus,
        stationId: id,
      });
    });
  const member = (input: DeviceInput, token: Redacted.Redacted<string>) =>
    Effect.gen(function* selectStationDevice() {
      const inventory = yield* topology(input.stationId, token);
      const device = inventory.devices.find(
        (value) => value.serialNumber === input.serialNumber
      );
      if (!device) {
        return yield* failure("PermissionDenied");
      }
      return { device, inventory };
    });
  return {
    deviceInfo: (input: DeviceInput, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readDeviceInfo() {
        const { device } = yield* member(input, token);
        const query = new URLSearchParams({
          deviceType: String(device.providerDeviceType),
          snCode: input.serialNumber,
          stationId: input.stationId,
        });
        const [staticInfo, dynamic] = yield* Effect.all(
          [
            get(
              `/device/sigen/device/static/info?${query}`,
              token,
              Schema.Struct({
                paramInfoVOList: Schema.Array(Parameter),
                runStatus: Schema.Number,
                softwareVersion: Schema.String,
              })
            ),
            get(
              `/device/sigen/device/dynamic/info?${query}&refreshFlag=`,
              token,
              Schema.Struct({
                dataCurrTimeStamp: ProviderTimestamp,
                realTimeInfo: Schema.Array(Parameter),
              })
            ),
          ],
          { concurrency: 2 }
        );
        return yield* decodeProvider(DeviceInfo)({
          fetchedAt: yield* Clock.currentTimeMillis,
          freshness:
            dynamic.dataCurrTimeStamp === "" ? "unknown" : "provider_timestamp",
          parameters: parameters(dynamic.realTimeInfo),
          providerDeviceType: device.providerDeviceType,
          providerRunStatus: staticInfo.runStatus,
          providerTimestamp: timestamp(dynamic.dataCurrTimeStamp),
          serialNumber: input.serialNumber,
          softwareVersion: staticInfo.softwareVersion,
          staticParameters: parameters(staticInfo.paramInfoVOList),
          stationId: input.stationId,
        });
      }),
    deviceValues: (input: DeviceInput, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readDeviceValues() {
        const { device, inventory } = yield* member(input, token);
        if (device.providerDeviceType !== 2) {
          return yield* failure("UnsupportedCapability");
        }
        const data = yield* get(
          `/device/devicetreepanel/liveValue?stationId=${input.stationId}&aioSnCode=${encodeURIComponent(input.serialNumber)}&refreshFlag=false`,
          token,
          Schema.Array(
            Schema.Struct({
              dateCurrTimeStamp: ProviderTimestamp,
              deviceType: Schema.Number,
              snCode: SerialNumber,
              value: Schema.String,
            })
          )
        );
        const descendants = new Set([input.serialNumber]);
        for (let depth = 0; depth <= 16; depth += 1) {
          for (const candidate of inventory.devices) {
            if (
              candidate.parentSerialNumber !== null &&
              descendants.has(candidate.parentSerialNumber)
            ) {
              descendants.add(candidate.serialNumber);
            }
          }
        }
        for (const reading of data) {
          if (
            !inventory.devices.some(
              (value) =>
                descendants.has(value.serialNumber) &&
                value.serialNumber === reading.snCode &&
                value.providerDeviceType === reading.deviceType
            )
          ) {
            return yield* failure("PermissionDenied");
          }
        }
        return yield* decodeProvider(DeviceValues)({
          aioSerialNumber: input.serialNumber,
          fetchedAt: yield* Clock.currentTimeMillis,
          readings: data.map((value) => {
            const reading = {
              providerDeviceType: value.deviceType,
              providerTimestamp: timestamp(value.dateCurrTimeStamp),
              providerValue: value.value,
              serialNumber: value.snCode,
            };
            if (![3, 4].includes(value.deviceType)) {
              return { ...reading, unit: "unknown", value: null };
            }
            const unit = value.deviceType === 3 ? "W" : "%";
            if (value.value === "") {
              return { ...reading, unit, value: null };
            }
            const numeric = /^-?\d+(?:\.\d+)?$/u.test(value.value)
              ? Number(value.value)
              : Number.NaN;
            return {
              ...reading,
              unit,
              value: numeric * (value.deviceType === 3 ? 1000 : 1),
            };
          }),
          stationId: input.stationId,
        });
      }),
    gateway: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readGateway() {
        const inventory = yield* topology(id, token);
        const gateways = inventory.devices.filter(
          (device) => device.providerDeviceType === 8
        );
        if (gateways.length === 0) {
          return yield* failure("UnsupportedCapability");
        }
        const data = yield* get(
          `/device/gateway/${id}`,
          token,
          Schema.Struct({
            communicationStatus: Schema.Number,
            deviceModel: Schema.String,
            generatorSideInfoList: Schema.Array(Parameter),
            gridSideInfoList: Schema.Array(Parameter),
            inverterSideInfoList: Schema.Array(Parameter),
            snCode: SerialNumber,
            softVersion: Schema.String,
          })
        );
        if (!gateways.some((device) => device.serialNumber === data.snCode)) {
          return yield* failure("PermissionDenied");
        }
        return yield* decodeProvider(Gateway)({
          fetchedAt: yield* Clock.currentTimeMillis,
          generator: parameters(data.generatorSideInfoList),
          grid: parameters(data.gridSideInfoList),
          inverter: parameters(data.inverterSideInfoList),
          model: data.deviceModel,
          providerCommunicationStatus: data.communicationStatus,
          serialNumber: data.snCode,
          softwareVersion: data.softVersion,
          stationId: id,
        });
      }),
    gridDevices: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readGridDevices() {
        const data = yield* get(
          `/device/station/grid-connection-point/support-devices?stationId=${id}`,
          token,
          Schema.Array(
            Schema.Struct({
              communicationStatus: Schema.Number,
              deviceStatus: Schema.Number,
              deviceType: Schema.Number,
              model: Schema.String,
              snCode: SerialNumber,
            })
          )
        );
        return yield* decodeProvider(GridDevices)({
          devices: data.map((device) => ({
            model: device.model,
            providerCommunicationStatus: device.communicationStatus,
            providerDeviceType: device.deviceType,
            providerStatus: device.deviceStatus,
            serialNumber: device.snCode,
          })),
          fetchedAt: yield* Clock.currentTimeMillis,
          stationId: id,
        });
      }),
    stationStatus: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readStationStatus() {
        const data = yield* get(
          `/device/sigen/station/statusInfo?id=${id}`,
          token,
          Schema.Struct({
            deviceList: Schema.Array(
              Schema.Struct({
                communicateStatus: Schema.Number,
                snCode: SerialNumber,
                stationId: Schema.Number,
                status: Schema.Number,
              })
            ),
            networkType: Schema.Number,
            onGrid: Schema.Boolean,
            status: Schema.Number,
          })
        );
        if (data.deviceList.some((device) => String(device.stationId) !== id)) {
          return yield* failure("PermissionDenied");
        }
        return yield* decodeProvider(StationStatus)({
          devices: data.deviceList.map((device) => ({
            providerCommunicationStatus: device.communicateStatus,
            providerStatus: device.status,
            serialNumber: device.snCode,
          })),
          fetchedAt: yield* Clock.currentTimeMillis,
          onGrid: data.onGrid,
          providerNetworkType: data.networkType,
          providerStatus: data.status,
          stationId: id,
        });
      }),
    topology,
  };
};
