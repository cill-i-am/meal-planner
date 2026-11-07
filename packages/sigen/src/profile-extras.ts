import { Effect, Schema } from "effect";
import type { Redacted } from "effect";

import { Percent, failure } from "./model.js";
import { makeProfileClient } from "./profile-client.js";
import type { ProfileConfiguration } from "./profile-controls.js";
import type { ProviderRead } from "./provider-read.js";
import { ScheduleWindow, nonOverlappingWindows } from "./schedules.js";

const Sources = Schema.Array(Schema.Literals(["pv", "grid"])).check(
  Schema.isMinLength(2),
  Schema.isMaxLength(2),
  Schema.makeFilter((sources) => new Set(sources).size === sources.length)
);
const Priority = Schema.Struct({
  providerDeviceType: Schema.NullOr(Schema.Literal(4)),
  providerLoadType: Schema.Literals([1, 3, 4]),
  providerPriority: Schema.Int,
  smartLoadPath: Schema.Null,
});
export const ProfilePriorities = Schema.Struct({
  batteryDischargeSources: Schema.optionalKey(Sources),
  solarPriority: Schema.optionalKey(
    Schema.Array(Priority).check(Schema.isMinLength(1), Schema.isMaxLength(64))
  ),
}).check(Schema.makeFilter((value) => Object.keys(value).length > 0));
export type ProfilePriorities = typeof ProfilePriorities.Type;

const PeakSlot = Schema.Struct({
  ...ScheduleWindow.fields,
  peakPowerW: Schema.Int.check(
    Schema.isBetween({ maximum: 4_294_967_294, minimum: 0 })
  ),
}).check(Schema.makeFilter((slot) => Schema.is(ScheduleWindow)(slot)));
export const ProfileSchedules = Schema.Struct({
  peakShaving: Schema.optionalKey(
    Schema.Struct({
      enabled: Schema.Boolean,
      reserveSocPercent: Percent.check(Schema.isInt()),
      slots: Schema.Array(PeakSlot).check(
        Schema.isMaxLength(12),
        Schema.makeFilter(nonOverlappingWindows)
      ),
    }).check(
      Schema.makeFilter((value) => !value.enabled || value.slots.length > 0)
    )
  ),
  preheating: Schema.optionalKey(
    Schema.Struct({
      enabled: Schema.Boolean,
      windows: Schema.Array(ScheduleWindow).check(
        Schema.isMaxLength(4),
        Schema.makeFilter(nonOverlappingWindows)
      ),
    }).check(
      Schema.makeFilter((value) => !value.enabled || value.windows.length > 0)
    )
  ),
  timezone: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
}).check(
  Schema.makeFilter(
    (value) => value.peakShaving !== undefined || value.preheating !== undefined
  )
);
export type ProfileSchedules = typeof ProfileSchedules.Type;
const priorityKey = (entry: typeof Priority.Type) =>
  JSON.stringify([
    entry.providerLoadType,
    entry.providerDeviceType,
    entry.smartLoadPath,
  ]);
export const applyProfilePriorities = (
  profile: ProfileConfiguration,
  priorities: ProfilePriorities
): ProfileConfiguration => ({
  ...profile,
  batteryDischargeSources:
    priorities.batteryDischargeSources ?? profile.batteryDischargeSources,
  solarPriority: profile.solarPriority.map((entry) => ({
    ...entry,
    providerPriority:
      priorities.solarPriority?.find(
        (proposed) =>
          priorityKey(proposed) ===
          JSON.stringify([
            entry.providerLoadType,
            entry.providerDeviceType,
            entry.smartLoadPath,
          ])
      )?.providerPriority ?? entry.providerPriority,
  })),
});
const minutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const applyProfileSchedules = (
  profile: ProfileConfiguration,
  schedules: ProfileSchedules
): ProfileConfiguration => ({
  ...profile,
  peakShaving:
    schedules.peakShaving === undefined
      ? profile.peakShaving
      : {
          providerControlMode: schedules.peakShaving.enabled ? 1 : 0,
          reserveSocPercent: schedules.peakShaving.reserveSocPercent,
          slots: schedules.peakShaving.slots,
        },
  preheating:
    schedules.preheating === undefined
      ? profile.preheating
      : {
          ...profile.preheating,
          providerMode: null,
          providerSwitch: schedules.preheating.enabled ? 1 : 0,
          slots: schedules.preheating.windows.map((window) => ({
            providerChargingPower: null,
            providerDischargePower: null,
            providerDuration:
              minutes(window.endTime) - minutes(window.startTime),
            providerPeriods: window.providerDays.split(",").map(Number),
            providerStartTime: minutes(window.startTime),
          })),
        },
});
const sameMembers = (
  left: readonly (string | number)[],
  right: readonly (string | number)[]
) =>
  JSON.stringify([...left].toSorted()) ===
  JSON.stringify([...right].toSorted());
