import { Clock, DateTime, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import { BackupEvents, BackupEventMeasurement } from "./backup.js";
import type { BackupEventsInput } from "./backup.js";
import { LocalDate, localTimeCandidates } from "./history.js";
import { failure } from "./model.js";
import {
  ProviderLocalTimestamp,
  decodeProvider,
  readStationTimezone,
} from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";

// Rich multi-phase and extra-device detail shapes have not been observed. They are only checked
// for emptiness below; their untrusted contents never enter a domain result or public response.
const UnobservedDetails = Schema.Array(Schema.Unknown).check(
  Schema.isMaxLength(64)
);
const Event = Schema.Struct({
  backupType: Schema.Int,
  extraDeviceInfoList: UnobservedDetails,
  phaseInfoVOList: UnobservedDetails,
  reasonType: Schema.Int,
  signalPhaseInfoVOList: Schema.Array(
    Schema.Struct({
      paramKey: BackupEventMeasurement.fields.label,
      paramValue: BackupEventMeasurement.fields.value,
    })
  ).check(Schema.isMaxLength(128)),
  time: ProviderLocalTimestamp,
});
const Response = Schema.Struct({
  backupHistoryDetailVOIpage: Schema.Struct({
    current: BackupEvents.fields.page,
    pages: BackupEvents.fields.pages,
    records: Schema.Array(Event).check(Schema.isMaxLength(10)),
    size: BackupEvents.fields.pageSize,
    total: BackupEvents.fields.total,
  }),
  endTime: LocalDate,
  filterItems: Schema.Tuple([]),
  modelTypeCode: Schema.Int,
  startTime: LocalDate,
});
export const makeBackupEventsClient = (read: ProviderRead) => ({
  backupEvents: (input: BackupEventsInput, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readBackupEvents() {
      const query = new URLSearchParams({
        current: String(input.page),
        endTime: input.endDate,
        filterItems: "",
        startTime: input.startDate,
        stationId: input.stationId,
      });
      const [data, zone] = yield* Effect.all(
        [
          read(`/data-process/station/backup-event?${query}`, token).pipe(
            Effect.flatMap(decodeProvider(Response))
          ),
          readStationTimezone(read, input.stationId, token),
        ],
        { concurrency: 2 }
      );
      const page = data.backupHistoryDetailVOIpage;
      if (
        data.startTime !== input.startDate ||
        data.endTime !== input.endDate ||
        page.current !== input.page ||
        page.pages !== Math.ceil(page.total / page.size) ||
        page.records.length >
          Math.max(0, page.total - (page.current - 1) * page.size) ||
        page.records.some(
          (event) =>
            event.time.slice(0, 10) < input.startDate ||
            event.time.slice(0, 10) > input.endDate
        )
      ) {
        return yield* failure("SchemaMismatch");
      }
      if (
        page.records.some(
          (event) =>
            event.phaseInfoVOList.length > 0 ||
            event.extraDeviceInfoList.length > 0
        )
      ) {
        return yield* failure("UnsupportedCapability");
      }
      return yield* decodeProvider(BackupEvents)({
        endDate: data.endTime,
        fetchedAt: yield* Clock.currentTimeMillis,
        page: page.current,
        pageSize: page.size,
        pages: page.pages,
        providerModelType: data.modelTypeCode,
        records: page.records.map((event) => {
          const localTime = event.time.replace(" ", "T");
          return {
            localTime,
            measurements: event.signalPhaseInfoVOList.map((param) => ({
              label: param.paramKey,
              value: param.paramValue,
            })),
            providerBackupType: event.backupType,
            providerReasonType: event.reasonType,
            utcCandidates: localTimeCandidates(localTime, zone),
          };
        }),
        startDate: data.startTime,
        stationId: input.stationId,
        timezone: DateTime.zoneToString(zone),
        total: page.total,
      });
    }),
});
