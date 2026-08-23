import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { RuntimeContext } from "alchemy";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Option, Schema, Stream } from "effect";

import {
  ImportEvidenceEventFailure,
  reconcileImportEvidenceQueueMessage,
} from "../imports/import-evidence-event.js";
import { makeD1ImportEvidenceRouteRepository } from "../imports/import-evidence-route.repository.d1.js";
import {
  makeHouseholdSpeechTranscriptionRepository,
  makeHouseholdVisualEvidenceRepository,
} from "../imports/import-evidence.repository.household.js";
import { ImportIntentExecutionGeneration } from "../imports/import-intent-transition.js";
import type {
  AcquisitionBucketLike,
  AcquisitionMediaObjectLike,
  PreparedMediaArtifact,
  R2ObjectBodyLike,
  R2ObjectLike,
} from "../imports/import-media-acquirer.js";
import { acquireStoreVerify } from "../imports/import-media-acquirer.js";
import { RetryableAcquisitionError } from "../imports/import-media.errors.js";
import {
  AcquisitionGeneration,
  Sha256Hex,
} from "../imports/import-media.model.js";
import {
  ImportCorrelationId,
  ImportTraceContext,
} from "../imports/import-observability.js";
import {
  localDispatchGate,
  makeVisualTransport,
  testRuntimeContext,
} from "../imports/import-provider-adapters.test-fixture.js";
import { persistHouseholdProviderTerminalAuthority } from "../imports/import-provider-terminal-authority.js";
import {
  ProviderTerminalSettlementRequest,
  ProviderTerminalSettlementResponse,
  makeD1ProviderTerminalSettlementService,
} from "../imports/import-provider-terminal-settlement.js";
import { makeInstalledVisualEvidenceExtractor } from "../imports/import-provider-visual.js";
import { extractVisualEvidenceForTranscribedImport } from "../imports/import-visual-evidence.js";
import { makeRecipeImportWorkflowDispatcher } from "../imports/import-worker-request-layer.js";
import { workerTestR2PutBody } from "../imports/import-worker-test-environment.js";
import type {
  WorkerTestR2Bucket,
  WorkerTestR2Object,
  WorkerTestR2ObjectBody,
} from "../imports/import-worker-test-environment.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "../imports/import.contracts.js";
import { workflowStartUnavailable } from "../imports/import.errors.js";
import {
  TranscriptEvidenceStore,
  TranscriptEvidenceStoreLive,
} from "../imports/transcript-evidence-store.js";
import {
  VisualEvidenceStore,
  VisualEvidenceStoreLive,
} from "../imports/visual-evidence-store.js";
import {
  HouseholdObserveEvidenceReferenceInput,
  HouseholdReadEvidenceStageResult,
} from "./evidence/household-evidence.contract.js";
import type {
  HouseholdMutateEvidenceStageInput,
  HouseholdMutateEvidenceStageResult,
  HouseholdObserveEvidenceReferenceResult,
  HouseholdPrepareRecipeRecoveryInput,
  HouseholdPrepareRecipeRecoveryResult,
  HouseholdReadEvidenceReferencesInput,
  HouseholdReadEvidenceReferencesResult,
  HouseholdReadEvidenceStageInput,
  HouseholdReadImportTerminalCheckpointInput,
  HouseholdReadImportTerminalCheckpointResult,
  HouseholdReadRecipeRecoveryAttemptInput,
  HouseholdReadRecipeRecoveryAttemptResult,
} from "./evidence/household-evidence.contract.js";
import {
  HouseholdAdmitRecipeImportInput,
  HouseholdAdmitRecipeImportResult,
  HouseholdImportMutationId,
  HouseholdRecipeImportExecutionView,
  HouseholdRecipeImportFailure,
  HouseholdResolveRecipeImportSourceInput,
} from "./recipe-import/household-recipe-import.contract.js";
import type {
  HouseholdReadRecipeImportExecutionInput,
  HouseholdTransitionRecipeImportLifecycleInput,
  HouseholdRecordRecipeImportDispatchInput,
  HouseholdRecordRecipeImportDispatchResult,
} from "./recipe-import/household-recipe-import.contract.js";
import {
  HouseholdMemberAdmission,
  HouseholdSystemAdmission,
} from "./rpc/command-envelope.js";

interface TestKvNamespace {
  readonly get: (key: string) => Promise<string | null>;
  readonly put: (key: string, value: string) => Promise<void>;
}

interface TestMessageBatch {
  readonly messages: readonly {
    readonly ack: () => void;
    readonly body: unknown;
    readonly retry: () => void;
  }[];
}

