/* eslint-disable no-await-in-loop -- Each ordered assertion inspects the same request trace or dependent failure fixture. */
import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  profile,
  priority,
  remainingResponses,
  smartLoad,
  stationList,
} from "./__fixtures__/remaining.js";
import { makeEnergyProfileClient } from "./energy-profile-client.js";
import { makeLoadsClient } from "./loads-client.js";
import { StationId, failure } from "./model.js";
import { makePreheatingClient } from "./preheating-client.js";
import { makeStationsClient } from "./stations-client.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("fixture-only");
const fixture = (overrides: Readonly<Record<string, unknown>> = {}) => {
  const paths: string[] = [];
  const read = (path: string) => {
    paths.push(path);
    const data = {
      ...remainingResponses,
      ...overrides,
    }[new URL(path, "https://fixture.invalid").pathname];
    return data === undefined
      ? Effect.fail(failure("SchemaMismatch"))
      : Effect.succeed(data);
  };
  return {
    paths,
    ...makeStationsClient(read),
    ...makeEnergyProfileClient(read),
    ...makeLoadsClient(read),
    ...makePreheatingClient(read),
  };
};
const failureResult = {
  _tag: "Failure",
  failure: { reason: "SchemaMismatch" },
};
describe("station, energy profile and smart load adapters", () => {
  it("enumerates stations without selecting or enrolling one", async () => {
    const f = fixture();
    const result = await Effect.runPromise(f.stations(id, token));
    expect(result.stations).toEqual([
      {
        batteryCapacityWh: 8100,
        enrolled: true,
        name: "Fixture station",
        providerStatus: 2,
        providerType: 1,
        solarCapacityW: 5700,
        stationId: "12345",
      },
    ]);
    expect(f.paths).toEqual(["/device/owner/station/list"]);
  });
  it.each([
    { ...stationList, stationCount: 2 },
    {
      stationCount: 2,
      stationList: [...stationList.stationList, ...stationList.stationList],
    },
  ])("rejects truncated and duplicate station lists", async (data) => {
    expect(
      await Effect.runPromise(
        fixture({ "/device/owner/station/list": data })
          .stations(id, token)
          .pipe(Effect.result)
      )
    ).toMatchObject(failureResult);
  });
  it("does not mistake hardware support flags for installed devices", async () => {
    const f = fixture();
    expect(
      await Effect.runPromise(f.stationCapabilities(id, token))
    ).toMatchObject({
      backupSupported: true,
      powerSheddingSupported: false,
      providerHasEv: false,
    });
    expect(f.paths[0]).toBe(
      "/device/sigen/station/baseInfoByUser?id=12345&appVersion=4.1.0"
    );
    expect(
      await Effect.runPromise(f.loadCapabilities(id, token))
    ).toMatchObject({
      generatorInstalled: false,
      generatorPortSupported: true,
    });
  });
  it("checks custom/template membership before reading a profile and checks returned identity", async () => {
    const f = fixture();
    for (const target of [
      { kind: "custom", profileId: 999 },
      { kind: "template", profileId: 200, providerMode: 1 },
    ] as const) {
      expect(
        await Effect.runPromise(
          f.energyProfile({ stationId: id, target }, token).pipe(Effect.result)
        )
      ).toMatchObject({
        _tag: "Failure",
        failure: { reason: "PermissionDenied" },
      });
    }
    expect(f.paths.some((path) => path.includes("setting/info"))).toBe(false);
    expect(
      await Effect.runPromise(
        fixture({
          "/device/energy-profile/setting/info/12345": {
            ...profile,
            profileId: 201,
          },
        })
          .energyProfile(
            { stationId: id, target: { kind: "custom", profileId: 200 } },
            token
          )
          .pipe(Effect.result)
      )
    ).toMatchObject(failureResult);
  });
  it("normalizes profile limits and preserves grouping, unknown statuses and station timezone", async () => {
    const f = fixture({
      "/device/energy-profile/setting/info/12345": {
        ...profile,
        pvPriority: [
          {
            ...priority,
            isGroup: true,
            priorityGroupList: [priority],
            status: 123,
          },
        ],
      },
    });
    const result = await Effect.runPromise(
      f.energyProfile(
        {
          stationId: id,
          target: { kind: "template", profileId: 200, providerMode: 9 },
        },
        token
      )
    );
    expect(result).toMatchObject({
      batteryChargeLimit: { kind: "unlimited" },
      batteryDischargeLimit: { kind: "limited", watts: 3500 },
      batteryEnabled: false,
      gridExportLimit: { kind: "unset" },
      gridImportLimit: { kind: "limited", watts: 5000 },
      preheating: { automaticModeValid: null, providerMode: null },
      timezone: "Europe/London",
    });
    expect(
      result.solarPriority.map((entry) => [
        entry.groupPath,
        entry.providerStatus,
      ])
    ).toEqual([
      [[0], 123],
      [[0, 0], 0],
    ]);
  });
  it("rejects recursive priority overflow and contradictory grouping", async () => {
    let nested: unknown = priority;
    for (let i = 0; i < 6; i += 1) {
      nested = { ...priority, isGroup: true, priorityGroupList: [nested] };
    }
    for (const pvPriority of [
      [nested],
      [{ ...priority, priorityGroupList: [priority] }],
    ]) {
      expect(
        await Effect.runPromise(
          fixture({
            "/device/energy-profile/setting/12345": { ...profile, pvPriority },
          })
            .solarPriority(id, token)
            .pipe(Effect.result)
        )
      ).toMatchObject(failureResult);
    }
  });
  it("rejects out-of-range SOC rather than silently clamping it", async () => {
    expect(
      await Effect.runPromise(
        fixture({
          "/device/energy-profile/setting/12345": {
            ...profile,
            backupSOC: "101",
          },
        })
          .energyProfile({ stationId: id, target: { kind: "current" } }, token)
          .pipe(Effect.result)
      )
    ).toMatchObject(failureResult);
  });
  it("checks smart-load membership before detail reads and refuses identity replacement", async () => {
    const f = fixture({ "/device/tp-device/smart-loads/list": [] });
    expect(
      await Effect.runPromise(
        f.smartLoad({ loadPath: 1, stationId: id }, token).pipe(Effect.result)
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "UnsupportedCapability" },
    });
    expect(f.paths).toHaveLength(1);
    for (const patch of [
      { stationId: 54_321 },
      { loadPath: 2 },
      { loadKey: "replacement" },
    ]) {
      expect(
        await Effect.runPromise(
          fixture({
            "/device/tp-device/smart-loads": { ...smartLoad, ...patch },
          })
            .smartLoad({ loadPath: 1, stationId: id }, token)
            .pipe(Effect.result)
        )
      ).toMatchObject({
        _tag: "Failure",
        failure: { reason: "PermissionDenied" },
      });
    }
  });
  it("preserves unknown load codes and null controllability without inventing a state", async () => {
    const changed = {
      ...smartLoad,
      isControllable: null,
      manualSwitch: 88,
      runMode: 99,
    };
    expect(
      await Effect.runPromise(
        fixture({ "/device/tp-device/smart-loads": changed }).smartLoad(
          { loadPath: 1, stationId: id },
          token
        )
      )
    ).toMatchObject({
      load: {
        controllable: null,
        providerManualSwitch: 88,
        providerRunMode: 99,
      },
    });
  });
  it("preserves preheating provider values without assigning unverified units", async () => {
    const f = fixture({
      "/device/dischargesetting/packPreheating/new/12345": {
        isAutoModeValid: null,
        isIndustry: false,
        packPreheatingSwitch: 0,
        packPreheatingVOList: [
          {
            chargingPower: "1.0",
            dischargePower: 2,
            duration: 60,
            periodConfig: [1, 7],
            startTime: "30",
          },
        ],
        preHeatingEnablesSwitch: null,
        preheatingMode: null,
      },
    });
    expect(
      await Effect.runPromise(f.preheatingSettings(id, token))
    ).toMatchObject({
      providerMode: null,
      slots: [
        {
          providerChargingPower: "1.0",
          providerDischargePower: 2,
          providerDuration: 60,
          providerPeriods: [1, 7],
          providerStartTime: "30",
        },
      ],
    });
  });
});
