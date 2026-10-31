import { Schema, absurd } from "effect";

import { OperatingMode, Percent, StationId, Timestamp } from "./model.js";
import { isUnusedResidentialPreheatingPower } from "./preheating.js";
import { EnergyProfile, ProfileId } from "./profile.js";
import { ScheduleWindow, nonOverlappingWindows } from "./schedules.js";
import type { PowerLimit } from "./settings.js";

const Name = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(150),
  Schema.isPattern(/^[\p{L}\p{M}0-9 \-_():&,%，'、]+$/u),
  Schema.makeFilter((name) => name.trim() === name)
);
const Description = Schema.String.check(Schema.isMaxLength(500));
const Id = Schema.Int.check(Schema.isGreaterThan(0));
const Limit = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unlimited") }),
  Schema.Struct({
    kind: Schema.Literal("limited"),
    watts: Schema.Int.check(
      Schema.isBetween({ maximum: 4_294_967_294, minimum: 0 })
    ),
  }),
]);
const Group = {
  name: Name,
  providerActiveStatus: Schema.Literals([0, 1]),
  sourcePriority: Schema.Array(
    Schema.Literals(["pv", "grid", "battery"])
  ).check(
    Schema.isMaxLength(3),
    Schema.makeFilter((sources) => new Set(sources).size === sources.length)
  ),
  windows: Schema.Array(ScheduleWindow).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(64)
  ),
};
const BatteryGroup = Schema.Struct({
  ...Group,
  chargeCutoffPercent: Percent.check(Schema.isInt()),
  chargeLimit: Limit,
  dischargeCutoffPercent: Percent.check(Schema.isInt()),
  dischargeLimit: Limit,
  gridChargeLimit: Limit,
  gridExportLimit: Limit,
  providerMode: Schema.Literals([0, 1, 3, 6]),
}).check(
  Schema.makeFilter((group) => {
    if (group.dischargeCutoffPercent > group.chargeCutoffPercent) {
      return false;
    }
    // App bkH(): inactive fields have neutral defaults; do not accept conflicting mode instructions.
    switch (group.providerMode) {
      case 0: {
        return (
          group.dischargeCutoffPercent === 0 &&
          group.dischargeLimit.kind === "unlimited" &&
          group.gridExportLimit.kind === "unlimited"
        );
      }
      case 1: {
        return (
          group.chargeCutoffPercent === 100 &&
          group.chargeLimit.kind === "unlimited" &&
          group.gridChargeLimit.kind === "unlimited"
        );
      }
      case 6: {
        return (
          group.dischargeCutoffPercent === 0 &&
          group.chargeCutoffPercent === 100 &&
          [
            group.chargeLimit,
            group.dischargeLimit,
            group.gridChargeLimit,
            group.gridExportLimit,
          ].every((limit) => limit.kind === "unlimited")
        );
      }
      case 3: {
        return (
          group.dischargeCutoffPercent === 0 &&
          group.chargeCutoffPercent === 100 &&
          group.gridChargeLimit.kind === "unlimited" &&
          group.gridExportLimit.kind === "unlimited"
        );
      }
      default: {
        return absurd(group.providerMode);
      }
    }
  })
);
const GridGroup = Schema.Struct({
  ...Group,
  exportLimit: Limit,
  importLimit: Limit,
  providerMode: Schema.Literals([0, 1, 2]),
}).check(
  Schema.makeFilter(
    (group) =>
      (group.providerMode !== 1 || group.exportLimit.kind === "unlimited") &&
      (group.providerMode !== 2 || group.importLimit.kind === "unlimited")
  )
);
export const AutomationReplacement = Schema.Struct({
  batteryEnabled: Schema.Boolean,
  batteryGroups: Schema.Array(BatteryGroup).check(Schema.isMaxLength(64)),
  gridEnabled: Schema.Boolean,
  gridGroups: Schema.Array(GridGroup).check(Schema.isMaxLength(64)),
  timezone: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
}).check(
  Schema.makeFilter(
    (value) =>
      (!value.batteryEnabled || value.batteryGroups.length > 0) &&
      (!value.gridEnabled || value.gridGroups.length > 0) &&
      nonOverlappingWindows(
        value.batteryGroups.flatMap((group) => group.windows)
      ) &&
      nonOverlappingWindows(value.gridGroups.flatMap((group) => group.windows))
  )
);
const Edits = Schema.Struct({
  automation: Schema.optionalKey(AutomationReplacement),
  description: Schema.optionalKey(Description),
  name: Schema.optionalKey(Name),
}).check(Schema.makeFilter((value) => Object.keys(value).length > 0));
export const ProfileChange = Schema.Union([
  Schema.Struct({
    description: Description,
    name: Name,
    operation: Schema.Literal("create_energy_profile"),
    source: Schema.Struct({
      kind: Schema.Literal("template"),
      profileId: ProfileId,
      providerMode: Schema.Int,
    }),
  }),
  Schema.Struct({
    edits: Edits,
    operation: Schema.Literal("update_energy_profile"),
    profileId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("delete_energy_profile"),
    profileId: Id,
  }),
  Schema.Struct({
    operation: Schema.Literal("replace_automation_schedule"),
    replacement: AutomationReplacement,
  }),
]);
export type ProfileChange = typeof ProfileChange.Type;
export const isProfileChange = (change: {
  readonly operation: string;
}): change is ProfileChange =>
  change.operation === "create_energy_profile" ||
  change.operation === "update_energy_profile" ||
  change.operation === "delete_energy_profile" ||
  change.operation === "replace_automation_schedule";
