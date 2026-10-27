import { Schema, absurd } from "effect";

import {
  FailureReason,
  OperatingMode,
  Percent,
  StationId,
  Timestamp,
} from "./model.js";
import {
  BatterySettings,
  GridSettings,
  ManualOverride,
  PeakShavingSchedule,
  PeakShavingSlot,
  SolarSettings,
} from "./settings.js";

const WholePercent = Percent.check(Schema.isInt());
export const WritablePowerLimit = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unlimited") }),
  Schema.Struct({
    kind: Schema.Literal("limited"),
    watts: Schema.Int.check(
      Schema.isBetween({ maximum: 4_294_967_294, minimum: 0 })
    ),
  }),
]);
const Watts = Schema.Int.check(
  Schema.isBetween({ maximum: 4_294_967_294, minimum: 0 })
);
export const ControlChange = Schema.Union([
  Schema.Struct({
    backupSocPercent: WholePercent,
    chargeSocPercent: WholePercent,
    dischargeSocPercent: WholePercent,
    operation: Schema.Literal("set_battery_soc_thresholds"),
    peakShavingSocPercent: WholePercent,
  }).check(
    Schema.makeFilter(
      (value) =>
        value.dischargeSocPercent <= value.chargeSocPercent &&
        value.backupSocPercent <= value.chargeSocPercent &&
        value.peakShavingSocPercent <= value.chargeSocPercent
    )
  ),
  Schema.Struct({
    enabled: Schema.Boolean,
    operation: Schema.Literal("set_peak_shaving_schedule"),
    reserveSocPercent: WholePercent,
    // Existing day/time windows are reviewed in full and preserved until their day-code semantics are verified.
    slots: Schema.Array(
      Schema.Struct({ ...PeakShavingSlot.fields, peakPowerW: Watts })
    ).check(Schema.isMaxLength(64)),
    timezone: PeakShavingSchedule.fields.timezone,
  }),
  Schema.Struct({ operation: Schema.Literal("stop_manual_override") }),
  Schema.Struct({
    operation: Schema.Literal("set_backup_reserve"),
    reservePercent: WholePercent,
  }),
  Schema.Struct({
    charge: WritablePowerLimit,
    discharge: WritablePowerLimit,
    operation: Schema.Literal("set_battery_power_limits"),
  }),
  Schema.Struct({
    limit: WritablePowerLimit,
    operation: Schema.Literal("set_solar_power_limit"),
  }),
  Schema.Struct({
    enabled: Schema.Boolean,
    operation: Schema.Literal("set_battery_export"),
  }),
  Schema.Struct({
    operation: Schema.Literal("set_grid_export_limit"),
    watts: Watts,
  }),
  Schema.Struct({
    operation: Schema.Literal("set_grid_import_limit"),
    watts: Watts,
  }),
  Schema.Struct({
    amperes: Schema.Finite.check(
      Schema.isGreaterThan(0),
      Schema.isMultipleOf(0.1)
    ),
    operation: Schema.Literal("set_grid_connection_current"),
  }),
  Schema.Struct({
    operation: Schema.Literal("set_operating_mode"),
    profileId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(-1)),
    providerMode: Schema.Literals([0, 1, 5]),
  }),
]);
export type ControlChange = typeof ControlChange.Type;
export const ControlSnapshot = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("battery"), settings: BatterySettings }),
  Schema.Struct({ kind: Schema.Literal("grid"), settings: GridSettings }),
  Schema.Struct({ kind: Schema.Literal("solar"), settings: SolarSettings }),
  Schema.Struct({ kind: Schema.Literal("mode"), settings: OperatingMode }),
  Schema.Struct({
    kind: Schema.Literal("peak_shaving"),
    settings: PeakShavingSchedule,
  }),
  Schema.Struct({
    kind: Schema.Literal("manual"),
    settings: Schema.Struct({
      enabled: ManualOverride.fields.enabled,
      fetchedAt: Timestamp,
      providerEndTime: ManualOverride.fields.providerEndTime,
      providerMode: ManualOverride.fields.providerMode,
      stationId: StationId,
    }),
  }),
]);
export type ControlSnapshot = typeof ControlSnapshot.Type;
export const CommandId = Schema.String.check(Schema.isUUID());
const Fingerprint = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
export const PrepareCommandInput = Schema.Struct({
  change: ControlChange,
  commandId: CommandId,
  stationId: StationId,
});
export const CommandInput = Schema.Struct({
  commandId: CommandId,
  stationId: StationId,
});
export const ApproveCommandInput = Schema.Struct({
  ...CommandInput.fields,
  change: ControlChange,
  current: ControlSnapshot,
  mode: Schema.Literals(["once", "always"]),
  reviewFingerprint: Fingerprint,
});
export const ApprovalScope = Schema.Struct({
  operation: Schema.Literals([
    "set_backup_reserve",
    "set_battery_power_limits",
    "set_solar_power_limit",
    "set_battery_export",
    "set_grid_export_limit",
    "set_grid_import_limit",
    "set_grid_connection_current",
    "set_operating_mode",
    "set_battery_soc_thresholds",
    "set_peak_shaving_schedule",
    "stop_manual_override",
  ]),
  stationId: StationId,
});
export const ApprovalGrant = Schema.Struct({
  createdAt: Timestamp,
  grantId: CommandId,
  scope: ApprovalScope,
});
export const ApprovalGrants = Schema.Struct({
  grants: Schema.Array(ApprovalGrant).check(Schema.isMaxLength(32)),
});
export const RevokeApprovalInput = Schema.Struct({
  grantId: CommandId,
  stationId: StationId,
});
const Attempt = { attemptedAt: Timestamp };
export const CommandPhase = Schema.Union([
  Schema.Struct({ status: Schema.Literal("prepared") }),
  Schema.Struct({
    approval: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("once") }),
      Schema.Struct({ grantId: CommandId, kind: Schema.Literal("grant") }),
    ]),
    status: Schema.Literal("approved"),
  }),
  Schema.Struct({ ...Attempt, status: Schema.Literal("dispatching") }),
  Schema.Struct({ ...Attempt, status: Schema.Literal("accepted") }),
  Schema.Struct({
    ...Attempt,
    observed: ControlSnapshot,
    observedAt: Timestamp,
    status: Schema.Literal("verified"),
  }),
  Schema.Struct({
    ...Attempt,
    reason: FailureReason,
    status: Schema.Literal("outcome_unknown"),
  }),
  Schema.Struct({ reason: FailureReason, status: Schema.Literal("rejected") }),
]);
export const CommandReview = Schema.Struct({
  change: ControlChange,
  commandId: CommandId,
  current: ControlSnapshot,
  expiresAt: Timestamp,
  preparedAt: Timestamp,
  reviewFingerprint: Fingerprint,
  stationId: StationId,
});
export const Command = Schema.Struct({
  phase: CommandPhase,
  review: CommandReview,
});
export type Command = typeof Command.Type;

