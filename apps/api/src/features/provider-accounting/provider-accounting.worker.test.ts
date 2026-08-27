import { applyD1Migrations, env } from "cloudflare:test";
import { count, eq } from "drizzle-orm";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ImportId } from "../imports/import.contracts.js";
import {
  providerAccountingBudgets,
  providerAccountingConservativeSettlements,
  providerAccountingDispatches,
  providerAccountingRecipeReplayValues,
  providerAccountingReconciliations,
} from "./provider-accounting.database-schema.js";
import { makeProviderAccountingDatabase } from "./provider-accounting.database.js";
import {
  ProviderAccountingDispatchId,
  ProviderAccountingProviderStageId,
  ProviderAccountingRunId,
  ProviderAccountingTimestamp,
  providerKnownZeroCostFailure,
  runAccountedProviderDispatch,
} from "./provider-accounting.js";
import type {
  ProviderAccountingRepository,
  ProviderAccountingReservation,
} from "./provider-accounting.js";
import { makeD1ProviderAccountingRepository as makeProviderAccountingRepository } from "./provider-accounting.repository.d1.js";
import { makeD1ProviderAccountingService } from "./provider-accounting.service.js";

const testEnv = env as unknown as {
  readonly ProviderAccountingDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const makeD1ProviderAccountingRepository = (database: AnyD1Database) =>
  makeProviderAccountingRepository(makeProviderAccountingDatabase(database));
const database = makeProviderAccountingDatabase(
  testEnv.ProviderAccountingDatabase
);

const decodeRunId = Schema.decodeUnknownSync(ProviderAccountingRunId);
const decodeProviderStageId = Schema.decodeUnknownSync(
  ProviderAccountingProviderStageId
);
const decodeDispatchId = Schema.decodeUnknownSync(ProviderAccountingDispatchId);
const decodeTimestamp = Schema.decodeUnknownSync(ProviderAccountingTimestamp);
const replayLifetimeMilliseconds = 7 * 24 * 60 * 60 * 1000;
const nowIso = new Date().toISOString();
const now = decodeTimestamp(nowIso);
const replayExpiresAt = new Date(
  Date.parse(nowIso) + replayLifetimeMilliseconds
).toISOString();
const evidenceFingerprint = "e".repeat(64);
const conservativeReplay = (importId: string, value = "decoded-recipe") => ({
  evidenceFingerprint,
  generation: 1,
  importId,
  valueJson: JSON.stringify(value),
  valueSha256: "a".repeat(64),
});

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

const reservationAt = (
  runId: string,
  dispatchId: string,
  maximumCostMicroUsd: number,
  timestamp: string
) => ({
  ...reservation(runId, dispatchId, maximumCostMicroUsd),
  timestamp: decodeTimestamp(timestamp),
});

const claimInvocation = async (
  repository: ProviderAccountingRepository,
  input: ProviderAccountingReservation
) => {
  const claim = await Effect.runPromise(repository.beginInvocation(input));
  if (claim._tag !== "Claimed") {
    throw new Error("expected provider invocation claim");
  }
  return claim.dispatch.invocationGeneration;
};

const readPersistedDispatchState = async (dispatchId: string) => {
  const [row] = await database
    .select({
      actualCostMicroUsd: providerAccountingDispatches.actualCostMicroUsd,
      state: providerAccountingDispatches.state,
    })
    .from(providerAccountingDispatches)
    .where(eq(providerAccountingDispatches.dispatchId, dispatchId))
    .limit(1);
  return row;
};

const readDispatchCount = async () => {
  const [row] = await database
    .select({ count: count() })
    .from(providerAccountingDispatches);
  return row;
};

const resetDispatchesAndBudget = () =>
  database.batch([
    database.delete(providerAccountingDispatches),
    database
      .update(providerAccountingBudgets)
      .set({
        invokingDispatchId: null,
        poisonDispatchId: null,
        reservedMicroUsd: 0,
        settledMicroUsd: 0,
        state: "open",
      })
      .where(eq(providerAccountingBudgets.accountingScope, "recipe-import")),
  ]);

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.ProviderAccountingDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

beforeEach(async () => {
  await testEnv.ProviderAccountingDatabase.prepare(
    "DROP TRIGGER IF EXISTS provider_accounting_recipe_replay_values_guarded_delete"
  ).run();
  await testEnv.ProviderAccountingDatabase.prepare(
    "DROP TRIGGER IF EXISTS provider_accounting_conservative_settlements_immutable_delete"
  ).run();
  await testEnv.ProviderAccountingDatabase.prepare(
    "DROP TRIGGER IF EXISTS provider_accounting_reconciliations_immutable_delete"
  ).run();
  await database.batch([
    database.delete(providerAccountingRecipeReplayValues),
    database.delete(providerAccountingConservativeSettlements),
    database.delete(providerAccountingReconciliations),
    database.delete(providerAccountingDispatches),
    database
      .update(providerAccountingBudgets)
      .set({
        invokingDispatchId: null,
        poisonDispatchId: null,
        reservedMicroUsd: 0,
        settledMicroUsd: 0,
        state: "open",
        updatedAt: "2026-07-29T18:00:00.000Z",
      })
      .where(eq(providerAccountingBudgets.accountingScope, "recipe-import")),
  ]);
  await testEnv.ProviderAccountingDatabase.prepare(
    `CREATE TRIGGER provider_accounting_conservative_settlements_immutable_delete
     BEFORE DELETE ON provider_accounting_conservative_settlements
     BEGIN
       SELECT RAISE(
         ABORT,
         'provider conservative settlement audit is immutable'
       );
     END`
  ).run();
  await testEnv.ProviderAccountingDatabase.prepare(
    `CREATE TRIGGER provider_accounting_reconciliations_immutable_delete
     BEFORE DELETE ON provider_accounting_reconciliations
     BEGIN
       SELECT RAISE(ABORT, 'provider accounting reconciliation is immutable');
     END`
  ).run();
});

describe("provider accounting", () => {
  it("observes settlement outcomes only after durable settlement", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const outcomes: string[] = [];

    const result = await Effect.runPromise(
      runAccountedProviderDispatch({
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
      })
    );

    expect(result).toMatchObject({
      _tag: "Completed",
      actualCostMicroUsd: 7,
    });
    expect(outcomes).toEqual(["known"]);
  });

  it("charges one schema-valid recipe response conservatively without claiming known actual spend", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const command = {
      ...reservation(
        "recipe-import:import-conservative",
        `recipe:import-conservative:1:${evidenceFingerprint}`,
        100_000
      ),
      providerStageId: decodeProviderStageId("recipe-extraction"),
    };
    const outcomes: string[] = [];
    let providerCalls = 0;
    const execute = () =>
      runAccountedProviderDispatch({
        conservativeReplay: {
          decode: (replay) =>
            Effect.try({
              catch: () => "decode_failed" as const,
              try: () => JSON.parse(replay.valueJson) as string,
            }),
          encode: (value) =>
            Effect.succeed(conservativeReplay("import-conservative", value)),
        },
        invoke: Effect.sync(() => {
          providerCalls += 1;
          return {
            cost: {
              _tag: "Conservative" as const,
              conservativeChargeMicroUsd: 100_000,
            },
            value: "decoded-recipe",
          };
        }),
        onSettlement: (outcome) =>
          Effect.sync(() => {
            outcomes.push(outcome);
          }),
        repository,
        reservation: command,
      });

    await expect(Effect.runPromise(execute())).resolves.toMatchObject({
      _tag: "CompletedConservativeCost",
      conservativeChargeMicroUsd: 100_000,
      value: "decoded-recipe",
    });
    await expect(Effect.runPromise(execute())).resolves.toMatchObject({
      _tag: "AlreadyConservativelySettled",
      conservativeChargeMicroUsd: 100_000,
      value: "decoded-recipe",
    });

    expect(providerCalls).toBe(1);
    expect(outcomes).toEqual(["conservative"]);
    await expect(
      repository.readStage().pipe(Effect.runPromise)
    ).resolves.toEqual({
      budgetCapMicroUsd: 10_000_000,
      reservedMicroUsd: 0,
      settledMicroUsd: 100_000,
      state: "open",
    });
    await expect(
      database
        .select({
          actualCostMicroUsd: providerAccountingDispatches.actualCostMicroUsd,
          state: providerAccountingDispatches.state,
        })
        .from(providerAccountingDispatches)
        .where(eq(providerAccountingDispatches.dispatchId, command.dispatchId))
        .limit(1)
    ).resolves.toEqual([
      { actualCostMicroUsd: null, state: "settled_unknown" },
    ]);
    await expect(
      database
        .select({
          actualCostWasUnknown:
            providerAccountingConservativeSettlements.actualCostWasUnknown,
          authority: providerAccountingConservativeSettlements.authority,
          conservativeChargeMicroUsd:
            providerAccountingConservativeSettlements.conservativeChargeMicroUsd,
        })
        .from(providerAccountingConservativeSettlements)
        .where(
          eq(
            providerAccountingConservativeSettlements.dispatchId,
            command.dispatchId
          )
        )
        .limit(1)
    ).resolves.toEqual([
      {
        actualCostWasUnknown: 1,
        authority: "schema_valid_provider_response",
        conservativeChargeMicroUsd: 100_000,
      },
    ]);
    await expect(
      database
        .select({
          evidenceFingerprint:
            providerAccountingRecipeReplayValues.evidenceFingerprint,
          expiresAt: providerAccountingRecipeReplayValues.expiresAt,
          generation: providerAccountingRecipeReplayValues.generation,
          importId: providerAccountingRecipeReplayValues.importId,
          valueJson: providerAccountingRecipeReplayValues.valueJson,
          valueSha256: providerAccountingRecipeReplayValues.valueSha256,
        })
        .from(providerAccountingRecipeReplayValues)
        .where(
          eq(
            providerAccountingRecipeReplayValues.dispatchId,
            command.dispatchId
          )
        )
        .limit(1)
    ).resolves.toEqual([
      {
        evidenceFingerprint,
        expiresAt: replayExpiresAt,
        generation: 1,
        importId: "import-conservative",
        valueJson: JSON.stringify("decoded-recipe"),
        valueSha256: "a".repeat(64),
      },
    ]);
    await expect(
      database
        .update(providerAccountingRecipeReplayValues)
        .set({ valueJson: JSON.stringify("decoded-recipe") })
        .where(
          eq(
            providerAccountingRecipeReplayValues.dispatchId,
            command.dispatchId
          )
        )
    ).rejects.toThrow();
    await expect(
      database
        .delete(providerAccountingRecipeReplayValues)
        .where(
          eq(
            providerAccountingRecipeReplayValues.dispatchId,
            command.dispatchId
          )
        )
    ).resolves.toBeDefined();
    await expect(
      database
        .update(providerAccountingConservativeSettlements)
        .set({ authority: "schema_valid_provider_response" })
        .where(
          eq(
            providerAccountingConservativeSettlements.dispatchId,
            command.dispatchId
          )
        )
    ).rejects.toThrow();
    await expect(
      database
        .delete(providerAccountingConservativeSettlements)
        .where(
          eq(
            providerAccountingConservativeSettlements.dispatchId,
            command.dispatchId
          )
        )
    ).rejects.toThrow();
  });

  it("converges concurrent conservative settlements on one immutable charge", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const command = {
      ...reservation(
        "recipe-import:import-concurrent-conservative",
        `recipe:import-concurrent-conservative:1:${evidenceFingerprint}`,
        100_000
      ),
      providerStageId: decodeProviderStageId("recipe-extraction"),
    };
    await Effect.runPromise(repository.reserve(command));
    const invocationGeneration = await claimInvocation(repository, command);

    const input = {
      ...command,
      conservativeChargeMicroUsd: 100_000,
      invocationGeneration,
      replay: conservativeReplay("import-concurrent-conservative"),
    };
    const results = await Promise.allSettled([
      Effect.runPromise(repository.settleConservative(input)),
      Effect.runPromise(repository.settleConservative(input)),
    ]);

    expect(results.every(({ status }) => status === "fulfilled")).toBe(true);
    expect(await Effect.runPromise(repository.readStage())).toEqual({
      budgetCapMicroUsd: 10_000_000,
      reservedMicroUsd: 0,
      settledMicroUsd: 100_000,
      state: "open",
    });
    await expect(
      database
        .select({ count: count() })
        .from(providerAccountingConservativeSettlements)
        .where(
          eq(
            providerAccountingConservativeSettlements.dispatchId,
            command.dispatchId
          )
        )
    ).resolves.toEqual([{ count: 1 }]);
  });

  it("rejects multibyte conservative replay JSON over the UTF-8 byte cap", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const importId = "import-multibyte-replay";
    const command = {
      ...reservation(
        `recipe-import:${importId}`,
        `recipe:${importId}:1:${evidenceFingerprint}`,
        100_000
      ),
      providerStageId: decodeProviderStageId("recipe-extraction"),
    };
    const valueJson = JSON.stringify({ value: "é".repeat(140_000) });
    expect(valueJson.length).toBeLessThan(262_144);
    expect(new TextEncoder().encode(valueJson).byteLength).toBeGreaterThan(
      262_144
    );
    await Effect.runPromise(repository.reserve(command));
    const invocationGeneration = await claimInvocation(repository, command);

    await expect(
      Effect.runPromise(
        repository.settleConservative({
          ...command,
          conservativeChargeMicroUsd: 100_000,
          invocationGeneration,
          replay: {
            ...conservativeReplay(importId),
            valueJson,
          },
        })
      )
    ).rejects.toMatchObject({ code: "cost_exceeds_reservation" });

    await Effect.runPromise(
      repository.settleUnknown({ ...command, invocationGeneration })
    );
    await database.insert(providerAccountingConservativeSettlements).values({
      accountingScope: "recipe-import",
      actualCostWasUnknown: 1,
      authority: "schema_valid_provider_response",
      conservativeChargeMicroUsd: 100_000,
      createdAt: "2026-07-29T18:00:00.000Z",
      dispatchId: command.dispatchId,
    });
    await expect(
      database.insert(providerAccountingRecipeReplayValues).values({
        accountingScope: "recipe-import",
        createdAt: "2026-07-29T18:00:00.000Z",
        dispatchId: command.dispatchId,
        evidenceFingerprint,
        expiresAt: "2026-08-05T18:00:00.000Z",
        generation: 1,
        importId,
        valueJson,
        valueSha256: "a".repeat(64),
      })
    ).rejects.toThrow();
    await expect(
      database
        .select({ count: count() })
        .from(providerAccountingRecipeReplayValues)
        .where(
          eq(
            providerAccountingRecipeReplayValues.dispatchId,
            command.dispatchId
          )
        )
    ).resolves.toEqual([{ count: 0 }]);
  });

  it("fails closed without redispatch when a conservative replay value is absent", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const command = {
      ...reservation(
        "recipe-import:import-missing-replay",
        `recipe:import-missing-replay:1:${evidenceFingerprint}`,
        100_000
      ),
      providerStageId: decodeProviderStageId("recipe-extraction"),
    };
    let providerCalls = 0;
    const execute = () =>
      runAccountedProviderDispatch({
        conservativeReplay: {
          decode: (replay) =>
            Effect.try({
              catch: () => "decode_failed" as const,
              try: () => JSON.parse(replay.valueJson) as string,
            }),
          encode: (value) =>
            Effect.succeed(conservativeReplay("import-missing-replay", value)),
        },
        invoke: Effect.sync(() => {
          providerCalls += 1;
          return {
            cost: {
              _tag: "Conservative" as const,
              conservativeChargeMicroUsd: 100_000,
            },
            value: "decoded-recipe",
          };
        }),
        repository,
        reservation: command,
      });

    await expect(Effect.runPromise(execute())).resolves.toMatchObject({
      _tag: "CompletedConservativeCost",
    });
    await database
      .delete(providerAccountingRecipeReplayValues)
      .where(
        eq(providerAccountingRecipeReplayValues.dispatchId, command.dispatchId)
      );

    await expect(Effect.runPromise(execute())).rejects.toMatchObject({
      code: "persistence_corrupt",
    });
    expect(providerCalls).toBe(1);
  });

  it("fails closed on an expired replay and sweeps it during ordinary budget activity", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const command = {
      ...reservation(
        "recipe-import:import-expired-replay",
        `recipe:import-expired-replay:1:${evidenceFingerprint}`,
        100_000
      ),
      providerStageId: decodeProviderStageId("recipe-extraction"),
    };
    let providerCalls = 0;
    const execute = () =>
      runAccountedProviderDispatch({
        conservativeReplay: {
          decode: (replay) =>
            Effect.try({
              catch: () => "decode_failed" as const,
              try: () => JSON.parse(replay.valueJson) as string,
            }),
          encode: (value) =>
            Effect.succeed(conservativeReplay("import-expired-replay", value)),
        },
        invoke: Effect.sync(() => {
          providerCalls += 1;
          return {
            cost: {
              _tag: "Conservative" as const,
              conservativeChargeMicroUsd: 100_000,
            },
            value: "decoded-recipe",
          };
        }),
        repository,
        reservation: command,
      });

    await expect(Effect.runPromise(execute())).resolves.toMatchObject({
      _tag: "CompletedConservativeCost",
    });
    await testEnv.ProviderAccountingDatabase.prepare(
      "DROP TRIGGER provider_accounting_recipe_replay_values_immutable_update"
    ).run();
    try {
      await database
        .update(providerAccountingRecipeReplayValues)
        .set({
          createdAt: "2026-07-20T18:00:00.000Z",
          expiresAt: "2026-07-27T18:00:00.000Z",
        })
        .where(
          eq(
            providerAccountingRecipeReplayValues.dispatchId,
            command.dispatchId
          )
        );
    } finally {
      await testEnv.ProviderAccountingDatabase.prepare(
        `CREATE TRIGGER provider_accounting_recipe_replay_values_immutable_update
         BEFORE UPDATE ON provider_accounting_recipe_replay_values
         BEGIN
           SELECT RAISE(
             ABORT,
             'provider recipe replay value is immutable'
           );
         END`
      ).run();
    }

    await expect(Effect.runPromise(execute())).rejects.toMatchObject({
      code: "persistence_corrupt",
    });
    expect(providerCalls).toBe(1);

    await Effect.runPromise(
      repository.reserve(
        reservation("run_expiry_sweep", "dispatch_expiry_sweep", 1)
      )
    );
    await expect(
      database
        .select({ dispatchId: providerAccountingRecipeReplayValues.dispatchId })
        .from(providerAccountingRecipeReplayValues)
        .where(
          eq(
            providerAccountingRecipeReplayValues.dispatchId,
            command.dispatchId
          )
        )
        .limit(1)
    ).resolves.toEqual([]);
  });

  it("physically replaces pilot storage without acquiring household authority", async () => {
    const schemas = await testEnv.ProviderAccountingDatabase.prepare(
      `SELECT name, sql FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name`
    ).all<{ name: string; sql: string }>();

    const schemaRows = schemas.results as {
      readonly name: string;
      readonly sql: string;
    }[];
    expect(schemaRows.map(({ name }) => name)).toEqual([
      "_cf_METADATA",
      "d1_migrations",
      "provider_accounting_budgets",
      "provider_accounting_conservative_settlements",
      "provider_accounting_dispatches",
      "provider_accounting_recipe_replay_values",
      "provider_accounting_reconciliations",
      "sqlite_sequence",
    ]);
    const runtimeBookkeepingTables = new Set([
      "_cf_METADATA",
      "d1_migrations",
      "sqlite_sequence",
    ]);
    expect(
      schemaRows
        .map(({ name }) => name)
        .filter((name) => !runtimeBookkeepingTables.has(name))
    ).toEqual([
      "provider_accounting_budgets",
      "provider_accounting_conservative_settlements",
      "provider_accounting_dispatches",
      "provider_accounting_recipe_replay_values",
      "provider_accounting_reconciliations",
    ]);
    const byName = new Map(
      schemaRows.map(({ name, sql }) => [name, sql] as const)
    );
    expect(byName.get("provider_accounting_budgets")).toContain(
      `"accounting_scope" = 'recipe-import'`
    );
    expect(byName.get("provider_accounting_budgets")).toContain(
      `"budget_cap_micro_usd" = 10000000`
    );
    const authorityRows = await database
      .select({ accountingScope: providerAccountingBudgets.accountingScope })
      .from(providerAccountingBudgets);
    expect(authorityRows).toEqual([{ accountingScope: "recipe-import" }]);

    const triggers = await testEnv.ProviderAccountingDatabase.prepare(
      `SELECT name, sql FROM sqlite_master
        WHERE type = 'trigger' AND name LIKE 'provider_accounting_%'
        ORDER BY name`
    ).all<{ name: string; sql: string }>();
    const triggerRows = triggers.results as {
      readonly name: string;
      readonly sql: string;
    }[];
    expect(triggerRows.map(({ name }) => name)).toEqual([
      "provider_accounting_conservative_settlements_immutable_delete",
      "provider_accounting_conservative_settlements_immutable_update",
      "provider_accounting_dispatches_begin_invocation",
      "provider_accounting_dispatches_release",
      "provider_accounting_dispatches_reserve",
      "provider_accounting_dispatches_settle_known",
      "provider_accounting_dispatches_settle_unknown",
      "provider_accounting_dispatches_transition_guard",
      "provider_accounting_recipe_replay_values_dispatch_insert_cleanup",
      "provider_accounting_recipe_replay_values_dispatch_update_cleanup",
      "provider_accounting_recipe_replay_values_expired_cleanup",
      "provider_accounting_recipe_replay_values_immutable_update",
      "provider_accounting_reconciliations_immutable_delete",
      "provider_accounting_reconciliations_immutable_update",
    ]);
    const triggerSql = triggerRows
      .map(({ sql }) => sql)
      .join("\n")
      .toLowerCase();
    expect(triggerSql).not.toContain("pilot_provider_");
    expect(triggerSql).not.toContain("household_");
    expect(triggerSql).not.toContain("import_terminal");
    expect(triggerSql).not.toContain("import_recipe_extractions");
  });

  it("atomically fences concurrent reservations across different run IDs", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
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
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const known = reservation("run_known", "dispatch_known", 6_000_000);
    await Effect.runPromise(repository.reserve(known));
    const invocationGeneration = await claimInvocation(repository, known);
    await Effect.runPromise(
      repository.settleKnown({
        ...known,
        actualCostMicroUsd: 5_000_000,
        invocationGeneration,
      })
    );
    await Effect.runPromise(
      repository.settleKnown({
        ...known,
        actualCostMicroUsd: 5_000_000,
        invocationGeneration,
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
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const command = reservation("run_settle", "dispatch_settle", 10);
    await Effect.runPromise(repository.reserve(command));
    const invocationGeneration = await claimInvocation(repository, command);

    const outcomes = await Promise.allSettled([
      Effect.runPromise(
        repository.settleKnown({
          ...command,
          actualCostMicroUsd: 7,
          invocationGeneration,
        })
      ),
      Effect.runPromise(
        repository.settleKnown({
          ...command,
          actualCostMicroUsd: 8,
          invocationGeneration,
        })
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
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const unknown = reservation("run_unknown", "dispatch_unknown", 4_000_000);
    await Effect.runPromise(repository.reserve(unknown));
    const invocationGeneration = await claimInvocation(repository, unknown);
    await Effect.runPromise(
      repository.settleUnknown({ ...unknown, invocationGeneration })
    );

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
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
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

  it("poisons a stale durable invocation claim after restart without reinvoking", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const claimed = reservationAt(
      "run_stale_claim",
      "dispatch_stale_claim",
      10,
      "2026-08-23T12:00:00.000Z"
    );
    await Effect.runPromise(repository.reserve(claimed));
    await Effect.runPromise(repository.beginInvocation(claimed));

    const restartedRepository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    let providerCalls = 0;
    await expect(
      Effect.runPromise(
        runAccountedProviderDispatch({
          invoke: Effect.sync(() => {
            providerCalls += 1;
            return {
              cost: { _tag: "Known" as const, actualCostMicroUsd: 1 },
              value: "must-not-run",
            };
          }),
          repository: restartedRepository,
          reservation: reservationAt(
            "run_stale_claim",
            "dispatch_stale_claim",
            10,
            "2026-08-23T12:06:00.000Z"
          ),
        })
      )
    ).rejects.toMatchObject({ code: "outcome_unknown" });

    expect(providerCalls).toBe(0);
    await expect(
      restartedRepository.readStage().pipe(Effect.runPromise)
    ).resolves.toMatchObject({
      poisonDispatchId: claimed.dispatchId,
      reservedMicroUsd: 10,
      state: "poisoned",
    });
    await expect(
      restartedRepository.readDispatch(claimed).pipe(Effect.runPromise)
    ).resolves.toMatchObject({ state: "settled_unknown" });
  });

  it("keeps an active generation-fenced invocation claim live", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const claimed = reservationAt(
      "run_active_claim",
      "dispatch_active_claim",
      10,
      "2026-08-23T12:00:00.000Z"
    );
    await Effect.runPromise(repository.reserve(claimed));
    const claim = await Effect.runPromise(repository.beginInvocation(claimed));
    expect(claim).toMatchObject({
      _tag: "Claimed",
      dispatch: { invocationGeneration: 1, state: "invoking" },
    });

    let providerCalls = 0;
    await expect(
      Effect.runPromise(
        runAccountedProviderDispatch({
          invoke: Effect.sync(() => {
            providerCalls += 1;
            return {
              cost: { _tag: "Known" as const, actualCostMicroUsd: 1 },
              value: "must-not-run",
            };
          }),
          repository,
          reservation: reservationAt(
            "run_active_claim",
            "dispatch_active_claim",
            10,
            "2026-08-23T12:01:00.000Z"
          ),
        })
      )
    ).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(providerCalls).toBe(0);
    await expect(
      repository.readStage().pipe(Effect.runPromise)
    ).resolves.toMatchObject({
      invokingDispatchId: claimed.dispatchId,
      reservedMicroUsd: 10,
      state: "invoking",
    });
  });

  it("reconciles one poisoned reservation while preserving another", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const importId = Schema.decodeUnknownSync(ImportId)(
      "00000000-0000-4000-8000-000000000190"
    );
    const poisoned = reservation(
      `recipe-import:${importId}`,
      "dispatch_poisoned_with_residual",
      4_000_000
    );
    const residual = reservation(
      `recipe-import:${importId}`,
      "dispatch_residual_reservation",
      4_000_000
    );
    const speechPoisoned = {
      ...poisoned,
      providerStageId: decodeProviderStageId("speech-transcription"),
    };
    const speechResidual = {
      ...residual,
      providerStageId: decodeProviderStageId("speech-transcription"),
    };
    await Effect.runPromise(repository.reserve(speechPoisoned));
    await Effect.runPromise(repository.reserve(speechResidual));
    const poisonedGeneration = await claimInvocation(
      repository,
      speechPoisoned
    );
    await Effect.runPromise(
      repository.settleUnknown({
        ...speechPoisoned,
        invocationGeneration: poisonedGeneration,
      })
    );

    const accounting = makeD1ProviderAccountingService({
      database: makeProviderAccountingDatabase(
        testEnv.ProviderAccountingDatabase
      ),
      now: () => now,
    });
    await expect(
      accounting
        .reconcile({
          dispatchId: speechPoisoned.dispatchId,
          importId,
          operation: "settle_speech_unknown",
        })
        .pipe(Effect.runPromise)
    ).resolves.toMatchObject({
      conservativeChargeMicroUsd: 4_000_000,
      dispatchId: speechPoisoned.dispatchId,
    });
    await expect(
      repository.readStage().pipe(Effect.runPromise)
    ).resolves.toMatchObject({
      reservedMicroUsd: 4_000_000,
      settledMicroUsd: 4_000_000,
      state: "open",
    });

    const residualGeneration = await claimInvocation(
      repository,
      speechResidual
    );
    await Effect.runPromise(
      repository.settleKnown({
        ...speechResidual,
        actualCostMicroUsd: 3_000_000,
        invocationGeneration: residualGeneration,
      })
    );
    await expect(
      repository.readStage().pipe(Effect.runPromise)
    ).resolves.toMatchObject({
      reservedMicroUsd: 0,
      settledMicroUsd: 7_000_000,
      state: "open",
    });
  });

  it("replays an immutable reconciliation while an unrelated dispatch is invoking", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const importId = Schema.decodeUnknownSync(ImportId)(
      "00000000-0000-4000-8000-000000000291"
    );
    const target = {
      ...reservation(
        `recipe-import:${importId}`,
        "dispatch_reconciliation_response_lost",
        4_000_000
      ),
      providerStageId: decodeProviderStageId("speech-transcription"),
    };
    const unrelated = {
      ...reservation(
        "recipe-import:unrelated-active",
        "dispatch_unrelated_active",
        4_000_000
      ),
      providerStageId: decodeProviderStageId("speech-transcription"),
    };
    await Effect.runPromise(repository.reserve(target));
    const targetGeneration = await claimInvocation(repository, target);
    await Effect.runPromise(
      repository.settleUnknown({
        ...target,
        invocationGeneration: targetGeneration,
      })
    );
    const accounting = makeD1ProviderAccountingService({
      database: makeProviderAccountingDatabase(
        testEnv.ProviderAccountingDatabase
      ),
      now: () => now,
    });
    const request = {
      dispatchId: target.dispatchId,
      importId,
      operation: "settle_speech_unknown" as const,
    };
    const first = await Effect.runPromise(accounting.reconcile(request));

    await Effect.runPromise(repository.reserve(unrelated));
    await claimInvocation(repository, unrelated);

    await expect(
      Effect.runPromise(accounting.reconcile(request))
    ).resolves.toEqual(first);
    await expect(
      database
        .select({ count: count() })
        .from(providerAccountingReconciliations)
        .where(
          eq(providerAccountingReconciliations.dispatchId, target.dispatchId)
        )
    ).resolves.toEqual([{ count: 1 }]);
    await expect(
      repository.readStage().pipe(Effect.runPromise)
    ).resolves.toMatchObject({
      invokingDispatchId: unrelated.dispatchId,
      reservedMicroUsd: 4_000_000,
      settledMicroUsd: 4_000_000,
      state: "invoking",
    });
  });

  it("grants one provider invocation to concurrent same-dispatch runners", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const command = reservation("run_replay", "dispatch_replay", 10);
    const preparationsReleased = await Effect.runPromise(Deferred.make<null>());
    const losingCallerFinished = await Effect.runPromise(Deferred.make<null>());
    let preparationCalls = 0;
    let providerCalls = 0;
    const execute = () =>
      runAccountedProviderDispatch({
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
        Effect.tapError(() => Deferred.succeed(losingCallerFinished, null))
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
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const command = reservation("run_prepare", "dispatch_prepare", 10);
    let providerCalls = 0;
    const effect = runAccountedProviderDispatch({
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
    });

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
    const providerFailureRepository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const failed = reservation("run_failed", "dispatch_failed", 10);
    const providerFailure = runAccountedProviderDispatch({
      invoke: Effect.fail({ _tag: "ProviderFailed" as const }),
      repository: providerFailureRepository,
      reservation: failed,
    });

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

    await resetDispatchesAndBudget();
    const unknownRepository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const unknown = reservation(
      "run_unknown_result",
      "dispatch_unknown_result",
      20
    );
    const result = await Effect.runPromise(
      runAccountedProviderDispatch({
        invoke: Effect.succeed({
          cost: { _tag: "Unknown" as const },
          value: "unpriced",
        }),
        repository: unknownRepository,
        reservation: unknown,
      })
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
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
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
        runAccountedProviderDispatch({
          invoke: Effect.sync(() => {
            providerCalls += 1;
            return Effect.fail(
              providerKnownZeroCostFailure({
                code: "provider_unavailable",
              })
            );
          }).pipe(Effect.flatten),
          repository,
          reservation: first,
        })
      )
    ).rejects.toEqual({ code: "provider_unavailable" });

    expect(providerCalls).toBe(1);
    await expect(readPersistedDispatchState(first.dispatchId)).resolves.toEqual(
      {
        actualCostMicroUsd: 0,
        state: "settled_known",
      }
    );

    const completed = await Effect.runPromise(
      runAccountedProviderDispatch({
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
      })
    );

    expect(completed).toMatchObject({
      _tag: "Completed",
      actualCostMicroUsd: 7,
      value: "safe-transcript",
    });
    expect(providerCalls).toBe(2);

    await expect(
      Effect.runPromise(
        runAccountedProviderDispatch({
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
        })
      )
    ).resolves.toMatchObject({
      _tag: "AlreadySettled",
      actualCostMicroUsd: 7,
    });
    expect(providerCalls).toBe(2);
  });

  it("poisons a known-zero marker combined with a defect", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const first = reservation(
      "run_ambiguous_known_zero",
      "dispatch_ambiguous_known_zero",
      10
    );

    await Effect.runPromiseExit(
      runAccountedProviderDispatch({
        invoke: Effect.fail(
          providerKnownZeroCostFailure({
            code: "provider_unavailable",
          })
        ).pipe(
          Effect.ensuring(
            Effect.die(new Error("simulated post-dispatch defect"))
          )
        ),
        repository,
        reservation: first,
      })
    );

    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: first.dispatchId,
      reservedMicroUsd: 10,
      settledMicroUsd: 0,
      state: "poisoned",
    });
    await expect(readPersistedDispatchState(first.dispatchId)).resolves.toEqual(
      {
        actualCostMicroUsd: null,
        state: "settled_unknown",
      }
    );
  });

  it("does not grant zero-cost authority to a structurally similar provider error", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const first = reservation(
      "run_forged_known_zero",
      "dispatch_forged_known_zero",
      10
    );
    const providerError = {
      _tag: "ProviderKnownZeroCostFailure" as const,
      error: { code: "provider_unavailable" as const },
    };

    await expect(
      Effect.runPromise(
        runAccountedProviderDispatch<never, typeof providerError>({
          invoke: Effect.fail(providerError),
          repository,
          reservation: first,
        })
      )
    ).rejects.toEqual(providerError);

    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: first.dispatchId,
      reservedMicroUsd: 10,
      state: "poisoned",
    });
  });

  it("converges concurrent ambiguous retry fences on one unknown settlement without reinvoking", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
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
      runAccountedProviderDispatch({
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
      });

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
    await expect(readDispatchCount()).resolves.toEqual({ count: 1 });
  });

  it("poisons a typed timeout and rejects its retry before a second invocation", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
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
        runAccountedProviderDispatch({
          invoke: Effect.sync(() => {
            providerCalls += 1;
            return Effect.fail({ code: "provider_timeout" as const });
          }).pipe(Effect.flatten),
          repository,
          reservation: first,
        })
      )
    ).rejects.toEqual({ code: "provider_timeout" });

    await expect(
      Effect.runPromise(
        runAccountedProviderDispatch({
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
        })
      )
    ).rejects.toMatchObject({ code: "outcome_unknown" });

    expect(providerCalls).toBe(1);
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: first.dispatchId,
      reservedMicroUsd: 10,
      state: "poisoned",
    });
    await expect(readDispatchCount()).resolves.toEqual({ count: 1 });
  });

  it("settles defects and interruption unknown before any retry can invoke", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const defect = reservation("run_defect_retry", "dispatch_defect_retry", 10);
    let providerCalls = 0;

    await Effect.runPromiseExit(
      runAccountedProviderDispatch({
        invoke: Effect.sync(() => {
          providerCalls += 1;
          throw new Error("simulated provider crash");
        }),
        repository,
        reservation: defect,
      })
    );
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: defect.dispatchId,
      state: "poisoned",
    });

    await resetDispatchesAndBudget();

    const interrupted = reservation(
      "run_interrupted_retry",
      "dispatch_interrupted_retry",
      10
    );
    const invocationStarted = await Effect.runPromise(Deferred.make<null>());
    const fiber = Effect.runFork(
      runAccountedProviderDispatch({
        invoke: Effect.gen(function* interruptedProvider() {
          providerCalls += 1;
          yield* Deferred.succeed(invocationStarted, null);
          return yield* Effect.never;
        }),
        repository,
        reservation: interrupted,
      })
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

  it("poisons after a known settlement failure and rejects replay without reinvoking", async () => {
    const repository = makeD1ProviderAccountingRepository(
      testEnv.ProviderAccountingDatabase
    );
    const command = reservation(
      "run_settlement_failure",
      "dispatch_settlement_failure",
      10
    );
    await testEnv.ProviderAccountingDatabase.prepare(
      `CREATE TRIGGER fail_known_settlement
       BEFORE UPDATE ON provider_accounting_dispatches
       WHEN NEW.state = 'settled_known'
       BEGIN
         SELECT RAISE(ABORT, 'forced known settlement failure');
       END`
    ).run();
    let providerCalls = 0;
    const execute = () =>
      runAccountedProviderDispatch({
        invoke: Effect.sync(() => {
          providerCalls += 1;
          return {
            cost: { _tag: "Known" as const, actualCostMicroUsd: 7 },
            value: "provider-result",
          };
        }),
        repository,
        reservation: command,
      });

    await expect(Effect.runPromise(execute())).rejects.toMatchObject({
      code: "persistence_unavailable",
    });
    expect(providerCalls).toBe(1);
    expect(await Effect.runPromise(repository.readStage())).toMatchObject({
      poisonDispatchId: command.dispatchId,
      reservedMicroUsd: 10,
      state: "poisoned",
    });

    await testEnv.ProviderAccountingDatabase.prepare(
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
