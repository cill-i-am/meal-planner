import { Schema } from "effect";

import type {
  LoadAutoSettings,
  LoadReadyWindow,
  LoadTouWindow,
} from "./load-settings.js";
import { Percent } from "./model.js";
import {
  ScheduleDays,
  ScheduleWindow,
  nonOverlappingWindows,
} from "./schedules.js";

const minutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const SocPercent = Percent.check(Schema.isMultipleOf(0.1));
const Consumption = Schema.Union([
  Schema.Struct({
    batteryBoost: Schema.Boolean,
    mode: Schema.Literals(["system", "solar_only"]),
  }),
  Schema.Struct({
    lowerSocPercent: SocPercent,
    mode: Schema.Literal("battery_only"),
    upperSocPercent: SocPercent,
  }).check(
    Schema.makeFilter((value) => value.lowerSocPercent < value.upperSocPercent)
  ),
]);
const TimedWindow = Schema.Struct({
  ...ScheduleWindow.fields,
  consumption: Consumption,
  enabled: Schema.Boolean,
}).check(Schema.makeFilter((value) => value.startTime < value.endTime));
const ReadyBy = Schema.Struct({
  durationMinutes: Schema.Int.check(
    Schema.isBetween({ maximum: 1440, minimum: 1 })
  ),
  enabled: Schema.Boolean,
  endTime: ScheduleWindow.fields.endTime,
  providerDays: ScheduleDays,
}).check(
  Schema.makeFilter((value) => value.durationMinutes <= minutes(value.endTime))
);
const Watts = Schema.Natural;
const SolarThresholds = Schema.Struct({
  ratedPowerW: Watts,
  startingPowerW: Watts,
});

export const LoadSchedule = Schema.Struct({
  readyBy: Schema.Array(ReadyBy).check(Schema.isMaxLength(3)),
  solar: Schema.NullOr(SolarThresholds),
  timed: Schema.Array(TimedWindow).check(Schema.isMaxLength(5)),
  timezone: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
}).check(
  Schema.makeFilter((schedule) => {
    const readyDays = schedule.readyBy.flatMap((row) =>
      row.providerDays.split(",")
    );
    // Keep ready-by independent of timed rows until the provider's precedence is known.
    return (
      new Set(readyDays).size === readyDays.length &&
      schedule.timed.every((row) =>
        row.providerDays.split(",").every((day) => !readyDays.includes(day))
      ) &&
      nonOverlappingWindows(schedule.timed) &&
      (schedule.solar !== null) ===
        schedule.timed.some((row) => row.consumption.mode === "solar_only")
    );
  })
);
export type LoadSchedule = typeof LoadSchedule.Type;

const timedRow = (row: typeof TimedWindow.Type) => {
  const { consumption } = row;
  const battery = consumption.mode === "battery_only";
  const start = minutes(row.startTime);
  return {
    autoCharge: !battery && consumption.batteryBoost ? 1 : 0,
    consumptionMode: { battery_only: 2, solar_only: 1, system: 0 }[
      consumption.mode
    ],
    duration: minutes(row.endTime) - start,
    periodConfig: row.providerDays.split(",").map(Number),
    socMode: battery
      ? {
          socLowerLimit: consumption.lowerSocPercent,
          socUpperLimit: consumption.upperSocPercent,
        }
      : { socLowerLimit: 15, socUpperLimit: 50 },
    startTime: String(start),
    touEnable: row.enabled ? 1 : 0,
  };
};
const readyRow = (row: typeof ReadyBy.Type) => ({
  duration: String(row.durationMinutes),
  endTime: String(minutes(row.endTime)),
  periodConfig: row.providerDays.split(",").map(Number),
  smartSaveEnable: row.enabled ? 1 : 0,
});
export const providerLoadSchedule = (
  schedule: LoadSchedule,
  before: typeof LoadAutoSettings.Type | null
) => ({
  pvExcessParams:
    schedule.solar === null
      ? null
      : {
          minRunTime: before?.pvExcessParams?.minRunTime ?? null,
          ratePower: schedule.solar.ratedPowerW / 1000,
          startPower: schedule.solar.startingPowerW / 1000,
        },
  schedule: {
    smartSavePointParamsList: schedule.readyBy.map(readyRow),
    touPointParamsList: schedule.timed.map(timedRow),
  },
});

