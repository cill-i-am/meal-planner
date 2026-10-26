import { Effect, Schema, absurd } from "effect";
import type { Redacted } from "effect";

import type {
  ControlChange,
  ControlSnapshot,
  WritablePowerLimit,
} from "./controls.js";
import { OperatingMode, failure } from "./model.js";
import type { SigenFailure, StationId } from "./model.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";
import { makeSettingsClient } from "./settings-client.js";

export type ProviderWrite = (
  path: string,
  body: Readonly<Record<string, Schema.Json>>,
  token: Redacted.Redacted<string>
) => Effect.Effect<void, SigenFailure>;
const powerString = (limit: typeof WritablePowerLimit.Type) =>
  limit.kind === "unlimited" ? "4294967.295" : String(limit.watts / 1000);

const validateOwnerLimits = (
  change: ControlChange,
  snapshot: ControlSnapshot
): SigenFailure | null => {
  switch (change.operation) {
    case "set_grid_export_limit":
    case "set_grid_import_limit": {
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
    }
    case "set_grid_connection_current": {
      if (snapshot.kind !== "grid") {
        return failure("SchemaMismatch");
      }
      const ceiling = snapshot.settings.connectionCurrent.installerAmps;
      if (ceiling === null) {
        return failure("UnsupportedCapability");
      }
      return change.amperes > ceiling ? failure("InvalidInput") : null;
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
  const inspectControl = (
    stationId: StationId,
    change: ControlChange,
    token: Redacted.Redacted<string>
  ): Effect.Effect<ControlSnapshot, SigenFailure> => {
    switch (change.operation) {
      case "set_backup_reserve":
      case "set_battery_power_limits":
      case "set_battery_export": {
        return settings
          .batterySettings(stationId, token)
          .pipe(Effect.map((value) => ({ kind: "battery", settings: value })));
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
            decodeProvider(OperatingMode)({
              fetchedAt: 0,
              profileId: value.currentProfileId,
              providerMode: value.currentMode,
              stationId,
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
        snapshot.kind === "battery" &&
        (equipment.batteryCapacity === null || equipment.batteryCapacity <= 0)
      ) {
        return yield* failure("UnsupportedCapability");
      }
      if (snapshot.kind === "solar" && !equipment.hasSolar) {
        return yield* failure("UnsupportedCapability");
      }
      const invalid = validateOwnerLimits(change, snapshot);
      if (invalid !== null) {
        return yield* invalid;
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
      case "set_backup_reserve": {
        return write(
          "/device/setting/backup/reserve",
          { ...id, backupReserve: change.reservePercent },
          token
        );
      }
      case "set_battery_power_limits": {
        return write(
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
          "/device/energy-profile/solar/limit",
          { ...id, powerLimit: powerString(change.limit) },
          token
        );
      }
      case "set_battery_export": {
        return write(
          "/device/energy-profile/battery/export/limitation",
          { ...id, installerSetEnable: null, ownerSetEnable: change.enabled },
          token
        );
      }
      case "set_grid_export_limit":
      case "set_grid_import_limit": {
        return write(
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
