import { Data, Schema } from "effect";

export const StationId = Schema.String.check(
  Schema.isPattern(/^[1-9][0-9]{0,15}$/u)
).pipe(Schema.brand("SigenStationId"));
export type StationId = typeof StationId.Type;
export const SerialNumber = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9-]{1,64}$/u)
).pipe(Schema.brand("SigenSerialNumber"));
export type SerialNumber = typeof SerialNumber.Type;
export const Percent = Schema.Finite.check(
  Schema.isBetween({ maximum: 100, minimum: 0 })
);
export const Timestamp = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0)
);
export const EmptyInput = Schema.Struct({});
export const StationInput = Schema.Struct({ stationId: StationId });

export const FailureReason = Schema.Literals([
  "AuthenticationRequired",
  "PermissionDenied",
  "RateLimited",
  "UnsupportedCapability",
  "UpstreamUnavailable",
  "SchemaMismatch",
  "InvalidInput",
  "StorageUnavailable",
  "ApprovalRequired",
  "Conflict",
  "CommandOutcomeUnknown",
]);
export class SigenFailure extends Data.TaggedError("SigenFailure")<{
  readonly reason: typeof FailureReason.Type;
  readonly upstreamHttpStatus?: number | undefined;
}> {}
export const failure = (
  reason: SigenFailure["reason"],
  upstreamHttpStatus?: number
) => new SigenFailure({ reason, upstreamHttpStatus });

const Capability = Schema.Literals(["available", "unavailable", "unknown"]);
export const Station = Schema.Struct({
  batteryCapacityKwh: Schema.NullOr(Schema.Finite),
  capabilities: Schema.Struct({
    acCharger: Capability,
    dcCharger: Capability,
    gateway: Capability,
    solar: Capability,
  }),
  fetchedAt: Timestamp,
  name: Schema.String,
  onGrid: Schema.Boolean,
  providerStatus: Schema.Number,
  solarCapacityKw: Schema.NullOr(Schema.Finite),
  stationId: StationId,
  timezone: Schema.String,
});
export type Station = typeof Station.Type;

export const EnergyFlow = Schema.Struct({
  batteryPowerConvention: Schema.Literal("positive_charge_negative_discharge"),
  batteryPowerW: Schema.NullOr(Schema.Finite),
  batterySocPercent: Schema.NullOr(Percent),
  fetchedAt: Timestamp,
  freshness: Schema.Literals(["provider_timestamp", "unknown"]),
  gridPowerConvention: Schema.Literal("provider_sign_unverified"),
  gridPowerW: Schema.NullOr(Schema.Finite),
  loadPowerW: Schema.NullOr(Schema.Finite),
  onGrid: Schema.Boolean,
  providerStatus: Schema.Number,
  providerTimestamp: Schema.NullOr(Timestamp),
  solarPowerW: Schema.NullOr(Schema.Finite),
  stationId: StationId,
});
export type EnergyFlow = typeof EnergyFlow.Type;

export const OperatingMode = Schema.Struct({
  fetchedAt: Timestamp,
  profileId: Schema.Number,
  providerMode: Schema.Number,
  stationId: StationId,
});
export const TokenBundle = Schema.Struct({
  accessToken: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16_384),
    Schema.isPattern(/^[^\r\n]+$/u)
  ),
  expiresAt: Timestamp,
  refreshToken: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16_384)
  ),
});
export type TokenBundle = typeof TokenBundle.Type;
export const Enrollment = Schema.Struct({
  password: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(1024)
  ),
  stationId: StationId,
  username: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(254)),
});
export type Enrollment = typeof Enrollment.Type;

export const ConnectionStatus = Schema.Struct({
  accessTokenExpiresAt: Schema.NullOr(Timestamp),
  controls: Schema.Literals(["disabled_pending_acceptance", "enabled"]),
  state: Schema.Literals([
    "disconnected",
    "connected",
    "reauthentication_required",
  ]),
  stationId: Schema.NullOr(StationId),
  successfulRenewals: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0)
  ),
});
