import { Clock, Effect, Schema, Semaphore } from "effect";

import { Timestamp, failure } from "./model.js";
import type { SigenFailure } from "./model.js";

export const RequestBudgetState = Schema.Struct({
  blockedUntil: Timestamp,
  reservations: Schema.Array(Timestamp).check(Schema.isMaxLength(30)),
});
export type RequestBudgetState = typeof RequestBudgetState.Type;
export interface RequestBudget {
  readonly beforeRequest: Effect.Effect<void, SigenFailure>;
  readonly rateLimited: (
    retryAfter?: string
  ) => Effect.Effect<void, SigenFailure>;
}
export interface RequestBudgetStorage {
  readonly read: Effect.Effect<RequestBudgetState, SigenFailure>;
  readonly write: (
    state: RequestBudgetState
  ) => Effect.Effect<void, SigenFailure>;
}
export const emptyRequestBudget: RequestBudgetState = {
  blockedUntil: 0,
  reservations: [],
};

/** One budget per provider account, shared by auth, reads and commands. Reservations survive interruption and restart. */
export const makeRequestBudget = (storage: RequestBudgetStorage) =>
  Effect.gen(function* requestBudget() {
    const lock = yield* Semaphore.make(1);
    return {
      beforeRequest: lock.withPermit(
        Effect.gen(function* reserveRequest() {
          const state = yield* storage.read;
          const now = yield* Clock.currentTimeMillis;
          const recent = state.reservations.filter((at) => at > now - 60_000);
          if (state.blockedUntil > now || recent.length >= 30) {
            return yield* failure("RateLimited");
          }
          const last = recent.at(-1) ?? now - 400;
          const reservedAt = Math.max(now, last + 400);
          // Write before waiting: cancellation consumes this reservation, never creates an unaccounted request.
          yield* storage.write({
            blockedUntil: state.blockedUntil,
            reservations: [...recent, reservedAt],
          });
          if (reservedAt > now) {
            yield* Effect.sleep(reservedAt - now);
          }
        })
      ),
      rateLimited: (retryAfter?: string) =>
        lock.withPermit(
          Effect.gen(function* saveProviderBackoff() {
            const state = yield* storage.read;
            const now = yield* Clock.currentTimeMillis;
            let retryAt = 0;
            if (retryAfter !== undefined) {
              retryAt = /^\d+(?:\.\d+)?$/u.test(retryAfter)
                ? now + Number(retryAfter) * 1000
                : Date.parse(retryAfter);
            }
            yield* storage.write({
              ...state,
              blockedUntil: Math.max(
                state.blockedUntil,
                now + 60_000,
                Number.isSafeInteger(retryAt) ? retryAt : 0
              ),
            });
          })
        ),
    } satisfies RequestBudget;
  });