const { fetchedAt: _fetchedAt, ...ConfigurationFields } = EnergyProfile.fields;
export const ProfileConfiguration = Schema.Struct(ConfigurationFields);
export type ProfileConfiguration = typeof ProfileConfiguration.Type;
export const ProfileControlSnapshot = Schema.Struct({
  kind: Schema.Literal("profile"),
  settings: Schema.Struct({
    currentMode: Schema.Struct({
      profileId: OperatingMode.fields.profileId,
      providerMode: OperatingMode.fields.providerMode,
    }),
    fetchedAt: Timestamp,
    profiles: Schema.Array(
      Schema.Struct({ name: Schema.String, profileId: Id })
    ).check(
      Schema.isMaxLength(256),
      Schema.makeFilter(
        (profiles) =>
          new Set(profiles.map((profile) => profile.profileId)).size ===
          profiles.length
      )
    ),
    selected: Schema.NullOr(ProfileConfiguration),
    source: Schema.NullOr(ProfileConfiguration),
    stationId: StationId,
  }),
});
export type ProfileControlSnapshot = typeof ProfileControlSnapshot.Type;

export const proposedProfile = (
  change: ProfileChange,
  current: ProfileConfiguration
): ProfileConfiguration => {
  if (change.operation === "create_energy_profile") {
    return {
      ...current,
      description: change.description,
      profileName: change.name,
      providerActiveStatus: 0,
    };
  }
  if (change.operation === "update_energy_profile") {
    return {
      ...current,
      ...change.edits.automation,
      description: change.edits.description ?? current.description,
      profileName: change.edits.name ?? current.profileName,
    };
  }
  return change.operation === "replace_automation_schedule"
    ? { ...current, ...change.replacement }
    : current;
};
// Canonical JSON projection of an already decoded configuration, not input validation.
/* eslint-disable anti-slop/no-runtime-typeof */
const canonicalProfileValue = (value: Schema.Json) =>
  // Provider kW round trips can introduce sub-microwatt floating point noise (1001 W -> 1.001 kW).
  JSON.stringify(value, (_key, item: Schema.Json) => {
    if (typeof item === "number") {
      return Number(item.toFixed(6));
    }
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item).toSorted(([left], [right]) =>
          left.localeCompare(right)
        )
      );
    }
    return item;
  });
/* eslint-enable anti-slop/no-runtime-typeof */
export const profileSettingsEqual = (
  left: Schema.Json,
  right: Schema.Json
): boolean => canonicalProfileValue(left) === canonicalProfileValue(right);
const configuration = (value: ProfileConfiguration) => {
  const {
    target: _target,
    providerProfileId: _id,
    providerActiveStatus: _active,
    ...rest
  } = value;
  return canonicalProfileValue({
    ...rest,
    // Residential templates return mode 1; populated schedules return blank unused powers.
    preheating:
      !value.industrial &&
      !value.preheating.industrial &&
      [null, 1].includes(value.preheating.providerMode)
        ? {
            ...value.preheating,
            providerMode: null,
            slots: value.preheating.slots.map((slot) => ({
              ...slot,
              providerChargingPower: isUnusedResidentialPreheatingPower(
                slot.providerChargingPower
              )
                ? null
                : slot.providerChargingPower,
              providerDischargePower: isUnusedResidentialPreheatingPower(
                slot.providerDischargePower
              )
                ? null
                : slot.providerDischargePower,
            })),
          }
        : value.preheating,
  });
};

