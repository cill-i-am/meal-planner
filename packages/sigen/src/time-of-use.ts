import { Clock, DateTime, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import type { ProviderWrite } from "./controls-client.js";
import { StationId, Timestamp, failure } from "./model.js";
import { makeProfileClient } from "./profile-client.js";
import { decodeProvider, readStationTimezone } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";
import { ScheduleWindow, nonOverlappingWindows } from "./schedules.js";
import { makeSettingsClient } from "./settings-client.js";

const Limit = Schema.optionalKey(
  Schema.NullOr(
    Schema.Union([Schema.Finite, Schema.String.check(Schema.isMaxLength(64))])
  )
).annotate({
  description: "A provider limit. Null or missing uses the equipment default.",
});
const Slot = Schema.Struct({
  currType: Schema.Int,
  dischargeType: Schema.Int,
  endTime: Schema.String.check(Schema.isMaxLength(32)),
  gridChargeCutOffSoc: Limit,
  gridDischargeCutOffSoc: Limit,
  maxBuyPower: Limit,
  maxChargePower: Limit,
  maxDischargePower: Limit,
  maxPackChargePower: Limit,
  maxPackDischargePower: Limit,
  maxSellPower: Limit,
  startTime: Schema.String.check(Schema.isMaxLength(32)),
  whichDay: Schema.String.check(Schema.isMaxLength(32)),
});
const Configuration = Schema.Struct({
  controlMode: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  currType: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  elecType: Schema.optionalKey(Schema.NullOr(Schema.Int)),
});
const Slots = Schema.NullOr(Schema.Array(Slot).check(Schema.isMaxLength(128)));
const ProviderSlots = Schema.NullOr(
  Schema.Array(Schema.Struct({ ...Slot.fields, stationId: Schema.Int })).check(
    Schema.isMaxLength(128)
  )
);
export const TimeOfUseSettings = Schema.Struct({
  configuration: Configuration,
  fetchedAt: Timestamp,
  powerUnit: Schema.Literal("kW"),
  slots: Slots,
  socUnit: Schema.Literal("percent"),
  stationId: StationId,
  timezone: Schema.String,
});
export const TimeOfUseChange = Schema.Struct({
  operation: Schema.Literal("activate_time_of_use_mode"),
});
export type TimeOfUseChange = typeof TimeOfUseChange.Type;
const CurrentMode = Schema.Struct({
  currentMode: Schema.Int,
  currentProfileId: Schema.Int,
  followPpcMode: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});
export const TimeOfUseSnapshot = Schema.Struct({
  kind: Schema.Literal("time_of_use"),
  settings: Schema.Struct({
    ...TimeOfUseSettings.fields,
    currentMode: CurrentMode,
  }),
});
export type TimeOfUseSnapshot = typeof TimeOfUseSnapshot.Type;

export const makeTimeOfUseClient = (read: ProviderRead) => ({
  timeOfUseSettings: (stationId: StationId, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readTimeOfUseSettings() {
      const zone = yield* readStationTimezone(read, stationId, token);
      const configuration = yield* read(
        `/device/setting/tou/${stationId}`,
        token
      ).pipe(Effect.flatMap(decodeProvider(Configuration)));
      const rows = yield* read(
        `/device/dischargesetting/${stationId}`,
        token
      ).pipe(Effect.flatMap(decodeProvider(ProviderSlots)));
      if (rows?.some((row) => String(row.stationId) !== stationId)) {
        return yield* failure("PermissionDenied");
      }
      return yield* decodeProvider(TimeOfUseSettings)({
        configuration,
        fetchedAt: yield* Clock.currentTimeMillis,
        powerUnit: "kW",
        slots: rows?.map(({ stationId: _stationId, ...row }) => row) ?? null,
        socUnit: "percent",
        stationId,
        timezone: DateTime.zoneToString(zone),
      });
    }),
});

const knownLimit = (value: typeof Limit.Type | undefined, max: number) =>
  value === null ||
  value === undefined ||
  (/^\d+(?:\.\d+)?$/u.test(String(value)) && Number(value) <= max);
const knownLimits = (row: typeof Slot.Type) => {
  const powers = [
    row.maxBuyPower,
    row.maxSellPower,
    row.maxChargePower,
    row.maxDischargePower,
    row.maxPackChargePower,
    row.maxPackDischargePower,
  ];
  const thresholds = [row.gridChargeCutOffSoc, row.gridDischargeCutOffSoc];
  return (
    powers.every((value) => knownLimit(value, 1_000_000)) &&
    thresholds.every((value) => knownLimit(value, 100))
  );
};
const knownManualSchedule = (settings: typeof TimeOfUseSettings.Type) => {
  if (
    settings.configuration.currType !== 1 ||
    settings.slots === null ||
    settings.slots.length === 0 ||
    settings.slots.length > 24
  ) {
    return false;
  }
  const windows = settings.slots.map(({ endTime, startTime, whichDay }) => ({
    endTime,
    providerDays: whichDay,
    startTime,
  }));
  return (
    windows.every(Schema.is(ScheduleWindow)) &&
    nonOverlappingWindows(windows) &&
    settings.slots.every(
      (row) =>
        row.currType === 1 &&
        [0, 1, 3].includes(row.dischargeType) &&
        knownLimits(row)
    )
  );
};
export const timeOfUseMatches = (
  observed: TimeOfUseSnapshot,
  reviewed?: TimeOfUseSnapshot
) => {
  const after = observed.settings;
  const before = reviewed?.settings;
  return (
    before !== undefined &&
    after.stationId === before.stationId &&
    after.timezone === before.timezone &&
    after.currentMode.currentMode === 2 &&
    after.currentMode.currentProfileId === -1 &&
    after.currentMode.followPpcMode === before.currentMode.followPpcMode &&
    JSON.stringify(after.configuration) ===
      JSON.stringify(before.configuration) &&
    JSON.stringify(after.slots) === JSON.stringify(before.slots)
  );
};
export const makeTimeOfUseControls = (
  read: ProviderRead,
  write: ProviderWrite
) => {
  const client = makeTimeOfUseClient(read);
  const settings = makeSettingsClient(read);
  const profiles = makeProfileClient(read);
  return {
    dispatch: (
      stationId: StationId,
      token: Redacted.Redacted<string>,
      reviewed?: TimeOfUseSnapshot
    ) => {
      if (
        reviewed?.settings.stationId !== stationId ||
        !Number.isSafeInteger(Number(stationId))
      ) {
        return failure("SchemaMismatch");
      }
      return write(
        "PUT",
        "/device/energy-profile/mode",
        {
          fromPlatform: 1,
          operationMode: 2,
          profileId: -1,
          stationId: Number(stationId),
        },
        token,
        "boolean_true"
      );
    },
    inspect: (stationId: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* inspectTimeOfUse() {
        const state = yield* client.timeOfUseSettings(stationId, token);
        const currentMode = yield* read(
          `/device/energy-profile/mode/current/${stationId}`,
          token
        ).pipe(Effect.flatMap(decodeProvider(CurrentMode)));
        return {
          kind: "time_of_use" as const,
          settings: { ...state, currentMode },
        };
      }),
    validate: (snapshot: TimeOfUseSnapshot, token: Redacted.Redacted<string>) =>
      Effect.gen(function* validateTimeOfUse() {
        const state = snapshot.settings;
        if (
          state.currentMode.followPpcMode === true ||
          !knownManualSchedule(state)
        ) {
          return yield* failure("UnsupportedCapability");
        }
        const modes = yield* settings.operatingModes(state.stationId, token);
        const { currentMode, currentProfileId } = state.currentMode;
        const knownMode =
          currentMode === 9
            ? modes.customProfiles.some(
                (profile) => profile.profileId === currentProfileId
              )
            : [0, 1, 2, 5].includes(currentMode) && currentProfileId === -1;
        if (!knownMode) {
          return yield* failure("UnsupportedCapability");
        }
        if (!modes.modes.some((mode) => mode.providerMode === "2")) {
          return yield* failure("UnsupportedCapability");
        }
        const features = (yield* profiles.energyCapabilities(
          state.stationId,
          token
        )).providerFeatures;
        if (!features.support || features.isIndustry) {
          return yield* failure("UnsupportedCapability");
        }
      }),
  };
};
