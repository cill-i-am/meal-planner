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
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  makePilotProviderBudgetRuntime,
  pilotProviderKnownZeroCostFailure,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import { ImportCorrelationId } from "./import-observability.js";
import { makeVisualTransport } from "./import-provider-adapters.test-fixture.js";
import type { WorkersAiTransport } from "./import-provider-kernel.js";
import {
  InstalledRecipeModel,
  InstalledSpeechModel,
  makePilotProviderDispatchGate,
} from "./import-provider-kernel.js";
import { makeInstalledRecipeExtractor } from "./import-provider-recipe.js";
import { makeInstalledSpeechTranscriber } from "./import-provider-speech.js";
import { makeInstalledVisualEvidenceExtractor } from "./import-provider-visual.js";
import type { ProviderTaskCheckpoint } from "./import-provider-workflow-checkpoint.js";
import type { ProviderTaskStage } from "./import-provider-workflow-task.js";
import { runProviderTask } from "./import-provider-workflow-task.js";
import type { RecipeEvidenceAssembly } from "./import-recipe-extractor.js";
import {
  RecipeRecoveryAuthorization,
  recipeRecoveryAuthorizationEventType,
} from "./import-recipe-recovery.js";
import type {
  RecipeRecoveryAttempt,
  RecipeRecoveryOrdinal,
} from "./import-recipe-recovery.js";
import { runRecipeRecoveryLoop } from "./import-runtime-composition.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";

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
    "success",
    "terminal",
    "unknown",
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
    rootDispatchId,
    rootExtractionFingerprint,
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
  retry_exhausted: "speech",
  success: "visual",
  terminal: "visual",
  unknown: "speech",
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
    action: Schema.Literal("run-visual-recipe-budget"),
    ...CommandId.fields,
  }),
  Schema.Struct({ action: Schema.Literal("restart"), ...CommandId.fields }),
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
    const sessionId = await workflow.unsafeStartIntrospection();

    try {
      if (command.action === "run-visual-recipe-budget") {
        return Response.json(
          await Effect.runPromise(runInstalledVisualThenRecipe(env))
        );
      }
      const start = async (
        input: Exclude<typeof command, { readonly action: "restart" }>["input"]
      ) => {
        await workflow.unsafeSetIntrospectionOperations(sessionId, [
          {
            steps: [
              { name: "provider-dispatch" },
              { name: "transcribe-video-v1" },
            ],
            type: "disableRetryDelays",
          },
        ]);
        await workflow.create({ id: command.id, params: input });
      };
      const restart = async () => {
        const instance = await workflow.get(command.id);
        await instance.restart({
          from: { name: "finalize-terminal", type: "do" },
        });
      };
      await (command.action === "restart" ? restart() : start(command.input));

      const instance = await workflow.get(command.id);
      await (command.action === "run-waiting"
        ? waitForNumber(
            env,
            command.id,
            "recovery-loop-terminal-persistences",
            1
          )
        : Promise.race([
            workflow.unsafeWaitForStatus(command.id, "complete"),
            workflow.unsafeWaitForStatus(command.id, "errored"),
          ]));
      return Response.json(await instance.status());
    } finally {
      await workflow.unsafeStopIntrospection(sessionId);
    }
  },
};
