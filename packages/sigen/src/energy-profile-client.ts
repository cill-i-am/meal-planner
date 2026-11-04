import { Clock, DateTime, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import { failure, Percent } from "./model.js";
import type { StationId } from "./model.js";
import { PreheatingResponse, preheatingValues } from "./preheating-client.js";
import {
  AutomationResponse,
  DecimalSetting,
  automationValues,
  decimal,
  powerLimit,
} from "./profile-data.js";
import { EnergyProfile, ProfileTemplates } from "./profile.js";
import type { EnergyProfileInput, SolarPriority } from "./profile.js";
import { decodeProvider, readStationTimezone } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";
import { makeSettingsClient } from "./settings-client.js";

const Label = Schema.String.check(Schema.isMaxLength(256));
const PriorityResponse = Schema.Struct({
  isGroup: Schema.Boolean,
  loadKey: Schema.optionalKey(Schema.NullOr(Label)),
  loadName: Schema.optionalKey(Schema.NullOr(Label)),
  loadsType: Schema.Int,
  priority: Schema.Int,
  priorityGroupList: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(64)),
  sgDeviceType: Schema.NullOr(Schema.Int),
  smartLoadsKey: Schema.NullOr(Label),
  smartLoadsName: Label,
  smartLoadsPath: Schema.NullOr(Schema.Int),
  smartLoadsStatus: Schema.NullOr(Schema.Int),
  status: Schema.Int,
});
const ProfileResponse = Schema.Struct({
  ...AutomationResponse.fields,
  backupSOC: DecimalSetting,
  batteryDischargePriority: Schema.Array(Label).check(Schema.isMaxLength(32)),
  batteryMaxChargingPower: DecimalSetting,
  batteryMaxDischargingPower: DecimalSetting,
  chargeSOC: DecimalSetting,
  dischargeSOC: DecimalSetting,
  exportLimitation: Schema.Boolean,
  importLimitation: Schema.Boolean,
  isIndustry: Schema.Boolean,
  maxExportLimitation: DecimalSetting,
  maxImportLimitation: DecimalSetting,
  note: Schema.String.check(Schema.isMaxLength(8192)),
  packPreheatingInfoVO: PreheatingResponse,
  peakShavingVO: Schema.Struct({
    controlMode: Schema.Int,
    settingList: Schema.Array(
      Schema.Struct({
        endTime: Schema.String,
        peakPower: Schema.Finite,
        startTime: Schema.String,
        whichDay: Schema.String,
      })
    ).check(Schema.isMaxLength(64)),
    shavingSOC: Percent,
  }),
  powerLimit: DecimalSetting,
  pvPriority: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(64)),
});
const TemplateResponse = Schema.Array(
  Schema.Struct({
    description: Schema.String.check(Schema.isMaxLength(8192)),
    label: Label,
    mode: Schema.Int,
    profileId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(-1)),
  })
).check(Schema.isMaxLength(256));

const priorityEntries = (raw: readonly unknown[]) =>
  Effect.gen(function* decodePriorityEntries() {
    const pending = raw.map((value, index) => ({ path: [index], value }));
    const entries: (typeof SolarPriority.Type.entries)[number][] = [];
    while (pending.length > 0) {
      const next = pending.shift();
      if (next === undefined) {
        break;
      }
      if (next.path.length > 5 || entries.length >= 128) {
        return yield* failure("SchemaMismatch");
      }
      const item = yield* decodeProvider(PriorityResponse)(next.value);
      if (!item.isGroup && item.priorityGroupList.length > 0) {
        return yield* failure("SchemaMismatch");
      }
      entries.push({
        group: item.isGroup,
        groupPath: next.path,
        loadKey: item.loadKey ?? null,
        loadName: item.loadName ?? null,
        providerDeviceType: item.sgDeviceType,
        providerLoadType: item.loadsType,
        providerPriority: item.priority,
        providerStatus: item.status,
        smartLoadKey: item.smartLoadsKey,
        smartLoadName: item.smartLoadsName,
        smartLoadPath: item.smartLoadsPath,
        smartLoadStatus: item.smartLoadsStatus,
      });
      pending.unshift(
        ...item.priorityGroupList.map((value, index) => ({
          path: [...next.path, index],
          value,
        }))
      );
    }
    return entries;
  });

