import { Effect, Schema } from "effect";
import type { Redacted } from "effect";

import type { ProviderWrite } from "./controls-client.js";
import {
  LoadSchedule,
  loadScheduleMatches,
  providerLoadSchedule,
} from "./load-schedule.js";
import { makeLoadSettingsClient } from "./load-settings-client.js";
import { SmartLoadControlSettings } from "./load-settings.js";
import { LoadKey, LoadPath } from "./loads.js";
import { Percent, Timestamp, failure } from "./model.js";
import type { StationId } from "./model.js";
import type { ProviderRead } from "./provider-read.js";

const Identity = { loadKey: LoadKey, loadPath: LoadPath };
const SocControl = Schema.Struct({
  connectAtPercent: Percent.check(Schema.isInt()),
  disconnectAtPercent: Percent.check(Schema.isInt()),
  mode: Schema.Literal("soc"),
}).check(
  Schema.makeFilter(
    (value) => value.disconnectAtPercent < value.connectAtPercent
  )
);
export const LoadControlChange = Schema.Union([
  Schema.Struct({
    ...Identity,
    operation: Schema.Literal("set_smart_load_schedule"),
    schedule: LoadSchedule,
  }),
  Schema.Struct({
    ...Identity,
    mode: Schema.Literals(["manual", "automatic"]),
    operation: Schema.Literal("set_smart_load_mode"),
  }),
  Schema.Struct({
    ...Identity,
    control: Schema.Union([
      SocControl,
      Schema.Struct({
        mode: Schema.Literals(["keep_connected", "disconnect"]),
      }),
    ]),
    operation: Schema.Literal("set_smart_load_off_grid_control"),
  }),
]);
export type LoadControlChange = typeof LoadControlChange.Type;
export const isLoadControlChange = (change: {
  operation: string;
}): change is LoadControlChange =>
  change.operation === "set_smart_load_schedule" ||
  change.operation === "set_smart_load_mode" ||
  change.operation === "set_smart_load_off_grid_control";
