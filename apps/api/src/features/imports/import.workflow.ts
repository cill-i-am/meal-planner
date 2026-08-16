import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import {
  Cause,
  Config,
  Context,
  Effect,
  Layer,
  Schedule,
  Schema,
} from "effect";

import { ImportEvidenceBucket } from "../../infrastructure/import-evidence-bucket.js";
import { ImportProviderGateway } from "../../infrastructure/import-provider-gateway.js";
import { MealPlannerDatabase } from "../../infrastructure/meal-planner-database.js";
import {
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  PilotProviderBudgetRuntime,
  makePilotProviderBudgetRuntime,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
import type {
  AcquisitionCheckpointRejected,
  DecodedAcquisitionCheckpoint,
} from "./import-acquisition-checkpoint.js";
import {
  continueAcquisitionCheckpoint,
  decodeAcquisitionCheckpoint,
  recoverVerifiedAcquisitionCheckpoint,
} from "./import-acquisition-checkpoint.js";
import {
  runImportVisualAndRecipeWorkflow,
  runPreparedVisualRecoveryWorkflowBranch,
} from "./import-application-workflows.js";
import { loadStagedOperatorCarousel } from "./import-carousel-staging.js";
import {
  prepareTikTokCarouselEvidence,
  produceTikTokCarouselRecipeDraft,
} from "./import-carousel.js";
import { makeD1CarouselEvidenceRepository } from "./import-carousel.repository.d1.js";
import {
  makeR2SpeechAudioExtractor,
  makeR2VisualFrameSampler,
  persistDerivedProviderEvidence,
} from "./import-derived-media.js";
import {
  adaptAcquisitionBucket,
  acquireStoreVerify,
  readVerifiedAcquisitionEvidence,
} from "./import-media-acquirer.js";
import { makeAcquisitionMediaObject } from "./import-media-acquisition-object.client.js";
import { ImportMediaAcquisitionObject } from "./import-media-acquisition-object.js";
import {
  AcquisitionGeneration,
  AcquisitionTaskOutcome,
  MaximumAcquisitionAttemptSeconds,
  MaximumLocalCleanupMilliseconds,
} from "./import-media.model.js";
import type {
  AcquisitionFailureReason,
  AcquisitionStage,
  RetryableAcquisitionFailure,
} from "./import-media.model.js";
import { makeD1ImportObservabilityTraceStore } from "./import-observability.d1.js";
import type {
  AcquisitionDiagnosticReasonCode,
  ImportCorrelationId,
  ImportTraceContext,
} from "./import-observability.js";
import {
  ImportObservabilityTraceStore,
  emitImportObservabilityEvent,
  observeImportWorkflowStart,
} from "./import-observability.js";
import { continueVisualFromSettledSpeech } from "./import-post-speech-visual.js";
import { makePilotProviderDispatchGate } from "./import-provider-kernel.js";
import { makeInstalledRecipeExtractor } from "./import-provider-recipe.js";
import { makeInstalledSpeechTranscriber } from "./import-provider-speech.js";
import {
  makeD1ProviderTerminalCheckpointRepository,
  makeD1ProviderTerminalRecoveryRepository,
} from "./import-provider-terminal.js";
import { makeInstalledVisualEvidenceExtractor } from "./import-provider-visual.js";
import {
  ProviderTaskCheckpoint,
  SpeechProviderTaskCheckpoint,
} from "./import-provider-workflow-checkpoint.js";
import {
  ProviderTaskStepConfig,
  runProviderTask,
  runProviderTaskAttempt,
} from "./import-provider-workflow-task.js";
import { produceRecipeDraftForImport } from "./import-recipe-draft.js";
import { makeD1RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
import { transcribeAcquiredImport } from "./import-speech-transcription.js";
import { makeD1SpeechTranscriptionRepository } from "./import-speech-transcription.repository.d1.js";
import { extractVisualEvidenceForTranscribedImport } from "./import-visual-evidence.js";
import { makeD1VisualEvidenceRepository } from "./import-visual-evidence.repository.d1.js";
import { resolveImportWorkflowInput } from "./import-workflow-input.js";
import {
  PostAcquisitionJournalCheckpoint,
  postAcquisitionRestartOptions,
} from "./import-workflow-journal.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { workflowStartUnavailable } from "./import.errors.js";
import type { WorkflowStartUnavailable } from "./import.errors.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import type { AcquisitionFinalizationResult as AcquisitionFinalizationResultType } from "./import.repository.js";
import { AcquisitionFinalizationResult } from "./import.repository.js";

export const AcquisitionTaskStepConfig = {
  // eslint-disable-next-line sort-keys -- Reviewer-frozen platform retry fields stay in exact documented order.
  retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
  timeout: "17 minutes",
} as const;
export const MaximumNestedAcquisitionAttempts = 9;
export const MaximumScheduledWorkflowSeconds = 2985;
export const MaximumAbsoluteWorkflowSeconds = 3066;

const TypedAcquisitionRetrySchedule = Schedule.exponential("1 second").pipe(
  Schedule.upTo({ times: 2 })
);
const MaximumAcquisitionExecutionMilliseconds =
  MaximumAcquisitionAttemptSeconds * 1000 - MaximumLocalCleanupMilliseconds;

interface AcquisitionAttemptAllocation {
  readonly generation: AcquisitionGeneration;
}

interface ConfirmedAcquisitionRetry {
  readonly _tag: "ConfirmedAcquisitionRetry";
  readonly generation: AcquisitionGeneration;
  readonly reason?: AcquisitionFailureReason;
  readonly stage: AcquisitionStage;
}

interface UnconfirmedAcquisitionRetry {
  readonly _tag: "UnconfirmedAcquisitionRetry";
  readonly stage: "reconcile";
}

type AcquisitionRetry = ConfirmedAcquisitionRetry | UnconfirmedAcquisitionRetry;

const acquisitionFailureReasonCode = (
  failure: ConfirmedAcquisitionRetry
): AcquisitionDiagnosticReasonCode => {
  if (
    failure.reason === "download_timeout" ||
    failure.reason === "acquisition_timeout" ||
    failure.reason === "container_process_timeout"
  ) {
    return "timeout";
  }
  if (failure.reason === "container_exit") {
    return "container_exit";
  }
  if (
    failure.reason === "container_rpc" ||
    failure.reason === "download_dns" ||
    failure.reason === "download_http_response" ||
    failure.reason === "download_source_unavailable" ||
    failure.reason === "download_stream_or_tls"
  ) {
    return "transport";
  }
  return failure.stage === "process" ? "container_exit" : "validation";
};

const acquisitionOutcomeReasonCode = (
  outcome: AcquisitionTaskOutcome
): AcquisitionDiagnosticReasonCode | undefined => {
  if (outcome._tag === "RetryExhausted") {
    return acquisitionFailureReasonCode({
      _tag: "ConfirmedAcquisitionRetry",
      generation: outcome.generation,
      ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
      stage: outcome.stage,
    });
  }
  if (outcome._tag === "TerminalMedia") {
    return outcome.code === "unsupported_streams"
      ? "unsupported_type"
      : "validation";
  }
  if (outcome._tag === "Unavailable") {
    return "transport";
  }
  return outcome._tag === "UnsupportedCarousel"
    ? "unsupported_type"
    : undefined;
};

export const observeAcquisitionCheckpoint = (
  correlationId: ImportCorrelationId,
  checkpoint: DecodedAcquisitionCheckpoint
) =>
  checkpoint._tag === "AcquisitionCheckpointRejected"
    ? emitImportObservabilityEvent({
        correlationId,
        event: "acquisition.rejection",
        outcome: "rejected",
        reasonCode: "decode_schema",
      }).pipe(
        Effect.andThen(
          emitImportObservabilityEvent({
            correlationId,
            event: "acquisition.terminal",
            outcome: "rejected",
            reasonCode: "decode_schema",
          })
        )
      )
    : emitImportObservabilityEvent({
        correlationId,
        event: "acquisition.decode",
        outcome: "decoded",
      });

export const observeAcquisitionSettlement = (
  correlationId: ImportCorrelationId,
  outcome: AcquisitionTaskOutcome,
  settlement: AcquisitionFinalizationResultType
) => {
  const reasonCode =
    settlement === "Superseded"
      ? ("state_fence" as const)
      : acquisitionOutcomeReasonCode(outcome);
  const settled = emitImportObservabilityEvent({
    correlationId,
    event: "acquisition.settlement",
    outcome: settlement === "Superseded" ? "rejected" : "settled",
    ...(settlement === "Superseded" ? { reasonCode } : {}),
  });
  return settled.pipe(
    Effect.andThen(
      emitImportObservabilityEvent({
        correlationId,
        event: "acquisition.terminal",
        outcome: reasonCode === undefined ? "succeeded" : "rejected",
        ...(reasonCode === undefined ? {} : { reasonCode }),
      })
    )
  );
};

export const runAcquisitionTask = <
  Allocation extends AcquisitionAttemptAllocation,
  AllocationError,
>(
  allocate: () => Effect.Effect<Allocation, AllocationError>,
  attempt: (
    allocation: Allocation
  ) => Effect.Effect<AcquisitionTaskOutcome, RetryableAcquisitionFailure>,
  options?: { readonly correlationId?: ImportCorrelationId }
) =>
  Effect.suspend(() => {
    let confirmedGeneration: AcquisitionGeneration | undefined;
    let attemptNumber = 0;
    let executionNumber = 0;
    const runAttempt = Effect.suspend(() => {
      executionNumber += 1;
      return allocate().pipe(
        Effect.mapError(
          (): UnconfirmedAcquisitionRetry => ({
            _tag: "UnconfirmedAcquisitionRetry",
            stage: "reconcile",
          })
        ),
        Effect.tap((allocation) =>
          Effect.sync(() => {
            confirmedGeneration = allocation.generation;
          })
        ),
        Effect.flatMap((allocation) =>
          Effect.gen(function* observeAcquisitionAttempt() {
            attemptNumber += 1;
            if (options?.correlationId !== undefined) {
              yield* emitImportObservabilityEvent({
                attempt: attemptNumber,
                correlationId: options.correlationId,
                event: "acquisition.dispatch",
                outcome: "started",
              });
            }
            const outcome = yield* attempt(allocation);
            if (outcome.generation !== allocation.generation) {
              return yield* Effect.fail({
                _tag: "RetryableAcquisitionFailure" as const,
                stage: "verify" as const,
              });
            }
            if (options?.correlationId !== undefined) {
              yield* emitImportObservabilityEvent({
                attempt: attemptNumber,
                correlationId: options.correlationId,
                event: "acquisition.response",
                outcome: "succeeded",
              });
            }
            return outcome;
          }).pipe(
            Effect.mapError(
              // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect.mapError is a typed Effect combinator, not Promise callback control flow.
              (error): ConfirmedAcquisitionRetry => {
                const reason = "reason" in error ? error.reason : undefined;
                return {
                  _tag: "ConfirmedAcquisitionRetry",
                  generation: allocation.generation,
                  ...(reason === undefined ? {} : { reason }),
                  stage: error.stage,
                };
              }
            )
          )
        ),
        Effect.timeoutOrElse({
          duration: `${MaximumAcquisitionExecutionMilliseconds} millis`,
          orElse: (): Effect.Effect<never, AcquisitionRetry> =>
            confirmedGeneration === undefined
              ? Effect.fail({
                  _tag: "UnconfirmedAcquisitionRetry",
                  stage: "reconcile",
                })
              : Effect.fail({
                  _tag: "ConfirmedAcquisitionRetry",
                  generation: confirmedGeneration,
                  reason: "acquisition_timeout",
                  stage: "process",
                }),
        }),
        // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect.tapError is a typed Effect combinator, not Promise callback control flow.
        Effect.tapError((error) => {
          if (
            options?.correlationId === undefined ||
            error._tag !== "ConfirmedAcquisitionRetry"
          ) {
            return Effect.void;
          }
          const reasonCode = acquisitionFailureReasonCode(error);
          const response = emitImportObservabilityEvent({
            attempt: attemptNumber,
            correlationId: options.correlationId,
            event:
              reasonCode === "timeout"
                ? "acquisition.timeout"
                : "acquisition.response",
            outcome: reasonCode === "timeout" ? "timed_out" : "failed",
            reasonCode,
          });
          return executionNumber < 3
            ? response.pipe(
                Effect.andThen(
                  emitImportObservabilityEvent({
                    attempt: attemptNumber,
                    correlationId: options.correlationId,
                    event: "acquisition.retry",
                    outcome: "retrying",
                    reasonCode,
                  })
                )
              )
            : response;
        })
      );
    });

    return runAttempt.pipe(
      Effect.retry({ schedule: TypedAcquisitionRetrySchedule }),
      Effect.matchEffect({
        onFailure: (error) => {
          if (error._tag !== "ConfirmedAcquisitionRetry") {
            return Effect.fail(error);
          }
          const outcome =
            error.reason === "download_source_unavailable"
              ? {
                  _tag: "Unavailable" as const,
                  code: "private_or_unavailable" as const,
                  generation: error.generation,
                }
              : {
                  _tag: "RetryExhausted" as const,
                  attempts: 3 as const,
                  generation: error.generation,
                  ...(error.reason === undefined
                    ? {}
                    : { reason: error.reason }),
                  stage: error.stage,
                };
          return Effect.succeed(outcome);
        },
        onSuccess: Effect.succeed,
      })
    );
  });

export { ImportWorkflowInput } from "./import-workflow-input.js";
const AcquisitionClaimCheckpoint = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Finished") }),
  Schema.Struct({
    _tag: Schema.Literal("Acquiring"),
    canonicalId: SourceCanonicalId,
  }),
]);
const CarouselEvidenceTaskCheckpoint = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Failed"),
    code: Schema.String,
    stage: Schema.Literal("visual"),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Succeeded"),
    evidence: Schema.Struct({
      completedAt: ImportTimestamp,
      descriptorFingerprint: Schema.String,
      dispatchId: Schema.String,
      generation: AcquisitionGeneration,
      imageCount: Schema.Number,
      importId: ImportId,
      manifestKey: Schema.String,
      manifestSha256: Schema.String,
    }),
    stage: Schema.Literal("visual"),
  }),
]);

