import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import { failure } from "./model.js";
import { emptyRequestBudget, makeRequestBudget } from "./request-budget.js";
import type { RequestBudgetState } from "./request-budget.js";

describe("account provider budget", () => {
  it("keeps the rolling budget and provider backoff across client reconstruction", async () => {
    await Effect.runPromise(
      Effect.gen(function* verifyBudget() {
        yield* TestClock.setTime(100_000);
        let state: RequestBudgetState = emptyRequestBudget;
        const storage = {
          read: Effect.sync(() => state),
          write: (next: RequestBudgetState) =>
            Effect.sync(() => {
              state = next;
            }),
        };
        const first = yield* makeRequestBudget(storage);
        for (let i = 0; i < 30; i += 1) {
          yield* first.beforeRequest;
          yield* TestClock.adjust(500);
        }
        const restored = yield* makeRequestBudget(storage);
        expect(yield* restored.beforeRequest.pipe(Effect.result)).toMatchObject(
          { _tag: "Failure", failure: { reason: "RateLimited" } }
        );
        yield* TestClock.adjust(60_000);
        yield* restored.beforeRequest;
        yield* restored.rateLimited();
        const blockedUntil = (yield* Clock.currentTimeMillis) + 60_000;
        expect(state.blockedUntil).toBe(blockedUntil);
        const restarted = yield* makeRequestBudget(storage);
        expect(
          yield* restarted.beforeRequest.pipe(Effect.result)
        ).toMatchObject({
          _tag: "Failure",
          failure: { reason: "RateLimited" },
        });
        yield* TestClock.adjust(60_000);
        yield* restarted.beforeRequest;
        expect(state.reservations).toHaveLength(1);
      }).pipe(Effect.provide(TestClock.layer()))
    );
  });
  it.each(["120", "Thu, 01 Jan 1970 00:03:40 GMT"])(
    "honors provider Retry-After %s across reconstruction",
    async (retryAfter) => {
      await Effect.runPromise(
        Effect.gen(function* providerDeadline() {
          yield* TestClock.setTime(100_000);
          let state: RequestBudgetState = emptyRequestBudget;
          const storage = {
            read: Effect.sync(() => state),
            write: (next: RequestBudgetState) =>
              Effect.sync(() => {
                state = next;
              }),
          };
          const budget = yield* makeRequestBudget(storage);
          yield* budget.rateLimited(retryAfter);
          expect(state.blockedUntil).toBe(220_000);
          yield* TestClock.adjust(60_000);
          const restored = yield* makeRequestBudget(storage);
          expect(
            yield* restored.beforeRequest.pipe(Effect.result)
          ).toMatchObject({ failure: { reason: "RateLimited" } });
          yield* TestClock.adjust(60_000);
          yield* restored.beforeRequest;
        }).pipe(Effect.provide(TestClock.layer()))
      );
    }
  );
  it("refuses dispatch if accounting cannot be persisted", async () => {
    const budget = await Effect.runPromise(
      makeRequestBudget({
        read: Effect.succeed(emptyRequestBudget),
        write: () => Effect.fail(failure("StorageUnavailable")),
      })
    );
    expect(
      await Effect.runPromise(budget.beforeRequest.pipe(Effect.result))
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "StorageUnavailable" },
    });
  });
});
