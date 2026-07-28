import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  PilotProviderBudgetRuntime,
  makePilotProviderBudgetRuntime,
  pilotProviderKnownZeroCostFailure,
  runPilotProviderDispatch,
} from "./pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "./pilot-provider-budget.repository.d1.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const decodeRunId = Schema.decodeUnknownSync(PilotBudgetRunId);
const decodeProviderStageId = Schema.decodeUnknownSync(
  PilotBudgetProviderStageId
);
const decodeDispatchId = Schema.decodeUnknownSync(PilotBudgetDispatchId);
const decodeTimestamp = Schema.decodeUnknownSync(PilotBudgetTimestamp);
const now = decodeTimestamp("2026-07-25T18:00:00.000Z");
const runtime = makePilotProviderBudgetRuntime("pilot-gaia-118");

const reservation = (
  runId: string,
  dispatchId: string,
  maximumCostMicroUsd: number
) => ({
  dispatchId: decodeDispatchId(dispatchId),
  maximumCostMicroUsd,
  providerStageId: decodeProviderStageId("recipe_extraction"),
  runId: decodeRunId(runId),
  timestamp: now,
});

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

beforeEach(async () => {
  await testEnv.MealPlannerDatabase.batch([
    testEnv.MealPlannerDatabase.prepare(
      "DELETE FROM pilot_provider_budget_dispatches"
    ),
    testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET settled_micro_usd = 0, reserved_micro_usd = 0,
              state = 'open', invoking_dispatch_id = NULL,
              poison_dispatch_id = NULL,
              updated_at = '2026-07-25T18:00:00.000Z'
        WHERE runtime_stage = 'pilot-gaia-118'`
    ),
  ]);
});

describe("pilot provider stage budget", () => {
  it("observes only known or unknown outcomes after durable settlement", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const outcomes: string[] = [];

    const result = await Effect.runPromise(
      runPilotProviderDispatch({
        invoke: Effect.succeed({
          cost: { _tag: "Known" as const, actualCostMicroUsd: 7 },
          value: "provider-result",
        }),
        onSettlement: (outcome) =>
          Effect.sync(() => {
            outcomes.push(outcome);
          }),
        repository,
        reservation: reservation("run_observed", "dispatch_observed", 10),
      }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime))
    );

    expect(result).toMatchObject({
      _tag: "Completed",
      actualCostMicroUsd: 7,
    });
    expect(outcomes).toEqual(["known"]);
  });

  it("adds one exact stage authority without changing provider-stage row invariants", async () => {
    const schemas = await testEnv.MealPlannerDatabase.prepare(
      `SELECT name, sql FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'pilot_provider_stage_budget',
          'pilot_provider_budget_dispatches',
          'import_transcriptions',
          'import_visual_evidence',
          'import_recipe_extractions'
        )
        ORDER BY name`
    ).all<{ name: string; sql: string }>();

    const schemaRows = schemas.results as {
      readonly name: string;
      readonly sql: string;
    }[];
    expect(schemaRows).toHaveLength(5);
    const byName = new Map(
      schemaRows.map(({ name, sql }) => [name, sql] as const)
    );
    expect(byName.get("pilot_provider_stage_budget")).toContain(
      "`runtime_stage` = 'pilot-gaia-118'"
    );
    expect(byName.get("pilot_provider_stage_budget")).toContain(
      "`budget_cap_micro_usd` = 10000000"
    );
    expect(byName.get("import_transcriptions")).toContain(
      "`state` = 'dispatching'"
    );
    expect(byName.get("import_transcriptions")).toContain(
      "`estimated_cost_micro_usd` IS NULL"
    );
    expect(byName.get("import_visual_evidence")).toContain(
      "`estimated_cost_micro_usd` IS NULL"
    );
    expect(byName.get("import_recipe_extractions")).toContain(
      "`estimated_cost_micro_usd` IS NULL"
    );
    const authorityRows = await testEnv.MealPlannerDatabase.prepare(
      "SELECT runtime_stage FROM pilot_provider_stage_budget"
    ).all<{ readonly runtime_stage: string }>();
    expect(authorityRows.results).toEqual([
      { runtime_stage: "pilot-gaia-118" },
    ]);
  });

  it("atomically fences concurrent reservations across different run IDs", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const first = reservation("run_a", "dispatch_a", 6_000_000);
    const second = reservation("run_b", "dispatch_b", 6_000_000);

    const outcomes = await Promise.allSettled([
      Effect.runPromise(repository.reserve(first)),
      Effect.runPromise(repository.reserve(second)),
    ]);
    expect(
      outcomes.filter(({ status }) => status === "fulfilled")
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1
    );
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "budget_exceeded" },
    });

    const stage = await Effect.runPromise(repository.readStage());
    expect(stage).toMatchObject({
      budgetCapMicroUsd: 10_000_000,
      reservedMicroUsd: 6_000_000,
      settledMicroUsd: 0,
      state: "open",
    });

    const winner = outcomes[0]?.status === "fulfilled" ? first : second;
    await Effect.runPromise(repository.reserve(winner));
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      reservedMicroUsd: 6_000_000,
    });
    await expect(
      Effect.runPromise(
        repository.reserve({ ...winner, maximumCostMicroUsd: 5_999_999 })
      )
    ).rejects.toMatchObject({ code: "dispatch_conflict" });
  });

  it("settles known cost idempotently and releases only pre-invocation reservations", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const known = reservation("run_known", "dispatch_known", 6_000_000);
    await Effect.runPromise(repository.reserve(known));
    await Effect.runPromise(repository.beginInvocation(known));
    await Effect.runPromise(
      repository.settleKnown({
        ...known,
        actualCostMicroUsd: 5_000_000,
      })
    );
    await Effect.runPromise(
      repository.settleKnown({
        ...known,
        actualCostMicroUsd: 5_000_000,
      })
    );
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      reservedMicroUsd: 0,
      settledMicroUsd: 5_000_000,
      state: "open",
    });

    const released = reservation("run_release", "dispatch_release", 5_000_000);
    await Effect.runPromise(repository.reserve(released));
    await Effect.runPromise(repository.releaseBeforeInvocation(released));
    await Effect.runPromise(repository.releaseBeforeInvocation(released));
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      reservedMicroUsd: 0,
      settledMicroUsd: 5_000_000,
    });
  });

  it("settles a dispatch once when concurrent callers report different known costs", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const command = reservation("run_settle", "dispatch_settle", 10);
    await Effect.runPromise(repository.reserve(command));
    await Effect.runPromise(repository.beginInvocation(command));

    const outcomes = await Promise.allSettled([
      Effect.runPromise(
        repository.settleKnown({ ...command, actualCostMicroUsd: 7 })
      ),
      Effect.runPromise(
        repository.settleKnown({ ...command, actualCostMicroUsd: 8 })
      ),
    ]);
    expect(
      outcomes.filter(({ status }) => status === "fulfilled")
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1
    );
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "dispatch_conflict" },
    });
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      reservedMicroUsd: 0,
      state: "open",
    });
  });

  it("poisons the one stage across run IDs without erasing possible spend", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const unknown = reservation("run_unknown", "dispatch_unknown", 4_000_000);
    await Effect.runPromise(repository.reserve(unknown));
    await Effect.runPromise(repository.beginInvocation(unknown));
    await Effect.runPromise(repository.settleUnknown(unknown));

    await expect(
      Effect.runPromise(
        repository.reserve(
          reservation("different_run", "different_dispatch", 1)
        )
      )
    ).rejects.toMatchObject({ code: "stage_poisoned" });
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: unknown.dispatchId,
      reservedMicroUsd: 4_000_000,
      settledMicroUsd: 0,
      state: "poisoned",
    });
  });

  it("serializes invocation across runs while keeping both reservations", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const first = reservation("run_first", "dispatch_first", 4_000_000);
    const second = reservation("run_second", "dispatch_second", 4_000_000);
    await Effect.runPromise(repository.reserve(first));
    await Effect.runPromise(repository.reserve(second));

    const outcomes = await Promise.allSettled([
      Effect.runPromise(repository.beginInvocation(first)),
      Effect.runPromise(repository.beginInvocation(second)),
    ]);
    expect(
      outcomes.filter(({ status }) => status === "fulfilled")
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1
    );
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      reservedMicroUsd: 8_000_000,
      state: "invoking",
    });
  });

  it("grants one provider invocation to concurrent same-dispatch runners", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const command = reservation("run_replay", "dispatch_replay", 10);
    const preparationsReleased = await Effect.runPromise(Deferred.make<null>());
    const losingCallerFinished = await Effect.runPromise(Deferred.make<null>());
    let preparationCalls = 0;
    let providerCalls = 0;
    const execute = () =>
      runPilotProviderDispatch({
        invoke: Effect.gen(function* delayedProviderCall() {
          providerCalls += 1;
          yield* Deferred.await(losingCallerFinished);
          return {
            cost: { _tag: "Known" as const, actualCostMicroUsd: 7 },
            value: "provider-result",
          };
        }),
        prepare: Effect.gen(function* synchronizeAfterReserve() {
          preparationCalls += 1;
          if (preparationCalls === 2) {
            yield* Deferred.succeed(preparationsReleased, null);
          }
          yield* Deferred.await(preparationsReleased);
        }),
        repository,
        reservation: command,
      }).pipe(
        Effect.tapError(() => Deferred.succeed(losingCallerFinished, null)),
        Effect.provideService(PilotProviderBudgetRuntime, runtime)
      );

    const outcomes = await Promise.allSettled([
      Effect.runPromise(execute()),
      Effect.runPromise(execute()),
    ]);

    expect(preparationCalls).toBe(2);
    expect(providerCalls).toBe(1);
    expect(
      outcomes.filter(({ status }) => status === "fulfilled")
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1
    );
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "outcome_unknown" },
    });
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      reservedMicroUsd: 0,
      settledMicroUsd: 7,
      state: "open",
    });
  });

  it("releases preparation failures before invocation without poisoning", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const command = reservation("run_prepare", "dispatch_prepare", 10);
    let providerCalls = 0;
    const effect = runPilotProviderDispatch({
      invoke: Effect.sync(() => {
        providerCalls += 1;
        return {
          cost: { _tag: "Known" as const, actualCostMicroUsd: 1 },
          value: "should-not-run",
        };
      }),
      prepare: Effect.fail({ _tag: "PreparationFailed" as const }),
      repository,
      reservation: command,
    }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime));

    await expect(Effect.runPromise(effect)).rejects.toMatchObject({
      _tag: "PreparationFailed",
    });
    expect(providerCalls).toBe(0);
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      reservedMicroUsd: 0,
      state: "open",
    });
  });

  it("poisons provider failures and explicit unknown costs without releasing reservations", async () => {
    const providerFailureRepository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const failed = reservation("run_failed", "dispatch_failed", 10);
    const providerFailure = runPilotProviderDispatch({
      invoke: Effect.fail({ _tag: "ProviderFailed" as const }),
      repository: providerFailureRepository,
      reservation: failed,
    }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime));

    await expect(Effect.runPromise(providerFailure)).rejects.toMatchObject({
      _tag: "ProviderFailed",
    });
    expect(
      await Effect.runPromise(providerFailureRepository.readStage())
    ).toMatchObject({
      poisonDispatchId: failed.dispatchId,
      reservedMicroUsd: 10,
      state: "poisoned",
    });

    await testEnv.MealPlannerDatabase.batch([
      testEnv.MealPlannerDatabase.prepare(
        "DELETE FROM pilot_provider_budget_dispatches"
      ),
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_stage_budget
            SET settled_micro_usd = 0, reserved_micro_usd = 0,
                state = 'open', invoking_dispatch_id = NULL,
                poison_dispatch_id = NULL
          WHERE runtime_stage = 'pilot-gaia-118'`
      ),
    ]);
    const unknownRepository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const unknown = reservation(
      "run_unknown_result",
      "dispatch_unknown_result",
      20
    );
    const result = await Effect.runPromise(
      runPilotProviderDispatch({
        invoke: Effect.succeed({
          cost: { _tag: "Unknown" as const },
          value: "unpriced",
        }),
        repository: unknownRepository,
        reservation: unknown,
      }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime))
    );

    expect(result).toEqual({
      _tag: "CompletedUnknownCost",
      value: "unpriced",
    });
    expect(
      await Effect.runPromise(unknownRepository.readStage())
    ).toMatchObject({
      poisonDispatchId: unknown.dispatchId,
      reservedMicroUsd: 20,
      state: "poisoned",
    });
  });

  it("admits a new attempt only after the previous attempt durably settles at exact zero cost", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const first = reservation(
      "run_known_zero_retry",
      "dispatch_known_zero_retry",
      10
    );
    const second = reservation(
      "run_known_zero_retry",
      "dispatch_known_zero_retry:attempt:2",
      10
    );
    let providerCalls = 0;

    await expect(
      Effect.runPromise(
        runPilotProviderDispatch({
          invoke: Effect.sync(() => {
            providerCalls += 1;
            return Effect.fail(
              pilotProviderKnownZeroCostFailure({
                code: "provider_unavailable",
              })
            );
          }).pipe(Effect.flatten),
          repository,
          reservation: first,
        }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime))
      )
    ).rejects.toEqual({ code: "provider_unavailable" });

    expect(providerCalls).toBe(1);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT actual_cost_micro_usd, state
           FROM pilot_provider_budget_dispatches
          WHERE dispatch_id = ?`
      )
        .bind(first.dispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_micro_usd: 0,
      state: "settled_known",
    });

    const completed = await Effect.runPromise(
      runPilotProviderDispatch({
        invoke: Effect.sync(() => {
          providerCalls += 1;
          return {
            cost: { _tag: "Known" as const, actualCostMicroUsd: 7 },
            value: "safe-transcript",
          };
        }),
        previousAttempt: first,
        repository,
        reservation: second,
      }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime))
    );

    expect(completed).toMatchObject({
      _tag: "Completed",
      actualCostMicroUsd: 7,
      value: "safe-transcript",
    });
    expect(providerCalls).toBe(2);

    await expect(
      Effect.runPromise(
        runPilotProviderDispatch({
          invoke: Effect.sync(() => {
            providerCalls += 1;
            return {
              cost: { _tag: "Known" as const, actualCostMicroUsd: 7 },
              value: "must-not-run",
            };
          }),
          previousAttempt: first,
          repository,
          reservation: second,
        }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime))
      )
    ).resolves.toMatchObject({
      _tag: "AlreadySettled",
      actualCostMicroUsd: 7,
    });
    expect(providerCalls).toBe(2);
  });

  it("poisons a known-zero marker combined with a defect", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const first = reservation(
      "run_ambiguous_known_zero",
      "dispatch_ambiguous_known_zero",
      10
    );

    await Effect.runPromiseExit(
      runPilotProviderDispatch({
        invoke: Effect.fail(
          pilotProviderKnownZeroCostFailure({
            code: "provider_unavailable",
          })
        ).pipe(
          Effect.ensuring(
            Effect.die(new Error("simulated post-dispatch defect"))
          )
        ),
        repository,
        reservation: first,
      }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime))
    );

    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: first.dispatchId,
      reservedMicroUsd: 10,
      settledMicroUsd: 0,
      state: "poisoned",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT actual_cost_micro_usd, state
           FROM pilot_provider_budget_dispatches
          WHERE dispatch_id = ?`
      )
        .bind(first.dispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_micro_usd: null,
      state: "settled_unknown",
    });
  });

  it("does not grant zero-cost authority to a structurally similar provider error", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const first = reservation(
      "run_forged_known_zero",
      "dispatch_forged_known_zero",
      10
    );
    const providerError = {
      _tag: "PilotProviderKnownZeroCostFailure" as const,
      error: { code: "provider_unavailable" as const },
    };

    await expect(
      Effect.runPromise(
        runPilotProviderDispatch<never, typeof providerError>({
          invoke: Effect.fail(providerError),
          repository,
          reservation: first,
        }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime))
      )
    ).rejects.toEqual(providerError);

    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: first.dispatchId,
      reservedMicroUsd: 10,
      state: "poisoned",
    });
  });

  it("converges concurrent ambiguous retry fences on one unknown settlement without reinvoking", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const previous = reservation(
      "run_ambiguous_retry",
      "dispatch_ambiguous_retry",
      10
    );
    const current = reservation(
      "run_ambiguous_retry",
      "dispatch_ambiguous_retry:attempt:2",
      10
    );
    await Effect.runPromise(repository.reserve(previous));
    await Effect.runPromise(repository.beginInvocation(previous));
    let providerCalls = 0;
    const execute = () =>
      runPilotProviderDispatch({
        invoke: Effect.sync(() => {
          providerCalls += 1;
          return {
            cost: { _tag: "Known" as const, actualCostMicroUsd: 1 },
            value: "must-not-run",
          };
        }),
        previousAttempt: previous,
        repository,
        reservation: current,
      }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime));

    const results = await Promise.allSettled([
      Effect.runPromise(execute()),
      Effect.runPromise(execute()),
    ]);

    expect(results).toHaveLength(2);
    expect(results.every(({ status }) => status === "rejected")).toBe(true);
    expect(
      results.every(
        (result) =>
          result.status === "rejected" &&
          (result.reason as { readonly code?: string }).code ===
            "outcome_unknown"
      )
    ).toBe(true);
    expect(providerCalls).toBe(0);
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: previous.dispatchId,
      reservedMicroUsd: 10,
      settledMicroUsd: 0,
      state: "poisoned",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "SELECT COUNT(*) AS count FROM pilot_provider_budget_dispatches"
      ).first()
    ).resolves.toEqual({ count: 1 });
  });

  it("poisons a typed timeout and rejects its retry before a second invocation", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const first = reservation(
      "run_timeout_retry",
      "dispatch_timeout_retry",
      10
    );
    const second = reservation(
      "run_timeout_retry",
      "dispatch_timeout_retry:attempt:2",
      10
    );
    let providerCalls = 0;

    await expect(
      Effect.runPromise(
        runPilotProviderDispatch({
          invoke: Effect.sync(() => {
            providerCalls += 1;
            return Effect.fail({ code: "provider_timeout" as const });
          }).pipe(Effect.flatten),
          repository,
          reservation: first,
        }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime))
      )
    ).rejects.toEqual({ code: "provider_timeout" });

    await expect(
      Effect.runPromise(
        runPilotProviderDispatch({
          invoke: Effect.sync(() => {
            providerCalls += 1;
            return {
              cost: { _tag: "Known" as const, actualCostMicroUsd: 1 },
              value: "must-not-run",
            };
          }),
          previousAttempt: first,
          repository,
          reservation: second,
        }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime))
      )
    ).rejects.toMatchObject({ code: "outcome_unknown" });

    expect(providerCalls).toBe(1);
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: first.dispatchId,
      reservedMicroUsd: 10,
      state: "poisoned",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "SELECT COUNT(*) AS count FROM pilot_provider_budget_dispatches"
      ).first()
    ).resolves.toEqual({ count: 1 });
  });

  it("settles defects and interruption unknown before any retry can invoke", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const defect = reservation("run_defect_retry", "dispatch_defect_retry", 10);
    let providerCalls = 0;

    await Effect.runPromiseExit(
      runPilotProviderDispatch({
        invoke: Effect.sync(() => {
          providerCalls += 1;
          throw new Error("simulated provider crash");
        }),
        repository,
        reservation: defect,
      }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime))
    );
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: defect.dispatchId,
      state: "poisoned",
    });

    await testEnv.MealPlannerDatabase.batch([
      testEnv.MealPlannerDatabase.prepare(
        "DELETE FROM pilot_provider_budget_dispatches"
      ),
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_stage_budget
            SET settled_micro_usd = 0, reserved_micro_usd = 0,
                state = 'open', invoking_dispatch_id = NULL,
                poison_dispatch_id = NULL
          WHERE runtime_stage = 'pilot-gaia-118'`
      ),
    ]);

    const interrupted = reservation(
      "run_interrupted_retry",
      "dispatch_interrupted_retry",
      10
    );
    const invocationStarted = await Effect.runPromise(Deferred.make<null>());
    const fiber = Effect.runFork(
      runPilotProviderDispatch({
        invoke: Effect.gen(function* interruptedProvider() {
          providerCalls += 1;
          yield* Deferred.succeed(invocationStarted, null);
          return yield* Effect.never;
        }),
        repository,
        reservation: interrupted,
      }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime))
    );
    await Effect.runPromise(Deferred.await(invocationStarted));
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(providerCalls).toBe(2);
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: interrupted.dispatchId,
      reservedMicroUsd: 10,
      state: "poisoned",
    });
  });

  it.each(["prod", "production", "pilot-gaia-117", "", "dev", "default"])(
    "rejects runtime stage %j before a detached preflight can invoke",
    async (stage) => {
      const repository = makeD1PilotProviderBudgetRepository(
        testEnv.MealPlannerDatabase,
        "pilot-gaia-118"
      );
      let providerCalls = 0;
      const effect = runPilotProviderDispatch({
        invoke: Effect.sync(() => {
          providerCalls += 1;
          return {
            cost: { _tag: "Known" as const, actualCostMicroUsd: 1 },
            value: "should-not-run",
          };
        }),
        repository,
        reservation: reservation("run_bypass", "dispatch_bypass", 1),
      }).pipe(
        Effect.provideService(
          PilotProviderBudgetRuntime,
          makePilotProviderBudgetRuntime(stage)
        )
      );

      await expect(Effect.runPromise(effect)).rejects.toMatchObject({
        code: "stage_not_allowed",
      });
      expect(providerCalls).toBe(0);
    }
  );

  it("poisons after a known settlement failure and rejects replay without reinvoking", async () => {
    const repository = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const command = reservation(
      "run_settlement_failure",
      "dispatch_settlement_failure",
      10
    );
    await testEnv.MealPlannerDatabase.prepare(
      `CREATE TRIGGER fail_known_settlement
       BEFORE UPDATE ON pilot_provider_budget_dispatches
       WHEN NEW.state = 'settled_known'
       BEGIN
         SELECT RAISE(ABORT, 'forced known settlement failure');
       END`
    ).run();
    let providerCalls = 0;
    const execute = () =>
      runPilotProviderDispatch({
        invoke: Effect.sync(() => {
          providerCalls += 1;
          return {
            cost: { _tag: "Known" as const, actualCostMicroUsd: 7 },
            value: "provider-result",
          };
        }),
        repository,
        reservation: command,
      }).pipe(Effect.provideService(PilotProviderBudgetRuntime, runtime));

    await expect(Effect.runPromise(execute())).rejects.toMatchObject({
      code: "persistence_unavailable",
    });
    expect(providerCalls).toBe(1);
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: command.dispatchId,
      reservedMicroUsd: 10,
      state: "poisoned",
    });

    await testEnv.MealPlannerDatabase.prepare(
      "DROP TRIGGER fail_known_settlement"
    ).run();
    await expect(Effect.runPromise(execute())).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    expect(providerCalls).toBe(1);
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: command.dispatchId,
      reservedMicroUsd: 10,
      state: "poisoned",
    });
  });
});
