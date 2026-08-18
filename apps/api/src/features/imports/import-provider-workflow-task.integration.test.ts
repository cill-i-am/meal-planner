import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import * as Bundle from "alchemy/Bundle";
import { Effect, Schema } from "effect";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotBudgetRunId,
  PilotBudgetTimestamp,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { makeD1ProviderTerminalSettlementService } from "./import-provider-terminal-settlement.js";
import { makeD1ProviderTerminalCheckpointRepository } from "./import-provider-terminal.js";
import { makeD1RecipeRecoveryRepository } from "./import-recipe-recovery.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { seedResolvedTestImportExecution } from "./import.test-fixtures.js";

interface ProviderWorkflowInput {
  readonly failureCode?: string;
  readonly importId?: string;
  readonly scenario:
    | "retry_exhausted"
    | "recipe_conservative_crash_replay"
    | "recipe_conservative_success"
    | "recipe_recovery_loop_bounded"
    | "recipe_recovery_loop_non_retryable"
    | "recipe_recovery_loop_reconciliation_wait"
    | "recipe_recovery_loop_success"
    | "recipe_recovery_native_replay"
    | "speech_terminal_recovery"
    | "speech_terminal_recovery_poison"
    | "success"
    | "terminal"
    | "unknown"
    | "visual_terminal_recovery";
}

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const fixturePath = fileURLToPath(
  new URL("import-provider-workflow-task.test-fixture.ts", import.meta.url)
);
const temporaryDirectories: string[] = [];
let runtime: Miniflare;
const decodeImportId = Schema.decodeUnknownSync(ImportId);
const decodeCanonicalId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodeGeneration = Schema.decodeUnknownSync(AcquisitionGeneration);
const decodeImportTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const decodeBudgetTimestamp = Schema.decodeUnknownSync(PilotBudgetTimestamp);
const decodeRunId = Schema.decodeUnknownSync(PilotBudgetRunId);
const decodeStageId = Schema.decodeUnknownSync(PilotBudgetProviderStageId);
const decodeDispatchId = Schema.decodeUnknownSync(PilotBudgetDispatchId);

