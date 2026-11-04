import { Clock, DateTime, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import {
  EnergyHistory,
  Forecast,
  LocalDate,
  StationIncome,
  historyPeriod,
  localSampleTime,
} from "./history.js";
import type { ForecastInput, HistoryInput, IncomeInput } from "./history.js";
import { failure } from "./model.js";
import { decodeProvider, readStationTimezone } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";

const SampleTime = Schema.String.check(
  Schema.isPattern(/^20\d{6} (?:[01]\d|2[0-3]):[0-5]\d$/u),
  Schema.makeFilter((value) =>
    Schema.is(LocalDate)(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    )
  )
);
const Series = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    points: Schema.Array(
      Schema.Struct({ time: SampleTime, value: Schema.NullOr(Schema.Finite) })
    ).check(Schema.isMaxLength(2000)),
  })
).check(Schema.isMaxLength(32));
const Chart = Schema.Struct({
  dataSeries: Series,
  unit: Schema.Literals(["kW", "kWh"]),
});
const IncomeResponse = Schema.Struct({
  avgIncome: Schema.Finite,
  incomeList: Schema.Array(
    Schema.Struct({
      calculateIncome: Schema.NullOr(Schema.Finite),
      income: Schema.NullOr(Schema.Finite),
      time: SampleTime,
    })
  ).check(Schema.isMaxLength(2000)),
  stationId: Schema.Number,
  theLeast: Schema.Finite,
  theMost: Schema.Finite,
  totalIncome: Schema.Finite,
});
const HistoryResponse = Schema.Struct({
  chartData: Chart,
  sankeyData: Schema.Struct({
    links: Schema.Array(
      Schema.Struct({
        sourceId: Schema.String,
        targetId: Schema.String,
        value: Schema.Finite,
      })
    ),
  }),
  stationCards: Schema.Array(
    Schema.Struct({ cardKey: Schema.String, value: Schema.Finite })
  ),
});
const ForecastChart = Schema.Struct({
  dataSeries: Series,
  unit: Schema.Literals(["", "kW", "kWh"]),
}).check(
  Schema.makeFilter(
    (value) => value.unit !== "" || value.dataSeries.length === 0
  )
);
const ForecastResponse = Schema.Struct({
  chartData: ForecastChart,
  estimatedDate: Schema.String,
  status: Schema.Number,
});
const ForecastPowerSeries = new Set([
  "FROM_SOLAR_PREDICT",
  "FROM_SIGEN_SOLAR_PREDICT",
  "GRID_PREDICT",
  "TO_LOAD_PREDICT",
  "BATTERY_PREDICT",
  "TO_EVDC_EVAC_LOAD_PREDICT",
  "FROM_GRID_PREDICT",
  "FROM_BATTERY_PREDICT",
  "TO_BATTERY_PREDICT",
  "TO_GRID_PREDICT",
]);

const EnergySeries = new Set([
  "FROM_SOLAR",
  "FROM_BATTERY",
  "TO_BATTERY",
  "FROM_GRID",
  "TO_GRID",
  "TO_LOAD",
]);
const HistorySeries = new Set([...EnergySeries, "BATTERY", "GRID"]);

