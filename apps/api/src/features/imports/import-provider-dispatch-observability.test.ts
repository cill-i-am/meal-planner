import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vitest";

import {
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  makePilotProviderBudgetRuntime,
} from "../pilots/pilot-provider-budget.js";
import type { PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.js";
import { ImportCorrelationId } from "./import-observability.js";
import {
  failAfter,
  makePilotProviderDispatchGate,
} from "./import-provider-adapters.js";

const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b1a"
);
const now = Schema.decodeUnknownSync(PilotBudgetTimestamp)(
  "2026-07-27T20:00:00.000Z"
);
const runId = Schema.decodeUnknownSync(PilotBudgetRunId)(
  "gaia-118:opaque-import"
);

const repository: PilotProviderBudgetRepository = {
  beginInvocation: (input) =>
    Effect.succeed({
      _tag: "Claimed",
      dispatch: {
        actualCostMicroUsd: null,
        ...input,
        state: "invoking",
      },
    }),
  readStage: () =>
    Effect.succeed({
      budgetCapMicroUsd: 10_000_000,
      reservedMicroUsd: 0,
      settledMicroUsd: 0,
      state: "open",
    }),
  releaseBeforeInvocation: (input) =>
    Effect.succeed({
      actualCostMicroUsd: null,
      ...input,
      state: "released",
    }),
  reserve: (input) =>
    Effect.succeed({
      actualCostMicroUsd: null,
      ...input,
      state: "reserved",
    }),
  settleKnown: (input) =>
    Effect.succeed({
      ...input,
      state: "settled_known",
    }),
  settleUnknown: (input) =>
    Effect.succeed({
      actualCostMicroUsd: null,
      ...input,
      state: "settled_unknown",
    }),
};

describe("provider dispatch observability", () => {
  it("emits the closed timeout event without leaking the failed operation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const exit = await Effect.runPromise(
      Effect.gen(function* timeoutProvider() {
        const fiber = yield* Effect.forkChild(
          failAfter(Effect.never, {
            correlationId,
            providerStage: "speech",
          })
        );
        yield* Effect.yieldNow;
        yield* TestClock.adjust("60 seconds");
        return yield* Fiber.await(fiber);
      }).pipe(Effect.provide(TestClock.layer({ warningDelay: "10 seconds" })))
    );

    expect(exit).toMatchObject({ _tag: "Failure" });
    expect(log.mock.calls).toEqual([
      [
        {
          correlationId,
          event: "provider.timeout",
          outcome: "timed_out",
          providerStage: "speech",
        },
      ],
    ]);
    log.mockRestore();
  });

  it("emits the closed poison event only after an unknown-cost settlement", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const gate = makePilotProviderDispatchGate({
      correlationId,
      now: () => now,
      repository,
      runId,
      runtime: makePilotProviderBudgetRuntime("pilot-gaia-118"),
    });

    await expect(
      Effect.runPromise(
        gate.run({
          dispatchId: "speech:opaque-import:unknown",
          invoke: Effect.succeed({
            cost: { _tag: "Unknown" },
            value: "private-provider-result",
          }),
          maximumCostMicroUsd: 10,
          providerStage: "speech",
          providerStageId: "speech-transcription",
        })
      )
    ).resolves.toBe("private-provider-result");

    expect(log.mock.calls).toEqual([
      [
        {
          correlationId,
          event: "budget.reservation",
          outcome: "reserved",
          providerStage: "speech",
        },
      ],
      [
        {
          correlationId,
          event: "provider.dispatch",
          outcome: "started",
          providerStage: "speech",
        },
      ],
      [
        {
          correlationId,
          event: "provider.settlement",
          outcome: "unknown",
          providerStage: "speech",
        },
      ],
      [
        {
          correlationId,
          event: "budget.poison",
          outcome: "poisoned",
          providerStage: "speech",
        },
      ],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /private-provider-result|https?:|prompt|transcript|cookie|authorization|credential|media|payload/iu
    );
    log.mockRestore();
  });

  it("correlates dispatch and durable settlement without provider data", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const gate = makePilotProviderDispatchGate({
      correlationId,
      now: () => now,
      repository,
      runId,
      runtime: makePilotProviderBudgetRuntime("pilot-gaia-118"),
    });

    await expect(
      Effect.runPromise(
        gate.run({
          dispatchId: "speech:opaque-import:1",
          invoke: Effect.succeed({
            cost: { _tag: "Known", actualCostMicroUsd: 7 },
            value: "private-provider-result",
          }),
          maximumCostMicroUsd: 10,
          providerStage: "speech",
          providerStageId: "speech-transcription",
        })
      )
    ).resolves.toBe("private-provider-result");

    expect(log.mock.calls).toEqual([
      [
        {
          correlationId,
          event: "budget.reservation",
          outcome: "reserved",
          providerStage: "speech",
        },
      ],
      [
        {
          correlationId,
          event: "provider.dispatch",
          outcome: "started",
          providerStage: "speech",
        },
      ],
      [
        {
          correlationId,
          event: "provider.settlement",
          outcome: "known",
          providerStage: "speech",
        },
      ],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /private-provider-result|https?:|prompt|transcript|cookie|authorization|credential|media|payload/iu
    );
    log.mockRestore();
  });

  it("does not report a dispatch when budget authority rejects before invocation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const rejectingRepository: PilotProviderBudgetRepository = {
      ...repository,
      reserve: (input) =>
        Effect.succeed({
          ...input,
          actualCostMicroUsd: null,
          state: "settled_unknown",
        }),
    };
    const gate = makePilotProviderDispatchGate({
      correlationId,
      now: () => now,
      repository: rejectingRepository,
      runId,
      runtime: makePilotProviderBudgetRuntime("pilot-gaia-118"),
    });

    await expect(
      Effect.runPromise(
        gate.run({
          dispatchId: "speech:opaque-import:rejected",
          invoke: Effect.die("provider must not run"),
          maximumCostMicroUsd: 10,
          providerStage: "speech",
          providerStageId: "speech-transcription",
        })
      )
    ).rejects.toMatchObject({ _tag: "ProviderDispatchRejected" });

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