interface Environment {
  readonly EVIDENCE_EVENT_RESULTS: TestKvNamespace;
  readonly ImportEvidenceBucket: WorkerTestR2Bucket;
  readonly MealPlannerDatabase: AnyD1Database;
  readonly HouseholdDomainWorker: {
    readonly admitRecipeImport: (
      input: typeof HouseholdAdmitRecipeImportInput.Type
    ) => Promise<typeof HouseholdAdmitRecipeImportResult.Encoded>;
    readonly mutateEvidenceStage: (
      input: typeof HouseholdMutateEvidenceStageInput.Encoded
    ) => Promise<typeof HouseholdMutateEvidenceStageResult.Encoded>;
    readonly observeEvidenceReference: (
      input: typeof HouseholdObserveEvidenceReferenceInput.Encoded
    ) => Promise<typeof HouseholdObserveEvidenceReferenceResult.Encoded>;
    readonly readEvidenceReferences: (
      input: HouseholdReadEvidenceReferencesInput
    ) => Promise<typeof HouseholdReadEvidenceReferencesResult.Encoded>;
    readonly prepareRecipeRecovery: (
      input: typeof HouseholdPrepareRecipeRecoveryInput.Encoded
    ) => Promise<typeof HouseholdPrepareRecipeRecoveryResult.Encoded>;
    readonly readEvidenceStage: (
      input: HouseholdReadEvidenceStageInput
    ) => Promise<typeof HouseholdReadEvidenceStageResult.Encoded>;
    readonly readImportTerminalCheckpoint: (
      input: HouseholdReadImportTerminalCheckpointInput
    ) => Promise<typeof HouseholdReadImportTerminalCheckpointResult.Encoded>;
    readonly readRecipeImportExecution: (
      input: HouseholdReadRecipeImportExecutionInput
    ) => Promise<typeof HouseholdRecipeImportExecutionView.Encoded>;
    readonly readRecipeRecoveryAttempt: (
      input: HouseholdReadRecipeRecoveryAttemptInput
    ) => Promise<typeof HouseholdReadRecipeRecoveryAttemptResult.Encoded>;
    readonly recordRecipeImportDispatch: (
      input: typeof HouseholdRecordRecipeImportDispatchInput.Type
    ) => Promise<typeof HouseholdRecordRecipeImportDispatchResult.Encoded>;
    readonly resolveRecipeImportSource: (
      input: typeof HouseholdResolveRecipeImportSourceInput.Type
    ) => Promise<unknown>;
    readonly transitionRecipeImportLifecycle: (
      input: typeof HouseholdTransitionRecipeImportLifecycleInput.Type
    ) => Promise<unknown>;
  };
}

const RpcErrorEnvelope = Schema.Struct({
  _tag: Schema.Literal("~alchemy/rpc/error"),
  error: Schema.Struct({ reason: Schema.optionalKey(Schema.String) }),
});

const dependencyFailure = () =>
  new ImportEvidenceEventFailure({
    reason: "dependency_unavailable",
    retryable: true,
  });

const rpc = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ catch: dependencyFailure, try: run }).pipe(
    Effect.flatMap((value) => {
      const rejected = Schema.decodeUnknownOption(RpcErrorEnvelope)(value);
      if (rejected._tag === "None") {
        // Raw Workerd service bindings retain hidden RPC metadata. Normalize to
        // the plain structured clone returned by the Alchemy binding adapter.
        return Effect.try({
          catch: dependencyFailure,
          try: () => structuredClone(value),
        });
      }
      return Effect.fail(
        rejected.value.error.reason === "persistence_unavailable"
          ? dependencyFailure()
          : new ImportEvidenceEventFailure({
              reason: "stale_event",
              retryable: false,
            })
      );
    })
  );

const terminalRpc = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: () =>
      HouseholdRecipeImportFailure.make({
        reason: "persistence_unavailable",
      }),
    try: run,
  }).pipe(
    Effect.flatMap((value) => {
      const rejected = Schema.decodeUnknownOption(RpcErrorEnvelope)(value);
      if (rejected._tag === "Some") {
        return Effect.fail(
          HouseholdRecipeImportFailure.make({
            reason:
              rejected.value.error.reason === "persistence_unavailable"
                ? "persistence_unavailable"
                : "illegal_transition",
          })
        );
      }
      return Effect.try({
        catch: () =>
          HouseholdRecipeImportFailure.make({
            reason: "persistence_unavailable",
          }),
        try: () => structuredClone(value),
      });
    })
  );

