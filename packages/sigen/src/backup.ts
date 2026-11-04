import { Schema } from "effect";

import { LocalDate } from "./history.js";
import { StationId, Timestamp } from "./model.js";

const Count = Schema.Int.check(
  Schema.isBetween({ maximum: Number.MAX_SAFE_INTEGER, minimum: 0 })
);
export const BackupHistoryInput = Schema.Struct({
  page: Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 1 })),
  pageSize: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 })),
  stationId: StationId,
});
export type BackupHistoryInput = typeof BackupHistoryInput.Type;
export const BackupHistory = Schema.Struct({
  fetchedAt: Timestamp,
  page: BackupHistoryInput.fields.page,
  pageDurationSeconds: Count,
  pageSize: BackupHistoryInput.fields.pageSize,
  pages: Count,
  records: Schema.Array(
    Schema.Struct({
      durationSeconds: Count,
      offGridLocalTime: Schema.String,
      offGridUtcCandidates: Schema.Array(Timestamp).check(
        Schema.isMaxLength(2)
      ),
    })
  ).check(Schema.isMaxLength(100)),
  reportedEventCount: Count,
  stationId: StationId,
  timezone: Schema.String,
  total: Count,
});

export const BackupEventsInput = Schema.Struct({
  endDate: LocalDate,
  page: BackupHistoryInput.fields.page,
  startDate: LocalDate,
  stationId: StationId,
}).check(
  Schema.makeFilter(
    (input) =>
      input.endDate >= input.startDate &&
      Date.parse(`${input.endDate}T00:00:00Z`) -
        Date.parse(`${input.startDate}T00:00:00Z`) <=
        31 * 86_400_000
  )
);
export type BackupEventsInput = typeof BackupEventsInput.Type;
export const BackupEventMeasurement = Schema.Struct({
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  value: Schema.String.check(Schema.isMaxLength(1024)),
});
export const BackupEventMeasurements = Schema.Array(
  BackupEventMeasurement
).check(Schema.isMaxLength(128));
export const BackupEvents = Schema.Struct({
  endDate: LocalDate,
  fetchedAt: Timestamp,
  page: BackupHistoryInput.fields.page,
  pageSize: Schema.Literal(10),
  pages: Count,
  providerModelType: Schema.Int,
  records: Schema.Array(
    Schema.Struct({
      localTime: Schema.String,
      measurements: BackupEventMeasurements,
      providerBackupType: Schema.Int,
      providerReasonType: Schema.Int,
      utcCandidates: Schema.Array(Timestamp).check(Schema.isMaxLength(2)),
    })
  ).check(Schema.isMaxLength(10)),
  startDate: LocalDate,
  stationId: StationId,
  timezone: Schema.String,
  total: Count,
});
