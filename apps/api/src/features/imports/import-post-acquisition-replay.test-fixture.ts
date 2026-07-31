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
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  makePilotProviderBudgetRuntime,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
import {
  continueAcquisitionCheckpoint,
  decodeAcquisitionCheckpoint,
  recoverVerifiedAcquisitionCheckpoint,
} from "./import-acquisition-checkpoint.js";
import { loadStagedOperatorCarousel } from "./import-carousel-staging.js";
import { readVerifiedAcquisitionEvidence } from "./import-media-acquirer.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import { AcquisitionTaskOutcome } from "./import-media.model.js";
import { makeD1ImportObservabilityTraceStore } from "./import-observability.d1.js";
import {
  ImportObservabilityTraceStore,
  observeImportWorkflowStart,
} from "./import-observability.js";
import {
  makeInstalledRecipeExtractor,
  makeInstalledSpeechTranscriber,
  makeInstalledVisualEvidenceExtractor,
  makePilotProviderDispatchGate,
} from "./import-provider-adapters.js";
import { makeD1ProviderTerminalRecoveryRepository } from "./import-provider-terminal.js";
import { SpeechProviderTaskCheckpoint } from "./import-provider-workflow-checkpoint.js";
import {
  ProviderTaskStepConfig,
  runProviderTaskAttempt,
} from "./import-provider-workflow-task.js";
import type { SpeechAudioExtractorShape } from "./import-speech-transcriber.js";
import { transcribeAcquiredImport } from "./import-speech-transcription.js";
import { makeD1SpeechTranscriptionRepository } from "./import-speech-transcription.repository.d1.js";
import { resolveImportWorkflowInput } from "./import-workflow-input.js";
import { postAcquisitionRestartOptions } from "./import-workflow-journal.js";
import { ImportTimestamp, SourceCanonicalId } from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";

interface PostAcquisitionReplayTestEnv {
  readonly ImportEvidenceBucket: AcquisitionBucketLike;
  readonly MealPlannerDatabase: AnyD1Database;
  readonly POST_ACQUISITION_REPLAY_STATE: {
    readonly get: (key: string) => Promise<string | null>;
    readonly put: (key: string, value: string) => Promise<void>;
  };
  readonly PostAcquisitionReplayWorkflow: {
    readonly get: (id: string) => Promise<{
      readonly restart: (options?: {
        readonly from?: { readonly name: string; readonly type: "do" };
      }) => Promise<void>;
      readonly status: () => Promise<unknown>;
    }>;
    readonly unsafeStartIntrospection: () => Promise<string>;
    readonly unsafeStopIntrospection: (sessionId: string) => Promise<void>;
    readonly unsafeWaitForStatus: (
      id: string,
      status: "complete"
    ) => Promise<void>;
  };
}

const decodeTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const AcquisitionTaskStepConfig = {
  // eslint-disable-next-line sort-keys -- Production-faithful historical Workflow configuration.
  retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
  timeout: "17 minutes",
} as const;
const AcquisitionClaimCheckpoint = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Finished") }),
  Schema.Struct({
    _tag: Schema.Literal("Acquiring"),
    canonicalId: SourceCanonicalId,
  }),
]);
const testRuntimeContext = RuntimeContext.of({
  Type: "TestRuntimeContext",
  env: {},
  get: <T>() =>
    // eslint-disable-next-line unicorn/no-useless-undefined -- The Alchemy runtime contract explicitly represents a missing binding with undefined.
    Effect.succeed<T | undefined>(undefined),
  id: "post-acquisition-replay-test",
  set: (id) => Effect.succeed(id),
});
const stateKey = (instanceId: string, name: string) => `${instanceId}:${name}`;

const increment = (
  env: PostAcquisitionReplayTestEnv,
  instanceId: string,
  name: string
) =>
  Effect.promise(async () => {
    const key = stateKey(instanceId, name);
    const current = Number(
      (await env.POST_ACQUISITION_REPLAY_STATE.get(key)) ?? "0"
    );
    await env.POST_ACQUISITION_REPLAY_STATE.put(key, String(current + 1));
  });

