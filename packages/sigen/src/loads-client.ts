import { Clock, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import {
  LoadCapabilities,
  LoadPath,
  SmartLoad,
  SmartLoadState,
  SmartLoads,
  SystemCards,
} from "./loads.js";
import type { SmartLoadInput } from "./loads.js";
import { failure } from "./model.js";
import type { StationId } from "./model.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";

const LoadResponse = Schema.Struct({
  deviceCommunicationStatus: Schema.NullOr(Schema.Int),
  isControllable: Schema.NullOr(Schema.Boolean),
  loadKey: SmartLoad.fields.key,
  loadName: SmartLoad.fields.name,
  loadPath: LoadPath,
  manualSwitch: Schema.NullOr(Schema.Int),
  runMode: Schema.NullOr(Schema.Int),
  stationId: Schema.Int,
});
const projectLoad = (data: typeof LoadResponse.Type) => ({
  controllable: data.isControllable,
  key: data.loadKey,
  name: data.loadName,
  path: data.loadPath,
  providerCommunicationStatus: data.deviceCommunicationStatus,
  providerManualSwitch: data.manualSwitch,
  providerRunMode: data.runMode,
});
const ConditionsResponse = Schema.Struct({
  controllableLoadPath: Schema.NullOr(LoadPath),
  controllableLoadPortSupport: Schema.Boolean,
  generatorExist: Schema.Boolean,
  generatorPortSupport: Schema.Boolean,
  loadHubInverterSupport: Schema.Boolean,
});
const Label = Schema.NullOr(Schema.String.check(Schema.isMaxLength(1024)));
const CardsResponse = Schema.Array(
  Schema.Struct({
    deviceCommunicationStatus: Schema.NullOr(Schema.Int),
    hasSwitch: Schema.NullOr(Schema.Boolean),
    loadKey: Label,
    path: Schema.NullOr(Schema.Int),
    switchOnOff: Schema.NullOr(Schema.Int),
    type: Schema.Int,
    valueWithUnitOne: Label,
    valueWithUnitTwo: Label,
  })
).check(Schema.isMaxLength(128));
export const makeLoadsClient = (read: ProviderRead) => {
  const smartLoads = (id: StationId, token: Redacted.Redacted<string>) =>
    Effect.gen(function* listSmartLoads() {
      const data = yield* read(
        `/device/tp-device/smart-loads/list?stationId=${id}`,
        token
      ).pipe(
        Effect.flatMap(
          decodeProvider(
            Schema.Array(LoadResponse).check(Schema.isMaxLength(128))
          )
        )
      );
      if (data.some((load) => String(load.stationId) !== id)) {
        return yield* failure("PermissionDenied");
      }
      if (new Set(data.map((load) => load.loadPath)).size !== data.length) {
        return yield* failure("SchemaMismatch");
      }
      return yield* decodeProvider(SmartLoads)({
        fetchedAt: yield* Clock.currentTimeMillis,
        loads: data.map(projectLoad),
        stationId: id,
      });
    });
  return {
    loadCapabilities: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readLoadCapabilities() {
        const data = yield* read(
          `/device/system/device/condition/${id}`,
          token
        ).pipe(Effect.flatMap(decodeProvider(ConditionsResponse)));
        return yield* decodeProvider(LoadCapabilities)({
          controllableLoadPath: data.controllableLoadPath,
          controllableLoadPortSupported: data.controllableLoadPortSupport,
          fetchedAt: yield* Clock.currentTimeMillis,
          generatorInstalled: data.generatorExist,
          generatorPortSupported: data.generatorPortSupport,
          loadHubInverterSupported: data.loadHubInverterSupport,
          stationId: id,
        });
      }),
    smartLoad: (input: SmartLoadInput, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readSmartLoad() {
        const available = yield* smartLoads(input.stationId, token);
        const member = available.loads.find(
          (load) => load.path === input.loadPath
        );
        if (member === undefined) {
          return yield* failure("UnsupportedCapability");
        }
        const data = yield* read(
          `/device/tp-device/smart-loads?stationId=${input.stationId}&loadPath=${input.loadPath}`,
          token
        ).pipe(Effect.flatMap(decodeProvider(LoadResponse)));
        if (
          String(data.stationId) !== input.stationId ||
          data.loadPath !== input.loadPath ||
          data.loadKey !== member.key
        ) {
          return yield* failure("PermissionDenied");
        }
        return yield* decodeProvider(SmartLoadState)({
          fetchedAt: yield* Clock.currentTimeMillis,
          load: projectLoad(data),
          stationId: input.stationId,
        });
      }),
    smartLoads,
    systemCards: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readSystemCards() {
        const data = yield* read(
          `/device/system/device/home/card?stationId=${id}&showThirdPartyInv=false`,
          token
        ).pipe(Effect.flatMap(decodeProvider(CardsResponse)));
        return yield* decodeProvider(SystemCards)({
          cards: data.map((card) => ({
            communicationStatus: card.deviceCommunicationStatus,
            hasSwitch: card.hasSwitch,
            loadKey: card.loadKey,
            path: card.path,
            providerType: card.type,
            switchOnOff: card.switchOnOff,
            valueOne: card.valueWithUnitOne,
            valueTwo: card.valueWithUnitTwo,
          })),
          fetchedAt: yield* Clock.currentTimeMillis,
          stationId: id,
        });
      }),
  };
};
