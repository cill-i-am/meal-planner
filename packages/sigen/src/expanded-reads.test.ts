import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { expandedResponses, loadControl } from "./__fixtures__/expanded.js";
import { makeChargingClient } from "./charging-client.js";
import { ChargerInput } from "./charging.js";
import { makeConsumptionClient } from "./consumption-client.js";
import { HistoryInput } from "./history.js";
import { makeLoadSettingsClient } from "./load-settings-client.js";
import { SmartLoadHistoryInput } from "./load-settings.js";
import { SmartLoadInput } from "./loads.js";
import { StationId } from "./model.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("synthetic");
const ac = Schema.decodeUnknownSync(ChargerInput)({
  kind: "ac",
  serialNumber: "AC-1",
  stationId: id,
});
const dc = Schema.decodeUnknownSync(ChargerInput)({
  kind: "dc",
  serialNumber: "DC-1",
  stationId: id,
});
const load = Schema.decodeUnknownSync(SmartLoadInput)({
  loadPath: 1,
  stationId: id,
});
const history = Schema.decodeUnknownSync(HistoryInput)({
  date: "2026-10-28",
  period: "week",
  stationId: id,
});
const loadHistory = Schema.decodeUnknownSync(SmartLoadHistoryInput)({
  ...history,
  loadPath: 1,
});
const fixture = (overrides: Record<string, unknown> = {}) => {
  const calls: URL[] = [];
  const responses = { ...expandedResponses, ...overrides };
  const read = (path: string) =>
    Effect.sync(() => {
      const url = new URL(path, "https://fixture.invalid");
      calls.push(url);
      return responses[url.pathname];
    });
  return {
    calls,
    client: {
      ...makeChargingClient(read),
      ...makeConsumptionClient(read),
      ...makeLoadSettingsClient(read),
    },
  };
};
const home = { acSnList: ["AC-1"], dcSnList: ["DC-1"], stationId: 12_345 };

