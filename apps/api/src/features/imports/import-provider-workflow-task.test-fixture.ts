import { RuntimeContext } from "alchemy";
import {
  WorkflowEvent,
  makeWorkflowBridge,
  task,
  waitForEvent,
} from "alchemy/Cloudflare/Workflows";
import type { WorkflowInstanceRestartOptions } from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  PilotProviderBudgetStage,
  PilotProviderBudgetRuntime,
  makePilotProviderBudgetRuntime,
  pilotProviderKnownZeroCostFailure,
  runPilotProviderDispatch,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import { ImportCorrelationId } from "./import-observability.js";
import { continueVisualFromSettledSpeech } from "./import-post-speech-visual.js";
import { makeVisualTransport } from "./import-provider-adapters.test-fixture.js";
import type { WorkersAiTransport } from "./import-provider-kernel.js";
import {
  InstalledRecipeModel,
  InstalledSpeechModel,
  makePilotProviderDispatchGate,
} from "./import-provider-kernel.js";
import { makeInstalledRecipeExtractor } from "./import-provider-recipe.js";
import { makeInstalledSpeechTranscriber } from "./import-provider-speech.js";
import { makeD1ProviderTerminalSettlementService } from "./import-provider-terminal-settlement.js";
import {
  makeD1ProviderTerminalCheckpointRepository,
  makeD1ProviderTerminalRecoveryRepository,
} from "./import-provider-terminal.js";
import { makeInstalledVisualEvidenceExtractor } from "./import-provider-visual.js";
import type { ProviderTaskCheckpoint } from "./import-provider-workflow-checkpoint.js";
import type { ProviderTaskStage } from "./import-provider-workflow-task.js";
import { runProviderTask } from "./import-provider-workflow-task.js";
import type { RecipeEvidenceAssembly } from "./import-recipe-extractor.js";
import {
  RecipeRecoveryAuthorization,
  recipeRecoveryAuthorizationEventType,
  recipeRecoveryDurableTaskNames,
} from "./import-recipe-recovery.js";
import type {
  RecipeRecoveryAttempt,
  RecipeRecoveryOrdinal,
} from "./import-recipe-recovery.js";
import { runRecipeRecoveryLoop } from "./import-runtime-composition.js";
import { makeD1VisualEvidenceRepository } from "./import-visual-evidence.repository.d1.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import { makeTestSystemAuthorizer } from "./import.test-fixtures.js";
import { makeImportWorkflowStarter } from "./import.workflow.js";

const ProviderWorkflowInput = Schema.Struct({
  failureCode: Schema.optionalKey(Schema.String),
  importId: Schema.optionalKey(Schema.String),
  scenario: Schema.Literals([
    "retry_exhausted",
    "recipe_conservative_crash_replay",
    "recipe_conservative_success",
    "recipe_recovery_loop_bounded",
    "recipe_recovery_loop_non_retryable",
    "recipe_recovery_loop_reconciliation_wait",
    "recipe_recovery_loop_success",
    "recipe_recovery_native_replay",
    "speech_terminal_recovery",
    "speech_terminal_recovery_poison",
    "success",
    "terminal",
    "unknown",
    "visual_terminal_recovery",
  ]),
});
type ProviderWorkflowInput = typeof ProviderWorkflowInput.Type;

interface ProviderWorkflowTestEnv {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly PROVIDER_WORKFLOW_STATE: {
    readonly get: (key: string) => Promise<string | null>;
    readonly put: (key: string, value: string) => Promise<void>;
  };
  readonly ProviderRetryWorkflow: {
    readonly create: (options: {
      readonly id: string;
      readonly params: Schema.Json;
    }) => Promise<void>;
    readonly get: (id: string) => Promise<{
      readonly restart: (
        options: WorkflowInstanceRestartOptions
      ) => Promise<void>;
      readonly status: () => Promise<Schema.Json>;
    }>;
    readonly unsafeSetIntrospectionOperations: (
      sessionId: string,
      operations: readonly Schema.Json[]
    ) => Promise<void>;
    readonly unsafeStartIntrospection: () => Promise<string>;
    readonly unsafeStopIntrospection: (sessionId: string) => Promise<void>;
    readonly unsafeWaitForStatus: (
      id: string,
      status: "complete" | "errored"
    ) => Promise<void>;
  };
}

const decodeRunId = Schema.decodeUnknownSync(PilotBudgetRunId);
const decodeProviderStageId = Schema.decodeUnknownSync(
  PilotBudgetProviderStageId
);
const testRuntimeContext = RuntimeContext.of({
  Type: "TestRuntimeContext",
  env: {},
  get: <T>() =>
    // eslint-disable-next-line unicorn/no-useless-undefined -- The Alchemy runtime contract explicitly represents a missing binding with undefined.
    Effect.succeed<T | undefined>(undefined),
  id: "installed-provider-workflow-test",
  set: (id) => Effect.succeed(id),
});
const decodeDispatchId = Schema.decodeUnknownSync(PilotBudgetDispatchId);
const decodeTimestamp = Schema.decodeUnknownSync(PilotBudgetTimestamp);
const decodeGeneration = Schema.decodeUnknownSync(AcquisitionGeneration);
const decodeImportId = Schema.decodeUnknownSync(ImportId);
const decodeImportTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const decodeCorrelationId = Schema.decodeUnknownSync(ImportCorrelationId);
const decodeSha256 = Schema.decodeUnknownSync(Sha256Hex);

const stateKey = (instanceId: string, name: string) => `${instanceId}:${name}`;

const increment = (
  env: ProviderWorkflowTestEnv,
  instanceId: string,
  name: string
) =>
  Effect.promise(async () => {
    const key = stateKey(instanceId, name);
    const value = Number((await env.PROVIDER_WORKFLOW_STATE.get(key)) ?? "0");
    await env.PROVIDER_WORKFLOW_STATE.put(key, String(value + 1));
  });

const readNumber = (
  env: ProviderWorkflowTestEnv,
  instanceId: string,
  name: string
) =>
  Effect.promise(async () =>
    Number(
      (await env.PROVIDER_WORKFLOW_STATE.get(stateKey(instanceId, name))) ?? "0"
    )
  );

