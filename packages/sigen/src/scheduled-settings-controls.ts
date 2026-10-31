import { Clock, DateTime, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import type { ProviderWrite } from "./controls-client.js";
import { failure } from "./model.js";
import type { SigenFailure, StationId } from "./model.js";
import { makePreheatingClient } from "./preheating-client.js";
import { PreheatingSettings } from "./preheating.js";
import { readStationTimezone } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";
import { ScheduleWindow, nonOverlappingWindows } from "./schedules.js";
import { makeSettingsClient } from "./settings-client.js";
import { EnergySavingSettings } from "./settings.js";

export const ScheduledSettingsChange = Schema.Union([
  Schema.Struct({
    enabled: Schema.Boolean,
    operation: Schema.Literal("set_preheating_schedule"),
    timezone: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(128)
    ),
    windows: Schema.Array(ScheduleWindow).check(
      Schema.isMaxLength(4),
      Schema.makeFilter(nonOverlappingWindows)
    ),
  }).check(
    Schema.makeFilter((value) => !value.enabled || value.windows.length > 0)
  ),
  Schema.Struct({
    loadThreshold: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("system_default") }),
      Schema.Struct({
        kind: Schema.Literal("watts"),
        watts: Schema.Int.check(
          Schema.isBetween({ maximum: 65_534, minimum: 0 })
        ),
      }),
    ]),
    offGridMode: Schema.Literals(["unchanged", "performance", "deep_saving"]),
    onGridMode: Schema.Literals(["unchanged", "performance", "deep_saving"]),
    operation: Schema.Literal("set_energy_saving_settings"),
  }),
]);
export type ScheduledSettingsChange = typeof ScheduledSettingsChange.Type;
export const isScheduledSettingsChange = (change: {
  readonly operation: string;
}): change is ScheduledSettingsChange =>
  change.operation === "set_preheating_schedule" ||
  change.operation === "set_energy_saving_settings";
