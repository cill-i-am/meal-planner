import { Effect, Schema, absurd } from "effect";
import type { Redacted } from "effect";

import type { ProviderWrite } from "./controls-client.js";
import {
  writeBatteryPower,
  writeBatteryThresholds,
  writeGridPower,
  writeSolarPower,
} from "./limit-writes.js";
import { Percent, failure } from "./model.js";
import type {
  ActiveProfileLimitScope,
  SigenFailure,
  StationId,
} from "./model.js";
import type { ProfileConfiguration } from "./profile-controls.js";
import { profileSettingsEqual } from "./profile-data.js";
import type { makeSettingsClient } from "./settings-client.js";
import {
  BatterySettings,
  GridSettings,
  SolarSettings,
  WritablePowerLimit,
} from "./settings.js";

const WholePercent = Percent.check(Schema.isInt());
const Watts = Schema.Int.check(
  Schema.isBetween({ maximum: 4_294_967_294, minimum: 0 })
);
const GridDirection = Schema.Literals(["import", "export"]);
export const SigenAiTarget = Schema.Struct({
  kind: Schema.Literal("built_in"),
  providerMode: Schema.Literal(1),
});
export const ActiveProfileLimitsChange = Schema.Struct({
  operation: Schema.Literal("set_active_energy_profile_limits"),
  setting: Schema.Union([
    Schema.Struct({
      charge: WritablePowerLimit,
      discharge: WritablePowerLimit,
      kind: Schema.Literal("battery_power"),
    }),
    Schema.Struct({
      chargeSocPercent: WholePercent,
      dischargeSocPercent: WholePercent,
      kind: Schema.Literal("battery_soc"),
    }).check(
      Schema.makeFilter(
        (value) => value.dischargeSocPercent <= value.chargeSocPercent
      )
    ),
    Schema.Struct({
      kind: Schema.Literal("solar_power"),
      limit: WritablePowerLimit,
    }),
    Schema.Struct({
      direction: GridDirection,
      kind: Schema.Literal("grid_power"),
      watts: Watts,
    }),
  ]),
  target: SigenAiTarget,
}).annotate({
  description:
    "Change one limit group on the active residential Sigen AI profile. Uses a dedicated write and verifies the full profile, including solar priorities.",
});
type Setting = typeof ActiveProfileLimitsChange.Type.setting;
export const activeProfileLimitScope = (setting: Setting) => {
  const checkedResult: ActiveProfileLimitScope =
    setting.kind === "grid_power" ? `grid_${setting.direction}` : setting.kind;
  return checkedResult;
};

const { fetchedAt: _batteryTime, ...batteryFields } = BatterySettings.fields;
const { fetchedAt: _gridTime, ...gridFields } = GridSettings.fields;
const { fetchedAt: _solarTime, ...solarFields } = SolarSettings.fields;
export const ActiveLimitState = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("battery"),
    value: Schema.Struct(batteryFields),
  }),
  Schema.Struct({
    kind: Schema.Literal("grid"),
    value: Schema.Struct(gridFields),
  }),
  Schema.Struct({
    kind: Schema.Literal("solar"),
    value: Schema.Struct(solarFields),
  }),
]);
export type ActiveLimitState = typeof ActiveLimitState.Type;
type Battery = Extract<ActiveLimitState, { kind: "battery" }>["value"];
type Grid = Extract<ActiveLimitState, { kind: "grid" }>["value"];
type Token = Redacted.Redacted<string>;

export const readActiveLimit = (
  settings: ReturnType<typeof makeSettingsClient>,
  stationId: StationId,
  setting: Setting,
  token: Token
) => {
  switch (setting.kind) {
    case "battery_power":
    case "battery_soc": {
      const checkedResult: Effect.Effect<ActiveLimitState, SigenFailure> =
        settings.batterySettings(stationId, token).pipe(
          Effect.map(({ fetchedAt: _time, ...value }) => ({
            kind: "battery",
            value,
          }))
        );
      return checkedResult;
    }
    case "grid_power": {
      const checkedResult: Effect.Effect<ActiveLimitState, SigenFailure> =
        settings.gridSettings(stationId, token).pipe(
          Effect.map(({ fetchedAt: _time, ...value }) => ({
            kind: "grid",
            value,
          }))
        );
      return checkedResult;
    }
    case "solar_power": {
      const checkedResult: Effect.Effect<ActiveLimitState, SigenFailure> =
        settings.solarSettings(stationId, token).pipe(
          Effect.map(({ fetchedAt: _time, ...value }) => ({
            kind: "solar",
            value,
          }))
        );
      return checkedResult;
    }
    default: {
      const checkedResult: Effect.Effect<ActiveLimitState, SigenFailure> =
        absurd<never>(setting);
      return checkedResult;
    }
  }
};