const buildFixture = async (outputDirectory: string) => {
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
  return Schema.is(Schema.String)(content)
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

const prepareRecipeRecovery = async (importIdValue: string) => {
  const database = await runtime.getD1Database("MealPlannerDatabase");
  const importId = decodeImportId(importIdValue);
  const generation = decodeGeneration(1);
  const now = "2026-07-30T00:00:00.000Z";
  const sourceSha256 = "a".repeat(64);
  const transcriptSha256 = "b".repeat(64);
  const visualManifestSha256 = "c".repeat(64);
  const evidenceFingerprint = "e".repeat(64);
  const extractionFingerprint = "f".repeat(64);
  const dispatchId = decodeDispatchId(
    `recipe:${importId}:${generation}:${evidenceFingerprint}`
  );
  const evidence = [
    {
      kind: "original_media",
      referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/original.mp4`,
    },
    {
      kind: "acquisition_manifest",
      referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/manifest.json`,
    },
    {
      kind: "speech_transcript",
      referenceId: `imports/${importId}/transcription/v1/generations/${generation}/transcript.json`,
    },
  ] as const;
  await seedResolvedTestImportExecution({
    acquisitionGeneration: generation,
    canonicalId: decodeCanonicalId(`recovery-canonical-${importId}`),
    database,
    evidence,
    importId,
    status: { kind: "transcribed" },
    updatedAt: decodeImportTimestamp(now),
  });
  await database.batch([
    database
      .prepare(
        `INSERT INTO import_transcriptions (
           import_id, acquisition_generation, dispatch_id,
           source_media_sha256, state, transcript_key, transcript_sha256,
           provider, model, detected_language, usage_audio_milliseconds,
           usage_input_bytes, estimated_cost_micro_usd, cost_currency,
           cost_certainty, segments_count, failure_code, created_at,
           updated_at, completed_at
         ) VALUES (
           ?, ?, ?, ?, 'transcribed', ?, ?,
           'cloudflare-workers-ai', 'speech-model', 'en', 1000, 100, 1,
           'USD', 'known', 1, NULL, ?, ?, ?
         )`
      )
      .bind(
        importId,
        generation,
        `speech:${importId}:${generation}`,
        sourceSha256,
        `imports/${importId}/transcription/v1/generations/${generation}/transcript.json`,
        transcriptSha256,
        now,
        now,
        now
      ),
    database
      .prepare(
        `INSERT INTO import_visual_evidence (
           import_id, acquisition_generation, dispatch_id,
           source_media_sha256, state, outcome, manifest_key, manifest_sha256,
           provider, model, input_frames, input_bytes, model_calls,
           estimated_cost_micro_usd, cost_currency, cost_certainty,
           observations_count, failure_code, created_at, updated_at,
           completed_at
         ) VALUES (
           ?, ?, ?, ?, 'completed', 'found', ?, ?,
           'cloudflare-workers-ai', 'visual-model', 1, 100, 1, 1, 'USD',
           'known', 1, NULL, ?, ?, ?
         )`
      )
      .bind(
        importId,
        generation,
        `visual:${importId}:${generation}:evidence`,
        sourceSha256,
        `imports/${importId}/visual/v1/generations/${generation}/manifest.json`,
        visualManifestSha256,
        now,
        now,
        now
      ),
    database
      .prepare(
        `INSERT INTO import_recipe_extractions (
           extraction_fingerprint, import_id, acquisition_generation,
           evidence_fingerprint, extractor_provider, extractor_model,
           extractor_version, state, created_at, updated_at
         ) VALUES (
           ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
           'installed-v1', 'dispatching', ?, ?
         )`
      )
      .bind(
        extractionFingerprint,
        importId,
        generation,
        evidenceFingerprint,
        now,
        now
      ),
  ]);

  const budget = makeD1PilotProviderBudgetRepository(
    database,
    "pilot-gaia-118"
  );
  const runId = decodeRunId(`gaia-118:${importId}`);
  const settleSibling = async (
    siblingDispatchId: typeof PilotBudgetDispatchId.Type,
    providerStageId: typeof PilotBudgetProviderStageId.Type
  ) => {
    const reservation = {
      dispatchId: siblingDispatchId,
      maximumCostMicroUsd: 1,
      providerStageId,
      runId,
      timestamp: decodeBudgetTimestamp(now),
    };
    await Effect.runPromise(budget.reserve(reservation));
    await Effect.runPromise(budget.beginInvocation(reservation));
    await Effect.runPromise(
      budget.settleKnown({ ...reservation, actualCostMicroUsd: 0 })
    );
  };
  await settleSibling(
    decodeDispatchId(`speech:${importId}:${generation}`),
    decodeStageId("speech-transcription")
  );
  await settleSibling(
    decodeDispatchId(`visual:${importId}:${generation}:evidence`),
    decodeStageId("visual-evidence")
  );
  const recipeReservation = {
    dispatchId,
    maximumCostMicroUsd: 100_000,
    providerStageId: decodeStageId("recipe-extraction"),
    runId,
    timestamp: decodeBudgetTimestamp(now),
  };
  await Effect.runPromise(budget.reserve(recipeReservation));
  await Effect.runPromise(budget.beginInvocation(recipeReservation));
  await Effect.runPromise(budget.settleUnknown(recipeReservation));
  await Effect.runPromise(
    makeD1ProviderTerminalCheckpointRepository(database).persist({
      acquisitionGeneration: generation,
      completedAt: decodeImportTimestamp(now),
      failureCode: "outcome_unknown",
      importId,
      providerStage: "recipe",
    })
  );
  await Effect.runPromise(
    makeD1ProviderTerminalSettlementService({
      database,
      now: () => decodeImportTimestamp("2026-07-30T00:01:00.000Z"),
      runtimeStage: "pilot-gaia-118",
    }).settle({
      acquisitionGeneration: generation,
      dispatchId,
      importId,
      operation: "settle_recipe_unknown",
    })
  );
  const recovery = await Effect.runPromise(
    makeD1RecipeRecoveryRepository(
      database,
      "pilot-gaia-118"
    ).prepareNextAttempt({
      acquisitionGeneration: generation,
      createdAt: decodeImportTimestamp("2026-07-30T00:02:00.000Z"),
      importId,
      predecessorDispatchId: dispatchId,
    })
  );
  return { database, recovery };
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
        readonly action: "activate-speech";
        readonly authorization?: string;
        readonly dispatchId: string;
        readonly id: string;
        readonly importId: string;
      }
    | {
        readonly action: "interleave-stage";
        readonly id: string;
      }
    | {
        readonly action: "prepare-visual";
        readonly authorization?: string;
        readonly dispatchId: string;
        readonly id: string;
        readonly importId: string;
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

const runVisualRecipeBudget = (id: string) =>
  commandWorkflow({ action: "run-visual-recipe-budget", id });

const restartFromAfterProviderCheckpoint = (id: string) =>
  commandWorkflow({ action: "restart", id });

const restartFromTerminalPersistence = (id: string) =>
  commandWorkflow({ action: "restart-terminal", id });

const prepareSpeechRecovery = (id: string, importId: string) =>
  commandWorkflow({ action: "prepare-speech", id, importId });

const activateSpeechRecovery = (
  id: string,
  importId: string,
  dispatchId: string
) =>
  commandWorkflow({
    action: "activate-speech",
    authorization: "Bearer test-import-token",
    dispatchId,
    id,
    importId,
  });

const interleaveKnownZeroStageDispatch = (id: string) =>
  commandWorkflow({ action: "interleave-stage", id });

const restartFromSpeechProvider = (id: string) =>
  commandWorkflow({ action: "restart-speech", id });

const restartFromVisualEvidence = (id: string) =>
  commandWorkflow({ action: "restart-visual", id });

const prepareVisualRecoveryResponse = (
  id: string,
  importId: string,
  dispatchId: string,
  authorization?: string
) =>
  runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      action: "prepare-visual",
      authorization,
      dispatchId,
      id,
      importId,
    }),
    method: "POST",
  });