const waitForNumber = async (
  env: ProviderWorkflowTestEnv,
  instanceId: string,
  name: string,
  expected: number,
  attempt = 0
) => {
  if (attempt >= 200) {
    throw new Error(`Timed out waiting for ${name}`);
  }
  const value = Number(
    (await env.PROVIDER_WORKFLOW_STATE.get(stateKey(instanceId, name))) ?? "0"
  );
  if (value >= expected) {
    return;
  }
  await Effect.runPromise(Effect.sleep(10));
  return waitForNumber(env, instanceId, name, expected, attempt + 1);
};

const nativeRecipeRecoveryAttempt = (
  importId: ImportId,
  ordinal: RecipeRecoveryOrdinal
): RecipeRecoveryAttempt => {
  const generation = decodeGeneration(1);
  const evidenceFingerprint = decodeSha256("e".repeat(64));
  const rootDispatchId = decodeDispatchId(
    `recipe:${importId}:${generation}:${evidenceFingerprint}`
  );
  const rootExtractionFingerprint = decodeSha256("f".repeat(64));
  return {
    acquisitionGeneration: generation,
    createdAt: decodeImportTimestamp("2026-08-16T00:00:00.000Z"),
    currentDispatchId: decodeDispatchId(
      `${rootDispatchId}:recovery:${ordinal}`
    ),
    currentExtractionFingerprint: decodeSha256(String(ordinal).repeat(64)),
    evidenceFingerprint,
    evidenceReferencesJson: JSON.stringify(["source", "transcript", "visual"]),
    importId,
    ordinal,
    predecessorDispatchId: decodeDispatchId(
      ordinal === 1
        ? rootDispatchId
        : `${rootDispatchId}:recovery:${ordinal - 1}`
    ),
    predecessorExtractionFingerprint:
      ordinal === 1
        ? rootExtractionFingerprint
        : decodeSha256(String(ordinal - 1).repeat(64)),
    predecessorOutcome: "outcome_unknown",
    predecessorReconciliationCreatedAt: decodeImportTimestamp(
      "2026-08-16T00:00:00.000Z"
    ),
    rootDispatchId,
    rootExtractionFingerprint,
    runtimeStage: PilotProviderBudgetStage,
    sourceMediaSha256: decodeSha256("a".repeat(64)),
    terminalCheckpointCompletedAt: decodeImportTimestamp(
      "2026-08-16T00:00:00.000Z"
    ),
    transcriptSha256: decodeSha256("b".repeat(64)),
    visualManifestSha256: decodeSha256("c".repeat(64)),
  };
};

const emptyRecipeProviderSelection = {
  category: null,
  cookTimeMinutes: null,
  cuisine: null,
  description: null,
  ingredientLines: [],
  instructions: [],
  name: null,
  nutrition: null,
  prepTimeMinutes: null,
  supportedClaims: [],
  temperatureCelsius: null,
  tools: [],
  totalTimeMinutes: null,
  yield: null,
} as const;

