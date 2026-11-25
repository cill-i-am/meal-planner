import { Clock, Effect, Schema, absurd } from "effect";
import type { Redacted } from "effect";

import type { ControlChange, ControlSnapshot } from "./controls.js";
import { makeEnergyProfileClient } from "./energy-profile-client.js";
import {
  powerString,
  writeBatteryPower,
  writeBatteryThresholds,
  writeGridPower,
  writeSolarPower,
} from "./limit-writes.js";
import { makeLoadControls, isLoadControlChange } from "./load-controls.js";
import type { LoadControlChange } from "./load-controls.js";
import { makeLoadsClient } from "./loads-client.js";
import { OperatingMode, failure } from "./model.js";
import type { SigenFailure, StationId } from "./model.js";
import { makeProfileClient } from "./profile-client.js";
import { makeProfileControlsClient } from "./profile-controls-client.js";
import type { ProfileChange } from "./profile-controls.js";
import { isProfileChange } from "./profile-controls.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";
import type { ScheduledSettingsChange } from "./scheduled-settings-controls.js";
import {
  makeScheduledSettingsControls,
  isScheduledSettingsChange,
} from "./scheduled-settings-controls.js";
import { ScheduleWindow, nonOverlappingWindows } from "./schedules.js";
import {
  makeSettingsClient,
  readBatterySocSettings,
  readManualOverrideState,
  writeBackupReserve,
} from "./settings-client.js";
import type { BatterySocSettings } from "./settings.js";
import { samePeakShavingPreset } from "./settings.js";
import { makeTimeOfUseControls } from "./time-of-use.js";
import type { TimeOfUseChange } from "./time-of-use.js";

export type ProviderWrite = (
  method: "PUT" | "POST" | "PATCH" | "DELETE",
  path: string,
  body: Readonly<Record<string, Schema.Json>> | null,
  token: Redacted.Redacted<string>,
  acknowledgement?: "boolean_true"
) => Effect.Effect<void, SigenFailure>;
const requiresBattery = (change: ControlChange, snapshot: ControlSnapshot) =>
  change.operation === "set_active_energy_profile_parameters" ||
  (change.operation === "set_active_energy_profile_limits" &&
    (change.setting.kind === "battery_power" ||
      change.setting.kind === "battery_soc")) ||
  [
    "battery",
    "peak_shaving",
    "manual",
    "battery_priority",
    "preheating",
    "time_of_use",
  ].includes(snapshot.kind);
const requiresSolar = (change: ControlChange, snapshot: ControlSnapshot) =>
  snapshot.kind === "solar" ||
  snapshot.kind === "solar_priority" ||
  (change.operation === "set_active_energy_profile_limits" &&
    change.setting.kind === "solar_power") ||
  (change.operation === "set_energy_profile_parameters" &&
    change.parameters.solarLimit !== undefined);
const peakShavingBody = (
  change: Extract<ControlChange, { operation: "set_peak_shaving_schedule" }>
) => ({
  controlMode: change.enabled ? 1 : 0,
  settingList: change.enabled
    ? change.slots.map((slot) => ({
        endTime: slot.endTime,
        peakPower: slot.peakPowerW / 1000,
        startTime: slot.startTime,
        whichDay: slot.providerDays,
      }))
    : [],
  shavingSOC: change.enabled ? change.reserveSocPercent : 0,
});

const validatePeakReserve = (
  reserveSocPercent: number,
  levels: typeof BatterySocSettings.Type
) => {
  const { backupSocPercent, chargeSocPercent, dischargeSocPercent } = levels;
  if (
    backupSocPercent === null ||
    chargeSocPercent === null ||
    dischargeSocPercent === null
  ) {
    const checkedResult: Effect.Effect<void, SigenFailure> = failure(
      "UnsupportedCapability"
    );
    return checkedResult;
  }
  {
    const checkedResult: Effect.Effect<void, SigenFailure> =
      reserveSocPercent < Math.max(backupSocPercent, dischargeSocPercent) ||
      reserveSocPercent > chargeSocPercent
        ? failure("InvalidInput")
        : Effect.void;
    return checkedResult;
  }
};

