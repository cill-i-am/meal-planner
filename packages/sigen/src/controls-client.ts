import { Clock, Effect, Schema, absurd } from "effect";
import type { Redacted } from "effect";

import type {
  ControlChange,
  ControlSnapshot,
  WritablePowerLimit,
} from "./controls.js";
import { makeEnergyProfileClient } from "./energy-profile-client.js";
import { makeLoadsClient } from "./loads-client.js";
import { OperatingMode, failure } from "./model.js";
import type { SigenFailure, StationId } from "./model.js";
import { makeProfileClient } from "./profile-client.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";
import {
  makeSettingsClient,
  readManualOverrideState,
} from "./settings-client.js";

export type ProviderWrite = (
  method: "PUT" | "POST" | "PATCH",
  path: string,
  body: Readonly<Record<string, Schema.Json>> | null,
  token: Redacted.Redacted<string>
) => Effect.Effect<void, SigenFailure>;
const powerString = (limit: typeof WritablePowerLimit.Type) =>
  limit.kind === "unlimited" ? "4294967.295" : String(limit.watts / 1000);

const validatePeakSchedule = (
  change: Extract<ControlChange, { operation: "set_peak_shaving_schedule" }>,
  snapshot: ControlSnapshot
): SigenFailure | null => {
  if (snapshot.kind !== "peak_shaving") {
    return failure("SchemaMismatch");
  }
  const value = snapshot.settings;
  if (value.providerControlMode !== 0 && value.providerControlMode !== 1) {
    return failure("UnsupportedCapability");
  }
  if (change.enabled && change.slots.length === 0) {
    return failure("InvalidInput");
  }
  // Do not reinterpret unverified provider day codes or replace windows hidden from the review.
  const preserved =
    change.timezone === value.timezone &&
    change.slots.length === value.slots.length &&
    change.slots.every((slot, index) => {
      const current = value.slots[index];
      return (
        current !== undefined &&
        slot.providerDays === current.providerDays &&
        slot.startTime === current.startTime &&
        slot.endTime === current.endTime
      );
    });
  return preserved ? null : failure("UnsupportedCapability");
};

const validateSocSnapshot = (
  snapshot: ControlSnapshot
): SigenFailure | null => {
  if (snapshot.kind !== "battery") {
    return failure("SchemaMismatch");
  }
  const value = snapshot.settings;
  return value.chargeSocPercent === null ||
    value.dischargeSocPercent === null ||
    value.backupSocPercent === null ||
    value.peakShavingSocPercent === null
    ? failure("UnsupportedCapability")
    : null;
};

const validateGridPower = (
  change: Extract<
    ControlChange,
    { operation: "set_grid_export_limit" | "set_grid_import_limit" }
  >,
  snapshot: ControlSnapshot
): SigenFailure | null => {
  if (snapshot.kind !== "grid") {
    return failure("SchemaMismatch");
  }
  const ceiling = (
    change.operation === "set_grid_export_limit"
      ? snapshot.settings.exportPower
      : snapshot.settings.importPower
  ).installer;
  if (ceiling.kind === "unset") {
    return failure("UnsupportedCapability");
  }
  return ceiling.kind === "limited" && change.watts > ceiling.watts
    ? failure("InvalidInput")
    : null;
};