const gridLimit = (grid: Grid, direction: typeof GridDirection.Type) =>
  direction === "import" ? grid.importPower : grid.exportPower;
const batteryThresholds = (
  battery: Battery,
  profile: ProfileConfiguration,
  setting: Extract<Setting, { kind: "battery_soc" }>
) => {
  const { backupSocPercent, backupReservePercent, peakShavingSocPercent } =
    battery;
  const peakMode = profile.peakShaving.providerControlMode;
  if (
    backupSocPercent === null ||
    battery.chargeSocPercent === null ||
    battery.dischargeSocPercent === null ||
    !Number.isInteger(backupSocPercent) ||
    (peakShavingSocPercent !== null &&
      !Number.isInteger(peakShavingSocPercent)) ||
    ![0, 1].includes(peakMode) ||
    (peakMode === 1 &&
      peakShavingSocPercent !== profile.peakShaving.reserveSocPercent)
  ) {
    return null;
  }
  const { chargeSocPercent, dischargeSocPercent } = setting;
  const reserveFloor = Math.min(
    backupSocPercent,
    backupReservePercent,
    peakMode === 1 ? profile.peakShaving.reserveSocPercent : 100
  );
  const reserveCeiling = Math.max(
    backupSocPercent,
    backupReservePercent,
    peakShavingSocPercent ?? 0
  );
  return dischargeSocPercent <= reserveFloor &&
    chargeSocPercent >= reserveCeiling
    ? {
        backupSocPercent,
        chargeSocPercent,
        dischargeSocPercent,
        peakShavingSocPercent,
      }
    : null;
};

export const validateActiveLimit = (
  setting: Setting,
  state: ActiveLimitState,
  profile: ProfileConfiguration
) => {
  if (state.value.stationId !== profile.stationId) {
    const checkedResult: Effect.Effect<void, SigenFailure> =
      failure("PermissionDenied");
    return checkedResult;
  }
  switch (setting.kind) {
    case "battery_power": {
      const checkedResult: Effect.Effect<void, SigenFailure> =
        state.kind === "battery" ? Effect.void : failure("SchemaMismatch");
      return checkedResult;
    }
    case "battery_soc": {
      const checkedResult: Effect.Effect<void, SigenFailure> =
        state.kind === "battery" &&
        batteryThresholds(state.value, profile, setting) !== null
          ? Effect.void
          : failure("UnsupportedCapability");
      return checkedResult;
    }
    case "grid_power": {
      if (state.kind !== "grid") {
        const checkedResult: Effect.Effect<void, SigenFailure> =
          failure("SchemaMismatch");
        return checkedResult;
      }
      const ceiling = gridLimit(state.value, setting.direction).installer;
      if (ceiling.kind === "unset") {
        const checkedResult: Effect.Effect<void, SigenFailure> = failure(
          "UnsupportedCapability"
        );
        return checkedResult;
      }
      {
        const checkedResult: Effect.Effect<void, SigenFailure> =
          ceiling.kind === "limited" && setting.watts - ceiling.watts > 1e-6
            ? failure("InvalidInput")
            : Effect.void;
        return checkedResult;
      }
    }
    case "solar_power": {
      const checkedResult: Effect.Effect<void, SigenFailure> =
        state.kind === "solar" ? Effect.void : failure("SchemaMismatch");
      return checkedResult;
    }
    default: {
      const checkedResult: Effect.Effect<void, SigenFailure> =
        absurd<never>(setting);
      return checkedResult;
    }
  }
};

export const dispatchActiveLimit = (
  write: ProviderWrite,
  setting: Setting,
  state: ActiveLimitState,
  profile: ProfileConfiguration,
  token: Token
) =>
  validateActiveLimit(setting, state, profile).pipe(
    Effect.flatMap(() => {
      const { stationId } = profile;
      switch (setting.kind) {
        case "battery_power": {
          return writeBatteryPower(write, stationId, setting, token);
        }
        case "battery_soc": {
          const thresholds =
            state.kind === "battery" &&
            batteryThresholds(state.value, profile, setting);
          return thresholds
            ? writeBatteryThresholds(write, stationId, thresholds, token)
            : failure("UnsupportedCapability");
        }
        case "grid_power": {
          return writeGridPower(
            write,
            stationId,
            setting.direction,
            setting.watts,
            token
          );
        }
        case "solar_power": {
          return writeSolarPower(write, stationId, setting.limit, token);
        }
        default: {
          return absurd<never>(setting);
        }
      }
    })
  );