/** Fetch times are not device configuration. Everything else in the relevant snapshot is conflict-sensitive. */
export const snapshotConfiguration = (snapshot: ControlSnapshot) => {
  const { fetchedAt: _fetchedAt, ...settings } = snapshot.settings;
  return JSON.stringify({ kind: snapshot.kind, settings });
};

const matchesPower = (
  actual: typeof SolarSettings.Type.powerLimit,
  expected: typeof WritablePowerLimit.Type
) =>
  actual.kind === expected.kind &&
  (actual.kind !== "limited" ||
    (expected.kind === "limited" &&
      Math.abs(actual.watts - expected.watts) < 0.001));

const matchesGridPower = (
  change: Extract<
    ControlChange,
    { operation: "set_grid_export_limit" | "set_grid_import_limit" }
  >,
  snapshot: ControlSnapshot
) => {
  if (snapshot.kind !== "grid") {
    return false;
  }
  const power =
    change.operation === "set_grid_export_limit"
      ? snapshot.settings.exportPower
      : snapshot.settings.importPower;
  return (
    power.enabled &&
    matchesPower(power.effective, { kind: "limited", watts: change.watts }) &&
    matchesPower(power.owner, { kind: "limited", watts: change.watts })
  );
};

const matchesGridCurrent = (amperes: number, snapshot: ControlSnapshot) => {
  if (snapshot.kind !== "grid") {
    return false;
  }
  const { connectionCurrent } = snapshot.settings;
  // The app clears the owner value when it equals the installer ceiling (pinned client.py272).
  const ownerMatches =
    connectionCurrent.ownerAmps === amperes ||
    (connectionCurrent.ownerAmps === null &&
      connectionCurrent.installerAmps === amperes);
  return (
    connectionCurrent.enabled &&
    connectionCurrent.effectiveAmps === amperes &&
    ownerMatches
  );
};

