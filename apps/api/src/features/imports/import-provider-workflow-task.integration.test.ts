import { randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
// oxlint-disable-next-line unicorn/import-style -- This ESM test intentionally keeps TypeScript synthetic default imports disabled.
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import * as Bundle from "alchemy/Bundle";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";
import type { ModuleDefinition } from "miniflare";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface ProviderWorkflowInput {
  readonly failureCode?: string;
  readonly importId?: string;
  readonly scenario:
    | "retry_exhausted"
    | "recipe_conservative_crash_replay"
    | "recipe_conservative_success"
    | "recipe_recovery_accounted_crash_replay"
    | "recipe_recovery_subsequent_success"
    | "recipe_recovery_loop_bounded"
    | "recipe_recovery_loop_non_retryable"
    | "recipe_recovery_loop_reconciliation_wait"
    | "recipe_recovery_loop_success"
    | "success"
    | "terminal"
    | "unknown"
    | "visual_unknown";
}

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const fixturePath = fileURLToPath(
  new URL("import-provider-workflow-task.test-fixture.ts", import.meta.url)
);
const householdDomainFixturePath = fileURLToPath(
  new URL(
    "../households/household-domain-service.test-fixture.js",
    import.meta.url
  )
);
const temporaryDirectories: string[] = [];
let runtime: Miniflare;

const readDrizzleD1Migrations = (migrationsPath: string) => {
  const sqlFiles = readdirSync(migrationsPath, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".sql"))
    .toSorted();
  return Promise.all(
    sqlFiles.map(async (name) => {
      const migrationPath = path.join(migrationsPath, name);
      if (!statSync(migrationPath).isFile()) {
        throw new Error(`Expected a migration file at ${migrationPath}.`);
      }
      const [migration] = await readD1Migrations(path.dirname(migrationPath));
      if (migration === undefined) {
        throw new Error(`Unable to read Drizzle migration ${migrationPath}.`);
      }
      return {
        ...migration,
        name: path.relative(migrationsPath, migrationPath),
      };
    })
  );
};

const buildFixture = async (inputPath: string, outputDirectory: string) => {
  const output = await Effect.runPromise(
    Bundle.build(
      {
        checks: {
          ineffectiveDynamicImport: false,
          unresolvedImport: false,
        },
        external: ["cloudflare:workers"],
        input: inputPath,
        plugins: [
          cloudflareRolldown({
            compatibilityDate,
            compatibilityFlags,
          }),
        ],
      },
      {
        codeSplitting: false,
        dir: outputDirectory,
        format: "esm",
        minify: true,
        sourcemap: false,
      }
    )
  );
  const [entry, ...assets] = output.files;
  return [
    {
      contents: Schema.is(Schema.String)(entry.content)
        ? entry.content
        : new TextDecoder().decode(entry.content),
      path: entry.path,
      type: "ESModule",
    },
    ...assets.map(
      (asset): ModuleDefinition => ({
        contents: Schema.is(Schema.String)(asset.content)
          ? asset.content
          : new TextDecoder().decode(asset.content),
        path: asset.path,
        type: "Text",
      })
    ),
  ] as const satisfies readonly [ModuleDefinition, ...ModuleDefinition[]];
};

const applyMigrations = async () => {
  const database = await runtime.getD1Database("MealPlannerDatabase");
  const migrations = await readDrizzleD1Migrations(
    fileURLToPath(new URL("../../../migrations", import.meta.url))
  );
  await database
    .prepare(
      `CREATE TABLE d1_migrations (
         id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
         name TEXT NOT NULL UNIQUE,
         applied_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
       )`
    )
    .run();
  const applyRemaining = async (
    remaining: readonly (typeof migrations)[number][]
  ): Promise<void> => {
    const [migration, ...rest] = remaining;
    if (migration === undefined) {
      return;
    }
    await database.batch([
      ...migration.queries.map((query) => database.prepare(query)),
      database
        .prepare("INSERT INTO d1_migrations (name) VALUES (?)")
        .bind(migration.name),
    ]);
    await applyRemaining(rest);
  };
  await applyRemaining(migrations);
};