const expectedLimitReadback = (setting: Setting, state: ActiveLimitState) => {
  switch (setting.kind) {
    case "battery_power": {
      const checkedResult: ActiveLimitState | null =
        state.kind === "battery"
          ? {
              ...state,
              value: {
                ...state.value,
                chargeLimit: setting.charge,
                dischargeLimit: setting.discharge,
              },
            }
          : null;
      return checkedResult;
    }
    case "battery_soc": {
      const checkedResult: ActiveLimitState | null =
        state.kind === "battery"
          ? {
              ...state,
              value: {
                ...state.value,
                chargeSocPercent: setting.chargeSocPercent,
                dischargeSocPercent: setting.dischargeSocPercent,
              },
            }
          : null;
      return checkedResult;
    }
    case "grid_power": {
      if (state.kind !== "grid") {
        const checkedResult: ActiveLimitState | null = null;
        return checkedResult;
      }
      const field =
        setting.direction === "import" ? "importPower" : "exportPower";
      const limit = { kind: "limited", watts: setting.watts } as const;
      {
        const checkedResult: ActiveLimitState | null = {
          ...state,
          value: {
            ...state.value,
            [field]: {
              ...state.value[field],
              effective: limit,
              enabled: true,
              owner: limit,
            },
          },
        };
        return checkedResult;
      }
    }
    case "solar_power": {
      const checkedResult: ActiveLimitState | null =
        state.kind === "solar"
          ? { ...state, value: { ...state.value, powerLimit: setting.limit } }
          : null;
      return checkedResult;
    }
    default: {
      const checkedResult: ActiveLimitState | null = absurd<never>(setting);
      return checkedResult;
    }
  }
};

const preserveProfileAliases = (
  setting: Setting,
  before: ProfileConfiguration,
  after: ProfileConfiguration
) => {
  const baselineIfRequested = <Value extends Schema.Json>(
    baseline: Value,
    observed: Value,
    requested: Value
  ) => (profileSettingsEqual(observed, requested) ? baseline : observed);
  switch (setting.kind) {
    case "battery_power": {
      const checkedResult: ProfileConfiguration = {
        ...after,
        batteryChargeLimit: baselineIfRequested(
          before.batteryChargeLimit,
          after.batteryChargeLimit,
          setting.charge
        ),
        batteryDischargeLimit: baselineIfRequested(
          before.batteryDischargeLimit,
          after.batteryDischargeLimit,
          setting.discharge
        ),
      };
      return checkedResult;
    }
    case "battery_soc": {
      const checkedResult: ProfileConfiguration = {
        ...after,
        chargeSocPercent: baselineIfRequested(
          before.chargeSocPercent,
          after.chargeSocPercent,
          setting.chargeSocPercent
        ),
        dischargeSocPercent: baselineIfRequested(
          before.dischargeSocPercent,
          after.dischargeSocPercent,
          setting.dischargeSocPercent
        ),
      };
      return checkedResult;
    }
    case "grid_power": {
      const limit = { kind: "limited", watts: setting.watts } as const;
      const enabled =
        setting.direction === "import"
          ? "gridImportEnabled"
          : "gridExportEnabled";
      const power =
        setting.direction === "import" ? "gridImportLimit" : "gridExportLimit";
      {
        const checkedResult: ProfileConfiguration = {
          ...after,
          [enabled]: baselineIfRequested(before[enabled], after[enabled], true),
          [power]: baselineIfRequested(before[power], after[power], limit),
        };
        return checkedResult;
      }
    }
    case "solar_power": {
      const checkedResult: ProfileConfiguration = {
        ...after,
        solarLimit: baselineIfRequested(
          before.solarLimit,
          after.solarLimit,
          setting.limit
        ),
      };
      return checkedResult;
    }
    default: {
      const checkedResult: ProfileConfiguration = absurd<never>(setting);
      return checkedResult;
    }
  }
};

export const activeLimitMatches = (
  setting: Setting,
  before: ActiveLimitState,
  after: ActiveLimitState,
  beforeProfile: ProfileConfiguration,
  afterProfile: ProfileConfiguration
) => {
  const expected = expectedLimitReadback(setting, before);
  if (expected === null || !profileSettingsEqual(expected, after)) {
    const checkedResult = false;
    return checkedResult;
  }
  {
    const checkedResult: boolean = profileSettingsEqual(
      preserveProfileAliases(setting, beforeProfile, afterProfile),
      beforeProfile
    );
    return checkedResult;
  }
};