const matchesSoc = (
  change: Extract<ControlChange, { operation: "set_battery_soc_thresholds" }>,
  snapshot: ControlSnapshot
) =>
  snapshot.kind === "battery" &&
  snapshot.settings.chargeSocPercent === change.chargeSocPercent &&
  snapshot.settings.dischargeSocPercent === change.dischargeSocPercent &&
  snapshot.settings.backupSocPercent === change.backupSocPercent &&
  snapshot.settings.peakShavingSocPercent === change.peakShavingSocPercent;
const matchesPeakSchedule = (
  change: Extract<ControlChange, { operation: "set_peak_shaving_schedule" }>,
  snapshot: ControlSnapshot
) =>
  snapshot.kind === "peak_shaving" &&
  snapshot.settings.providerControlMode === (change.enabled ? 1 : 0) &&
  snapshot.settings.reserveSocPercent === change.reserveSocPercent &&
  snapshot.settings.timezone === change.timezone &&
  snapshot.settings.slots.length === change.slots.length &&
  snapshot.settings.slots.every((slot, index) => {
    const expected = change.slots[index];
    return (
      expected !== undefined &&
      slot.providerDays === expected.providerDays &&
      slot.startTime === expected.startTime &&
      slot.endTime === expected.endTime &&
      Math.abs(slot.peakPowerW - expected.peakPowerW) < 0.001
    );
  });

const matchesBatteryExport = (enabled: boolean, snapshot: ControlSnapshot) =>
  snapshot.kind === "battery" &&
  snapshot.settings.export.effectiveEnabled === enabled &&
  snapshot.settings.export.ownerEnabled === enabled;

export const controlMatches = (
  change: ControlChange,
  snapshot: ControlSnapshot
): boolean => {
  switch (change.operation) {
    case "set_battery_soc_thresholds": {
      return matchesSoc(change, snapshot);
    }
    case "set_peak_shaving_schedule": {
      return matchesPeakSchedule(change, snapshot);
    }
    case "stop_manual_override": {
      return snapshot.kind === "manual" && !snapshot.settings.enabled;
    }
    case "set_backup_reserve": {
      return (
        snapshot.kind === "battery" &&
        snapshot.settings.backupReservePercent === change.reservePercent
      );
    }
    case "set_battery_power_limits": {
      return (
        snapshot.kind === "battery" &&
        matchesPower(snapshot.settings.chargeLimit, change.charge) &&
        matchesPower(snapshot.settings.dischargeLimit, change.discharge)
      );
    }
    case "set_battery_export": {
      return matchesBatteryExport(change.enabled, snapshot);
    }

    case "set_solar_power_limit": {
      return (
        snapshot.kind === "solar" &&
        matchesPower(snapshot.settings.powerLimit, change.limit)
      );
    }
    case "set_grid_export_limit":
    case "set_grid_import_limit": {
      return matchesGridPower(change, snapshot);
    }
    case "set_grid_connection_current": {
      return matchesGridCurrent(change.amperes, snapshot);
    }
    case "set_operating_mode": {
      return (
        snapshot.kind === "mode" &&
        snapshot.settings.providerMode === change.providerMode &&
        snapshot.settings.profileId === change.profileId
      );
    }
    default: {
      return absurd<never>(change);
    }
  }
};
