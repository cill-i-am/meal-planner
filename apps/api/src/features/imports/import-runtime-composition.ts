import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Config, Effect, Layer, Option, Schema } from "effect";
import type { Redacted } from "effect";

import { ImportEvidenceBucket } from "../../infrastructure/import-evidence-bucket.js";
import { ImportProviderGateway } from "../../infrastructure/import-provider-gateway.js";
import { MealPlannerDatabase } from "../../infrastructure/meal-planner-database.js";
import {
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  makePilotProviderBudgetRuntime,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
import {
  ImportBatchId,
  ImportBatchItemId,
  ImportBatchDeliveryAttempt,
  ImportBatchQueueMessage,
} from "./import-batch.contracts.js";
import type {
  ImportBatchDeliveryAttempt as ImportBatchDeliveryAttemptType,
  ImportBatchQueueMessage as ImportBatchQueueMessageType,
} from "./import-batch.contracts.js";
import type { ImportBatchQueueShape } from "./import-batch.service.js";
import {
  ImportBatchService,
  makeImportBatchService,
} from "./import-batch.service.js";
import {
  OperatorCarouselImportService,
  makeOperatorCarouselImportService,
} from "./import-carousel-operator.service.js";
import { stageOperatorCarouselForWorkflow } from "./import-carousel-staging.js";
import { RecipeImportIntentApplication } from "./import-intent-api.http.js";
import { ImportIntentWorkflowTerminator } from "./import-intent-execution.js";
import type { ImportIntentWorkflowTerminatorShape } from "./import-intent-execution.js";
import {
  RecipeImportIntentReviewApplication,
  makeRecipeImportIntentReviewApplication,
} from "./import-intent-review.js";
import { makeD1RecipeImportIntentReviewRepository } from "./import-intent-review.repository.d1.js";
import {
  ImportIntentIdGenerator,
  makeImportIntentApplication,
} from "./import-intent.js";
import type { ImportPrincipal } from "./import-intent.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import { adaptAcquisitionBucket } from "./import-media-acquirer.js";
import { makeD1ImportObservabilityTraceStore } from "./import-observability.d1.js";
import type { ImportTraceContext } from "./import-observability.js";
import {
  ImportObservabilityTraceStore,
  observeImportWorkflowStart,
} from "./import-observability.js";
import { DeadLetterReplayClaimId } from "./import-operations.js";
import { makePilotProviderDispatchGate } from "./import-provider-kernel.js";
import { makeInstalledRecipeExtractor } from "./import-provider-recipe.js";
import {
  ProviderTerminalSettlementService,
  makeD1ProviderTerminalSettlementService,
} from "./import-provider-terminal-settlement.js";
import { ProviderTaskCheckpoint } from "./import-provider-workflow-checkpoint.js";
import {
  ProviderTaskStepConfig,
  runProviderTaskAttempt,
} from "./import-provider-workflow-task.js";
import {
  makeD1ImportBatchStore,
  makeD1ImportQueueAcceptance,
} from "./import-queue-acceptance.d1.js";
import { produceRecipeDraftForImport } from "./import-recipe-draft.js";
import { makeD1RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
import {
  RecipeRecoveryAuthorization,
  RecipeRecoveryOrdinal,
  makeD1RecipeRecoveryRepository,
  recipeRecoveryAuthorizationEventType,
  recipeRecoveryDurableTaskNames,
  resolveRecipeRecoveryWorkflowInput,
} from "./import-recipe-recovery.js";
import type {
  RecipeRecoveryAttempt,
  RecipeRecoveryWorkflowInput,
  RecipeRecoveryWorkflowStarterShape,
} from "./import-recipe-recovery.js";
import { ImportSystemAuthorizer } from "./import-system.auth.js";
import { ImportAuthorizer, makeImportAuthorizer } from "./import.auth.js";
import type { ConfiguredImportPrincipal } from "./import.auth.js";
import { ImportTimestamp } from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import type { ImportWorkflowReconcilerShape } from "./import.workflow.js";
import { CanonicalSourceIdentityResolver } from "./source-identity.js";
import { makeTikTokCanonicalSourceIdentityResolver } from "./source-identity.tiktok.js";

export { runImportVisualAndRecipeWorkflow } from "./import-application-workflows.js";

const ImportBatchQueueDelivery = Schema.Struct({
  deliveryAttempt: ImportBatchDeliveryAttempt,
  message: ImportBatchQueueMessage,
});

/** Safe typed failure for a malformed Cloudflare import queue delivery. */
export interface InvalidImportBatchQueueMessage {
  readonly _tag: "InvalidImportBatchQueueMessage";
}

/** Raw Cloudflare Queue input before the composition seam decodes it. */
export interface ImportBatchQueueDeliveryInput {
  readonly attempts: number;
  readonly body: unknown;
}

/** Narrow runtime acquired only after a queue delivery passes decoding. */
export interface ImportBatchQueueDeliveryRuntime<Error, Requirements> {
  readonly consume: (
    message: ImportBatchQueueMessageType,
    deliveryAttempt: ImportBatchDeliveryAttemptType,
    trace: ImportTraceContext
  ) => Effect.Effect<void, Error, Requirements>;
  readonly observeReceipt: () => Effect.Effect<ImportTraceContext>;
}

/** Deferred acquisition for the admitted queue-delivery runtime. */
export interface ImportBatchQueueDeliveryDependencies<Error, Requirements> {
  readonly acquire: () => Effect.Effect<
    ImportBatchQueueDeliveryRuntime<Error, Requirements>,
    Error,
    Requirements
  >;
}

/**
 * Decode one Cloudflare Queue delivery before observing and delegating it.
 * Malformed bodies cannot acquire or invoke downstream import services.
 */
export const consumeImportBatchQueueDelivery = Effect.fn(
  "ImportRuntime.consumeBatchQueueDelivery"
)(function* consumeImportBatchQueueDeliveryEffect<Error, Requirements>(
  input: ImportBatchQueueDeliveryInput,
  dependencies: ImportBatchQueueDeliveryDependencies<Error, Requirements>
) {
  const { deliveryAttempt, message } = yield* Schema.decodeUnknownEffect(
    ImportBatchQueueDelivery
  )(
    { deliveryAttempt: input.attempts, message: input.body },
    { onExcessProperty: "error" }
  ).pipe(
    Effect.mapError(
      (): InvalidImportBatchQueueMessage => ({
        _tag: "InvalidImportBatchQueueMessage",
      })
    )
  );
  const runtime = yield* dependencies.acquire();
  const trace = yield* runtime.observeReceipt();
  yield* runtime.consume(message, deliveryAttempt, trace);
});

/**
 * Decode one Cloudflare dead-letter delivery before invoking its D1 handler.
 * The queue body remains an ID-only transport contract.
 */
export const consumeImportBatchDeadLetterDelivery = Effect.fn(
  "ImportRuntime.consumeBatchDeadLetterDelivery"
)(function* consumeImportBatchDeadLetterDeliveryEffect<Error, Requirements>(
  body: unknown,
  consume: (
    message: ImportBatchQueueMessageType
  ) => Effect.Effect<void, Error, Requirements>
) {
  const message = yield* Schema.decodeUnknownEffect(ImportBatchQueueMessage)(
    body,
    { onExcessProperty: "error" }
  ).pipe(
    Effect.mapError(
      (): InvalidImportBatchQueueMessage => ({
        _tag: "InvalidImportBatchQueueMessage",
      })
    )
  );
  yield* consume(message);
});

type RecoveryCheckpoint = typeof ProviderTaskCheckpoint.Type;

/** Durable host operations needed by the Effect-owned recipe recovery loop. */
export interface RecipeRecoveryLoopDependencies<Requirements = never> {
  readonly persistUnknown: (
    attempt: RecipeRecoveryAttempt,
    durableTaskName: string
  ) => Effect.Effect<void, never, Requirements>;
  readonly readAttempt: (
    ordinal: RecipeRecoveryOrdinal
  ) => Effect.Effect<RecipeRecoveryAttempt | null, never, Requirements>;
  readonly runAttempt: (
    attempt: RecipeRecoveryAttempt,
    durableTaskName: string
  ) => Effect.Effect<RecoveryCheckpoint, never, Requirements>;
  readonly waitForAuthorization: (
    ordinal: RecipeRecoveryOrdinal
  ) => Effect.Effect<unknown, never, Requirements>;
}

const failedRecoveryCheckpoint = (code: string): RecoveryCheckpoint => ({
  _tag: "Failed",
  code,
  stage: "recipe",
});

const nextRecoveryOrdinal = (ordinal: RecipeRecoveryOrdinal) =>
  Schema.decodeUnknownOption(RecipeRecoveryOrdinal)(ordinal + 1);

const normalizeDurableRecoveryAuthorization = (input: unknown): unknown => {
  try {
    return structuredClone(input);
  } catch {
    return undefined;
  }
};

/**
 * Run the bounded recipe recovery application workflow while the host owns
 * every versioned Cloudflare task and authorization-wait primitive.
 */
export const runRecipeRecoveryLoop = Effect.fn(
  "ImportRuntime.runRecipeRecovery"
)(function* runRecipeRecoveryLoopEffect<Requirements>(
  input: typeof RecipeRecoveryWorkflowInput.Type,
  dependencies: RecipeRecoveryLoopDependencies<Requirements>
) {
  let ordinal = input.attemptOrdinal;
  for (let visited = 0; visited < 8; visited += 1) {
    const attempt = yield* dependencies.readAttempt(ordinal);
    if (
      attempt === null ||
      attempt.importId !== input.importId ||
      attempt.acquisitionGeneration !== input.acquisitionGeneration ||
      attempt.ordinal !== ordinal
    ) {
      return failedRecoveryCheckpoint("recovery_attempt_unavailable");
    }

    const durableTaskNames = recipeRecoveryDurableTaskNames(ordinal);
    const checkpoint = yield* dependencies.runAttempt(
      attempt,
      durableTaskNames.extraction
    );
    if (checkpoint._tag === "Succeeded") {
      return checkpoint;
    }
    if (checkpoint.code !== "outcome_unknown") {
      return checkpoint;
    }

    yield* dependencies.persistUnknown(attempt, durableTaskNames.terminal);
    const next = nextRecoveryOrdinal(ordinal);
    if (Option.isNone(next)) {
      return checkpoint;
    }

    const rawAuthorization = yield* dependencies.waitForAuthorization(
      next.value
    );
    const authorization = Schema.decodeUnknownOption(
      RecipeRecoveryAuthorization,
      { onExcessProperty: "error" }
    )(normalizeDurableRecoveryAuthorization(rawAuthorization));
    if (
      Option.isNone(authorization) ||
      authorization.value.importId !== input.importId ||
      authorization.value.acquisitionGeneration !==
        input.acquisitionGeneration ||
      authorization.value.attemptOrdinal !== next.value
    ) {
      return failedRecoveryCheckpoint("recovery_authorization_invalid");
    }
    ordinal = next.value;
  }
  return failedRecoveryCheckpoint("recovery_attempt_limit_reached");
});

const currentPilotBudgetTimestamp = () =>
  Schema.decodeUnknownSync(PilotBudgetTimestamp)(new Date().toISOString());

/** Cloudflare primitives retained by the recipe recovery Workflow host. */
export interface ImportRecipeRecoveryDurableHost {
  readonly task: typeof Cloudflare.Workflows.task;
  readonly waitForEvent: typeof Cloudflare.Workflows.waitForEvent;
}

/**
 * Acquire and compose the recipe-recovery application runtime. The Workflow
 * class supplies only the durable task and event-wait primitives.
 */
export const makeImportRecipeRecoveryWorkflowHandler = (
  durable: ImportRecipeRecoveryDurableHost
) =>
  Effect.gen(function* makeImportRecipeRecoveryWorkflowHandlerEffect() {
    const runtimeContext = yield* RuntimeContext;
    const queryDatabase =
      yield* Cloudflare.D1.QueryDatabase(MealPlannerDatabase);
    const evidenceBucket =
      yield* Cloudflare.R2.ReadWriteBucket(ImportEvidenceBucket);
    const providerGateway = yield* Cloudflare.AI.QueryGateway(
      ImportProviderGateway
    );
    const runtimeStage = yield* Config.string("ALCHEMY_STAGE");
    const budgetRuntime = makePilotProviderBudgetRuntime(runtimeStage);

    return (rawInput: unknown) =>
      Effect.gen(function* runImportRecipeRecoveryWorkflow() {
        const workflowInput = yield* resolveRecipeRecoveryWorkflowInput(
          rawInput
        ).pipe(Effect.orDie);
        const database = yield* queryDatabase.raw;
        const rawBucket = yield* evidenceBucket.raw;
        const recoveryRepository = makeD1RecipeRecoveryRepository(
          database,
          runtimeStage
        );
        const dispatch = makePilotProviderDispatchGate({
          correlationId: workflowInput.trace.correlationId,
          now: currentPilotBudgetTimestamp,
          repository: makeD1PilotProviderBudgetRepository(
            database,
            runtimeStage
          ),
          runId: Schema.decodeUnknownSync(PilotBudgetRunId)(
            `gaia-118:recipe-recovery:${workflowInput.importId}`
          ),
          runtime: budgetRuntime,
        });
        const extractor = yield* makeInstalledRecipeExtractor({
          client: providerGateway,
          correlationId: workflowInput.trace.correlationId,
          dispatch,
        }).pipe(Effect.provideService(RuntimeContext, runtimeContext));
        const recipeRepository = makeD1RecipeDraftRepository(database);

        return yield* observeImportWorkflowStart(workflowInput.trace).pipe(
          Effect.andThen(
            runRecipeRecoveryLoop(workflowInput, {
              persistUnknown: (attempt, durableTaskName) =>
                durable.task(
                  durableTaskName,
                  recipeRepository
                    .fail({
                      completedAt: currentPilotBudgetTimestamp(),
                      extractionFingerprint:
                        attempt.currentExtractionFingerprint,
                      failureCode: "provider_error",
                    })
                    .pipe(Effect.orDie)
                ),
              readAttempt: (ordinal) =>
                recoveryRepository
                  .readAttempt({
                    acquisitionGeneration: workflowInput.acquisitionGeneration,
                    importId: workflowInput.importId,
                    ordinal,
                  })
                  .pipe(Effect.map(Option.getOrNull), Effect.orDie),
              runAttempt: (attempt, durableTaskName) =>
                durable
                  .task(
                    durableTaskName,
                    runProviderTaskAttempt(
                      "recipe",
                      produceRecipeDraftForImport({
                        bucket: adaptAcquisitionBucket(rawBucket),
                        extractor,
                        importId: attempt.importId,
                        importRepository: makeD1ImportRepository(database),
                        now: currentPilotBudgetTimestamp,
                        recipeRepository,
                        recovery: {
                          acquisitionGeneration: attempt.acquisitionGeneration,
                          dispatchId: attempt.currentDispatchId,
                          evidenceFingerprint: attempt.evidenceFingerprint,
                          extractionFingerprint:
                            attempt.currentExtractionFingerprint,
                          sourceMediaSha256: attempt.sourceMediaSha256,
                          transcriptSha256: attempt.transcriptSha256,
                          visualManifestSha256: attempt.visualManifestSha256,
                        },
                      }),
                      () => ({
                        _tag: "Succeeded" as const,
                        stage: "recipe" as const,
                      }),
                      workflowInput.trace
                    ),
                    ProviderTaskStepConfig
                  )
                  .pipe(
                    Effect.flatMap((encoded) =>
                      Schema.decodeUnknownEffect(ProviderTaskCheckpoint, {
                        onExcessProperty: "error",
                      })(encoded)
                    ),
                    Effect.orDie
                  ),
              waitForAuthorization: (ordinal) =>
                durable
                  .waitForEvent<unknown>(
                    `authorize-recipe-recovery-${ordinal}`,
                    {
                      type: recipeRecoveryAuthorizationEventType(ordinal),
                    }
                  )
                  .pipe(Effect.map(({ payload }) => payload)),
            })
          ),
          Effect.provideService(
            ImportObservabilityTraceStore,
            makeD1ImportObservabilityTraceStore(database, () =>
              new Date().toISOString()
            )
          )
        );
      });
  });

/** Inputs required to construct the import HTTP route services once. */
export interface ImportWorkerRequestLayerInput {
  readonly bucket: AcquisitionBucketLike;
  readonly configuredPrincipals: readonly ConfiguredImportPrincipal[];
  readonly database: AnyD1Database;
  readonly importWorkflowStarter: ImportWorkflowReconcilerShape;
  readonly importWorkflowTerminator: ImportIntentWorkflowTerminatorShape;
  readonly now: () => string;
  readonly queue: ImportBatchQueueShape;
  readonly recipeRecoveryStarter: RecipeRecoveryWorkflowStarterShape;
  readonly runtimeStage: string;
  readonly systemApiToken: Redacted.Redacted<string>;
  readonly systemPrincipal: ImportPrincipal;
  readonly trace: ImportTraceContext;
}

const timestamp = (now: () => string) =>
  Schema.decodeUnknownSync(ImportTimestamp)(now());

/** Construct the typed import route services at the Worker composition root. */
export const makeImportWorkerRequestLayer = (
  input: ImportWorkerRequestLayerInput
) => {
  const d1ImportRepository = makeD1ImportRepository(input.database);
  const identityResolver = makeTikTokCanonicalSourceIdentityResolver(
    globalThis.fetch
  );
  const intentApplication = makeImportIntentApplication(
    d1ImportRepository,
    input.importWorkflowStarter,
    input.trace
  );
  const batch = Layer.succeed(
    ImportBatchService,
    ImportBatchService.of(
      makeImportBatchService({
        identityResolver,
        newBatchId: () =>
          Schema.decodeUnknownSync(ImportBatchId)(crypto.randomUUID()),
        newItemId: () =>
          Schema.decodeUnknownSync(ImportBatchItemId)(crypto.randomUUID()),
        now: () => timestamp(input.now),
        queue: input.queue,
        store: makeD1ImportBatchStore(input.database),
      })
    )
  );
  const carousel = Layer.succeed(
    OperatorCarouselImportService,
    OperatorCarouselImportService.of(
      makeOperatorCarouselImportService({
        application: intentApplication,
        identityResolver,
        newIntentId: () =>
          Schema.decodeUnknownSync(RecipeImportIntentId)(crypto.randomUUID()),
        now: input.now,
        pipeline: {
          preflight: () => Effect.void,
          stage: (pipelineInput) =>
            stageOperatorCarouselForWorkflow({
              adapter: pipelineInput.adapter,
              bucket: input.bucket,
              descriptor: {
                canonicalId: pipelineInput.canonicalId,
                declaredPageCount: pipelineInput.declaredPageCount,
                kind: "tiktok_carousel",
                sourceUrl: pipelineInput.sourceUrl,
              },
              importId: pipelineInput.importId,
            }),
        },
      })
    )
  );
  const settlement = Layer.succeed(
    ProviderTerminalSettlementService,
    ProviderTerminalSettlementService.of(
      makeD1ProviderTerminalSettlementService({
        database: input.database,
        now: () => timestamp(input.now),
        recipeRecoveryStarter: input.recipeRecoveryStarter,
        runtimeStage: input.runtimeStage,
        workflowStarter: input.importWorkflowStarter,
      })
    )
  );
  const intentReview = makeRecipeImportIntentReviewApplication(
    makeD1RecipeImportIntentReviewRepository(input.database)
  );

  return Layer.mergeAll(
    Layer.effect(
      ImportAuthorizer,
      Effect.map(
        makeImportAuthorizer({
          configuredPrincipals: input.configuredPrincipals,
        }),
        ImportAuthorizer.of
      )
    ),
    Layer.effect(
      ImportSystemAuthorizer,
      Effect.map(
        makeImportAuthorizer({
          configuredPrincipals: [
            {
              principal: input.systemPrincipal,
              token: input.systemApiToken,
            },
          ],
        }),
        ImportSystemAuthorizer.of
      )
    ),
    ImportIntentIdGenerator.live,
    Layer.succeed(
      CanonicalSourceIdentityResolver,
      CanonicalSourceIdentityResolver.of(identityResolver)
    ),
    Layer.succeed(
      ImportIntentWorkflowTerminator,
      ImportIntentWorkflowTerminator.of(input.importWorkflowTerminator)
    ),
    Layer.succeed(
      RecipeImportIntentApplication,
      RecipeImportIntentApplication.of(intentApplication)
    ),
    Layer.succeed(
      RecipeImportIntentReviewApplication,
      RecipeImportIntentReviewApplication.of(intentReview)
    ),
    batch,
    carousel,
    Layer.succeed(
      ImportObservabilityTraceStore,
      makeD1ImportObservabilityTraceStore(input.database, input.now)
    ),
    settlement
  );
};

/** Construct queue acceptance only after a queue message is admitted. */
export const makeImportBatchQueueAcceptance = (input: {
  readonly database: AnyD1Database;
  readonly importWorkflowStarter: Pick<
    ImportWorkflowReconcilerShape,
    "ensureStarted"
  >;
  readonly now: () => string;
  readonly principal: ImportPrincipal;
  readonly trace: ImportTraceContext;
}) => {
  const application = makeImportIntentApplication(
    makeD1ImportRepository(input.database),
    input.importWorkflowStarter,
    input.trace
  );
  return makeD1ImportQueueAcceptance({
    application,
    database: input.database,
    newIntentId: () =>
      Schema.decodeUnknownSync(RecipeImportIntentId)(crypto.randomUUID()),
    newReplayClaimId: () =>
      Schema.decodeUnknownSync(DeadLetterReplayClaimId)(crypto.randomUUID()),
    now: input.now,
    principal: input.principal,
    replayClaimLeaseMilliseconds: 60_000,
  });
};
