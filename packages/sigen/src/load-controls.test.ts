import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { expandedResponses, loadControl } from "./__fixtures__/expanded.js";
import { smartLoad } from "./__fixtures__/remaining.js";
import { makeControlsClient } from "./controls-client.js";
import type { ProviderWrite } from "./controls-client.js";
import {
  ControlChange,
  approvalScope,
  controlMatches,
  snapshotConfiguration,
} from "./controls.js";
import { LoadSchedule } from "./load-schedule.js";
import { StationId } from "./model.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("synthetic");
const parse = (change: Record<string, unknown>) =>
  Schema.decodeUnknownSync(ControlChange)({
    loadKey: "synthetic-load",
    loadPath: 1,
    ...change,
  });
const automatic = parse({
  mode: "automatic",
  operation: "set_smart_load_mode",
});
const soc = parse({
  control: { connectAtPercent: 60, disconnectAtPercent: 40, mode: "soc" },
  operation: "set_smart_load_off_grid_control",
});
const fixture = (overrides: Record<string, unknown> = {}) => {
  const data = { ...expandedResponses, ...overrides };
  const writes: Parameters<ProviderWrite>[] = [];
  const client = makeControlsClient(
    (path) =>
      Effect.succeed(data[new URL(path, "https://fixture.invalid").pathname]),
    (...args) =>
      Effect.sync(() => {
        writes.push(args);
      })
  );
  const inspect = (change: ControlChange) =>
    Effect.runPromise(client.inspectControl(id, change, token));
  return { client, data, inspect, writes };
};
describe("smart-load settings controls", () => {
  it("reviews saved configuration, then changes only the explicit mode", async () => {
    const f = fixture();
    const before = await f.inspect(automatic);
    await Effect.runPromise(
      f.client.validateControl(id, automatic, before, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(id, automatic, token, before)
    );
    expect(f.writes[0]?.slice(0, 3)).toEqual([
      "PATCH",
      "/device/tp-device/smart-loads/control-mode?stationId=12345&loadPath=1&controlMode=0",
      null,
    ]);
    f.data["/device/tp-device/smart-loads"] = { ...smartLoad, runMode: 0 };
    f.data["/device/tp-device/smart-loads/control-mode"] = {
      ...loadControl,
      controlMode: 0,
    };
    const after = await f.inspect(automatic);
    expect(controlMatches(automatic, after, before)).toBe(true);
    expect(controlMatches(automatic, after)).toBe(false);
    expect(snapshotConfiguration(after)).not.toBe(
      snapshotConfiguration(before)
    );
    f.data["/device/tp-device/smart-loads/control-mode"] = {
      ...loadControl,
      autoModeParams: null,
      controlMode: 0,
    };
    expect(controlMatches(automatic, await f.inspect(automatic), before)).toBe(
      false
    );
  });
  it("sends SOC thresholds as app strings and omits read-only battery bounds", async () => {
    const f = fixture();
    const before = await f.inspect(soc);
    await Effect.runPromise(f.client.validateControl(id, soc, before, token));
    await Effect.runPromise(f.client.dispatchControl(id, soc, token, before));
    expect(f.writes[0]?.slice(0, 3)).toEqual([
      "PUT",
      "/third-party-device/tp-device/smart-loads/control-mode/auto/off-grid",
      {
        loadPath: 1,
        offGridControlMode: 1,
        socInThreshold: "60",
        socOutThreshold: "40",
        stationId: 12_345,
      },
    ]);
    expect(controlMatches(soc, await f.inspect(soc), before)).toBe(true);
  });
  it("does not verify an off-grid change if the detailed load mode also changed", async () => {
    const f = fixture();
    const before = await f.inspect(soc);
    f.data["/device/tp-device/smart-loads"] = { ...smartLoad, runMode: 0 };
    expect(controlMatches(soc, await f.inspect(soc), before)).toBe(false);
  });
  it.each([
    ["keep_connected", 0],
    ["disconnect", 2],
  ])("omits inactive thresholds for %s", async (mode, code) => {
    const change = parse({
      control: { mode },
      operation: "set_smart_load_off_grid_control",
    });
    const f = fixture();
    await Effect.runPromise(
      f.client.dispatchControl(id, change, token, await f.inspect(change))
    );
    expect(f.writes[0]?.[2]).toEqual({
      loadPath: 1,
      offGridControlMode: code,
      stationId: 12_345,
    });
  });
  it.each([
    [
      automatic,
      {
        "/device/tp-device/smart-loads/control-mode": {
          ...loadControl,
          controlMode: 99,
        },
      },
      "UnsupportedCapability",
    ],
    [
      automatic,
      {
        "/device/tp-device/smart-loads/control-mode": {
          ...loadControl,
          autoModeParams: null,
        },
      },
      "UnsupportedCapability",
    ],
    [
      automatic,
      {
        "/device/tp-device/smart-loads": {
          ...smartLoad,
          isControllable: false,
        },
      },
      "UnsupportedCapability",
    ],
    [
      parse({
        loadKey: "wrong",
        mode: "manual",
        operation: "set_smart_load_mode",
      }),
      {},
      "PermissionDenied",
    ],
    [
      parse({
        control: { connectAtPercent: 30, disconnectAtPercent: 10, mode: "soc" },
        operation: "set_smart_load_off_grid_control",
      }),
      {},
      "InvalidInput",
    ],
  ])(
    "rejects unsupported configuration or permissions",
    async (change, overrides, reason) => {
      const f = fixture(overrides);
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, change, await f.inspect(change), token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason } });
      expect(f.writes).toHaveLength(0);
    }
  );
  it.each([
    {
      ...loadControl.autoModeParams,
      touPointParamsList: [
        {
          ...loadControl.autoModeParams.touPointParamsList[0],
          consumptionMode: 2,
          socMode: null,
        },
      ],
    },
    { ...loadControl.autoModeParams, pvExcessParams: null },
    {
      ...loadControl.autoModeParams,
      pvExcessParams: { minRunTime: null, ratePower: "unknown", startPower: 2 },
    },
    {
      ...loadControl.autoModeParams,
      pvExcessParams: { minRunTime: null, ratePower: 2, startPower: -1 },
    },
  ])(
    "does not activate automatic mode with incomplete battery or solar-only settings",
    async (autoModeParams) => {
      const f = fixture({
        "/device/tp-device/smart-loads/control-mode": {
          ...loadControl,
          autoModeParams,
        },
      });
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, automatic, await f.inspect(automatic), token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
      expect(f.writes).toHaveLength(0);
    }
  );
  it.each([null, 99, 1])(
    "refuses unknown or contradictory manual switch setting %j",
    async (manualModeSwitch) => {
      const f = fixture({
        "/device/tp-device/smart-loads/control-mode": {
          ...loadControl,
          manualModeSwitch,
        },
      });
      const change = parse({
        mode: "manual",
        operation: "set_smart_load_mode",
      });
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, change, await f.inspect(change), token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
      expect(f.writes).toHaveLength(0);
    }
  );
  it("binds each approval to operation, load path and stable key", () => {
    expect(approvalScope(id, automatic)).toEqual({
      loadKey: "synthetic-load",
      loadPath: 1,
      operation: "set_smart_load_mode",
      stationId: id,
    });
    expect(approvalScope(id, soc)).toEqual({
      loadKey: "synthetic-load",
      loadPath: 1,
      operation: "set_smart_load_off_grid_control",
      stationId: id,
    });
    expect(() =>
      parse({
        control: { connectAtPercent: 20, disconnectAtPercent: 20, mode: "soc" },
        operation: "set_smart_load_off_grid_control",
      })
    ).toThrow();
  });
});