const { fetchedAt: _fetchedAt, ...Settings } = SmartLoadControlSettings.fields;
export const LoadControlSnapshot = Schema.Struct({
  kind: Schema.Literal("smart_load_settings"),
  settings: Schema.Struct({ ...Settings, fetchedAt: Timestamp }),
});
export type LoadControlSnapshot = typeof LoadControlSnapshot.Type;
const offGridCode = (
  change: Extract<
    LoadControlChange,
    { operation: "set_smart_load_off_grid_control" }
  >
) => ({ disconnect: 2, keep_connected: 0, soc: 1 })[change.control.mode];
const percent = (value: number | string | null) => {
  if (value === null || !/^\d+(?:\.\d+)?$/u.test(String(value))) {
    return null;
  }
  const numeric = Number(value);
  return numeric >= 0 && numeric <= 100 ? numeric : null;
};
const integerIn = (
  value: number | string | null,
  lower: number,
  upper: number
) => {
  if (value === null || !/^\d+$/u.test(String(value))) {
    return false;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= lower && number <= upper;
};
const daysKnown = (days: readonly number[] | null) =>
  days !== null &&
  days.length > 0 &&
  new Set(days).size === days.length &&
  days.every((day) => day >= 1 && day <= 7);
const knownPower = (value: number | string | null) =>
  value !== null &&
  /^\d+(?:\.\d+)?$/u.test(String(value)) &&
  Number.isFinite(Number(value));
const knownModeSettings = (
  row: NonNullable<
    NonNullable<
      typeof SmartLoadControlSettings.Type.onGrid.autoModeParams
    >["touPointParamsList"]
  >[number],
  automatic: NonNullable<
    typeof SmartLoadControlSettings.Type.onGrid.autoModeParams
  >
) => {
  if (Number(row.consumptionMode) === 2) {
    return (
      row.socMode !== null &&
      percent(row.socMode.socLowerLimit) !== null &&
      percent(row.socMode.socUpperLimit) !== null &&
      Number(row.socMode.socLowerLimit) < Number(row.socMode.socUpperLimit)
    );
  }
  if (Number(row.consumptionMode) === 1) {
    const pv = automatic.pvExcessParams;
    return pv !== null && knownPower(pv.ratePower) && knownPower(pv.startPower);
  }
  return true;
};
/** Activation accepts only complete known schedule settings, even for disabled rows. */
const knownAutomaticSettings = (
  settings: typeof SmartLoadControlSettings.Type.onGrid
) => {
  const automatic = settings.autoModeParams;
  if (
    automatic === null ||
    automatic.touPointParamsList === null ||
    automatic.smartSavePointParamsList === null
  ) {
    return false;
  }
  const tou = automatic.touPointParamsList;
  const ready = automatic.smartSavePointParamsList;
  if (tou.length + ready.length === 0) {
    return false;
  }
  const validTou = tou.every(
    (row) =>
      integerIn(row.consumptionMode, 0, 2) &&
      integerIn(row.autoCharge, 0, 1) &&
      integerIn(row.touEnable, 0, 1) &&
      integerIn(row.startTime, 0, 1439) &&
      integerIn(row.duration, 1, 1440) &&
      daysKnown(row.periodConfig) &&
      knownModeSettings(row, automatic)
  );
  const validReady = ready.every(
    (row) =>
      integerIn(row.smartSaveEnable, 0, 1) &&
      integerIn(row.duration, 1, 1440) &&
      integerIn(row.endTime, 0, 1440) &&
      daysKnown(row.periodConfig)
  );
  return validTou && validReady;
};
type LoadSettings = typeof SmartLoadControlSettings.Type;
const loadCanBeControlled = (state: LoadSettings) =>
  state.load.controllable === true &&
  [0, 1].includes(state.load.providerRunMode ?? -1) &&
  state.load.providerRunMode === state.onGrid.controlMode &&
  [0, 1].includes(state.onGrid.manualModeSwitch ?? -1) &&
  state.load.providerManualSwitch === state.onGrid.manualModeSwitch &&
  [0, 1, 2].includes(state.offGrid.offGridControlMode ?? -1);

const sameControlMode = (value: LoadSettings, before: LoadSettings) =>
  value.load.providerRunMode === before.load.providerRunMode &&
  value.onGrid.controlMode === before.onGrid.controlMode &&
  value.onGrid.manualModeSwitch === before.onGrid.manualModeSwitch;

const matchesReviewedLoad = (
  change: LoadControlChange,
  value: LoadSettings,
  before: LoadSettings
) =>
  value.load.key === change.loadKey &&
  value.load.path === change.loadPath &&
  value.load.providerManualSwitch === before.load.providerManualSwitch &&
  value.stationId === before.stationId &&
  value.timezone === before.timezone;

export const loadControlMatches = (
  change: LoadControlChange,
  observed: LoadControlSnapshot,
  reviewed: LoadControlSnapshot | undefined
) => {
  if (reviewed === undefined) {
    return false;
  }
  const value = observed.settings;
  const before = reviewed.settings;
  if (!matchesReviewedLoad(change, value, before)) {
    return false;
  }
  if (change.operation === "set_smart_load_mode") {
    const mode = change.mode === "manual" ? 1 : 0;
    return (
      value.load.providerRunMode === mode &&
      value.onGrid.controlMode === mode &&
      value.onGrid.manualModeSwitch === before.onGrid.manualModeSwitch &&
      JSON.stringify(value.onGrid.autoModeParams) ===
        JSON.stringify(before.onGrid.autoModeParams) &&
      JSON.stringify(value.offGrid) === JSON.stringify(before.offGrid)
    );
  }
  if (change.operation === "set_smart_load_schedule") {
    return (
      sameControlMode(value, before) &&
      JSON.stringify(value.offGrid) === JSON.stringify(before.offGrid) &&
      loadScheduleMatches(
        change.schedule,
        value.onGrid.autoModeParams,
        before.onGrid.autoModeParams
      )
    );
  }
  return (
    value.load.providerRunMode === before.load.providerRunMode &&
    value.offGrid.offGridControlMode === offGridCode(change) &&
    value.offGrid.backupSoc === before.offGrid.backupSoc &&
    value.offGrid.chargeStopSoc === before.offGrid.chargeStopSoc &&
    JSON.stringify(value.onGrid) === JSON.stringify(before.onGrid) &&
    (change.control.mode !== "soc" ||
      (percent(value.offGrid.socInThreshold) ===
        change.control.connectAtPercent &&
        percent(value.offGrid.socOutThreshold) ===
          change.control.disconnectAtPercent))
  );
};
export const makeLoadControls = (read: ProviderRead, write: ProviderWrite) => {
  const inspect = (
    stationId: StationId,
    change: LoadControlChange,
    token: Redacted.Redacted<string>
  ) =>
    Effect.gen(function* inspectLoadControl() {
      const input = { loadPath: change.loadPath, stationId };
      const settings = yield* makeLoadSettingsClient(
        read
      ).smartLoadControlSettings(input, token);
      return { kind: "smart_load_settings" as const, settings };
    });
  const validate = (
    change: LoadControlChange,
    snapshot: LoadControlSnapshot
  ) => {
    const state = snapshot.settings;
    if (
      state.load.key !== change.loadKey ||
      state.load.path !== change.loadPath
    ) {
      return failure("PermissionDenied");
    }
    if (!loadCanBeControlled(state)) {
      return failure("UnsupportedCapability");
    }
    if (change.operation === "set_smart_load_mode") {
      return change.mode === "automatic" &&
        !knownAutomaticSettings(state.onGrid)
        ? failure("UnsupportedCapability")
        : Effect.void;
    }
    if (change.operation === "set_smart_load_schedule") {
      if (change.schedule.timezone !== state.timezone) {
        return failure("InvalidInput");
      }
      const hasEnabledRows =
        change.schedule.timed.some((row) => row.enabled) ||
        change.schedule.readyBy.some((row) => row.enabled);
      // The app prompts for a switch to manual mode when clearing an active schedule.
      return state.onGrid.controlMode === 0 && !hasEnabledRows
        ? failure("InvalidInput")
        : Effect.void;
    }
    if (change.control.mode === "soc") {
      const lower = percent(state.offGrid.backupSoc);
      const upper = percent(state.offGrid.chargeStopSoc);
      if (lower === null || upper === null) {
        return failure("UnsupportedCapability");
      }
      if (
        change.control.disconnectAtPercent < lower ||
        change.control.connectAtPercent > upper
      ) {
        return failure("InvalidInput");
      }
    }
    return Effect.void;
  };
  const dispatch = (
    stationId: StationId,
    change: LoadControlChange,
    token: Redacted.Redacted<string>,
    reviewed?: LoadControlSnapshot
  ) => {
    if (change.operation === "set_smart_load_mode") {
      return write(
        "PATCH",
        `/device/tp-device/smart-loads/control-mode?stationId=${stationId}&loadPath=${change.loadPath}&controlMode=${change.mode === "manual" ? 1 : 0}`,
        null,
        token
      );
    }
    if (change.operation === "set_smart_load_schedule") {
      if (
        reviewed?.settings.stationId !== stationId ||
        !Number.isSafeInteger(Number(stationId))
      ) {
        return failure("SchemaMismatch");
      }
      return write(
        "POST",
        "/device/tp-device/smart-loads/control-mode/auto/on-grid",
        {
          loadPath: change.loadPath,
          stationId: Number(stationId),
          ...providerLoadSchedule(
            change.schedule,
            reviewed.settings.onGrid.autoModeParams
          ),
        },
        token,
        "boolean_true"
      );
    }
    const base = {
      loadPath: change.loadPath,
      offGridControlMode: offGridCode(change),
      stationId: Number(stationId),
    };
    const body =
      change.control.mode === "soc"
        ? {
            ...base,
            socInThreshold: String(change.control.connectAtPercent),
            socOutThreshold: String(change.control.disconnectAtPercent),
          }
        : base;
    return write(
      "PUT",
      "/third-party-device/tp-device/smart-loads/control-mode/auto/off-grid",
      body,
      token
    );
  };
  return { dispatch, inspect, validate };
};