const terminalHousehold = (environment: Environment) => ({
  admitRecipeImport: (input: typeof HouseholdAdmitRecipeImportInput.Type) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.admitRecipeImport(input)
    ),
  mutateEvidenceStage: (
    input: typeof HouseholdMutateEvidenceStageInput.Encoded
  ) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.mutateEvidenceStage(input)
    ),
  prepareRecipeRecovery: (
    input: typeof HouseholdPrepareRecipeRecoveryInput.Encoded
  ) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.prepareRecipeRecovery(input)
    ),
  readEvidenceReferences: (input: HouseholdReadEvidenceReferencesInput) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readEvidenceReferences(input)
    ),
  readEvidenceStage: (input: HouseholdReadEvidenceStageInput) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readEvidenceStage(input)
    ),
  readImportTerminalCheckpoint: (
    input: HouseholdReadImportTerminalCheckpointInput
  ) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readImportTerminalCheckpoint(input)
    ),
  readRecipeImportExecution: (input: HouseholdReadRecipeImportExecutionInput) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readRecipeImportExecution(input)
    ),
  readRecipeRecoveryAttempt: (input: HouseholdReadRecipeRecoveryAttemptInput) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readRecipeRecoveryAttempt(input)
    ),
  recordRecipeImportDispatch: (
    input: typeof HouseholdRecordRecipeImportDispatchInput.Type
  ) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.recordRecipeImportDispatch(input)
    ),
  resolveRecipeImportSource: (
    input: typeof HouseholdResolveRecipeImportSourceInput.Type
  ) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.resolveRecipeImportSource(input)
    ),
  transitionRecipeImportLifecycle: (
    input: typeof HouseholdTransitionRecipeImportLifecycleInput.Type
  ) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.transitionRecipeImportLifecycle(input)
    ),
});

const ProviderTerminalAttemptCommand = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  admission: HouseholdSystemAdmission,
  canonicalSourceId: SourceCanonicalId,
  completedAt: Schema.optionalKey(ImportTimestamp),
  correlationId: ImportCorrelationId,
  dispatchId: Schema.String,
  executionGeneration: ImportIntentExecutionGeneration,
  inputFingerprint: Sha256Hex,
  intentId: RecipeImportIntentId,
  stage: Schema.Literals(["speech", "visual"]),
});

const VisualResumeCommand = Schema.Struct({
  admission: HouseholdSystemAdmission,
  canonicalSourceId: SourceCanonicalId,
  importId: ImportId,
  mode: Schema.Literals(["absent", "present"]),
});

const DispatchTraceDurabilityCommand = Schema.Struct({
  admission: HouseholdMemberAdmission,
  mode: Schema.Literals(["record_response_lost", "start_response_lost"]),
  sourceUrl: Schema.String,
  trace: ImportTraceContext,
});

const testMutationId = (seed: string) =>
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`household-provider-test:v1:${seed}`)
    )
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    ),
    Effect.map(Schema.decodeUnknownSync(HouseholdImportMutationId))
  );

const retryableR2Failure = (stage: "store" | "verify") =>
  new RetryableAcquisitionError({ reason: "container_rpc", stage });

const r2Object = (object: WorkerTestR2Object): R2ObjectLike => {
  let projected: R2ObjectLike = {
    checksums: object.checksums,
    size: object.size,
  };
  if (object.customMetadata !== undefined) {
    projected = { ...projected, customMetadata: object.customMetadata };
  }
  if (object.httpMetadata !== undefined) {
    projected = { ...projected, httpMetadata: object.httpMetadata };
  }
  return projected;
};

const r2ObjectBody = (object: WorkerTestR2ObjectBody): R2ObjectBodyLike => ({
  ...r2Object(object),
  arrayBuffer: () =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => object.arrayBuffer(),
    }),
  text: () =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => object.text(),
    }),
});

const acquisitionBucket = (
  environment: Environment
): AcquisitionBucketLike => ({
  get: (key) =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => environment.ImportEvidenceBucket.get(key),
    }).pipe(
      Effect.map((object) => (object === null ? null : r2ObjectBody(object)))
    ),
  head: (key) =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => environment.ImportEvidenceBucket.head(key),
    }).pipe(
      Effect.map((object) => (object === null ? null : r2Object(object)))
    ),
  put: (key, value, options) =>
    Effect.gen(function* putTestR2Object() {
      const body = yield* workerTestR2PutBody(value, options.contentLength);
      return yield* Effect.tryPromise({
        catch: () => retryableR2Failure("store"),
        try: () => environment.ImportEvidenceBucket.put(key, body, options),
      });
    }).pipe(
      Effect.map((object) => (object === null ? null : r2Object(object)))
    ),
});

