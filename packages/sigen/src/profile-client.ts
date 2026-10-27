import { Clock, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import type { StationId } from "./model.js";
import {
  BatteryDischargePriority,
  EnergyCapabilities,
  EnergyProfileFeatures,
} from "./profile.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";

const SupportResponse = Schema.Struct({
  ...EnergyProfileFeatures.fields,
  batteryPriorityItem: EnergyCapabilities.fields.batterySourceOptions,
  gridPriorityItem: EnergyCapabilities.fields.gridSourceOptions,
});
export const makeProfileClient = (read: ProviderRead) => ({
  batteryDischargePriority: (id: StationId, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readBatteryDischargePriority() {
      const data = yield* read(
        `/device/energy-profile/battery/discharge/priority/${id}`,
        token
      ).pipe(
        Effect.flatMap(
          decodeProvider(
            Schema.Struct({
              priority: BatteryDischargePriority.fields.providerSources,
            })
          )
        )
      );
      return yield* decodeProvider(BatteryDischargePriority)({
        fetchedAt: yield* Clock.currentTimeMillis,
        providerSources: data.priority,
        stationId: id,
      });
    }),
  energyCapabilities: (id: StationId, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readEnergyCapabilities() {
      const [support, ems] = yield* Effect.all(
        [
          read(`/device/energy-profile/support/${id}`, token).pipe(
            Effect.flatMap(decodeProvider(SupportResponse))
          ),
          read(`/device/energy-profile/support/upgradeEms/${id}`, token).pipe(
            Effect.flatMap(decodeProvider(Schema.Boolean))
          ),
        ],
        { concurrency: 2 }
      );
      return yield* decodeProvider(EnergyCapabilities)({
        batterySourceOptions: support.batteryPriorityItem,
        emsUpgradeSupported: ems,
        fetchedAt: yield* Clock.currentTimeMillis,
        gridSourceOptions: support.gridPriorityItem,
        providerFeatures: yield* decodeProvider(EnergyProfileFeatures)(support),
        stationId: id,
      });
    }),
});
