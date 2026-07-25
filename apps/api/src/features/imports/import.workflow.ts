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
import { acquireStoreVerify } from "./import-media-acquirer.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import { ImportMediaAcquisitionObject } from "./import-media-acquisition-object.js";
import {
  AcquisitionGeneration,
  AcquisitionTaskOutcome,
  MaximumAcquisitionAttemptSeconds,
  MaximumLocalCleanupMilliseconds,
} from "./import-media.model.js";
import type {
  AcquisitionStage,
  RetryableAcquisitionFailure,
} from "./import-media.model.js";
import {
  makeInstalledRecipeExtractor,
  makeInstalledSpeechTranscriber,
  makeInstalledVisualEvidenceExtractor,
  makePilotProviderDispatchGate,
} from "./import-provider-adapters.js";
import { produceRecipeDraftForImport } from "./import-recipe-draft.js";
import { makeD1RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
import { transcribeAcquiredImport } from "./import-speech-transcription.js";
import { makeD1SpeechTranscriptionRepository } from "./import-speech-transcription.repository.d1.js";
import { extractVisualEvidenceForTranscribedImport } from "./import-visual-evidence.js";
import { makeD1VisualEvidenceRepository } from "./import-visual-evidence.repository.d1.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { workflowStartUnavailable } from "./import.errors.js";
import type { WorkflowStartUnavailable } from "./import.errors.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
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
  readonly stage: AcquisitionStage;
}

interface UnconfirmedAcquisitionRetry {
  readonly _tag: "UnconfirmedAcquisitionRetry";
  readonly stage: "reconcile";
}

type AcquisitionRetry = ConfirmedAcquisitionRetry | UnconfirmedAcquisitionRetry;

export const runAcquisitionTask = <
  Allocation extends AcquisitionAttemptAllocation,
  AllocationError,
>(
  allocate: () => Effect.Effect<Allocation, AllocationError>,
  attempt: (
    allocation: Allocation
  ) => Effect.Effect<AcquisitionTaskOutcome, RetryableAcquisitionFailure>
) =>
  Effect.suspend(() => {
    let confirmedGeneration: AcquisitionGeneration | undefined;
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
        attempt(allocation).pipe(
          Effect.flatMap((outcome) =>
            outcome.generation === allocation.generation
              ? Effect.succeed(outcome)
              : Effect.fail({
                  _tag: "RetryableAcquisitionFailure" as const,
                  stage: "verify" as const,
                })
          ),
          Effect.mapError(
            // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect.mapError is a typed Effect combinator, not Promise callback control flow.
            (error): ConfirmedAcquisitionRetry => ({
              _tag: "ConfirmedAcquisitionRetry",
              generation: allocation.generation,
              stage: error.stage,
            })
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
                stage: "process",
              }),
      })
    );
  }).pipe(
    Effect.retry({ schedule: TypedAcquisitionRetrySchedule }),
    Effect.matchEffect({
      onFailure: (error) =>
        error._tag === "ConfirmedAcquisitionRetry"
          ? Effect.succeed({
              _tag: "RetryExhausted" as const,
              attempts: 3 as const,
              generation: error.generation,
              stage: error.stage,
            })
          : Effect.fail(error),
      onSuccess: Effect.succeed,
    })
  );

