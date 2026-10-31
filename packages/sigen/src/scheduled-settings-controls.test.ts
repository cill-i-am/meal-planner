/* eslint-disable no-await-in-loop -- Ordered assertions inspect the same adapter fixture. */
import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  preheating,
  profile,
  remainingResponses,
} from "./__fixtures__/remaining.js";
import { makeControlsClient } from "./controls-client.js";
import type { ProviderWrite } from "./controls-client.js";
import { ControlChange, controlMatches } from "./controls.js";
import { StationId } from "./model.js";
import { EnergyProfileFeatures } from "./profile.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("fixture");
const parse = Schema.decodeUnknownSync(ControlChange);
const window = {
  endTime: "02:30",
  providerDays: "1,2,3,4,5",
  startTime: "01:00",
};
const preheat = parse({
  enabled: true,
  operation: "set_preheating_schedule",
  timezone: "Europe/London",
  windows: [window],
});
const saving = parse({
  loadThreshold: { kind: "watts", watts: 80 },
  offGridMode: "performance",
  onGridMode: "deep_saving",
  operation: "set_energy_saving_settings",
});
const batteryGroup = {
  chargeCutoffPercent: 90,
  chargeLimit: { kind: "limited", watts: 3000 },
  dischargeCutoffPercent: 0,
  dischargeLimit: { kind: "unlimited" },
  gridChargeLimit: { kind: "limited", watts: 2000 },
  gridExportLimit: { kind: "unlimited" },
  name: "Charge",
  providerActiveStatus: 1,
  providerMode: 0,
  sourcePriority: ["pv", "grid"],
  windows: [window],
};
const replacement = {
  batteryEnabled: true,
  batteryGroups: [batteryGroup],
  gridEnabled: false,
  gridGroups: [],
  timezone: "Europe/London",
};
const automation = parse({
  operation: "replace_automation_schedule",
  replacement,
});
const fixture = (overrides: Record<string, unknown> = {}) => {
  const writes: Parameters<ProviderWrite>[] = [];
  const data: Record<string, unknown> = {
    ...remainingResponses,
    "/device/dischargesetting/peak/shaving/12345": {
      controlMode: 0,
      settingList: [],
      shavingSOC: 0,
    },
    "/device/energy-profile/battery/level/12345": {
      backupSOC: "20",
      chargeSOC: "100",
      dischargeSOC: "10",
      peakShavingSOC: "0",
    },
    "/device/energy-profile/mode/current/12345": {
      currentMode: 1,
      currentProfileId: -1,
    },
    "/device/energy-profile/support/12345": {
      ...Object.fromEntries(
        Object.keys(EnergyProfileFeatures.fields).map((key) => [key, true])
      ),
      batteryPriorityItem: ["pv", "grid"],
      gridPriorityItem: ["pv", "battery"],
    },
    "/device/energy-profile/support/upgradeEms/12345": false,
    "/device/owner/station/save-energy-mode/12345": {
      offGridEnable: false,
      offGridMode: "2",
      onGridMode: "0",
      stationId: 12_345,
      value: "65535",
    },
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
  const inspect = (change: ControlChange) =>
    Effect.runPromise(client.inspectControl(id, change, token));
  return { client, data, inspect, writes };
};

describe("complete schedule replacements and settings writes", () => {
  it("preserves an unsupported populated automation side while editing the supported side", async () => {
    const group = {
      activeStatus: 1,
      itemVOList: [
        { endTime: "02:30", startTime: "01:00", whichDay: "1,2,3,4,5" },
      ],
      maxBuyPower: "1.001",
      maxSellPower: "2",
      name: "Grid",
      priorityList: ["pv", "battery"],
      winMode: 0,
    };
    const f = fixture({
      "/device/energy-profile/setting/12345": {
        ...profile,
        gridAutomationGroupVOList: [group],
      },
      "/device/energy-profile/support/12345": {
        ...Object.fromEntries(
          Object.keys(EnergyProfileFeatures.fields).map((key) => [key, true])
        ),
        batteryPriorityItem: ["pv", "grid"],
        gridPriorityItem: ["pv", "battery"],
        hasGridAutomation: false,
      },
    });
    const change = parse({
      ...automation,
      replacement: {
        ...replacement,
        gridGroups: [
          {
            exportLimit: { kind: "limited", watts: 2000 },
            importLimit: { kind: "limited", watts: 1001 },
            name: "Grid",
            providerActiveStatus: 1,
            providerMode: 0,
            sourcePriority: ["pv", "battery"],
            windows: [window],
          },
        ],
      },
    });
    await Effect.runPromise(
      f.client.validateControl(id, change, await f.inspect(change), token)
    );
  });
  it.each([null, ""])(
    "confirms populated residential readback with unused power %j",
    async (power) => {
      const f = fixture();
      const current = await f.inspect(preheat);
      await Effect.runPromise(
        f.client.validateControl(id, preheat, current, token)
      );
      await Effect.runPromise(f.client.dispatchControl(id, preheat, token));
      expect(f.writes[0]?.slice(0, 3)).toEqual([
        "PUT",
        "/device/dischargesetting/packPreheat/set/new/12345",
        {
          packPreheatingDTOList: [
            {
              chargingPower: null,
              dischargePower: null,
              duration: 90,
              periodConfig: [1, 2, 3, 4, 5],
              startTime: 60,
            },
          ],
          packPreheatingSwitch: 1,
          preHeatingEnablesSwitch: null,
          preheatingMode: null,
        },
      ]);
      expect(controlMatches(preheat, current)).toBe(false);
      f.data["/device/dischargesetting/packPreheating/new/12345"] = {
        ...preheating,
        packPreheatingSwitch: 1,
        packPreheatingVOList: [
          {
            chargingPower: power,
            dischargePower: power,
            duration: 90,
            periodConfig: [1, 2, 3, 4, 5],
            startTime: "60",
          },
        ],
      };
      expect(controlMatches(preheat, await f.inspect(preheat))).toBe(true);
      for (const unexpected of [0, "0", " ", "3.5"]) {
        for (const field of ["chargingPower", "dischargePower"]) {
          f.data["/device/dischargesetting/packPreheating/new/12345"] = {
            ...preheating,
            packPreheatingSwitch: 1,
            packPreheatingVOList: [
              {
                chargingPower: power,
                dischargePower: power,
                duration: 90,
                periodConfig: [1, 2, 3, 4, 5],
                startTime: "60",
                [field]: unexpected,
              },
            ],
          };
          expect(controlMatches(preheat, await f.inspect(preheat))).toBe(false);
        }
      }
      f.data["/device/dischargesetting/packPreheating/new/12345"] = {
        ...preheating,
        isIndustry: true,
      };
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, preheat, await f.inspect(preheat), token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    }
  );
  it("rejects invalid weekdays, duplicates, overlaps, overnight ambiguity and too many heating slots", () => {
    for (const windows of [
      [{ ...window, providerDays: "0" }],
      [{ ...window, providerDays: "1,1" }],
      [{ ...window, startTime: "23:00" }],
      [window, { ...window, startTime: "02:00" }],
      Array.from({ length: 5 }, () => window),
    ]) {
      expect(Schema.is(ControlChange)({ ...preheat, windows })).toBe(false);
    }
    expect(
      Schema.is(ControlChange)({
        ...preheat,
        windows: [window, { ...window, endTime: "24:00", startTime: "02:30" }],
      })
    ).toBe(true);
  });
  it("replaces battery automation while preserving the rest of the profile and mapping power to kW", async () => {
    const f = fixture();
    const current = await f.inspect(automation);
    await Effect.runPromise(
      f.client.validateControl(id, automation, current, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(id, automation, token, current)
    );
    expect(f.writes[0]?.slice(0, 2)).toEqual([
      "PUT",
      "/device/energy-profile/setting",
    ]);
    expect(f.writes[0]?.[2]).toMatchObject({
      backupSOC: "20",
      batteryAutomationGroupVOList: [
        {
          activeStatus: 1,
          b2GMaxDischargePower: "4294967.295",
          chargeCutOffSoc: "90",
          dischargeCutOffSoc: "0",
          g2BMaxChargePower: "2",
          itemVOList: [
            { endTime: "02:30", startTime: "01:00", whichDay: "1,2,3,4,5" },
          ],
          maxChargePower: "3",
          maxDischargePower: "4294967.295",
          name: "Charge",
          priorityList: ["pv", "grid"],
          winMode: 0,
        },
      ],
      batteryGlobalActive: true,
      name: "Fixture profile",
    });
    expect(controlMatches(automation, current, current)).toBe(false);
    const wrongZone = parse({
      ...automation,
      replacement: { ...replacement, timezone: "UTC" },
    });
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(id, wrongZone, current, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
    f.data["/device/energy-profile/support/12345"] = {
      ...Object.fromEntries(
        Object.keys(EnergyProfileFeatures.fields).map((key) => [key, false])
      ),
      batteryPriorityItem: ["pv", "grid"],
      gridPriorityItem: ["pv", "battery"],
    };
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(id, automation, current, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
  });
  it("rejects automation collisions across groups, unsupported modes and contradictory thresholds", () => {
    for (const batteryGroups of [
      [batteryGroup, { ...batteryGroup, name: "Other" }],
      [{ ...batteryGroup, providerMode: 99 }],
      [{ ...batteryGroup, dischargeCutoffPercent: 95 }],
    ]) {
      expect(
        Schema.is(ControlChange)({
          ...automation,
          replacement: { ...replacement, batteryGroups },
        })
      ).toBe(false);
    }
  });
  it.each([3000, 1001])(
    "verifies a populated profile after a %i W provider round trip",
    async (watts) => {
      const f = fixture();
      const change = parse({
        ...automation,
        replacement: {
          ...replacement,
          batteryGroups: [
            { ...batteryGroup, chargeLimit: { kind: "limited", watts } },
          ],
        },
      });
      const before = await f.inspect(change);
      await Effect.runPromise(
        f.client.dispatchControl(id, change, token, before)
      );
      const [write] = f.writes;
      const original =
        remainingResponses["/device/energy-profile/setting/12345"];
      const originalProfile = Schema.decodeUnknownSync(
        Schema.Struct({
          isIndustry: Schema.Boolean,
          pvPriority: Schema.Unknown,
        })
      )(original);
      // The provider returns display metadata in addition to the submitted editable fields.
      f.data["/device/energy-profile/setting/12345"] = {
        ...write?.[2],
        ...originalProfile,
      };
      expect(controlMatches(change, await f.inspect(change), before)).toBe(
        true
      );
    }
  );
  it("allows new peak-shaving windows and rejects changed overlapping or unknown day windows", async () => {
    const f = fixture();
    const change = parse({
      enabled: true,
      operation: "set_peak_shaving_schedule",
      reserveSocPercent: 30,
      slots: [{ ...window, peakPowerW: 2500 }],
      timezone: "Europe/London",
    });
    const current = await f.inspect(change);
    await Effect.runPromise(
      f.client.validateControl(id, change, current, token)
    );
    for (const slots of [
      [{ ...window, peakPowerW: 2500, providerDays: "future" }],
      [
        { ...window, peakPowerW: 2500 },
        { ...window, peakPowerW: 2000 },
      ],
    ]) {
      const invalid = parse({ ...change, slots });
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, invalid, current, token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    }
  });
  it.each([12, 13])(
    "limits new peak-shaving windows to the app's twelve slots: %s",
    async (count) => {
      const f = fixture();
      const change = parse({
        enabled: true,
        operation: "set_peak_shaving_schedule",
        reserveSocPercent: 20,
        slots: Array.from({ length: count }, (_, index) => ({
          endTime: `${String(index + 1).padStart(2, "0")}:00`,
          peakPowerW: 2500,
          providerDays: "1",
          startTime: `${String(index).padStart(2, "0")}:00`,
        })),
        timezone: "Europe/London",
      });
      const result = await Effect.runPromise(
        f.client
          .validateControl(id, change, await f.inspect(change), token)
          .pipe(Effect.result)
      );
      expect(result._tag).toBe(count === 12 ? "Success" : "Failure");
    }
  );
  it("preserves observed saving modes explicitly, needs the review for dispatch, and checks preservation on readback", async () => {
    const raw = {
      offGridEnable: true,
      offGridMode: "0",
      onGridMode: "1",
      stationId: 12_345,
      value: "65535",
    };
    const f = fixture({ "/device/owner/station/save-energy-mode/12345": raw });
    const change = parse({
      ...saving,
      loadThreshold: { kind: "system_default" },
      offGridMode: "unchanged",
      onGridMode: "unchanged",
    });
    const before = await f.inspect(change);
    await Effect.runPromise(
      f.client.validateControl(id, change, before, token)
    );
    expect(
      await Effect.runPromise(
        f.client.dispatchControl(id, change, token).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "SchemaMismatch" } });
    expect(f.writes).toHaveLength(0);
    await Effect.runPromise(
      f.client.dispatchControl(id, change, token, before)
    );
    expect(f.writes[0]?.[2]).toEqual({ ...raw, offGridEnable: false });
    expect(controlMatches(change, before)).toBe(false);
    expect(controlMatches(change, await f.inspect(change), before)).toBe(true);
    f.data["/device/owner/station/save-energy-mode/12345"] = {
      ...raw,
      offGridMode: "1",
    };
    expect(controlMatches(change, await f.inspect(change), before)).toBe(false);
    f.data["/device/owner/station/save-energy-mode/12345"] = {
      ...raw,
      offGridMode: "99",
    };
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(id, change, await f.inspect(change), token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    const threshold = parse({
      ...change,
      loadThreshold: { kind: "watts", watts: 80 },
    });
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(id, threshold, before, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
  });
  it("writes known energy-saving modes, respects the off-grid capability and checks all requested values", async () => {
    const f = fixture();
    const current = await f.inspect(saving);
    await Effect.runPromise(
      f.client.validateControl(id, saving, current, token)
    );
    await Effect.runPromise(f.client.dispatchControl(id, saving, token));
    expect(f.writes[0]?.slice(0, 3)).toEqual([
      "PUT",
      "/device/owner/station/save-energy-mode",
      {
        offGridEnable: false,
        offGridMode: "2",
        onGridMode: "2",
        stationId: 12_345,
        value: "80",
      },
    ]);
    const offGrid = parse({ ...saving, offGridMode: "deep_saving" });
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(id, offGrid, current, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    f.data["/device/owner/station/save-energy-mode/12345"] = {
      offGridEnable: false,
      offGridMode: "2",
      onGridMode: "2",
      stationId: 12_345,
      value: "80",
    };
    expect(controlMatches(saving, await f.inspect(saving))).toBe(true);
    f.data["/device/owner/station/save-energy-mode/12345"] = {
      offGridEnable: false,
      offGridMode: "2",
      onGridMode: "2",
      stationId: 12_345,
      value: "65535",
    };
    expect(controlMatches(saving, await f.inspect(saving))).toBe(false);
  });
});
