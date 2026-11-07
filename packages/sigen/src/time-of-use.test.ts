import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { remainingResponses } from "./__fixtures__/remaining.js";
import { makeControlsClient } from "./controls-client.js";
import type { ProviderWrite } from "./controls-client.js";
import { ControlChange, approvalScope, controlMatches } from "./controls.js";
import { StationId } from "./model.js";
import { EnergyProfileFeatures } from "./profile.js";
import { makeTimeOfUseClient } from "./time-of-use.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("fixture");
const change = Schema.decodeUnknownSync(ControlChange)({
  operation: "activate_time_of_use_mode",
});
const row = {
  currType: 1,
  dischargeType: 0,
  endTime: "04:00",
  gridChargeCutOffSoc: "85",
  maxBuyPower: 3,
  startTime: "01:00",
  stationId: 12_345,
  whichDay: "1,2,3,4,5,6,7",
};
const slotsPath = "/device/dischargesetting/12345";
const configurationPath = "/device/setting/tou/12345";
const modePath = "/device/energy-profile/mode/current/12345";
const fixture = (overrides: Record<string, unknown> = {}) => {
  const writes: Parameters<ProviderWrite>[] = [];
  const data = {
    ...remainingResponses,
    "/device/energy-profile/mode/all/12345": {
      defaultWorkingModes: [{ label: "TOU", value: "2" }],
      energyProfileItems: [],
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
    [configurationPath]: { controlMode: 2, currType: 1, elecType: 1 },
    [modePath]: { currentMode: 1, currentProfileId: -1 },
    [slotsPath]: [row],
    ...overrides,
  } satisfies Record<string, unknown>;
  const read = (path: string) =>
    Effect.succeed(data[new URL(path, "https://fixture.invalid").pathname]);
  const client = makeControlsClient(read, (...args) =>
    Effect.sync(() => {
      writes.push(args);
    })
  );
  const inspect = () =>
    Effect.runPromise(client.inspectControl(id, change, token));
  return { client, data, inspect, settings: makeTimeOfUseClient(read), writes };
};

describe("reviewed time-of-use activation", () => {
  it("reviews the saved timetable and sends only the mode switch", async () => {
    const f = fixture();
    const before = await f.inspect();
    expect(before).toMatchObject({
      kind: "time_of_use",
      settings: {
        powerUnit: "kW",
        slots: [
          { gridChargeCutOffSoc: "85", maxBuyPower: 3, startTime: "01:00" },
        ],
        socUnit: "percent",
        timezone: "Europe/London",
      },
    });
    await Effect.runPromise(
      f.client.validateControl(id, change, before, token)
    );
    expect(approvalScope(id, change)).toEqual({
      operation: "activate_time_of_use_mode",
      stationId: id,
    });
    await Effect.runPromise(
      f.client.dispatchControl(id, change, token, before)
    );
    expect(f.writes[0]?.slice(0, 3)).toEqual([
      "PUT",
      "/device/energy-profile/mode",
      { fromPlatform: 1, operationMode: 2, profileId: -1, stationId: 12_345 },
    ]);
    expect(f.writes[0]?.[4]).toBe("boolean_true");
    f.data[modePath] = { currentMode: 2, currentProfileId: -1 };
    expect(controlMatches(change, await f.inspect(), before)).toBe(true);
    f.data[slotsPath] = [{ ...row, maxBuyPower: 5 }];
    expect(controlMatches(change, await f.inspect(), before)).toBe(false);
  });

  it.each([
    { [slotsPath]: [] },
    { [slotsPath]: null },
    {
      [slotsPath]: Array.from({ length: 25 }, (_, minute) => ({
        ...row,
        endTime: `01:${String(minute + 1).padStart(2, "0")}`,
        startTime: `01:${String(minute).padStart(2, "0")}`,
      })),
    },
    { [slotsPath]: [row, row] },
    { [slotsPath]: [{ ...row, dischargeType: 99 }] },
    { [slotsPath]: [{ ...row, gridChargeCutOffSoc: 150 }] },
    { [slotsPath]: [{ ...row, maxBuyPower: "unknown" }] },
    { [slotsPath]: [{ ...row, maxBuyPower: 1_000_001 }] },
    { [configurationPath]: { currType: 2 } },
    {
      [modePath]: { currentMode: 1, currentProfileId: -1, followPpcMode: true },
    },
  ])("refuses incomplete or unverified saved state", async (overrides) => {
    const f = fixture(overrides);
    const before = await f.inspect();
    expect(
      await Effect.runPromise(
        f.client.validateControl(id, change, before, token).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    expect(f.writes).toHaveLength(0);
  });

  it("refuses a timetable row belonging to a different station", async () => {
    const f = fixture({ [slotsPath]: [{ ...row, stationId: 12_346 }] });
    expect(
      await Effect.runPromise(
        f.settings.timeOfUseSettings(id, token).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "PermissionDenied" } });
  });
});
