import { DateTime, Option, Schema } from "effect";
import { absurd } from "effect/Function";

import { StationId, Timestamp } from "./model.js";

export const LocalDate = Schema.String.check(
  Schema.isPattern(/^20\d{2}-\d{2}-\d{2}$/u),
  Schema.makeFilter((value) => {
    const parsed = DateTime.make(`${value}T00:00:00Z`);
    return (
      Option.isSome(parsed) && DateTime.formatIsoDateUtc(parsed.value) === value
    );
  })
).pipe(Schema.brand("SigenLocalDate"));
export const HistoryInput = Schema.Struct({
  date: LocalDate,
  period: Schema.Literals(["day", "week", "month", "year"]),
  stationId: StationId,
});
export type HistoryInput = typeof HistoryInput.Type;
export const ForecastInput = Schema.Struct({
  date: LocalDate,
  period: Schema.Literals(["day", "week", "month"]),
  stationId: StationId,
});
export type ForecastInput = typeof ForecastInput.Type;

export const LocalSample = Schema.Struct({
  localTime: Schema.String,
  // A repeated wall-clock minute has two possible instants; a DST gap has none.
  utcCandidates: Schema.Array(Timestamp).check(Schema.isMaxLength(2)),
  value: Schema.NullOr(Schema.Finite),
});
const ChartSeries = Schema.Struct({
  providerSeries: Schema.String,
  providerUnit: Schema.String,
  samples: Schema.Array(LocalSample).check(Schema.isMaxLength(2000)),
  unit: Schema.Literals(["W", "Wh", "%", "provider_unit_unknown"]),
});
const ChartSnapshot = {
  endDate: LocalDate,
  fetchedAt: Timestamp,
  period: HistoryInput.fields.period,
  series: Schema.Array(ChartSeries),
  startDate: LocalDate,
  stationId: StationId,
  timezone: Schema.String,
};
export const EnergyHistory = Schema.Struct({
  ...ChartSnapshot,
  flows: Schema.Array(
    Schema.Struct({
      energyWh: Schema.NullOr(Schema.Finite),
      providerValue: Schema.Finite,
      source: Schema.String,
      target: Schema.String,
    })
  ),
  providerSignConvention: Schema.Literal("provider_series"),
  totals: Schema.Array(
    Schema.Struct({
      energyWh: Schema.NullOr(Schema.Finite),
      providerSeries: Schema.String,
      providerValue: Schema.Finite,
    })
  ),
});
export const Forecast = Schema.Struct({
  ...ChartSnapshot,
  availability: Schema.Literals(["available", "no_data"]),
  estimatedDate: Schema.String,
  providerStatus: Schema.Number,
});

/** Calendar ranges follow the app: Monday weeks, calendar months and years; end dates are inclusive. */
export const historyPeriod = (input: Pick<HistoryInput, "date" | "period">) => {
  const start = new Date(`${input.date}T00:00:00Z`);
  const end = new Date(start);
  switch (input.period) {
    case "day": {
      break;
    }
    case "week": {
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
      end.setTime(start.getTime());
      end.setUTCDate(end.getUTCDate() + 6);
      break;
    }
    case "month": {
      start.setUTCDate(1);
      end.setUTCMonth(end.getUTCMonth() + 1, 0);
      break;
    }
    case "year": {
      start.setUTCMonth(0, 1);
      end.setUTCMonth(11, 31);
      break;
    }
    default: {
      return absurd<never>(input.period);
    }
  }
  return {
    dateFlag: { day: 1, month: 3, week: 2, year: 4 }[input.period],
    endDate: end.toISOString().slice(0, 10),
    startDate: start.toISOString().slice(0, 10),
  };
};

export const localSampleTime = (
  providerTime: string,
  timeZone: DateTime.TimeZone.Named
) => {
  const localTime = `${providerTime.slice(0, 4)}-${providerTime.slice(4, 6)}-${providerTime.slice(6, 8)}T${providerTime.slice(9)}`;
  const candidates = (["earlier", "later"] as const).flatMap(
    (disambiguation) => {
      const parsed = DateTime.makeZoned(`${localTime}:00Z`, {
        adjustForTimeZone: true,
        disambiguation,
        timeZone,
      });
      return Option.isSome(parsed) &&
        DateTime.formatIsoZoned(parsed.value).slice(0, 16) === localTime
        ? [DateTime.toEpochMillis(parsed.value)]
        : [];
    }
  );
  return {
    localTime,
    utcCandidates: [...new Set(candidates)].toSorted(
      (left, right) => left - right
    ),
  };
};
