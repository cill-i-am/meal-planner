import { Clock, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import type { StationId } from "./model.js";
import { failure } from "./model.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";
import { StationCapabilities, Stations } from "./stations.js";

const StationRow = Schema.Struct({
  batteryCapacity: Schema.NullOr(Schema.Finite),
  pvCapacity: Schema.NullOr(Schema.Finite),
  stationId: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  ),
  stationShowName: Schema.String.check(Schema.isMaxLength(256)),
  stationType: Schema.Int,
  status: Schema.Int,
});
const StationListResponse = Schema.Struct({
  stationCount: Schema.Int.check(
    Schema.isBetween({ maximum: 256, minimum: 0 })
  ),
  stationList: Schema.Array(StationRow).check(Schema.isMaxLength(256)),
});
const CapabilitiesResponse = Schema.Struct({
  hasAcCharger: Schema.Boolean,
  hasEv: Schema.Boolean,
  hasGateway: Schema.Boolean,
  hasInnerGateway: Schema.Boolean,
  hasInstantSetting: Schema.Boolean,
  hasMeter: Schema.Boolean,
  hasSolar: Schema.Boolean,
  hasThirdInverter: Schema.Boolean,
  hasVirtualBatteryFunction: Schema.Boolean,
  stationId: StationRow.fields.stationId,
});
export const makeStationsClient = (read: ProviderRead) => ({
  stationCapabilities: (id: StationId, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readStationCapabilities() {
      const data = yield* read(
        `/device/sigen/station/baseInfoByUser?id=${id}&appVersion=4.1.0`,
        token
      ).pipe(Effect.flatMap(decodeProvider(CapabilitiesResponse)));
      if (String(data.stationId) !== id) {
        return yield* failure("PermissionDenied");
      }
      const backup = yield* read(`/device/station/backup/${id}`, token).pipe(
        Effect.flatMap(decodeProvider(Schema.Boolean))
      );
      const powerShed = yield* read(
        `/device/station/backup/power-shed/${id}`,
        token
      ).pipe(Effect.flatMap(decodeProvider(Schema.Boolean)));
      return yield* decodeProvider(StationCapabilities)({
        backupSupported: backup,
        fetchedAt: yield* Clock.currentTimeMillis,
        hasAcCharger: data.hasAcCharger,
        hasGateway: data.hasGateway,
        hasInnerGateway: data.hasInnerGateway,
        hasMeter: data.hasMeter,
        hasSolar: data.hasSolar,
        hasThirdPartyInverter: data.hasThirdInverter,
        instantManualSupported: data.hasInstantSetting,
        powerSheddingSupported: powerShed,
        providerHasEv: data.hasEv,
        stationId: id,
        virtualBatterySupported: data.hasVirtualBatteryFunction,
      });
    }),
  stations: (enrolled: StationId, token: Redacted.Redacted<string>) =>
    Effect.gen(function* listStations() {
      const data = yield* read("/device/owner/station/list", token).pipe(
        Effect.flatMap(decodeProvider(StationListResponse))
      );
      const ids = data.stationList.map((row) => row.stationId);
      if (
        data.stationCount !== ids.length ||
        new Set(ids).size !== ids.length
      ) {
        return yield* failure("SchemaMismatch");
      }
      if (!ids.some((id) => String(id) === enrolled)) {
        return yield* failure("PermissionDenied");
      }
      return yield* decodeProvider(Stations)({
        fetchedAt: yield* Clock.currentTimeMillis,
        stations: data.stationList.map((row) => ({
          batteryCapacityWh:
            row.batteryCapacity === null ? null : row.batteryCapacity * 1000,
          enrolled: String(row.stationId) === enrolled,
          name: row.stationShowName,
          providerStatus: row.status,
          providerType: row.stationType,
          solarCapacityW:
            row.pvCapacity === null ? null : row.pvCapacity * 1000,
          stationId: String(row.stationId),
        })),
      });
    }),
});
