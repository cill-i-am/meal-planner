import {
  ConnectionStatus,
  StationId,
  Timestamp,
  failure,
} from "@meal-planner/sigen";
import type {
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
  client: SigenClient
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
      tokens: Redacted.Redacted<TokenBundle>
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
          value.expiresAt - RefreshMarginMs
        );
      });
    const refresh = (record: SessionRecord) =>
      Effect.gen(function* rotateSession() {
        const { session } = record;
        if (session.phase !== "ready") {
          yield* clear(record);
          return yield* failure("AuthenticationRequired");
        }
        const tokens = yield* decryptTokens(session.secret);
        const startedAt = yield* Clock.currentTimeMillis;
        // A persisted marker plus watchdog prevents reuse of a token after an ambiguous process interruption.
        yield* storage.write(
          { ...record, session: { ...session, phase: "refreshing" } },
          startedAt + 60_000
        );
        const result = yield* client
          .refresh(Redacted.make(Redacted.value(tokens).refreshToken))
          .pipe(Effect.result);
        if (result._tag === "Failure") {
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
              },
            ].slice(-5),
            successfulRenewals: record.successfulRenewals + 1,
          },
          session,
          result.success
        );
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
          ? yield* refresh(record)
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
                    const renewed = yield* refresh(yield* storage.read);
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
    const health = storage.read.pipe(
      Effect.flatMap((record) => {
        const { session } = record;
        return Schema.decodeUnknownEffect(ConnectionStatus)({
          accessTokenExpiresAt:
            "expiresAt" in session ? session.expiresAt : null,
          controls: "disabled_pending_acceptance",
          state: connectionState(session.phase),
          stationId: "stationId" in session ? session.stationId : null,
          successfulRenewals: record.successfulRenewals,
        }).pipe(Effect.mapError(() => failure("StorageUnavailable")));
      })
    );
    return {
      disconnect: lock.withPermits(1)(storage.write(emptySession, null)),
      energyFlow: (id: StationId) =>
        read(id, (token) => client.energyFlow(id, token)),
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
      health: lock.withPermits(1)(health),
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
          const due = record.session.expiresAt - RefreshMarginMs;
          if ((yield* Clock.currentTimeMillis) < due) {
            yield* storage.write(record, due);
            return;
          }
          yield* refresh(record).pipe(
            Effect.catchTag("SigenFailure", (error) =>
              error.reason === "AuthenticationRequired"
                ? Effect.void
                : Effect.fail(error)
            )
          );
        })
      ),
      operatingMode: (id: StationId) =>
        read(id, (token) => client.operatingMode(id, token)),
      report: lock.withPermits(1)(
        Effect.gen(function* reportSession() {
          return {
            health: yield* health,
            renewals: (yield* storage.read).renewals,
          };
        })
      ),
      station: (id: StationId) =>
        read(id, (token) => client.station(id, token)),
    };
  });