const currentPilotBudgetTimestamp = () =>
  Schema.decodeUnknownSync(PilotBudgetTimestamp)(new Date().toISOString());

export default class ImportAcquisitionWorkflow extends Cloudflare.Workflow<ImportAcquisitionWorkflow>()(
  "ImportAcquisitionWorkflow",
  Effect.gen(function* ImportAcquisitionWorkflowInit() {
    const runtimeContext = yield* RuntimeContext;
    const queryDatabase =
      yield* Cloudflare.D1.QueryDatabase(MealPlannerDatabase);
    const pilotProviderBudgetRuntime = makePilotProviderBudgetRuntime(
      yield* Config.string("ALCHEMY_STAGE")
    );
    const providerGateway = yield* Cloudflare.AI.QueryGateway(
      ImportProviderGateway
    );
    const evidenceBucket =
      yield* Cloudflare.R2.ReadWriteBucket(ImportEvidenceBucket);
    const mediaObjects = yield* ImportMediaAcquisitionObject;

    return (rawInput: unknown) =>
      Effect.gen(function* initializeImportAcquisitionWorkflow() {
        const workflowInput = yield* resolveImportWorkflowInput(rawInput).pipe(
          Effect.orDie
        );
        const database = yield* queryDatabase.raw;
        const traceStore = makeD1ImportObservabilityTraceStore(database, () =>
          new Date().toISOString()
        );
        return yield* Effect.gen(function* runImportAcquisitionWorkflow() {
          const { importId, trace } = workflowInput;
          const { correlationId } = trace;
          yield* observeImportWorkflowStart(trace);
          const rawBucket = yield* evidenceBucket.raw;
          const repository = makeD1ImportRepository(database);
          const terminalCheckpoints =
            makeD1ProviderTerminalCheckpointRepository(database);
          const terminalRecovery = makeD1ProviderTerminalRecoveryRepository(
            database,
            pilotProviderBudgetRuntime.runtimeStage
          );
          const now = currentPilotBudgetTimestamp;
          const dispatch = makePilotProviderDispatchGate({
            correlationId,
            now,
            repository: makeD1PilotProviderBudgetRepository(
              database,
              pilotProviderBudgetRuntime.runtimeStage
            ),
            runId: Schema.decodeUnknownSync(PilotBudgetRunId)(
              `gaia-118:${importId}`
            ),
            runtime: pilotProviderBudgetRuntime,
          });
          const speechTranscriber = yield* makeInstalledSpeechTranscriber({
            client: providerGateway,
            correlationId,
            dispatch,
          }).pipe(Effect.provideService(RuntimeContext, runtimeContext));
          const visualExtractor = yield* makeInstalledVisualEvidenceExtractor({
            client: providerGateway,
            correlationId,
            dispatch,
          });
          const recipeExtractor = yield* makeInstalledRecipeExtractor({
            client: providerGateway,
            correlationId,
            dispatch,
          });
          const task = <A, E>(
            name: string,
            stage: "recipe" | "speech" | "visual",
            effect: Effect.Effect<A, E>
          ) =>
            runProviderTask(
              name,
              stage,
              effect,
              () => ({
                _tag: "Succeeded" as const,
                stage,
              }),
              trace
            ).pipe(
              Effect.flatMap((value) =>
                Schema.decodeUnknownEffect(ProviderTaskCheckpoint, {
                  onExcessProperty: "error",
                })(value)
              ),
              Effect.orDie
            );
          const persistTerminal = (
            failure: typeof ProviderTaskCheckpoint.Type & {
              readonly _tag: "Failed";
            },
            generation: AcquisitionGeneration
          ) =>
            Cloudflare.Workflows.task(
              `persist-${failure.stage}-terminal-v1`,
              terminalCheckpoints
                .persist({
                  acquisitionGeneration: generation,
                  completedAt: now(),
                  failureCode: failure.code,
                  importId,
                  providerStage: failure.stage,
                })
                .pipe(Effect.orDie)
            );
          const completeVisualAndRecipe = (
            acquisitionGeneration: AcquisitionGeneration,
            preparedDispatchIds?: {
              readonly speechDispatchId: string;
              readonly visualDispatchId: string;
            }
          ) =>
            runImportVisualAndRecipeWorkflow({
              persistTerminal: (failure) =>
                persistTerminal(failure, acquisitionGeneration),
              recipe: task(
                "extract-recipe-v1",
                "recipe",
                produceRecipeDraftForImport({
                  bucket: adaptAcquisitionBucket(rawBucket),
                  extractor: recipeExtractor,
                  importId,
                  importRepository: repository,
                  now,
                  recipeRepository: makeD1RecipeDraftRepository(database),
                })
              ),
              visual: (() => {
                const continueVisual = ({
                  speechDispatchId,
                  visualDispatchId,
                }: {
                  readonly speechDispatchId: string;
                  readonly visualDispatchId: string;
                }) =>
                  task(
                    "extract-visual-evidence-v1",
                    "visual",
                    extractVisualEvidenceForTranscribedImport({
                      bucket: adaptAcquisitionBucket(rawBucket),
                      extractor: visualExtractor,
                      frameSampler: makeR2VisualFrameSampler(
                        adaptAcquisitionBucket(rawBucket)
                      ),
                      importId,
                      importRepository: repository,
                      now,
                      speechDispatchId,
                      visualDispatchId,
                      visualRepository:
                        makeD1VisualEvidenceRepository(database),
                    })
                  );
                return preparedDispatchIds === undefined
                  ? continueVisualFromSettledSpeech({
                      acquisitionGeneration,
                      continueVisual,
                      importId,
                      terminalRecovery,
                    })
                  : continueVisual(preparedDispatchIds);
              })(),
            });
          if ("resume" in workflowInput) {
            return yield* runPreparedVisualRecoveryWorkflowBranch({
              completeVisualAndRecipe: (recovery) =>
                completeVisualAndRecipe(
                  recovery.acquisitionGeneration,
                  recovery
                ),
              findStored: repository.findById(importId).pipe(Effect.orDie),
              importId,
              resolveDispatchIds: (stored) =>
                Effect.all({
                  speechDispatchId: terminalRecovery.speechDispatchId({
                    acquisitionGeneration: stored.acquisitionGeneration,
                    importId,
                  }),
                  visualDispatchId: terminalRecovery.visualDispatchId({
                    acquisitionGeneration: stored.acquisitionGeneration,
                    importId,
                  }),
                }).pipe(Effect.orDie),
            });
          }
          const stagedCarousel = yield* loadStagedOperatorCarousel({
            bucket: adaptAcquisitionBucket(rawBucket),
            importId,
          }).pipe(Effect.orDie);
          if (stagedCarousel !== null) {
            const encodedCarouselEvidence = yield* runProviderTask(
              "extract-carousel-visual-evidence-v1",
              "visual",
              prepareTikTokCarouselEvidence({
                adapter: stagedCarousel.adapter,
                bucket: adaptAcquisitionBucket(rawBucket),
                carouselRepository: makeD1CarouselEvidenceRepository(database),
                descriptor: stagedCarousel.descriptor,
                importId,
                now,
                visualExtractor,
              }),
              (evidence) => ({
                _tag: "Succeeded" as const,
                evidence,
                stage: "visual" as const,
              }),
              trace
            );
            const carouselEvidence = yield* Schema.decodeUnknownEffect(
              CarouselEvidenceTaskCheckpoint
            )(encodedCarouselEvidence).pipe(Effect.orDie);
            if (carouselEvidence._tag === "Failed") {
              return carouselEvidence;
            }
            const recipe = yield* task(
              "extract-carousel-recipe-v1",
              "recipe",
              produceTikTokCarouselRecipeDraft({
                bucket: adaptAcquisitionBucket(rawBucket),
                descriptor: stagedCarousel.descriptor,
                evidence: carouselEvidence.evidence,
                extractor: recipeExtractor,
                importId,
                now,
                recipeRepository: makeD1RecipeDraftRepository(database),
              })
            );
            return recipe;
          }
          const rawClaim = yield* Cloudflare.Workflows.task(
            "claim-acquisition-v1",
            repository.claimAcquisition(importId).pipe(
              Effect.map((claim) =>
                claim._tag === "Finished"
                  ? ({ _tag: "Finished" } as const)
                  : {
                      _tag: "Acquiring" as const,
                      canonicalId: claim.import.canonicalSourceId,
                    }
              ),
              Effect.orDie
            )
          );
          const claim = yield* Schema.decodeUnknownEffect(
            AcquisitionClaimCheckpoint
          )(rawClaim).pipe(Effect.orDie);
          if (claim._tag === "Finished") {
            return { _tag: "NoAcquisitionRequired" as const };
          }
          const stub = mediaObjects.getByName(importId);
          const mediaObject = makeAcquisitionMediaObject(stub);
          const encodedOutcome = yield* Cloudflare.Workflows.task(
            "resolve-acquire-store-verify-v2",
            recoverVerifiedAcquisitionCheckpoint({
              expectedCanonicalId: claim.canonicalId,
              findStored: repository.findById(importId),
              importId,
              readEvidence: (stored) =>
                readVerifiedAcquisitionEvidence(
                  adaptAcquisitionBucket(rawBucket),
                  {
                    canonicalId: stored.canonicalSourceId,
                    generation: stored.acquisitionGeneration,
                    importId,
                  }
                ),
            }).pipe(
              Effect.flatMap(
                (
                  recovered
                ): Effect.Effect<
                  AcquisitionTaskOutcome | AcquisitionCheckpointRejected,
                  UnconfirmedAcquisitionRetry
                > =>
                  recovered === null
                    ? runAcquisitionTask(
                        () => repository.beginAcquisitionAttempt(importId),
                        (allocation) =>
                          allocation.canonicalSourceId === claim.canonicalId
                            ? acquireStoreVerify(
                                adaptAcquisitionBucket(rawBucket),
                                mediaObject,
                                {
                                  beforeCleanup: (
                                    prepared,
                                    acquisitionMediaObject
                                  ) =>
                                    persistDerivedProviderEvidence(
                                      adaptAcquisitionBucket(rawBucket),
                                      acquisitionMediaObject,
                                      prepared,
                                      {
                                        generation: allocation.generation,
                                        importId,
                                      }
                                    ),
                                  canonicalId: allocation.canonicalSourceId,
                                  generation: allocation.generation,
                                  importId,
                                }
                              )
                            : Effect.die(
                                "Persisted canonical identity changed"
                              ),
                        { correlationId }
                      )
                    : Effect.succeed(recovered)
              ),
              Effect.map((outcome) =>
                outcome._tag === "AcquisitionCheckpointRejected"
                  ? outcome
                  : Schema.encodeSync(AcquisitionTaskOutcome)(outcome)
              ),
              Effect.orDie
            ),
            AcquisitionTaskStepConfig
          );
          const decodedCheckpoint = decodeAcquisitionCheckpoint(encodedOutcome);
          yield* observeAcquisitionCheckpoint(correlationId, decodedCheckpoint);
          if (decodedCheckpoint._tag === "AcquisitionCheckpointRejected") {
            return decodedCheckpoint;
          }
          const { outcome } = decodedCheckpoint;
          const encodedFinalization = yield* Cloudflare.Workflows.task(
            "record-acquisition-v2",
            (outcome._tag === "VerifiedAcquisition"
              ? continueAcquisitionCheckpoint({
                  findStored: repository.findById(importId),
                  importId,
                  onAccepted: () => Effect.succeed<"Recorded">("Recorded"),
                  outcome,
                }).pipe(
                  Effect.flatMap((continuation) =>
                    continuation === "Recorded"
                      ? Effect.succeed(continuation)
                      : repository.recordAcquired(
                          importId,
                          outcome.generation,
                          outcome.evidence,
                          outcome.evidence.acquiredAt
                        )
                  )
                )
              : repository.recordAcquisitionFailure(
                  importId,
                  outcome.generation,
                  outcome,
                  Schema.decodeUnknownSync(ImportTimestamp)(
                    new Date().toISOString()
                  )
                )
            ).pipe(
              Effect.map(Schema.encodeSync(AcquisitionFinalizationResult)),
              Effect.orDie
            )
          );
          const finalization = yield* Schema.decodeUnknownEffect(
            AcquisitionFinalizationResult
          )(encodedFinalization).pipe(Effect.orDie);
          yield* observeAcquisitionSettlement(
            correlationId,
            outcome,
            finalization
          );
          if (outcome._tag !== "VerifiedAcquisition") {
            return encodedOutcome;
          }
          const encodedSpeech = yield* Cloudflare.Workflows.task(
            "transcribe-video-v1",
            continueAcquisitionCheckpoint({
              findStored: repository.findById(importId),
              importId,
              onAccepted: () =>
                terminalRecovery
                  .speechDispatchId({
                    acquisitionGeneration: outcome.generation,
                    importId,
                  })
                  .pipe(
                    Effect.orDie,
                    Effect.flatMap((speechDispatchId) =>
                      runProviderTaskAttempt(
                        "speech",
                        transcribeAcquiredImport({
                          acquisitionRepository: repository,
                          audioExtractor: makeR2SpeechAudioExtractor(
                            adaptAcquisitionBucket(rawBucket)
                          ),
                          bucket: adaptAcquisitionBucket(rawBucket),
                          dispatchId: speechDispatchId,
                          importId,
                          now,
                          speechTranscriber,
                          transcriptionRepository:
                            makeD1SpeechTranscriptionRepository(database),
                        }),
                        () => ({
                          _tag: "Succeeded" as const,
                          stage: "speech" as const,
                        }),
                        trace
                      )
                    )
                  ),
              outcome,
            }).pipe(Effect.orDie),
            ProviderTaskStepConfig
          );
          const speech = yield* Schema.decodeUnknownEffect(
            SpeechProviderTaskCheckpoint
          )(encodedSpeech).pipe(Effect.orDie);
          if (speech._tag === "AcquisitionCheckpointRejected") {
            return speech;
          }
          if (speech._tag === "Failed") {
            yield* persistTerminal(speech, outcome.generation);
            return speech;
          }
          const failure = yield* completeVisualAndRecipe(outcome.generation);
          if (failure !== null) {
            return failure;
          }
          return encodedOutcome;
        }).pipe(
          Effect.provideService(ImportObservabilityTraceStore, traceStore)
        );
      }).pipe(
        Effect.provideService(
          PilotProviderBudgetRuntime,
          pilotProviderBudgetRuntime
        )
      );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.AI.QueryGatewayBinding,
        Cloudflare.R2.ReadWriteBucketBinding
      )
    )
  )
) {}