describe("membership-checked charger reads", () => {
  it("reads both kinds through their own device routes and retains unknown mode codes", async () => {
    const f = fixture({
      "/device/charge/mode/ac": {
        chargeMode: 91,
        cutoffSocFromPack: null,
        enableFromGrid: null,
        enableFromPack: false,
        socLowerLimit: null,
        socUpperLimit: 0,
      },
    });
    expect(await Effect.runPromise(f.client.chargers(id, token))).toMatchObject(
      {
        ac: { availability: "known", serialNumbers: ["AC-1"] },
        dc: { availability: "known", serialNumbers: ["DC-1"] },
      }
    );
    expect(
      await Effect.runPromise(f.client.chargerStatus(ac, token))
    ).toMatchObject({
      fromBatteryEnabled: false,
      fromGridEnabled: null,
      pluggedIn: true,
      providerChargeMode: 91,
      upperSocPercent: 0,
    });
    expect(
      await Effect.runPromise(f.client.chargerStatus(dc, token))
    ).toMatchObject({ pluggedIn: false, providerChargeMode: 3 });
    expect(
      f.calls
        .filter((url) => url.pathname.includes("/plug/status"))
        .map((url) => url.searchParams.get("snCode"))
    ).toEqual(["AC-1", "DC-1"]);
  });
  it.each([
    [{ ...home, acSnList: [] }, "UnsupportedCapability"],
    [{ ...home, acSnList: null }, "UnsupportedCapability"],
    [{ ...home, acSnList: ["OTHER"] }, "PermissionDenied"],
    [{ ...home, stationId: 98_765 }, "PermissionDenied"],
    [{ ...home, acSnList: ["AC-1", "AC-1"] }, "SchemaMismatch"],
  ])(
    "refuses a device request when inventory is %j",
    async (inventory, reason) => {
      const f = fixture({ "/device/owner/station/home": inventory });
      expect(
        await Effect.runPromise(
          f.client.chargerStatus(ac, token).pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason } });
      expect(f.calls).toHaveLength(1);
    }
  );
  it("distinguishes unknown inventory from a known empty inventory", async () => {
    const f = fixture({
      "/device/owner/station/home": { ...home, acSnList: null, dcSnList: [] },
    });
    expect(await Effect.runPromise(f.client.chargers(id, token))).toMatchObject(
      {
        ac: { availability: "unknown", serialNumbers: [] },
        dc: { availability: "known", serialNumbers: [] },
      }
    );
  });
  it.each([
    [-1, { kind: "unset" }],
    [null, { kind: "unknown" }],
    [0, { kind: "amperes", value: 0 }],
    [16, { kind: "amperes", value: 16 }],
  ])("preserves AC current state %j", async (lastSetCurrent, expected) => {
    const f = fixture({
      "/device/acevse/charge/read/current": {
        dlmStatus: 99,
        lastSetCurrent,
        maxCurrent: null,
      },
    });
    expect(
      await Effect.runPromise(f.client.acChargerCurrent(ac, token))
    ).toMatchObject({
      lastSetCurrent: expected,
      maximumAmperes: null,
      providerDlmStatus: 99,
    });
  });
  it("does not invent DC power units or accept wrong equipment kinds", async () => {
    const f = fixture();
    expect(
      await Effect.runPromise(f.client.dcChargerSettings(dc, token))
    ).toMatchObject({
      chargeCutoffSocPercent: 80,
      powerUnit: "provider_unit_unverified",
      providerAllowedChargePower: 12,
    });
    const count = f.calls.length;
    expect(
      await Effect.runPromise(
        f.client.dcChargerSettings(ac, token).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
    expect(
      await Effect.runPromise(
        f.client.acChargerCurrent(dc, token).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
    expect(f.calls).toHaveLength(count);
  });
});
describe("smart-load settings and consumption", () => {
  it("retains unknown codes, nulls, and both grids without inferring writability", async () => {
    const f = fixture({
      "/device/tp-device/smart-loads/control-mode": {
        ...loadControl,
        controlMode: 97,
        manualModeSwitch: null,
      },
    });
    const settings = await Effect.runPromise(
      f.client.smartLoadControlSettings(load, token)
    );
    expect(settings).toMatchObject({
      offGrid: { socInThreshold: 60, socOutThreshold: 40 },
      onGrid: {
        autoModeParams: {
          touPointParamsList: [{ duration: 15, periodConfig: [1] }],
        },
        controlMode: 97,
        manualModeSwitch: null,
      },
      timezone: "Europe/London",
    });
  });
  it("rejects another load's off-grid settings", async () => {
    const f = fixture({
      "/third-party-device/tp-device/smart-loads/control-mode/auto/off-grid": {
        backupSoc: 20,
        chargeStopSoc: 100,
        loadOffGridSocEnable: null,
        loadPath: 2,
        offGridControlMode: 1,
        socInThreshold: 60,
        socOutThreshold: 40,
      },
    });
    expect(
      await Effect.runPromise(
        f.client.smartLoadControlSettings(load, token).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "PermissionDenied" } });
  });
  it("uses the member's provider id and a bounded calendar period, retaining zero and missing samples", async () => {
    const f = fixture();
    expect(
      await Effect.runPromise(f.client.smartLoadConsumption(loadHistory, token))
    ).toMatchObject({
      endDate: "2026-11-01",
      month: null,
      samples: [
        { providerTime: "01:00", value: 0 },
        { providerTime: "01:15", value: null },
      ],
      startDate: "2026-10-26",
      today: 0,
      unit: "provider_unit_unverified",
    });
    const query = f.calls.find((url) =>
      url.pathname.endsWith("/load-consumption")
    )?.searchParams;
    expect(query?.get("smartLoadId")).toBe("20001");
    expect(query?.get("startDate")).toBe("20261026");
    expect(query?.get("endDate")).toBe("20261101");
  });
  it("stops before device calls for absent loads", async () => {
    const f = fixture({ "/device/tp-device/smart-loads/list": [] });
    expect(
      await Effect.runPromise(
        f.client.smartLoadConsumption(loadHistory, token).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    expect(f.calls).toHaveLength(1);
  });
  it("rejects a foreign station response and malformed sample values", async () => {
    await Promise.all(
      [
        {
          consumptionDetailList: [],
          lifetimeConsumption: 0,
          monthConsumption: 0,
          stationId: 98_765,
          todayConsumption: 0,
          totalConsumption: 0,
        },
        {
          consumptionDetailList: [
            { dataTime: "01:00", loadConsumption: "bad" },
          ],
          lifetimeConsumption: 0,
          monthConsumption: 0,
          stationId: 12_345,
          todayConsumption: 0,
          totalConsumption: 0,
        },
      ].map(async (response) => {
        const f = fixture({
          "/data-process/sigen/station/statistics/load-consumption": response,
        });
        expect(
          await Effect.runPromise(
            f.client
              .smartLoadConsumption(loadHistory, token)
              .pipe(Effect.result)
          )
        ).toMatchObject({
          failure: {
            reason:
              response.stationId === 98_765
                ? "PermissionDenied"
                : "SchemaMismatch",
          },
        });
      })
    );
  });
});
describe("station consumption breakdown", () => {
  it("keeps negative, zero and null readings distinct without claiming units", async () => {
    const f = fixture();
    expect(
      await Effect.runPromise(f.client.stationConsumption(history, token))
    ).toMatchObject({
      baseLoad: 0,
      otherLoads: [{ providerLoadId: "20001", value: null }],
      samples: [
        { baseLoad: -1, otherLoads: [{ providerLoadId: "20001", value: 2 }] },
      ],
      unit: "provider_unit_unverified",
    });
  });
  it.each([
    [null, "SchemaMismatch"],
    [
      {
        baseLoadConsumption: null,
        consumptionDetailList: null,
        otherLoadConsumptionList: null,
        stationId: 98_765,
      },
      "PermissionDenied",
    ],
    [
      {
        baseLoadConsumption: null,
        consumptionDetailList: null,
        otherLoadConsumptionList: { bad: 1 },
        stationId: 12_345,
      },
      "SchemaMismatch",
    ],
  ])(
    "fails explicitly for unsupported or foreign payload %j",
    async (data, reason) => {
      const f = fixture({
        "/data-process/sigen/station/statistics/station-consumption": data,
      });
      expect(
        await Effect.runPromise(
          f.client.stationConsumption(history, token).pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason } });
    }
  );
});

describe("charger schedule summaries and AC settings", () => {
  it("preserves overnight schedule codes without interpreting omitted thermal settings", async () => {
    const f = fixture();
    expect(
      await Effect.runPromise(f.client.chargerSchedules(ac, token))
    ).toMatchObject({
      powerUnit: "provider_unit_unverified",
      schedules: [
        {
          endTime: "02:00",
          id: 3,
          nextDay: true,
          providerDays: "1,2,3,4,5",
          providerMaxGridPower: 7,
          startTime: "23:00",
        },
      ],
      timezone: "Europe/London",
    });
    expect(
      await Effect.runPromise(f.client.chargerSchedules(dc, token))
    ).toMatchObject({ schedules: [] });
  });
  it("preserves null schedules and unfamiliar electrical codes", async () => {
    const f = fixture({
      "/device/acevse/more-setting/12345": {
        chargingOutputCurrent: null,
        dlmStatus: 99,
        homeCircuitBreaker: 0,
        isSupportThreePhase: false,
        meterPhase: null,
        offGridCharge: null,
        phaseAutoSwitch: null,
        phaseType: 91,
        pileCircuitBreaker: null,
        runStatus: 90,
      },
      "/device/acevse/schedule/list/12345": null,
    });
    expect(
      await Effect.runPromise(f.client.chargerSchedules(ac, token))
    ).toMatchObject({ schedules: null });
    expect(
      await Effect.runPromise(f.client.acChargerSettings(ac, token))
    ).toMatchObject({
      providerChargingOutputCurrent: null,
      providerDlmStatus: 99,
      providerHomeCircuitBreaker: 0,
      providerPhaseType: 91,
      supportsThreePhase: false,
    });
    const count = f.calls.length;
    expect(
      await Effect.runPromise(
        f.client.acChargerSettings(dc, token).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "InvalidInput" } });
    expect(f.calls).toHaveLength(count);
  });
});