const validateSolar = (
  entries: NonNullable<ProfilePriorities["solarPriority"]>,
  profile: ProfileConfiguration
) => {
  const current = profile.solarPriority;
  if (
    current.some(
      (entry) =>
        entry.group ||
        entry.groupPath.length !== 1 ||
        ![0, 2].includes(entry.providerStatus) ||
        ![1, 3, 4].includes(entry.providerLoadType) ||
        ![null, 4].includes(entry.providerDeviceType) ||
        entry.smartLoadPath !== null
    )
  ) {
    return failure("UnsupportedCapability");
  }
  const currentKeys = current.map((entry) =>
    JSON.stringify([
      entry.providerLoadType,
      entry.providerDeviceType,
      entry.smartLoadPath,
    ])
  );
  const keys = entries.map(priorityKey);
  if (
    new Set(keys).size !== keys.length ||
    new Set(currentKeys).size !== currentKeys.length ||
    !sameMembers(keys, currentKeys) ||
    !sameMembers(
      entries.map((entry) => entry.providerPriority),
      current.map((entry) => entry.providerPriority)
    )
  ) {
    return failure("InvalidInput");
  }
  if (
    current.some(
      (entry, index) =>
        entry.providerStatus !== 0 &&
        entries.find(
          (candidate) => priorityKey(candidate) === currentKeys[index]
        )?.providerPriority !== entry.providerPriority
    )
  ) {
    return failure("UnsupportedCapability");
  }
  return Effect.void;
};
const validateSchedules = (
  profile: ProfileConfiguration,
  hasBatterySetting: boolean,
  schedules: ProfileSchedules | undefined
) => {
  if (schedules === undefined) {
    return Effect.void;
  }
  if (!hasBatterySetting) {
    return failure("UnsupportedCapability");
  }
  if (schedules.timezone !== profile.timezone) {
    return failure("InvalidInput");
  }
  const peak = schedules.peakShaving;
  if (peak?.enabled) {
    const charge = profile.chargeSocPercent;
    const discharge = profile.dischargeSocPercent;
    const backup = profile.backupSocPercent;
    if (charge === null || discharge === null || backup === null) {
      return failure("UnsupportedCapability");
    }
    if (
      peak.reserveSocPercent > charge ||
      peak.reserveSocPercent < Math.max(discharge, backup)
    ) {
      return failure("InvalidInput");
    }
  }
  return Effect.void;
};
export const validateProfileExtras = (
  read: ProviderRead,
  profile: ProfileConfiguration,
  token: Redacted.Redacted<string>,
  priorities?: ProfilePriorities,
  schedules?: ProfileSchedules
) =>
  Effect.gen(function* validateInactiveProfileExtras() {
    const capabilities = yield* makeProfileClient(read).energyCapabilities(
      profile.stationId,
      token
    );
    const features = capabilities.providerFeatures;
    if (!features.support || features.isIndustry) {
      return yield* failure("UnsupportedCapability");
    }
    if (
      priorities?.batteryDischargeSources !== undefined &&
      (!features.hasBatteryPriority ||
        !sameMembers(
          priorities.batteryDischargeSources,
          profile.batteryDischargeSources
        ) ||
        priorities.batteryDischargeSources.some(
          (source) => !capabilities.batterySourceOptions.includes(source)
        ))
    ) {
      return yield* failure("UnsupportedCapability");
    }
    if (priorities?.solarPriority !== undefined) {
      if (!features.hasPVPriority) {
        return yield* failure("UnsupportedCapability");
      }
      yield* validateSolar(priorities.solarPriority, profile);
    }
    yield* validateSchedules(profile, features.hasBatterySetting, schedules);
  });
