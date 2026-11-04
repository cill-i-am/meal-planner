import { Clock, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import type { StationId } from "./model.js";
import type { PreheatingConfiguration } from "./preheating.js";
import { PreheatingSettings } from "./preheating.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";

const Value = Schema.Union([
  Schema.Finite,
  Schema.String.check(Schema.isMaxLength(64)),
]);
export const PreheatingResponse = Schema.Struct({
  isAutoModeValid: Schema.NullOr(Schema.Boolean),
  isIndustry: Schema.Boolean,
  packPreheatingSwitch: Schema.Int,
  packPreheatingVOList: Schema.Array(
    Schema.Struct({
      chargingPower: Schema.NullOr(Value),
      dischargePower: Schema.NullOr(Value),
      duration: Value,
      periodConfig: Schema.Array(Schema.Int).check(Schema.isMaxLength(7)),
      startTime: Value,
    })
  ).check(Schema.isMaxLength(64)),
  preHeatingEnablesSwitch: Schema.NullOr(Schema.Int),
  preheatingMode: Schema.NullOr(Schema.Int),
});
export const preheatingValues = (
  data: typeof PreheatingResponse.Type
): typeof PreheatingConfiguration.Type => ({
  automaticModeValid: data.isAutoModeValid,
  industrial: data.isIndustry,
  providerEnableSwitch: data.preHeatingEnablesSwitch,
  providerMode: data.preheatingMode,
  providerSwitch: data.packPreheatingSwitch,
  slots: data.packPreheatingVOList.map((slot) => ({
    providerChargingPower: slot.chargingPower,
    providerDischargePower: slot.dischargePower,
    providerDuration: slot.duration,
    providerPeriods: slot.periodConfig,
    providerStartTime: slot.startTime,
  })),
});
export const makePreheatingClient = (read: ProviderRead) => ({
  preheatingSettings: (id: StationId, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readPreheating() {
      const data = yield* read(
        `/device/dischargesetting/packPreheating/new/${id}`,
        token
      ).pipe(Effect.flatMap(decodeProvider(PreheatingResponse)));
      return yield* decodeProvider(PreheatingSettings)({
        ...preheatingValues(data),
        fetchedAt: yield* Clock.currentTimeMillis,
        stationId: id,
      });
    }),
});