const prepareVisualRecovery = async (
  id: string,
  importId: string,
  dispatchId: string
) => {
  const response = await prepareVisualRecoveryResponse(
    id,
    importId,
    dispatchId,
    "Bearer test-import-token"
  );
  const responseText = await response.text();
  expect(response.status, responseText).toBe(200);
  return JSON.parse(responseText) as unknown;
};

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
    const importId = "00000000-0000-4000-8000-000000000181";
    const instanceId = `import-acquisition-${importId}`;
    const generation = 1;
    const originalDispatchId = `speech:${importId}:${generation}`;
    const recoveryDispatchId = `${originalDispatchId}:recovery:1`;
    const now = "2026-07-27T09:10:00.000Z";
    const database = await runtime.getD1Database("MealPlannerDatabase");
    const evidence = [
      {
        kind: "original_media",
        referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/original.mp4`,
      },
      {
        kind: "acquisition_manifest",
        referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/manifest.json`,
      },
    ] as const;
    await seedResolvedTestImportExecution({
      acquisitionGeneration: decodeGeneration(generation),
      canonicalId: decodeCanonicalId("canonical-gaia-178-native-recovery"),
      database,
      evidence,
      importId: decodeImportId(importId),
      status: { kind: "acquired" },
      updatedAt: decodeImportTimestamp(now),
    });
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

    await expect(interleaveKnownZeroStageDispatch(instanceId)).resolves.toEqual(
      {
        outcome: "settled_known_zero",
      }
    );
    const expectedActivation = {
      activation: {
        acquisitionGeneration: generation,
        dispatchId: originalDispatchId,
        importId,
        outcome: "speech_recovery_activated",
        recoveryDispatchId,
      },
      workflow: {
        output: {
          _tag: "Succeeded",
          evidence: "safe-transcript",
          stage: "speech",
        },
        status: "complete",
      },
    };
    const [activation, concurrentReplay] = await Promise.all([
      activateSpeechRecovery(instanceId, importId, originalDispatchId),
      activateSpeechRecovery(instanceId, importId, originalDispatchId),
    ]);
    expect(activation).toMatchObject(expectedActivation);
    expect(concurrentReplay).toMatchObject(expectedActivation);
    await expect(
      activateSpeechRecovery(instanceId, importId, originalDispatchId)
    ).resolves.toMatchObject(expectedActivation);
    expect(await readNumber(instanceId, "acquisition-calls")).toBe(1);
    expect(await readNumber(instanceId, "record-acquisition-calls")).toBe(2);
    expect(await readNumber(instanceId, "provider-calls")).toBe(2);
    expect(await readNumber(instanceId, "visual-calls")).toBe(1);
    await expect(
      readText(instanceId, "visual-speech-dispatch-id")
    ).resolves.toBe(recoveryDispatchId);
    await expect(readText(instanceId, "visual-dispatch-id")).resolves.toBe(
      `visual:${importId}:${generation}`
    );
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
    await expect(readText(instanceId, "visual-dispatch-id")).resolves.toBe(
      `visual:${importId}:${generation}`
    );
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
  }, 30_000);

  it("replays one poisoned recovery identity without invoking the provider or nesting recovery", async () => {
    const instanceId = "gaia-187-native-poisoned-speech-recovery";
    const importId = "00000000-0000-4000-8000-000000000188";
    const generation = 1;
    const originalDispatchId = `speech:${importId}:${generation}`;
    const recoveryDispatchId = `${originalDispatchId}:recovery:1`;
    const now = "2026-07-27T09:20:00.000Z";
    const database = await runtime.getD1Database("MealPlannerDatabase");
    const evidence = [
      {
        kind: "original_media",
        referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/original.mp4`,
      },
      {
        kind: "acquisition_manifest",
        referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/manifest.json`,
      },
    ] as const;
    await seedResolvedTestImportExecution({
      acquisitionGeneration: decodeGeneration(generation),
      canonicalId: decodeCanonicalId(
        "canonical-gaia-187-native-poisoned-recovery"
      ),
      database,
      evidence,
      importId: decodeImportId(importId),
      status: { kind: "acquired" },
      updatedAt: decodeImportTimestamp(now),
    });
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

  it("authenticates one visual recovery and replays native visual and recipe tasks exactly once", async () => {
    const instanceId = "gaia-200-native-visual-terminal-recovery";
    const importId = "00000000-0000-4000-8000-000000000200";
    const generation = 1;
    const originalDispatchId = `visual:${importId}:${generation}`;
    const recoveryDispatchId = `${originalDispatchId}:recovery:1`;
    const recipeDispatchId = `recipe:${importId}:${generation}:gaia-200-evidence`;
    const speechDispatchId = `speech:${importId}:${generation}`;
    const now = "2026-07-29T10:00:00.000Z";
    const completedAt = "2026-07-29T10:02:00.000Z";
    const checkpointCompletedAt = "2026-07-29T10:02:00.962Z";
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
    const evidence = [
      {
        kind: "original_media",
        referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/original.mp4`,
      },
      {
        kind: "acquisition_manifest",
        referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/manifest.json`,
      },
      {
        kind: "speech_transcript",
        referenceId: `imports/${importId}/transcription/v1/generations/${generation}/transcript.json`,
      },
    ] as const;

    await seedResolvedTestImportExecution({
      acquisitionGeneration: decodeGeneration(generation),
      canonicalId: decodeCanonicalId(
        "canonical-gaia-200-native-visual-recovery"
      ),
      database,
      evidence,
      importId: decodeImportId(importId),
      status: { kind: "transcribed" },
      updatedAt: decodeImportTimestamp(completedAt),
    });

    await database.batch([
      database.prepare(
        `UPDATE pilot_provider_stage_budget
            SET reserved_micro_usd = 0,
                state = 'open',
                invoking_dispatch_id = NULL,
                poison_dispatch_id = NULL
          WHERE runtime_stage = 'pilot-gaia-118'`
      ),
      database
        .prepare(
          `INSERT INTO import_transcriptions (
             import_id, acquisition_generation, dispatch_id,
             source_media_sha256, state, transcript_key, transcript_sha256,
             provider, model, detected_language, usage_audio_milliseconds,
             usage_input_bytes, estimated_cost_micro_usd, cost_currency,
             cost_certainty, segments_count, failure_code, created_at,
             updated_at, completed_at
           ) VALUES (?, ?, ?, ?, 'transcribed', ?, ?, ?, ?, 'en', 1000, 3,
                     10, 'USD', 'known', 1, NULL, ?, ?, ?)`
        )
        .bind(
          importId,
          generation,
          speechDispatchId,
          "b".repeat(64),
          `imports/${importId}/transcription/v1/generations/${generation}/transcript.json`,
          "c".repeat(64),
          "installed-test-provider",
          "installed-test-model",
          now,
          completedAt,
          completedAt
        ),
      database
        .prepare(
          `INSERT INTO import_visual_evidence (
             import_id, acquisition_generation, dispatch_id,
             source_media_sha256, state, failure_code, created_at,
             updated_at, completed_at
           ) VALUES (?, ?, ?, ?, 'failed', 'outcome_unknown', ?, ?, ?)`
        )
        .bind(
          importId,
          generation,
          originalDispatchId,
          "b".repeat(64),
          now,
          completedAt,
          completedAt
        ),
      database
        .prepare(
          `INSERT INTO import_provider_terminal_checkpoints (
             import_id, acquisition_generation, provider_stage, ownership_id,
             failure_code, completed_at, created_at
           ) VALUES (?, ?, 'visual', ?, 'visual_extraction_failed', ?, ?)`
        )
        .bind(
          importId,
          generation,
          originalDispatchId,
          checkpointCompletedAt,
          checkpointCompletedAt
        ),
      database
        .prepare(
          `INSERT INTO pilot_provider_budget_dispatches (
             runtime_stage, dispatch_id, run_id, provider_stage_id,
             maximum_cost_micro_usd, actual_cost_micro_usd, state,
             created_at, updated_at, invocation_started_at, completed_at
           ) VALUES (
             'pilot-gaia-118', ?, 'gaia-200:visual-terminal-recovery',
             'visual-evidence', 100000, NULL, 'settled_unknown', ?, ?, ?, ?
           )`
        )
        .bind(originalDispatchId, now, completedAt, now, completedAt),
      database
        .prepare(
          `INSERT INTO pilot_provider_budget_reconciliations (
             runtime_stage, dispatch_id, conservative_charge_micro_usd,
             actual_cost_was_unknown, authority, created_at
           ) VALUES (
             'pilot-gaia-118', ?, 100000, 1, 'authenticated_operator', ?
           )`
        )
        .bind(originalDispatchId, completedAt),
      database.prepare(
        `UPDATE pilot_provider_stage_budget
            SET settled_micro_usd = settled_micro_usd + 100000,
                reserved_micro_usd = 0,
                state = 'open',
                invoking_dispatch_id = NULL,
                poison_dispatch_id = NULL,
                updated_at = '${completedAt}'
          WHERE runtime_stage = 'pilot-gaia-118'`
      ),
    ]);

    await expect(
      runWorkflow(instanceId, {
        importId,
        scenario: "visual_terminal_recovery",
      })
    ).resolves.toMatchObject({
      output: {
        _tag: "Failed",
        code: "visual_extraction_failed",
        stage: "visual",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "acquisition-calls")).toBe(1);
    expect(await readNumber(instanceId, "speech-calls")).toBe(1);
    expect(await readNumber(instanceId, "visual-provider-calls")).toBe(0);
    expect(await readNumber(instanceId, "recipe-provider-calls")).toBe(0);

    await database
      .prepare(
        `UPDATE pilot_provider_stage_budget
            SET reserved_micro_usd = 1
          WHERE runtime_stage = 'pilot-gaia-118'`
      )
      .run();
    const driftResponse = await prepareVisualRecoveryResponse(
      instanceId,
      importId,
      originalDispatchId,
      "Bearer test-import-token"
    );
    expect(driftResponse.status).not.toBe(200);
    await database
      .prepare(
        `UPDATE pilot_provider_stage_budget
            SET reserved_micro_usd = 0
          WHERE runtime_stage = 'pilot-gaia-118'`
      )
      .run();
    await expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM pilot_provider_visual_recoveries
            WHERE runtime_stage = 'pilot-gaia-118'`
        )
        .first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      database
        .prepare(
          `SELECT dispatch_id, failure_code, state
             FROM import_visual_evidence
            WHERE import_id = ? AND acquisition_generation = ?`
        )
        .bind(importId, generation)
        .first()
    ).resolves.toEqual({
      dispatch_id: originalDispatchId,
      failure_code: "visual_extraction_failed",
      state: "failed",
    });

    await expect(
      prepareVisualRecovery(instanceId, importId, originalDispatchId)
    ).resolves.toEqual({
      acquisitionGeneration: generation,
      dispatchId: originalDispatchId,
      importId,
      outcome: "visual_recovery_prepared",
      recoveryDispatchId,
      runtimeStage: "pilot-gaia-118",
    });
    await expect(
      database
        .prepare(
          `SELECT import_id, acquisition_generation, original_dispatch_id,
                  recovery_dispatch_id
             FROM pilot_provider_visual_recoveries
            WHERE runtime_stage = 'pilot-gaia-118'
              AND original_dispatch_id = ?`
        )
        .bind(originalDispatchId)
        .first()
    ).resolves.toEqual({
      acquisition_generation: generation,
      import_id: importId,
      original_dispatch_id: originalDispatchId,
      recovery_dispatch_id: recoveryDispatchId,
    });
    await expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM import_visual_evidence
            WHERE import_id = ? AND acquisition_generation = ?`
        )
        .bind(importId, generation)
        .first()
    ).resolves.toEqual({ count: 0 });

    await expect(restartFromVisualEvidence(instanceId)).resolves.toMatchObject({
      output: {
        _tag: "Succeeded",
        evidence: "recipe-dispatched",
        stage: "recipe",
      },
      status: "complete",
    });
    expect(await readNumber(instanceId, "acquisition-calls")).toBe(1);
    expect(await readNumber(instanceId, "speech-calls")).toBe(1);
    expect(await readNumber(instanceId, "visual-provider-calls")).toBe(1);
    expect(await readNumber(instanceId, "recipe-provider-calls")).toBe(1);
    await expect(
      database
        .prepare(
          `SELECT dispatch_id, estimated_cost_micro_usd, observations_count,
                  outcome, state
             FROM import_visual_evidence
            WHERE import_id = ? AND acquisition_generation = ?`
        )
        .bind(importId, generation)
        .first()
    ).resolves.toEqual({
      dispatch_id: recoveryDispatchId,
      estimated_cost_micro_usd: 100_000,
      observations_count: 0,
      outcome: "empty",
      state: "completed",
    });
    await expect(
      database
        .prepare(
          `SELECT actual_cost_micro_usd, dispatch_id,
                  maximum_cost_micro_usd, provider_stage_id, state
             FROM pilot_provider_budget_dispatches
            WHERE runtime_stage = 'pilot-gaia-118'
              AND dispatch_id IN (?, ?, ?)
            ORDER BY dispatch_id`
        )
        .bind(originalDispatchId, recoveryDispatchId, recipeDispatchId)
        .all()
    ).resolves.toMatchObject({
      results: expect.arrayContaining([
        {
          actual_cost_micro_usd: null,
          dispatch_id: originalDispatchId,
          maximum_cost_micro_usd: 100_000,
          provider_stage_id: "visual-evidence",
          state: "settled_unknown",
        },
        {
          actual_cost_micro_usd: 100_000,
          dispatch_id: recoveryDispatchId,
          maximum_cost_micro_usd: 100_000,
          provider_stage_id: "visual-evidence",
          state: "settled_known",
        },
        {
          actual_cost_micro_usd: 29,
          dispatch_id: recipeDispatchId,
          maximum_cost_micro_usd: 100_000,
          provider_stage_id: "recipe-extraction",
          state: "settled_known",
        },
      ]),
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
      settled_micro_usd: stageBefore.settled_micro_usd + 200_029,
      state: "open",
    });

    await expect(restartFromVisualEvidence(instanceId)).resolves.toMatchObject({
      output: {
        _tag: "Succeeded",
        evidence: "recipe-dispatched",
        stage: "recipe",
      },
      status: "complete",
    });
    await expect(
      prepareVisualRecovery(instanceId, importId, originalDispatchId)
    ).resolves.toEqual({
      acquisitionGeneration: generation,
      dispatchId: originalDispatchId,
      importId,
      outcome: "visual_recovery_prepared",
      recoveryDispatchId,
      runtimeStage: "pilot-gaia-118",
    });
    expect(await readNumber(instanceId, "acquisition-calls")).toBe(1);
    expect(await readNumber(instanceId, "speech-calls")).toBe(1);
    expect(await readNumber(instanceId, "visual-provider-calls")).toBe(1);
    expect(await readNumber(instanceId, "recipe-provider-calls")).toBe(1);
    await expect(
      database
        .prepare(
          `SELECT dispatch_id, state
             FROM import_transcriptions
            WHERE import_id = ? AND acquisition_generation = ?`
        )
        .bind(importId, generation)
        .first()
    ).resolves.toEqual({
      dispatch_id: speechDispatchId,
      state: "transcribed",
    });
  });

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

  it("retries and replays the recipe recovery native task without another provider call", async () => {
    const instanceId = `gaia-207-recipe-recovery-${randomUUID()}`;
    const importId = randomUUID();
    const { database, recovery } = await prepareRecipeRecovery(importId);
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

    await expect(
      runWorkflow(instanceId, {
        importId,
        scenario: "recipe_recovery_native_replay",
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
      readText(instanceId, "recipe-recovery-extraction-task")
    ).resolves.toBe("extract-recipe-recovery-v1");
    await expect(
      readText(instanceId, "recipe-recovery-terminal-task")
    ).resolves.toBe("persist-recipe-recovery-terminal-v1");
    await expect(
      database
        .prepare(
          `SELECT actual_cost_micro_usd, dispatch_id,
                  maximum_cost_micro_usd, provider_stage_id, run_id, state
             FROM pilot_provider_budget_dispatches
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
        .bind(recovery.currentDispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_micro_usd: null,
      dispatch_id: recovery.currentDispatchId,
      maximum_cost_micro_usd: 100_000,
      provider_stage_id: "recipe-extraction",
      run_id: `gaia-118:recipe-recovery:${importId}`,
      state: "settled_unknown",
    });
    await expect(
      database
        .prepare(
          `SELECT authority, conservative_charge_micro_usd
             FROM pilot_provider_budget_conservative_settlements
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
        .bind(recovery.currentDispatchId)
        .first()
    ).resolves.toEqual({
      authority: "schema_valid_provider_response",
      conservative_charge_micro_usd: 100_000,
    });
    await expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM pilot_provider_recipe_replay_values
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
        .bind(recovery.currentDispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
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
    await expect(
      database
        .prepare(
          `SELECT count(*) AS attempt_count
             FROM pilot_provider_recipe_recovery_attempts
            WHERE import_id = ? AND acquisition_generation = 1`
        )
        .bind(importId)
        .first()
    ).resolves.toEqual({ attempt_count: 1 });
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

  it("persists a conservative installed recipe result and replays its native task without another provider call", async () => {
    const instanceId = `gaia-205-recipe-conservative-${randomUUID()}`;
    const importId = randomUUID();
    const dispatchId = `recipe:${importId}:1:${"e".repeat(64)}`;
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
             FROM pilot_provider_budget_dispatches
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_micro_usd: null,
      dispatch_id: dispatchId,
      maximum_cost_micro_usd: 100_000,
      provider_stage_id: "recipe-extraction",
      run_id: `gaia-118:${importId}`,
      state: "settled_unknown",
    });
    await expect(
      database
        .prepare(
          `SELECT authority, conservative_charge_micro_usd
             FROM pilot_provider_budget_conservative_settlements
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
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
             FROM pilot_provider_stage_budget
            WHERE runtime_stage = 'pilot-gaia-118'`
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
             FROM pilot_provider_budget_conservative_settlements
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      database
        .prepare(
          `SELECT reserved_micro_usd, settled_micro_usd, state
             FROM pilot_provider_stage_budget
            WHERE runtime_stage = 'pilot-gaia-118'`
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
             FROM pilot_provider_budget_conservative_settlements
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM pilot_provider_recipe_replay_values
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
        .bind(dispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
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