export const EnsureStartedResult = Schema.Literals([
  "created",
  "already_active",
  "paused",
  "restarted",
]);
export type EnsureStartedResult = typeof EnsureStartedResult.Type;

export const importWorkflowInstanceId = (importId: ImportId) =>
  `import-acquisition-${importId}`;

export interface ImportWorkflowStarterShape {
  readonly ensureStarted?: (
    importId: ImportId,
    trace: ImportTraceContext
  ) => Effect.Effect<EnsureStartedResult, WorkflowStartUnavailable>;
  /** Compatibility-only shape for unchanged cancellation fixtures. */
  readonly start?: (importId: ImportId) => Effect.Effect<void>;
  readonly restartFromSpeech?: (
    importId: ImportId
  ) => Effect.Effect<void, WorkflowStartUnavailable>;
  readonly restartPostAcquisition?: (
    importId: ImportId,
    checkpoint: PostAcquisitionJournalCheckpoint
  ) => Effect.Effect<void, WorkflowStartUnavailable>;
}

export interface ImportWorkflowReconcilerShape extends ImportWorkflowStarterShape {
  readonly ensureStarted: (
    importId: ImportId,
    trace: ImportTraceContext
  ) => Effect.Effect<EnsureStartedResult, WorkflowStartUnavailable>;
}

