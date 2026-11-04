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
