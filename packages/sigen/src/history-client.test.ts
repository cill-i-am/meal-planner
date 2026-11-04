import { DateTime, Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeHistoryClient } from "./history-client.js";
import {
  ForecastInput,
  HistoryInput,
  LocalDate,
  historyPeriod,
  localSampleTime,
} from "./history.js";

const token = Redacted.make("fixture");
const input = Schema.decodeUnknownSync(HistoryInput)({
  date: "2026-10-25",
  period: "day",
  stationId: "12345",
});
const samples = [
  { time: "20261025 00:00", value: 0 },
  { time: "20261025 01:30", value: null },
  { time: "20261025 02:00", value: -1.25 },
];
const history = {
  chartData: { dataSeries: [{ id: "GRID", points: samples }], unit: "kW" },
  sankeyData: {
    links: [{ sourceId: "FROM_GRID", targetId: "TO_LOAD", value: 2.5 }],
  },
  stationCards: [{ cardKey: "TO_LOAD", value: 2.5 }],
};
const forecast = {
  chartData: {
    dataSeries: [
      { id: "SOC_PREDICT", points: [{ time: "20261025 02:00", value: 45 }] },
      {
        id: "FROM_SOLAR_PREDICT",
        points: [{ time: "20261025 02:00", value: 2 }],
      },
      { id: "FUTURE_UNKNOWN", points: [{ time: "20261025 02:00", value: 3 }] },
    ],
    unit: "kW",
  },
  estimatedDate: "",
  status: 987,
};
const defaultStation = { stationId: 12_345, timeZoneName: "Europe/Dublin" };
type ProviderFixture = Readonly<Record<string, unknown>>;
const fixture = (
  response: ProviderFixture = history,
  station: ProviderFixture = defaultStation
) =>
  makeHistoryClient((path) =>
    Effect.succeed(path.includes("/owner/station/home") ? station : response)
  );

describe("history and forecast dates", () => {
  it("represents a valid empty forecast separately from malformed populated units", async () => {
    const empty = {
      chartData: { dataSeries: [], unit: "" },
      estimatedDate: "",
      status: 0,
    };
    const request = Schema.decodeUnknownSync(ForecastInput)(input);
    expect(
      await Effect.runPromise(fixture(empty).forecast(request, token))
    ).toMatchObject({ availability: "no_data", series: [] });
    const invalid = {
      ...forecast,
      chartData: { ...forecast.chartData, unit: "" },
    };
    expect(
      await Effect.runPromise(
        fixture(invalid).forecast(request, token).pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
  it("does not assign energy units to unfamiliar history series or cards", async () => {
    const unknown = {
      ...history,
      chartData: {
        ...history.chartData,
        dataSeries: [
          {
            id: "NEW_PERCENT",
            points: [{ time: "20261025 02:00", value: 45 }],
          },
        ],
      },
      stationCards: [{ cardKey: "NEW_CURRENCY", value: 3 }],
    };
    const result = await Effect.runPromise(
      fixture(unknown).energyHistory(input, token)
    );
    expect(result.series[0]).toMatchObject({
      providerSeries: "NEW_PERCENT",
      providerUnit: "kW",
      samples: [{ value: 45 }],
      unit: "provider_unit_unknown",
    });
    expect(result.totals).toEqual([
      { energyWh: null, providerSeries: "NEW_CURRENCY", providerValue: 3 },
    ]);
  });
  it.each([
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-01-00",
    "20261025",
    "../other",
  ])("rejects invalid calendar date %s", (value) =>
    expect(Schema.is(LocalDate)(value)).toBe(false)
  );
  it("uses inclusive calendar boundaries independent of DST and leap days", () => {
    expect(historyPeriod({ ...input, period: "week" })).toEqual({
      dateFlag: 2,
      endDate: "2026-10-25",
      startDate: "2026-10-19",
    });
    expect(
      historyPeriod({
        ...input,
        date: Schema.decodeUnknownSync(LocalDate)("2024-02-29"),
        period: "month",
      })
    ).toEqual({ dateFlag: 3, endDate: "2024-02-29", startDate: "2024-02-01" });
    expect(historyPeriod({ ...input, period: "year" })).toEqual({
      dateFlag: 4,
      endDate: "2026-12-31",
      startDate: "2026-01-01",
    });
  });
  it("returns both UTC candidates in the repeated Dublin hour and none in the spring gap", () => {
    const zone = DateTime.zoneMakeNamedUnsafe("Europe/Dublin");
    expect(
      localSampleTime("20261025 01:30", zone).utcCandidates.map((value) =>
        new Date(value).toISOString()
      )
    ).toEqual(["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]);
    expect(localSampleTime("20260329 01:30", zone).utcCandidates).toEqual([]);
    expect(
      localSampleTime("20260329 02:30", zone).utcCandidates.map((value) =>
        new Date(value).toISOString()
      )
    ).toEqual(["2026-03-29T01:30:00.000Z"]);
  });
  it("preserves missing samples, signs and series IDs while converting kW/kWh", async () => {
    const result = await Effect.runPromise(
      fixture().energyHistory(input, token)
    );
    expect(result.series[0]).toMatchObject({
      providerSeries: "GRID",
      samples: [{ value: 0 }, { value: null }, { value: -1250 }],
      unit: "W",
    });
    expect(result.series[0]?.samples).toHaveLength(3);
    expect(result.totals).toEqual([
      { energyWh: 2500, providerSeries: "TO_LOAD", providerValue: 2.5 },
    ]);
    expect(result.flows).toEqual([
      {
        energyWh: 2500,
        providerValue: 2.5,
        source: "FROM_GRID",
        target: "TO_LOAD",
      },
    ]);
    const monthly = fixture({
      ...history,
      chartData: { ...history.chartData, unit: "kWh" },
    });
    const monthResult = await Effect.runPromise(
      monthly.energyHistory({ ...input, period: "month" }, token)
    );
    expect(monthResult.series[0]).toMatchObject({ unit: "Wh" });
  });
  it("keeps forecast SOC in percent and unknown series uninterpreted", async () => {
    const result = await Effect.runPromise(
      fixture(forecast).forecast(
        Schema.decodeUnknownSync(ForecastInput)(input),
        token
      )
    );
    expect(result.providerStatus).toBe(987);
    expect(
      result.series.map((series) => [series.unit, series.samples[0]?.value])
    ).toEqual([
      ["%", 45],
      ["W", 2000],
      ["provider_unit_unknown", 3],
    ]);
  });
  it("rejects unit drift, invalid zones and another station", async () => {
    expect(
      await Effect.runPromise(
        fixture({
          ...history,
          chartData: { ...history.chartData, unit: "kWh" },
        })
          .energyHistory(input, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
    expect(
      await Effect.runPromise(
        fixture(history, { stationId: 12_345, timeZoneName: "INVALID" })
          .energyHistory(input, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
    expect(
      await Effect.runPromise(
        fixture(history, { stationId: 54_321, timeZoneName: "Europe/Dublin" })
          .energyHistory(input, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "PermissionDenied" },
    });
  });
});