export const makeHistoryClient = (read: ProviderRead) => {
  const chart = (
    data: typeof ForecastChart.Type,
    zone: DateTime.TimeZone.Named,
    predicted: boolean
  ) =>
    data.dataSeries.map((series) => {
      const knownPower = predicted
        ? ForecastPowerSeries.has(series.id)
        : HistorySeries.has(series.id);
      const seriesUnit = () => {
        if (predicted && series.id === "SOC_PREDICT") {
          return "%";
        }
        if (!knownPower) {
          return "provider_unit_unknown";
        }
        return data.unit === "kW" ? "W" : "Wh";
      };
      const unit = seriesUnit();
      return {
        providerSeries: series.id,
        providerUnit: data.unit,
        samples: series.points.map((point) => ({
          ...localSampleTime(point.time, zone),
          value:
            point.value === null
              ? null
              : point.value * (unit === "W" || unit === "Wh" ? 1000 : 1),
        })),
        unit,
      };
    });
  return {
    energyHistory: (input: HistoryInput, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readEnergyHistory() {
        const period = historyPeriod(input);
        const query = new URLSearchParams({
          dateFlag: String(period.dateFlag),
          endDate: period.endDate.replaceAll("-", ""),
          startDate: period.startDate.replaceAll("-", ""),
          stationId: input.stationId,
        });
        const [data, zone] = yield* Effect.all(
          [
            read(
              `/data-process/sigen/station/statistics/v1/energy?${query}`,
              token
            ).pipe(Effect.flatMap(decodeProvider(HistoryResponse))),
            readStationTimezone(read, input.stationId, token),
          ],
          { concurrency: 2 }
        );
        if (data.chartData.unit !== (input.period === "day" ? "kW" : "kWh")) {
          return yield* failure("SchemaMismatch");
        }
        return yield* decodeProvider(EnergyHistory)({
          endDate: period.endDate,
          fetchedAt: yield* Clock.currentTimeMillis,
          flows: data.sankeyData.links.map((link) => ({
            energyWh:
              EnergySeries.has(link.sourceId) && EnergySeries.has(link.targetId)
                ? link.value * 1000
                : null,
            providerValue: link.value,
            source: link.sourceId,
            target: link.targetId,
          })),
          period: input.period,
          providerSignConvention: "provider_series",
          series: chart(data.chartData, zone, false),
          startDate: period.startDate,
          stationId: input.stationId,
          timezone: DateTime.zoneToString(zone),
          totals: data.stationCards.map((card) => ({
            energyWh: EnergySeries.has(card.cardKey) ? card.value * 1000 : null,
            providerSeries: card.cardKey,
            providerValue: card.value,
          })),
        });
      }),
    forecast: (input: ForecastInput, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readForecast() {
        const period = historyPeriod(input);
        const query = new URLSearchParams({
          dateFlag: String(period.dateFlag),
          endDate: period.endDate.replaceAll("-", ""),
          startDate: period.startDate.replaceAll("-", ""),
          stationId: input.stationId,
        });
        const [data, zone] = yield* Effect.all(
          [
            read(
              `/data-process/sigen/station/ai/all/prediction/v1?${query}`,
              token
            ).pipe(Effect.flatMap(decodeProvider(ForecastResponse))),
            readStationTimezone(read, input.stationId, token),
          ],
          { concurrency: 2 }
        );
        return yield* decodeProvider(Forecast)({
          availability:
            data.chartData.dataSeries.length === 0 ? "no_data" : "available",
          endDate: period.endDate,
          estimatedDate: data.estimatedDate,
          fetchedAt: yield* Clock.currentTimeMillis,
          period: input.period,
          providerStatus: data.status,
          series: chart(data.chartData, zone, true),
          startDate: period.startDate,
          stationId: input.stationId,
          timezone: DateTime.zoneToString(zone),
        });
      }),
    stationIncome: (input: IncomeInput, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readStationIncome() {
        const date = input.date.replaceAll("-", "");
        const query = new URLSearchParams({
          dateFlag: "1",
          endDate: date,
          fulfill: "false",
          startDate: date,
          stationId: input.stationId,
        });
        const [data, station] = yield* Effect.all(
          [
            read(
              `/data-process/sigen/station/statistics/income?${query}`,
              token
            ).pipe(Effect.flatMap(decodeProvider(IncomeResponse))),
            read(
              `/device/owner/station/home?stationId=${input.stationId}`,
              token
            ).pipe(
              Effect.flatMap(
                decodeProvider(
                  Schema.Struct({
                    currencyCode: Schema.String,
                    stationId: Schema.Number,
                    timeZoneName: Schema.String,
                  })
                )
              )
            ),
          ],
          { concurrency: 2 }
        );
        if (
          String(data.stationId) !== input.stationId ||
          String(station.stationId) !== input.stationId
        ) {
          return yield* failure("PermissionDenied");
        }
        if (
          data.incomeList.some((sample) => sample.time.slice(0, 8) !== date)
        ) {
          return yield* failure("SchemaMismatch");
        }
        const zone = yield* DateTime.zoneMakeNamedEffect(
          station.timeZoneName
        ).pipe(Effect.mapError(() => failure("SchemaMismatch")));
        return yield* decodeProvider(StationIncome)({
          currencySymbol: station.currencyCode,
          date: input.date,
          fetchedAt: yield* Clock.currentTimeMillis,
          providerAverage: data.avgIncome,
          providerMaximum: data.theMost,
          providerMinimum: data.theLeast,
          providerTotal: data.totalIncome,
          samples: data.incomeList.map((sample) => ({
            ...localSampleTime(sample.time, zone),
            calculatedIncome: sample.calculateIncome,
            income: sample.income,
          })),
          stationId: input.stationId,
          timezone: DateTime.zoneToString(zone),
        });
      }),
  };
};
