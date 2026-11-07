import { Clock, DateTime, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import { StationConsumption, historyPeriod } from "./history.js";
import type { HistoryInput } from "./history.js";
import { failure } from "./model.js";
import { decodeProvider, readStationTimezone } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";

const OtherLoads = Schema.Record(
  Schema.String,
  Schema.NullOr(Schema.Finite)
).check(
  Schema.makeFilter(
    (values) =>
      Object.keys(values).length <= 128 &&
      Object.keys(values).every((key) => /^\d{1,19}$/u.test(key))
  )
);
const Response = Schema.Struct({
  baseLoadConsumption: Schema.NullOr(Schema.Finite),
  consumptionDetailList: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        baseLoadConsumption: Schema.NullOr(Schema.Finite),
        dataTime: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
        otherLoadConsumptionList: Schema.NullOr(OtherLoads),
      })
    ).check(Schema.isMaxLength(2000))
  ),
  otherLoadConsumptionList: Schema.NullOr(OtherLoads),
  stationId: Schema.Int,
});
const otherLoads = (values: typeof Response.Type.otherLoadConsumptionList) =>
  values === null
    ? null
    : Object.entries(values).map(([providerLoadId, value]) => ({
        providerLoadId,
        value,
      }));
export const makeConsumptionClient = (read: ProviderRead) => ({
  stationConsumption: (input: HistoryInput, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readStationConsumption() {
      const period = historyPeriod(input);
      const query = new URLSearchParams({
        dateFlag: String(period.dateFlag),
        endDate: period.endDate.replaceAll("-", ""),
        startDate: period.startDate.replaceAll("-", ""),
        stationId: input.stationId,
      });
      const data = yield* read(
        `/data-process/sigen/station/statistics/station-consumption?${query}`,
        token
      ).pipe(Effect.flatMap(decodeProvider(Response)));
      if (String(data.stationId) !== input.stationId) {
        return yield* failure("PermissionDenied");
      }
      const zone = yield* readStationTimezone(read, input.stationId, token);
      return yield* decodeProvider(StationConsumption)({
        ...input,
        baseLoad: data.baseLoadConsumption,
        endDate: period.endDate,
        fetchedAt: yield* Clock.currentTimeMillis,
        otherLoads: otherLoads(data.otherLoadConsumptionList),
        samples:
          data.consumptionDetailList?.map((sample) => ({
            baseLoad: sample.baseLoadConsumption,
            otherLoads: otherLoads(sample.otherLoadConsumptionList),
            providerTime: sample.dataTime,
          })) ?? null,
        startDate: period.startDate,
        timezone: DateTime.zoneToString(zone),
        unit: "provider_unit_unverified",
      });
    }),
});
