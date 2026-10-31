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
