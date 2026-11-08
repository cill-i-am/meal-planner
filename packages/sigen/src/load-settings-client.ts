import { Clock, DateTime, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import { historyPeriod } from "./history.js";
import {
  LoadControlSettings,
  LoadOffGridSettings,
  SmartLoadConsumption,
  SmartLoadControlSettings,
} from "./load-settings.js";
import type { SmartLoadHistoryInput } from "./load-settings.js";
import { makeLoadsClient } from "./loads-client.js";
import { SmartLoadInput } from "./loads.js";
import { failure } from "./model.js";
import { decodeProvider, readStationTimezone } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";

const SmartId = Schema.Union([
  Schema.Int.check(
    Schema.isBetween({ maximum: Number.MAX_SAFE_INTEGER, minimum: 1 })
  ),
  Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,18}$/u)),
]);
const Consumption = Schema.Struct({
  consumptionDetailList: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        dataTime: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
        loadConsumption: Schema.NullOr(Schema.Finite),
      })
    ).check(Schema.isMaxLength(2000))
  ),
  lifetimeConsumption: Schema.NullOr(Schema.Finite),
  monthConsumption: Schema.NullOr(Schema.Finite),
  stationId: Schema.Int,
  todayConsumption: Schema.NullOr(Schema.Finite),
  totalConsumption: Schema.NullOr(Schema.Finite),
});
export const makeLoadSettingsClient = (read: ProviderRead) => {
  const loads = makeLoadsClient(read);
  return {
    smartLoadConsumption: (
      input: SmartLoadHistoryInput,
      token: Redacted.Redacted<string>
    ) =>
      Effect.gen(function* readLoadConsumption() {
        const member = yield* loads.smartLoad(input, token);
        const query = new URLSearchParams({
          loadPath: String(input.loadPath),
          stationId: input.stationId,
        });
        const identity = yield* read(
          `/device/tp-device/smart-loads?${query}`,
          token
        ).pipe(
          Effect.flatMap(
            decodeProvider(
              Schema.Struct({
                loadKey: Schema.NullOr(Schema.String),
                loadPath: SmartLoadInput.fields.loadPath,
                smartLoadId: Schema.NullOr(SmartId),
                stationId: Schema.Int,
              })
            )
          )
        );
        if (
          String(identity.stationId) !== input.stationId ||
          identity.loadPath !== input.loadPath ||
          identity.loadKey !== member.load.key
        ) {
          return yield* failure("PermissionDenied");
        }
        if (identity.smartLoadId === null) {
          return yield* failure("UnsupportedCapability");
        }
        const period = historyPeriod(input);
        query.set("smartLoadId", String(identity.smartLoadId));
        query.set("dateFlag", String(period.dateFlag));
        query.set("startDate", period.startDate.replaceAll("-", ""));
        query.set("endDate", period.endDate.replaceAll("-", ""));
        const data = yield* read(
          `/data-process/sigen/station/statistics/load-consumption?${query}`,
          token
        ).pipe(Effect.flatMap(decodeProvider(Consumption)));
        if (String(data.stationId) !== input.stationId) {
          return yield* failure("PermissionDenied");
        }
        const zone = yield* readStationTimezone(read, input.stationId, token);
        return yield* decodeProvider(SmartLoadConsumption)({
          ...input,
          endDate: period.endDate,
          fetchedAt: yield* Clock.currentTimeMillis,
          lifetime: data.lifetimeConsumption,
          month: data.monthConsumption,
          periodTotal: data.totalConsumption,
          samples:
            data.consumptionDetailList?.map((sample) => ({
              providerTime: sample.dataTime,
              value: sample.loadConsumption,
            })) ?? null,
          startDate: period.startDate,
          timezone: DateTime.zoneToString(zone),
          today: data.todayConsumption,
          unit: "provider_unit_unverified",
        });
      }),
    smartLoadControlSettings: (
      input: typeof SmartLoadInput.Type,
      token: Redacted.Redacted<string>
    ) =>
      Effect.gen(function* readLoadSettings() {
        const member = yield* loads.smartLoad(input, token);
        const query = new URLSearchParams({
          loadPath: String(input.loadPath),
          stationId: input.stationId,
        });
        const onGrid = yield* read(
          `/device/tp-device/smart-loads/control-mode?${query}`,
          token
        ).pipe(Effect.flatMap(decodeProvider(LoadControlSettings)));
        const offGrid = yield* read(
          `/third-party-device/tp-device/smart-loads/control-mode/auto/off-grid?${query}`,
          token
        ).pipe(Effect.flatMap(decodeProvider(LoadOffGridSettings)));
        if (offGrid.loadPath !== input.loadPath) {
          return yield* failure("PermissionDenied");
        }
        const zone = yield* readStationTimezone(read, input.stationId, token);
        return yield* decodeProvider(SmartLoadControlSettings)({
          ...input,
          fetchedAt: yield* Clock.currentTimeMillis,
          load: member.load,
          offGrid,
          onGrid,
          timezone: DateTime.zoneToString(zone),
        });
      }),
  };
};