export const ScheduledSettingsSnapshot = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("preheating"),
    settings: Schema.Struct({
      ...PreheatingSettings.fields,
      timezone: Schema.String,
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("energy_saving"),
    settings: EnergySavingSettings,
  }),
]);
export type ScheduledSettingsSnapshot = typeof ScheduledSettingsSnapshot.Type;
const minutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const savingValues = (
  change: Extract<
    ScheduledSettingsChange,
    { operation: "set_energy_saving_settings" }
  >,
  current?: typeof EnergySavingSettings.Type
) => ({
  offGridMode: {
    deep_saving: "1",
    performance: "2",
    unchanged: current?.providerOffGridMode,
  }[change.offGridMode],
  onGridMode: {
    deep_saving: "2",
    performance: "0",
    unchanged: current?.providerOnGridMode,
  }[change.onGridMode],
  value:
    change.loadThreshold.kind === "system_default"
      ? "65535"
      : String(change.loadThreshold.watts),
});
export const scheduledSettingsMatch = (
  change: ScheduledSettingsChange,
  snapshot: ScheduledSettingsSnapshot,
  reviewed?: ScheduledSettingsSnapshot
): boolean => {
  if (change.operation === "set_energy_saving_settings") {
    if (snapshot.kind !== "energy_saving") {
      return false;
    }
    const expected = savingValues(
      change,
      reviewed?.kind === "energy_saving" ? reviewed.settings : undefined
    );
    return (
      snapshot.settings.providerOnGridMode === expected.onGridMode &&
      snapshot.settings.providerOffGridMode === expected.offGridMode &&
      snapshot.settings.providerValue === expected.value
    );
  }
  if (snapshot.kind !== "preheating") {
    return false;
  }
  const value = snapshot.settings;
  return (
    !value.industrial &&
    value.providerMode === null &&
    value.providerEnableSwitch === null &&
    value.timezone === change.timezone &&
    value.providerSwitch === (change.enabled ? 1 : 0) &&
    value.slots.length === change.windows.length &&
    value.slots.every((slot, index) => {
      const expected = change.windows[index];
      return (
        expected !== undefined &&
        slot.providerChargingPower === null &&
        slot.providerDischargePower === null &&
        Number(slot.providerStartTime) === minutes(expected.startTime) &&
        Number(slot.providerDuration) ===
          minutes(expected.endTime) - minutes(expected.startTime) &&
        JSON.stringify(slot.providerPeriods) ===
          JSON.stringify(expected.providerDays.split(",").map(Number))
      );
    })
  );
};
export const makeScheduledSettingsControls = (
  read: ProviderRead,
  write: ProviderWrite
) => ({
  dispatch: (
    stationId: StationId,
    change: ScheduledSettingsChange,
    token: Redacted.Redacted<string>,
    reviewed?: ScheduledSettingsSnapshot
  ) => {
    if (change.operation === "set_energy_saving_settings") {
      const saving = savingValues(
        change,
        reviewed?.kind === "energy_saving" ? reviewed.settings : undefined
      );
      if (saving.offGridMode === undefined || saving.onGridMode === undefined) {
        return failure("SchemaMismatch");
      }
      return write(
        "PUT",
        "/device/owner/station/save-energy-mode",
        {
          offGridEnable: false,
          offGridMode: saving.offGridMode,
          onGridMode: saving.onGridMode,
          stationId: Number(stationId),
          value: saving.value,
        },
        token
      );
    }
    return write(
      "PUT",
      `/device/dischargesetting/packPreheat/set/new/${stationId}`,
      {
        packPreheatingDTOList: change.windows.map((window) => ({
          chargingPower: null,
          dischargePower: null,
          duration: minutes(window.endTime) - minutes(window.startTime),
          periodConfig: window.providerDays.split(",").map(Number),
          startTime: minutes(window.startTime),
        })),
        packPreheatingSwitch: change.enabled ? 1 : 0,
        preHeatingEnablesSwitch: null,
        preheatingMode: null,
      },
      token
    );
  },
  inspect: (
    stationId: StationId,
    change: ScheduledSettingsChange,
    token: Redacted.Redacted<string>
  ): Effect.Effect<ScheduledSettingsSnapshot, SigenFailure> =>
    Effect.gen(function* inspectScheduledSettings() {
      if (change.operation === "set_energy_saving_settings") {
        return {
          kind: "energy_saving",
          settings: yield* makeSettingsClient(read).energySavingSettings(
            stationId,
            token
          ),
        };
      }
      const settings = yield* makePreheatingClient(read).preheatingSettings(
        stationId,
        token
      );
      const zone = yield* readStationTimezone(read, stationId, token);
      return {
        kind: "preheating",
        settings: {
          ...settings,
          fetchedAt: yield* Clock.currentTimeMillis,
          timezone: DateTime.zoneToString(zone),
        },
      };
    }),
  validate: (
    change: ScheduledSettingsChange,
    snapshot: ScheduledSettingsSnapshot
  ) => {
    if (change.operation === "set_preheating_schedule") {
      if (snapshot.kind !== "preheating") {
        return failure("SchemaMismatch");
      }
      if (
        snapshot.settings.industrial ||
        snapshot.settings.providerMode !== null ||
        snapshot.settings.providerEnableSwitch !== null ||
        ![0, 1].includes(snapshot.settings.providerSwitch)
      ) {
        return failure("UnsupportedCapability");
      }
      return change.timezone === snapshot.settings.timezone
        ? Effect.void
        : failure("InvalidInput");
    }
    if (snapshot.kind !== "energy_saving") {
      return failure("SchemaMismatch");
    }
    const current = snapshot.settings;
    if (
      !["0", "1", "2"].includes(current.providerOnGridMode) ||
      !["0", "1", "2"].includes(current.providerOffGridMode)
    ) {
      return failure("UnsupportedCapability");
    }
    const proposed = savingValues(change, current);
    // offGridEnable is the app's capability gate, not a switch we may change through this operation.
    if (
      !current.offGridEnabled &&
      proposed.offGridMode !== current.providerOffGridMode
    ) {
      return failure("UnsupportedCapability");
    }
    // The app preserves the threshold outside deep saving mode.
    if (
      proposed.onGridMode !== "2" &&
      proposed.value !== current.providerValue
    ) {
      return failure("InvalidInput");
    }
    return Effect.void;
  },
});