// Provider readback uses both numbers and decimal strings. Null and malformed values never compare as zero.
const decimal = (value: string | number | null) =>
  value !== null && /^\d+(?:\.\d+)?$/u.test(String(value))
    ? Number(value)
    : null;
const sameDays = (
  observed: readonly number[] | null,
  expected: readonly number[]
) =>
  observed !== null &&
  observed.length === expected.length &&
  new Set(observed).size === observed.length &&
  expected.every((day) => observed.includes(day));
const sameSoc = (
  observed: typeof LoadTouWindow.Type,
  expected: ReturnType<typeof timedRow>
) => {
  const { socMode } = observed;
  if (
    expected.consumptionMode !== 2 &&
    (socMode === null ||
      (socMode.socLowerLimit === null && socMode.socUpperLimit === null))
  ) {
    return true;
  }
  return (
    socMode !== null &&
    decimal(socMode.socLowerLimit) === expected.socMode.socLowerLimit &&
    decimal(socMode.socUpperLimit) === expected.socMode.socUpperLimit
  );
};
const sameTimed = (
  observed: typeof LoadTouWindow.Type,
  expected: ReturnType<typeof timedRow>
) =>
  decimal(observed.autoCharge) === expected.autoCharge &&
  decimal(observed.consumptionMode) === expected.consumptionMode &&
  decimal(observed.duration) === expected.duration &&
  decimal(observed.startTime) === Number(expected.startTime) &&
  decimal(observed.touEnable) === expected.touEnable &&
  sameDays(observed.periodConfig, expected.periodConfig) &&
  sameSoc(observed, expected);
const sameReady = (
  observed: typeof LoadReadyWindow.Type,
  expected: ReturnType<typeof readyRow>
) =>
  decimal(observed.duration) === Number(expected.duration) &&
  decimal(observed.endTime) === Number(expected.endTime) &&
  decimal(observed.smartSaveEnable) === expected.smartSaveEnable &&
  sameDays(observed.periodConfig, expected.periodConfig);
const sameSolar = (
  observed: typeof LoadAutoSettings.Type.pvExcessParams,
  expected: ReturnType<typeof providerLoadSchedule>["pvExcessParams"]
) => {
  if (observed === null || expected === null) {
    return observed === expected;
  }
  return (
    observed.minRunTime === expected.minRunTime &&
    decimal(observed.ratePower) === expected.ratePower &&
    decimal(observed.startPower) === expected.startPower
  );
};

export const loadScheduleMatches = (
  schedule: LoadSchedule,
  observed: typeof LoadAutoSettings.Type | null,
  before: typeof LoadAutoSettings.Type | null
) => {
  if (
    observed === null ||
    observed.touPointParamsList === null ||
    observed.smartSavePointParamsList === null
  ) {
    return false;
  }
  const { smartSavePointParamsList: ready, touPointParamsList: timed } =
    observed;
  const expected = providerLoadSchedule(schedule, before);
  const { smartSavePointParamsList, touPointParamsList } = expected.schedule;
  // Row order is immaterial in this contract because validated rows cannot overlap.
  return (
    timed.length === touPointParamsList.length &&
    ready.length === smartSavePointParamsList.length &&
    touPointParamsList.every((row) =>
      timed.some((entry) => sameTimed(entry, row))
    ) &&
    smartSavePointParamsList.every((row) =>
      ready.some((entry) => sameReady(entry, row))
    ) &&
    sameSolar(observed.pvExcessParams, expected.pvExcessParams)
  );
};
