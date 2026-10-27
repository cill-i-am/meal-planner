import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeEquipmentClient } from "./equipment-client.js";
import { SerialNumber, StationId, failure } from "./model.js";

const stationId = Schema.decodeUnknownSync(StationId)("12345");
const serial = Schema.decodeUnknownSync(SerialNumber);
const token = Redacted.make("fixture");
const node = (
  snCode: string,
  deviceType: number,
  nodeList: unknown[] = []
) => ({
  communicateStatus: 2,
  deviceModel: "",
  deviceName: "",
  deviceStatus: 99,
  deviceType,
  deviceTypeDesc: "Fixture",
  nodeList,
  snCode,
  stationId: 12_345,
});
const tree = {
  nodeList: [
    node("AIO-1", 2, [node("INV-1", 3), node("BAT-1", 4), node("GW-1", 8)]),
  ],
  stationId: 12_345,
  stationStatus: 1,
};
const fixture = (overrides: Readonly<Record<string, unknown>> = {}) => {
  const paths: string[] = [];
  const values: Readonly<Record<string, unknown>> = {
    "/device/devicetreepanel/liveValue": [
      {
        dateCurrTimeStamp: "1793030041429",
        deviceType: 3,
        snCode: "INV-1",
        value: "-0.024",
      },
      { dateCurrTimeStamp: "", deviceType: 4, snCode: "BAT-1", value: "20.0" },
    ],
    "/device/devicetreepanel/topology": tree,
    "/device/gateway/12345": {
      communicationStatus: 2,
      deviceModel: "Fixture",
      generatorSideInfoList: [],
      gridSideInfoList: [{ paramKey: "Voltage", paramValue: "233.33 V" }],
      inverterSideInfoList: [],
      snCode: "GW-1",
      softVersion: "V1",
    },
    "/device/sigen/device/dynamic/info": {
      dataCurrTimeStamp: "",
      realTimeInfo: [
        {
          paramKey: "Active Power",
          paramValue: "-0.024 kW",
          paramValueText: "-0.024",
          paramValueUnit: "kW",
        },
      ],
    },
    "/device/sigen/device/static/info": {
      paramInfoVOList: [],
      runStatus: 99,
      softwareVersion: "V1",
    },
    ...overrides,
  };
  return {
    client: makeEquipmentClient((path) => {
      paths.push(path);
      const data = values[new URL(path, "https://fixture.invalid").pathname];
      return data === undefined
        ? Effect.fail(failure("UpstreamUnavailable"))
        : Effect.succeed(data);
    }),
    paths,
  };
};
const run = Effect.runPromise;
describe("station-scoped equipment", () => {
  it("checks AIO membership and retains disagreeing power-status observations", async () => {
    const { client, paths } = fixture({
      "/device/aio/by/station": ["AIO-1"],
      "/device/aio/on-off-state": false,
      "/device/sigenMate/getPowerOnOffStatus": true,
    });
    expect(await run(client.aioDevices(stationId, token))).toMatchObject({
      serialNumbers: ["AIO-1"],
    });
    expect(
      await run(
        client.aioPowerStatus(
          { serialNumber: serial("AIO-1"), stationId },
          token
        )
      )
    ).toMatchObject({ onOffState: false, powerOn: true });
    const count = paths.length;
    expect(
      await run(
        client
          .aioPowerStatus({ serialNumber: serial("OTHER"), stationId }, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "PermissionDenied" } });
    expect(paths.slice(count)).toEqual([
      "/device/devicetreepanel/topology?stationId=12345",
    ]);
  });
  it("rejects foreign or duplicate AIO serials and truthy unrecognized power responses", async () => {
    await Promise.all(
      [["FOREIGN"], ["AIO-1", "AIO-1"]].map(async (value) => {
        const { client } = fixture({ "/device/aio/by/station": value });
        const result = await run(
          client.aioDevices(stationId, token).pipe(Effect.result)
        );
        expect(result._tag).toBe("Failure");
      })
    );
    const { client } = fixture({
      "/device/aio/on-off-state": false,
      "/device/sigenMate/getPowerOnOffStatus": "false",
    });
    expect(
      await run(
        client
          .aioPowerStatus({ serialNumber: serial("AIO-1"), stationId }, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "SchemaMismatch" } });
  });
  it("rejects oversized child arrays before expansion", async () => {
    const { client } = fixture({
      "/device/devicetreepanel/topology": {
        ...tree,
        nodeList: [
          node(
            "AIO-1",
            2,
            Array.from({ length: 150_000 }, () => 0)
          ),
        ],
      },
    });
    expect(
      await run(client.topology(stationId, token).pipe(Effect.result))
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
  it("rejects another AIO's readings even within the same station", async () => {
    const { client } = fixture({
      "/device/devicetreepanel/liveValue": [
        { dateCurrTimeStamp: "", deviceType: 3, snCode: "INV-2", value: "1" },
      ],
      "/device/devicetreepanel/topology": {
        ...tree,
        nodeList: [
          node("AIO-1", 2, [node("INV-1", 3)]),
          node("AIO-2", 2, [node("INV-2", 3)]),
        ],
      },
    });
    expect(
      await run(
        client
          .deviceValues({ serialNumber: serial("AIO-1"), stationId }, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "PermissionDenied" },
    });
  });
  it("flattens topology while preserving parents and unknown status codes", async () => {
    const { client } = fixture();
    const result = await run(client.topology(stationId, token));
    expect(result.devices).toHaveLength(4);
    expect(
      result.devices.find((d) => d.serialNumber === "INV-1")
    ).toMatchObject({ parentSerialNumber: "AIO-1", providerStatus: 99 });
  });
  it("rejects unrelated serials before sending a details request", async () => {
    const { client, paths } = fixture();
    expect(
      await run(
        client
          .deviceInfo({ serialNumber: serial("OTHER"), stationId }, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "PermissionDenied" },
    });
    expect(paths).toHaveLength(1);
  });
  it.each([
    { nodeList: [node("OTHER", 2)], stationId: 54_321, stationStatus: 1 },
    { ...tree, nodeList: [{ ...node("AIO-1", 2), stationId: 54_321 }] },
  ])("rejects mismatched root or child station identity", async (response) => {
    const { client } = fixture({
      "/device/devicetreepanel/topology": response,
    });
    expect(
      await run(client.topology(stationId, token).pipe(Effect.result))
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "PermissionDenied" },
    });
  });
  it("bounds nesting and rejects duplicate serials", async () => {
    const { client } = fixture({
      "/device/devicetreepanel/topology": {
        ...tree,
        nodeList: [node("AIO-1", 2, [node("AIO-1", 3)])],
      },
    });
    expect(
      await run(client.topology(stationId, token).pipe(Effect.result))
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
    let nested = node("END", 2);
    for (let i = 0; i < 18; i += 1) {
      nested = node(`NODE-${i}`, 2, [nested]);
    }
    const deep = fixture({
      "/device/devicetreepanel/topology": { ...tree, nodeList: [nested] },
    });
    expect(
      await run(deep.client.topology(stationId, token).pipe(Effect.result))
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
  it("retains display units and unknown freshness without pretending labels are metric keys", async () => {
    const { client } = fixture();
    expect(
      await run(
        client.deviceInfo({ serialNumber: serial("AIO-1"), stationId }, token)
      )
    ).toMatchObject({
      freshness: "unknown",
      parameters: [
        {
          label: "Active Power",
          text: "-0.024 kW",
          unit: "kW",
          value: "-0.024",
        },
      ],
      providerTimestamp: null,
    });
    expect(await run(client.gateway(stationId, token))).toMatchObject({
      grid: [
        { label: "Voltage", text: "233.33 V", unit: null, value: "233.33 V" },
      ],
    });
  });
  it("normalizes known child units and verifies returned membership", async () => {
    const { client } = fixture();
    const input = { serialNumber: serial("AIO-1"), stationId };
    const values = await run(client.deviceValues(input, token));
    expect(values.readings).toMatchObject([
      { providerTimestamp: 1_793_030_041_429, unit: "W", value: -24 },
      { providerTimestamp: null, unit: "%", value: 20 },
    ]);
    const wrong = fixture({
      "/device/devicetreepanel/liveValue": [
        { dateCurrTimeStamp: "", deviceType: 4, snCode: "OTHER", value: "20" },
      ],
    });
    expect(
      await run(wrong.client.deviceValues(input, token).pipe(Effect.result))
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "PermissionDenied" },
    });
  });
  it("rejects unavailable hardware without contacting its endpoint", async () => {
    const { client, paths } = fixture({
      "/device/devicetreepanel/topology": {
        ...tree,
        nodeList: [node("AIO-1", 2)],
      },
    });
    expect(
      await run(client.gateway(stationId, token).pipe(Effect.result))
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "UnsupportedCapability" },
    });
    expect(paths).toHaveLength(1);
  });
});
