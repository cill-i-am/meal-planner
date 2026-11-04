import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { profile, remainingResponses } from "./__fixtures__/remaining.js";
import { makeControlsClient } from "./controls-client.js";
import type { ProviderWrite } from "./controls-client.js";
import {
  ControlChange,
  approvalScope,
  controlMatches,
  snapshotConfiguration,
} from "./controls.js";
import { StationId } from "./model.js";
import { EnergyProfileFeatures } from "./profile.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("fixture");
const parse = Schema.decodeUnknownSync(ControlChange);
const create = parse({
  description: "Prepared profile",
  name: "Night charging",
  operation: "create_energy_profile",
  source: { kind: "template", profileId: 200, providerMode: 9 },
});
const update = parse({
  edits: { description: "Revised", name: "Renamed" },
  operation: "update_energy_profile",
  profileId: 201,
});
const remove = parse({ operation: "delete_energy_profile", profileId: 201 });
const fixture = (overrides: Record<string, unknown> = {}) => {
  const writes: Parameters<ProviderWrite>[] = [];
  const data: Record<string, unknown> = {
    ...remainingResponses,
    "/device/energy-profile/mode/all/12345": {
      defaultWorkingModes: [],
      energyProfileItems: [{ name: "Existing", profileId: 201 }],
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
      isIndustry: false,
    },
    "/device/energy-profile/support/upgradeEms/12345": false,
    ...overrides,
  };
  const client = makeControlsClient(
    (path) => {
      const url = new URL(path, "https://fixture.invalid");
      if (
        url.pathname === "/device/energy-profile/setting/info/12345" &&
        url.searchParams.get("profileId") === "201"
      ) {
        return Effect.succeed(
          data["custom"] ?? { ...profile, name: "Existing", profileId: 201 }
        );
      }
      return Effect.succeed(data[url.pathname]);
    },
    (...args) =>
      Effect.sync(() => {
        writes.push(args);
      })
  );
  const inspect = (change = create) =>
    Effect.runPromise(client.inspectControl(id, change, token));
  return { client, data, inspect, writes };
};