const installedRecipeConservativeDispatch = (
  env: ProviderWorkflowTestEnv,
  instanceId: string,
  importId: ImportId,
  crashAfterSettlement: boolean,
  recovery: boolean
) =>
  Effect.gen(function* runInstalledRecipeConservativeDispatch() {
    yield* increment(env, instanceId, "task-attempts");
    const generation = decodeGeneration(1);
    const correlationId = decodeCorrelationId(
      "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2205"
    );
    const repository = makeD1PilotProviderBudgetRepository(
      env.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const dispatchTimestamp = decodeTimestamp(new Date().toISOString());
    const dispatch = makePilotProviderDispatchGate({
      correlationId,
      now: () => dispatchTimestamp,
      repository,
      runId: decodeRunId(
        recovery
          ? `gaia-118:recipe-recovery:${importId}`
          : `gaia-118:${importId}`
      ),
      runtime: makePilotProviderBudgetRuntime("pilot-gaia-118"),
    });
    const transport: WorkersAiTransport["recipe"] = {
      model: InstalledRecipeModel,
      run: async () => {
        await Effect.runPromise(increment(env, instanceId, "provider-calls"));
        return Response.json({ response: emptyRecipeProviderSelection });
      },
    };
    const extractor = yield* makeInstalledRecipeExtractor({
      correlationId,
      dispatch,
      transport,
    });
    const extractionInput: RecipeEvidenceAssembly = {
      evidenceFingerprint: "e".repeat(64),
      generation,
      importId,
      items: [
        {
          artifactReference: "private:evidence",
          evidenceId: "evidence-1",
          kind: "caption",
          origin: "creator_provided",
          value: "visible evidence",
        },
      ],
    };
    const output = yield* extractor.extract(
      recovery
        ? {
            ...extractionInput,
            dispatchId: decodeDispatchId(
              `recipe:${importId}:${generation}:${"e".repeat(64)}:recovery:1`
            ),
          }
        : extractionInput
    );
    yield* increment(env, instanceId, "recipe-adapter-completions");
    if (
      output.cost.certainty !== "estimated" ||
      output.cost.estimatedMicroUsd !== 100_000 ||
      output.usage.inputTokens !== 0 ||
      output.usage.outputTokens !== 0
    ) {
      return yield* Effect.die(
        "Installed recipe adapter did not preserve conservative cost evidence"
      );
    }
    if (
      crashAfterSettlement &&
      (yield* readNumber(env, instanceId, "post-settlement-crashes")) === 0
    ) {
      yield* increment(env, instanceId, "post-settlement-crashes");
      return yield* Effect.die(
        new Error(
          "simulated crash after conservative settlement and before the task checkpoint"
        )
      );
    }
    yield* increment(env, instanceId, "recipe-dispatch-completions");
    return "recipe-conservative-evidence" as const;
  }).pipe(Effect.provideService(RuntimeContext, testRuntimeContext));

const installedSpeechDispatch = (
  env: ProviderWorkflowTestEnv,
  instanceId: string,
  outcome: "ambiguous" | "known_zero"
) =>
  Effect.gen(function* runInstalledSpeechDispatch() {
    yield* increment(env, instanceId, "task-attempts");
    const correlationId = decodeCorrelationId(
      outcome === "known_zero"
        ? "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b86"
        : "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b87"
    );
    const repository = makeD1PilotProviderBudgetRepository(
      env.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const dispatch = makePilotProviderDispatchGate({
      correlationId,
      now: () => decodeTimestamp("2026-07-28T08:00:00.000Z"),
      repository,
      runId: decodeRunId(
        outcome === "known_zero"
          ? "run_gaia_186_known_zero"
          : "run_gaia_186_ambiguous"
      ),
      runtime: makePilotProviderBudgetRuntime("pilot-gaia-118"),
    });
    const transport: WorkersAiTransport["speech"] = {
      model: InstalledSpeechModel,
      run: async () => {
        await Effect.runPromise(increment(env, instanceId, "provider-calls"));
        if (outcome === "known_zero") {
          throw pilotProviderKnownZeroCostFailure("provider_unavailable");
        }
        throw new Error("simulated ambiguous provider interruption");
      },
    };
    const transcriber = yield* makeInstalledSpeechTranscriber({
      correlationId,
      dispatch,
      transport,
    });
    return yield* transcriber.transcribe({
      audio: {
        bytes: new Uint8Array([1, 2, 3]),
        durationMilliseconds: 1000,
        mimeType: "audio/wav",
        sha256: "a".repeat(64),
      },
      dispatchId:
        outcome === "known_zero"
          ? "speech:gaia-186-known-zero:1"
          : "speech:gaia-186-ambiguous:1",
      generation: decodeGeneration(1),
      importId: decodeImportId(
        outcome === "known_zero"
          ? "00000000-0000-4000-8000-000000000186"
          : "00000000-0000-4000-8000-000000000187"
      ),
      sourceMediaSha256: "b".repeat(64),
    });
  });

const runInstalledVisualThenRecipe = (env: ProviderWorkflowTestEnv) =>
  Effect.gen(function* runBudgetedComposition() {
    const responses = [
      Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({
                      observations: [],
                    }),
                    name: "record_visual_evidence",
                  },
                  id: "visual-call-1",
                  type: "function",
                },
              ],
            },
          },
        ],
      }),
    ];
    let providerCalls = 0;
    const transport = makeVisualTransport(
      () => {
        const response = responses.shift();
        if (response === undefined) {
          throw new Error("Unexpected provider dispatch");
        }
        return response;
      },
      () =>
        Effect.runPromise(
          Effect.sync(() => {
            providerCalls += 1;
          })
        )
    );
    const repository = makeD1PilotProviderBudgetRepository(
      env.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const correlationId = decodeCorrelationId(
      "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2199"
    );
    const runId = decodeRunId("gaia-199:missing-visual-usage");
    const now = decodeTimestamp("2026-07-29T09:00:00.000Z");
    const dispatch = makePilotProviderDispatchGate({
      correlationId,
      now: () => now,
      repository,
      runId,
      runtime: makePilotProviderBudgetRuntime("pilot-gaia-118"),
    });
    const visual = yield* makeInstalledVisualEvidenceExtractor({
      correlationId,
      dispatch,
      transport,
    });
    const importId = decodeImportId("00000000-0000-4000-8000-000000000199");
    const generation = decodeGeneration(1);
    const visualOutput = yield* visual
      .extract({
        dispatchId: "visual:gaia-199:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 0,
            width: 1,
          },
        ],
        generation,
        importId,
        sourceMediaSha256: "b".repeat(64),
      })
      .pipe(
        Effect.mapError((error) => new Error(`visual:${JSON.stringify(error)}`))
      );
    const recipeResult = yield* dispatch.run({
      dispatchId: `recipe:${importId}:${generation}:gaia-199-evidence`,
      invoke: Effect.sync(() => {
        providerCalls += 1;
        return {
          cost: {
            _tag: "Known" as const,
            actualCostMicroUsd: 29,
          },
          value: "recipe-dispatched" as const,
        };
      }),
      maximumCostMicroUsd: 100_000,
      providerStage: "recipe",
      providerStageId: "recipe-extraction",
    });
    return {
      providerCalls,
      recipeResult,
      stage: yield* repository.readStage(),
      visualCost: visualOutput.cost,
    };
  }).pipe(Effect.provideService(RuntimeContext, testRuntimeContext));

const visualTerminalRecoveryDispatch = (
  env: ProviderWorkflowTestEnv,
  instanceId: string,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) =>
  Effect.gen(function* runVisualTerminalRecoveryDispatch() {
    const recovery = makeD1ProviderTerminalRecoveryRepository(
      env.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const dispatchId = yield* recovery.visualDispatchId({
      acquisitionGeneration,
      importId,
    });
    const sourceMediaSha256 = "b".repeat(64);
    const visualRepository = makeD1VisualEvidenceRepository(
      env.MealPlannerDatabase
    );
    const claim = yield* visualRepository.claim({
      dispatchId,
      generation: acquisitionGeneration,
      importId,
      sourceMediaSha256,
      startedAt: decodeImportTimestamp("2026-07-29T10:05:00.000Z"),
    });
    if (claim._tag === "Failed") {
      return yield* Effect.fail({ code: claim.code });
    }
    if (claim._tag === "Completed") {
      return "visual-evidence";
    }

    const correlationId = decodeCorrelationId(
      "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2200"
    );
    const budgetRepository = makeD1PilotProviderBudgetRepository(
      env.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const budget = makePilotProviderDispatchGate({
      correlationId,
      now: () => decodeTimestamp("2026-07-29T10:05:00.000Z"),
      repository: budgetRepository,
      runId: decodeRunId("gaia-200:visual-terminal-recovery"),
      runtime: makePilotProviderBudgetRuntime("pilot-gaia-118"),
    });
    const transport = makeVisualTransport(
      () =>
        Response.json({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    function: {
                      arguments: JSON.stringify({
                        observations: [],
                      }),
                      name: "record_visual_evidence",
                    },
                    id: "visual-call-1",
                    type: "function",
                  },
                ],
              },
            },
          ],
        }),
      () =>
        Effect.runPromise(increment(env, instanceId, "visual-provider-calls"))
    );
    const extractor = yield* makeInstalledVisualEvidenceExtractor({
      correlationId,
      dispatch: budget,
      transport,
    });
    const output = yield* extractor.extract({
      dispatchId,
      frames: [
        {
          bytes: new Uint8Array([1, 2, 3]),
          height: 1,
          mimeType: "image/jpeg",
          sha256: "a".repeat(64),
          timestampMilliseconds: 0,
          width: 1,
        },
      ],
      generation: acquisitionGeneration,
      importId,
      sourceMediaSha256,
    });
    yield* visualRepository.complete({
      completedAt: decodeImportTimestamp("2026-07-29T10:06:00.000Z"),
      cost: output.cost,
      dispatchId,
      generation: acquisitionGeneration,
      importId,
      manifestKey: `imports/${importId}/visual/v1/generations/${acquisitionGeneration}/manifest.json`,
      manifestSha256: "d".repeat(64),
      model: output.model,
      observationsCount: output.observations.length,
      outcome: output.outcome,
      provider: output.provider,
      sourceMediaSha256,
      usage: output.usage,
    });
    return "visual-evidence";
  }).pipe(Effect.provideService(RuntimeContext, testRuntimeContext));

