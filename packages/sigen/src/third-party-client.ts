import { Clock, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import { failure } from "./model.js";
import type { StationId } from "./model.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";
import { ThirdPartyDevices } from "./third-party.js";

const Id = Schema.Int.check(
  Schema.isBetween({ maximum: Number.MAX_SAFE_INTEGER, minimum: -1 })
);
const StaticResponse = Schema.Array(
  Schema.Struct({
    deviceBelongType: Schema.NullOr(Schema.Int),
    deviceCommunicationStatus: Schema.NullOr(Schema.Int),
    hasSwitch: Schema.NullOr(Schema.Boolean),
    id: Id,
    isControllable: Schema.NullOr(Schema.Boolean),
    loadPath: Schema.NullOr(Schema.Int),
    name: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
    stationId: Id,
    title: Schema.String.check(Schema.isMaxLength(256)),
    type: Schema.Int,
  })
).check(Schema.isMaxLength(128));
const DynamicResponse = Schema.Array(
  Schema.Struct({
    id: Id,
    manualSwitch: Schema.NullOr(Schema.Int),
    operationMode: Schema.NullOr(Schema.Int),
    startControlType: Schema.NullOr(Schema.Int),
    stationId: Id,
    valueWithUnit: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1024))),
  })
).check(Schema.isMaxLength(128));
export const makeThirdPartyClient = (read: ProviderRead) => ({
  thirdPartyDevices: (id: StationId, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readThirdPartyDevices() {
      const fixed = yield* read(
        `/device/tp-device/manage/card/static-info?stationId=${id}&showNewGenerator=true`,
        token
      ).pipe(Effect.flatMap(decodeProvider(StaticResponse)));
      const changing = yield* read(
        `/device/tp-device/manage/card/dynamic-info?stationId=${id}`,
        token
      ).pipe(Effect.flatMap(decodeProvider(DynamicResponse)));
      if (
        [...fixed, ...changing].some((card) => String(card.stationId) !== id)
      ) {
        return yield* failure("PermissionDenied");
      }
      if (
        new Set(fixed.map((card) => card.id)).size !== fixed.length ||
        new Set(changing.map((card) => card.id)).size !== changing.length
      ) {
        return yield* failure("SchemaMismatch");
      }
      if (
        changing.some((card) => !fixed.some((device) => device.id === card.id))
      ) {
        return yield* failure("SchemaMismatch");
      }
      return yield* decodeProvider(ThirdPartyDevices)({
        cards: fixed.map((card) => {
          const dynamic = changing.find((item) => item.id === card.id);
          return {
            controllable: card.isControllable,
            displayValue: dynamic?.valueWithUnit ?? null,
            hasSwitch: card.hasSwitch,
            loadPath: card.loadPath,
            name: card.name,
            placeholder: card.id === -1,
            providerBelongType: card.deviceBelongType,
            providerCommunicationStatus: card.deviceCommunicationStatus,
            providerId: card.id,
            providerManualSwitch: dynamic?.manualSwitch ?? null,
            providerOperationMode: dynamic?.operationMode ?? null,
            providerStartControlType: dynamic?.startControlType ?? null,
            providerType: card.type,
            telemetryAvailable: dynamic !== undefined,
            title: card.title,
          };
        }),
        fetchedAt: yield* Clock.currentTimeMillis,
        stationId: id,
      });
    }),
});