const validatePeakSchedule = (
  change: Extract<ControlChange, { operation: "set_peak_shaving_schedule" }>,
  snapshot: ControlSnapshot
) => {
  if (snapshot.kind !== "peak_shaving") {
    const checkedResult: SigenFailure | null = failure("SchemaMismatch");
    return checkedResult;
  }
  const value = snapshot.settings;
  if (value.providerControlMode !== 0 && value.providerControlMode !== 1) {
    const checkedResult: SigenFailure | null = failure("UnsupportedCapability");
    return checkedResult;
  }
  if (change.enabled && change.slots.length === 0) {
    const checkedResult: SigenFailure | null = failure("InvalidInput");
    return checkedResult;
  }
  if (change.timezone !== value.timezone) {
    const checkedResult: SigenFailure | null = failure("InvalidInput");
    return checkedResult;
  }

  if (!change.enabled) {
    const checkedResult: SigenFailure | null = samePeakShavingPreset(
      change,
      value
    )
      ? null
      : failure("InvalidInput");
    return checkedResult;
  }
  {
    const checkedResult: SigenFailure | null =
      change.slots.length <= 12 &&
      change.slots.every(Schema.is(ScheduleWindow)) &&
      nonOverlappingWindows(change.slots)
        ? null
        : failure("UnsupportedCapability");
    return checkedResult;
  }
};

const validateSocSnapshot = (snapshot: ControlSnapshot) => {
  if (snapshot.kind !== "battery") {
    const checkedResult: SigenFailure | null = failure("SchemaMismatch");
    return checkedResult;
  }
  const value = snapshot.settings;
  {
    const checkedResult: SigenFailure | null =
      value.chargeSocPercent === null ||
      value.dischargeSocPercent === null ||
      value.backupSocPercent === null ||
      value.peakShavingSocPercent === null
        ? failure("UnsupportedCapability")
        : null;
    return checkedResult;
  }
};

const validateGridPower = (
  change: Extract<
    ControlChange,
    { operation: "set_grid_export_limit" | "set_grid_import_limit" }
  >,
  snapshot: ControlSnapshot
) => {
  if (snapshot.kind !== "grid") {
    const checkedResult: SigenFailure | null = failure("SchemaMismatch");
    return checkedResult;
  }
  const ceiling = (
    change.operation === "set_grid_export_limit"
      ? snapshot.settings.exportPower
      : snapshot.settings.importPower
  ).installer;
  if (ceiling.kind === "unset") {
    const checkedResult: SigenFailure | null = failure("UnsupportedCapability");
    return checkedResult;
  }
  {
    const checkedResult: SigenFailure | null =
      ceiling.kind === "limited" && change.watts > ceiling.watts
        ? failure("InvalidInput")
        : null;
    return checkedResult;
  }
};

