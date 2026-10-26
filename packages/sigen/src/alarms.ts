import { Schema } from "effect";

import { SerialNumber, StationId, Timestamp } from "./model.js";

const Page = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ maximum: 1000, minimum: 1 })
);
const PageSize = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ maximum: 100, minimum: 1 })
);
const Pagination = { page: Page, pageSize: PageSize, stationId: StationId };
export const AlarmInput = Schema.Union([
  Schema.Struct({ ...Pagination, state: Schema.Literal("active") }),
  Schema.Struct({
    ...Pagination,
    endAt: Timestamp,
    startAt: Timestamp,
    state: Schema.Literal("history"),
  }).check(
    Schema.makeFilter(
      (value) =>
        value.endAt >= value.startAt &&
        value.endAt - value.startAt <= 31 * 86_400_000
    )
  ),
]);
export type AlarmInput = typeof AlarmInput.Type;
export const Alarms = Schema.Struct({
  fetchedAt: Timestamp,
  page: Page,
  pageSize: PageSize,
  pages: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  records: Schema.Array(
    Schema.Struct({
      aioSerialNumber: Schema.NullOr(SerialNumber),
      code: Schema.String,
      deviceSerialNumber: SerialNumber,
      name: Schema.String,
      occurredAt: Timestamp,
      providerDeviceType: Schema.Number,
      providerSeverity: Schema.Number,
      reason: Schema.String,
      resolvedAt: Schema.NullOr(Timestamp),
      subcode: Schema.Number,
    })
  ),
  state: Schema.Literals(["active", "history"]),
  stationId: StationId,
  total: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