const loadSchedule = Schema.decodeUnknownSync(LoadSchedule)({
  readyBy: [
    { durationMinutes: 45, enabled: true, endTime: "07:30", providerDays: "6" },
  ],
  solar: { ratedPowerW: 2050, startingPowerW: 1525 },
  timed: [
    {
      consumption: { batteryBoost: true, mode: "solar_only" },
      enabled: true,
      endTime: "14:00",
      providerDays: "1,3",
      startTime: "12:00",
    },
    {
      consumption: {
        lowerSocPercent: 20.5,
        mode: "battery_only",
        upperSocPercent: 80.5,
      },
      enabled: false,
      endTime: "24:00",
      providerDays: "5",
      startTime: "23:00",
    },
  ],
  timezone: "Europe/London",
});
const scheduleChange = (schedule = loadSchedule) =>
  parse({ operation: "set_smart_load_schedule", schedule });
const solarRow = {
  autoCharge: 1,
  consumptionMode: 1,
  duration: "120",
  periodConfig: [1, 3],
  socMode: { socLowerLimit: 15, socUpperLimit: 50 },
  startTime: "720",
  touEnable: 1,
};
const batteryRow = {
  autoCharge: 0,
  consumptionMode: 2,
  duration: "60",
  periodConfig: [5],
  socMode: { socLowerLimit: 20.5, socUpperLimit: 80.5 },
  startTime: "1380",
  touEnable: 0,
};
const readyRow = {
  duration: "45",
  endTime: "450",
  periodConfig: [6],
  smartSaveEnable: 1,
};

