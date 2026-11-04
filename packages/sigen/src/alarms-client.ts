import { Clock, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import { Alarms } from "./alarms.js";
import type { AlarmInput } from "./alarms.js";
import { SerialNumber, Timestamp, failure } from "./model.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";

const Alarm = Schema.Struct({
  aioSnCode: Schema.NullOr(Schema.String),
  alarmCode: Schema.String,
  alarmLevel: Schema.Number,
  alarmName: Schema.String,
  alarmReasonIdName: Schema.String,
  alarmRemoveTime: Schema.optionalKey(Schema.NullOr(Timestamp)),
  alarmTime: Timestamp,
  chlidAlarmCode: Schema.Number,
  deviceSnCode: SerialNumber,
  deviceType: Schema.Number,
  stationId: Schema.Number,
});
const PageResponse = Schema.Struct({
  current: Alarms.fields.page,
  pages: Alarms.fields.pages,
  records: Schema.Array(Alarm),
  size: Alarms.fields.pageSize,
  total: Alarms.fields.total,
});

export const makeAlarmsClient = (read: ProviderRead) => ({
  alarms: (input: AlarmInput, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readAlarms() {
      if (
        input.state === "history" &&
        Math.ceil(input.startAt / 1000) > Math.floor(input.endAt / 1000)
      ) {
        return {
          fetchedAt: yield* Clock.currentTimeMillis,
          page: input.page,
          pageSize: input.pageSize,
          pages: 0,
          records: [],
          state: input.state,
          stationId: input.stationId,
          total: 0,
        };
      }
      const query = new URLSearchParams({
        current: String(input.page),
        size: String(input.pageSize),
        stationId: input.stationId,
      });
      if (input.state === "history") {
        // Provider ranges are inclusive UTC epoch seconds. Round inward so a millisecond range never widens.
        query.set("startTimestamp", String(Math.ceil(input.startAt / 1000)));
        query.set("endTimestamp", String(Math.floor(input.endAt / 1000)));
      }
      const endpoint =
        input.state === "active" ? "/device/alarm/page" : "/alarm/history/page";
      const data = yield* read(`${endpoint}?${query}`, token).pipe(
        Effect.flatMap(decodeProvider(PageResponse))
      );
      if (
        data.current !== input.page ||
        data.size !== input.pageSize ||
        data.records.length > input.pageSize
      ) {
        return yield* failure("SchemaMismatch");
      }
      if (
        data.records.some(
          (record) => String(record.stationId) !== input.stationId
        )
      ) {
        return yield* failure("PermissionDenied");
      }
      return yield* decodeProvider(Alarms)({
        fetchedAt: yield* Clock.currentTimeMillis,
        page: data.current,
        pageSize: data.size,
        pages: data.pages,
        // Provider IDs exceed JavaScript's safe integer range. They are deliberately not exposed or used as identities.
        records: data.records.map((record) => ({
          aioSerialNumber: record.aioSnCode === "" ? null : record.aioSnCode,
          code: record.alarmCode,
          deviceSerialNumber: record.deviceSnCode,
          name: record.alarmName,
          occurredAt: record.alarmTime * 1000,
          providerDeviceType: record.deviceType,
          providerSeverity: record.alarmLevel,
          reason: record.alarmReasonIdName,
          resolvedAt:
            record.alarmRemoveTime === null ||
            record.alarmRemoveTime === undefined ||
            record.alarmRemoveTime === 0
              ? null
              : record.alarmRemoveTime * 1000,
          subcode: record.chlidAlarmCode,
        })),
        state: input.state,
        stationId: input.stationId,
        total: data.total,
      });
    }),
});
