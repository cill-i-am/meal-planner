import { RuntimeContext } from "alchemy";
import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import {
  WorkflowEvent,
  makeWorkflowBridge,
  task,
} from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Redacted, Schema } from "effect";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  PilotProviderBudgetRuntime,
  makePilotProviderBudgetRuntime,
  pilotProviderKnownZeroCostFailure,
  runPilotProviderDispatch,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { ImportCorrelationId } from "./import-observability.js";
import { continueVisualFromSettledSpeech } from "./import-post-speech-visual.js";
import {
  makeInstalledRecipeExtractor,
  makeInstalledSpeechTranscriber,
  makeInstalledVisualEvidenceExtractor,
  makePilotProviderDispatchGate,
} from "./import-provider-adapters.js";
import { makeD1ProviderTerminalSettlementService } from "./import-provider-terminal-settlement.js";
import {
  makeD1ProviderTerminalCheckpointRepository,
  makeD1ProviderTerminalRecoveryRepository,
} from "./import-provider-terminal.js";
import { runProviderTask } from "./import-provider-workflow-task.js";
import { makeD1VisualEvidenceRepository } from "./import-visual-evidence.repository.d1.js";
import { makeImportAuthorizer } from "./import.auth.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import { makeImportWorkflowStarter } from "./import.workflow.js";

interface ProviderWorkflowInput {
  readonly failureCode?: string;
  readonly importId?: string;
  readonly scenario:
    | "retry_exhausted"
    | "recipe_conservative_crash_replay"
    | "recipe_conservative_success"
    | "recipe_recovery_native_replay"
    | "speech_terminal_recovery"
    | "speech_terminal_recovery_poison"
    | "success"
    | "terminal"
    | "unknown"
    | "visual_terminal_recovery";
}