interface WorkflowInstanceLike {
  readonly restart: (options?: {
    readonly from: {
      readonly name: string;
      readonly type: "do";
    };
  }) => Effect.Effect<void>;
  readonly status: () => Effect.Effect<{
    readonly status: string;
  }>;
}

interface WorkflowInstanceCreateOptionsLike {
  readonly id?: string;
  readonly params?: unknown;
}

interface WorkflowHandleLike {
  readonly createBatch: (
    batch: WorkflowInstanceCreateOptionsLike[]
  ) => Effect.Effect<readonly WorkflowInstanceLike[]>;
  readonly get: (id: string) => Effect.Effect<WorkflowInstanceLike>;
}

const reconcileExisting = (instance: WorkflowInstanceLike) =>
  Effect.flatMap(
    instance.status(),
    ({
      status,
    }): Effect.Effect<EnsureStartedResult, WorkflowStartUnavailable> => {
      switch (status) {
        case "queued":
        case "running":
        case "waiting":
        case "waitingForPause": {
          return Effect.succeed("already_active");
        }
        case "paused": {
          return Effect.succeed("paused");
        }
        case "complete":
        case "errored":
        case "terminated": {
          return Effect.as(instance.restart(), "restarted" as const);
        }
        default: {
          return Effect.fail(workflowStartUnavailable());
        }
      }
    }
  );

