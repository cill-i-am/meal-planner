import { RuntimeContext } from "alchemy";
import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import {
  WorkflowEvent,
  makeWorkflowBridge,
  task,
} from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

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
import {
  ImportCorrelationId,
  metadataOnlyGatewayHeaders,
} from "./import-observability.js";
import {
  makeInstalledSpeechTranscriber,
  makePilotProviderDispatchGate,
} from "./import-provider-adapters.js";
import {
  makeD1ProviderTerminalCheckpointRepository,
  makeD1ProviderTerminalRecoveryRepository,
} from "./import-provider-terminal.js";
import { runProviderTask } from "./import-provider-workflow-task.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";

interface ProviderWorkflowInput {
  readonly failureCode?: string;
  readonly importId?: string;
  readonly scenario:
    | "retry_exhausted"
    | "speech_terminal_recovery"
    | "success"
    | "terminal"
    | "unknown";
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
      gateway: Effect.die("raw universal gateway access was bypassed"),
      id: Effect.succeed("meal-planner-pilot-gaia-118"),
      raw: Effect.die("metadata-only universal gateway was bypassed"),
      run: (request: unknown) =>
        Effect.gen(function* runSpeechGatewayRequest() {
          const headers =
            typeof request === "object" &&
            request !== null &&
            "headers" in request
              ? (request.headers as Record<string, string>)
              : {};
          if (
            JSON.stringify(headers) !==
              JSON.stringify(metadataOnlyGatewayHeaders(correlationId)) ||
            JSON.stringify(request).includes("collectLog")
          ) {
            return yield* Effect.die(
              "Metadata-only gateway policy was not installed"
            );
          }
          yield* increment(env, instanceId, "provider-calls");
          if (outcome === "known_zero") {
            return yield* Effect.fail(
              pilotProviderKnownZeroCostFailure("provider_unavailable" as const)
            );
          }
          return yield* Effect.fail(
            new Error("simulated ambiguous provider interruption")
          );
        }),
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

const speechTerminalRecoveryDispatch = (
  env: ProviderWorkflowTestEnv,
  instanceId: string,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
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
          isRecovery
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
  retry_exhausted: "speech",
  speech_terminal_recovery: "speech",
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

const providerWorkflowExport = {
  kind: "workflow" as const,
  make: (rawEnv: unknown) => {
    const env = rawEnv as ProviderWorkflowTestEnv;
    return Effect.succeed((input: ProviderWorkflowInput) =>
      Effect.gen(function* runProviderWorkflow() {
        const event = yield* WorkflowEvent;
        yield* increment(env, event.instanceId, "workflow-runs");
        if (input.scenario === "speech_terminal_recovery") {
          if (input.importId === undefined) {
            return yield* Effect.die("Missing terminal recovery import ID");
          }
          const importId = decodeImportId(input.importId);
          const acquisitionGeneration = decodeGeneration(1);
          yield* task(
            "acquire-v1",
            increment(env, event.instanceId, "acquisition-calls")
          );
          const checkpoint = yield* runProviderTask(
            "transcribe-video-v1",
            "speech",
            speechTerminalRecoveryDispatch(
              env,
              event.instanceId,
              importId,
              acquisitionGeneration
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
        readonly action: "recover-speech";
        readonly id: string;
        readonly importId: string;
      }
    | { readonly action: "restart"; readonly id: string }
    | { readonly action: "restart-terminal"; readonly id: string }
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
    const sessionId = await workflow.unsafeStartIntrospection();

    try {
      if (command.action === "run") {
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
        if (command.action === "recover-speech") {
          await Effect.runPromise(
            makeD1ProviderTerminalRecoveryRepository(
              env.MealPlannerDatabase,
              "pilot-gaia-118"
            ).prepareSpeechUnknownRecovery({
              acquisitionGeneration: decodeGeneration(1),
              createdAt: decodeImportTimestamp("2026-07-27T09:11:00.000Z"),
              importId: decodeImportId(command.importId),
            })
          );
          await instance.restart({
            from: { name: "transcribe-video-v1", type: "do" },
          });
        } else {
          await instance.restart({
            from: {
              name:
                command.action === "restart-terminal"
                  ? "persist-speech-terminal-v1"
                  : "finalize-terminal",
              type: "do",
            },
          });
        }
      }

      await workflow.unsafeWaitForStatus(command.id, "complete");
      const instance = await workflow.get(command.id);
      return Response.json(await instance.status());
    } finally {
      await workflow.unsafeStopIntrospection(sessionId);
    }
  },
};
