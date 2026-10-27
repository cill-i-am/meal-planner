import { Clock, DateTime, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import { Percent, failure } from "./model.js";
import type { StationId } from "./model.js";
import { decodeProvider, readStationTimezone } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";
import {
  AutomationSettings,
  BatterySettings,
  EnergySavingSettings,
  GridSettings,
  ManualOverride,
  OperatingModes,
  PeakShavingSchedule,
  SolarSettings,
} from "./settings.js";
import type { PowerLimit } from "./settings.js";

// Empty decimal settings are unset, never zero. This boundary rejects coercions such as hexadecimal and Infinity.
const DecimalSetting = Schema.String.check(
  Schema.isPattern(/^(?:\d+(?:\.\d+)?)?$/u)
);
const PowerResponse = Schema.Struct({
  enable: Schema.Boolean,
  maxLimitation: DecimalSetting,
  maxLimitationInstaller: DecimalSetting,
  maxLimitationOwner: DecimalSetting,
});
const AutomationGroupResponse = {
  activeStatus: Schema.Int,
  itemVOList: Schema.Array(
    Schema.Struct({
      endTime: Schema.String,
      startTime: Schema.String,
      whichDay: Schema.String,
    })
  ).check(Schema.isMaxLength(64)),
  name: Schema.String,
  priorityList: Schema.Array(Schema.String).check(Schema.isMaxLength(32)),
  winMode: Schema.Int,
};
const AutomationResponse = Schema.Struct({
  activeStatus: Schema.Int,
  batteryAutomationGroupVOList: Schema.Array(
    Schema.Struct({
      ...AutomationGroupResponse,
      b2GMaxDischargePower: DecimalSetting,
      chargeCutOffSoc: DecimalSetting,
      dischargeCutOffSoc: DecimalSetting,
      g2BMaxChargePower: DecimalSetting,
      maxChargePower: DecimalSetting,
      maxDischargePower: DecimalSetting,
    })
  ).check(Schema.isMaxLength(64)),
  batteryGlobalActive: Schema.Boolean,
  gridAutomationGroupVOList: Schema.Array(
    Schema.Struct({
      ...AutomationGroupResponse,
      maxBuyPower: DecimalSetting,
      maxSellPower: DecimalSetting,
    })
  ).check(Schema.isMaxLength(64)),
  gridGlobalActive: Schema.Boolean,
  name: Schema.String,
  profileId: Schema.NullOr(Schema.Int),
});
type ProviderAutomationGroup = Schema.Struct.Type<
  typeof AutomationGroupResponse
>;
const automationGroup = (group: ProviderAutomationGroup) => ({
  name: group.name,
  providerActiveStatus: group.activeStatus,
  providerMode: group.winMode,
  sourcePriority: group.priorityList,
  windows: group.itemVOList.map((window) => ({
    endTime: window.endTime,
    providerDays: window.whichDay,
    startTime: window.startTime,
  })),
});
const decimal = (value: string) => (value === "" ? null : Number(value));
const powerLimit = (value: string): PowerLimit => {
  const number = decimal(value);
  if (number === null) {
    return { kind: "unset" };
  }
  if (number === 4_294_967.295) {
    return { kind: "unlimited" };
  }
  return { kind: "limited", watts: number * 1000 };
};
const gridPower = (value: typeof PowerResponse.Type) => ({
  effective: powerLimit(value.maxLimitation),
  enabled: value.enable,
  installer: powerLimit(value.maxLimitationInstaller),
  owner: powerLimit(value.maxLimitationOwner),
});

/** Manual control confirmation depends on configuration, not optional live display telemetry. */
export const readManualOverrideState = (
  read: ProviderRead,
  id: StationId,
  token: Redacted.Redacted<string>
) =>
  Effect.gen(function* manualOverrideState() {
    const state = yield* read(
      `/device/energy-profile/instant/manunal/${encodeURIComponent(id)}`,
      token
    ).pipe(
      Effect.flatMap(
        decodeProvider(
          Schema.Struct({
            enable: Schema.Boolean,
            endTime: Schema.NullOr(Schema.String),
            mode: Schema.NullOr(Schema.String),
          })
        )
      )
    );
    return {
      enabled: state.enable,
      fetchedAt: yield* Clock.currentTimeMillis,
      providerEndTime: state.endTime === "" ? null : state.endTime,
      providerMode: state.mode === "" ? null : state.mode,
      stationId: id,
    };
  });

export const makeSettingsClient = (read: ProviderRead) => {
  const stationPath = (prefix: string, id: StationId) =>
    `${prefix}/${encodeURIComponent(id)}`;
  const get = <S extends Schema.Top>(
    prefix: string,
    id: StationId,
    token: Redacted.Redacted<string>,
    schema: S
  ) =>
    read(stationPath(prefix, id), token).pipe(
      Effect.flatMap(decodeProvider(schema))
    );
  return {
    automationSettings: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readAutomationSettings() {
        const [data, zone] = yield* Effect.all(
          [
            get(
              "/device/energy-profile/setting",
              id,
              token,
              AutomationResponse
            ),
            readStationTimezone(read, id, token),
          ],
          { concurrency: 2 }
        );
        return yield* decodeProvider(AutomationSettings)({
          batteryEnabled: data.batteryGlobalActive,
          batteryGroups: data.batteryAutomationGroupVOList.map((group) => ({
            ...automationGroup(group),
            chargeCutoffPercent: decimal(group.chargeCutOffSoc),
            chargeLimit: powerLimit(group.maxChargePower),
            dischargeCutoffPercent: decimal(group.dischargeCutOffSoc),
            dischargeLimit: powerLimit(group.maxDischargePower),
            gridChargeLimit: powerLimit(group.g2BMaxChargePower),
            gridExportLimit: powerLimit(group.b2GMaxDischargePower),
          })),
          fetchedAt: yield* Clock.currentTimeMillis,
          gridEnabled: data.gridGlobalActive,
          gridGroups: data.gridAutomationGroupVOList.map((group) => ({
            ...automationGroup(group),
            exportLimit: powerLimit(group.maxSellPower),
            importLimit: powerLimit(group.maxBuyPower),
          })),
          profileName: data.name,
          providerActiveStatus: data.activeStatus,
          providerProfileId: data.profileId,
          stationId: id,
          timezone: DateTime.zoneToString(zone),
        });
      }),
    batterySettings: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readBatterySettings() {
        const [levels, power, reserve, exporting] = yield* Effect.all(
          [
            get(
              "/device/energy-profile/battery/level",
              id,
              token,
              Schema.Struct({
                backupSOC: DecimalSetting,
                chargeSOC: DecimalSetting,
                dischargeSOC: DecimalSetting,
                ja12SOC: Schema.optionalKey(DecimalSetting),
                peakShavingSOC: DecimalSetting,
              })
            ),
            get(
              "/device/energy-profile/battery/limit",
              id,
              token,
              Schema.Struct({
                batteryMaxChargingPower: DecimalSetting,
                batteryMaxDischargingPower: DecimalSetting,
              })
            ),
            get(
              "/device/setting/backup/reserve",
              id,
              token,
              Schema.Struct({
                backupReserve: Percent,
                operationMode: Schema.Number,
                stationId: Schema.Number,
              })
            ),
            get(
              "/device/energy-profile/battery/export/limitation",
              id,
              token,
              Schema.Struct({
                currentEnable: Schema.Boolean,
                installerSetEnable: Schema.NullOr(Schema.Boolean),
                ownerSetEnable: Schema.NullOr(Schema.Boolean),
              })
            ),
          ],
          { concurrency: 2 }
        );
        if (String(reserve.stationId) !== id) {
          return yield* failure("PermissionDenied");
        }
        return yield* decodeProvider(BatterySettings)({
          backupReservePercent: reserve.backupReserve,
          backupSocPercent: decimal(levels.backupSOC),
          chargeLimit: powerLimit(power.batteryMaxChargingPower),
          chargeSocPercent: decimal(levels.chargeSOC),
          dischargeLimit: powerLimit(power.batteryMaxDischargingPower),
          dischargeSocPercent: decimal(levels.dischargeSOC),
          export: {
            effectiveEnabled: exporting.currentEnable,
            installerEnabled: exporting.installerSetEnable,
            ownerEnabled: exporting.ownerSetEnable,
          },
          fetchedAt: yield* Clock.currentTimeMillis,
          ja12SocPercent:
            levels.ja12SOC === undefined ? null : decimal(levels.ja12SOC),
          peakShavingSocPercent: decimal(levels.peakShavingSOC),
          providerOperationMode: reserve.operationMode,
          stationId: id,
        });
      }),
    energySavingSettings: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readEnergySavingSettings() {
        const data = yield* get(
          "/device/owner/station/save-energy-mode",
          id,
          token,
          Schema.Struct({
            offGridEnable: Schema.Boolean,
            offGridMode: EnergySavingSettings.fields.providerOffGridMode,
            onGridMode: EnergySavingSettings.fields.providerOnGridMode,
            stationId: Schema.NullOr(Schema.Int),
            value: EnergySavingSettings.fields.providerValue,
          })
        );
        if (data.stationId !== null && String(data.stationId) !== id) {
          return yield* failure("PermissionDenied");
        }
        return yield* decodeProvider(EnergySavingSettings)({
          fetchedAt: yield* Clock.currentTimeMillis,
          offGridEnabled: data.offGridEnable,
          providerOffGridMode: data.offGridMode,
          providerOnGridMode: data.onGridMode,
          providerValue: data.value,
          stationId: id,
        });
      }),
    gridSettings: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readGridSettings() {
        const [exporting, importing, current] = yield* Effect.all(
          [
            get(
              "/device/energy-profile/grid/limitation/export",
              id,
              token,
              PowerResponse
            ),
            get(
              "/device/energy-profile/grid/limitation/import",
              id,
              token,
              PowerResponse
            ),
            get(
              "/device/energy-profile/parallel/off/grid",
              id,
              token,
              Schema.Struct({
                currentLimitation: DecimalSetting,
                enable: Schema.Boolean,
                installerSetLimitation: DecimalSetting,
                ownerSetLimitation: DecimalSetting,
              })
            ),
          ],
          { concurrency: 2 }
        );
        return yield* decodeProvider(GridSettings)({
          connectionCurrent: {
            effectiveAmps: decimal(current.currentLimitation),
            enabled: current.enable,
            installerAmps: decimal(current.installerSetLimitation),
            ownerAmps: decimal(current.ownerSetLimitation),
          },
          exportPower: gridPower(exporting),
          fetchedAt: yield* Clock.currentTimeMillis,
          importPower: gridPower(importing),
          stationId: id,
        });
      }),
    manualOverride: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readManualOverride() {
        const [state, display] = yield* Effect.all(
          [
            readManualOverrideState(read, id, token),
            get(
              "/device/energy-profile/instant/manunal/display",
              id,
              token,
              Schema.Struct({
                batteryPower: Schema.NullOr(Schema.Finite),
                batterySoc: Schema.NullOr(Percent),
              })
            ),
          ],
          { concurrency: 2 }
        );
        return yield* decodeProvider(ManualOverride)({
          ...state,
          batteryPowerW:
            display.batteryPower === null ? null : display.batteryPower * 1000,
          batterySocPercent: display.batterySoc,
        });
      }),
    operatingModes: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readOperatingModes() {
        const data = yield* get(
          "/device/energy-profile/mode/all",
          id,
          token,
          Schema.Struct({
            defaultWorkingModes: Schema.Array(
              Schema.Struct({ label: Schema.String, value: Schema.String })
            ),
            energyProfileItems: Schema.Array(
              Schema.Struct({ name: Schema.String, profileId: Schema.Number })
            ),
          })
        );
        return yield* decodeProvider(OperatingModes)({
          customProfiles: data.energyProfileItems,
          fetchedAt: yield* Clock.currentTimeMillis,
          modes: data.defaultWorkingModes.map((mode) => ({
            label: mode.label,
            providerMode: mode.value,
          })),
          stationId: id,
        });
      }),
    peakShavingSchedule: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readPeakShavingSchedule() {
        const data = yield* get(
          "/device/dischargesetting/peak/shaving",
          id,
          token,
          Schema.Struct({
            controlMode: Schema.Number,
            settingList: Schema.Array(
              Schema.Struct({
                endTime: Schema.String,
                peakPower: Schema.Finite,
                startTime: Schema.String,
                whichDay: Schema.String,
              })
            ),
            shavingSOC: Percent,
          })
        );
        return yield* decodeProvider(PeakShavingSchedule)({
          fetchedAt: yield* Clock.currentTimeMillis,
          providerControlMode: data.controlMode,
          reserveSocPercent: data.shavingSOC,
          slots: data.settingList.map((slot) => ({
            endTime: slot.endTime,
            peakPowerW: slot.peakPower * 1000,
            providerDays: slot.whichDay,
            startTime: slot.startTime,
          })),
          stationId: id,
          timezone: DateTime.zoneToString(
            yield* readStationTimezone(read, id, token)
          ),
        });
      }),
    solarSettings: (id: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readSolarSettings() {
        const data = yield* get(
          "/device/energy-profile/solar/limit",
          id,
          token,
          Schema.Struct({ powerLimit: DecimalSetting })
        );
        return yield* decodeProvider(SolarSettings)({
          fetchedAt: yield* Clock.currentTimeMillis,
          powerLimit: powerLimit(data.powerLimit),
          stationId: id,
        });
      }),
  };
};