const validateGridCurrent = (
  change: Extract<ControlChange, { operation: "set_grid_connection_current" }>,
  snapshot: ControlSnapshot
): SigenFailure | null => {
  if (snapshot.kind !== "grid") {
    return failure("SchemaMismatch");
  }
  const ceiling = snapshot.settings.connectionCurrent.installerAmps;
  if (ceiling === null) {
    return failure("UnsupportedCapability");
  }
  return change.amperes > ceiling ? failure("InvalidInput") : null;
};
const validateSmartLoad = (
  change: Extract<ControlChange, { operation: "set_smart_load_switch" }>,
  snapshot: ControlSnapshot
): SigenFailure | null => {
  if (snapshot.kind !== "smart_load") {
    return failure("SchemaMismatch");
  }
  const { load } = snapshot.settings;
  if (load.key !== change.loadKey || load.path !== change.loadPath) {
    return failure("PermissionDenied");
  }
  return load.controllable === true &&
    load.providerRunMode === 1 &&
    (load.providerManualSwitch === 0 || load.providerManualSwitch === 1)
    ? null
    : failure("UnsupportedCapability");
};
const validateBatteryPriority = (
  change: Extract<
    ControlChange,
    { operation: "set_battery_discharge_priority" }
  >,
  snapshot: ControlSnapshot
): SigenFailure | null => {
  if (snapshot.kind !== "battery_priority") {
    return failure("SchemaMismatch");
  }
  return JSON.stringify([...snapshot.settings.providerSources].toSorted()) ===
    JSON.stringify([...change.sources].toSorted())
    ? null
    : failure("UnsupportedCapability");
};
const validateSolarPriority = (
  change: Extract<ControlChange, { operation: "set_solar_priority" }>,
  snapshot: ControlSnapshot
): SigenFailure | null => {
  if (snapshot.kind !== "solar_priority") {
    return failure("SchemaMismatch");
  }
  const current = snapshot.settings.entries;
  const key = (entry: (typeof change.entries)[number]) =>
    JSON.stringify([
      entry.providerLoadType,
      entry.providerDeviceType,
      entry.smartLoadPath,
    ]);
  if (current.some((entry) => entry.group || entry.groupPath.length !== 1)) {
    return failure("UnsupportedCapability");
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
    return failure("UnsupportedCapability");
  }
  if (
    current.some(
      (entry) =>
        entry.providerStatus !== 0 &&
        change.entries.find((value) => key(value) === key(entry))
          ?.providerPriority !== entry.providerPriority
    )
  ) {
    return failure("UnsupportedCapability");
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
  return sameKeys &&
    JSON.stringify(priorities) ===
      JSON.stringify(
        current.map((entry) => entry.providerPriority).toSorted((a, b) => a - b)
      )
    ? null
    : failure("InvalidInput");
};

const validateOwnerLimits = (
  change: ControlChange,
  snapshot: ControlSnapshot
): SigenFailure | null => {
  switch (change.operation) {
    case "set_grid_export_limit":
    case "set_grid_import_limit": {
      return validateGridPower(change, snapshot);
    }

    case "set_grid_connection_current": {
      return validateGridCurrent(change, snapshot);
    }
    case "set_battery_soc_thresholds": {
      return validateSocSnapshot(snapshot);
    }
    case "set_peak_shaving_schedule": {
      return validatePeakSchedule(change, snapshot);
    }
    case "set_battery_export": {
      if (snapshot.kind !== "battery") {
        return failure("SchemaMismatch");
      }
      return change.enabled &&
        snapshot.settings.export.installerEnabled !== true
        ? failure("PermissionDenied")
        : null;
    }
    case "set_smart_load_switch": {
      return validateSmartLoad(change, snapshot);
    }
    case "set_battery_discharge_priority": {
      return validateBatteryPriority(change, snapshot);
    }
    case "set_solar_priority": {
      return validateSolarPriority(change, snapshot);
    }
    case "start_manual_override":
    case "stop_manual_override":
    case "set_backup_reserve":
    case "set_battery_power_limits":
    case "set_solar_power_limit":
    case "set_operating_mode": {
      return null;
    }
    default: {
      return absurd<never>(change);
    }
  }
};

export const makeControlsClient = (
  read: ProviderRead,
  write: ProviderWrite
) => {
  const settings = makeSettingsClient(read);
  const loads = makeLoadsClient(read);
  const profiles = makeProfileClient(read);
  const energyProfiles = makeEnergyProfileClient(read);
  const inspectControl = (
    stationId: StationId,
    change: ControlChange,
    token: Redacted.Redacted<string>
  ): Effect.Effect<ControlSnapshot, SigenFailure> => {
    switch (change.operation) {
      case "set_smart_load_switch": {
        return loads
          .smartLoad({ loadPath: change.loadPath, stationId }, token)
          .pipe(
            Effect.map((value) => ({ kind: "smart_load", settings: value }))
          );
      }
      case "set_battery_discharge_priority": {
        return profiles.batteryDischargePriority(stationId, token).pipe(
          Effect.map((value) => ({
            kind: "battery_priority",
            settings: value,
          }))
        );
      }
      case "set_solar_priority": {
        return energyProfiles
          .solarPriority(stationId, token)
          .pipe(
            Effect.map((value) => ({ kind: "solar_priority", settings: value }))
          );
      }
      case "set_battery_soc_thresholds":
      case "set_backup_reserve":
      case "set_battery_power_limits":
      case "set_battery_export": {
        return settings
          .batterySettings(stationId, token)
          .pipe(Effect.map((value) => ({ kind: "battery", settings: value })));
      }
      case "set_peak_shaving_schedule": {
        return settings
          .peakShavingSchedule(stationId, token)
          .pipe(
            Effect.map((value) => ({ kind: "peak_shaving", settings: value }))
          );
      }
      case "start_manual_override":
      case "stop_manual_override": {
        return readManualOverrideState(read, stationId, token).pipe(
          Effect.map((value) => ({
            kind: "manual",
            settings: value,
          }))
        );
      }
      case "set_solar_power_limit": {
        return settings
          .solarSettings(stationId, token)
          .pipe(Effect.map((value) => ({ kind: "solar", settings: value })));
      }
      case "set_grid_export_limit":
      case "set_grid_import_limit":
      case "set_grid_connection_current": {
        return settings
          .gridSettings(stationId, token)
          .pipe(Effect.map((value) => ({ kind: "grid", settings: value })));
      }
      case "set_operating_mode": {
        return read(
          `/device/energy-profile/mode/current/${stationId}`,
          token
        ).pipe(
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
      }
      default: {
        return absurd<never>(change);
      }
    }
  };
  const validateControl = (
    stationId: StationId,
    change: ControlChange,
    snapshot: ControlSnapshot,
    token: Redacted.Redacted<string>
  ): Effect.Effect<void, SigenFailure> =>
    Effect.gen(function* validateOwnerChange() {
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
        ["battery", "peak_shaving", "manual", "battery_priority"].includes(
          snapshot.kind
        ) &&
        (equipment.batteryCapacity === null || equipment.batteryCapacity <= 0)
      ) {
        return yield* failure("UnsupportedCapability");
      }
      if (
        (snapshot.kind === "solar" || snapshot.kind === "solar_priority") &&
        !equipment.hasSolar
      ) {
        return yield* failure("UnsupportedCapability");
      }
      const invalid = validateOwnerLimits(change, snapshot);
      if (invalid !== null) {
        return yield* invalid;
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
    });
  const dispatchControl = (
    stationId: StationId,
    change: ControlChange,
    token: Redacted.Redacted<string>
  ) => {
    const id = { stationId: Number(stationId) };
    switch (change.operation) {
      case "set_smart_load_switch": {
        return write(
          "PATCH",
          `/device/tp-device/smart-loads/control-mode/manual/switch?stationId=${stationId}&loadPath=${change.loadPath}&manualSwitch=${change.enabled ? 1 : 0}`,
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
        return write(
          "PUT",
          "/device/energy-profile/battery/level",
          {
            ...id,
            backupSOC: String(change.backupSocPercent),
            chargeSOC: String(change.chargeSocPercent),
            dischargeSOC: String(change.dischargeSocPercent),
            peakShavingSOC: String(change.peakShavingSocPercent),
          },
          token
        );
      }
      case "set_peak_shaving_schedule": {
        return write(
          "POST",
          "/device/dischargesetting/peak/shaving",
          {
            ...id,
            controlMode: change.enabled ? 1 : 0,
            settingList: change.slots.map((slot) => ({
              endTime: slot.endTime,
              peakPower: slot.peakPowerW / 1000,
              startTime: slot.startTime,
              whichDay: slot.providerDays,
            })),
            shavingSOC: change.reserveSocPercent,
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
        return write(
          "PUT",
          "/device/setting/backup/reserve",
          { ...id, backupReserve: change.reservePercent },
          token
        );
      }
      case "set_battery_power_limits": {
        return write(
          "PUT",
          "/device/energy-profile/battery/limit",
          {
            ...id,
            batteryMaxChargingPower: powerString(change.charge),
            batteryMaxDischargingPower: powerString(change.discharge),
          },
          token
        );
      }
      case "set_solar_power_limit": {
        return write(
          "PUT",
          "/device/energy-profile/solar/limit",
          { ...id, powerLimit: powerString(change.limit) },
          token
        );
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
        return write(
          "PUT",
          `/device/energy-profile/grid/limitation/${change.operation === "set_grid_export_limit" ? "export" : "import"}`,
          {
            ...id,
            enable: true,
            maxLimitationInstaller: null,
            maxLimitationOwner: String(change.watts / 1000),
          },
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
  return { dispatchControl, inspectControl, validateControl };
};