const reconcileSpeechRestart = (instance: WorkflowInstanceLike) =>
  instance.status().pipe(
    Effect.flatMap(({ status }) => {
      switch (status) {
        case "queued":
        case "running":
        case "waiting":
        case "waitingForPause": {
          return Effect.void;
        }
        case "complete":
        case "errored":
        case "terminated": {
          return instance
            .restart({
              from: {
                name: "record-acquisition-v2",
                type: "do",
              },
            })
            .pipe(
              Effect.catchCauseIf(
                (cause) => !Cause.hasInterrupts(cause),
                () =>
                  instance
                    .status()
                    .pipe(
                      Effect.flatMap(({ status: reconciledStatus }) =>
                        [
                          "queued",
                          "running",
                          "waiting",
                          "waitingForPause",
                        ].includes(reconciledStatus)
                          ? Effect.void
                          : Effect.fail(workflowStartUnavailable())
                      )
                    )
              )
            );
        }
        default: {
          return Effect.fail(workflowStartUnavailable());
        }
      }
    }),
    Effect.catchCauseIf(
      (cause) => !Cause.hasInterrupts(cause),
      () => Effect.fail(workflowStartUnavailable())
    )
  );

export const makeImportWorkflowStarter = (
  workflow: WorkflowHandleLike
): ImportWorkflowReconcilerShape => {
  const restartPostAcquisition = (
    importId: ImportId,
    rawCheckpoint: PostAcquisitionJournalCheckpoint
  ) =>
    Schema.decodeUnknownEffect(PostAcquisitionJournalCheckpoint)(
      rawCheckpoint
    ).pipe(
      Effect.mapError(() => workflowStartUnavailable()),
      Effect.flatMap((checkpoint) =>
        workflow
          .get(importWorkflowInstanceId(importId))
          .pipe(
            Effect.flatMap((instance) =>
              instance.restart(postAcquisitionRestartOptions(checkpoint))
            )
          )
      ),
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        () => Effect.fail(workflowStartUnavailable())
      )
    );

  return {
    ensureStarted: (importId, trace) => {
      const instanceId = importWorkflowInstanceId(importId);
      return Effect.gen(function* ensureStarted() {
        const createOutcome = yield* workflow
          .createBatch([{ id: instanceId, params: { importId, trace } }])
          .pipe(
            Effect.map((created) => ({
              _tag: "Created" as const,
              created,
            })),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterrupts(cause),
              () =>
                workflow.get(instanceId).pipe(
                  Effect.flatMap(reconcileExisting),
                  Effect.map((result) => ({
                    _tag: "Reconciled" as const,
                    result,
                  }))
                )
            )
          );
        if (createOutcome._tag === "Reconciled") {
          return createOutcome.result;
        }
        const { created } = createOutcome;
        if (created.length === 1) {
          yield* emitImportObservabilityEvent({
            correlationId: trace.correlationId,
            event: "import.accepted",
            outcome: "accepted",
          });
          return "created" as const;
        }
        if (created.length !== 0) {
          return yield* Effect.fail(workflowStartUnavailable());
        }
        return yield* reconcileExisting(yield* workflow.get(instanceId));
      }).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          () => Effect.fail(workflowStartUnavailable())
        )
      );
    },
    restartFromSpeech: (importId) =>
      workflow
        .get(importWorkflowInstanceId(importId))
        .pipe(Effect.flatMap(reconcileSpeechRestart)),
    restartPostAcquisition,
  };
};

export const ensureImportWorkflowStarted = (
  starter: ImportWorkflowStarterShape,
  importId: ImportId,
  trace: ImportTraceContext
) => {
  if (starter.ensureStarted === undefined) {
    return starter.start === undefined
      ? Effect.fail(workflowStartUnavailable())
      : Effect.as(starter.start(importId), "already_active" as const);
  }
  return starter.ensureStarted(importId, trace);
};

// eslint-disable-next-line max-classes-per-file -- The Workflow host and its service tag form one frozen module contract.
export class ImportWorkflowStarter extends Context.Service<
  ImportWorkflowStarter,
  ImportWorkflowStarterShape
>()("meal-planner/ImportWorkflowStarter") {}