interface ProviderWorkflowTestEnv {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly PROVIDER_WORKFLOW_STATE: {
    readonly get: (key: string) => Promise<string | null>;
    readonly put: (key: string, value: string) => Promise<void>;
  };
  readonly ProviderRetryWorkflow: {
    readonly create: (options: {
      readonly id: string;
      readonly params: ProviderWorkflowInput;
    }) => Promise<void>;
    readonly get: (id: string) => Promise<{
      readonly restart: (options: {
        readonly from: { readonly name: string; readonly type: "do" };
      }) => Promise<void>;
      readonly status: () => Promise<unknown>;
    }>;
    readonly unsafeSetIntrospectionOperations: (
      sessionId: string,
      operations: readonly unknown[]
    ) => Promise<void>;
    readonly unsafeStartIntrospection: () => Promise<string>;
    readonly unsafeStopIntrospection: (sessionId: string) => Promise<void>;
    readonly unsafeWaitForStatus: (
      id: string,
      status: "complete"
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

const unresolvedString = {
  citations: [],
  origin: "unresolved",
  reason: "not present in evidence",
  state: "unresolved",
} as const;
const unresolvedNumber = unresolvedString;
const unresolvedList = {
  items: [],
  reason: "not present in evidence",
  state: "unresolved",
} as const;
const validRecipeSemantics = {
  author: unresolvedString,
  category: unresolvedString,
  cookTimeMinutes: unresolvedNumber,
  cuisine: unresolvedString,
  description: unresolvedString,
  ingredientLines: unresolvedList,
  instructions: unresolvedList,
  name: unresolvedString,
  nutrition: unresolvedString,
  prepTimeMinutes: unresolvedNumber,
  sourceUrl: unresolvedString,
  supportedClaims: unresolvedList,
  temperatureCelsius: unresolvedNumber,
  tools: unresolvedList,
  totalTimeMinutes: unresolvedNumber,
  unresolvedFields: ["name", "description", "ingredient_lines", "instructions"],
  yield: unresolvedString,
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
    const dispatch = makePilotProviderDispatchGate({
      correlationId,
      now: () => decodeTimestamp("2026-07-29T13:00:00.000Z"),
      repository,
      runId: decodeRunId(
        recovery
          ? `gaia-118:recipe-recovery:${importId}`
          : `gaia-118:${importId}`
      ),
      runtime: makePilotProviderBudgetRuntime("pilot-gaia-118"),
    });
    const client = {
      gateway: Effect.die("universal AI Gateway binding must not be used"),
      id: Effect.succeed("meal-planner-pilot-gaia-118"),
      raw: Effect.succeed({
        run: async (
          _model: unknown,
          _body: unknown,
          options: unknown
        ): Promise<Response> => {
          if (
            JSON.stringify(options) !==
            JSON.stringify({
              gateway: {
                collectLog: false,
                id: "meal-planner-pilot-gaia-118",
                skipCache: true,
              },
              returnRawResponse: true,
            })
          ) {
            throw new Error("Gateway logging was not disabled");
          }
          await Effect.runPromise(increment(env, instanceId, "provider-calls"));
          return Response.json({
            response: "",
            tool_calls: [
              {
                arguments: validRecipeSemantics,
                name: "record_recipe",
              },
            ],
          });
        },
      }),
      run: () => Effect.die("universal AI Gateway dispatch must not be used"),
    } as unknown as QueryGatewayClient;
    const extractor = yield* makeInstalledRecipeExtractor({
      client,
      correlationId,
      dispatch,
    });
    const output = yield* extractor.extract({
      ...(recovery
        ? {
            dispatchId: decodeDispatchId(
              `recipe:${importId}:${generation}:${"e".repeat(64)}:recovery:1`
            ),
          }
        : {}),
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
    });
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
    const client = {
      gateway: Effect.die("universal AI Gateway binding must not be used"),
      id: Effect.succeed("meal-planner-pilot-gaia-118"),
      raw: Effect.succeed({
        run: async (
          _model: unknown,
          _body: unknown,
          options: unknown
        ): Promise<Response> => {
          if (
            JSON.stringify(options) !==
            JSON.stringify({
              gateway: {
                collectLog: false,
                id: "meal-planner-pilot-gaia-118",
                skipCache: true,
              },
              returnRawResponse: true,
            })
          ) {
            throw new Error("Gateway logging was not disabled");
          }
          await Effect.runPromise(increment(env, instanceId, "provider-calls"));
          if (outcome === "known_zero") {
            throw pilotProviderKnownZeroCostFailure(
              "provider_unavailable" as const
            );
          }
          throw new Error("simulated ambiguous provider interruption");
        },
      }),
      run: () => Effect.die("universal AI Gateway dispatch must not be used"),
    } as unknown as QueryGatewayClient;
    const transcriber = yield* makeInstalledSpeechTranscriber({
      client,
      correlationId,
      dispatch,
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
                      outcome: "empty",
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
    const client = {
      gateway: Effect.die("universal AI Gateway binding must not be used"),
      id: Effect.succeed("meal-planner-pilot-gaia-118"),
      raw: Effect.succeed({
        run: (
          _model: unknown,
          _body: unknown,
          _options: unknown
        ): Promise<Response> => {
          providerCalls += 1;
          const response = responses.shift();
          return response === undefined
            ? Promise.reject(new Error("Unexpected provider dispatch"))
            : Promise.resolve(response);
        },
      }),
      run: () => Effect.die("universal AI Gateway dispatch must not be used"),
    } as unknown as QueryGatewayClient;
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
      client,
      correlationId,
      dispatch,
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
    const client = {
      gateway: Effect.die("universal AI Gateway binding must not be used"),
      id: Effect.succeed("meal-planner-pilot-gaia-118"),
      raw: Effect.succeed({
        run: async (
          _model: unknown,
          _body: unknown,
          options: unknown
        ): Promise<Response> => {
          if (
            JSON.stringify(options) !==
            JSON.stringify({
              gateway: {
                collectLog: false,
                id: "meal-planner-pilot-gaia-118",
                skipCache: true,
              },
              returnRawResponse: true,
            })
          ) {
            throw new Error("Gateway logging was not disabled");
          }
          await Effect.runPromise(
            increment(env, instanceId, "visual-provider-calls")
          );
          return Response.json({
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
                          outcome: "empty",
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
          });
        },
      }),
      run: () => Effect.die("universal AI Gateway dispatch must not be used"),
    } as unknown as QueryGatewayClient;
    const extractor = yield* makeInstalledVisualEvidenceExtractor({
      client,
      correlationId,
      dispatch: budget,
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

const providerWorkflowExport = {
  kind: "workflow" as const,
  make: (rawEnv: unknown) => {
    const env = rawEnv as ProviderWorkflowTestEnv;
    return Effect.succeed((input: ProviderWorkflowInput) =>
      Effect.gen(function* runProviderWorkflow() {
        const event = yield* WorkflowEvent;
        yield* increment(env, event.instanceId, "workflow-runs");
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
            (evidence) => ({
              _tag: "Succeeded" as const,
              evidence,
              stage: "speech" as const,
            })
          );
          if (checkpoint._tag === "Failed") {
            yield* task(
              "persist-speech-terminal-v1",
              makeD1ProviderTerminalCheckpointRepository(
                env.MealPlannerDatabase
              )
                .persist({
                  acquisitionGeneration,
                  completedAt: decodeImportTimestamp(
                    "2026-07-27T09:10:30.000Z"
                  ),
                  failureCode: checkpoint.code,
                  importId,
                  providerStage: "speech",
                })
                .pipe(Effect.orDie)
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
            (evidence) => ({
              _tag: "Succeeded" as const,
              evidence,
              stage: "visual" as const,
            })
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
            Effect.succeed({
              _tag: "Succeeded" as const,
              evidence: recipe,
              stage: "recipe" as const,
            })
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
            (evidence) => ({
              _tag: "Succeeded" as const,
              evidence,
              stage: "recipe" as const,
            })
          );
          return yield* task("finalize-terminal", Effect.succeed(checkpoint));
        }
        if (input.scenario === "recipe_recovery_native_replay") {
          if (input.importId === undefined) {
            return yield* Effect.die("Missing recovery recipe import ID");
          }
          const checkpoint = yield* runProviderTask(
            "extract-recipe-recovery-v1",
            "recipe",
            installedRecipeConservativeDispatch(
              env,
              event.instanceId,
              decodeImportId(input.importId),
              true,
              true
            ),
            (evidence) => ({
              _tag: "Succeeded" as const,
              evidence,
              stage: "recipe" as const,
            })
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
          (value) => ({
            _tag: "Succeeded" as const,
            evidence:
              input.scenario === "success" ? value : "unexpected-success",
            stage,
          })
        );
        return yield* task("finalize-terminal", Effect.succeed(checkpoint));
      })
    );
  },
};

const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({ ProviderRetryWorkflow: providerWorkflowExport }),
    shape: () => ({}),
  },
});

const ProviderRetryWorkflowBridge = makeWorkflowBridge(WorkflowEntrypoint, {
  entrypoint,
  stack: { name: "meal-planner", stage: "test" },
})("ProviderRetryWorkflow");

/** Installed Alchemy bridge hosted by the same native WorkflowEntrypoint used in deployment. */
export class ProviderRetryWorkflow extends ProviderRetryWorkflowBridge {}

const readRequest = (request: Request) =>
  request.json() as Promise<
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
  >;

export default {
  fetch: async (request: Request, rawEnv: unknown) => {
    const env = rawEnv as ProviderWorkflowTestEnv;
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
              const authorizer = yield* makeImportAuthorizer(
                Redacted.make("test-import-token")
              );
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
              const authorizer = yield* makeImportAuthorizer(
                Redacted.make("test-import-token")
              );
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
      if (command.action === "run") {
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
      await workflow.unsafeWaitForStatus(command.id, "complete");
      return Response.json(await instance.status());
    } finally {
      if (sessionId !== undefined) {
        await workflow.unsafeStopIntrospection(sessionId);
      }
    }
  },
};