describe("reviewed energy profile lifecycle", () => {
  it.each([null, "", 0, "0", " ", "3.5"])(
    "preserves residential heating on profile edits only for unused power %j",
    async (power) => {
      const populated = {
        ...profile,
        name: "Existing",
        packPreheatingInfoVO: {
          ...profile.packPreheatingInfoVO,
          packPreheatingVOList: [
            {
              chargingPower: power,
              dischargePower: power,
              duration: 15,
              periodConfig: [1],
              startTime: 60,
            },
          ],
        },
        profileId: 201,
      };
      const f = fixture({ custom: populated });
      const before = await f.inspect(update);
      const valid = power === null || power === "";
      if (!valid) {
        expect(
          await Effect.runPromise(
            f.client
              .validateControl(id, update, before, token)
              .pipe(Effect.result)
          )
        ).toMatchObject({
          failure: { reason: "UnsupportedCapability" },
        });
        expect(f.writes).toHaveLength(0);
        return;
      }
      await Effect.runPromise(
        f.client.validateControl(id, update, before, token)
      );
      await Effect.runPromise(
        f.client.dispatchControl(id, update, token, before)
      );
      expect(f.writes[0]?.[2]).toMatchObject({
        packPreheatingInfoVO: {
          packPreheatingVOList: [
            {
              chargingPower: null,
              dischargePower: null,
              duration: 15,
              periodConfig: [1],
              startTime: 60,
            },
          ],
        },
      });
      await Promise.all(
        [null, "", 0, "0", " ", "3.5"].map(async (readPower) => {
          const observed = fixture({
            custom: {
              ...populated,
              name: "Renamed",
              note: "Revised",
              packPreheatingInfoVO: {
                ...populated.packPreheatingInfoVO,
                packPreheatingVOList:
                  populated.packPreheatingInfoVO.packPreheatingVOList.map(
                    (slot) => ({
                      ...slot,
                      chargingPower: readPower,
                      dischargePower: readPower,
                    })
                  ),
              },
            },
          });
          expect(
            controlMatches(update, await observed.inspect(update), before)
          ).toBe(readPower === null || readPower === "");
        })
      );
    }
  );
  it.each([
    { activeStatus: 99 },
    {
      packPreheatingInfoVO: {
        ...profile.packPreheatingInfoVO,
        preheatingMode: 99,
      },
    },
    { peakShavingVO: { ...profile.peakShavingVO, controlMode: 99 } },
    {
      packPreheatingInfoVO: {
        ...profile.packPreheatingInfoVO,
        packPreheatingSwitch: 99,
      },
    },
    {
      packPreheatingInfoVO: {
        ...profile.packPreheatingInfoVO,
        packPreheatingVOList: [
          {
            chargingPower: null,
            dischargePower: null,
            duration: 90,
            periodConfig: [99],
            startTime: 60,
          },
        ],
      },
    },
    {
      packPreheatingInfoVO: {
        ...profile.packPreheatingInfoVO,
        packPreheatingVOList: [
          {
            chargingPower: null,
            dischargePower: null,
            duration: 90,
            periodConfig: [1],
            startTime: 1400,
          },
        ],
      },
    },
  ])(
    "keeps unfamiliar ancillary settings readable but refuses to resubmit them in a rename",
    async (patch) => {
      const f = fixture({
        custom: { ...profile, name: "Existing", profileId: 201, ...patch },
      });
      const current = await f.inspect(update);
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, update, current, token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
      expect(f.writes).toHaveLength(0);
    }
  );
  it("serializes the live template's industrial-only mode as null and preserves priority metadata", async () => {
    const f = fixture({
      "/device/energy-profile/setting/info/12345": {
        ...profile,
        packPreheatingInfoVO: {
          ...profile.packPreheatingInfoVO,
          isAutoModeValid: false,
          preheatingMode: 1,
        },
        pvPriority: profile.pvPriority.map((entry) => ({
          ...entry,
          status: 1,
        })),
      },
    });
    const before = await f.inspect();
    await Effect.runPromise(
      f.client.validateControl(id, create, before, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(id, create, token, before)
    );
    expect(f.writes[0]?.[2]).toMatchObject({
      packPreheatingInfoVO: {
        isAutoModeValid: false,
        packPreheatingSwitch: 0,
        preheatingMode: null,
      },
    });
    if (before.kind !== "profile" || before.settings.source === null) {
      throw new Error("Expected reviewed template");
    }
    const selected = {
      ...before.settings.source,
      description: "Prepared profile",
      profileName: "Night charging",
      providerActiveStatus: 0,
      providerProfileId: 202,
    };
    for (const providerMode of [null, 1, 99]) {
      const observed = {
        ...before,
        settings: {
          ...before.settings,
          selected: {
            ...selected,
            preheating: { ...selected.preheating, providerMode },
          },
        },
      };
      expect(controlMatches(create, observed, before)).toBe(
        providerMode !== 99
      );
    }
  });
  it("creates an inactive profile from a verified template without activating it, preserving ancillary configuration", async () => {
    const f = fixture();
    const current = await f.inspect();
    await Effect.runPromise(
      f.client.validateControl(id, create, current, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(id, create, token, current)
    );
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]?.slice(0, 2)).toEqual([
      "POST",
      "/device/energy-profile/setting/new",
    ]);
    expect(f.writes[0]?.[2]).toEqual({
      activeStatus: 0,
      backupSOC: "20",
      batteryAutomationGroupVOList: [],
      batteryDischargePriority: ["pv", "grid"],
      batteryGlobalActive: false,
      batteryMaxChargingPower: "4294967.295",
      batteryMaxDischargingPower: "3.5",
      chargeSOC: "100",
      dischargeSOC: "20",
      exportLimitation: false,
      gridAutomationGroupVOList: [],
      gridGlobalActive: false,
      importLimitation: true,
      maxExportLimitation: "",
      maxImportLimitation: "5",
      name: "Night charging",
      note: "Prepared profile",
      packPreheatingInfoVO: {
        isAutoModeValid: null,
        isIndustry: false,
        packPreheatingSwitch: 0,
        packPreheatingVOList: [],
        preHeatingEnablesSwitch: null,
        preheatingMode: null,
      },
      peakShavingVO: { controlMode: 0, settingList: [], shavingSOC: 0 },
      powerLimit: "4294967.295",
      profileId: 200,
      pvPriority: [
        { loadsType: 1, priority: 1, sgDeviceType: 4, smartLoadsPath: null },
      ],
      stationId: 12_345,
    });
    expect(controlMatches(create, current, current)).toBe(false);
    f.data["/device/energy-profile/mode/all/12345"] = {
      defaultWorkingModes: [],
      energyProfileItems: [{ name: "Night charging", profileId: 201 }],
    };
    f.data["custom"] = {
      ...profile,
      name: "Night charging",
      note: "Prepared profile",
      profileId: 201,
    };
    // An existing ID is not proof of creation, even if its data now matches.
    expect(controlMatches(create, await f.inspect(), current)).toBe(false);
    const empty = fixture({
      "/device/energy-profile/mode/all/12345": {
        defaultWorkingModes: [],
        energyProfileItems: [],
      },
    });
    expect(
      controlMatches(create, await f.inspect(), await empty.inspect())
    ).toBe(true);
    f.data["custom"] = {
      ...profile,
      backupSOC: "80",
      name: "Night charging",
      note: "Prepared profile",
      profileId: 201,
    };
    expect(
      controlMatches(create, await f.inspect(), await empty.inspect())
    ).toBe(false);
  });
  it("updates the selected profile and verifies its complete configuration", async () => {
    const f = fixture();
    const current = await f.inspect(update);
    await Effect.runPromise(
      f.client.validateControl(id, update, current, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(id, update, token, current)
    );
    expect(f.writes[0]?.slice(0, 2)).toEqual([
      "PUT",
      "/device/energy-profile/setting",
    ]);
    expect(f.writes[0]?.[2]).toMatchObject({
      backupSOC: "20",
      batteryMaxDischargingPower: "3.5",
      name: "Renamed",
      note: "Revised",
      profileId: 201,
    });
    f.data["custom"] = {
      ...profile,
      name: "Renamed",
      note: "Revised",
      profileId: 201,
    };
    const after = await f.inspect(update);
    expect(controlMatches(update, after, current)).toBe(true);
    expect(controlMatches(update, after)).toBe(false);
    f.data["custom"] = {
      ...profile,
      maxImportLimitation: "4",
      name: "Renamed",
      note: "Revised",
      profileId: 201,
    };
    expect(controlMatches(update, await f.inspect(update), current)).toBe(
      false
    );
    expect(snapshotConfiguration(await f.inspect(update))).not.toBe(
      snapshotConfiguration(current)
    );
  });
  it("deletes only an inactive profile and verifies absence without turning a read failure into absence", async () => {
    const f = fixture();
    const current = await f.inspect(remove);
    await Effect.runPromise(
      f.client.validateControl(id, remove, current, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(id, remove, token, current)
    );
    expect(f.writes[0]?.slice(0, 3)).toEqual([
      "DELETE",
      "/device/energy-profile/setting/12345/201",
      null,
    ]);
    expect(controlMatches(remove, current, current)).toBe(false);
    f.data["/device/energy-profile/mode/current/12345"] = {
      currentMode: 9,
      currentProfileId: 201,
    };
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(id, remove, await f.inspect(remove), token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "Conflict" } });
    f.data["/device/energy-profile/mode/current/12345"] = {
      currentMode: 1,
      currentProfileId: -1,
    };
    f.data["/device/energy-profile/mode/all/12345"] = {
      defaultWorkingModes: [],
      energyProfileItems: [],
    };
    expect(controlMatches(remove, await f.inspect(remove), current)).toBe(true);
    f.data["/device/energy-profile/mode/all/12345"] = {};
    await expect(f.inspect(remove)).rejects.toBeDefined();
  });
  it("refuses duplicate names, missing profiles, unknown source profiles and unsupported grouped settings", async () => {
    const f = fixture({
      "/device/energy-profile/mode/all/12345": {
        defaultWorkingModes: [],
        energyProfileItems: [{ name: "Night charging", profileId: 201 }],
      },
    });
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(id, create, await f.inspect(), token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "Conflict" } });
    const unknown = parse({
      ...create,
      source: { kind: "template", profileId: 999, providerMode: 9 },
    });
    await expect(f.inspect(unknown)).rejects.toBeDefined();
    const missing = parse({ ...update, profileId: 999 });
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(id, missing, await f.inspect(missing), token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
    const industrial = fixture({
      "/device/energy-profile/setting/info/12345": {
        ...profile,
        isIndustry: true,
      },
    });
    expect(
      await Effect.runPromise(
        industrial.client
          .validateControl(id, create, await industrial.inspect(), token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
  });
  it("binds saved update/delete approvals to the profile ID and rejects empty or unsafe edit inputs", () => {
    expect(approvalScope(id, update)).toEqual({
      operation: "update_energy_profile",
      profileId: 201,
      stationId: id,
    });
    expect(approvalScope(id, remove)).toEqual({
      operation: "delete_energy_profile",
      profileId: 201,
      stationId: id,
    });
    for (const invalid of [
      { ...update, edits: {} },
      { ...update, profileId: -1 },
      { ...create, name: " " },
      { ...create, source: { kind: "current" } },
    ]) {
      expect(Schema.is(ControlChange)(invalid)).toBe(false);
    }
  });
});

const parameterChange = (parameters: Record<string, Schema.Json>) =>
  parse({
    operation: "set_energy_profile_parameters",
    parameters,
    profileId: 201,
  });
const limited = (watts: number) => ({ kind: "limited", watts });
const gridResponses = (ceiling = "6") => ({
  "/device/energy-profile/grid/limitation/export/12345": {
    enable: true,
    maxLimitation: "5",
    maxLimitationInstaller: ceiling,
    maxLimitationOwner: "5",
  },
  "/device/energy-profile/grid/limitation/import/12345": {
    enable: true,
    maxLimitation: "5",
    maxLimitationInstaller: ceiling,
    maxLimitationOwner: "5",
  },
  "/device/energy-profile/parallel/off/grid/12345": {
    currentLimitation: "25",
    enable: true,
    installerSetLimitation: "32",
    ownerSetLimitation: "25",
  },
});

describe("inactive profile parameters", () => {
  it("serializes selected parameters, preserves everything else and verifies the full readback", async () => {
    const change = parameterChange({
      batteryPower: { charge: limited(1001), discharge: { kind: "unlimited" } },
      batterySoc: {
        backupSocPercent: 30,
        chargeSocPercent: 90,
        dischargeSocPercent: 25,
      },
      gridExport: { enabled: true, limit: limited(4000) },
      gridImport: { enabled: false, limit: limited(5000) },
      solarLimit: limited(5500),
    });
    const f = fixture(gridResponses());
    const before = await f.inspect(change);
    await Effect.runPromise(
      f.client.validateControl(id, change, before, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(id, change, token, before)
    );
    const body = f.writes[0]?.[2];
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]?.slice(0, 2)).toEqual([
      "PUT",
      "/device/energy-profile/setting",
    ]);
    expect(body).toMatchObject({
      activeStatus: 0,
      backupSOC: "30",
      batteryAutomationGroupVOList: [],
      batteryDischargePriority: ["pv", "grid"],
      batteryMaxChargingPower: "1.001",
      batteryMaxDischargingPower: "4294967.295",
      chargeSOC: "90",
      dischargeSOC: "25",
      exportLimitation: true,
      gridAutomationGroupVOList: [],
      importLimitation: false,
      maxExportLimitation: "4",
      maxImportLimitation: "5",
      name: "Existing",
      peakShavingVO: profile.peakShavingVO,
      powerLimit: "5.5",
      profileId: 201,
    });
    f.data["custom"] = { ...profile, ...body, pvPriority: profile.pvPriority };
    expect(controlMatches(change, await f.inspect(change), before)).toBe(true);
    f.data["custom"] = {
      ...profile,
      ...body,
      note: "Unexpected provider edit",
      pvPriority: profile.pvPriority,
    };
    expect(controlMatches(change, await f.inspect(change), before)).toBe(false);
  });
  it.each([
    {},
    {
      batterySoc: {
        backupSocPercent: 20,
        chargeSocPercent: 50,
        dischargeSocPercent: 60,
      },
    },
    {
      batterySoc: {
        backupSocPercent: 60,
        chargeSocPercent: 50,
        dischargeSocPercent: 20,
      },
    },
    {
      batterySoc: {
        backupSocPercent: 20.5,
        chargeSocPercent: 100,
        dischargeSocPercent: 20,
      },
    },
    { solarLimit: { kind: "unset" } },
    { solarLimit: limited(-1) },
    { solarLimit: limited(4_294_967_295) },
    { batteryPower: { charge: limited(1000) } },
    { gridExport: { enabled: true } },
  ])("rejects invalid parameter requests: %j", (parameters) => {
    expect(() => parameterChange(parameters)).toThrow();
  });
  it.each([
    { custom: { ...profile, activeStatus: 1, profileId: 201 } },
    {
      "/device/energy-profile/mode/current/12345": {
        currentMode: 9,
        currentProfileId: 201,
      },
    },
  ])(
    "refuses active profiles using both independent activation signals",
    async (overrides) => {
      const f = fixture(overrides);
      const change = parameterChange({ solarLimit: limited(2000) });
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, change, await f.inspect(change), token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "Conflict" } });
      expect(f.writes).toHaveLength(0);
    }
  );
  it.each(["support", "hasBatterySetting", "hasBackupSetting"])(
    "requires capability %s",
    async (feature) => {
      const f = fixture();
      const change = parameterChange({
        batterySoc: {
          backupSocPercent: 20,
          chargeSocPercent: 90,
          dischargeSocPercent: 20,
        },
      });
      f.data["/device/energy-profile/support/12345"] = {
        ...Object.fromEntries(
          Object.keys(EnergyProfileFeatures.fields).map((key) => [key, true])
        ),
        [feature]: false,
        batteryPriorityItem: ["pv", "grid"],
        gridPriorityItem: ["pv", "battery"],
        isIndustry: false,
      };
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, change, await f.inspect(change), token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    }
  );
  it.each(["", "3"])(
    "refuses unknown or exceeded installer ceilings %s",
    async (ceiling) => {
      const f = fixture(gridResponses(ceiling));
      const change = parameterChange({
        gridExport: { enabled: true, limit: limited(4000) },
      });
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, change, await f.inspect(change), token)
            .pipe(Effect.result)
        )
      ).toMatchObject({
        failure: {
          reason: ceiling === "" ? "UnsupportedCapability" : "InvalidInput",
        },
      });
    }
  );
  it.each([1001, 1002])(
    "handles conversion noise at an exact installer ceiling for %i W",
    async (watts) => {
      const f = fixture(gridResponses("1.001"));
      const change = parameterChange({
        gridExport: { enabled: true, limit: limited(watts) },
      });
      const before = await f.inspect(change);
      const result = await Effect.runPromise(
        f.client.validateControl(id, change, before, token).pipe(Effect.result)
      );
      if (watts === 1001) {
        expect(result).toMatchObject({ _tag: "Success" });
      } else {
        expect(result).toMatchObject({ failure: { reason: "InvalidInput" } });
      }
      expect(f.writes).toHaveLength(0);
    }
  );
  it("rechecks installer ceilings before execution and rejects unlimited above a finite ceiling", async () => {
    const f = fixture(gridResponses());
    const change = parameterChange({
      gridImport: { enabled: true, limit: limited(5000) },
    });
    const before = await f.inspect(change);
    await Effect.runPromise(
      f.client.validateControl(id, change, before, token)
    );
    Object.assign(f.data, gridResponses("4"));
    expect(
      await Effect.runPromise(
        f.client.validateControl(id, change, before, token).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
    const unlimited = parameterChange({
      gridImport: { enabled: false, limit: { kind: "unlimited" } },
    });
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(id, unlimited, before, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
  });
  it("rejects SOC changes that invalidate a preserved enabled peak-shaving reserve", async () => {
    const f = fixture({
      custom: {
        ...profile,
        peakShavingVO: {
          controlMode: 1,
          settingList: [
            {
              endTime: "02:00",
              peakPower: 2.5,
              startTime: "01:00",
              whichDay: "1",
            },
          ],
          shavingSOC: 30,
        },
        profileId: 201,
      },
    });
    await Promise.all(
      [
        { backupSocPercent: 20, chargeSocPercent: 25, dischargeSocPercent: 20 },
        { backupSocPercent: 20, chargeSocPercent: 90, dischargeSocPercent: 35 },
      ].map(async (soc) => {
        const change = parameterChange({ batterySoc: soc });
        expect(
          await Effect.runPromise(
            f.client
              .validateControl(id, change, await f.inspect(change), token)
              .pipe(Effect.result)
          )
        ).toMatchObject({ failure: { reason: "InvalidInput" } });
      })
    );
  });
  it("rejects solar parameters without solar and scopes approval to the new operation and profile", async () => {
    const f = fixture({
      "/device/owner/station/home": {
        batteryCapacity: 8,
        hasSolar: false,
        stationId: 12_345,
        timeZoneName: "Europe/London",
      },
    });
    const change = parameterChange({ solarLimit: limited(2000) });
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(id, change, await f.inspect(change), token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    expect(approvalScope(id, change)).toEqual({
      operation: "set_energy_profile_parameters",
      profileId: 201,
      stationId: id,
    });
  });
});

const prioritiesChange = (priorities: Record<string, Schema.Json>) =>
  parse({
    operation: "set_energy_profile_priorities",
    priorities,
    profileId: 201,
  });
const schedulesChange = (schedules: Record<string, Schema.Json>) =>
  parse({
    operation: "set_energy_profile_schedules",
    profileId: 201,
    schedules,
  });
const window = { endTime: "01:15", providerDays: "1", startTime: "01:00" };

describe("inactive profile priorities and schedules", () => {
  it("preserves unrelated profile settings and verifies battery priority changes", async () => {
    const f = fixture();
    const change = prioritiesChange({
      batteryDischargeSources: ["grid", "pv"],
    });
    const before = await f.inspect(change);
    await Effect.runPromise(
      f.client.validateControl(id, change, before, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(id, change, token, before)
    );
    const body = f.writes[0]?.[2];
    expect(body).toMatchObject({
      batteryDischargePriority: ["grid", "pv"],
      chargeSOC: "100",
      name: "Existing",
      peakShavingVO: profile.peakShavingVO,
    });
    f.data["custom"] = { ...profile, ...body, pvPriority: profile.pvPriority };
    expect(controlMatches(change, await f.inspect(change), before)).toBe(true);
    f.data["custom"] = {
      ...profile,
      ...body,
      dischargeSOC: "21",
      pvPriority: profile.pvPriority,
    };
    expect(controlMatches(change, await f.inspect(change), before)).toBe(false);
  });
  it("stores residential peak and preheating windows without activating the custom profile", async () => {
    const f = fixture();
    const change = schedulesChange({
      peakShaving: {
        enabled: true,
        reserveSocPercent: 25,
        slots: [{ ...window, peakPowerW: 2500 }],
      },
      preheating: { enabled: true, windows: [window] },
      timezone: "Europe/London",
    });
    const before = await f.inspect(change);
    await Effect.runPromise(
      f.client.validateControl(id, change, before, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(id, change, token, before)
    );
    const body = f.writes[0]?.[2];
    expect(body).toMatchObject({
      activeStatus: 0,
      packPreheatingInfoVO: {
        packPreheatingSwitch: 1,
        packPreheatingVOList: [
          {
            chargingPower: null,
            dischargePower: null,
            duration: 15,
            periodConfig: [1],
            startTime: 60,
          },
        ],
        preheatingMode: null,
      },
      peakShavingVO: {
        controlMode: 1,
        settingList: [
          {
            endTime: "01:15",
            peakPower: 2.5,
            startTime: "01:00",
            whichDay: "1",
          },
        ],
        shavingSOC: 25,
      },
      profileId: 201,
    });
    f.data["custom"] = { ...profile, ...body, pvPriority: profile.pvPriority };
    expect(controlMatches(change, await f.inspect(change), before)).toBe(true);
  });
  it("accepts equivalent residential minute strings but refuses malformed minute values", async () => {
    const change = schedulesChange({
      preheating: { enabled: true, windows: [window] },
      timezone: "Europe/London",
    });
    const f = fixture();
    const before = await f.inspect(change);
    await Effect.runPromise(
      f.client.dispatchControl(id, change, token, before)
    );
    const body = f.writes[0]?.[2];
    const heating = {
      ...profile.packPreheatingInfoVO,
      packPreheatingSwitch: 1,
      packPreheatingVOList: [
        {
          chargingPower: null,
          dischargePower: null,
          duration: "15",
          periodConfig: [1],
          startTime: "60",
        },
      ],
    };
    f.data["custom"] = {
      ...profile,
      ...body,
      packPreheatingInfoVO: heating,
      pvPriority: profile.pvPriority,
    };
    expect(controlMatches(change, await f.inspect(change), before)).toBe(true);
    f.data["custom"] = {
      ...profile,
      ...body,
      packPreheatingInfoVO: {
        ...heating,
        packPreheatingVOList: [
          { ...heating.packPreheatingVOList[0], startTime: " 60" },
        ],
      },
      pvPriority: profile.pvPriority,
    };
    expect(controlMatches(change, await f.inspect(change), before)).toBe(false);
  });
  it.each([
    { timezone: "Europe/London" },
    { preheating: { enabled: true, windows: [] }, timezone: "Europe/London" },
    {
      preheating: { enabled: true, windows: [{ ...window, endTime: "00:15" }] },
      timezone: "Europe/London",
    },
    {
      preheating: { enabled: true, windows: [window, window] },
      timezone: "Europe/London",
    },
    {
      peakShaving: {
        enabled: true,
        reserveSocPercent: 20,
        slots: [{ ...window, peakPowerW: 2500, providerDays: "8" }],
      },
      timezone: "Europe/London",
    },
  ])("rejects malformed or overlapping schedules %j", (schedules) => {
    expect(() => schedulesChange(schedules)).toThrow();
  });
  it.each([
    { preheating: { enabled: false, windows: [] }, timezone: "Europe/Dublin" },
    {
      peakShaving: {
        enabled: true,
        reserveSocPercent: 19,
        slots: [{ ...window, peakPowerW: 2500 }],
      },
      timezone: "Europe/London",
    },
  ])(
    "rejects the wrong timezone or an unsafe reserve %j",
    async (schedules) => {
      const f = fixture();
      const change = schedulesChange(schedules);
      expect(
        await Effect.runPromise(
          f.client
            .validateControl(id, change, await f.inspect(change), token)
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "InvalidInput" } });
      expect(f.writes).toHaveLength(0);
    }
  );
  it.each(["set_energy_profile_priorities", "set_energy_profile_schedules"])(
    "requires inactive identity and binds approvals separately for %s",
    async (operation) => {
      const change =
        operation === "set_energy_profile_priorities"
          ? prioritiesChange({ batteryDischargeSources: ["grid", "pv"] })
          : schedulesChange({
              preheating: { enabled: false, windows: [] },
              timezone: "Europe/London",
            });
      expect(approvalScope(id, change)).toEqual({
        operation,
        profileId: 201,
        stationId: id,
      });
      await Promise.all(
        [
          { custom: { ...profile, activeStatus: 1, profileId: 201 } },
          {
            "/device/energy-profile/mode/current/12345": {
              currentMode: 9,
              currentProfileId: 201,
            },
          },
        ].map(async (overrides) => {
          const f = fixture(overrides);
          expect(
            await Effect.runPromise(
              f.client
                .validateControl(id, change, await f.inspect(change), token)
                .pipe(Effect.result)
            )
          ).toMatchObject({ failure: { reason: "Conflict" } });
          expect(f.writes).toHaveLength(0);
        })
      );
    }
  );
  it("refuses invented solar priorities, duplicates and grouped entries", async () => {
    const entry = {
      providerDeviceType: 4,
      providerLoadType: 1,
      providerPriority: 1,
      smartLoadPath: null,
    };
    await Promise.all(
      [
        [{ ...entry, providerPriority: 2 }],
        [entry, entry],
        [{ ...entry, providerLoadType: 3 }],
      ].map(async (solarPriority) => {
        const f = fixture();
        const change = prioritiesChange({ solarPriority });
        expect(
          await Effect.runPromise(
            f.client
              .validateControl(id, change, await f.inspect(change), token)
              .pipe(Effect.result)
          )
        ).toMatchObject({ failure: { reason: "InvalidInput" } });
      })
    );
  });
});

describe("saved solar priority membership", () => {
  const rows = [
    { ...profile.pvPriority[0], loadsType: 1, priority: 1 },
    { ...profile.pvPriority[0], loadsType: 3, priority: 2 },
    { ...profile.pvPriority[0], loadsType: 4, priority: 3, status: 2 },
  ];
  const change = prioritiesChange({
    solarPriority: [
      {
        providerDeviceType: 4,
        providerLoadType: 1,
        providerPriority: 2,
        smartLoadPath: null,
      },
      {
        providerDeviceType: 4,
        providerLoadType: 3,
        providerPriority: 1,
        smartLoadPath: null,
      },
      {
        providerDeviceType: 4,
        providerLoadType: 4,
        providerPriority: 3,
        smartLoadPath: null,
      },
    ],
  });
  it("changes only known priorities while preserving excluded rows and complete readback", async () => {
    const f = fixture({
      custom: { ...profile, profileId: 201, pvPriority: rows },
    });
    const before = await f.inspect(change);
    await Effect.runPromise(
      f.client.validateControl(id, change, before, token)
    );
    await Effect.runPromise(
      f.client.dispatchControl(id, change, token, before)
    );
    expect(f.writes[0]?.[2]).toMatchObject({
      pvPriority: [
        { loadsType: 1, priority: 2, sgDeviceType: 4, smartLoadsPath: null },
        { loadsType: 3, priority: 1, sgDeviceType: 4, smartLoadsPath: null },
        { loadsType: 4, priority: 3, sgDeviceType: 4, smartLoadsPath: null },
      ],
    });
    f.data["custom"] = {
      ...profile,
      profileId: 201,
      pvPriority: rows.map((row) => ({
        ...row,
        priority:
          new Map([
            [1, 2],
            [3, 1],
            [4, 3],
          ]).get(row.loadsType) ?? row.priority,
      })),
    };
    expect(controlMatches(change, await f.inspect(change), before)).toBe(true);
  });
  it.each(
    [
      rows.map((row) => ({ ...row, status: 2 })),
      rows.map((row) => ({ ...row, isGroup: true })),
      rows.map((row) => ({ ...row, status: 99 })),
    ].map((pvPriority) => ({ pvPriority }))
  )("refuses excluded/grouped/unknown row changes", async ({ pvPriority }) => {
    const f = fixture({ custom: { ...profile, profileId: 201, pvPriority } });
    expect(
      await Effect.runPromise(
        f.client
          .validateControl(id, change, await f.inspect(change), token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
  });
});