describe("smart-load schedule replacement", () => {
  it("sends the complete reviewed schedule in one POST and reconciles provider readback", async () => {
    const f = fixture();
    const change = scheduleChange();
    const before = await f.inspect(change);
    await Effect.runPromise(
      f.client.validateControl(id, change, before, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(id, change, token, before)
    );
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]?.slice(0, 3)).toEqual([
      "POST",
      "/device/tp-device/smart-loads/control-mode/auto/on-grid",
      {
        loadPath: 1,
        pvExcessParams: { minRunTime: 10, ratePower: 2.05, startPower: 1.525 },
        schedule: {
          smartSavePointParamsList: [readyRow],
          touPointParamsList: [solarRow, batteryRow],
        },
        stationId: 12_345,
      },
    ]);
    expect(f.writes[0]?.[4]).toBe("boolean_true");
    const path = "/device/tp-device/smart-loads/control-mode";
    const saved = {
      ...loadControl,
      autoModeParams: {
        pvExcessParams: {
          minRunTime: 10,
          ratePower: "2.050",
          startPower: 1.525,
        },
        smartSavePointParamsList: [{ ...readyRow, duration: 45 }],
        touPointParamsList: [
          batteryRow,
          { ...solarRow, duration: 120, periodConfig: [3, 1], startTime: 720 },
        ],
      },
    };
    f.data[path] = saved;
    expect(controlMatches(change, await f.inspect(change), before)).toBe(true);
    f.data[path] = { ...saved, controlMode: 0 };
    expect(controlMatches(change, await f.inspect(change), before)).toBe(false);
    f.data[path] = {
      ...saved,
      autoModeParams: {
        ...saved.autoModeParams,
        touPointParamsList: [batteryRow, { ...solarRow, touEnable: 0 }],
      },
    };
    expect(controlMatches(change, await f.inspect(change), before)).toBe(false);
  });

  it("clears both lists in manual mode and requires an explicit mode change before clearing in automatic mode", async () => {
    const change = scheduleChange({
      ...loadSchedule,
      readyBy: [],
      solar: null,
      timed: [],
    });
    const f = fixture();
    const before = await f.inspect(change);
    await Effect.runPromise(
      f.client.validateControl(id, change, before, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(id, change, token, before)
    );
    expect(f.writes[0]?.[2]).toMatchObject({
      pvExcessParams: null,
      schedule: { smartSavePointParamsList: [], touPointParamsList: [] },
    });
    const active = fixture({
      "/device/tp-device/smart-loads": { ...smartLoad, runMode: 0 },
      "/device/tp-device/smart-loads/control-mode": {
        ...loadControl,
        controlMode: 0,
      },
    });
    expect(
      await Effect.runPromise(
        active.client
          .validateControl(id, change, await active.inspect(change), token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
  });

  it("rejects an overlapping timed slot, a ready-by day shared with a timed slot, or missing solar settings", () => {
    const [solar] = loadSchedule.timed;
    for (const schedule of [
      { ...loadSchedule, timed: [solar, solar] },
      {
        ...loadSchedule,
        readyBy: [
          {
            durationMinutes: 45,
            enabled: true,
            endTime: "07:30",
            providerDays: "1",
          },
        ],
      },
      { ...loadSchedule, solar: null },
    ]) {
      expect(() =>
        parse({ operation: "set_smart_load_schedule", schedule })
      ).toThrow();
    }
  });
});
