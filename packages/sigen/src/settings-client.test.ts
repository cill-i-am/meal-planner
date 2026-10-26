import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { StationId, failure } from "./model.js";
import { makeSettingsClient } from "./settings-client.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("fixture-token");
// Shapes observed from the owner app; non-empty schedules and finite limits are synthetic cases.
const responses: Readonly<Record<string, unknown>> = {
  "/device/dischargesetting/peak/shaving": {
    controlMode: 987,
    settingList: [
      { endTime: "05:30", peakPower: 2.5, startTime: "23:00", whichDay: "1,7" },
    ],
    shavingSOC: 0,
  },
  "/device/energy-profile/battery/export/limitation": {
    currentEnable: false,
    installerSetEnable: null,
    ownerSetEnable: false,
  },
  "/device/energy-profile/battery/level": {
    backupSOC: "20.0",
    chargeSOC: "100.0",
    dischargeSOC: "20.0",
    ja12SOC: "0.0",
    peakShavingSOC: "",
  },
  "/device/energy-profile/battery/limit": {
    batteryMaxChargingPower: "4294967.295",
    batteryMaxDischargingPower: "2.5",
  },
  "/device/energy-profile/grid/limitation/export": {
    enable: false,
    maxLimitation: "",
    maxLimitationInstaller: "",
    maxLimitationOwner: "0",
  },
  "/device/energy-profile/grid/limitation/import": {
    enable: true,
    maxLimitation: "6.5",
    maxLimitationInstaller: "4294967.295",
    maxLimitationOwner: "6.5",
  },
  "/device/energy-profile/instant/manunal": {
    enable: false,
    endTime: "1700000000",
    mode: "987",
  },
  "/device/energy-profile/instant/manunal/display": {
    batteryPower: -0.3,
    batterySoc: 20,
  },
  "/device/energy-profile/mode/all": {
    defaultWorkingModes: [{ label: "Future mode", value: "987" }],
    energyProfileItems: [{ name: "Night", profileId: 7 }],
  },
  "/device/energy-profile/parallel/off/grid": {
    currentLimitation: "32",
    enable: true,
    installerSetLimitation: "",
    ownerSetLimitation: "32",
  },
  "/device/energy-profile/solar/limit": { powerLimit: "4294967.295" },
  "/device/setting/backup/reserve": {
    backupReserve: 20,
    operationMode: 987,
    stationId: 12_345,
  },
};
const fixture = (overrides: Readonly<Record<string, unknown>> = {}) => {
  const values = { ...responses, ...overrides };
  const paths: string[] = [];
  return {
    client: makeSettingsClient((path, access) => {
      expect(Redacted.value(access)).toBe("fixture-token");
      if (path === "/device/owner/station/home?stationId=12345") {
        return Effect.succeed({
          stationId: 12_345,
          timeZoneName: "Europe/Dublin",
        });
      }
      expect(path).toMatch(/\/12345$/u);
      paths.push(path);
      const value = values[path.replace(/\/12345$/u, "")];
      return value === undefined
        ? Effect.fail(failure("UpstreamUnavailable"))
        : Effect.succeed(value);
    }),
    paths,
  };
};
const run = Effect.runPromise;

describe("owner settings reads", () => {
  it("preserves unset, zero, unlimited and finite limits and unfamiliar modes", async () => {
    const { client, paths } = fixture();
    expect(await run(client.batterySettings(id, token))).toMatchObject({
      backupReservePercent: 20,
      chargeLimit: { kind: "unlimited" },
      dischargeLimit: { kind: "limited", watts: 2500 },
      export: {
        effectiveEnabled: false,
        installerEnabled: null,
        ownerEnabled: false,
      },
      ja12SocPercent: 0,
      peakShavingSocPercent: null,
      providerOperationMode: 987,
    });
    expect(paths).toHaveLength(4);
    expect(await run(client.gridSettings(id, token))).toMatchObject({
      connectionCurrent: {
        effectiveAmps: 32,
        installerAmps: null,
        ownerAmps: 32,
      },
      exportPower: {
        effective: { kind: "unset" },
        owner: { kind: "limited", watts: 0 },
      },
      importPower: {
        effective: { kind: "limited", watts: 6500 },
        installer: { kind: "unlimited" },
      },
    });
    expect(await run(client.solarSettings(id, token))).toMatchObject({
      powerLimit: { kind: "unlimited" },
    });
    expect(await run(client.operatingModes(id, token))).toMatchObject({
      customProfiles: [{ name: "Night", profileId: 7 }],
      modes: [{ label: "Future mode", providerMode: "987" }],
    });
  });
  it("rejects the wrong station instead of silently accepting default settings", async () => {
    const { client } = fixture({
      "/device/setting/backup/reserve": {
        backupReserve: 20,
        operationMode: 1,
        stationId: 54_321,
      },
    });
    expect(
      await run(client.batterySettings(id, token).pipe(Effect.result))
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "PermissionDenied" },
    });
  });
  it.each(["0x20", "NaN", "Infinity", "-1", "101", " "])(
    "rejects malformed or out-of-range SOC %s",
    async (value) => {
      const { client } = fixture({
        "/device/energy-profile/battery/level": {
          backupSOC: "20",
          chargeSOC: value,
          dischargeSOC: "20",
          peakShavingSOC: "",
        },
      });
      expect(
        await run(client.batterySettings(id, token).pipe(Effect.result))
      ).toMatchObject({
        _tag: "Failure",
        failure: { reason: "SchemaMismatch" },
      });
    }
  );
  it("fails a composite read when one required source is unavailable", async () => {
    const { client } = fixture({
      "/device/energy-profile/battery/export/limitation": undefined,
    });
    expect(
      await run(client.batterySettings(id, token).pipe(Effect.result))
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "UpstreamUnavailable" },
    });
  });
  it("retains a cross-midnight schedule and does not infer activation from historical override fields", async () => {
    const { client } = fixture();
    expect(await run(client.peakShavingSchedule(id, token))).toMatchObject({
      providerControlMode: 987,
      reserveSocPercent: 0,
      slots: [
        {
          endTime: "05:30",
          peakPowerW: 2500,
          providerDays: "1,7",
          startTime: "23:00",
        },
      ],
    });
    expect(await run(client.manualOverride(id, token))).toMatchObject({
      batteryPowerW: -300,
      enabled: false,
      providerEndTime: "1700000000",
      providerMode: "987",
    });
  });
  it.each(["23:00junk", "junk24:00", "25:00", "12:99"])(
    "rejects malformed schedule time %s",
    async (value) => {
      const { client } = fixture({
        "/device/dischargesetting/peak/shaving": {
          controlMode: 0,
          settingList: [
            { endTime: "24:00", peakPower: 1, startTime: value, whichDay: "1" },
          ],
          shavingSOC: 20,
        },
      });
      expect(
        await run(client.peakShavingSchedule(id, token).pipe(Effect.result))
      ).toMatchObject({
        _tag: "Failure",
        failure: { reason: "SchemaMismatch" },
      });
    }
  );
});
