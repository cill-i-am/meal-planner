import { Schema } from "effect";

// App 4.1.0 weekday picker: Monday=1 ... Sunday=7. End 24:00 is midnight at the end of that day.
export const ScheduleDays = Schema.String.check(
  Schema.isPattern(/^[1-7](?:,[1-7])*$/u),
  Schema.makeFilter(
    (days) => new Set(days.split(",")).size === days.split(",").length
  )
);
export const ScheduleWindow = Schema.Struct({
  endTime: Schema.String.check(
    Schema.isPattern(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/u)
  ),
  providerDays: ScheduleDays,
  startTime: Schema.String.check(
    Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
  ),
}).check(Schema.makeFilter((window) => window.startTime < window.endTime));
export type ScheduleWindow = typeof ScheduleWindow.Type;

/** Reject overlaps across all groups, including disabled groups; a later enable cannot introduce a collision. */
export const nonOverlappingWindows = (
  windows: readonly ScheduleWindow[]
): boolean =>
  windows.every((window, index) =>
    windows
      .slice(index + 1)
      .every(
        (other) =>
          !window.providerDays
            .split(",")
            .some((day) => other.providerDays.split(",").includes(day)) ||
          window.endTime <= other.startTime ||
          other.endTime <= window.startTime
      )
  );