export const makeEnergyProfileClient = (read: ProviderRead) => {
  const templates = (id: StationId, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readTemplates() {
      const data = yield* read(
        `/device/energy-profile/mode/all/template/${id}`,
        token
      ).pipe(Effect.flatMap(decodeProvider(TemplateResponse)));
      return yield* decodeProvider(ProfileTemplates)({
        fetchedAt: yield* Clock.currentTimeMillis,
        stationId: id,
        templates: data.map((item) => ({
          description: item.description,
          name: item.label,
          profileId: item.profileId,
          providerMode: item.mode,
        })),
      });
    });
  const energyProfile = (
    input: EnergyProfileInput,
    token: Redacted.Redacted<string>
  ) =>
    Effect.gen(function* readEnergyProfile() {
      const { stationId: id, target } = input;
      let path = `/device/energy-profile/setting/${id}`;
      if (target.kind !== "current") {
        if (target.kind === "template") {
          const available = yield* templates(id, token);
          if (
            !available.templates.some(
              (item) =>
                item.profileId === target.profileId &&
                item.providerMode === target.providerMode
            )
          ) {
            return yield* failure("PermissionDenied");
          }
        } else {
          const available = yield* makeSettingsClient(read).operatingModes(
            id,
            token
          );
          if (
            !available.customProfiles.some(
              (item) => item.profileId === target.profileId
            )
          ) {
            return yield* failure("PermissionDenied");
          }
        }
        const mode = target.kind === "custom" ? 9 : target.providerMode;
        path = `/device/energy-profile/setting/info/${id}?profileId=${target.profileId}&mode=${mode}`;
      }
      const data = yield* read(path, token).pipe(
        Effect.flatMap(decodeProvider(ProfileResponse))
      );
      if (
        target.kind !== "current" &&
        (target.profileId > 0
          ? data.profileId !== target.profileId
          : data.profileId !== null && data.profileId !== target.profileId)
      ) {
        return yield* failure("SchemaMismatch");
      }
      const zone = yield* readStationTimezone(read, id, token);
      return yield* decodeProvider(EnergyProfile)({
        ...automationValues(data),
        backupSocPercent: decimal(data.backupSOC),
        batteryChargeLimit: powerLimit(data.batteryMaxChargingPower),
        batteryDischargeLimit: powerLimit(data.batteryMaxDischargingPower),
        batteryDischargeSources: data.batteryDischargePriority,
        chargeSocPercent: decimal(data.chargeSOC),
        description: data.note,
        dischargeSocPercent: decimal(data.dischargeSOC),
        fetchedAt: yield* Clock.currentTimeMillis,
        gridExportEnabled: data.exportLimitation,
        gridExportLimit: powerLimit(data.maxExportLimitation),
        gridImportEnabled: data.importLimitation,
        gridImportLimit: powerLimit(data.maxImportLimitation),
        industrial: data.isIndustry,
        peakShaving: {
          providerControlMode: data.peakShavingVO.controlMode,
          reserveSocPercent: data.peakShavingVO.shavingSOC,
          slots: data.peakShavingVO.settingList.map((slot) => ({
            endTime: slot.endTime,
            peakPowerW: slot.peakPower * 1000,
            providerDays: slot.whichDay,
            startTime: slot.startTime,
          })),
        },
        preheating: preheatingValues(data.packPreheatingInfoVO),
        solarLimit: powerLimit(data.powerLimit),
        solarPriority: yield* priorityEntries(data.pvPriority),
        stationId: id,
        target,
        timezone: DateTime.zoneToString(zone),
      });
    });
  return {
    energyProfile,
    profileTemplates: templates,
    // The dedicated legacy priority endpoint returned an empty object. The app's current profile contains the authoritative list.
    solarPriority: (id: StationId, token: Redacted.Redacted<string>) =>
      energyProfile({ stationId: id, target: { kind: "current" } }, token).pipe(
        Effect.map((profile) => ({
          entries: profile.solarPriority,
          fetchedAt: profile.fetchedAt,
          stationId: id,
        }))
      ),
  };
};