export const profileControlMatches = (
  change: ProfileChange,
  observed: ProfileControlSnapshot,
  reviewed: ProfileControlSnapshot | undefined
): boolean => {
  if (reviewed === undefined) {
    return false;
  }
  const after = observed.settings;
  const before = reviewed.settings;
  if (
    JSON.stringify(after.currentMode) !== JSON.stringify(before.currentMode)
  ) {
    return false;
  }
  if (change.operation === "delete_energy_profile") {
    return (
      before.selected !== null &&
      after.selected === null &&
      !after.profiles.some((profile) => profile.profileId === change.profileId)
    );
  }
  const source =
    change.operation === "create_energy_profile"
      ? before.source
      : before.selected;
  if (source === null || after.selected === null) {
    return false;
  }
  if (
    change.operation === "create_energy_profile" &&
    before.profiles.some(
      (profile) => profile.profileId === after.selected?.providerProfileId
    )
  ) {
    return false;
  }
  const expected = proposedProfile(change, source);
  return (
    after.selected.providerActiveStatus === expected.providerActiveStatus &&
    configuration(after.selected) === configuration(expected)
  );
};

export const providerPower = (limit: typeof PowerLimit.Type): string => {
  if (limit.kind === "unset") {
    return "";
  }
  return limit.kind === "unlimited"
    ? "4294967.295"
    : String(limit.watts / 1000);
};
const percent = (value: number | null) => (value === null ? "" : String(value));
const windowBody = (window: {
  startTime: string;
  endTime: string;
  providerDays: string;
}) => ({
  endTime: window.endTime,
  startTime: window.startTime,
  whichDay: window.providerDays,
});
// Exactly the app's profile E() serializer. No caller-supplied paths or arbitrary JSON.
export const profileBody = (
  profile: ProfileConfiguration
): Readonly<Record<string, Schema.Json>> => ({
  activeStatus: profile.providerActiveStatus,
  backupSOC: percent(profile.backupSocPercent),
  batteryAutomationGroupVOList: profile.batteryGroups.map((group) => ({
    activeStatus: group.providerActiveStatus,
    b2GMaxDischargePower: providerPower(group.gridExportLimit),
    chargeCutOffSoc: percent(group.chargeCutoffPercent),
    dischargeCutOffSoc: percent(group.dischargeCutoffPercent),
    g2BMaxChargePower: providerPower(group.gridChargeLimit),
    itemVOList: group.windows.map(windowBody),
    maxChargePower: providerPower(group.chargeLimit),
    maxDischargePower: providerPower(group.dischargeLimit),
    name: group.name,
    priorityList: [...group.sourcePriority],
    winMode: group.providerMode,
  })),
  batteryDischargePriority: [...profile.batteryDischargeSources],
  batteryGlobalActive: profile.batteryEnabled,
  batteryMaxChargingPower: providerPower(profile.batteryChargeLimit),
  batteryMaxDischargingPower: providerPower(profile.batteryDischargeLimit),
  chargeSOC: percent(profile.chargeSocPercent),
  dischargeSOC: percent(profile.dischargeSocPercent),
  exportLimitation: profile.gridExportEnabled,
  gridAutomationGroupVOList: profile.gridGroups.map((group) => ({
    activeStatus: group.providerActiveStatus,
    itemVOList: group.windows.map(windowBody),
    maxBuyPower: providerPower(group.importLimit),
    maxSellPower: providerPower(group.exportLimit),
    name: group.name,
    priorityList: [...group.sourcePriority],
    winMode: group.providerMode,
  })),
  gridGlobalActive: profile.gridEnabled,
  importLimitation: profile.gridImportEnabled,
  maxExportLimitation: providerPower(profile.gridExportLimit),
  maxImportLimitation: providerPower(profile.gridImportLimit),
  name: profile.profileName,
  note: profile.description,
  packPreheatingInfoVO: {
    isAutoModeValid: profile.preheating.automaticModeValid,
    isIndustry: profile.industrial,
    packPreheatingSwitch: profile.preheating.providerSwitch,
    packPreheatingVOList: profile.preheating.slots.map((slot) => ({
      chargingPower: profile.industrial ? slot.providerChargingPower : null,
      dischargePower: profile.industrial ? slot.providerDischargePower : null,
      duration: slot.providerDuration,
      periodConfig: [...slot.providerPeriods],
      startTime: slot.providerStartTime,
    })),
    preHeatingEnablesSwitch: profile.preheating.providerEnableSwitch,
    preheatingMode: profile.industrial ? profile.preheating.providerMode : null,
  },
  peakShavingVO: {
    controlMode: profile.peakShaving.providerControlMode,
    settingList: profile.peakShaving.slots.map((slot) => ({
      ...windowBody(slot),
      peakPower: slot.peakPowerW / 1000,
    })),
    shavingSOC: profile.peakShaving.reserveSocPercent,
  },
  powerLimit: providerPower(profile.solarLimit),
  profileId: profile.providerProfileId,
  pvPriority: profile.solarPriority.map((entry) => ({
    loadsType: entry.providerLoadType,
    priority: entry.providerPriority,
    sgDeviceType: entry.providerDeviceType,
    smartLoadsPath: entry.smartLoadPath,
  })),
  stationId: Number(profile.stationId),
});