const replayRootMetadata = (
  instanceId: string
): Readonly<Record<string, unknown>> => {
  if (instanceId.includes("root-object")) {
    return {
      platformMetadata: {
        attempt: 1,
        region: "synthetic",
      },
    };
  }
  if (instanceId.includes("root-multiple")) {
    return {
      platformEnabled: true,
      platformMetadata: {
        attempt: 1,
        region: "synthetic",
      },
      platformRevision: 7,
    };
  }
  return { platformRevision: 7 };
};

const replayProviderFixture = (
  env: PostAcquisitionReplayTestEnv,
  instanceId: string
): {
  readonly audioExtractor: SpeechAudioExtractorShape;
  readonly client: QueryGatewayClient;
} => ({
  audioExtractor: {
    extract: () =>
      increment(env, instanceId, "audio-calls").pipe(
        Effect.as({
          bytes: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]),
          durationMilliseconds: 1000,
          mimeType: "audio/wav" as const,
          sha256:
            "c4ffde8d57d64bbc7a1220d8bf9560d208511252d9173d1359f5cf9a7b2f14dc",
        })
      ),
  },
  client: {
    gateway: Effect.die("universal AI Gateway binding must not be used"),
    id: Effect.succeed("meal-planner-pilot-gaia-118"),
    raw: Effect.succeed({
      run: async () => {
        await Effect.runPromise(increment(env, instanceId, "provider-calls"));
        return Response.json({
          ...replayRootMetadata(instanceId),
          segments: [
            {
              avg_logprob: null,
              compression_ratio: null,
              end: null,
              no_speech_prob: null,
              start: null,
              temperature: null,
              text: null,
              words: null,
            },
          ],
          text: " \nChop the onion.\t ",
          transcription_info: {
            duration: null,
            duration_after_vad: null,
            language: null,
            language_probability: null,
          },
          vtt: null,
          word_count: null,
        });
      },
    }),
    run: () => Effect.die("universal AI Gateway dispatch must not be used"),
  } as unknown as QueryGatewayClient,
});

type InstalledRuntimeContext = ReturnType<typeof RuntimeContext.of>;

