import {
  ConnectionStatus,
  FailureReason,
  StationId,
  Timestamp,
  failure,
} from "@meal-planner/sigen";
import type {
  ActiveProfileLimitScope,
  ControlOperation,
  Enrollment,
  SigenFailure,
  TokenBundle,
} from "@meal-planner/sigen";
import type { SigenClient } from "@meal-planner/sigen/client";
import { Clock, Effect, Redacted, Schema, Semaphore } from "effect";

import { EncryptedSecret, makeVault } from "./vault.js";

const Renewal = Schema.Struct({
  newExpiry: Schema.NullOr(Timestamp),
  previousExpiry: Timestamp,
  result: Schema.Literals(["renewed", "reauthentication_required"]),
  startedAt: Timestamp,
  trigger: Schema.optionalKey(Schema.Literals(["alarm", "read"])),
  verification: Schema.optionalKey(
    Schema.Struct({
      completedAt: Timestamp,
      energyFlowFailure: Schema.NullOr(FailureReason),
      stationFailure: Schema.NullOr(FailureReason),
    })
  ),
});
export const SessionReport = Schema.Struct({
  health: ConnectionStatus,
  renewals: Schema.Array(Renewal).check(Schema.isMaxLength(5)),
});
const Active = {
  connectionId: Schema.String,
  expiresAt: Timestamp,
  secret: EncryptedSecret,
  stationId: StationId,
};
export const SessionRecord = Schema.Struct({
  renewals: Schema.Array(Renewal).check(Schema.isMaxLength(5)),
  session: Schema.Union([
    Schema.Struct({ phase: Schema.Literal("disconnected") }),
    Schema.Struct({ phase: Schema.Literal("reauthentication_required") }),
    Schema.Struct({ phase: Schema.Literal("ready"), ...Active }),
    Schema.Struct({ phase: Schema.Literal("refreshing"), ...Active }),
  ]),
  successfulRenewals: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0)
  ),
});
export type SessionRecord = typeof SessionRecord.Type;
export const emptySession: SessionRecord = {
  renewals: [],
  session: { phase: "disconnected" },
  successfulRenewals: 0,
};
export interface SessionStorage<R = never> {
  readonly read: Effect.Effect<SessionRecord, SigenFailure, R>;
  readonly write: (
    record: SessionRecord,
    alarmAt: number | null
  ) => Effect.Effect<void, SigenFailure, R>;
}
const RefreshMarginMs = 60_000;

const connectionState = (phase: SessionRecord["session"]["phase"]) => {
  if (phase === "ready") {
    return "connected";
  }
  return phase === "disconnected"
    ? "disconnected"
    : "reauthentication_required";
};