const sha256 = (bytes: Uint8Array) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
  ).pipe(
    Effect.map((value) =>
      Array.from(new Uint8Array(value), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(Sha256Hex))
  );

const runVisualResumeProof = (
  environment: Environment,
  command: typeof VisualResumeCommand.Type
) =>
  Effect.gen(function* runInstalledVisualResumeProof() {
    const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(1);
    const executionGeneration = Schema.decodeUnknownSync(
      ImportIntentExecutionGeneration
    )(1);
    const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
      command.importId
    );
    const bucket = acquisitionBucket(environment);
    const mediaBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    const sourceMediaSha256 = yield* sha256(mediaBytes);
    const prepared: PreparedMediaArtifact = {
      artifactId: `visual-resume:${command.importId}`,
      audioStreams: [{ codec: "aac", index: 1 }],
      bytes: mediaBytes.byteLength,
      durationSeconds: 1,
      metadata: {
        canonicalId: command.canonicalSourceId,
        canonicalUrl: `https://www.tiktok.com/@mealplanner/video/${command.canonicalSourceId}`,
        caption: "Synthetic visual resume evidence",
        creator: {
          displayName: "Meal Planner",
          handle: "mealplanner",
          id: "meal-planner",
        },
        observedAt: "2026-08-23T12:00:00.000Z",
        provenance: {
          canonicalUrl: "provider_observed",
          caption: "creator_provided",
          creator: {
            displayName: "provider_observed",
            handle: "provider_observed",
            id: "provider_observed",
          },
          publishedAt: null,
        },
        publishedAt: null,
      },
      sha256: sourceMediaSha256,
      videoStreams: [{ codec: "h264", index: 0 }],
    };
    const mediaObject: AcquisitionMediaObjectLike = {
      cleanup: () => Effect.void,
      prepare: () => Effect.succeed(prepared),
      readArtifact: () => Stream.make(mediaBytes),
    };
    const acquisition = yield* acquireStoreVerify(bucket, mediaObject, {
      canonicalId: command.canonicalSourceId,
      generation,
      importId: command.importId,
    });
    if (acquisition._tag !== "VerifiedAcquisition") {
      return yield* Effect.die("Expected verified acquisition evidence");
    }
    const transcript = yield* TranscriptEvidenceStore.pipe(
      Effect.flatMap((store) =>
        store.putVerified({
          document: {
            acquisitionGeneration: generation,
            cost: {
              certainty: "known",
              currency: "USD",
              estimatedMicroUsd: 1,
            },
            createdAt: Schema.decodeUnknownSync(ImportTimestamp)(
              "2026-08-23T12:00:01.000Z"
            ),
            deleteAt: acquisition.evidence.deleteAt,
            detectedLanguage: "en",
            dispatchId: `speech:${command.importId}:${generation}`,
            importId: command.importId,
            model: "fixture-speech-v1",
            provider: "fixture",
            schemaVersion: 1,
            segments: [
              {
                endMilliseconds: 1000,
                startMilliseconds: 0,
                text: "Synthetic transcript",
              },
            ],
            sourceMediaSha256,
            text: "Synthetic transcript",
            usage: {
              audioDurationMilliseconds: 1000,
              inputBytes: mediaBytes.byteLength,
            },
          },
        })
      ),
      Effect.provide(TranscriptEvidenceStoreLive(bucket))
    );
    const repositoryInput = {
      acquisitionGeneration: generation,
      canonicalSourceId: command.canonicalSourceId,
      correlationId: Schema.decodeUnknownSync(ImportCorrelationId)(
        "00000000-0000-4000-8000-000000000196"
      ),
      executionGeneration,
      householdDomain: terminalHousehold(environment),
      intentId,
      mutationId: testMutationId,
      organizationId: command.admission.organizationId,
    };
    const dispatchId = `visual:${command.importId}:${generation}`;
    const startedAt = Schema.decodeUnknownSync(ImportTimestamp)(
      "2026-08-23T12:00:02.000Z"
    );
    yield* terminalHousehold(environment).mutateEvidenceStage({
      admission: command.admission,
      expectedGeneration: executionGeneration,
      inputFingerprint: sourceMediaSha256,
      intentId,
      mutationId: "9".repeat(64),
      operation: {
        _tag: "Claim",
        dispatchId,
        stage: "visual",
        startedAt: "2026-08-23T12:00:02.000Z",
      },
    });
    const frameBytes = new Uint8Array([1, 2, 3]);
    const frameSha256 = yield* sha256(frameBytes);
    const frames = [
      {
        bytes: frameBytes,
        height: 1,
        mimeType: "image/jpeg" as const,
        sha256: frameSha256,
        timestampMilliseconds: 0,
        width: 1,
      },
    ] as const;
    if (command.mode === "present") {
      yield* VisualEvidenceStore.pipe(
        Effect.flatMap((store) =>
          store.putVerified({
            frames,
            manifest: {
              acquisitionGeneration: generation,
              cost: {
                certainty: "estimated",
                currency: "USD",
                estimatedMicroUsd: 50_000,
              },
              createdAt: startedAt,
              dispatchId,
              importId: command.importId,
              model: "@cf/meta/llama-4-scout-17b-16e-instruct",
              observations: [],
              outcome: "empty",
              provider: "workers_ai",
              retention: {
                configuredAgeSeconds: 604_800,
                policy: "r2_bucket_object_age",
              },
              schemaVersion: 1,
              sourceEvidenceDeleteAt: acquisition.evidence.deleteAt,
              sourceMediaSha256,
              usage: { inputBytes: 3, inputFrames: 1, modelCalls: 1 },
            },
          })
        ),
        Effect.provide(VisualEvidenceStoreLive(bucket))
      );
    }
    const callsKey = `visual-resume-provider-calls:${command.importId}`;
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
                      arguments: JSON.stringify({ observations: [] }),
                      name: "record_visual_evidence",
                    },
                    id: "visual-resume-call",
                    type: "function",
                  },
                ],
              },
            },
          ],
        }),
      async () => {
        const calls = Number(
          (await environment.EVIDENCE_EVENT_RESULTS.get(callsKey)) ?? "0"
        );
        await environment.EVIDENCE_EVENT_RESULTS.put(
          callsKey,
          String(calls + 1)
        );
      }
    );
    const extractor = yield* makeInstalledVisualEvidenceExtractor({
      correlationId: repositoryInput.correlationId,
      dispatch: localDispatchGate,
      transport,
    });
    const visualRepository =
      makeHouseholdVisualEvidenceRepository(repositoryInput);
    const pipelineInput = {
      bucket,
      extractor,
      frameSampler: { sample: () => Effect.succeed(frames) },
      importId: command.importId,
      importRepository: {
        readCurrent: () =>
          Effect.succeed(
            Option.some({
              acquisitionGeneration: generation,
              canonicalSourceId: command.canonicalSourceId,
              importId: command.importId,
              sourceKind: "tiktok" as const,
              status: { kind: "transcribed" },
            })
          ),
      },
      now: () => startedAt,
      visualDispatchId: dispatchId,
      visualRepository,
    } as const;
    const first =
      yield* extractVisualEvidenceForTranscribedImport(pipelineInput);
    const replay =
      yield* extractVisualEvidenceForTranscribedImport(pipelineInput);
    const stage = yield* terminalHousehold(environment).readEvidenceStage({
      admission: command.admission,
      expectedGeneration: executionGeneration,
      intentId,
      stage: "visual",
    });
    return {
      first,
      providerCalls: Number(
        (yield* Effect.promise(() =>
          environment.EVIDENCE_EVENT_RESULTS.get(callsKey)
        )) ?? "0"
      ),
      replay,
      stage,
      transcriptSha256: transcript.sha256,
    };
  });