const makeWorkflowExport = (runtimeContext: InstalledRuntimeContext) => ({
  kind: "workflow" as const,
  make: (rawEnv: unknown) => {
    const env = rawEnv as PostAcquisitionReplayTestEnv;
    return Effect.succeed((rawInput: unknown) =>
      Effect.gen(function* runPostAcquisitionReplay() {
        const event = yield* WorkflowEvent;
        const { correlationId, importId } = yield* resolveImportWorkflowInput(
          rawInput
        ).pipe(Effect.orDie);
        const traceStore = makeD1ImportObservabilityTraceStore(
          env.MealPlannerDatabase,
          () => "2026-07-28T10:01:00.000Z"
        );
        return yield* Effect.gen(function* runObservedPostAcquisitionReplay() {
          yield* observeImportWorkflowStart(correlationId);
          const fixture = replayProviderFixture(env, event.instanceId);
          const dispatch = makePilotProviderDispatchGate({
            correlationId,
            now: () =>
              Schema.decodeUnknownSync(PilotBudgetTimestamp)(
                "2026-07-28T10:01:00.000Z"
              ),
            repository: makeD1PilotProviderBudgetRepository(
              env.MealPlannerDatabase,
              "pilot-gaia-118"
            ),
            runId: Schema.decodeUnknownSync(PilotBudgetRunId)(
              `gaia-118:${importId}`
            ),
            runtime: makePilotProviderBudgetRuntime("pilot-gaia-118"),
          });
          const speechTranscriber = yield* makeInstalledSpeechTranscriber({
            client: fixture.client,
            correlationId,
            dispatch,
          }).pipe(Effect.provideService(RuntimeContext, runtimeContext));
          yield* increment(env, event.instanceId, "speech-factory");
          yield* makeInstalledVisualEvidenceExtractor({
            client: fixture.client,
            correlationId,
            dispatch,
          });
          yield* increment(env, event.instanceId, "visual-factory");
          yield* makeInstalledRecipeExtractor({
            client: fixture.client,
            correlationId,
            dispatch,
          });
          yield* increment(env, event.instanceId, "recipe-factory");
          const stagedCarousel = yield* loadStagedOperatorCarousel({
            bucket: env.ImportEvidenceBucket,
            importId,
          }).pipe(Effect.orDie);
          if (stagedCarousel !== null) {
            return yield* Effect.die(
              "Video replay must not resolve a staged carousel"
            );
          }
          yield* increment(env, event.instanceId, "before-claim");
          const rawClaim = yield* task(
            "claim-acquisition-v1",
            Effect.die("Persisted acquisition claim must replay")
          );
          const claim = yield* Schema.decodeUnknownEffect(
            AcquisitionClaimCheckpoint
          )(rawClaim).pipe(Effect.orDie);
          yield* increment(env, event.instanceId, "after-claim");
          if (claim._tag === "Finished") {
            return { _tag: "NoAcquisitionRequired" as const };
          }
          const rawCheckpoint = yield* task(
            "resolve-acquire-store-verify-v2",
            recoverVerifiedAcquisitionCheckpoint({
              expectedCanonicalId: claim.canonicalId,
              findStored: makeD1ImportRepository(
                env.MealPlannerDatabase
              ).findById(importId),
              importId,
              readEvidence: (stored) =>
                readVerifiedAcquisitionEvidence(env.ImportEvidenceBucket, {
                  canonicalId: stored.canonicalSourceId,
                  generation: stored.acquisitionGeneration,
                  importId,
                  now: () => new Date("2026-07-28T10:01:00.000Z"),
                }),
            }).pipe(
              Effect.orDie,
              Effect.flatMap((recovered) =>
                recovered === null
                  ? increment(env, event.instanceId, "acquisition-calls").pipe(
                      Effect.andThen(
                        Effect.die(
                          "Persisted acquisition checkpoint must replay"
                        )
                      )
                    )
                  : Effect.succeed(recovered)
              ),
              Effect.map((outcome) =>
                outcome._tag === "AcquisitionCheckpointRejected"
                  ? outcome
                  : Schema.encodeSync(AcquisitionTaskOutcome)(outcome)
              )
            ),
            AcquisitionTaskStepConfig
          );
          const checkpoint = decodeAcquisitionCheckpoint(rawCheckpoint);
          yield* increment(env, event.instanceId, "after-acquisition");
          if (checkpoint._tag === "AcquisitionCheckpointRejected") {
            return checkpoint;
          }
          const finalization = yield* task(
            "record-acquisition-v2",
            continueAcquisitionCheckpoint({
              findStored: makeD1ImportRepository(
                env.MealPlannerDatabase
              ).findById(importId),
              importId,
              onAccepted: () => Effect.succeed<"Recorded">("Recorded"),
              outcome: checkpoint.outcome,
            }).pipe(
              Effect.orDie,
              Effect.flatMap((continuation) =>
                continuation === "Recorded"
                  ? Effect.succeed(continuation)
                  : Effect.die(
                      "Retained acquisition must satisfy idempotent finalization"
                    )
              )
            )
          );
          yield* Schema.decodeUnknownEffect(Schema.Literal("Recorded"))(
            finalization
          ).pipe(Effect.orDie);
          yield* increment(env, event.instanceId, "after-record");
          const repository = makeD1ImportRepository(env.MealPlannerDatabase);
          const encodedSpeech = yield* task(
            "transcribe-video-v1",
            continueAcquisitionCheckpoint({
              findStored: repository.findById(importId),
              importId,
              onAccepted: () =>
                makeD1ProviderTerminalRecoveryRepository(
                  env.MealPlannerDatabase,
                  "pilot-gaia-118"
                )
                  .speechDispatchId({
                    acquisitionGeneration: checkpoint.outcome.generation,
                    importId,
                  })
                  .pipe(
                    Effect.tap(() =>
                      increment(
                        env,
                        event.instanceId,
                        "dispatch-identity-calls"
                      )
                    ),
                    Effect.orDie,
                    Effect.flatMap((speechDispatchId) =>
                      runProviderTaskAttempt(
                        "speech",
                        transcribeAcquiredImport({
                          acquisitionRepository: repository,
                          audioExtractor: fixture.audioExtractor,
                          bucket: env.ImportEvidenceBucket,
                          dispatchId: speechDispatchId,
                          importId,
                          now: () =>
                            decodeTimestamp("2026-07-28T10:01:00.000Z"),
                          speechTranscriber,
                          transcriptionRepository:
                            makeD1SpeechTranscriptionRepository(
                              env.MealPlannerDatabase
                            ),
                        }),
                        () => ({
                          _tag: "Succeeded" as const,
                          stage: "speech" as const,
                        }),
                        correlationId
                      )
                    )
                  ),
              outcome: checkpoint.outcome,
            }).pipe(Effect.orDie),
            ProviderTaskStepConfig
          );
          return yield* Schema.decodeUnknownEffect(
            SpeechProviderTaskCheckpoint
          )(encodedSpeech).pipe(Effect.orDie);
        }).pipe(
          Effect.provideService(ImportObservabilityTraceStore, traceStore)
        );
      })
    );
  },
});

