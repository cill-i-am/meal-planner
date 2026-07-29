import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import * as Bundle from "alchemy/Bundle";
import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface ProviderWorkflowInput {
  readonly failureCode?: string;
  readonly importId?: string;
  readonly scenario:
    | "retry_exhausted"
    | "speech_terminal_recovery"
    | "speech_terminal_recovery_poison"
    | "success"
    | "terminal"
    | "unknown";
}

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const fixturePath = fileURLToPath(
  new URL("import-provider-workflow-task.test-fixture.ts", import.meta.url)
);
const temporaryDirectories: string[] = [];
let runtime: Miniflare;

const buildFixture = async (outputDirectory: string) => {
  type BundlePlugin = NonNullable<
    Parameters<typeof Bundle.build>[0]["plugins"]
  >;
  const alchemyEntry = import.meta.resolve("alchemy");
  const pluginModule = new URL(
    "../../@distilled.cloud/cloudflare-rolldown-plugin/dist/plugin.js",
    alchemyEntry
  );
  const { default: cloudflareRolldown } = (await import(pluginModule.href)) as {
    readonly default: (options: {
      readonly compatibilityDate: string;
      readonly compatibilityFlags: string[];
    }) => BundlePlugin;
  };
  const output = await Effect.runPromise(
    Bundle.build(
      {
        checks: {
          ineffectiveDynamicImport: false,
          unresolvedImport: false,
        },
        external: ["cloudflare:workers"],
        input: fixturePath,
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
  const {
    files: [{ content }],
  } = output;
  return typeof content === "string"
    ? content
    : new TextDecoder().decode(content);
};

const applyMigrations = async () => {
  const database = await runtime.getD1Database("MealPlannerDatabase");
  const migrations = await readD1Migrations(
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
  const fixtureScript = await buildFixture(temporaryDirectory);
  runtime = new Miniflare({
    compatibilityDate,
    compatibilityFlags,
    d1Databases: { MealPlannerDatabase: "gaia-163-test" },
    kvNamespaces: ["PROVIDER_WORKFLOW_STATE"],
    modules: [
      {
        contents: fixtureScript,
        path: "provider-workflow-fixture.js",
        type: "ESModule",
      },
    ],
    workflows: {
      ProviderRetryWorkflow: {
        className: "ProviderRetryWorkflow",
        name: "provider-retry-workflow",
      },
    },
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

const readText = async (instanceId: string, name: string) => {
  const { PROVIDER_WORKFLOW_STATE: namespace } = await runtime.getBindings<{
    readonly PROVIDER_WORKFLOW_STATE: {
      readonly get: (key: string) => Promise<string | null>;
    };
  }>();
  return namespace.get(stateKey(instanceId, name));
};

const commandWorkflow = async (
  command:
    | {
        readonly action: "interleave-stage";
        readonly id: string;
      }
    | {
        readonly action: "prepare-speech";
        readonly id: string;
        readonly importId: string;
      }
    | {
        readonly action: "settle-speech";
        readonly dispatchId: string;
        readonly id: string;
        readonly importId: string;
      }
    | { readonly action: "run-visual-recipe-budget"; readonly id: string }
    | { readonly action: "restart"; readonly id: string }
    | { readonly action: "restart-speech"; readonly id: string }
    | { readonly action: "restart-terminal"; readonly id: string }
    | { readonly action: "restart-visual"; readonly id: string }
    | {
        readonly action: "run";
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

const runVisualRecipeBudget = (id: string) =>
  commandWorkflow({ action: "run-visual-recipe-budget", id });

const restartFromAfterProviderCheckpoint = (id: string) =>
  commandWorkflow({ action: "restart", id });

const restartFromTerminalPersistence = (id: string) =>
  commandWorkflow({ action: "restart-terminal", id });

const prepareSpeechRecovery = (id: string, importId: string) =>
  commandWorkflow({ action: "prepare-speech", id, importId });

const interleaveKnownZeroStageDispatch = (id: string) =>
  commandWorkflow({ action: "interleave-stage", id });

const restartFromSpeechProvider = (id: string) =>
  commandWorkflow({ action: "restart-speech", id });

const restartFromVisualEvidence = (id: string) =>
  commandWorkflow({ action: "restart-visual", id });

const settleSpeechTerminal = (
  id: string,
  importId: string,
  dispatchId: string
) => commandWorkflow({ action: "settle-speech", dispatchId, id, importId });

describe("provider workflow task retry exhaustion", () => {
  it("settles missing visual usage at the bounded maximum and permits the next recipe dispatch", async () => {
    const database = await runtime.getD1Database("MealPlannerDatabase");
    const stageBefore = await database
      .prepare(
        `SELECT settled_micro_usd
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      )
      .first<{ readonly settled_micro_usd: number }>();
    if (stageBefore === null) {
      throw new Error("Pilot provider budget baseline is missing");
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
               FROM pilot_provider_budget_dispatches
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
          `DELETE FROM pilot_provider_budget_dispatches
            WHERE run_id = 'gaia-199:missing-visual-usage'`
        )
        .run();
      await database
        .prepare(
          `UPDATE pilot_provider_stage_budget
              SET settled_micro_usd = ?,
                  reserved_micro_usd = 0,
                  state = 'open',
                  invoking_dispatch_id = NULL,
                  poison_dispatch_id = NULL
            WHERE runtime_stage = 'pilot-gaia-118'`
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
             FROM pilot_provider_budget_dispatches
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
             FROM pilot_provider_stage_budget
            WHERE runtime_stage = 'pilot-gaia-118'`
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

  it("persists, replays, and recovers a speech terminal through native tasks and real D1", async () => {
    const instanceId = "gaia-178-native-speech-terminal-recovery";
    const importId = "00000000-0000-4000-8000-000000000181";
    const generation = 1;
    const originalDispatchId = `speech:${importId}:${generation}`;
    const recoveryDispatchId = `${originalDispatchId}:recovery:1`;
    const now = "2026-07-27T09:10:00.000Z";
    const database = await runtime.getD1Database("MealPlannerDatabase");
    const evidence = JSON.stringify([
      {
        kind: "original_media",
        referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/original.mp4`,
      },
      {
        kind: "acquisition_manifest",
        referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/manifest.json`,
      },
    ]);
    await database
      .prepare(
        `INSERT INTO recipe_imports (
           acquisition_generation, canonical_source_id,
           compatibility_fingerprint, created_at,
           evidence_references_json, id, recovery_action, source_kind,
           status, status_code, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'tiktok_video', 'acquired', NULL, ?)`
      )
      .bind(
        generation,
        "canonical-gaia-178-native-recovery",
        "f".repeat(64),
        now,
        evidence,
        importId,
        now
      )
      .run();
    await database
      .prepare(
        `INSERT INTO import_transcriptions (
           import_id, acquisition_generation, dispatch_id,
           source_media_sha256, state, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'dispatching', ?, ?)`
      )
      .bind(importId, generation, originalDispatchId, "a".repeat(64), now, now)
      .run();

    await expect(
      runWorkflow(instanceId, {
        importId,
        scenario: "speech_terminal_recovery",
      })
    ).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: "speech",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "acquisition-calls")).toBe(1);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
    await expect(
      database
        .prepare(
          `SELECT failure_code, ownership_id
             FROM import_provider_terminal_checkpoints
            WHERE import_id = ? AND acquisition_generation = ?
              AND provider_stage = 'speech'`
        )
        .bind(importId, generation)
        .first()
    ).resolves.toEqual({
      failure_code: "outcome_unknown",
      ownership_id: originalDispatchId,
    });
    await expect(
      database
        .prepare(
          `SELECT status, status_code, recovery_action
             FROM recipe_imports
            WHERE id = ?`
        )
        .bind(importId)
        .first()
    ).resolves.toEqual({
      recovery_action: "retry_later",
      status: "failed",
      status_code: "transcription_failed",
    });

    await expect(
      restartFromTerminalPersistence(instanceId)
    ).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: "speech",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "acquisition-calls")).toBe(1);
    expect(await readNumber(instanceId, "provider-calls")).toBe(1);
    await expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM import_provider_terminal_checkpoints
            WHERE import_id = ? AND acquisition_generation = ?
              AND provider_stage = 'speech'`
        )
        .bind(importId, generation)
        .first()
    ).resolves.toEqual({ count: 1 });

    await expect(
      settleSpeechTerminal(instanceId, importId, originalDispatchId)
    ).resolves.toMatchObject({
      conservativeChargeMicroUsd: 100,
      dispatchId: originalDispatchId,
      outcome: "terminal_unknown_cost_settled",
      runtimeStage: "pilot-gaia-118",
    });
    await expect(
      database
        .prepare(
          `SELECT invoking_dispatch_id, poison_dispatch_id,
                  reserved_micro_usd, state
             FROM pilot_provider_stage_budget
            WHERE runtime_stage = 'pilot-gaia-118'`
        )
        .first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      state: "open",
    });

    await expect(
      prepareSpeechRecovery(instanceId, importId)
    ).resolves.toMatchObject({
      acquisitionGeneration: generation,
      importId,
      originalDispatchId,
      recoveryDispatchId,
    });
    await expect(interleaveKnownZeroStageDispatch(instanceId)).resolves.toEqual(
      {
        outcome: "settled_known_zero",
      }
    );
    await expect(restartFromSpeechProvider(instanceId)).resolves.toMatchObject({
      output: {
        _tag: "Succeeded",
        evidence: "safe-transcript",
        stage: "speech",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "acquisition-calls")).toBe(1);
    expect(await readNumber(instanceId, "provider-calls")).toBe(2);
    expect(await readNumber(instanceId, "visual-calls")).toBe(1);
    await expect(
      readText(instanceId, "visual-speech-dispatch-id")
    ).resolves.toBe(recoveryDispatchId);
    await expect(restartFromVisualEvidence(instanceId)).resolves.toMatchObject({
      output: {
        _tag: "Succeeded",
        evidence: "safe-transcript",
        stage: "speech",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "acquisition-calls")).toBe(1);
    expect(await readNumber(instanceId, "provider-calls")).toBe(2);
    expect(await readNumber(instanceId, "visual-calls")).toBe(2);
    await expect(
      readText(instanceId, "visual-speech-dispatch-id")
    ).resolves.toBe(recoveryDispatchId);
    await expect(
      database
        .prepare(
          `SELECT original_dispatch_id, recovery_dispatch_id
             FROM pilot_provider_speech_recoveries
            WHERE runtime_stage = 'pilot-gaia-118'
              AND import_id = ? AND acquisition_generation = ?`
        )
        .bind(importId, generation)
        .first()
    ).resolves.toBeNull();
    await expect(
      database
        .prepare(
          `SELECT authority, conservative_charge_micro_usd
             FROM pilot_provider_budget_reconciliations
            WHERE runtime_stage = 'pilot-gaia-118'
              AND dispatch_id = ?`
        )
        .bind(originalDispatchId)
        .first()
    ).resolves.toEqual({
      authority: "authenticated_operator",
      conservative_charge_micro_usd: 100,
    });
    await expect(
      database
        .prepare(
          `SELECT actual_cost_micro_usd, state
             FROM pilot_provider_budget_dispatches
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
        .bind(recoveryDispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_micro_usd: 10,
      state: "settled_known",
    });
    await expect(
      database
        .prepare(
          `SELECT invoking_dispatch_id, poison_dispatch_id, state
             FROM pilot_provider_stage_budget
            WHERE runtime_stage = 'pilot-gaia-118'`
        )
        .first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      state: "open",
    });
  });

  it("replays one poisoned recovery identity without invoking the provider or nesting recovery", async () => {
    const instanceId = "gaia-187-native-poisoned-speech-recovery";
    const importId = "00000000-0000-4000-8000-000000000188";
    const generation = 1;
    const originalDispatchId = `speech:${importId}:${generation}`;
    const recoveryDispatchId = `${originalDispatchId}:recovery:1`;
    const now = "2026-07-27T09:20:00.000Z";
    const database = await runtime.getD1Database("MealPlannerDatabase");
    const evidence = JSON.stringify([
      {
        kind: "original_media",
        referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/original.mp4`,
      },
      {
        kind: "acquisition_manifest",
        referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/manifest.json`,
      },
    ]);
    await database
      .prepare(
        `INSERT INTO recipe_imports (
           acquisition_generation, canonical_source_id,
           compatibility_fingerprint, created_at,
           evidence_references_json, id, recovery_action, source_kind,
           status, status_code, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'tiktok_video', 'acquired', NULL, ?)`
      )
      .bind(
        generation,
        "canonical-gaia-187-native-poisoned-recovery",
        "e".repeat(64),
        now,
        evidence,
        importId,
        now
      )
      .run();
    await database
      .prepare(
        `INSERT INTO import_transcriptions (
           import_id, acquisition_generation, dispatch_id,
           source_media_sha256, state, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'dispatching', ?, ?)`
      )
      .bind(importId, generation, originalDispatchId, "d".repeat(64), now, now)
      .run();

    await expect(
      runWorkflow(instanceId, {
        importId,
        scenario: "speech_terminal_recovery_poison",
      })
    ).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: "speech",
      },
      status: "complete",
    });
    await expect(
      settleSpeechTerminal(instanceId, importId, originalDispatchId)
    ).resolves.toMatchObject({
      dispatchId: originalDispatchId,
      outcome: "terminal_unknown_cost_settled",
    });
    await expect(
      prepareSpeechRecovery(instanceId, importId)
    ).resolves.toMatchObject({
      originalDispatchId,
      recoveryDispatchId,
    });

    await expect(restartFromSpeechProvider(instanceId)).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: "speech",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "provider-calls")).toBe(2);
    await expect(
      database
        .prepare(
          `SELECT poison_dispatch_id, state
             FROM pilot_provider_stage_budget
            WHERE runtime_stage = 'pilot-gaia-118'`
        )
        .first()
    ).resolves.toEqual({
      poison_dispatch_id: recoveryDispatchId,
      state: "poisoned",
    });
    await expect(
      prepareSpeechRecovery(instanceId, importId)
    ).resolves.toMatchObject({
      originalDispatchId,
      recoveryDispatchId,
    });

    await expect(restartFromSpeechProvider(instanceId)).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: "speech",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "acquisition-calls")).toBe(1);
    expect(await readNumber(instanceId, "provider-calls")).toBe(2);
    await expect(
      database
        .prepare(
          `SELECT ownership_id
             FROM import_provider_terminal_checkpoints
            WHERE import_id = ? AND acquisition_generation = ?
              AND provider_stage = 'speech'
            ORDER BY ownership_id`
        )
        .bind(importId, 1)
        .all()
    ).resolves.toMatchObject({
      results: [
        { ownership_id: originalDispatchId },
        { ownership_id: recoveryDispatchId },
      ],
    });
    await expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM pilot_provider_budget_dispatches
            WHERE runtime_stage = 'pilot-gaia-118'
              AND dispatch_id LIKE '%:recovery:1:recovery:1'`
        )
        .first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM pilot_provider_speech_recoveries
            WHERE runtime_stage = 'pilot-gaia-118'
              AND original_dispatch_id = ?`
        )
        .bind(recoveryDispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });

    await expect(
      settleSpeechTerminal(instanceId, importId, recoveryDispatchId)
    ).resolves.toMatchObject({
      dispatchId: recoveryDispatchId,
      outcome: "terminal_unknown_cost_settled",
    });
  });

  it("uses the installed speech adapter and real ledger to fence an ambiguous retry and replay", async () => {
    const instanceId = "gaia-163-native-unknown-poison";
    const database = await runtime.getD1Database("MealPlannerDatabase");
    const stageBefore = await database
      .prepare(
        `SELECT settled_micro_usd
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      )
      .first<{ readonly settled_micro_usd: number }>();
    const dispatchesBefore = await database
      .prepare("SELECT COUNT(*) AS count FROM pilot_provider_budget_dispatches")
      .first<{ readonly count: number }>();
    if (stageBefore === null || dispatchesBefore === null) {
      throw new Error("Pilot provider budget baseline is missing");
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
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
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
          FROM pilot_provider_budget_dispatches
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
        .prepare(
          "SELECT COUNT(*) AS count FROM pilot_provider_budget_dispatches"
        )
        .first()
    ).resolves.toEqual({ count: dispatchesBefore.count + 1 });
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
});