/** One instance per account DO. The semaphore covers enrollment, renewal, reads, and disconnect. */
export const makeSession = <R>(
  storage: SessionStorage<R>,
  encryptionKey: Redacted.Redacted<string>,
  client: SigenClient,
  enabledOperations: readonly ControlOperation[] = [],
  enabledActiveProfileLimits: readonly ActiveProfileLimitScope[] = []
) =>
  Effect.gen(function* constructSession() {
    const lock = yield* Semaphore.make(1);
    const vault = makeVault(encryptionKey);
    const clear = (record: SessionRecord) =>
      storage.write(
        { ...record, session: { phase: "reauthentication_required" } },
        null
      );
    const decryptTokens = (input: EncryptedSecret) =>
      vault.decrypt(input).pipe(
        Effect.flatMap((secret) => {
          const value = Redacted.value(secret);
          return value.kind === "tokens"
            ? Effect.succeed(Redacted.make(value.value))
            : Effect.fail(failure("StorageUnavailable"));
        })
      );
    const persist = (
      record: SessionRecord,
      session: { stationId: StationId; connectionId: string },
      tokens: Redacted.Redacted<TokenBundle>,
      alarmAt = Redacted.value(tokens).expiresAt - RefreshMarginMs
    ) =>
      Effect.gen(function* persistTokens() {
        const value = Redacted.value(tokens);
        const secret = yield* vault.encrypt(
          Redacted.make({ kind: "tokens", value })
        );
        yield* storage.write(
          {
            ...record,
            session: {
              ...session,
              expiresAt: value.expiresAt,
              phase: "ready",
              secret,
            },
          },
          alarmAt
        );
      });
    const verifyRenewal = (
      stationId: StationId,
      tokens: Redacted.Redacted<TokenBundle>
    ) =>
      Effect.gen(function* verifyRenewedReads() {
        const token = Redacted.make(Redacted.value(tokens).accessToken);
        const [station, energyFlow] = yield* Effect.all(
          [
            client.station(stationId, token).pipe(Effect.result),
            client.energyFlow(stationId, token).pipe(Effect.result),
          ],
          { concurrency: 2 }
        );
        const verification = {
          completedAt: yield* Clock.currentTimeMillis,
          energyFlowFailure:
            energyFlow._tag === "Failure" ? energyFlow.failure.reason : null,
          stationFailure:
            station._tag === "Failure" ? station.failure.reason : null,
        };
        const record = yield* storage.read;
        const revoked =
          verification.stationFailure === "AuthenticationRequired" ||
          verification.energyFlowFailure === "AuthenticationRequired";
        yield* storage.write(
          {
            ...record,
            renewals: record.renewals.map((renewal, index) =>
              index === record.renewals.length - 1
                ? { ...renewal, verification }
                : renewal
            ),
            session: revoked
              ? { phase: "reauthentication_required" }
              : record.session,
          },
          revoked ? null : Redacted.value(tokens).expiresAt - RefreshMarginMs
        );
        if (revoked) {
          return yield* failure("AuthenticationRequired");
        }
      });
    const refresh = (record: SessionRecord, trigger: "alarm" | "read") =>
      Effect.gen(function* rotateSession() {
        const { session } = record;
        if (session.phase !== "ready") {
          yield* clear(record);
          return yield* failure("AuthenticationRequired");
        }
        const tokens = yield* decryptTokens(session.secret);
        const startedAt = yield* Clock.currentTimeMillis;

        yield* storage.write(
          { ...record, session: { ...session, phase: "refreshing" } },
          startedAt + 60_000
        );
        const result = yield* client
          .refresh(Redacted.make(Redacted.value(tokens).refreshToken))
          .pipe(Effect.result);
        if (result._tag === "Failure") {
          if (result.failure.requestNotSent === true) {
            yield* storage.write(
              record,
              (yield* Clock.currentTimeMillis) + 60_000
            );
            return yield* result.failure;
          }
          yield* storage.write(
            {
              ...record,
              renewals: [
                ...record.renewals,
                {
                  newExpiry: null,
                  previousExpiry: session.expiresAt,
                  result: "reauthentication_required" as const,
                  startedAt,
                  trigger,
                },
              ].slice(-5),
              session: { phase: "reauthentication_required" },
            },
            null
          );
          return yield* failure("AuthenticationRequired");
        }
        const newExpiry = Redacted.value(result.success).expiresAt;
        if (newExpiry <= (yield* Clock.currentTimeMillis)) {
          yield* clear(record);
          return yield* failure("AuthenticationRequired");
        }
        yield* persist(
          {
            ...record,
            renewals: [
              ...record.renewals,
              {
                newExpiry,
                previousExpiry: session.expiresAt,
                result: "renewed" as const,
                startedAt,
                trigger,
              },
            ].slice(-5),
            successfulRenewals: record.successfulRenewals + 1,
          },
          session,
          result.success,
          Math.min(
            startedAt + 60_000,
            startedAt + Math.floor((newExpiry - startedAt) / 2)
          )
        );

        yield* verifyRenewal(session.stationId, result.success);
        return result.success;
      });
    const tokensFor = (stationId: StationId) =>
      Effect.gen(function* selectCredentials() {
        const record = yield* storage.read;
        const { session } = record;
        if (session.phase === "refreshing") {
          yield* clear(record);
          return yield* failure("AuthenticationRequired");
        }
        if (session.phase !== "ready") {
          return yield* failure("AuthenticationRequired");
        }
        if (session.stationId !== stationId) {
          return yield* failure("PermissionDenied");
        }
        const now = yield* Clock.currentTimeMillis;
        const renewed = session.expiresAt - RefreshMarginMs <= now;
        const tokens = renewed
          ? yield* refresh(record, "read")
          : yield* decryptTokens(session.secret);
        return { renewed, tokens };
      });
    const read = <A>(
      stationId: StationId,
      operation: (
        token: Redacted.Redacted<string>
      ) => Effect.Effect<A, SigenFailure>
    ) =>
      lock.withPermits(1)(
        Effect.gen(function* readWithCredentials() {
          const credentials = yield* tokensFor(stationId);
          const invoke = (bundle: Redacted.Redacted<TokenBundle>) =>
            operation(Redacted.make(Redacted.value(bundle).accessToken));
          return yield* invoke(credentials.tokens).pipe(
            Effect.catchTag("SigenFailure", (error) =>
              error.reason === "AuthenticationRequired"
                ? Effect.gen(function* renewRejectedRead() {
                    if (credentials.renewed) {
                      yield* clear(yield* storage.read);
                      return yield* failure("AuthenticationRequired");
                    }
                    const renewed = yield* refresh(yield* storage.read, "read");
                    return yield* invoke(renewed).pipe(
                      Effect.tapError((readError) =>
                        readError.reason === "AuthenticationRequired"
                          ? storage.read.pipe(Effect.flatMap(clear))
                          : Effect.void
                      )
                    );
                  })
                : Effect.fail(error)
            )
          );
        })
      );
    const readStation =
      <A>(
        vendor: (
          stationId: StationId,
          token: Redacted.Redacted<string>
        ) => Effect.Effect<A, SigenFailure>
      ) =>
      (stationId: StationId) =>
        read(stationId, (token) => vendor(stationId, token));

    const readStationInput =
      <I extends { readonly stationId: StationId }, A>(
        vendor: (
          input: I,
          token: Redacted.Redacted<string>
        ) => Effect.Effect<A, SigenFailure>
      ) =>
      (input: I) =>
        read(input.stationId, (token) => vendor(input, token));

    const health = storage.read.pipe(
      Effect.flatMap((record) => {
        const { session } = record;
        const status = {
          accessTokenExpiresAt:
            "expiresAt" in session ? session.expiresAt : null,
          controls:
            enabledOperations.length > 0
              ? "enabled"
              : "disabled_pending_acceptance",
          enabledOperations,
          state: connectionState(session.phase),
          stationId: "stationId" in session ? session.stationId : null,
          successfulRenewals: record.successfulRenewals,
        };
        return Schema.decodeUnknownEffect(ConnectionStatus)(
          enabledActiveProfileLimits.length === 0
            ? status
            : { ...status, enabledActiveProfileLimits }
        ).pipe(Effect.mapError(() => failure("StorageUnavailable")));
      })
    );
    return {
      acChargerCurrent: readStationInput(client.acChargerCurrent),
      acChargerSettings: readStationInput(client.acChargerSettings),
      aioDevices: readStation(client.aioDevices),
      aioPowerStatus: readStationInput(client.aioPowerStatus),
      alarms: readStationInput(client.alarms),
      automationSettings: readStation(client.automationSettings),
      backupEvents: readStationInput(client.backupEvents),
      backupHistory: readStationInput(client.backupHistory),
      batteryDischargePriority: readStation(client.batteryDischargePriority),
      batterySettings: readStation(client.batterySettings),
      chargerSchedules: readStationInput(client.chargerSchedules),
      chargerStatus: readStationInput(client.chargerStatus),
      chargers: readStation(client.chargers),
      dcChargerSettings: readStationInput(client.dcChargerSettings),
      deviceInfo: readStationInput(client.deviceInfo),
      deviceValues: readStationInput(client.deviceValues),
      disconnect: lock.withPermits(1)(storage.write(emptySession, null)),
      energyCapabilities: readStation(client.energyCapabilities),
      energyFlow: readStation(client.energyFlow),
      energyHistory: readStationInput(client.energyHistory),
      energyProfile: readStationInput(client.energyProfile),
      energySavingSettings: readStation(client.energySavingSettings),
      enroll: (input: Redacted.Redacted<Enrollment>) =>
        lock.withPermits(1)(
          Effect.gen(function* enrollSession() {
            const enrollment = Redacted.value(input);
            const tokens = yield* client.login(input);
            yield* client.station(
              enrollment.stationId,
              Redacted.make(Redacted.value(tokens).accessToken)
            );
            yield* persist(
              emptySession,
              {
                connectionId: crypto.randomUUID(),
                stationId: enrollment.stationId,
              },
              tokens
            );
            return yield* health;
          })
        ),
      forecast: readStationInput(client.forecast),
      gateway: readStation(client.gateway),
      gridDevices: readStation(client.gridDevices),
      gridSettings: readStation(client.gridSettings),
      health: lock.withPermits(1)(health),
      loadCapabilities: readStation(client.loadCapabilities),
      manualOverride: readStation(client.manualOverride),
      onAlarm: lock.withPermits(1)(
        Effect.gen(function* handleRenewalAlarm() {
          const record = yield* storage.read;
          if (record.session.phase === "refreshing") {
            yield* clear(record);
            return;
          }
          if (record.session.phase !== "ready") {
            return;
          }
          const now = yield* Clock.currentTimeMillis;
          const renewal = record.renewals.at(-1);
          if (
            now < record.session.expiresAt &&
            renewal?.trigger !== undefined &&
            renewal.result === "renewed" &&
            renewal.newExpiry === record.session.expiresAt &&
            renewal.verification === undefined
          ) {
            yield* verifyRenewal(
              record.session.stationId,
              yield* decryptTokens(record.session.secret)
            );
            return;
          }
          const due = record.session.expiresAt - RefreshMarginMs;
          if (now < due) {
            yield* storage.write(record, due);
            return;
          }
          yield* refresh(record, "alarm");
        }).pipe(
          Effect.catchTag("SigenFailure", (failureValue) =>
            failureValue.reason === "AuthenticationRequired"
              ? Effect.void
              : Effect.fail(failureValue)
          )
        )
      ),
      operatingMode: readStation(client.operatingMode),
      operatingModes: readStation(client.operatingModes),
      peakShavingSchedule: readStation(client.peakShavingSchedule),
      predictionPlan: readStation(client.predictionPlan),
      preheatingSettings: readStation(client.preheatingSettings),
      profileTemplates: readStation(client.profileTemplates),
      report: lock.withPermits(1)(
        Effect.gen(function* reportSession() {
          return {
            health: yield* health,
            renewals: (yield* storage.read).renewals,
          };
        })
      ),
      smartLoad: readStationInput(client.smartLoad),
      smartLoadConsumption: readStationInput(client.smartLoadConsumption),
      smartLoadControlSettings: readStationInput(
        client.smartLoadControlSettings
      ),
      smartLoads: readStation(client.smartLoads),
      solarPriority: readStation(client.solarPriority),
      solarSettings: readStation(client.solarSettings),
      station: readStation(client.station),
      stationCapabilities: readStation(client.stationCapabilities),
      stationConsumption: readStationInput(client.stationConsumption),
      stationIncome: readStationInput(client.stationIncome),
      stationStatus: readStation(client.stationStatus),
      stations: readStation(client.stations),
      systemCards: readStation(client.systemCards),
      tariffs: readStation(client.tariffs),
      thirdPartyDevices: readStation(client.thirdPartyDevices),
      timeOfUseSettings: readStation(client.timeOfUseSettings),
      topology: readStation(client.topology),

      withConnection: <A, E, R2>(
        stationId: StationId,
        operation: (
          token: Redacted.Redacted<string>,
          connectionId: string
        ) => Effect.Effect<A, E, R2>
      ) =>
        lock.withPermits(1)(
          Effect.gen(function* useConnection() {
            const credentials = yield* tokensFor(stationId);
            const record = yield* storage.read;
            if (record.session.phase !== "ready") {
              return yield* failure("AuthenticationRequired");
            }
            return yield* operation(
              Redacted.make(Redacted.value(credentials.tokens).accessToken),
              record.session.connectionId
            );
          })
        ),
    };
  });