const workflowExport = RuntimeContext.pipe(Effect.map(makeWorkflowExport));

const entrypoint = workflowExport.pipe(
  Effect.map((capturedWorkflowExport) => ({
    RuntimeContext: {
      exports: Effect.succeed({
        PostAcquisitionReplayWorkflow: capturedWorkflowExport,
      }),
      shape: () => ({}),
    },
  })),
  Effect.provideService(RuntimeContext, testRuntimeContext)
);

const PostAcquisitionReplayWorkflowBridge = makeWorkflowBridge(
  WorkflowEntrypoint,
  {
    entrypoint,
    stack: { name: "meal-planner", stage: "test" },
  }
)("PostAcquisitionReplayWorkflow");

export class PostAcquisitionReplayWorkflow extends PostAcquisitionReplayWorkflowBridge {}

export default {
  fetch: async (request: Request, rawEnv: unknown) => {
    const env = rawEnv as PostAcquisitionReplayTestEnv;
    const command = (await request.json()) as {
      readonly action:
        | "read"
        | "restart"
        | "restart-legacy"
        | "restart-truncated";
      readonly id: string;
    };
    const read = (name: string) =>
      env.POST_ACQUISITION_REPLAY_STATE.get(stateKey(command.id, name));
    if (command.action === "read") {
      return Response.json({
        acquisitionCalls: Number((await read("acquisition-calls")) ?? "0"),
        afterAcquisition: Number((await read("after-acquisition")) ?? "0"),
        afterClaim: Number((await read("after-claim")) ?? "0"),
        afterRecord: Number((await read("after-record")) ?? "0"),
        audioCalls: Number((await read("audio-calls")) ?? "0"),
        beforeClaim: Number((await read("before-claim")) ?? "0"),
        dispatchIdentityCalls: Number(
          (await read("dispatch-identity-calls")) ?? "0"
        ),
        providerCalls: Number((await read("provider-calls")) ?? "0"),
        recipeFactory: Number((await read("recipe-factory")) ?? "0"),
        speechFactory: Number((await read("speech-factory")) ?? "0"),
        visualFactory: Number((await read("visual-factory")) ?? "0"),
      });
    }
    const workflow = env.PostAcquisitionReplayWorkflow;
    const sessionId = await workflow.unsafeStartIntrospection();
    try {
      const instance = await workflow.get(command.id);
      await instance.restart(
        command.action === "restart-truncated"
          ? postAcquisitionRestartOptions({
              _tag: "ResolvedWithoutFinalization",
              lastSuccessfulStep: "resolve-acquire-store-verify-v2",
            })
          : {
              from: {
                name:
                  command.action === "restart-legacy"
                    ? "transcribe-video-v1"
                    : "record-acquisition-v2",
                type: "do",
              },
            }
      );
      await workflow
        .unsafeWaitForStatus(command.id, "complete")
        .catch(() => null);
      return Response.json(await instance.status());
    } finally {
      await workflow.unsafeStopIntrospection(sessionId);
    }
  },
};