const runDispatchTraceDurabilityProof = (
  environment: Environment,
  command: typeof DispatchTraceDurabilityCommand.Type
) =>
  Effect.gen(function* runRealHouseholdDispatchTraceProof() {
    const household = terminalHousehold(environment);
    const committed = yield* household
      .admitRecipeImport({
        admission: command.admission,
        idempotencyKey: Schema.decodeUnknownSync(
          HouseholdAdmitRecipeImportInput.fields.idempotencyKey
        )(`dispatch-trace-${command.mode}`),
        source: { kind: "tiktok", url: command.sourceUrl },
      })
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(HouseholdAdmitRecipeImportResult, {
            onExcessProperty: "error",
          })
        )
      );
    let active = false;
    let providerCalls = 0;
    let recordResponseLost = false;
    let startCalls = 0;
    const dispatcher = makeRecipeImportWorkflowDispatcher({
      householdDomain: {
        recordRecipeImportDispatch: (input) =>
          household.recordRecipeImportDispatch(input).pipe(
            Effect.flatMap((result) => {
              if (
                command.mode === "record_response_lost" &&
                input.outcome === "started" &&
                !recordResponseLost
              ) {
                recordResponseLost = true;
                return Effect.fail(
                  HouseholdRecipeImportFailure.make({
                    reason: "persistence_unavailable",
                  })
                );
              }
              return Effect.succeed(result);
            })
          ),
      },
      importWorkflowStarter: {
        dispatchAdmission: () =>
          Effect.gen(function* startAdmittedImport() {
            startCalls += 1;
            if (active) {
              return "already_active" as const;
            }
            active = true;
            providerCalls += 1;
            const canonicalUrl = yield* Schema.decodeUnknownEffect(
              HouseholdResolveRecipeImportSourceInput.fields.canonicalUrl
            )(command.sourceUrl);
            yield* household.resolveRecipeImportSource({
              admission: {
                actor: {
                  _tag: "System",
                  purpose: "recipe_import_lifecycle_commit",
                },
                organizationId: command.admission.organizationId,
              },
              canonicalSourceId: committed.intent.id,
              canonicalUrl,
              expectedGeneration: 1,
              intentId: committed.intent.id,
              mutationId: yield* testMutationId(
                `dispatch-trace-resolve:${committed.intent.id}`
              ),
              sourceKind: "video",
            });
            if (command.mode === "start_response_lost") {
              return yield* Effect.fail(workflowStartUnavailable());
            }
            return "created" as const;
          }).pipe(Effect.mapError(() => workflowStartUnavailable())),
      },
      registerEvidenceRoute: () => Effect.void,
      retryDelaysMilliseconds: [0],
      scheduleRetry: (effect) => effect,
      trace: command.trace,
    });
    yield* dispatcher.dispatch({
      admission: command.admission,
      committed,
    });
    const execution = yield* household
      .readRecipeImportExecution({
        admission: {
          actor: {
            _tag: "System",
            purpose: "recipe_import_lifecycle_commit",
          },
          organizationId: command.admission.organizationId,
        },
        expectedGeneration: 1,
        intentId: committed.intent.id,
      })
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(HouseholdRecipeImportExecutionView, {
            onExcessProperty: "error",
          })
        )
      );
    return {
      dispatchId: committed.dispatchId,
      intentId: committed.intent.id,
      originalTrace: execution.originalTrace,
      providerCalls,
      startCalls,
      workflowIdentity: committed.workflowIdentity,
    };
  });