const visualTerminalRecoveryRecipe = (
  env: ProviderWorkflowTestEnv,
  instanceId: string,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) =>
  Effect.gen(function* runVisualTerminalRecoveryRecipe() {
    const dispatchId = `recipe:${importId}:${acquisitionGeneration}:gaia-200-evidence`;
    const settled = yield* Effect.promise(
      () =>
        env.MealPlannerDatabase.prepare(
          `SELECT actual_cost_micro_usd, provider_stage_id, run_id, state
             FROM pilot_provider_budget_dispatches
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
          .bind(dispatchId)
          .first() as Promise<{
          readonly actual_cost_micro_usd: number | null;
          readonly provider_stage_id: string;
          readonly run_id: string;
          readonly state: string;
        } | null>
    );
    if (settled !== null) {
      if (
        settled.actual_cost_micro_usd === 29 &&
        settled.provider_stage_id === "recipe-extraction" &&
        settled.run_id === "gaia-200:visual-terminal-recovery" &&
        settled.state === "settled_known"
      ) {
        return "recipe-dispatched" as const;
      }
      return yield* Effect.die(
        "Recipe recovery replay found a mismatched budget dispatch"
      );
    }
    const repository = makeD1PilotProviderBudgetRepository(
      env.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const dispatch = makePilotProviderDispatchGate({
      correlationId: decodeCorrelationId(
        "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2201"
      ),
      now: () => decodeTimestamp("2026-07-29T10:07:00.000Z"),
      repository,
      runId: decodeRunId("gaia-200:visual-terminal-recovery"),
      runtime: makePilotProviderBudgetRuntime("pilot-gaia-118"),
    });
    return yield* dispatch.run({
      dispatchId,
      invoke: increment(env, instanceId, "recipe-provider-calls").pipe(
        Effect.as({
          cost: {
            _tag: "Known" as const,
            actualCostMicroUsd: 29,
          },
          value: "recipe-dispatched" as const,
        })
      ),
      maximumCostMicroUsd: 100_000,
      providerStage: "recipe",
      providerStageId: "recipe-extraction",
    });
  }).pipe(Effect.orDie);

const speechTerminalRecoveryDispatch = (
  env: ProviderWorkflowTestEnv,
  instanceId: string,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration,
  poisonRecovery: boolean
) =>
  Effect.gen(function* runSpeechTerminalRecoveryDispatch() {
    const dispatchId = yield* makeD1ProviderTerminalRecoveryRepository(
      env.MealPlannerDatabase,
      "pilot-gaia-118"
    ).speechDispatchId({ acquisitionGeneration, importId });
    const isRecovery = dispatchId.endsWith(":recovery:1");
    yield* Effect.promise(() =>
      env.PROVIDER_WORKFLOW_STATE.put(
        stateKey(instanceId, "speech-terminal-ownership-id"),
        dispatchId
      )
    );
    const reservation = {
      dispatchId: decodeDispatchId(dispatchId),
      maximumCostMicroUsd: 100,
      providerStageId: decodeProviderStageId("speech-transcription"),
      runId: decodeRunId("run_gaia_178_terminal_recovery"),
      timestamp: decodeTimestamp("2026-07-27T09:10:00.000Z"),
    };
    const repository = makeD1PilotProviderBudgetRepository(
      env.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    yield* increment(env, instanceId, "task-attempts");
    const result = yield* runPilotProviderDispatch({
      invoke: increment(env, instanceId, "provider-calls").pipe(
        Effect.andThen(
          isRecovery && !poisonRecovery
            ? Effect.succeed({
                cost: {
                  _tag: "Known" as const,
                  actualCostMicroUsd: 10,
                },
                value: "safe-transcript",
              })
            : Effect.fail({
                code: "provider_unavailable",
                unsafeProviderBody: "must-not-cross-the-checkpoint",
              })
        )
      ),
      repository,
      reservation,
    });
    if (
      isRecovery &&
      (result._tag === "Completed" || result._tag === "AlreadySettled")
    ) {
      const transcriptKey = `imports/${importId}/transcription/v1/generations/${acquisitionGeneration}/transcript.json`;
      yield* Effect.promise(async () => {
        await env.MealPlannerDatabase.prepare(
          `UPDATE import_transcriptions
                SET state = 'transcribed',
                    completed_at = '2026-07-27T09:11:30.000Z',
                    transcript_key = ?,
                    transcript_sha256 = ?,
                    provider = 'installed-test-provider',
                    model = 'installed-test-model',
                    detected_language = 'en',
                    segments_count = 1,
                    usage_audio_milliseconds = 1000,
                    usage_input_bytes = 3,
                    cost_certainty = 'known',
                    cost_currency = 'USD',
                    estimated_cost_micro_usd = 10,
                    updated_at = '2026-07-27T09:11:30.000Z'
              WHERE import_id = ? AND acquisition_generation = ?
                AND dispatch_id = ?`
        )
          .bind(
            transcriptKey,
            "c".repeat(64),
            importId,
            acquisitionGeneration,
            dispatchId
          )
          .run();
      });
    }
    if (result._tag === "Completed") {
      return result.value;
    }
    if (result._tag === "AlreadySettled") {
      return "safe-transcript";
    }
    return yield* Effect.fail({ code: "outcome_unknown" });
  }).pipe(
    Effect.provideService(
      PilotProviderBudgetRuntime,
      makePilotProviderBudgetRuntime("pilot-gaia-118")
    )
  );

const directProviderEffect = (
  env: ProviderWorkflowTestEnv,
  instanceId: string,
  input: ProviderWorkflowInput
) =>
  increment(env, instanceId, "task-attempts").pipe(
    Effect.andThen(increment(env, instanceId, "provider-calls")),
    Effect.andThen(
      input.scenario === "success"
        ? Effect.succeed("safe-evidence")
        : Effect.fail({
            code:
              input.scenario === "retry_exhausted"
                ? (input.failureCode ?? "provider_unavailable")
                : (input.failureCode ?? "provider_error"),
            unsafeProviderBody: "must-not-cross-the-checkpoint",
          })
    )
  );

const providerStageByScenario = {
  recipe_conservative_crash_replay: "recipe",
  recipe_conservative_success: "recipe",
  recipe_recovery_loop_bounded: "recipe",
  recipe_recovery_loop_non_retryable: "recipe",
  recipe_recovery_loop_reconciliation_wait: "recipe",
  recipe_recovery_loop_success: "recipe",
  recipe_recovery_native_replay: "recipe",
  retry_exhausted: "speech",
  speech_terminal_recovery: "speech",
  speech_terminal_recovery_poison: "speech",
  success: "visual",
  terminal: "visual",
  unknown: "speech",
  visual_terminal_recovery: "visual",
} as const satisfies Record<
  ProviderWorkflowInput["scenario"],
  "recipe" | "speech" | "visual"
>;

const providerFailureCode = (error: { readonly code: string }) => ({
  code: error.code,
});

interface ProviderWorkflowSuccess<Evidence> {
  readonly _tag: "Succeeded";
  readonly evidence: Evidence;
  readonly stage: ProviderTaskStage;
}

const providerWorkflowSuccess = <Evidence>(
  stage: ProviderTaskStage,
  evidence: Evidence
): ProviderWorkflowSuccess<Evidence> => ({
  _tag: "Succeeded",
  evidence,
  stage,
});

const recipeRecoverySuccess = (): typeof ProviderTaskCheckpoint.Type => ({
  _tag: "Succeeded",
  stage: "recipe",
});

const recipeRecoveryFailure = (
  code: string
): typeof ProviderTaskCheckpoint.Type => ({
  _tag: "Failed",
  code,
  stage: "recipe",
});

const providerWorkflowExport = {
  kind: "workflow" as const,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- TODO(ASU005 alchemy@2.0.0-beta.72): WorkflowExport.make(env: unknown) erases behaviorful KV/D1 bindings; Schema cannot reconstruct branded host handles or their runtime behavior. Remove when Alchemy provides a precise env generic or supported real-runtime harness.
  make: (rawEnv: unknown) => {
    const env = rawEnv as ProviderWorkflowTestEnv;
    return Effect.succeed((rawInput: Schema.Json) =>
      Effect.gen(function* runProviderWorkflow() {
        const input = yield* Schema.decodeUnknownEffect(ProviderWorkflowInput, {
          onExcessProperty: "error",
        })(rawInput);
        const event = yield* WorkflowEvent;
        yield* increment(env, event.instanceId, "workflow-runs");
        if (
          input.scenario === "recipe_recovery_loop_bounded" ||
          input.scenario === "recipe_recovery_loop_non_retryable" ||
          input.scenario === "recipe_recovery_loop_reconciliation_wait" ||
          input.scenario === "recipe_recovery_loop_success"
        ) {
          if (input.importId === undefined) {
            return yield* Effect.die("Missing recovery loop import ID");
          }
          const importId = decodeImportId(input.importId);
          const generation = decodeGeneration(1);
          return yield* runRecipeRecoveryLoop(
            {
              acquisitionGeneration: generation,
              attemptOrdinal: 1,
              importId,
              trace: {
                correlationId: decodeCorrelationId(
                  "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2206"
                ),
              },
            },
            {
              persistUnknown: (_attempt, durableTaskName) =>
                task(
                  durableTaskName,
                  Effect.gen(function* persistNativeRecoveryTerminal() {
                    yield* increment(
                      env,
                      event.instanceId,
                      "recovery-loop-terminal-persistences"
                    );
                    yield* increment(env, event.instanceId, durableTaskName);
                  })
                ),
              readAttempt: (ordinal) =>
                Effect.succeed(nativeRecipeRecoveryAttempt(importId, ordinal)),
              runAttempt: (_attempt, durableTaskName) =>
                task(
                  durableTaskName,
                  Effect.gen(function* runNativeRecoveryProvider() {
                    yield* increment(
                      env,
                      event.instanceId,
                      "recovery-loop-provider-calls"
                    );
                    yield* increment(env, event.instanceId, durableTaskName);
                    if (input.scenario === "recipe_recovery_loop_success") {
                      return recipeRecoverySuccess();
                    }
                    if (
                      input.scenario === "recipe_recovery_loop_non_retryable"
                    ) {
                      return recipeRecoveryFailure("invalid_schema");
                    }
                    return recipeRecoveryFailure("outcome_unknown");
                  })
                ),
              waitForAuthorization: (ordinal) =>
                input.scenario === "recipe_recovery_loop_reconciliation_wait"
                  ? waitForEvent<Schema.Json>(
                      `authorize-recipe-recovery-${ordinal}`,
                      {
                        type: recipeRecoveryAuthorizationEventType(ordinal),
                      }
                    ).pipe(
                      Effect.flatMap(({ payload }) =>
                        Schema.decodeUnknownEffect(RecipeRecoveryAuthorization)(
                          payload
                        )
                      ),
                      Effect.orDie
                    )
                  : task(
                      `authorize-recipe-recovery-${ordinal}`,
                      Effect.succeed({
                        acquisitionGeneration: generation,
                        attemptOrdinal: ordinal,
                        importId,
                      })
                    ),
            }
          );
        }
        if (
          input.scenario === "speech_terminal_recovery" ||
          input.scenario === "speech_terminal_recovery_poison"
        ) {
          if (input.importId === undefined) {
            return yield* Effect.die("Missing terminal recovery import ID");
          }
          const importId = decodeImportId(input.importId);
          const acquisitionGeneration = decodeGeneration(1);
          yield* task(
            "resolve-acquire-store-verify-v2",
            increment(env, event.instanceId, "acquisition-calls")
          );
          yield* task(
            "record-acquisition-v2",
            increment(env, event.instanceId, "record-acquisition-calls")
          );
          const checkpoint = yield* runProviderTask(
            "transcribe-video-v1",
            "speech",
            speechTerminalRecoveryDispatch(
              env,
              event.instanceId,
              importId,
              acquisitionGeneration,
              input.scenario === "speech_terminal_recovery_poison"
            ),
            (evidence) => providerWorkflowSuccess("speech", evidence)
          );
          if (checkpoint._tag === "Failed") {
            yield* task(
              "persist-speech-terminal-v1",
              Effect.gen(function* persistSpeechTerminalAuthority() {
                const ownershipId = yield* Effect.promise(() =>
                  env.PROVIDER_WORKFLOW_STATE.get(
                    stateKey(event.instanceId, "speech-terminal-ownership-id")
                  )
                );
                if (ownershipId === null) {
                  return yield* Effect.die(
                    "Missing explicit speech terminal ownership identity"
                  );
                }
                yield* makeD1ProviderTerminalCheckpointRepository(
                  env.MealPlannerDatabase
                ).persist({
                  acquisitionGeneration,
                  completedAt: decodeImportTimestamp(
                    "2026-07-27T09:10:30.000Z"
                  ),
                  failureCode: checkpoint.code,
                  importId,
                  ownershipId,
                  providerStage: "speech",
                });
                yield* Effect.promise(() =>
                  env.MealPlannerDatabase.prepare(
                    `INSERT INTO import_provider_terminal_checkpoints (
                       import_id, acquisition_generation, provider_stage,
                       ownership_id, failure_code, completed_at, created_at
                     ) VALUES (?, ?, 'speech', ?, ?, ?, ?)
                     ON CONFLICT(
                       import_id, acquisition_generation, provider_stage,
                       ownership_id
                     ) DO NOTHING`
                  )
                    .bind(
                      importId,
                      acquisitionGeneration,
                      ownershipId,
                      checkpoint.code,
                      "2026-07-27T09:10:30.000Z",
                      "2026-07-27T09:10:30.000Z"
                    )
                    .run()
                );
              }).pipe(Effect.orDie)
            );
            return yield* task(
              "finalize-terminal",
              Effect.promise(async () => {
                const durable = await env.MealPlannerDatabase.prepare(
                  `SELECT failure_code
                       FROM import_provider_terminal_checkpoints
                      WHERE import_id = ? AND acquisition_generation = ?
                        AND provider_stage = 'speech'`
                )
                  .bind(importId, acquisitionGeneration)
                  .first<{ readonly failure_code: string }>();
                if (durable?.failure_code !== checkpoint.code) {
                  throw new Error("Terminal checkpoint was not durable");
                }
                await Effect.runPromise(
                  increment(env, event.instanceId, "terminal-before-finalize")
                );
                return checkpoint;
              })
            );
          }
          const visual = yield* continueVisualFromSettledSpeech({
            acquisitionGeneration,
            continueVisual: ({ speechDispatchId, visualDispatchId }) =>
              task(
                "extract-visual-evidence-v1",
                Effect.gen(function* recordVisualContinuation() {
                  yield* increment(env, event.instanceId, "visual-calls");
                  yield* Effect.promise(() =>
                    env.PROVIDER_WORKFLOW_STATE.put(
                      stateKey(event.instanceId, "visual-speech-dispatch-id"),
                      speechDispatchId
                    )
                  );
                  yield* Effect.promise(() =>
                    env.PROVIDER_WORKFLOW_STATE.put(
                      stateKey(event.instanceId, "visual-dispatch-id"),
                      visualDispatchId
                    )
                  );
                  return checkpoint;
                })
              ),
            importId,
            terminalRecovery: makeD1ProviderTerminalRecoveryRepository(
              env.MealPlannerDatabase,
              "pilot-gaia-118"
            ),
          });
          return yield* task("finalize-terminal", Effect.succeed(visual));
        }
        if (input.scenario === "visual_terminal_recovery") {
          if (input.importId === undefined) {
            return yield* Effect.die("Missing visual recovery import ID");
          }
          const importId = decodeImportId(input.importId);
          const acquisitionGeneration = decodeGeneration(1);
          yield* task(
            "acquire-v1",
            increment(env, event.instanceId, "acquisition-calls")
          );
          yield* task(
            "transcribe-video-v1",
            increment(env, event.instanceId, "speech-calls")
          );
          const visual = yield* runProviderTask(
            "extract-visual-evidence-v1",
            "visual",
            visualTerminalRecoveryDispatch(
              env,
              event.instanceId,
              importId,
              acquisitionGeneration
            ),
            (evidence) => providerWorkflowSuccess("visual", evidence)
          );
          if (visual._tag === "Failed") {
            return yield* task("finalize-terminal", Effect.succeed(visual));
          }
          const recipe = yield* task(
            "extract-recipe-v1",
            visualTerminalRecoveryRecipe(
              env,
              event.instanceId,
              importId,
              acquisitionGeneration
            )
          );
          return yield* task(
            "finalize-terminal",
            Effect.succeed(providerWorkflowSuccess("recipe", recipe))
          );
        }
        if (
          input.scenario === "recipe_conservative_success" ||
          input.scenario === "recipe_conservative_crash_replay"
        ) {
          if (input.importId === undefined) {
            return yield* Effect.die("Missing conservative recipe import ID");
          }
          const checkpoint = yield* runProviderTask(
            "extract-recipe-conservative-v1",
            "recipe",
            installedRecipeConservativeDispatch(
              env,
              event.instanceId,
              decodeImportId(input.importId),
              input.scenario === "recipe_conservative_crash_replay",
              false
            ),
            (evidence) => providerWorkflowSuccess("recipe", evidence)
          );
          return yield* task("finalize-terminal", Effect.succeed(checkpoint));
        }
        if (input.scenario === "recipe_recovery_native_replay") {
          if (input.importId === undefined) {
            return yield* Effect.die("Missing recovery recipe import ID");
          }
          const durableTaskNames = recipeRecoveryDurableTaskNames(1);
          yield* Effect.promise(() =>
            env.PROVIDER_WORKFLOW_STATE.put(
              stateKey(event.instanceId, "recipe-recovery-extraction-task"),
              durableTaskNames.extraction
            )
          );
          yield* Effect.promise(() =>
            env.PROVIDER_WORKFLOW_STATE.put(
              stateKey(event.instanceId, "recipe-recovery-terminal-task"),
              durableTaskNames.terminal
            )
          );
          const checkpoint = yield* runProviderTask(
            durableTaskNames.extraction,
            "recipe",
            installedRecipeConservativeDispatch(
              env,
              event.instanceId,
              decodeImportId(input.importId),
              true,
              true
            ),
            (evidence) => providerWorkflowSuccess("recipe", evidence)
          );
          return yield* task("finalize-terminal", Effect.succeed(checkpoint));
        }
        const stage = providerStageByScenario[input.scenario];
        let provider: Effect.Effect<string, { readonly code: string }>;
        if (input.scenario === "unknown") {
          provider = installedSpeechDispatch(
            env,
            event.instanceId,
            "ambiguous"
          ).pipe(
            Effect.as("unexpected-success"),
            Effect.mapError(providerFailureCode),
            Effect.provideService(RuntimeContext, testRuntimeContext)
          );
        } else if (input.scenario === "retry_exhausted") {
          provider = installedSpeechDispatch(
            env,
            event.instanceId,
            "known_zero"
          ).pipe(
            Effect.as("unexpected-success"),
            Effect.mapError(providerFailureCode),
            Effect.provideService(RuntimeContext, testRuntimeContext)
          );
        } else {
          provider = directProviderEffect(env, event.instanceId, input);
        }
        const checkpoint = yield* runProviderTask(
          "provider-dispatch",
          stage,
          provider,
          (value) =>
            providerWorkflowSuccess(
              stage,
              input.scenario === "success" ? value : "unexpected-success"
            )
        );
        return yield* task("finalize-terminal", Effect.succeed(checkpoint));
      })
    );
  },
};

const AlchemyRuntimeContractKey = "shape";
const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({ ProviderRetryWorkflow: providerWorkflowExport }),
    [AlchemyRuntimeContractKey]: () => ({}),
  },
});

const ProviderRetryWorkflowBridge = makeWorkflowBridge(WorkflowEntrypoint, {
  entrypoint,
  stack: { name: "meal-planner", stage: "test" },
})("ProviderRetryWorkflow");

/** Installed Alchemy bridge hosted by the same native WorkflowEntrypoint used in deployment. */
export class ProviderRetryWorkflow extends ProviderRetryWorkflowBridge {}

const CommandId = Schema.Struct({ id: Schema.String });
const ProviderWorkflowCommand = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("activate-speech"),
    authorization: Schema.optionalKey(Schema.String),
    dispatchId: Schema.String,
    id: Schema.String,
    importId: Schema.String,
  }),
  Schema.Struct({
    action: Schema.Literal("interleave-stage"),
    ...CommandId.fields,
  }),
  Schema.Struct({
    action: Schema.Literal("prepare-visual"),
    authorization: Schema.optionalKey(Schema.String),
    dispatchId: Schema.String,
    id: Schema.String,
    importId: Schema.String,
  }),
  Schema.Struct({
    action: Schema.Literal("prepare-speech"),
    id: Schema.String,
    importId: Schema.String,
  }),
  Schema.Struct({
    action: Schema.Literal("settle-speech"),
    dispatchId: Schema.String,
    id: Schema.String,
    importId: Schema.String,
  }),
  Schema.Struct({
    action: Schema.Literal("run-visual-recipe-budget"),
    ...CommandId.fields,
  }),
  Schema.Struct({ action: Schema.Literal("restart"), ...CommandId.fields }),
  Schema.Struct({
    action: Schema.Literal("restart-speech"),
    ...CommandId.fields,
  }),
  Schema.Struct({
    action: Schema.Literal("restart-terminal"),
    ...CommandId.fields,
  }),
  Schema.Struct({
    action: Schema.Literal("restart-visual"),
    ...CommandId.fields,
  }),
  Schema.Struct({
    action: Schema.Literals(["run", "run-waiting"]),
    id: Schema.String,
    input: ProviderWorkflowInput,
  }),
]);

const readRequest = (request: Request) =>
  Effect.runPromise(
    Effect.promise(() => request.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ProviderWorkflowCommand))
    )
  );

export default {
  fetch: async (request: Request, env: ProviderWorkflowTestEnv) => {
    const command = await readRequest(request);
    const workflow = env.ProviderRetryWorkflow;
    const sessionId =
      command.action === "activate-speech"
        ? undefined
        : await workflow.unsafeStartIntrospection();

    try {
      if (command.action === "run-visual-recipe-budget") {
        return Response.json(
          await Effect.runPromise(runInstalledVisualThenRecipe(env))
        );
      }
      if (command.action === "activate-speech") {
        return Response.json(
          await Effect.runPromise(
            Effect.gen(function* activateAuthenticatedSpeechRecovery() {
              const authorizer =
                yield* makeTestSystemAuthorizer("test-import-token");
              yield* authorizer.authorize(command.authorization);
              const workflowStarter = makeImportWorkflowStarter({
                createBatch: () =>
                  Effect.die("Recovery must not create a workflow instance"),
                get: (id) =>
                  Effect.promise(async () => {
                    const instance = await workflow.get(id);
                    return {
                      restart: (options) =>
                        options === undefined
                          ? Effect.die(
                              "Speech recovery must identify its restart checkpoint"
                            )
                          : Effect.promise(() => instance.restart(options)),
                      status: () =>
                        Effect.promise(() => instance.status()).pipe(
                          Effect.flatMap(
                            Schema.decodeUnknownEffect(
                              Schema.Struct({ status: Schema.String }),
                              { onExcessProperty: "ignore" }
                            )
                          ),
                          Effect.orDie
                        ),
                    };
                  }),
              });
              const activation = yield* makeD1ProviderTerminalSettlementService(
                {
                  database: env.MealPlannerDatabase,
                  now: () => decodeImportTimestamp("2026-07-27T09:11:00.000Z"),
                  runtimeStage: "pilot-gaia-118",
                  workflowStarter,
                }
              ).settle({
                acquisitionGeneration: decodeGeneration(1),
                dispatchId: decodeDispatchId(command.dispatchId),
                importId: decodeImportId(command.importId),
                operation: "prepare_speech_recovery",
              });
              yield* Effect.promise(() =>
                workflow.unsafeWaitForStatus(command.id, "complete")
              );
              const instance = yield* Effect.promise(() =>
                workflow.get(command.id)
              );
              const status = yield* Effect.promise(() => instance.status());
              return { activation, workflow: status };
            })
          )
        );
      }
      if (command.action === "settle-speech") {
        return Response.json(
          await Effect.runPromise(
            makeD1ProviderTerminalSettlementService({
              database: env.MealPlannerDatabase,
              now: () => decodeImportTimestamp("2026-07-27T09:10:45.000Z"),
              runtimeStage: "pilot-gaia-118",
            }).settle({
              acquisitionGeneration: decodeGeneration(1),
              dispatchId: decodeDispatchId(command.dispatchId),
              importId: decodeImportId(command.importId),
            })
          )
        );
      }
      if (command.action === "prepare-speech") {
        return Response.json(
          await Effect.runPromise(
            makeD1ProviderTerminalRecoveryRepository(
              env.MealPlannerDatabase,
              "pilot-gaia-118"
            ).prepareSpeechUnknownRecovery({
              acquisitionGeneration: decodeGeneration(1),
              createdAt: decodeImportTimestamp("2026-07-27T09:11:00.000Z"),
              importId: decodeImportId(command.importId),
            })
          )
        );
      }
      if (command.action === "prepare-visual") {
        return Response.json(
          await Effect.runPromise(
            Effect.gen(function* prepareAuthenticatedVisualRecovery() {
              const authorizer =
                yield* makeTestSystemAuthorizer("test-import-token");
              yield* authorizer.authorize(command.authorization);
              return yield* makeD1ProviderTerminalSettlementService({
                database: env.MealPlannerDatabase,
                now: () => decodeImportTimestamp("2026-07-29T10:04:00.000Z"),
                runtimeStage: "pilot-gaia-118",
              }).settle({
                acquisitionGeneration: decodeGeneration(1),
                dispatchId: decodeDispatchId(command.dispatchId),
                importId: decodeImportId(command.importId),
                operation: "prepare_visual_recovery",
              });
            })
          )
        );
      }
      if (command.action === "interleave-stage") {
        const repository = makeD1PilotProviderBudgetRepository(
          env.MealPlannerDatabase,
          "pilot-gaia-118"
        );
        const reservation = {
          dispatchId: decodeDispatchId(`interleave:${command.id}`),
          maximumCostMicroUsd: 1,
          providerStageId: decodeProviderStageId("visual-evidence"),
          runId: decodeRunId(`run:${command.id}`),
          timestamp: decodeTimestamp("2026-07-27T09:11:15.000Z"),
        };
        await Effect.runPromise(repository.reserve(reservation));
        await Effect.runPromise(repository.beginInvocation(reservation));
        await Effect.runPromise(
          repository.settleKnown({
            ...reservation,
            actualCostMicroUsd: 0,
          })
        );
        return Response.json({ outcome: "settled_known_zero" });
      }
      if (command.action === "run" || command.action === "run-waiting") {
        if (sessionId === undefined) {
          throw new Error("Workflow run requires an introspection session");
        }
        await workflow.unsafeSetIntrospectionOperations(sessionId, [
          {
            steps: [
              { name: "provider-dispatch" },
              { name: "transcribe-video-v1" },
            ],
            type: "disableRetryDelays",
          },
        ]);
        await workflow.create({ id: command.id, params: command.input });
      } else {
        const instance = await workflow.get(command.id);
        let restartStep = "finalize-terminal";
        if (command.action === "restart-speech") {
          restartStep = "transcribe-video-v1";
        } else if (command.action === "restart-terminal") {
          restartStep = "persist-speech-terminal-v1";
        } else if (command.action === "restart-visual") {
          restartStep = "extract-visual-evidence-v1";
        }
        await instance.restart({
          from: { name: restartStep, type: "do" },
        });
      }

      const instance = await workflow.get(command.id);
      if (command.action === "run-waiting") {
        await waitForNumber(
          env,
          command.id,
          "recovery-loop-terminal-persistences",
          1
        );
      } else if (
        command.action === "run" &&
        command.input.scenario.startsWith("recipe_recovery_loop_")
      ) {
        await Promise.race([
          workflow.unsafeWaitForStatus(command.id, "complete"),
          workflow.unsafeWaitForStatus(command.id, "errored"),
        ]);
      } else {
        await Promise.race([
          workflow.unsafeWaitForStatus(command.id, "complete"),
          workflow.unsafeWaitForStatus(command.id, "errored"),
        ]);
      }
      return Response.json(await instance.status());
    } finally {
      if (sessionId !== undefined) {
        await workflow.unsafeStopIntrospection(sessionId);
      }
    }
  },
};
