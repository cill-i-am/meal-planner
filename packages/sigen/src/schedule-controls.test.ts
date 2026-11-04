import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeControlsClient } from "./controls-client.js";
import {
  ControlChange,
  ControlSnapshot,
  controlMatches,
  snapshotConfiguration,
} from "./controls.js";
import { StationId, failure } from "./model.js";

const stationId = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("synthetic");
const slot = {
  endTime: "24:00",
  peakPowerW: 2500,
  providerDays: "1,7",
  startTime: "23:00",
};
const schedule = Schema.decodeUnknownSync(ControlSnapshot)({
  kind: "peak_shaving",
  settings: {
    fetchedAt: 1,
    providerControlMode: 1,
    reserveSocPercent: 20,
    slots: [slot],
    stationId,
    timezone: "Europe/Dublin",
  },
});
const change = Schema.decodeUnknownSync(ControlChange)({
  enabled: true,
  operation: "set_peak_shaving_schedule",
  reserveSocPercent: 20,
  slots: [slot],
  timezone: "Europe/Dublin",
});
const levels = {
  backupSocPercent: 20,
  chargeSocPercent: 100,
  dischargeSocPercent: 10,
  operation: "set_battery_soc_thresholds",
  peakShavingSocPercent: 30,
} as const;
const fixture = (overrides: Readonly<Record<string, unknown>> = {}) => {
  const writes: {
    method: string;
    path: string;
    body: Readonly<Record<string, Schema.Json>> | null;
  }[] = [];
  const data: Readonly<Record<string, unknown>> = {
    "/device/energy-profile/battery/level/12345": {
      backupSOC: "20",
      chargeSOC: "100",
      dischargeSOC: "10",
      peakShavingSOC: "0",
    },
    "/device/energy-profile/instant/manunal/12345": {
      enable: true,
      endTime: "1793200000000",
      mode: "0",
    },
    "/device/energy-profile/instant/manunal/display/12345": {
      batteryPower: 1,
      batterySoc: 50,
    },
    "/device/owner/station/home": {
      batteryCapacity: 8,
      hasSolar: true,
      stationId: 12_345,
    },
    ...overrides,
  };
  const client = makeControlsClient(
    (path) => {
      const value = data[new URL(path, "https://fixture.invalid").pathname];
      return value === undefined
        ? Effect.fail(failure("SchemaMismatch"))
        : Effect.succeed(value);
    },
    (method, path, body) =>
      Effect.sync(() => {
        writes.push({ body, method, path });
      })
  );
  return { client, writes };
};
describe("SOC, peak-shaving and manual-stop controls", () => {
  it.each([
    { reserveSocPercent: 0, slots: [slot] },
    { reserveSocPercent: 20, slots: [] },
    { reserveSocPercent: 0, slots: [] },
    { reserveSocPercent: 20, slots: [{ ...slot, peakPowerW: 3000 }] },
  ])(
    "refuses to pretend disabling peak shaving changes its retained preset: %j",
    async (patch) => {
      const f = fixture();
      // Keep historical reviews readable even when they are no longer valid new requests.
      const disabled = Schema.decodeUnknownSync(ControlChange)({
        ...change,
        ...patch,
        enabled: false,
      });
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(stationId, disabled, schedule, token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "InvalidInput" } });
      expect(f.writes).toHaveLength(0);
    }
  );
  it("uses the app's zero/empty disable payload but verifies the retained preset", async () => {
    const f = fixture({
      "/device/energy-profile/battery/level/12345": undefined,
    });
    const disabled = Schema.decodeUnknownSync(ControlChange)({
      ...change,
      enabled: false,
    });
    await Effect.runPromise(
      f.client.validateControl(stationId, disabled, schedule, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(stationId, disabled, token)
    );
    expect(f.writes).toEqual([
      {
        body: {
          controlMode: 0,
          settingList: [],
          shavingSOC: 0,
          stationId: 12_345,
        },
        method: "POST",
        path: "/device/dischargesetting/peak/shaving",
      },
    ]);
    if (
      schedule.kind !== "peak_shaving" ||
      disabled.operation !== "set_peak_shaving_schedule"
    ) {
      throw new Error("Expected peak-shaving snapshot");
    }
    const stopped = {
      ...schedule,
      settings: { ...schedule.settings, providerControlMode: 0 },
    };
    expect(controlMatches(disabled, stopped)).toBe(true);
    // The earlier zero/empty restoration request must remain unverified, not be reinterpreted.
    expect(
      controlMatches({ ...disabled, reserveSocPercent: 0, slots: [] }, stopped)
    ).toBe(false);
    expect(
      controlMatches(disabled, {
        ...stopped,
        settings: {
          ...stopped.settings,
          slots: [{ ...slot, peakPowerW: 3000 }],
        },
      })
    ).toBe(false);
  });
  it.each([
    { slots: Array.from({ length: 13 }, () => slot) },
    { slots: [{ ...slot, endTime: "05:30" }] },
    { slots: [{ ...slot, providerDays: "future" }] },
    { slots: [{ ...slot, endTime: slot.startTime }] },
  ])(
    "keeps unsupported presets readable and disableable but refuses enabling them: %j",
    async ({ slots }) => {
      const f = fixture();
      if (schedule.kind !== "peak_shaving") {
        throw new Error("Expected peak-shaving snapshot");
      }
      const current = {
        ...schedule,
        settings: { ...schedule.settings, slots },
      };
      const active = Schema.decodeUnknownSync(ControlChange)({
        ...change,
        slots,
      });
      const disabled = Schema.decodeUnknownSync(ControlChange)({
        ...change,
        enabled: false,
        slots,
      });
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(stationId, active, current, token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
      await Effect.runPromise(
        f.client.validateControl(stationId, disabled, current, token)
      );
      expect(f.writes).toHaveLength(0);
    }
  );
  it.each([
    {
      backupSOC: "30",
      chargeSOC: "100",
      dischargeSOC: "10",
      reason: "InvalidInput",
    },
    {
      backupSOC: "10",
      chargeSOC: "100",
      dischargeSOC: "30",
      reason: "InvalidInput",
    },
    {
      backupSOC: "10",
      chargeSOC: "15",
      dischargeSOC: "10",
      reason: "InvalidInput",
    },
    {
      backupSOC: "",
      chargeSOC: "100",
      dischargeSOC: "10",
      reason: "UnsupportedCapability",
    },
    {
      backupSOC: "10",
      chargeSOC: "",
      dischargeSOC: "10",
      reason: "UnsupportedCapability",
    },
    {
      backupSOC: "10",
      chargeSOC: "100",
      dischargeSOC: "",
      reason: "UnsupportedCapability",
    },
    {
      backupSOC: "10",
      chargeSOC: "101",
      dischargeSOC: "10",
      reason: "SchemaMismatch",
    },
  ])(
    "checks live reserve bounds before enabled peak shaving: %j",
    async ({ reason, ...socLevels }) => {
      const f = fixture({
        "/device/energy-profile/battery/level/12345": {
          ...socLevels,
          peakShavingSOC: "0",
        },
      });
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(stationId, change, schedule, token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason } });
      expect(f.writes).toHaveLength(0);
    }
  );
  it("rechecks changed battery reserve limits immediately before a later execution", async () => {
    const socLevels = {
      backupSOC: "20",
      chargeSOC: "100",
      dischargeSOC: "10",
      peakShavingSOC: "0",
    };
    const f = fixture({
      "/device/energy-profile/battery/level/12345": socLevels,
    });
    await Effect.runPromise(
      f.client.validateControl(stationId, change, schedule, token)
    );
    socLevels.backupSOC = "30";
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(stationId, change, schedule, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
  });
  it.each([undefined, { batteryPower: "malformed" }])(
    "confirms a stopped override independently of unavailable or malformed display telemetry",
    async (display) => {
      const { client } = fixture({
        "/device/energy-profile/instant/manunal/12345": {
          enable: false,
          endTime: "",
          mode: "",
        },
        "/device/energy-profile/instant/manunal/display/12345": display,
      });
      const stop = { operation: "stop_manual_override" } as const;
      const current = await Effect.runPromise(
        client.inspectControl(stationId, stop, token)
      );
      expect(controlMatches(stop, current)).toBe(true);
    }
  );
  it("rejects contradictory, fractional and out-of-range SOC settings", () => {
    expect(Schema.is(ControlChange)(levels)).toBe(true);
    for (const invalid of [
      { chargeSocPercent: 10 },
      { dischargeSocPercent: 101 },
      { backupSocPercent: 20.5 },
      { peakShavingSocPercent: -1 },
    ]) {
      expect(Schema.is(ControlChange)({ ...levels, ...invalid })).toBe(false);
    }
  });
  it("sends the whole reviewed schedule using POST and converts watts to kW", async () => {
    const { client, writes } = fixture();
    await Effect.runPromise(client.dispatchControl(stationId, change, token));
    await Effect.runPromise(client.dispatchControl(stationId, levels, token));
    await Effect.runPromise(
      client.dispatchControl(
        stationId,
        { operation: "stop_manual_override" },
        token
      )
    );
    expect(writes).toEqual([
      {
        body: {
          controlMode: 1,
          settingList: [
            {
              endTime: "24:00",
              peakPower: 2.5,
              startTime: "23:00",
              whichDay: "1,7",
            },
          ],
          shavingSOC: 20,
          stationId: 12_345,
        },
        method: "POST",
        path: "/device/dischargesetting/peak/shaving",
      },
      {
        body: {
          backupSOC: "20",
          chargeSOC: "100",
          dischargeSOC: "10",
          peakShavingSOC: "30",
          stationId: 12_345,
        },
        method: "PUT",
        path: "/device/energy-profile/battery/level",
      },
      {
        body: {
          duration: "",
          enable: false,
          mode: "",
          powerLimitation: "",
          stationId: 12_345,
        },
        method: "PUT",
        path: "/device/energy-profile/instant/manunal",
      },
    ]);
  });
  it("permits limit edits while rejecting unsupported windows, timezone and mode", async () => {
    const { client } = fixture();
    await Effect.runPromise(
      client.validateControl(stationId, change, schedule, token)
    );
    await Promise.all(
      [
        { timezone: "UTC" },
        { slots: [{ ...slot, endTime: "05:30" }] },
        { slots: [{ ...slot, providerDays: "future" }] },
        { slots: [] },
      ].map(async (patch) => {
        const input = Schema.decodeUnknownSync(ControlChange)({
          ...change,
          ...patch,
        });
        const result = await Effect.runPromise(
          client
            .validateControl(stationId, input, schedule, token)
            .pipe(Effect.result)
        );
        expect(result._tag).toBe("Failure");
      })
    );
    if (schedule.kind !== "peak_shaving") {
      throw new Error("Expected schedule");
    }
    const unknown = {
      ...schedule,
      settings: { ...schedule.settings, providerControlMode: 7 },
    };
    expect(
      await Effect.runPromise(
        client
          .validateControl(stationId, change, unknown, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    expect(controlMatches(change, schedule)).toBe(true);
    expect(
      controlMatches(change, {
        ...schedule,
        settings: {
          ...schedule.settings,
          slots: [{ ...slot, peakPowerW: 2000 }],
        },
      })
    ).toBe(false);
  });
  it("verifies all four SOC thresholds, not only the charge target", () => {
    const snapshot = Schema.decodeUnknownSync(ControlSnapshot)({
      kind: "battery",
      settings: {
        backupReservePercent: 20,
        backupSocPercent: 20,
        chargeLimit: { kind: "unlimited" },
        chargeSocPercent: 100,
        dischargeLimit: { kind: "unlimited" },
        dischargeSocPercent: 10,
        export: {
          effectiveEnabled: false,
          installerEnabled: null,
          ownerEnabled: null,
        },
        fetchedAt: 1,
        ja12SocPercent: 0,
        peakShavingSocPercent: 30,
        providerOperationMode: 1,
        stationId,
      },
    });
    expect(controlMatches(levels, snapshot)).toBe(true);
    expect(
      controlMatches({ ...levels, peakShavingSocPercent: 25 }, snapshot)
    ).toBe(false);
  });
  it("excludes live battery display values from a manual-stop review and verifies the enabled flag", async () => {
    const first = fixture();
    const second = fixture({
      "/device/energy-profile/instant/manunal/display/12345": {
        batteryPower: 2,
        batterySoc: 51,
      },
    });
    const stop = { operation: "stop_manual_override" } as const;
    const before = await Effect.runPromise(
      first.client.inspectControl(stationId, stop, token)
    );
    const later = await Effect.runPromise(
      second.client.inspectControl(stationId, stop, token)
    );
    expect(snapshotConfiguration(before)).toEqual(snapshotConfiguration(later));
    expect(controlMatches(stop, before)).toBe(false);
    if (before.kind !== "manual") {
      throw new Error("Expected manual state");
    }
    expect(
      controlMatches(stop, {
        ...before,
        settings: { ...before.settings, enabled: false },
      })
    ).toBe(true);
  });
});