export const ImportWorkflowInput = Schema.Struct({ importId: ImportId });
const AcquisitionClaimCheckpoint = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Finished") }),
  Schema.Struct({
    _tag: Schema.Literal("Acquiring"),
    canonicalId: SourceCanonicalId,
  }),
]);
const ProviderTaskCheckpoint = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Failed"),
    code: Schema.String,
    stage: Schema.Literals(["recipe", "speech", "visual"]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Succeeded"),
    stage: Schema.Literals(["recipe", "speech", "visual"]),
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

export const ProviderTaskStepConfig = {
  retries: { backoff: "exponential", delay: "2 seconds", limit: 2 },
  timeout: "2 minutes",
} as const;

const currentPilotBudgetTimestamp = () =>
  Schema.decodeUnknownSync(PilotBudgetTimestamp)(new Date().toISOString());

export default class ImportAcquisitionWorkflow extends Cloudflare.Workflow<ImportAcquisitionWorkflow>()(
  "ImportAcquisitionWorkflow",
  Effect.gen(function* ImportAcquisitionWorkflowInit() {
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
      Effect.gen(function* runImportAcquisitionWorkflow() {
        const { importId } = yield* Schema.decodeUnknownEffect(
          ImportWorkflowInput
        )(rawInput).pipe(Effect.orDie);
        const database = yield* queryDatabase.raw;
        const rawBucket = yield* evidenceBucket.raw;
        const repository = makeD1ImportRepository(database);
        const now = currentPilotBudgetTimestamp;
        const dispatch = makePilotProviderDispatchGate({
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
          dispatch,
        });
        const visualExtractor = yield* makeInstalledVisualEvidenceExtractor({
          client: providerGateway,
          dispatch,
        });
        const recipeExtractor = yield* makeInstalledRecipeExtractor({
          client: providerGateway,
          dispatch,
        });
        const task = <A, E>(
          name: string,
          stage: "recipe" | "speech" | "visual",
          effect: Effect.Effect<A, E>
        ) =>
          Cloudflare.Workflows.task(
            name,
            effect.pipe(
              Effect.match({
                onFailure: (error) => ({
                  _tag: "Failed" as const,
                  code:
                    typeof error === "object" &&
                    error !== null &&
                    "code" in error &&
                    typeof error.code === "string"
                      ? error.code
                      : "stage_failed",
                  stage,
                }),
                onSuccess: () => ({
                  _tag: "Succeeded" as const,
                  stage,
                }),
              })
            ),
            ProviderTaskStepConfig
          ).pipe(
            Effect.flatMap((value) =>
              Schema.decodeUnknownEffect(ProviderTaskCheckpoint)(value)
            ),
            Effect.orDie
          );
        const stagedCarousel = yield* loadStagedOperatorCarousel({
          bucket: rawBucket as unknown as AcquisitionBucketLike,
          importId,
        }).pipe(Effect.orDie);
        if (stagedCarousel !== null) {
          const encodedCarouselEvidence = yield* Cloudflare.Workflows.task(
            "extract-carousel-visual-evidence-v1",
            prepareTikTokCarouselEvidence({
              adapter: stagedCarousel.adapter,
              bucket: rawBucket as unknown as AcquisitionBucketLike,
              carouselRepository: makeD1CarouselEvidenceRepository(database),
              descriptor: stagedCarousel.descriptor,
              importId,
              now,
              visualExtractor,
            }).pipe(
              Effect.match({
                onFailure: (error) => ({
                  _tag: "Failed" as const,
                  code:
                    typeof error === "object" &&
                    error !== null &&
                    "code" in error &&
                    typeof error.code === "string"
                      ? error.code
                      : "stage_failed",
                  stage: "visual" as const,
                }),
                onSuccess: (evidence) => ({
                  _tag: "Succeeded" as const,
                  evidence,
                  stage: "visual" as const,
                }),
              })
            ),
            ProviderTaskStepConfig
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
              bucket: rawBucket as unknown as AcquisitionBucketLike,
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
        const encodedOutcome = yield* Cloudflare.Workflows.task(
          "resolve-acquire-store-verify-v2",
          runAcquisitionTask(
            () => repository.beginAcquisitionAttempt(importId),
            (allocation) =>
              allocation.canonicalSourceId === claim.canonicalId
                ? acquireStoreVerify(
                    rawBucket as unknown as AcquisitionBucketLike,
                    {
                      cleanup: (artifactId) => stub.cleanup(artifactId),
                      prepare: (input) => stub.prepare(input),
                      prepareProviderEvidence: (artifactId, durationSeconds) =>
                        stub.prepareProviderEvidence(
                          artifactId,
                          durationSeconds
                        ),
                      stream: (artifactId) => stub.stream(artifactId),
                    },
                    {
                      beforeCleanup: (prepared, mediaObject) =>
                        persistDerivedProviderEvidence(
                          rawBucket as unknown as AcquisitionBucketLike,
                          mediaObject,
                          prepared,
                          {
                            generation: allocation.generation,
                            importId,
                          }
                        ),
                      canonicalId: allocation.canonicalSourceId,
                      generation: allocation.generation,
                      importId,
                      now: () => new Date(),
                    }
                  )
                : Effect.die("Persisted canonical identity changed")
          ).pipe(
            Effect.map(Schema.encodeSync(AcquisitionTaskOutcome)),
            Effect.orDie
          ),
          AcquisitionTaskStepConfig
        );
        const outcome = yield* Schema.decodeUnknownEffect(
          AcquisitionTaskOutcome
        )(encodedOutcome).pipe(Effect.orDie);
        const encodedFinalization = yield* Cloudflare.Workflows.task(
          "record-acquisition-v2",
          (outcome._tag === "VerifiedAcquisition"
            ? repository.recordAcquired(
                importId,
                outcome.generation,
                outcome.evidence,
                outcome.evidence.acquiredAt
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
        yield* Schema.decodeUnknownEffect(AcquisitionFinalizationResult)(
          encodedFinalization
        ).pipe(Effect.orDie);
        if (outcome._tag !== "VerifiedAcquisition") {
          return encodedOutcome;
        }
        const speech = yield* task(
          "transcribe-video-v1",
          "speech",
          transcribeAcquiredImport({
            acquisitionRepository: repository,
            audioExtractor: makeR2SpeechAudioExtractor(
              rawBucket as unknown as AcquisitionBucketLike
            ),
            bucket: rawBucket as unknown as AcquisitionBucketLike,
            importId,
            now,
            speechTranscriber,
            transcriptionRepository:
              makeD1SpeechTranscriptionRepository(database),
          })
        );
        if (speech._tag === "Failed") {
          return speech;
        }
        const visual = yield* task(
          "extract-visual-evidence-v1",
          "visual",
          extractVisualEvidenceForTranscribedImport({
            bucket: rawBucket as unknown as AcquisitionBucketLike,
            extractor: visualExtractor,
            frameSampler: makeR2VisualFrameSampler(
              rawBucket as unknown as AcquisitionBucketLike
            ),
            importId,
            importRepository: repository,
            now,
            visualRepository: makeD1VisualEvidenceRepository(database),
          })
        );
        if (visual._tag === "Failed") {
          return visual;
        }
        const recipe = yield* task(
          "extract-recipe-v1",
          "recipe",
          produceRecipeDraftForImport({
            bucket: rawBucket as unknown as AcquisitionBucketLike,
            extractor: recipeExtractor,
            importId,
            importRepository: repository,
            now,
            recipeRepository: makeD1RecipeDraftRepository(database),
          })
        );
        if (recipe._tag === "Failed") {
          return recipe;
        }
        return encodedOutcome;
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
    importId: ImportId
  ) => Effect.Effect<EnsureStartedResult, WorkflowStartUnavailable>;
  /** Compatibility-only shape for unchanged cancellation fixtures. */
  readonly start?: (importId: ImportId) => Effect.Effect<void>;
}

export interface ImportWorkflowReconcilerShape extends ImportWorkflowStarterShape {
  readonly ensureStarted: (
    importId: ImportId
  ) => Effect.Effect<EnsureStartedResult, WorkflowStartUnavailable>;
}

interface WorkflowInstanceLike {
  readonly restart: () => Effect.Effect<void>;
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

export const makeImportWorkflowStarter = (
  workflow: WorkflowHandleLike
): ImportWorkflowReconcilerShape => ({
  ensureStarted: (importId) => {
    const instanceId = importWorkflowInstanceId(importId);
    return Effect.gen(function* ensureStarted() {
      const created = yield* workflow.createBatch([
        { id: instanceId, params: { importId } },
      ]);
      if (created.length === 1) {
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
});

export const ensureImportWorkflowStarted = (
  starter: ImportWorkflowStarterShape,
  importId: ImportId
) => {
  if (starter.ensureStarted === undefined) {
    return starter.start === undefined
      ? Effect.fail(workflowStartUnavailable())
      : Effect.as(starter.start(importId), "already_active" as const);
  }
  return starter.ensureStarted(importId);
};

// eslint-disable-next-line max-classes-per-file -- The Workflow host and its service tag form one frozen module contract.
export class ImportWorkflowStarter extends Context.Service<
  ImportWorkflowStarter,
  ImportWorkflowStarterShape
>()("meal-planner/ImportWorkflowStarter") {}
