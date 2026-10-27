import { Clock, DateTime, Effect, Option, Schema } from "effect";
import type { Redacted } from "effect";

import { BackupHistory } from "./backup.js";
import type { BackupHistoryInput } from "./backup.js";
import { localTimeCandidates } from "./history.js";
import { failure } from "./model.js";
import { decodeProvider, readStationTimezone } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";

const ProviderLocalTime = Schema.String.check(
  Schema.isPattern(/^20\d{2}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d$/u),
  Schema.makeFilter((value) => {
    const local = value.replace(" ", "T");
    const parsed = DateTime.make(`${local}Z`);
    return (
      Option.isSome(parsed) &&
      DateTime.formatIso(parsed.value).slice(0, 19) === local
    );
  })
);
const Response = Schema.Struct({
  backupDetailNum: BackupHistory.fields.reportedEventCount,
  backupHistoryDetailVOIpage: Schema.Struct({
    current: BackupHistory.fields.page,
    pages: BackupHistory.fields.pages,
    records: Schema.Array(
      Schema.Struct({
        offGridDuration: BackupHistory.fields.totalDurationSeconds,
        offGridTime: ProviderLocalTime,
      })
    ).check(Schema.isMaxLength(100)),
    size: BackupHistory.fields.pageSize,
    total: BackupHistory.fields.total,
  }),
  totalTime: BackupHistory.fields.totalDurationSeconds,
});

export const makeBackupClient = (read: ProviderRead) => ({
  backupHistory: (
    input: BackupHistoryInput,
    token: Redacted.Redacted<string>
  ) =>
    Effect.gen(function* readBackupHistory() {
      const query = new URLSearchParams({
        current: String(input.page),
        size: String(input.pageSize),
        stationId: input.stationId,
      });
      const [data, zone] = yield* Effect.all(
        [
          read(`/data-process/station/backup-history?${query}`, token).pipe(
            Effect.flatMap(decodeProvider(Response))
          ),
          readStationTimezone(read, input.stationId, token),
        ],
        { concurrency: 2 }
      );
      const page = data.backupHistoryDetailVOIpage;
      if (
        page.current !== input.page ||
        page.size !== input.pageSize ||
        page.records.length > input.pageSize ||
        page.records.length >
          Math.max(0, page.total - (page.current - 1) * page.size) ||
        page.pages !== Math.ceil(page.total / page.size)
      ) {
        return yield* failure("SchemaMismatch");
      }
      return yield* decodeProvider(BackupHistory)({
        fetchedAt: yield* Clock.currentTimeMillis,
        page: page.current,
        pageSize: page.size,
        pages: page.pages,
        records: page.records.map((record) => {
          const local = record.offGridTime.replace(" ", "T");
          return {
            durationSeconds: record.offGridDuration,
            offGridLocalTime: local,
            offGridUtcCandidates: localTimeCandidates(local, zone),
          };
        }),
        reportedEventCount: data.backupDetailNum,
        stationId: input.stationId,
        timezone: DateTime.zoneToString(zone),
        total: page.total,
        totalDurationSeconds: data.totalTime,
      });
    }),
});