const runAmbiguousProviderAttempt = (
  environment: Environment,
  command: typeof ProviderTerminalAttemptCommand.Type
) => {
  const householdDomain = terminalHousehold(environment);
  const repositoryInput = {
    acquisitionGeneration: command.acquisitionGeneration,
    canonicalSourceId: command.canonicalSourceId,
    correlationId: command.correlationId,
    executionGeneration: command.executionGeneration,
    householdDomain,
    intentId: command.intentId,
    mutationId: testMutationId,
    organizationId: command.admission.organizationId,
  };
  const claim = {
    dispatchId: command.dispatchId,
    generation: command.acquisitionGeneration,
    importId: Schema.decodeUnknownSync(ImportId)(command.intentId),
    sourceMediaSha256: command.inputFingerprint,
    startedAt: Schema.decodeUnknownSync(ImportTimestamp)(
      "2026-08-23T10:00:00.000Z"
    ),
  };
  const persist = (
    failAmbiguous: Parameters<
      typeof persistHouseholdProviderTerminalAuthority
    >[0]["failAmbiguous"]
  ) =>
    persistHouseholdProviderTerminalAuthority({
      acquisitionGeneration: command.acquisitionGeneration,
      admission: command.admission,
      executionGeneration: command.executionGeneration,
      failAmbiguous,
      failure: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: command.stage,
      },
      householdDomain,
      intentId: command.intentId,
      now: () =>
        command.completedAt ??
        Schema.decodeUnknownSync(ImportTimestamp)(new Date().toISOString()),
    });
  const invokeProviderOnce = Effect.promise(async () => {
    const key = `provider-attempt-calls:${command.dispatchId}`;
    const calls = Number(
      (await environment.EVIDENCE_EVENT_RESULTS.get(key)) ?? "0"
    );
    await environment.EVIDENCE_EVENT_RESULTS.put(key, String(calls + 1));
  });
  if (command.stage === "speech") {
    const repository =
      makeHouseholdSpeechTranscriptionRepository(repositoryInput);
    return repository.claim(claim).pipe(
      Effect.flatMap((receipt) =>
        (receipt._tag === "Failed" ? Effect.void : invokeProviderOnce).pipe(
          Effect.andThen(persist(repository.fail)),
          Effect.tap(() =>
            receipt._tag === "Failed"
              ? Effect.void
              : householdDomain.transitionRecipeImportLifecycle({
                  admission: command.admission,
                  expectedGeneration: command.executionGeneration,
                  intentId: command.intentId,
                  transition: {
                    _tag: "Fail",
                    attemptIdentity: command.dispatchId,
                    boundary: "speech",
                    code: "analysis_failed",
                    message: "The source could not be analyzed.",
                    recovery: "create_new_intent",
                  },
                })
          )
        )
      )
    );
  }
  const repository = makeHouseholdVisualEvidenceRepository(repositoryInput);
  return repository.claim(claim).pipe(
    Effect.flatMap((receipt) =>
      (receipt._tag === "Failed" ? Effect.void : invokeProviderOnce).pipe(
        Effect.andThen(persist(repository.fail)),
        Effect.tap(() =>
          receipt._tag === "Failed"
            ? Effect.void
            : householdDomain.transitionRecipeImportLifecycle({
                admission: command.admission,
                expectedGeneration: command.executionGeneration,
                intentId: command.intentId,
                transition: {
                  _tag: "Fail",
                  attemptIdentity: command.dispatchId,
                  boundary: "visual",
                  code: "analysis_failed",
                  message: "The source could not be analyzed.",
                  recovery: "create_new_intent",
                },
              })
        )
      )
    )
  );
};