beforeAll(async () => {
  const temporaryDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-gaia-163-native-`
  );
  temporaryDirectories.push(temporaryDirectory);
  const [fixtureModules, householdDomainModules] = await Promise.all([
    buildFixture(fixturePath, `${temporaryDirectory}/provider-workflow`),
    buildFixture(householdDomainFixturePath, `${temporaryDirectory}/household`),
  ]);
  runtime = new Miniflare({
    compatibilityDate,
    compatibilityFlags,
    workers: [
      {
        compatibilityDate,
        compatibilityFlags,
        d1Databases: { MealPlannerDatabase: "gaia-163-test" },
        kvNamespaces: ["PROVIDER_WORKFLOW_STATE"],
        modules: [...fixtureModules],
        name: "provider-workflow",
        serviceBindings: { HouseholdDomainWorker: "household-domain" },
        workflows: {
          ProviderRetryWorkflow: {
            className: "ProviderRetryWorkflow",
            name: "provider-retry-workflow",
          },
        },
      },
      {
        compatibilityDate,
        compatibilityFlags,
        durableObjects: {
          HouseholdObject: { className: "HouseholdObject", useSQLite: true },
        },
        modules: [...householdDomainModules],
        name: "household-domain",
      },
    ],
  });
  await applyMigrations();
}, 30_000);

afterAll(async () => {
  await runtime.dispose();
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

const stateKey = (instanceId: string, name: string) => `${instanceId}:${name}`;

const readNumber = async (instanceId: string, name: string) => {
  const { PROVIDER_WORKFLOW_STATE: namespace } = await runtime.getBindings<{
    readonly PROVIDER_WORKFLOW_STATE: {
      readonly get: (key: string) => Promise<string | null>;
    };
  }>();
  return Number((await namespace.get(stateKey(instanceId, name))) ?? "0");
};

const commandWorkflow = async (
  command:
    | { readonly action: "run-visual-recipe-budget"; readonly id: string }
    | { readonly action: "restart"; readonly id: string }
    | {
        readonly action: "activate-recovery";
        readonly id: string;
        readonly importId: string;
        readonly outcome: "Prepared" | "Replay";
      }
    | {
        readonly action: "run";
        readonly id: string;
        readonly input: ProviderWorkflowInput;
      }
    | {
        readonly action: "run-waiting";
        readonly id: string;
        readonly input: ProviderWorkflowInput;
      }
) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify(command),
    method: "POST",
  });
  const responseText = await response.text();
  expect(response.status, responseText).toBe(200);
  const status = JSON.parse(responseText) as unknown;
  expect(JSON.stringify(status)).not.toContain("must-not-cross-the-checkpoint");
  return status;
};

const runWorkflow = (id: string, input: ProviderWorkflowInput) =>
  commandWorkflow({ action: "run", id, input });

const runWaitingWorkflow = (id: string, input: ProviderWorkflowInput) =>
  commandWorkflow({ action: "run-waiting", id, input });

const activateRecipeRecovery = (
  id: string,
  importId: string,
  outcome: "Prepared" | "Replay"
) => commandWorkflow({ action: "activate-recovery", id, importId, outcome });

const runVisualRecipeBudget = (id: string) =>
  commandWorkflow({ action: "run-visual-recipe-budget", id });

const restartFromAfterProviderCheckpoint = (id: string) =>
  commandWorkflow({ action: "restart", id });

const resetGlobalProviderAccounting = (database: AnyD1Database) =>
  database
    .prepare(
      `UPDATE provider_accounting_budgets
          SET invoking_dispatch_id = NULL,
              poison_dispatch_id = NULL,
              reserved_micro_usd = 0,
              state = 'open'
        WHERE accounting_scope = 'recipe-import'`
    )
    .run();

describe("provider workflow task retry exhaustion", () => {
  it("settles missing visual usage at the bounded maximum and permits the next recipe dispatch", async () => {
    const database = await runtime.getD1Database("MealPlannerDatabase");
    const stageBefore = await database
      .prepare(
        `SELECT settled_micro_usd
           FROM provider_accounting_budgets
          WHERE accounting_scope = 'recipe-import'`
      )
      .first<{ readonly settled_micro_usd: number }>();
    if (stageBefore === null) {
      throw new Error("Provider accounting baseline is missing");
    }

    try {
      await expect(
        runVisualRecipeBudget("gaia-199-missing-visual-usage")
      ).resolves.toEqual({
        providerCalls: 2,
        recipeResult: "recipe-dispatched",
        stage: {
          budgetCapMicroUsd: 10_000_000,
          reservedMicroUsd: 0,
          settledMicroUsd: stageBefore.settled_micro_usd + 100_029,
          state: "open",
        },
        visualCost: {
          certainty: "estimated",
          currency: "USD",
          estimatedMicroUsd: 100_000,
        },
      });
      await expect(
        database
          .prepare(
            `SELECT actual_cost_micro_usd, dispatch_id, state
               FROM provider_accounting_dispatches
              WHERE run_id = 'gaia-199:missing-visual-usage'
              ORDER BY dispatch_id`
          )
          .all()
      ).resolves.toMatchObject({
        results: [
          {
            actual_cost_micro_usd: 29,
            dispatch_id:
              "recipe:00000000-0000-4000-8000-000000000199:1:gaia-199-evidence",
            state: "settled_known",
          },
          {
            actual_cost_micro_usd: 100_000,
            dispatch_id: "visual:gaia-199:1",
            state: "settled_known",
          },
        ],
      });
    } finally {
      await database
        .prepare(
          `DELETE FROM provider_accounting_dispatches
            WHERE run_id = 'gaia-199:missing-visual-usage'`
        )
        .run();
      await database
        .prepare(
          `UPDATE provider_accounting_budgets
              SET settled_micro_usd = ?,
                  reserved_micro_usd = 0,
                  state = 'open',
                  invoking_dispatch_id = NULL,
                  poison_dispatch_id = NULL
            WHERE accounting_scope = 'recipe-import'`
        )
        .bind(stageBefore.settled_micro_usd)
        .run();
    }
  });

  it("uses native retries, checkpoints final exhaustion, and replays with zero provider calls", async () => {
    const instanceId = "gaia-163-native-retry-exhausted";
    const database = await runtime.getD1Database("MealPlannerDatabase");

    await expect(
      runWorkflow(instanceId, { scenario: "retry_exhausted" })
    ).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        code: "retry_exhausted",
        stage: "speech",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "task-attempts")).toBe(3);
    expect(await readNumber(instanceId, "provider-calls")).toBe(3);
    expect(await readNumber(instanceId, "workflow-runs")).toBe(1);
    await expect(
      database
        .prepare(
          `SELECT actual_cost_micro_usd, dispatch_id, state
             FROM provider_accounting_dispatches
            WHERE run_id = 'run_gaia_186_known_zero'
            ORDER BY dispatch_id`
        )
        .all()
    ).resolves.toMatchObject({
      results: [
        {
          actual_cost_micro_usd: 0,
          dispatch_id: "speech:gaia-186-known-zero:1",
          state: "settled_known",
        },
        {
          actual_cost_micro_usd: 0,
          dispatch_id: "speech:gaia-186-known-zero:1:attempt:2",
          state: "settled_known",
        },
        {
          actual_cost_micro_usd: 0,
          dispatch_id: "speech:gaia-186-known-zero:1:attempt:3",
          state: "settled_known",
        },
      ],
    });
    await expect(
      database
        .prepare(
          `SELECT invoking_dispatch_id, poison_dispatch_id,
                  reserved_micro_usd, settled_micro_usd, state
             FROM provider_accounting_budgets
            WHERE accounting_scope = 'recipe-import'`
        )
        .first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: 0,
      state: "open",
    });

    await expect(
      restartFromAfterProviderCheckpoint(instanceId)
    ).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        code: "retry_exhausted",
        stage: "speech",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "workflow-runs")).toBe(2);
    expect(await readNumber(instanceId, "task-attempts")).toBe(3);
    expect(await readNumber(instanceId, "provider-calls")).toBe(3);
  });

  it("uses the installed speech adapter and real ledger to fence an ambiguous retry and replay", async () => {
    const instanceId = "gaia-163-native-unknown-poison";
    const database = await runtime.getD1Database("MealPlannerDatabase");
    const stageBefore = await database
      .prepare(
        `SELECT settled_micro_usd
           FROM provider_accounting_budgets
          WHERE accounting_scope = 'recipe-import'`
      )
      .first<{ readonly settled_micro_usd: number }>();
    const dispatchesBefore = await database
      .prepare("SELECT COUNT(*) AS count FROM provider_accounting_dispatches")
      .first<{ readonly count: number }>();
    if (stageBefore === null || dispatchesBefore === null) {
      throw new Error("Provider accounting baseline is missing");
    }

    await expect(
      runWorkflow(instanceId, { scenario: "unknown" })
    ).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: "speech",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "task-attempts")).toBe(2);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);

    const stage = await database
      .prepare(
        `SELECT invoking_dispatch_id, poison_dispatch_id, reserved_micro_usd,
                settled_micro_usd, state
           FROM provider_accounting_budgets
          WHERE accounting_scope = 'recipe-import'`
      )
      .first();
    expect(stage).toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: "speech:gaia-186-ambiguous:1",
      reserved_micro_usd: 50_000,
      settled_micro_usd: stageBefore.settled_micro_usd,
      state: "poisoned",
    });
    const dispatches = await database
      .prepare(
        `SELECT actual_cost_micro_usd, dispatch_id, maximum_cost_micro_usd,
                provider_stage_id, run_id, state
          FROM provider_accounting_dispatches
          WHERE dispatch_id = 'speech:gaia-186-ambiguous:1'
          ORDER BY dispatch_id`
      )
      .all();
    expect(dispatches.results).toEqual([
      {
        actual_cost_micro_usd: null,
        dispatch_id: "speech:gaia-186-ambiguous:1",
        maximum_cost_micro_usd: 50_000,
        provider_stage_id: "speech-transcription",
        run_id: "run_gaia_186_ambiguous",
        state: "settled_unknown",
      },
    ]);

    await expect(
      restartFromAfterProviderCheckpoint(instanceId)
    ).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: "speech",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "workflow-runs")).toBe(2);
    expect(await readNumber(instanceId, "task-attempts")).toBe(2);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
    await expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM provider_accounting_dispatches")
        .first()
    ).resolves.toEqual({ count: dispatchesBefore.count + 1 });
  });

  it("replays an ambiguous installed visual adapter checkpoint without a second provider call", async () => {
    const instanceId = "slice-2-native-visual-unknown-replay";
    const database = await runtime.getD1Database("MealPlannerDatabase");
    await resetGlobalProviderAccounting(database);

    await expect(
      runWorkflow(instanceId, { scenario: "visual_unknown" })
    ).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        stage: "visual",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "task-attempts")).toBe(2);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
    await expect(
      database
        .prepare(
          `SELECT dispatch_id, provider_stage_id, state
             FROM provider_accounting_dispatches
            WHERE dispatch_id = 'visual:gaia-188-ambiguous:1'`
        )
        .first()
    ).resolves.toEqual({
      dispatch_id: "visual:gaia-188-ambiguous:1",
      provider_stage_id: "visual-evidence",
      state: "settled_unknown",
    });

    await expect(
      restartFromAfterProviderCheckpoint(instanceId)
    ).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        stage: "visual",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "workflow-runs")).toBe(2);
    expect(await readNumber(instanceId, "task-attempts")).toBe(2);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
  });

  it.each([
    { checkpointCode: "model_refusal", label: "refusal" },
    { checkpointCode: "invalid_schema", label: "malformed-output" },
    {
      checkpointCode: "insufficient_evidence",
      label: "insufficient-evidence",
    },
    {
      checkpointCode: "provider_error",
      label: "non-retryable-provider-failure",
    },
  ])(
    "preserves the terminal $label checkpoint through native replay",
    async ({ checkpointCode, label }) => {
      const instanceId = `gaia-163-terminal-${label}`;

      await expect(
        runWorkflow(instanceId, {
          failureCode: checkpointCode,
          scenario: "terminal",
        })
      ).resolves.toMatchObject({
        output: {
          _tag: "Failed",
          code: checkpointCode,
          stage: "visual",
        },
        status: "complete",
      });
      expect(await readNumber(instanceId, "task-attempts")).toBe(1);
      expect(await readNumber(instanceId, "provider-calls")).toBe(1);

      await restartFromAfterProviderCheckpoint(instanceId);
      expect(await readNumber(instanceId, "workflow-runs")).toBe(2);
      expect(await readNumber(instanceId, "task-attempts")).toBe(1);
      expect(await readNumber(instanceId, "provider-calls")).toBe(1);
    }
  );

  it("preserves a successful checkpoint through native replay", async () => {
    const instanceId = "gaia-163-success";

    await expect(
      runWorkflow(instanceId, { scenario: "success" })
    ).resolves.toMatchObject({
      output: {
        _tag: "Succeeded",
        evidence: "safe-evidence",
        stage: "visual",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "task-attempts")).toBe(1);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);

    await restartFromAfterProviderCheckpoint(instanceId);
    expect(await readNumber(instanceId, "workflow-runs")).toBe(2);
    expect(await readNumber(instanceId, "task-attempts")).toBe(1);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
  });

  it("runs the bounded recovery loop through exactly eight native checkpoints", async () => {
    const instanceId = `s09-recovery-loop-bounded-${randomUUID()}`;
    await expect(
      runWorkflow(instanceId, {
        importId: randomUUID(),
        scenario: "recipe_recovery_loop_bounded",
      })
    ).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: "recipe",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "recovery-loop-provider-calls")).toBe(
      8
    );
    expect(
      await readNumber(instanceId, "recovery-loop-terminal-persistences")
    ).toBe(8);
    const durableTaskCounts = await Promise.all(
      Array.from({ length: 8 }, (_, index) => index + 1).flatMap((ordinal) => [
        readNumber(instanceId, `extract-recipe-recovery-v${ordinal}`),
        readNumber(instanceId, `persist-recipe-recovery-terminal-v${ordinal}`),
      ])
    );
    expect(durableTaskCounts).toEqual(Array.from({ length: 16 }, () => 1));
  });

  it("stops the native recovery loop immediately on success and non-retryable failure", async () => {
    const assertImmediateStop = async (
      scenario:
        | "recipe_recovery_loop_non_retryable"
        | "recipe_recovery_loop_success"
    ) => {
      const instanceId = `s09-${scenario}-${randomUUID()}`;
      const result = await runWorkflow(instanceId, {
        importId: randomUUID(),
        scenario,
      });
      expect(await readNumber(instanceId, "recovery-loop-provider-calls")).toBe(
        1
      );
      expect(result).toMatchObject({
        output:
          scenario === "recipe_recovery_loop_success"
            ? { _tag: "Succeeded", stage: "recipe" }
            : { _tag: "Failed", code: "invalid_schema", stage: "recipe" },
        status: "complete",
      });
      expect(
        await readNumber(instanceId, "recovery-loop-terminal-persistences")
      ).toBe(0);
      expect(await readNumber(instanceId, "extract-recipe-recovery-v1")).toBe(
        1
      );
      expect(await readNumber(instanceId, "extract-recipe-recovery-v2")).toBe(
        0
      );
    };

    await assertImmediateStop("recipe_recovery_loop_success");
    await assertImmediateStop("recipe_recovery_loop_non_retryable");
  });

  it("waits after unknown settlement instead of redispatching without reconciliation", async () => {
    const instanceId = `s09-recovery-loop-wait-${randomUUID()}`;
    await expect(
      runWaitingWorkflow(instanceId, {
        importId: randomUUID(),
        scenario: "recipe_recovery_loop_reconciliation_wait",
      })
    ).resolves.toMatchObject({ output: null, status: "running" });
    expect(await readNumber(instanceId, "recovery-loop-provider-calls")).toBe(
      1
    );
    expect(
      await readNumber(instanceId, "recovery-loop-terminal-persistences")
    ).toBe(1);
    expect(await readNumber(instanceId, "extract-recipe-recovery-v1")).toBe(1);
    expect(await readNumber(instanceId, "extract-recipe-recovery-v2")).toBe(0);
  });

  it("runs native recovery through production accounting and replays after settlement without another provider call", async () => {
    const instanceId = `recipe-recovery-accounted-${randomUUID()}`;
    const importId = randomUUID();
    const dispatchId = `recipe:${importId}:1:${"e".repeat(64)}:recovery:1`;
    const database = await runtime.getD1Database("MealPlannerDatabase");
    await resetGlobalProviderAccounting(database);

    await expect(
      runWorkflow(instanceId, {
        importId,
        scenario: "recipe_recovery_accounted_crash_replay",
      })
    ).resolves.toMatchObject({
      output: { _tag: "Succeeded", stage: "recipe" },
      status: "complete",
    });
    expect(await readNumber(instanceId, "task-attempts")).toBe(2);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
    expect(await readNumber(instanceId, "post-settlement-crashes")).toBe(1);
    await expect(
      database
        .prepare(
          `SELECT actual_cost_micro_usd, maximum_cost_micro_usd,
                  provider_stage_id, run_id, state
             FROM provider_accounting_dispatches
            WHERE accounting_scope = 'recipe-import' AND dispatch_id = ?`
        )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_micro_usd: null,
      maximum_cost_micro_usd: 100_000,
      provider_stage_id: "recipe-extraction",
      run_id: `recipe-import:recipe-recovery:${importId}`,
      state: "settled_unknown",
    });
    await expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM provider_accounting_conservative_settlements
            WHERE accounting_scope = 'recipe-import' AND dispatch_id = ?`
        )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
  });

  it("restarts a completed provider-error recovery for a newly prepared higher ordinal and commits its review draft once", async () => {
    const importId = randomUUID();
    const instanceId = `import-recipe-recovery-${importId}-1`;
    const dispatchId = `recipe:${importId}:1:${"e".repeat(64)}:recovery:2`;
    const database = await runtime.getD1Database("MealPlannerDatabase");
    await resetGlobalProviderAccounting(database);

    await expect(
      runWorkflow(instanceId, {
        importId,
        scenario: "recipe_recovery_subsequent_success",
      })
    ).resolves.toMatchObject({
      output: { _tag: "Failed", code: "provider_error", stage: "recipe" },
      status: "complete",
    });

    await expect(
      activateRecipeRecovery(instanceId, importId, "Prepared")
    ).resolves.toMatchObject({
      output: { _tag: "Succeeded", stage: "recipe" },
      status: "complete",
    });
    expect(await readNumber(instanceId, "workflow-runs")).toBe(2);
    expect(await readNumber(instanceId, "extract-recipe-recovery-v1")).toBe(2);
    expect(await readNumber(instanceId, "extract-recipe-recovery-v2")).toBe(1);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
    expect(await readNumber(instanceId, "recipe-draft-completions")).toBe(1);
    expect(await readNumber(instanceId, "recovery-lifecycle-transitions")).toBe(
      2
    );
    expect(await readNumber(instanceId, "recovery-review-commits")).toBe(1);
    await expect(
      database
        .prepare(
          `SELECT provider_stage_id, run_id, state
             FROM provider_accounting_dispatches
            WHERE accounting_scope = 'recipe-import' AND dispatch_id = ?`
        )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({
      provider_stage_id: "recipe-extraction",
      run_id: `recipe-import:recipe-recovery:${importId}`,
      state: "settled_unknown",
    });

    await expect(
      activateRecipeRecovery(instanceId, importId, "Replay")
    ).resolves.toMatchObject({
      output: { _tag: "Succeeded", stage: "recipe" },
      status: "complete",
    });
    expect(await readNumber(instanceId, "workflow-runs")).toBe(2);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
    expect(await readNumber(instanceId, "recipe-draft-completions")).toBe(1);
    expect(await readNumber(instanceId, "recovery-review-commits")).toBe(1);
  }, 15_000);

  it("persists a conservative installed recipe result and replays its native task without another provider call", async () => {
    const instanceId = `gaia-205-recipe-conservative-${randomUUID()}`;
    const importId = randomUUID();
    const dispatchId = `recipe:${importId}:1:${"e".repeat(64)}`;
    const database = await runtime.getD1Database("MealPlannerDatabase");
    await resetGlobalProviderAccounting(database);
    const stageBefore = await database
      .prepare(
        `SELECT settled_micro_usd
           FROM provider_accounting_budgets
          WHERE accounting_scope = 'recipe-import'`
      )
      .first<{ readonly settled_micro_usd: number }>();
    if (stageBefore === null) {
      throw new Error("Provider accounting baseline is missing");
    }

    const initial = await runWorkflow(instanceId, {
      importId,
      scenario: "recipe_conservative_success",
    });
    expect(initial).toMatchObject({
      output: {
        _tag: "Succeeded",
        evidence: "recipe-conservative-evidence",
        stage: "recipe",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "workflow-runs")).toBe(1);
    expect(await readNumber(instanceId, "task-attempts")).toBe(1);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
    expect(await readNumber(instanceId, "recipe-adapter-completions")).toBe(1);
    expect(await readNumber(instanceId, "recipe-dispatch-completions")).toBe(1);
    await expect(
      database
        .prepare(
          `SELECT actual_cost_micro_usd, dispatch_id,
                  maximum_cost_micro_usd, provider_stage_id, run_id, state
             FROM provider_accounting_dispatches
            WHERE accounting_scope = 'recipe-import' AND dispatch_id = ?`
        )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_micro_usd: null,
      dispatch_id: dispatchId,
      maximum_cost_micro_usd: 100_000,
      provider_stage_id: "recipe-extraction",
      run_id: `recipe-import:${importId}`,
      state: "settled_unknown",
    });
    await expect(
      database
        .prepare(
          `SELECT authority, conservative_charge_micro_usd
             FROM provider_accounting_conservative_settlements
            WHERE accounting_scope = 'recipe-import' AND dispatch_id = ?`
        )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({
      authority: "schema_valid_provider_response",
      conservative_charge_micro_usd: 100_000,
    });
    await expect(
      database
        .prepare(
          `SELECT invoking_dispatch_id, poison_dispatch_id,
                  reserved_micro_usd, settled_micro_usd, state
             FROM provider_accounting_budgets
            WHERE accounting_scope = 'recipe-import'`
        )
        .first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: stageBefore.settled_micro_usd + 100_000,
      state: "open",
    });

    await expect(
      restartFromAfterProviderCheckpoint(instanceId)
    ).resolves.toMatchObject({
      output: {
        _tag: "Succeeded",
        evidence: "recipe-conservative-evidence",
        stage: "recipe",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "workflow-runs")).toBe(2);
    expect(await readNumber(instanceId, "task-attempts")).toBe(1);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
    expect(await readNumber(instanceId, "recipe-adapter-completions")).toBe(1);
    expect(await readNumber(instanceId, "recipe-dispatch-completions")).toBe(1);
    await expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM provider_accounting_conservative_settlements
            WHERE accounting_scope = 'recipe-import' AND dispatch_id = ?`
        )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      database
        .prepare(
          `SELECT reserved_micro_usd, settled_micro_usd, state
             FROM provider_accounting_budgets
            WHERE accounting_scope = 'recipe-import'`
        )
        .first()
    ).resolves.toEqual({
      reserved_micro_usd: 0,
      settled_micro_usd: stageBefore.settled_micro_usd + 100_000,
      state: "open",
    });
  });

  it("replays a conservatively settled recipe after a native post-settlement crash without a second provider call or charge", async () => {
    const instanceId = `gaia-205-recipe-conservative-crash-${randomUUID()}`;
    const importId = randomUUID();
    const dispatchId = `recipe:${importId}:1:${"e".repeat(64)}`;
    const database = await runtime.getD1Database("MealPlannerDatabase");
    await resetGlobalProviderAccounting(database);
    const stageBefore = await database
      .prepare(
        `SELECT settled_micro_usd
           FROM provider_accounting_budgets
          WHERE accounting_scope = 'recipe-import'`
      )
      .first<{ readonly settled_micro_usd: number }>();
    if (stageBefore === null) {
      throw new Error("Provider accounting baseline is missing");
    }

    await expect(
      runWorkflow(instanceId, {
        importId,
        scenario: "recipe_conservative_crash_replay",
      })
    ).resolves.toMatchObject({
      output: {
        _tag: "Succeeded",
        evidence: "recipe-conservative-evidence",
        stage: "recipe",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "workflow-runs")).toBe(1);
    expect(await readNumber(instanceId, "task-attempts")).toBe(2);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
    expect(await readNumber(instanceId, "recipe-adapter-completions")).toBe(2);
    expect(await readNumber(instanceId, "recipe-dispatch-completions")).toBe(1);
    expect(await readNumber(instanceId, "post-settlement-crashes")).toBe(1);
    await expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM provider_accounting_conservative_settlements
            WHERE accounting_scope = 'recipe-import' AND dispatch_id = ?`
        )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM provider_accounting_recipe_replay_values
            WHERE accounting_scope = 'recipe-import' AND dispatch_id = ?`
        )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      database
        .prepare(
          `SELECT invoking_dispatch_id, poison_dispatch_id,
                  reserved_micro_usd, settled_micro_usd, state
             FROM provider_accounting_budgets
            WHERE accounting_scope = 'recipe-import'`
        )
        .first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: stageBefore.settled_micro_usd + 100_000,
      state: "open",
    });

    await expect(
      restartFromAfterProviderCheckpoint(instanceId)
    ).resolves.toMatchObject({
      output: {
        _tag: "Succeeded",
        evidence: "recipe-conservative-evidence",
        stage: "recipe",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "workflow-runs")).toBe(2);
    expect(await readNumber(instanceId, "task-attempts")).toBe(2);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
    expect(await readNumber(instanceId, "recipe-adapter-completions")).toBe(2);
    expect(await readNumber(instanceId, "recipe-dispatch-completions")).toBe(1);
    expect(await readNumber(instanceId, "post-settlement-crashes")).toBe(1);
  });
});