const validateGridCurrent = (
  change: Extract<ControlChange, { operation: "set_grid_connection_current" }>,
  snapshot: ControlSnapshot
) => {
  if (snapshot.kind !== "grid") {
    const checkedResult: SigenFailure | null = failure("SchemaMismatch");
    return checkedResult;
  }
  const ceiling = snapshot.settings.connectionCurrent.installerAmps;
  if (ceiling === null) {
    const checkedResult: SigenFailure | null = failure("UnsupportedCapability");
    return checkedResult;
  }
  {
    const checkedResult: SigenFailure | null =
      change.amperes > ceiling ? failure("InvalidInput") : null;
    return checkedResult;
  }
};
const validateSmartLoad = (
  change: Extract<ControlChange, { operation: "set_smart_load_switch" }>,
  snapshot: ControlSnapshot
) => {
  if (snapshot.kind !== "smart_load") {
    const checkedResult: SigenFailure | null = failure("SchemaMismatch");
    return checkedResult;
  }
  const { load } = snapshot.settings;
  if (load.key !== change.loadKey || load.path !== change.loadPath) {
    const checkedResult: SigenFailure | null = failure("PermissionDenied");
    return checkedResult;
  }
  {
    const checkedResult: SigenFailure | null =
      load.controllable === true &&
      load.providerRunMode === 1 &&
      (load.providerManualSwitch === 0 || load.providerManualSwitch === 1)
        ? null
        : failure("UnsupportedCapability");
    return checkedResult;
  }
};
const validateBatteryPriority = (
  change: Extract<
    ControlChange,
    { operation: "set_battery_discharge_priority" }
  >,
  snapshot: ControlSnapshot
) => {
  if (snapshot.kind !== "battery_priority") {
    const checkedResult: SigenFailure | null = failure("SchemaMismatch");
    return checkedResult;
  }
  {
    const checkedResult: SigenFailure | null =
      JSON.stringify([...snapshot.settings.providerSources].toSorted()) ===
      JSON.stringify([...change.sources].toSorted())
        ? null
        : failure("UnsupportedCapability");
    return checkedResult;
  }
};
const validateSolarPriority = (
  change: Extract<ControlChange, { operation: "set_solar_priority" }>,
  snapshot: ControlSnapshot
) => {
  if (snapshot.kind !== "solar_priority") {
    const checkedResult: SigenFailure | null = failure("SchemaMismatch");
    return checkedResult;
  }
  const current = snapshot.settings.entries;
  const key = (entry: (typeof change.entries)[number]) =>
    JSON.stringify([
      entry.providerLoadType,
      entry.providerDeviceType,
      entry.smartLoadPath,
    ]);
  if (current.some((entry) => entry.group || entry.groupPath.length !== 1)) {
    const checkedResult: SigenFailure | null = failure("UnsupportedCapability");
    return checkedResult;
  }
  if (
    current.some(
      (entry) =>
        ![0, 2].includes(entry.providerStatus) ||
        ![1, 3, 4].includes(entry.providerLoadType) ||
        ![null, 4].includes(entry.providerDeviceType) ||
        entry.smartLoadPath !== null
    )
  ) {
    const checkedResult: SigenFailure | null = failure("UnsupportedCapability");
    return checkedResult;
  }
  if (
    current.some(
      (entry) =>
        entry.providerStatus !== 0 &&
        change.entries.find((value) => key(value) === key(entry))
          ?.providerPriority !== entry.providerPriority
    )
  ) {
    const checkedResult: SigenFailure | null = failure("UnsupportedCapability");
    return checkedResult;
  }
  const keys = change.entries.map(key);
  const sameKeys =
    current.length === keys.length &&
    new Set(current.map(key)).size === current.length &&
    new Set(keys).size === keys.length &&
    current.every((entry) => keys.includes(key(entry)));
  const priorities = change.entries
    .map((entry) => entry.providerPriority)
    .toSorted((a, b) => a - b);
  {
    const checkedResult: SigenFailure | null =
      sameKeys &&
      JSON.stringify(priorities) ===
        JSON.stringify(
          current
            .map((entry) => entry.providerPriority)
            .toSorted((a, b) => a - b)
        )
        ? null
        : failure("InvalidInput");
    return checkedResult;
  }
};

const validateExistingOwnerLimits = (
  change: Exclude<
    ControlChange,
    | ProfileChange
    | ScheduledSettingsChange
    | LoadControlChange
    | TimeOfUseChange
  >,
  snapshot: ControlSnapshot
) => {
  switch (change.operation) {
    case "set_grid_export_limit":
    case "set_grid_import_limit": {
      const checkedResult: SigenFailure | null = validateGridPower(
        change,
        snapshot
      );
      return checkedResult;
    }

    case "set_grid_connection_current": {
      const checkedResult: SigenFailure | null = validateGridCurrent(
        change,
        snapshot
      );
      return checkedResult;
    }
    case "set_battery_soc_thresholds": {
      const checkedResult: SigenFailure | null = validateSocSnapshot(snapshot);
      return checkedResult;
    }
    case "set_peak_shaving_schedule": {
      const checkedResult: SigenFailure | null = validatePeakSchedule(
        change,
        snapshot
      );
      return checkedResult;
    }
    case "set_battery_export": {
      if (snapshot.kind !== "battery") {
        const checkedResult: SigenFailure | null = failure("SchemaMismatch");
        return checkedResult;
      }
      {
        const checkedResult: SigenFailure | null =
          change.enabled && snapshot.settings.export.installerEnabled !== true
            ? failure("PermissionDenied")
            : null;
        return checkedResult;
      }
    }
    case "set_smart_load_switch": {
      const checkedResult: SigenFailure | null = validateSmartLoad(
        change,
        snapshot
      );
      return checkedResult;
    }
    case "set_battery_discharge_priority": {
      const checkedResult: SigenFailure | null = validateBatteryPriority(
        change,
        snapshot
      );
      return checkedResult;
    }
    case "set_solar_priority": {
      const checkedResult: SigenFailure | null = validateSolarPriority(
        change,
        snapshot
      );
      return checkedResult;
    }
    case "start_manual_override":
    case "stop_manual_override":
    case "set_backup_reserve":
    case "set_battery_power_limits":
    case "set_solar_power_limit":
    case "set_operating_mode": {
      const checkedResult: SigenFailure | null = null;
      return checkedResult;
    }
    default: {
      const checkedResult: SigenFailure | null = absurd<never>(change);
      return checkedResult;
    }
  }
};

