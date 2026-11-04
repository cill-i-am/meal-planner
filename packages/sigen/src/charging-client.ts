import { Clock, DateTime, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import {
  AcChargerCurrent,
  AcChargerSettings,
  ChargerSchedules,
  ChargerStatus,
  Chargers,
  DcChargerSettings,
} from "./charging.js";
import type { ChargerInput } from "./charging.js";
import { Percent, SerialNumber, failure } from "./model.js";
import type { StationId } from "./model.js";
import { decodeProvider, readStationTimezone } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";

const Serials = Schema.NullOr(
  Schema.Array(SerialNumber).check(Schema.isMaxLength(128))
);
const Home = Schema.Struct({
  acSnList: Serials,
  dcSnList: Serials,
  stationId: Schema.Int,
});
const Mode = Schema.Struct({
  chargeMode: Schema.NullOr(Schema.Int),
  cutoffSocFromPack: Schema.NullOr(Percent),
  enableFromGrid: Schema.NullOr(Schema.Boolean),
  enableFromPack: Schema.NullOr(Schema.Boolean),
  socLowerLimit: Schema.NullOr(Percent),
  socUpperLimit: Schema.NullOr(Percent),
});
const currentSetting = (
  value: number | null
): typeof AcChargerCurrent.Type.lastSetCurrent => {
  if (value === null) {
    return { kind: "unknown" };
  }
  if (value === -1) {
    return { kind: "unset" };
  }
  return { kind: "amperes", value };
};
export const makeChargingClient = (read: ProviderRead) => {
  const chargers = (id: StationId, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readChargerInventory() {
      const data = yield* read(
        `/device/owner/station/home?stationId=${id}`,
        token
      ).pipe(Effect.flatMap(decodeProvider(Home)));
      if (String(data.stationId) !== id) {
        return yield* failure("PermissionDenied");
      }
      if (
        [data.acSnList, data.dcSnList].some(
          (serials) =>
            serials !== null && new Set(serials).size !== serials.length
        )
      ) {
        return yield* failure("SchemaMismatch");
      }
      return yield* decodeProvider(Chargers)({
        ac: {
          availability: data.acSnList === null ? "unknown" : "known",
          serialNumbers: data.acSnList ?? [],
        },
        dc: {
          availability: data.dcSnList === null ? "unknown" : "known",
          serialNumbers: data.dcSnList ?? [],
        },
        fetchedAt: yield* Clock.currentTimeMillis,
        stationId: id,
      });
    });
  const member = (input: ChargerInput, token: Redacted.Redacted<string>) =>
    Effect.gen(function* selectCharger() {
      const inventory = yield* chargers(input.stationId, token);
      const selected = inventory[input.kind];
      if (
        selected.availability === "unknown" ||
        selected.serialNumbers.length === 0
      ) {
        return yield* failure("UnsupportedCapability");
      }
      if (!selected.serialNumbers.includes(input.serialNumber)) {
        return yield* failure("PermissionDenied");
      }
      return new URLSearchParams({
        snCode: input.serialNumber,
        stationId: input.stationId,
      });
    });
  return {
    acChargerCurrent: (input: ChargerInput, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readAcCurrent() {
        if (input.kind !== "ac") {
          return yield* failure("InvalidInput");
        }
        const query = yield* member(input, token);
        const current = yield* read(
          `/device/acevse/charge/read/current?${query}`,
          token
        ).pipe(
          Effect.flatMap(
            decodeProvider(
              Schema.Struct({
                dlmStatus: Schema.NullOr(Schema.Int),
                lastSetCurrent: Schema.NullOr(
                  Schema.Finite.check(Schema.isGreaterThanOrEqualTo(-1))
                ),
                maxCurrent: Schema.NullOr(
                  Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
                ),
              })
            )
          )
        );
        return yield* decodeProvider(AcChargerCurrent)({
          ...input,
          fetchedAt: yield* Clock.currentTimeMillis,
          lastSetCurrent: currentSetting(current.lastSetCurrent),
          maximumAmperes: current.maxCurrent,
          providerDlmStatus: current.dlmStatus,
        });
      }),
    acChargerSettings: (
      input: ChargerInput,
      token: Redacted.Redacted<string>
    ) =>
      Effect.gen(function* readAcSettings() {
        if (input.kind !== "ac") {
          return yield* failure("InvalidInput");
        }
        const query = yield* member(input, token);
        const data = yield* read(
          `/device/acevse/more-setting/${input.stationId}?${query}`,
          token
        ).pipe(
          Effect.flatMap(
            decodeProvider(
              Schema.Struct({
                chargingOutputCurrent: Schema.NullOr(Schema.Finite),
                dlmStatus: Schema.NullOr(Schema.Int),
                homeCircuitBreaker: Schema.NullOr(Schema.Finite),
                isSupportThreePhase: Schema.NullOr(Schema.Boolean),
                meterPhase: Schema.NullOr(Schema.Int),
                offGridCharge: Schema.NullOr(Schema.Int),
                phaseAutoSwitch: Schema.NullOr(Schema.Int),
                phaseType: Schema.NullOr(Schema.Int),
                pileCircuitBreaker: Schema.NullOr(Schema.Finite),
                runStatus: Schema.NullOr(Schema.Int),
              })
            )
          )
        );
        return yield* decodeProvider(AcChargerSettings)({
          ...input,
          fetchedAt: yield* Clock.currentTimeMillis,
          providerChargingOutputCurrent: data.chargingOutputCurrent,
          providerDlmStatus: data.dlmStatus,
          providerHomeCircuitBreaker: data.homeCircuitBreaker,
          providerMeterPhase: data.meterPhase,
          providerOffGridCharge: data.offGridCharge,
          providerPhaseAutoSwitch: data.phaseAutoSwitch,
          providerPhaseType: data.phaseType,
          providerPileCircuitBreaker: data.pileCircuitBreaker,
          providerRunStatus: data.runStatus,
          supportsThreePhase: data.isSupportThreePhase,
        });
      }),
    chargerSchedules: (input: ChargerInput, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readChargerSchedules() {
        const query = yield* member(input, token);
        const prefix = input.kind === "ac" ? "acevse" : "dcevse";
        const data = yield* read(
          `/device/${prefix}/schedule/list/${input.stationId}?${query}`,
          token
        ).pipe(
          Effect.flatMap(
            decodeProvider(
              Schema.NullOr(
                Schema.Array(
                  Schema.Struct({
                    chargeMode: Schema.NullOr(Schema.Int),
                    cutoffSocFromPack: Schema.NullOr(Percent),
                    enableFromGrid: Schema.NullOr(Schema.Boolean),
                    enableFromPack: Schema.NullOr(Schema.Int),
                    endTime: Schema.NullOr(Schema.String),
                    frequency: Schema.NullOr(Schema.Int),
                    id: Schema.NullOr(
                      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
                    ),
                    isNextDay: Schema.NullOr(Schema.Boolean),
                    maxPowerFromGrid: Schema.NullOr(Schema.Finite),
                    name: Schema.NullOr(Schema.String),
                    open: Schema.NullOr(Schema.Int),
                    settingMode: Schema.NullOr(Schema.Int),
                    startTime: Schema.NullOr(Schema.String),
                    time: Schema.NullOr(Schema.String),
                    whichDay: Schema.NullOr(Schema.String),
                  })
                ).check(Schema.isMaxLength(128))
              )
            )
          )
        );
        const zone = yield* readStationTimezone(read, input.stationId, token);
        return yield* decodeProvider(ChargerSchedules)({
          ...input,
          fetchedAt: yield* Clock.currentTimeMillis,
          powerUnit: "provider_unit_unverified",
          schedules:
            data?.map((row) => ({
              batteryCutoffSocPercent: row.cutoffSocFromPack,
              endTime: row.endTime,
              fromGridEnabled: row.enableFromGrid,
              id: row.id,
              name: row.name,
              nextDay: row.isNextDay,
              providerChargeMode: row.chargeMode,
              providerDays: row.whichDay,
              providerEnableFromPack: row.enableFromPack,
              providerFrequency: row.frequency,
              providerMaxGridPower: row.maxPowerFromGrid,
              providerOpen: row.open,
              providerSettingMode: row.settingMode,
              providerTime: row.time,
              startTime: row.startTime,
            })) ?? null,
          timezone: DateTime.zoneToString(zone),
        });
      }),
    chargerStatus: (input: ChargerInput, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readChargerStatus() {
        const query = yield* member(input, token);
        const prefix = input.kind === "ac" ? "acevse" : "dcevse";
        const pluggedIn = yield* read(
          `/device/${prefix}/plug/status?${query}`,
          token
        ).pipe(Effect.flatMap(decodeProvider(Schema.Boolean)));
        const mode = yield* read(
          `/device/charge/mode/${input.kind}?${query}`,
          token
        ).pipe(Effect.flatMap(decodeProvider(Mode)));
        return yield* decodeProvider(ChargerStatus)({
          ...input,
          batteryCutoffSocPercent: mode.cutoffSocFromPack,
          fetchedAt: yield* Clock.currentTimeMillis,
          fromBatteryEnabled: mode.enableFromPack,
          fromGridEnabled: mode.enableFromGrid,
          lowerSocPercent: mode.socLowerLimit,
          pluggedIn,
          providerChargeMode: mode.chargeMode,
          upperSocPercent: mode.socUpperLimit,
        });
      }),
    chargers,
    dcChargerSettings: (
      input: ChargerInput,
      token: Redacted.Redacted<string>
    ) =>
      Effect.gen(function* readDcSettings() {
        if (input.kind !== "dc") {
          return yield* failure("InvalidInput");
        }
        const query = yield* member(input, token);
        const settings = yield* read(
          `/device/dcevse/charge/setting?${query}`,
          token
        ).pipe(
          Effect.flatMap(
            decodeProvider(
              Schema.Struct({
                allowedChargePower: Schema.NullOr(Schema.Finite),
                ratedPower: Schema.NullOr(Schema.Finite),
                vehicleChargingCutoffSoc: Schema.NullOr(Percent),
                vehicleDischargeCutoffSoc: Schema.NullOr(Percent),
              })
            )
          )
        );
        return yield* decodeProvider(DcChargerSettings)({
          ...input,
          chargeCutoffSocPercent: settings.vehicleChargingCutoffSoc,
          dischargeCutoffSocPercent: settings.vehicleDischargeCutoffSoc,
          fetchedAt: yield* Clock.currentTimeMillis,
          powerUnit: "provider_unit_unverified",
          providerAllowedChargePower: settings.allowedChargePower,
          providerRatedPower: settings.ratedPower,
        });
      }),
  };
};
