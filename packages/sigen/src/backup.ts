import { Schema } from "effect";

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
  totalDurationSeconds: Count,
});