const validateOwnerLimits = (
  change: ControlChange,
  snapshot: ControlSnapshot
) => {
  if (
    isProfileChange(change) ||
    isScheduledSettingsChange(change) ||
    isLoadControlChange(change) ||
    change.operation === "activate_time_of_use_mode"
  ) {
    const checkedResult: SigenFailure | null = null;
    return checkedResult;
  }
  {
    const checkedResult: SigenFailure | null = validateExistingOwnerLimits(
      change,
      snapshot
    );
    return checkedResult;
  }
};
export const makeControlsClient = (
  read: ProviderRead,
  write: ProviderWrite
) => {
  const timeOfUse = makeTimeOfUseControls(read, write);
  const scheduledSettings = makeScheduledSettingsControls(read, write);
  const profileControls = makeProfileControlsClient(read, write);
  const settings = makeSettingsClient(read);
  const loads = makeLoadsClient(read);
  const loadControls = makeLoadControls(read, write);
  const profiles = makeProfileClient(read);
  const energyProfiles = makeEnergyProfileClient(read);
  const inspectControl = (
    stationId: StationId,
    change: ControlChange,
    token: Redacted.Redacted<string>
  ) => {
    if (change.operation === "activate_time_of_use_mode") {
      const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
        timeOfUse.inspect(stationId, token);
      return checkedResult;
    }
    if (isLoadControlChange(change)) {
      const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
        loadControls.inspect(stationId, change, token);
      return checkedResult;
    }
    if (isProfileChange(change)) {
      const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
        profileControls.inspect(stationId, change, token);
      return checkedResult;
    }
    if (isScheduledSettingsChange(change)) {
      const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
        scheduledSettings.inspect(stationId, change, token);
      return checkedResult;
    }
    switch (change.operation) {
      case "set_smart_load_switch": {
        const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
          loads
            .smartLoad({ loadPath: change.loadPath, stationId }, token)
            .pipe(
              Effect.map((value) => ({ kind: "smart_load", settings: value }))
            );
        return checkedResult;
      }
      case "set_battery_discharge_priority": {
        const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
          profiles.batteryDischargePriority(stationId, token).pipe(
            Effect.map((value) => ({
              kind: "battery_priority",
              settings: value,
            }))
          );
        return checkedResult;
      }
      case "set_solar_priority": {
        const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
          energyProfiles.solarPriority(stationId, token).pipe(
            Effect.map((value) => ({
              kind: "solar_priority",
              settings: value,
            }))
          );
        return checkedResult;
      }
      case "set_battery_soc_thresholds":
      case "set_backup_reserve":
      case "set_battery_power_limits":
      case "set_battery_export": {
        const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
          settings
            .batterySettings(stationId, token)
            .pipe(
              Effect.map((value) => ({ kind: "battery", settings: value }))
            );
        return checkedResult;
      }
      case "set_peak_shaving_schedule": {
        const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
          settings.peakShavingSchedule(stationId, token).pipe(
            Effect.map((value) => ({
              kind: "peak_shaving",
              settings: value,
            }))
          );
        return checkedResult;
      }
      case "start_manual_override":
      case "stop_manual_override": {
        const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
          readManualOverrideState(read, stationId, token).pipe(
            Effect.map((value) => ({
              kind: "manual",
              settings: value,
            }))
          );
        return checkedResult;
      }
      case "set_solar_power_limit": {
        const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
          settings
            .solarSettings(stationId, token)
            .pipe(Effect.map((value) => ({ kind: "solar", settings: value })));
        return checkedResult;
      }
      case "set_grid_export_limit":
      case "set_grid_import_limit":
      case "set_grid_connection_current": {
        const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
          settings
            .gridSettings(stationId, token)
            .pipe(Effect.map((value) => ({ kind: "grid", settings: value })));
        return checkedResult;
      }
      case "set_operating_mode": {
        const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
          read(`/device/energy-profile/mode/current/${stationId}`, token).pipe(
            Effect.flatMap(
              decodeProvider(
                Schema.Struct({
                  currentMode: Schema.Number,
                  currentProfileId: Schema.Number,
                })
              )
            ),
            Effect.flatMap((value) =>
              Effect.gen(function* readModeSnapshot() {
                const mode = yield* decodeProvider(OperatingMode)({
                  fetchedAt: yield* Clock.currentTimeMillis,
                  profileId: value.currentProfileId,
                  providerMode: value.currentMode,
                  stationId,
                });
                if (change.providerMode !== 9) {
                  return mode;
                }
                const { fetchedAt: _fetchedAt, ...selectedProfile } =
                  yield* energyProfiles.energyProfile(
                    {
                      stationId,
                      target: { kind: "custom", profileId: change.profileId },
                    },
                    token
                  );
                return { ...mode, selectedProfile };
              })
            ),
            Effect.map((value) => ({ kind: "mode", settings: value }))
          );
        return checkedResult;
      }
      default: {
        const checkedResult: Effect.Effect<ControlSnapshot, SigenFailure> =
          absurd<never>(change);
        return checkedResult;
      }
    }
  };
  const validateExtendedControl = (
    stationId: StationId,
    change: ControlChange,
    snapshot: ControlSnapshot,
    token: Redacted.Redacted<string>
  ) => {
    if (change.operation === "activate_time_of_use_mode") {
      return snapshot.kind === "time_of_use" &&
        snapshot.settings.stationId === stationId
        ? timeOfUse.validate(snapshot, token)
        : failure("SchemaMismatch");
    }
    if (isLoadControlChange(change)) {
      return snapshot.kind === "smart_load_settings"
        ? loadControls.validate(change, snapshot)
        : failure("SchemaMismatch");
    }
    if (isProfileChange(change)) {
      return snapshot.kind === "profile"
        ? profileControls.validate(stationId, change, snapshot, token)
        : failure("SchemaMismatch");
    }
    if (isScheduledSettingsChange(change)) {
      return snapshot.kind === "preheating" || snapshot.kind === "energy_saving"
        ? scheduledSettings.validate(change, snapshot)
        : failure("SchemaMismatch");
    }
    return Effect.void;
  };
  const validateControl = (
    stationId: StationId,
    change: ControlChange,
    snapshot: ControlSnapshot,
    token: Redacted.Redacted<string>
  ) => {
    const checkedResult: Effect.Effect<void, SigenFailure> = Effect.gen(
      function* validateOwnerChange() {
        const equipment = yield* read(
          `/device/owner/station/home?stationId=${stationId}`,
          token
        ).pipe(
          Effect.flatMap(
            decodeProvider(
              Schema.Struct({
                batteryCapacity: Schema.NullOr(Schema.Finite),
                hasSolar: Schema.Boolean,
                stationId: Schema.Number,
              })
            )
          )
        );
        if (String(equipment.stationId) !== stationId) {
          return yield* failure("PermissionDenied");
        }
        if (
          requiresBattery(change, snapshot) &&
          (equipment.batteryCapacity === null || equipment.batteryCapacity <= 0)
        ) {
          return yield* failure("UnsupportedCapability");
        }
        if (requiresSolar(change, snapshot) && !equipment.hasSolar) {
          return yield* failure("UnsupportedCapability");
        }
        yield* validateExtendedControl(stationId, change, snapshot, token);
        const invalid = validateOwnerLimits(change, snapshot);
        if (invalid !== null) {
          return yield* invalid;
        }
        if (
          change.operation === "set_peak_shaving_schedule" &&
          change.enabled
        ) {
          yield* validatePeakReserve(
            change.reserveSocPercent,
            yield* readBatterySocSettings(read, stationId, token)
          );
        }
        if (change.operation === "set_battery_discharge_priority") {
          const capabilities = yield* profiles.energyCapabilities(
            stationId,
            token
          );
          if (
            !capabilities.providerFeatures.hasBatteryPriority ||
            change.sources.some(
              (source) => !capabilities.batterySourceOptions.includes(source)
            )
          ) {
            return yield* failure("UnsupportedCapability");
          }
        }
        if (change.operation === "set_solar_priority") {
          const capabilities = yield* profiles.energyCapabilities(
            stationId,
            token
          );
          if (!capabilities.providerFeatures.hasPVPriority) {
            return yield* failure("UnsupportedCapability");
          }
        }
        if (change.operation === "set_operating_mode") {
          const modes = yield* settings.operatingModes(stationId, token);
          const allowed =
            change.providerMode === 9
              ? modes.customProfiles.some(
                  (profile) => profile.profileId === change.profileId
                )
              : change.profileId === -1 &&
                modes.modes.some(
                  (mode) => mode.providerMode === String(change.providerMode)
                );
          if (!allowed) {
            return yield* failure("UnsupportedCapability");
          }
        }
      }
    );
    return checkedResult;
  };
  const dispatchExistingControl = (
    stationId: StationId,
    change: Exclude<
      ControlChange,
      | ProfileChange
      | ScheduledSettingsChange
      | LoadControlChange
      | TimeOfUseChange
    >,
    token: Redacted.Redacted<string>
  ) => {
    const id = { stationId: Number(stationId) };
    switch (change.operation) {
      case "set_smart_load_switch": {
        return write(
          "PATCH",
          `/third-party-device/tp-device/smart-loads/control-mode/manual/switch?stationId=${stationId}&loadPath=${change.loadPath}&manualSwitch=${change.enabled ? 1 : 0}`,
          null,
          token
        );
      }
      case "set_battery_discharge_priority": {
        return write(
          "PUT",
          "/device/energy-profile/battery/discharge/priority",
          { ...id, priority: [...change.sources] },
          token
        );
      }
      case "set_solar_priority": {
        return write(
          "PUT",
          "/device/energy-profile/solar/priority",
          {
            ...id,
            loadsPvPriorityList: change.entries.map((entry) => ({
              loadsType: entry.providerLoadType,
              priority: entry.providerPriority,
              sgDeviceType: entry.providerDeviceType,
              smartLoadsPath: entry.smartLoadPath,
            })),
          },
          token
        );
      }
      case "start_manual_override": {
        const modes = {
          charge: "0",
          discharge: "1",
          hold: "2",
          self_consumption: "3",
        };
        return write(
          "PUT",
          "/device/energy-profile/instant/manunal",
          {
            ...id,
            duration: String(change.durationMinutes),
            enable: true,
            mode: modes[change.mode],
            powerLimitation: "limit" in change ? powerString(change.limit) : "",
          },
          token
        );
      }
      case "set_battery_soc_thresholds": {
        return writeBatteryThresholds(write, stationId, change, token);
      }
      case "set_peak_shaving_schedule": {
        return write(
          "POST",
          "/device/dischargesetting/peak/shaving",
          {
            ...id,
            ...peakShavingBody(change),
          },
          token
        );
      }
      case "stop_manual_override": {
        return write(
          "PUT",
          "/device/energy-profile/instant/manunal",
          { ...id, duration: "", enable: false, mode: "", powerLimitation: "" },
          token
        );
      }
      case "set_backup_reserve": {
        return writeBackupReserve(
          write,
          stationId,
          change.reservePercent,
          token
        );
      }
      case "set_battery_power_limits": {
        return writeBatteryPower(write, stationId, change, token);
      }
      case "set_solar_power_limit": {
        return writeSolarPower(write, stationId, change.limit, token);
      }
      case "set_battery_export": {
        return write(
          "PUT",
          "/device/energy-profile/battery/export/limitation",
          { ...id, installerSetEnable: null, ownerSetEnable: change.enabled },
          token
        );
      }
      case "set_grid_export_limit":
      case "set_grid_import_limit": {
        return writeGridPower(
          write,
          stationId,
          change.operation === "set_grid_export_limit" ? "export" : "import",
          change.watts,
          token
        );
      }
      case "set_grid_connection_current": {
        return write(
          "PUT",
          "/device/energy-profile/parallel/off/grid",
          {
            ...id,
            enable: true,
            installerSetLimitation: null,
            ownerSetLimitation: change.amperes.toFixed(1),
          },
          token
        );
      }
      case "set_operating_mode": {
        return write(
          "PUT",
          "/device/energy-profile/mode",
          {
            ...id,
            operationMode: change.providerMode,
            profileId: change.profileId,
          },
          token
        );
      }
      default: {
        return absurd<never>(change);
      }
    }
  };
  const dispatchControl = (
    stationId: StationId,
    change: ControlChange,
    token: Redacted.Redacted<string>,
    reviewed?: ControlSnapshot
  ) => {
    if (change.operation === "activate_time_of_use_mode") {
      return timeOfUse.dispatch(
        stationId,
        token,
        reviewed?.kind === "time_of_use" ? reviewed : undefined
      );
    }
    if (isLoadControlChange(change)) {
      return loadControls.dispatch(
        stationId,
        change,
        token,
        reviewed?.kind === "smart_load_settings" ? reviewed : undefined
      );
    }
    if (isProfileChange(change)) {
      return reviewed?.kind === "profile"
        ? profileControls.dispatch(stationId, change, reviewed, token)
        : failure("SchemaMismatch");
    }
    if (isScheduledSettingsChange(change)) {
      return scheduledSettings.dispatch(
        stationId,
        change,
        token,
        reviewed?.kind === "preheating" || reviewed?.kind === "energy_saving"
          ? reviewed
          : undefined
      );
    }
    return dispatchExistingControl(stationId, change, token);
  };
  return { dispatchControl, inspectControl, validateControl };
};