export default {
  async fetch(request: Request, environment: Environment) {
    if (request.headers.get("x-test-dispatch-trace-durability") === "1") {
      try {
        const command = await Schema.decodeUnknownPromise(
          DispatchTraceDurabilityCommand,
          { onExcessProperty: "error" }
        )(await request.json());
        return Response.json(
          await Effect.runPromise(
            runDispatchTraceDurabilityProof(environment, command)
          )
        );
      } catch (error) {
        return Response.json(
          {
            error,
            rejected: true,
          },
          { status: 409 }
        );
      }
    }
    if (request.headers.get("x-test-visual-resume") === "1") {
      try {
        const command = await Schema.decodeUnknownPromise(VisualResumeCommand, {
          onExcessProperty: "error",
        })(await request.json());
        return Response.json(
          await Effect.runPromise(
            runVisualResumeProof(environment, command).pipe(
              Effect.provideService(RuntimeContext, testRuntimeContext)
            )
          )
        );
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error
                ? { message: error.message, stack: error.stack }
                : error,
            rejected: true,
          },
          { status: 409 }
        );
      }
    }
    if (request.headers.get("x-test-provider-terminal-attempt") === "1") {
      try {
        const command = await Schema.decodeUnknownPromise(
          ProviderTerminalAttemptCommand,
          { onExcessProperty: "error" }
        )(await request.json());
        return Response.json(
          await Effect.runPromise(
            runAmbiguousProviderAttempt(environment, command)
          )
        );
      } catch (error) {
        return Response.json(
          { error: JSON.stringify(error), rejected: true },
          { status: 409 }
        );
      }
    }
    if (request.headers.get("x-test-terminal-settlement") !== "1") {
      return new Response(null, { status: 404 });
    }
    try {
      const command = await Schema.decodeUnknownPromise(
        ProviderTerminalSettlementRequest,
        { onExcessProperty: "error" }
      )(await request.json());
      if (!("importId" in command)) {
        throw new Error("terminal settlement command requires an import id");
      }
      const restartProviderStage = (
        stage: "speech" | "visual",
        importId: typeof ImportId.Type
      ) =>
        Effect.tryPromise({
          catch: workflowStartUnavailable,
          try: async () => {
            const stateKey = `${stage}-restart:${importId}`;
            const state =
              await environment.EVIDENCE_EVENT_RESULTS.get(stateKey);
            if (state === "active" || state === "complete") {
              return;
            }
            const callsKey = `${stage}-restart-calls:${importId}`;
            const calls = Number(
              (await environment.EVIDENCE_EVENT_RESULTS.get(callsKey)) ?? "0"
            );
            await environment.EVIDENCE_EVENT_RESULTS.put(
              callsKey,
              String(calls + 1)
            );
            await environment.EVIDENCE_EVENT_RESULTS.put(stateKey, "active");
          },
        });
      const completeProviderStageBeforeRestartResponse = (
        stage: "speech" | "visual",
        importId: typeof ImportId.Type,
        acquisitionGeneration: typeof AcquisitionGeneration.Type,
        executionGeneration: typeof ImportIntentExecutionGeneration.Type
      ) =>
        Effect.gen(function* completeProviderRecoveryBeforeResponseLoss() {
          yield* restartProviderStage(stage, importId);
          const routes = makeD1ImportEvidenceRouteRepository(
            environment.MealPlannerDatabase
          );
          const route = yield* routes
            .get(importId)
            .pipe(Effect.mapError(workflowStartUnavailable));
          if (route === null) {
            return yield* Effect.fail(workflowStartUnavailable());
          }
          const admission = Schema.decodeUnknownSync(HouseholdSystemAdmission)({
            actor: {
              _tag: "System",
              purpose: "recipe_import_lifecycle_commit",
            },
            organizationId: route.organizationId,
          });
          const intentId =
            Schema.decodeUnknownSync(RecipeImportIntentId)(importId);
          const household = terminalHousehold(environment);
          const execution = yield* household
            .readRecipeImportExecution({
              admission,
              expectedGeneration: executionGeneration,
              intentId,
            })
            .pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(HouseholdRecipeImportExecutionView, {
                  onExcessProperty: "error",
                })
              ),
              Effect.mapError(workflowStartUnavailable)
            );
          const currentStage = yield* household
            .readEvidenceStage({
              admission,
              expectedGeneration: executionGeneration,
              intentId,
              stage,
            })
            .pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(HouseholdReadEvidenceStageResult, {
                  onExcessProperty: "error",
                })
              ),
              Effect.mapError(workflowStartUnavailable)
            );
          if (currentStage === null) {
            return yield* Effect.fail(workflowStartUnavailable());
          }
          yield* runAmbiguousProviderAttempt(environment, {
            acquisitionGeneration,
            admission,
            canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
              execution.canonicalSourceId
            ),
            correlationId: Schema.decodeUnknownSync(ImportCorrelationId)(
              "00000000-0000-4000-8000-000000000195"
            ),
            dispatchId: currentStage.dispatchId,
            executionGeneration,
            inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
              currentStage.inputFingerprint
            ),
            intentId,
            stage,
          });
          yield* Effect.promise(() =>
            environment.EVIDENCE_EVENT_RESULTS.put(
              `${stage}-restart:${importId}`,
              "complete"
            )
          );
          return yield* Effect.fail(workflowStartUnavailable());
        }).pipe(Effect.mapError(workflowStartUnavailable));
      const restartSpeech = () => {
        const behavior = request.headers.get("x-test-speech-restart");
        if (behavior === "fail") {
          return Effect.fail(workflowStartUnavailable());
        }
        if (behavior === "terminal-then-fail") {
          return "acquisitionGeneration" in command
            ? completeProviderStageBeforeRestartResponse(
                "speech",
                command.importId,
                command.acquisitionGeneration,
                command.executionGeneration
              )
            : Effect.fail(workflowStartUnavailable());
        }
        return restartProviderStage("speech", command.importId).pipe(
          Effect.as("RestartRequested" as const)
        );
      };
      const result = await Effect.runPromise(
        makeD1ProviderTerminalSettlementService({
          database: environment.MealPlannerDatabase,
          householdDomain: terminalHousehold(environment),
          now: () =>
            Schema.decodeUnknownSync(ImportTimestamp)(new Date().toISOString()),
          recipeRecoveryStarter: { start: () => Effect.void },
          runtimeStage: "pilot-gaia-118",
          trace: Schema.decodeUnknownSync(ImportTraceContext)({
            correlationId: "00000000-0000-4000-8000-000000000188",
          }),
          workflowStarter: {
            restartFromSpeech: restartSpeech,
            restartFromVisual: () =>
              restartProviderStage("visual", command.importId).pipe(
                Effect.as("RestartRequested" as const)
              ),
          },
        }).settle(command)
      );
      if (request.headers.get("x-test-speech-restart") === "lose-response") {
        return Response.json({ responseLost: true }, { status: 409 });
      }
      return Response.json(
        Schema.encodeSync(ProviderTerminalSettlementResponse)(result)
      );
    } catch (error) {
      return Response.json(
        { error: JSON.stringify(error), rejected: true },
        { status: 409 }
      );
    }
  },
  async queue(batch: TestMessageBatch, environment: Environment) {
    const routes = makeD1ImportEvidenceRouteRepository(
      environment.MealPlannerDatabase
    );
    await Promise.all(
      batch.messages.map(async (message) => {
        const safeResult = await Effect.runPromise(
          reconcileImportEvidenceQueueMessage(message.body, {
            bucket: {
              head: (key) =>
                Effect.promise(() =>
                  environment.ImportEvidenceBucket.head(key)
                ).pipe(Effect.mapError(dependencyFailure)),
            },
            household: {
              observeEvidenceReference: (input) =>
                Schema.encodeEffect(HouseholdObserveEvidenceReferenceInput)(
                  input
                ).pipe(
                  Effect.mapError(dependencyFailure),
                  Effect.flatMap((encoded) =>
                    rpc(() =>
                      environment.HouseholdDomainWorker.observeEvidenceReference(
                        encoded
                      )
                    )
                  )
                ),
              readEvidenceReferences: (input) =>
                rpc(() =>
                  environment.HouseholdDomainWorker.readEvidenceReferences(
                    input
                  )
                ),
            },
            routes: {
              get: (importId) =>
                routes.get(importId).pipe(Effect.mapError(dependencyFailure)),
            },
          }).pipe(
            Effect.match({
              onFailure: (error) => ({
                _tag: "Rejected" as const,
                reason: error.reason,
                retryable: error.retryable,
              }),
              onSuccess: (value) => ({ _tag: "Accepted" as const, value }),
            })
          )
        );
        await environment.EVIDENCE_EVENT_RESULTS.put(
          "last",
          JSON.stringify(safeResult)
        );
        if (safeResult._tag === "Rejected" && safeResult.retryable) {
          message.retry();
        } else {
          message.ack();
        }
      })
    );
  },
};
