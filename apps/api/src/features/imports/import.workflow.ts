import {
  CanonicalTikTokUrl,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import type { RecipeImportActionId } from "@meal-planner/recipe-import-api";
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
  HouseholdObserveEvidenceReferenceInput,
  HouseholdReadEvidenceReferencesResult,
} from "../households/evidence/household-evidence.contract.js";
import { HouseholdDomainWorker } from "../households/household-domain-binding.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import type { HouseholdOrganizationId } from "../households/household.contract.js";
import { HouseholdImportMutationId } from "../households/recipe-import/household-recipe-import.contract.js";
import type { HouseholdRecipeImportLifecycleTransition } from "../households/recipe-import/household-recipe-import.contract.js";
import type { ImportWorkflowIdentity } from "../households/shared-kernel/workflow-identity.js";
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
  continueHouseholdAcquisitionCheckpoint,
  decodeAcquisitionCheckpoint,
  recoverHouseholdVerifiedAcquisitionCheckpoint,
} from "./import-acquisition-checkpoint.js";
import {
  runImportCarouselVisualAndRecipeWorkflow,
  runImportVisualAndRecipeWorkflow,
} from "./import-application-workflows.js";
import { loadStagedOperatorCarousel } from "./import-carousel-staging.js";
import {
  prepareTikTokCarouselEvidence,
  produceTikTokCarouselRecipeDraft,
} from "./import-carousel.js";
import {
  makeR2SpeechAudioExtractor,
  makeR2VisualFrameSampler,
  persistDerivedProviderEvidence,
} from "./import-derived-media.js";
import { inspectHouseholdEvidenceReferences } from "./import-evidence-availability.js";
import {
  makeHouseholdCarouselEvidenceRepository,
  makeHouseholdImportEvidenceCurrentRepository,
  makeHouseholdRecipeDraftRepository,
  makeHouseholdSpeechTranscriptionRepository,
  makeHouseholdVisualEvidenceRepository,
} from "./import-evidence.repository.household.js";
import { makeD1ImportExecutionRepository } from "./import-execution.repository.d1.js";
import { projectRecipeDraftReviewActionView } from "./import-intent-review-action.js";
import type { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import {
  acquireStoreVerify,
  readVerifiedAcquisitionEvidence,
} from "./import-media-acquirer.js";
import { adaptAcquisitionBucket } from "./import-media-acquisition-bucket.alchemy.js";
import { makeAcquisitionMediaObject } from "./import-media-acquisition-object.client.js";
import { ImportMediaAcquisitionObject } from "./import-media-acquisition-object.js";
import {
  AcquisitionGeneration,
  AcquisitionTaskOutcome,
  MaximumAcquisitionAttemptSeconds,
  MaximumLocalCleanupMilliseconds,
  acquisitionCoordinatorId,
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
import {
  makePilotProviderDispatchGate,
  makeWorkersAiTransport,
} from "./import-provider-kernel.js";
import { makeInstalledRecipeExtractor } from "./import-provider-recipe.js";
import { makeInstalledSpeechTranscriber } from "./import-provider-speech.js";
import { persistHouseholdProviderTerminalAuthority } from "./import-provider-terminal-authority.js";
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
import type {
  ProviderTaskFailure,
  ProviderTaskRetryLifecycle,
} from "./import-provider-workflow-task.js";
import {
  publicIntentFailureForAcquisitionOutcome,
  publicIntentFailureForProviderStage,
} from "./import-public-failure.js";
import { produceRecipeDraftForImport } from "./import-recipe-draft.js";
import { readHouseholdProviderDispatchId } from "./import-recipe-recovery.household.js";
import { transcribeAcquiredImport } from "./import-speech-transcription.js";
import { extractVisualEvidenceForTranscribedImport } from "./import-visual-evidence.js";
import {
  decodeImportWorkflowInput,
  ImportWorkflowInput,
} from "./import-workflow-input.js";
import type { ImportWorkflowInputEncoded } from "./import-workflow-input.js";
import {
  PostAcquisitionJournalCheckpoint,
  postAcquisitionRestartOptions,
} from "./import-workflow-journal.js";
import {
  ImportId,
  ImportTimestamp,
  SourceDescriptor,
  SourceCanonicalId,
} from "./import.contracts.js";
import { workflowStartUnavailable } from "./import.errors.js";
import type { WorkflowStartUnavailable } from "./import.errors.js";
import type { AcquisitionFinalizationResult as AcquisitionFinalizationResultType } from "./import.repository.js";
import { AcquisitionFinalizationResult } from "./import.repository.js";
import { makeTikTokCanonicalSourceIdentityResolver } from "./source-identity.tiktok.js";

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
    const retry: ConfirmedAcquisitionRetry = {
      _tag: "ConfirmedAcquisitionRetry",
      generation: outcome.generation,
      stage: outcome.stage,
    };
    return acquisitionFailureReasonCode(
      outcome.reason === undefined
        ? retry
        : { ...retry, reason: outcome.reason }
    );
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
  const settled =
    settlement === "Superseded"
      ? emitImportObservabilityEvent({
          correlationId,
          event: "acquisition.settlement",
          outcome: "rejected",
          reasonCode: "state_fence",
        })
      : emitImportObservabilityEvent({
          correlationId,
          event: "acquisition.settlement",
          outcome: "settled",
        });
  return settled.pipe(
    Effect.andThen(
      reasonCode === undefined
        ? emitImportObservabilityEvent({
            correlationId,
            event: "acquisition.terminal",
            outcome: "succeeded",
          })
        : emitImportObservabilityEvent({
            correlationId,
            event: "acquisition.terminal",
            outcome: "rejected",
            reasonCode,
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
  options?: {
    readonly correlationId?: ImportCorrelationId;
    readonly lifecycle?: ProviderTaskRetryLifecycle;
  }
) =>
  Effect.suspend(() => {
    let confirmedGeneration: AcquisitionGeneration | undefined;
    let attemptNumber = 0;
    let executionNumber = 0;
    const runAttempt = Effect.suspend(() => {
      executionNumber += 1;
      const begin =
        executionNumber > 1 && options?.lifecycle !== undefined
          ? options.lifecycle.working(executionNumber)
          : Effect.void;
      return begin.pipe(
        Effect.andThen(allocate()),
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
                const retry: ConfirmedAcquisitionRetry = {
                  _tag: "ConfirmedAcquisitionRetry",
                  generation: allocation.generation,
                  stage: error.stage,
                };
                return reason === undefined ? retry : { ...retry, reason };
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
        Effect.tapError((error) =>
          Effect.gen(function* observeAcquisitionFailure() {
            if (executionNumber < 3 && options?.lifecycle !== undefined) {
              yield* options.lifecycle.retrying(executionNumber);
            }
            if (
              options?.correlationId === undefined ||
              error._tag !== "ConfirmedAcquisitionRetry"
            ) {
              return;
            }
            const reasonCode = acquisitionFailureReasonCode(error);
            yield* emitImportObservabilityEvent({
              attempt: attemptNumber,
              correlationId: options.correlationId,
              event:
                reasonCode === "timeout"
                  ? "acquisition.timeout"
                  : "acquisition.response",
              outcome: reasonCode === "timeout" ? "timed_out" : "failed",
              reasonCode,
            });
            if (executionNumber < 3) {
              yield* emitImportObservabilityEvent({
                attempt: attemptNumber,
                correlationId: options.correlationId,
                event: "acquisition.retry",
                outcome: "retrying",
                reasonCode,
              });
            }
          })
        )
      );
    });

    return runAttempt.pipe(
      Effect.retry({ schedule: TypedAcquisitionRetrySchedule }),
      Effect.matchEffect({
        onFailure: (
          error
        ): Effect.Effect<
          AcquisitionTaskOutcome,
          UnconfirmedAcquisitionRetry
        > => {
          if (error._tag !== "ConfirmedAcquisitionRetry") {
            return Effect.fail(error);
          }
          if (error.reason === "download_source_unavailable") {
            return Effect.succeed({
              _tag: "Unavailable" as const,
              code: "private_or_unavailable" as const,
              generation: error.generation,
            });
          }
          const outcome =
            error.reason === undefined
              ? {
                  _tag: "RetryExhausted" as const,
                  attempts: 3 as const,
                  generation: error.generation,
                  stage: error.stage,
                }
              : {
                  _tag: "RetryExhausted" as const,
                  attempts: 3 as const,
                  generation: error.generation,
                  reason: error.reason,
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

const digestText = (value: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    )
  );

const workflowMutationId = (semanticKey: string) =>
  digestText(`household-recipe-import-workflow:v1:${semanticKey}`).pipe(
    Effect.map(Schema.decodeUnknownSync(HouseholdImportMutationId))
  );

const makeHouseholdIntentTransitions = (input: {
  readonly executionGeneration: ImportIntentExecutionGeneration;
  readonly householdDomain: HouseholdDomainWorkerMethods;
  readonly intentId: RecipeImportIntentId;
  readonly organizationId: HouseholdOrganizationId;
}) => {
  const admission = {
    actor: {
      _tag: "System" as const,
      purpose: "recipe_import_lifecycle_commit" as const,
    },
    organizationId: input.organizationId,
  };
  const apply = (transition: HouseholdRecipeImportLifecycleTransition) =>
    input.householdDomain
      .transitionRecipeImportLifecycle({
        admission,
        expectedGeneration: input.executionGeneration,
        intentId: input.intentId,
        transition,
      })
      .pipe(Effect.asVoid);
  return {
    advanceComponent: (
      component: "speech" | "visuals",
      progress: "not_started" | "processing" | "completed" | "skipped"
    ) => apply({ _tag: "AdvanceComponent", component, progress }),
    advanceStage: (
      stage:
        | "analyzing_evidence"
        | "extracting_recipe"
        | "grounding_recipe"
        | "preparing_review"
    ) => apply({ _tag: "AdvanceStage", stage }),
    fail: (
      boundary: "acquisition" | "speech" | "visual" | "recipe" | "executor",
      failure: ReturnType<typeof publicIntentFailureForProviderStage>,
      attemptIdentity: string
    ) => apply({ _tag: "Fail", attemptIdentity, boundary, ...failure }),
    setActivity: (
      boundary: "acquisition" | "speech" | "visual" | "recipe" | "executor",
      attempt: number,
      activity: "working" | "retrying"
    ) => apply({ _tag: "SetActivity", activity, attempt, boundary }),
  };
};

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
    const householdDomain: HouseholdDomainWorkerMethods =
      yield* Cloudflare.Workers.bindWorker(HouseholdDomainWorker);

    return (rawInput: ImportWorkflowInputEncoded) =>
      Effect.gen(function* initializeImportAcquisitionWorkflow() {
        const workflowInput = yield* decodeImportWorkflowInput(rawInput).pipe(
          Effect.orDie
        );
        const database = yield* queryDatabase.raw;
        const traceStore = makeD1ImportObservabilityTraceStore(database, () =>
          new Date().toISOString()
        );
        const { executionGeneration, importId, organizationId, trace } =
          workflowInput;
        const { correlationId } = trace;
        const intentId =
          Schema.decodeUnknownSync(RecipeImportIntentId)(importId);
        const admission = {
          actor: {
            _tag: "System" as const,
            purpose: "recipe_import_lifecycle_commit" as const,
          },
          organizationId,
        };
        const execution = yield* householdDomain
          .readRecipeImportExecution({
            admission,
            expectedGeneration: executionGeneration,
            intentId,
          })
          .pipe(Effect.orDie);
        const source = yield* Schema.decodeUnknownEffect(SourceDescriptor, {
          onExcessProperty: "error",
        })({ kind: "tiktok", url: execution.submittedSourceUrl }).pipe(
          Effect.orDie
        );
        const identityResolution = yield* Cloudflare.Workflows.task(
          "resolve-source-identity-v1",
          makeTikTokCanonicalSourceIdentityResolver(globalThis.fetch)
            .resolve(source)
            .pipe(Effect.orDie)
        );
        const sourceMutationId = yield* workflowMutationId(
          `${intentId}:${executionGeneration}:resolve-source:${identityResolution.identity.canonicalId}`
        );
        const canonicalUrl = yield* Schema.decodeUnknownEffect(
          CanonicalTikTokUrl
        )(identityResolution.canonicalUrl).pipe(Effect.orDie);
        const resolvedIntent = yield* householdDomain
          .resolveRecipeImportSource({
            admission,
            canonicalSourceId: identityResolution.identity.canonicalId,
            canonicalUrl,
            expectedGeneration: executionGeneration,
            intentId,
            mutationId: sourceMutationId,
            sourceKind:
              identityResolution._tag === "VideoIdentity"
                ? "video"
                : "carousel",
          })
          .pipe(Effect.orDie);
        if (resolvedIntent.status === "redirected") {
          return resolvedIntent;
        }
        const repository = makeD1ImportExecutionRepository(database);
        yield* repository
          .ensureRun({
            canonicalSourceId: identityResolution.identity.canonicalId,
            correlationId,
            importId,
            sourceType:
              identityResolution._tag === "VideoIdentity"
                ? "video"
                : "carousel",
            startedAt: Schema.decodeUnknownSync(ImportTimestamp)(
              new Date().toISOString()
            ),
          })
          .pipe(Effect.orDie);
        return yield* Effect.gen(
          function* runCurrentImportAcquisitionWorkflow() {
            yield* observeImportWorkflowStart(trace);
            const bucket = adaptAcquisitionBucket(
              evidenceBucket,
              runtimeContext
            );
            const intentTransitions = makeHouseholdIntentTransitions({
              executionGeneration,
              householdDomain,
              intentId,
              organizationId,
            });
            const evidenceRepositories = (
              generation: AcquisitionGeneration
            ) => {
              const evidenceInput = {
                acquisitionGeneration: generation,
                canonicalSourceId: identityResolution.identity.canonicalId,
                correlationId,
                executionGeneration,
                householdDomain,
                intentId,
                mutationId: workflowMutationId,
                organizationId,
              };
              return {
                carousel:
                  makeHouseholdCarouselEvidenceRepository(evidenceInput),
                current:
                  makeHouseholdImportEvidenceCurrentRepository(evidenceInput),
                recipe: makeHouseholdRecipeDraftRepository(evidenceInput),
                speech:
                  makeHouseholdSpeechTranscriptionRepository(evidenceInput),
                visual: makeHouseholdVisualEvidenceRepository(evidenceInput),
              } as const;
            };
            const recipeLifecycle = {
              grounding: intentTransitions
                .advanceStage("grounding_recipe")
                .pipe(Effect.orDie),
              preparingReview: intentTransitions
                .advanceStage("preparing_review")
                .pipe(Effect.orDie),
              reviewAvailable: (
                _actionId: RecipeImportActionId,
                draft: Parameters<typeof projectRecipeDraftReviewActionView>[0]
              ) =>
                Effect.gen(function* commitHouseholdRecipeDraft() {
                  const mutationId = yield* workflowMutationId(
                    `${intentId}:${executionGeneration}:commit-draft:${draft.extractionFingerprint}`
                  );
                  yield* householdDomain.commitRecipeImportDraft({
                    admission,
                    evidenceFingerprint: draft.evidenceFingerprint,
                    expectedGeneration: executionGeneration,
                    extractionFingerprint: draft.extractionFingerprint,
                    intentId,
                    mutationId,
                    review: projectRecipeDraftReviewActionView(draft),
                  });
                }).pipe(Effect.orDie),
            };
            const retryLifecycle = (
              boundary: "acquisition" | "speech" | "visual" | "recipe"
            ): ProviderTaskRetryLifecycle => ({
              retrying: (attempt) =>
                intentTransitions
                  .setActivity(boundary, attempt, "retrying")
                  .pipe(Effect.orDie),
              working: (attempt) =>
                intentTransitions
                  .setActivity(boundary, attempt, "working")
                  .pipe(Effect.orDie),
            });
            const terminalRecovery = {
              speechDispatchId: ({
                acquisitionGeneration,
                importId: requestedImportId,
              }: {
                readonly acquisitionGeneration: AcquisitionGeneration;
                readonly importId: ImportId;
              }) =>
                readHouseholdProviderDispatchId({
                  acquisitionGeneration,
                  database,
                  executionGeneration,
                  householdDomain,
                  importId: requestedImportId,
                  stage: "speech",
                }),
              visualDispatchId: ({
                acquisitionGeneration,
                importId: requestedImportId,
              }: {
                readonly acquisitionGeneration: AcquisitionGeneration;
                readonly importId: ImportId;
              }) =>
                readHouseholdProviderDispatchId({
                  acquisitionGeneration,
                  database,
                  executionGeneration,
                  householdDomain,
                  importId: requestedImportId,
                  stage: "visual",
                }),
            };
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
            const workersAiTransport = yield* makeWorkersAiTransport(
              providerGateway,
              correlationId,
              traceStore
            ).pipe(Effect.provideService(RuntimeContext, runtimeContext));
            const speechTranscriber = yield* makeInstalledSpeechTranscriber({
              correlationId,
              dispatch,
              transport: workersAiTransport.speech,
            });
            const visualExtractor = yield* makeInstalledVisualEvidenceExtractor(
              {
                correlationId,
                dispatch,
                transport: workersAiTransport.visual,
              }
            );
            const recipeExtractor = yield* makeInstalledRecipeExtractor({
              correlationId,
              dispatch,
              transport: workersAiTransport.recipe,
            });
            const task = <A, E extends ProviderTaskFailure>(
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
                trace,
                retryLifecycle(stage)
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
                persistHouseholdProviderTerminalAuthority({
                  acquisitionGeneration: generation,
                  admission,
                  executionGeneration,
                  failAmbiguous: (input) =>
                    (failure.stage === "speech"
                      ? evidenceRepositories(generation).speech
                      : evidenceRepositories(generation).visual
                    ).fail(input),
                  failure,
                  householdDomain,
                  intentId,
                  now: () =>
                    Schema.decodeUnknownSync(ImportTimestamp)(
                      new Date().toISOString()
                    ),
                }).pipe(Effect.orDie)
              );
            const completeVisualAndRecipe = (
              acquisitionGeneration: AcquisitionGeneration,
              preparedDispatchIds?: {
                readonly speechDispatchId: string;
                readonly visualDispatchId: string;
              }
            ) =>
              runImportVisualAndRecipeWorkflow({
                lifecycle: {
                  beforeRecipe: intentTransitions
                    .advanceStage("extracting_recipe")
                    .pipe(Effect.orDie),
                  beforeVisual: intentTransitions
                    .advanceComponent("visuals", "processing")
                    .pipe(Effect.orDie),
                  failurePersisted: (failure, terminal) =>
                    intentTransitions
                      .fail(
                        failure.stage,
                        publicIntentFailureForProviderStage(failure.stage),
                        terminal.ownershipId
                      )
                      .pipe(Effect.orDie),
                  visualCompleted: intentTransitions
                    .advanceComponent("visuals", "completed")
                    .pipe(Effect.orDie),
                },
                persistTerminal: (failure) =>
                  persistTerminal(failure, acquisitionGeneration),
                recipe: task(
                  "extract-recipe-v1",
                  "recipe",
                  produceRecipeDraftForImport({
                    bucket,
                    extractor: recipeExtractor,
                    importId,
                    importRepository: evidenceRepositories(
                      acquisitionGeneration
                    ).current,
                    lifecycle: recipeLifecycle,
                    now,
                    recipeRepository: evidenceRepositories(
                      acquisitionGeneration
                    ).recipe,
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
                        bucket,
                        extractor: visualExtractor,
                        frameSampler: makeR2VisualFrameSampler(bucket),
                        importId,
                        importRepository: evidenceRepositories(
                          acquisitionGeneration
                        ).current,
                        now,
                        speechDispatchId,
                        visualDispatchId,
                        visualRepository: evidenceRepositories(
                          acquisitionGeneration
                        ).visual,
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
            const stagedCarousel = yield* loadStagedOperatorCarousel({
              bucket,
              importId,
            }).pipe(Effect.orDie);
            if (stagedCarousel !== null) {
              const carouselGeneration = Schema.decodeUnknownSync(
                AcquisitionGeneration
              )(executionGeneration);
              const carouselResult =
                yield* runImportCarouselVisualAndRecipeWorkflow({
                  lifecycle: {
                    beforeRecipe: intentTransitions
                      .advanceStage("extracting_recipe")
                      .pipe(Effect.orDie),
                    beforeVisual: Effect.gen(function* beginCarouselAnalysis() {
                      yield* intentTransitions.advanceStage(
                        "analyzing_evidence"
                      );
                      yield* intentTransitions.advanceComponent(
                        "speech",
                        "skipped"
                      );
                      yield* intentTransitions.advanceComponent(
                        "visuals",
                        "processing"
                      );
                    }).pipe(Effect.orDie),
                    visualCompleted: intentTransitions
                      .advanceComponent("visuals", "completed")
                      .pipe(Effect.orDie),
                  },
                  recipe: (carouselEvidence) =>
                    task(
                      "extract-carousel-recipe-v1",
                      "recipe",
                      produceTikTokCarouselRecipeDraft({
                        bucket,
                        descriptor: stagedCarousel.descriptor,
                        evidence: carouselEvidence.evidence,
                        extractor: recipeExtractor,
                        importId,
                        lifecycle: recipeLifecycle,
                        now,
                        recipeRepository:
                          evidenceRepositories(carouselGeneration).recipe,
                      })
                    ),
                  visual: runProviderTask(
                    "extract-carousel-visual-evidence-v1",
                    "visual",
                    prepareTikTokCarouselEvidence({
                      adapter: stagedCarousel.adapter,
                      bucket,
                      carouselRepository:
                        evidenceRepositories(carouselGeneration).carousel,
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
                    trace,
                    retryLifecycle("visual")
                  ).pipe(
                    Effect.flatMap((value) =>
                      Schema.decodeUnknownEffect(
                        CarouselEvidenceTaskCheckpoint
                      )(value)
                    ),
                    Effect.orDie
                  ),
                });
              if (carouselResult._tag === "Failed") {
                yield* intentTransitions
                  .fail(
                    carouselResult.stage,
                    publicIntentFailureForProviderStage(carouselResult.stage),
                    `carousel:${carouselGeneration}`
                  )
                  .pipe(Effect.orDie);
              }
              return carouselResult;
            }
            const rawClaim = yield* Cloudflare.Workflows.task(
              "claim-acquisition-v1",
              repository.claimAcquisition(importId).pipe(
                Effect.map((claim) =>
                  claim._tag === "Finished"
                    ? ({ _tag: "Finished" } as const)
                    : {
                        _tag: "Acquiring" as const,
                        canonicalId: claim.canonicalSourceId,
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
            const encodedOutcome = yield* Cloudflare.Workflows.task(
              "resolve-acquire-store-verify-v2",
              recoverHouseholdVerifiedAcquisitionCheckpoint({
                current: evidenceRepositories(
                  Schema.decodeUnknownSync(AcquisitionGeneration)(
                    executionGeneration
                  )
                ).current.readCurrent(importId),
                expectedCanonicalId: claim.canonicalId,
                importId,
                readEvidence: (stored) =>
                  Effect.gen(function* readHouseholdAcquisitionEvidence() {
                    const encodedReferences = yield* householdDomain
                      .readEvidenceReferences({
                        admission,
                        expectedGeneration: executionGeneration,
                        intentId,
                      })
                      .pipe(Effect.orDie);
                    const references = yield* Schema.decodeUnknownEffect(
                      HouseholdReadEvidenceReferencesResult,
                      { onExcessProperty: "error" }
                    )(encodedReferences).pipe(Effect.orDie);
                    if (references === null) {
                      return null;
                    }
                    const presence = yield* inspectHouseholdEvidenceReferences(
                      bucket,
                      references.references
                    );
                    const missing = presence.filter(
                      ({ availability }) => availability === "missing"
                    );
                    yield* Effect.forEach(
                      missing,
                      ({ reference }) => {
                        const eventTime = new Date().toISOString();
                        return workflowMutationId(
                          `${intentId}:${executionGeneration}:observe-evidence-missing:${reference.kind}:${reference.sha256}:${eventTime}`
                        ).pipe(
                          Effect.flatMap((mutationId) =>
                            Schema.encodeEffect(
                              HouseholdObserveEvidenceReferenceInput
                            )({
                              admission,
                              availability: "missing",
                              event: {
                                action: "IntegrityProbe",
                                eventTime:
                                  Schema.decodeUnknownSync(ImportTimestamp)(
                                    eventTime
                                  ),
                              },
                              expectedGeneration: executionGeneration,
                              intentId,
                              mutationId,
                              reference: {
                                key: reference.key,
                                kind: reference.kind,
                                sha256: reference.sha256,
                              },
                            }).pipe(
                              Effect.orDie,
                              Effect.flatMap((encoded) =>
                                householdDomain.observeEvidenceReference(
                                  encoded
                                )
                              )
                            )
                          ),
                          Effect.orDie
                        );
                      },
                      { concurrency: 1 }
                    );
                    if (missing.length > 0) {
                      return null;
                    }
                    return yield* readVerifiedAcquisitionEvidence(bucket, {
                      canonicalId: stored.canonicalSourceId,
                      generation: stored.acquisitionGeneration,
                      importId,
                    });
                  }),
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
                                  bucket,
                                  makeAcquisitionMediaObject(
                                    mediaObjects.getByName(
                                      acquisitionCoordinatorId(
                                        importId,
                                        allocation.generation
                                      )
                                    )
                                  ),
                                  {
                                    beforeCleanup: (
                                      prepared,
                                      acquisitionMediaObject
                                    ) =>
                                      persistDerivedProviderEvidence(
                                        bucket,
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
                          {
                            correlationId,
                            lifecycle: retryLifecycle("acquisition"),
                          }
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
            const decodedCheckpoint =
              decodeAcquisitionCheckpoint(encodedOutcome);
            yield* observeAcquisitionCheckpoint(
              correlationId,
              decodedCheckpoint
            );
            if (decodedCheckpoint._tag === "AcquisitionCheckpointRejected") {
              return decodedCheckpoint;
            }
            const { outcome } = decodedCheckpoint;
            const encodedFinalization = yield* Cloudflare.Workflows.task(
              "record-acquisition-v2",
              (outcome._tag === "VerifiedAcquisition"
                ? Effect.gen(function* commitHouseholdAcquisitionEvidence() {
                    const mutationId = yield* workflowMutationId(
                      `${intentId}:${executionGeneration}:commit-acquisition-evidence:${outcome.evidence.manifestSha256}`
                    );
                    let result: Parameters<
                      HouseholdDomainWorkerMethods["commitAcquisitionEvidence"]
                    >[0]["result"] = {
                      acquiredAt: outcome.evidence.acquiredAt,
                      audioStreams: outcome.evidence.audioStreams,
                      durationSeconds: outcome.evidence.durationSeconds,
                      references: [
                        {
                          byteLength: outcome.evidence.bytes,
                          deleteAt: outcome.evidence.deleteAt,
                          key: outcome.evidence.mediaKey,
                          kind: "original_media",
                          sha256: outcome.evidence.sha256,
                        },
                        {
                          byteLength: outcome.evidence.manifestByteLength,
                          deleteAt: outcome.evidence.deleteAt,
                          key: outcome.evidence.manifestKey,
                          kind: "acquisition_manifest",
                          sha256: outcome.evidence.manifestSha256,
                        },
                      ],
                      videoStreams: outcome.evidence.videoStreams,
                    };
                    if (outcome.evidence.source !== undefined) {
                      result = { ...result, source: outcome.evidence.source };
                    }
                    const committed = yield* householdDomain
                      .commitAcquisitionEvidence({
                        acquisitionAttemptGeneration: outcome.generation,
                        admission,
                        expectedGeneration: executionGeneration,
                        intentId,
                        mutationId,
                        result,
                      })
                      .pipe(Effect.orDie);
                    return committed.outcome;
                  })
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
              if (finalization === "Recorded") {
                yield* intentTransitions
                  .fail(
                    "acquisition",
                    publicIntentFailureForAcquisitionOutcome(outcome),
                    `acquisition:${outcome.generation}`
                  )
                  .pipe(Effect.orDie);
              }
              return encodedOutcome;
            }
            yield* intentTransitions
              .advanceStage("analyzing_evidence")
              .pipe(Effect.orDie);
            yield* intentTransitions
              .advanceComponent("speech", "processing")
              .pipe(Effect.orDie);
            const encodedSpeech = yield* Cloudflare.Workflows.task(
              "transcribe-video-v1",
              continueHouseholdAcquisitionCheckpoint({
                current: evidenceRepositories(
                  outcome.generation
                ).current.readCurrent(importId),
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
                            acquisitionRepository: evidenceRepositories(
                              outcome.generation
                            ).current,
                            audioExtractor: makeR2SpeechAudioExtractor(bucket),
                            bucket,
                            dispatchId: speechDispatchId,
                            importId,
                            now,
                            speechTranscriber,
                            transcriptionRepository: evidenceRepositories(
                              outcome.generation
                            ).speech,
                          }),
                          () => ({
                            _tag: "Succeeded" as const,
                            stage: "speech" as const,
                          }),
                          trace,
                          retryLifecycle("speech")
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
              const terminal = yield* persistTerminal(
                speech,
                outcome.generation
              );
              yield* intentTransitions
                .fail(
                  "speech",
                  publicIntentFailureForProviderStage("speech"),
                  terminal.ownershipId
                )
                .pipe(Effect.orDie);
              return speech;
            }
            yield* intentTransitions
              .advanceComponent("speech", "completed")
              .pipe(Effect.orDie);
            const failure = yield* completeVisualAndRecipe(outcome.generation);
            if (failure !== null) {
              return failure;
            }
            return encodedOutcome;
          }
        ).pipe(
          Effect.orDie,
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

export interface ImportWorkflowStarter {
  readonly dispatchAdmission: (input: {
    readonly executionGeneration: ImportIntentExecutionGeneration;
    readonly importId: ImportId;
    readonly organizationId: HouseholdOrganizationId;
    readonly trace: ImportTraceContext;
    readonly workflowIdentity: ImportWorkflowIdentity;
  }) => Effect.Effect<EnsureStartedResult, WorkflowStartUnavailable>;
  readonly ensureStarted: (
    importId: ImportId,
    executionGeneration: ImportIntentExecutionGeneration,
    trace: ImportTraceContext
  ) => Effect.Effect<EnsureStartedResult, WorkflowStartUnavailable>;
  readonly restartFromSpeech?: (
    workflowIdentity: ImportWorkflowIdentity
  ) => Effect.Effect<ProviderRestartResult, WorkflowStartUnavailable>;
  readonly restartFromVisual?: (
    workflowIdentity: ImportWorkflowIdentity
  ) => Effect.Effect<ProviderRestartResult, WorkflowStartUnavailable>;
  readonly restartPostAcquisition?: (
    workflowIdentity: ImportWorkflowIdentity,
    checkpoint: PostAcquisitionJournalCheckpoint
  ) => Effect.Effect<void, WorkflowStartUnavailable>;
}

export interface ImportWorkflowReconciler extends ImportWorkflowStarter {
  readonly ensureStarted: (
    importId: ImportId,
    executionGeneration: ImportIntentExecutionGeneration,
    trace: ImportTraceContext
  ) => Effect.Effect<EnsureStartedResult, WorkflowStartUnavailable>;
}

type WorkflowInstanceLike = Pick<
  Cloudflare.Workflows.WorkflowInstance,
  "restart" | "status"
>;

interface WorkflowHandleLike {
  readonly createBatch: (
    batch: Cloudflare.Workflows.WorkflowInstanceCreateOptions<ImportWorkflowInputEncoded>[]
  ) => Effect.Effect<readonly WorkflowInstanceLike[]>;
  readonly get: (id: string) => Effect.Effect<WorkflowInstanceLike>;
}

export const ProviderRestartResult = Schema.Literals([
  "RestartAmbiguous",
  "RestartRequested",
]);
export type ProviderRestartResult = typeof ProviderRestartResult.Type;

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

const reconcileProviderRestart = (
  instance: WorkflowInstanceLike,
  name: "extract-visual-evidence-v1" | "record-acquisition-v2"
) =>
  instance.status().pipe(
    Effect.flatMap(({ status }) => {
      switch (status) {
        case "queued":
        case "running":
        case "waiting":
        case "waitingForPause": {
          return Effect.succeed("RestartAmbiguous" as const);
        }
        case "complete":
        case "errored":
        case "terminated": {
          return instance
            .restart({
              from: {
                name,
                type: "do",
              },
            })
            .pipe(
              Effect.as("RestartRequested" as const),
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
                          ? Effect.succeed("RestartAmbiguous" as const)
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
): ImportWorkflowReconciler => {
  const restartPostAcquisition = (
    workflowIdentity: ImportWorkflowIdentity,
    rawCheckpoint: PostAcquisitionJournalCheckpoint
  ) =>
    Schema.decodeUnknownEffect(PostAcquisitionJournalCheckpoint)(
      rawCheckpoint
    ).pipe(
      Effect.mapError(() => workflowStartUnavailable()),
      Effect.flatMap((checkpoint) =>
        workflow
          .get(workflowIdentity)
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

  const start = (input: {
    readonly executionGeneration: ImportIntentExecutionGeneration;
    readonly importId: ImportId;
    readonly instanceId: string;
    readonly organizationId: HouseholdOrganizationId;
    readonly trace: ImportTraceContext;
  }) =>
    Effect.gen(function* startImportWorkflow() {
      const decodedInput = yield* Schema.decodeUnknownEffect(
        ImportWorkflowInput,
        { onExcessProperty: "error" }
      )({
        executionGeneration: input.executionGeneration,
        importId: input.importId,
        organizationId: input.organizationId,
        trace: input.trace,
      }).pipe(Effect.mapError(() => workflowStartUnavailable()));
      const params = yield* Schema.encodeEffect(ImportWorkflowInput)(
        decodedInput
      ).pipe(Effect.mapError(() => workflowStartUnavailable()));
      const createOutcome = yield* workflow
        .createBatch([{ id: input.instanceId, params }])
        .pipe(
          Effect.map((created) => ({
            _tag: "Created" as const,
            created,
          })),
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterrupts(cause),
            () =>
              workflow.get(input.instanceId).pipe(
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
          correlationId: input.trace.correlationId,
          event: "import.accepted",
          outcome: "accepted",
        });
        return "created" as const;
      }
      if (created.length !== 0) {
        return yield* Effect.fail(workflowStartUnavailable());
      }
      return yield* reconcileExisting(yield* workflow.get(input.instanceId));
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        () => Effect.fail(workflowStartUnavailable())
      )
    );

  return {
    dispatchAdmission: (input) =>
      start({ ...input, instanceId: input.workflowIdentity }),
    ensureStarted: () => Effect.fail(workflowStartUnavailable()),
    restartFromSpeech: (workflowIdentity) =>
      workflow
        .get(workflowIdentity)
        .pipe(
          Effect.flatMap((instance) =>
            reconcileProviderRestart(instance, "record-acquisition-v2")
          )
        ),
    restartFromVisual: (workflowIdentity) =>
      workflow
        .get(workflowIdentity)
        .pipe(
          Effect.flatMap((instance) =>
            reconcileProviderRestart(instance, "extract-visual-evidence-v1")
          )
        ),
    restartPostAcquisition,
  };
};

export const ensureImportWorkflowStarted = (
  starter: ImportWorkflowStarter,
  importId: ImportId,
  executionGeneration: ImportIntentExecutionGeneration,
  trace: ImportTraceContext
) => starter.ensureStarted(importId, executionGeneration, trace);

export const ImportWorkflowStarter = Context.Service<ImportWorkflowStarter>(
  "meal-planner/ImportWorkflowStarter"
);
