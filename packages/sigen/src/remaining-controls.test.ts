import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  profile,
  priority,
  remainingResponses,
  smartLoad,
} from "./__fixtures__/remaining.js";
import { makeControlsClient } from "./controls-client.js";
import type { ProviderWrite } from "./controls-client.js";
import {
  ControlChange,
  ControlSnapshot,
  controlMatches,
  snapshotConfiguration,
} from "./controls.js";
import { StationId } from "./model.js";
import { EnergyProfileFeatures } from "./profile.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("synthetic");
const fixture = (overrides: Readonly<Record<string, unknown>> = {}) => {
  const writes: Parameters<ProviderWrite>[] = [];
  const data: Readonly<Record<string, unknown>> = {
    ...remainingResponses,
    "/device/energy-profile/battery/discharge/priority/12345": {
      priority: ["pv", "grid"],
    },
    "/device/energy-profile/support/12345": {
      ...Object.fromEntries(
        Object.keys(EnergyProfileFeatures.fields).map((key) => [key, true])
      ),
      batteryPriorityItem: ["pv", "grid"],
      gridPriorityItem: ["pv", "battery"],
    },
    "/device/energy-profile/support/upgradeEms/12345": false,
    ...overrides,
  };
  const client = makeControlsClient(
    (path) =>
      Effect.succeed(data[new URL(path, "https://fixture.invalid").pathname]),
    (...args) =>
      Effect.sync(() => {
        writes.push(args);
      })
  );
  return { client, writes };
};
const parse = Schema.decodeUnknownSync(ControlChange);
describe("expanded reviewed controls", () => {
  it("switches a membership-verified smart load using PATCH query parameters and no body", async () => {
    const f = fixture();
    const change = parse({
      enabled: true,
      loadKey: "synthetic-load",
      loadPath: 1,
      operation: "set_smart_load_switch",
    });
    const current = await Effect.runPromise(
      f.client.inspectControl(id, change, token)
    );
    await Effect.runPromise(
      f.client.validateControl(id, change, current, token)
    );
    await Effect.runPromise(f.client.dispatchControl(id, change, token));
    expect(f.writes[0]?.slice(0, 3)).toEqual([
      "PATCH",
      "/device/tp-device/smart-loads/control-mode/manual/switch?stationId=12345&loadPath=1&manualSwitch=1",
      null,
    ]);
    expect(controlMatches(change, current)).toBe(false);
    const next = await Effect.runPromise(
      fixture({
        "/device/tp-device/smart-loads": { ...smartLoad, manualSwitch: 1 },
      }).client.inspectControl(id, change, token)
    );
    expect(controlMatches(change, next)).toBe(true);
  });
  it.each([{ loadKey: "wrong" }, { loadPath: 2 }])(
    "rejects a changed load identity",
    async (patch) => {
      const f = fixture();
      const change = parse({
        enabled: true,
        loadKey: "synthetic-load",
        loadPath: 1,
        operation: "set_smart_load_switch",
      });
      const current = await Effect.runPromise(
        f.client.inspectControl(id, change, token)
      );
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, parse({ ...change, ...patch }), current, token)
            .pipe(Effect.result)
        )
      ).toMatchObject({
        _tag: "Failure",
        failure: { reason: "PermissionDenied" },
      });
      expect(f.writes).toHaveLength(0);
    }
  );
  it("requires supported priority sources and exact complete solar membership", async () => {
    const f = fixture();
    const change = parse({
      operation: "set_battery_discharge_priority",
      sources: ["grid", "pv"],
    });
    const current = await Effect.runPromise(
      f.client.inspectControl(id, change, token)
    );
    await Effect.runPromise(
      f.client.validateControl(id, change, current, token)
    );
    await Effect.runPromise(f.client.dispatchControl(id, change, token));
    expect(f.writes[0]?.slice(0, 3)).toEqual([
      "PUT",
      "/device/energy-profile/battery/discharge/priority",
      { priority: ["grid", "pv"], stationId: 12_345 },
    ]);
    const solar = parse({
      entries: [
        {
          providerDeviceType: 4,
          providerLoadType: 1,
          providerPriority: 1,
          smartLoadPath: null,
        },
      ],
      operation: "set_solar_priority",
    });
    const solarState = await Effect.runPromise(
      f.client.inspectControl(id, solar, token)
    );
    await Effect.runPromise(
      f.client.validateControl(id, solar, solarState, token)
    );
    expect(controlMatches(solar, solarState)).toBe(true);
    const foreign = parse({
      entries: [
        {
          providerDeviceType: 4,
          providerLoadType: 9,
          providerPriority: 1,
          smartLoadPath: null,
        },
      ],
      operation: "set_solar_priority",
    });
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(id, foreign, solarState, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
  });
  it.each([{ profileId: 200, providerMode: 9 }])(
    "permits only enumerated operating strategies and profiles",
    async (mode) => {
      const f = fixture();
      const change = parse({ operation: "set_operating_mode", ...mode });
      const current = Schema.decodeUnknownSync(ControlSnapshot)({
        kind: "mode",
        settings: {
          fetchedAt: 1,
          profileId: -1,
          providerMode: 1,
          stationId: id,
        },
      });
      await Effect.runPromise(
        f.client.validateControl(id, change, current, token)
      );
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(
              id,
              parse({ ...change, profileId: 999 }),
              current,
              token
            )
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    }
  );
  it("binds selected custom-profile configuration while ignoring fetch timestamps", async () => {
    const change = parse({
      operation: "set_operating_mode",
      profileId: 200,
      providerMode: 9,
    });
    const f = fixture({
      "/device/energy-profile/mode/current/12345": {
        currentMode: 1,
        currentProfileId: -1,
      },
    });
    const before = await Effect.runPromise(
      f.client.inspectControl(id, change, token)
    );
    const same = await Effect.runPromise(
      f.client.inspectControl(id, change, token)
    );
    expect(snapshotConfiguration(before)).toBe(snapshotConfiguration(same));
    const changed = fixture({
      "/device/energy-profile/mode/current/12345": {
        currentMode: 1,
        currentProfileId: -1,
      },
      "/device/energy-profile/setting/info/12345": {
        ...profile,
        backupSOC: "80",
      },
    });
    const after = await Effect.runPromise(
      changed.client.inspectControl(id, change, token)
    );
    expect(snapshotConfiguration(before)).not.toBe(
      snapshotConfiguration(after)
    );
    if (
      same.kind !== "mode" ||
      after.kind !== "mode" ||
      same.settings.selectedProfile === undefined
    ) {
      throw new Error("Expected custom profile");
    }
    const active = {
      ...same,
      settings: {
        ...same.settings,
        profileId: 200,
        providerMode: 9,
        selectedProfile: {
          ...same.settings.selectedProfile,
          providerActiveStatus: 1,
        },
      },
    };
    expect(controlMatches(change, active, before)).toBe(true);
    expect(
      controlMatches(
        change,
        {
          ...after,
          settings: { ...after.settings, profileId: 200, providerMode: 9 },
        },
        before
      )
    ).toBe(false);
    expect(controlMatches(change, active)).toBe(false);
  });
  it("rejects duplicate provider identities even when the requested list has equal length and priorities", async () => {
    const f = fixture({
      "/device/energy-profile/setting/12345": {
        ...profile,
        pvPriority: [priority, { ...priority, priority: 2 }],
      },
    });
    const change = parse({
      entries: [
        {
          providerDeviceType: 4,
          providerLoadType: 1,
          providerPriority: 1,
          smartLoadPath: null,
        },
        {
          providerDeviceType: 4,
          providerLoadType: 3,
          providerPriority: 2,
          smartLoadPath: null,
        },
      ],
      operation: "set_solar_priority",
    });
    const current = await Effect.runPromise(
      f.client.inspectControl(id, change, token)
    );
    expect(
      await Effect.runPromise(
        f.client.validateControl(id, change, current, token).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
    expect(f.writes).toHaveLength(0);
  });
  it.each(
    [
      [{ ...priority }, { ...priority }],
      [{ ...priority, status: 99 }],
      [{ ...priority, loadsType: 999 }],
      [{ ...priority, priority: 2, status: 2 }],
    ].map((entries) => ({ entries }))
  )(
    "refuses malformed identities and unverified solar-priority semantics",
    async ({ entries }) => {
      const f = fixture({
        "/device/energy-profile/setting/12345": {
          ...profile,
          pvPriority: entries,
        },
      });
      const change = parse({
        entries: [
          {
            providerDeviceType: 4,
            providerLoadType: 1,
            providerPriority: 1,
            smartLoadPath: null,
          },
        ],
        operation: "set_solar_priority",
      });
      const current = await Effect.runPromise(
        f.client.inspectControl(id, change, token)
      );
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, change, current, token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ _tag: "Failure" });
      expect(f.writes).toHaveLength(0);
    }
  );
  it.each([0, 99, null])(
    "does not manually switch loads in automatic or unknown run mode %s",
    async (runMode) => {
      const f = fixture({
        "/device/tp-device/smart-loads": { ...smartLoad, runMode },
      });
      const change = parse({
        enabled: true,
        loadKey: "synthetic-load",
        loadPath: 1,
        operation: "set_smart_load_switch",
      });
      const current = await Effect.runPromise(
        f.client.inspectControl(id, change, token)
      );
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, change, current, token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    }
  );
  it("bounds manual override duration and never claims omitted power/duration were verified", async () => {
    const f = fixture();
    const change = parse({
      durationMinutes: 30,
      limit: { kind: "limited", watts: 1234 },
      mode: "charge",
      operation: "start_manual_override",
    });
    expect(Schema.is(ControlChange)({ ...change, durationMinutes: 121 })).toBe(
      false
    );
    expect(Schema.is(ControlChange)({ ...change, mode: "unknown" })).toBe(
      false
    );
    await Effect.runPromise(f.client.dispatchControl(id, change, token));
    expect(f.writes[0]?.slice(0, 3)).toEqual([
      "PUT",
      "/device/energy-profile/instant/manunal",
      {
        duration: "30",
        enable: true,
        mode: "0",
        powerLimitation: "1.234",
        stationId: 12_345,
      },
    ]);
    expect(
      controlMatches(
        change,
        Schema.decodeUnknownSync(ControlSnapshot)({
          kind: "manual",
          settings: {
            enabled: true,
            fetchedAt: 1,
            providerEndTime: "1793200500000",
            providerMode: "0",
            stationId: id,
          },
        })
      )
    ).toBe(false);
  });
});
