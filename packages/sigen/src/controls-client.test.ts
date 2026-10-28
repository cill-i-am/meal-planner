import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeControlsClient } from "./controls-client.js";
import { ControlChange, ControlSnapshot, controlMatches } from "./controls.js";
import { StationId } from "./model.js";

const stationId = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("synthetic-access");
const fixture = () => {
  const writes: {
    method: "PUT" | "POST" | "PATCH";
    path: string;
    body: Readonly<Record<string, Schema.Json>> | null;
  }[] = [];
  const client = makeControlsClient(
    (path) =>
      Effect.succeed(
        path.includes("/mode/all/")
          ? {
              defaultWorkingModes: [{ label: "AI", value: "1" }],
              energyProfileItems: [{ name: "Night", profileId: 2 }],
            }
          : { batteryCapacity: 8.1, hasSolar: true, stationId: 12_345 }
      ),
    (method, path, body) =>
      Effect.sync(() => {
        writes.push({ body, method, path });
      })
  );
  return { client, writes };
};
const grid = Schema.decodeUnknownSync(ControlSnapshot)({
  kind: "grid",
  settings: {
    connectionCurrent: {
      effectiveAmps: 32,
      enabled: true,
      installerAmps: 32,
      ownerAmps: null,
    },
    exportPower: {
      effective: { kind: "limited", watts: 5000 },
      enabled: true,
      installer: { kind: "limited", watts: 5000 },
      owner: { kind: "unset" },
    },
    fetchedAt: 1,
    importPower: {
      effective: { kind: "unlimited" },
      enabled: true,
      installer: { kind: "unlimited" },
      owner: { kind: "unset" },
    },
    stationId,
  },
});

describe("typed physical control adapters", () => {
  it("rejects coercions, fractional SOC, unknown modes and unit mistakes at the input boundary", () => {
    for (const input of [
      { operation: "set_backup_reserve", reservePercent: 100.1 },
      { operation: "set_backup_reserve", reservePercent: "20" },
      { operation: "set_operating_mode", profileId: -1, providerMode: 987 },
      { amperes: 32.01, operation: "set_grid_connection_current" },
      {
        limit: { kind: "limited", watts: -1 },
        operation: "set_solar_power_limit",
      },
    ]) {
      expect(Schema.is(ControlChange)(input)).toBe(false);
    }
  });
  it("maps watts, unlimited and amperes to the pinned private protocol, without changing installer settings", async () => {
    const { client, writes } = fixture();
    await Effect.runPromise(
      client.dispatchControl(
        stationId,
        { operation: "set_grid_export_limit", watts: 2500 },
        token
      )
    );
    await Effect.runPromise(
      client.dispatchControl(
        stationId,
        { amperes: 16.1, operation: "set_grid_connection_current" },
        token
      )
    );
    await Effect.runPromise(
      client.dispatchControl(
        stationId,
        {
          charge: { kind: "unlimited" },
          discharge: { kind: "limited", watts: 1234 },
          operation: "set_battery_power_limits",
        },
        token
      )
    );
    expect(writes).toEqual([
      {
        body: {
          enable: true,
          maxLimitationInstaller: null,
          maxLimitationOwner: "2.5",
          stationId: 12_345,
        },
        method: "PUT",
        path: "/device/energy-profile/grid/limitation/export",
      },
      {
        body: {
          enable: true,
          installerSetLimitation: null,
          ownerSetLimitation: "16.1",
          stationId: 12_345,
        },
        method: "PUT",
        path: "/device/energy-profile/parallel/off/grid",
      },
      {
        body: {
          batteryMaxChargingPower: "4294967.295",
          batteryMaxDischargingPower: "1.234",
          stationId: 12_345,
        },
        method: "PUT",
        path: "/device/energy-profile/battery/limit",
      },
    ]);
  });
  it("enforces installer ceilings and available modes, and verifies effective readback", async () => {
    const { client } = fixture();
    expect(
      await Effect.runPromise(
        client
          .validateControl(
            stationId,
            { operation: "set_grid_export_limit", watts: 5001 },
            grid,
            token
          )
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
    expect(
      await Effect.runPromise(
        client
          .validateControl(
            stationId,
            { amperes: 40, operation: "set_grid_connection_current" },
            grid,
            token
          )
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
    expect(
      await Effect.runPromise(
        client
          .validateControl(
            stationId,
            { operation: "set_operating_mode", profileId: -1, providerMode: 5 },
            grid,
            token
          )
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    expect(
      controlMatches({ operation: "set_grid_export_limit", watts: 5000 }, grid)
    ).toBe(false);
    if (grid.kind !== "grid") {
      throw new Error("Expected grid fixture");
    }
    const owned = Schema.decodeUnknownSync(ControlSnapshot)({
      ...grid,
      settings: {
        ...grid.settings,
        exportPower: {
          ...grid.settings.exportPower,
          owner: { kind: "limited", watts: 5000 },
        },
      },
    });
    expect(
      controlMatches({ operation: "set_grid_export_limit", watts: 5000 }, owned)
    ).toBe(true);
    expect(
      controlMatches(
        { amperes: 32, operation: "set_grid_connection_current" },
        grid
      )
    ).toBe(true);
    expect(
      controlMatches({ operation: "set_grid_export_limit", watts: 2500 }, grid)
    ).toBe(false);
  });
});
