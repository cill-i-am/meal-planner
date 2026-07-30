import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Layer, Schema, Stream } from "effect";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { HealthRoutes } from "./features/health/health.routes.js";
import { ImportBatchQueueMessage } from "./features/imports/import-batch.contracts.js";
import {
  OperatorCarouselImportService,
  makeOperatorCarouselImportService,
} from "./features/imports/import-carousel-operator.service.js";
import { stageOperatorCarouselForWorkflow } from "./features/imports/import-carousel-staging.js";
import type { AcquisitionBucketLike } from "./features/imports/import-media-acquirer.js";
import { makeD1ImportObservabilityTraceStore } from "./features/imports/import-observability.d1.js";
import {
  ImportObservabilityTraceStore,
  observeImportQueueReceipt,
} from "./features/imports/import-observability.js";
import { DeadLetterReplayClaimId } from "./features/imports/import-operations.js";
import {
  ProviderTerminalSettlementService,
  makeD1ProviderTerminalSettlementService,
} from "./features/imports/import-provider-terminal-settlement.js";
import { ProviderTerminalSettlementRouteDefinitions } from "./features/imports/import-provider-terminal-settlement.routes.js";
import { makeD1ImportQueueAcceptance } from "./features/imports/import-queue-acceptance.d1.js";
import { makeRecipeRecoveryWorkflowStarter } from "./features/imports/import-recipe-recovery.js";
import ImportRecipeRecoveryWorkflow from "./features/imports/import-recipe-recovery.workflow.js";
import {
  RecipeReviewService,
  makeRecipeReviewService,
} from "./features/imports/import-recipe-review.js";
import { makeD1RecipeReviewRepository } from "./features/imports/import-recipe-review.repository.d1.js";
import { RecipeReviewRouteDefinitions } from "./features/imports/import-recipe-review.routes.js";
import {
  ImportAuthorizer,
  makeImportAuthorizer,
} from "./features/imports/import.auth.js";
import {
  CreateImportRequest,
  ImportId,
  ImportTimestamp,
} from "./features/imports/import.contracts.js";
import { makeD1ImportRepository } from "./features/imports/import.repository.d1.js";
import { ImportRepository } from "./features/imports/import.repository.js";
import { ImportRouteDefinitions } from "./features/imports/import.routes.js";
import {
  ImportService,
  makeImportService,
} from "./features/imports/import.service.js";
import ImportAcquisitionWorkflow, {
  ImportWorkflowStarter,
  makeImportWorkflowStarter,
} from "./features/imports/import.workflow.js";
import { SourceAvailabilityValidator } from "./features/imports/source-availability.js";
import { makeTikTokSourceAvailabilityValidator } from "./features/imports/source-availability.tiktok.js";
import { CanonicalSourceIdentityResolver } from "./features/imports/source-identity.js";
import { makeTikTokCanonicalSourceIdentityResolver } from "./features/imports/source-identity.tiktok.js";
import {
  PilotProviderBudgetRuntime,
  makePilotProviderBudgetRuntime,
} from "./features/pilots/pilot-provider-budget.js";
import {
  ImportBatchDeadLetterQueue,
  ImportBatchQueue,
} from "./infrastructure/import-batch-queue.js";
import { ImportEvidenceBucket } from "./infrastructure/import-evidence-bucket.js";
import { MealPlannerDatabase } from "./infrastructure/meal-planner-database.js";
import { withCurrentRequestCancellation } from "./infrastructure/request-cancellation.js";

const notFound = HttpServerResponse.json(
  { error: { code: "not_found", message: "The route was not found." } },
  { status: 404 }
).pipe(Effect.orDie);

const MealPlannerWorkerRoutes = HttpRouter.addAll([
  ...HealthRoutes,
  ...ImportRouteDefinitions,
  ...ProviderTerminalSettlementRouteDefinitions,
  ...RecipeReviewRouteDefinitions,
  HttpRouter.route("*", "*", notFound),
]);

const currentIsoTimestamp = () => new Date().toISOString();

/** Effect-native Cloudflare host for health and authenticated recipe imports. */
export default class MealPlannerApi extends Cloudflare.Worker<MealPlannerApi>()(
  "MealPlannerApi",
  {
    main: import.meta.url,
    observability: {
      enabled: true,
      headSamplingRate: 1,
      logs: {
        enabled: true,
        headSamplingRate: 1,
        // Invocation logs include request/response metadata and fetch URLs.
        // Persist only the application's closed, allowlisted event contract.
        invocationLogs: false,
        persist: true,
      },
      traces: {
        // Automatic Worker tracing records url.full/url.path/url.query.
        // Closed Effect events are instead persisted in the private D1 trace.
        enabled: false,
      },
    },
    url: false,
  },
  Effect.gen(function* MealPlannerApiWorker() {
    const queryDatabase =
      yield* Cloudflare.D1.QueryDatabase(MealPlannerDatabase);
    const evidenceBucket =
      yield* Cloudflare.R2.ReadWriteBucket(ImportEvidenceBucket);
    const runtimeStage = yield* Config.string("ALCHEMY_STAGE");
    const pilotProviderBudgetRuntime =
      makePilotProviderBudgetRuntime(runtimeStage);
    const importAcquisitionWorkflow = yield* ImportAcquisitionWorkflow;
    const importRecipeRecoveryWorkflow = yield* ImportRecipeRecoveryWorkflow;
    const importBatchQueue = yield* ImportBatchQueue;
    const importBatchDeadLetterQueue = yield* ImportBatchDeadLetterQueue;
    yield* Cloudflare.Queues.consumeQueueMessages(
      importBatchQueue,
      {
        batchSize: 1,
        deadLetterQueue: importBatchDeadLetterQueue.queueName,
        deadLetterQueueId: importBatchDeadLetterQueue.queueId,
        maxConcurrency: 1,
        maxRetries: 3,
      },
      (messages) =>
        Stream.runForEach(messages, ({ body }) =>
          Effect.gen(function* consumeImportBatchMessage() {
            const database = yield* queryDatabase.raw;
            const traceStore = makeD1ImportObservabilityTraceStore(
              database,
              currentIsoTimestamp
            );
            yield* Effect.gen(function* consumeObservedImportBatchMessage() {
              const message = yield* Schema.decodeUnknownEffect(
                ImportBatchQueueMessage
              )(body, { onExcessProperty: "error" }).pipe(
                Effect.mapError(
                  (): { readonly _tag: "InvalidImportBatchQueueMessage" } => ({
                    _tag: "InvalidImportBatchQueueMessage",
                  })
                )
              );
              const correlationId = yield* observeImportQueueReceipt();
              const imports = makeImportService({
                availabilityValidator: makeTikTokSourceAvailabilityValidator(
                  globalThis.fetch
                ),
                identityResolver: makeTikTokCanonicalSourceIdentityResolver(
                  globalThis.fetch
                ),
                newId: () =>
                  Schema.decodeUnknownSync(ImportId)(crypto.randomUUID()),
                now: () =>
                  Schema.decodeUnknownSync(ImportTimestamp)(
                    currentIsoTimestamp()
                  ),
                repository: makeD1ImportRepository(database),
                workflowStarter: makeImportWorkflowStarter(
                  importAcquisitionWorkflow,
                  { correlationId }
                ),
              });
              yield* makeD1ImportQueueAcceptance({
                database,
                imports,
                maximumDeliveryAttempts: 3,
                newReplayClaimId: () =>
                  Schema.decodeUnknownSync(DeadLetterReplayClaimId)(
                    crypto.randomUUID()
                  ),
                now: currentIsoTimestamp,
                replayClaimLeaseMilliseconds: 60_000,
                sourceRequestForCanonicalId: (canonicalId) =>
                  Schema.decodeUnknownSync(CreateImportRequest)({
                    source: {
                      kind: "tiktok",
                      url: `https://www.tiktok.com/@source/video/${canonicalId}`,
                    },
                  }),
              }).consume(message);
            }).pipe(
              Effect.provideService(ImportObservabilityTraceStore, traceStore)
            );
          }).pipe(
            Effect.provideService(
              PilotProviderBudgetRuntime,
              pilotProviderBudgetRuntime
            )
          )
        )
    );
    const importApiToken = yield* Config.redacted(
      "MEAL_PLANNER_IMPORT_API_TOKEN"
    );
    const identityResolverLive = Layer.succeed(
      CanonicalSourceIdentityResolver,
      CanonicalSourceIdentityResolver.of(
        makeTikTokCanonicalSourceIdentityResolver(globalThis.fetch)
      )
    );
    const availabilityValidatorLive = Layer.succeed(
      SourceAvailabilityValidator,
      makeTikTokSourceAvailabilityValidator(globalThis.fetch)
    );
    const authorizerLive = Layer.effect(
      ImportAuthorizer,
      Effect.map(makeImportAuthorizer(importApiToken), ImportAuthorizer.of)
    );
    const workflowStarterLive = Layer.succeed(
      ImportWorkflowStarter,
      ImportWorkflowStarter.of(
        makeImportWorkflowStarter(importAcquisitionWorkflow)
      )
    );
    return {
      fetch: Effect.scoped(
        Effect.map(
          HttpRouter.toHttpEffect(MealPlannerWorkerRoutes),
          (routeHandler) =>
            Effect.gen(function* handleMealPlannerRequest() {
              const database = yield* queryDatabase.raw;
              const rawBucket = yield* evidenceBucket.raw;
              const importObservabilityTraceStoreLive = Layer.succeed(
                ImportObservabilityTraceStore,
                makeD1ImportObservabilityTraceStore(
                  database,
                  currentIsoTimestamp
                )
              );
              const repositoryLive = Layer.succeed(
                ImportRepository,
                ImportRepository.of(makeD1ImportRepository(database))
              );
              const operatorCarouselServiceLive = Layer.succeed(
                OperatorCarouselImportService,
                OperatorCarouselImportService.of(
                  makeOperatorCarouselImportService({
                    identityResolver: makeTikTokCanonicalSourceIdentityResolver(
                      globalThis.fetch
                    ),
                    newId: () =>
                      Schema.decodeUnknownSync(ImportId)(crypto.randomUUID()),
                    now: () =>
                      Schema.decodeUnknownSync(ImportTimestamp)(
                        new Date().toISOString()
                      ),
                    pipeline: {
                      preflight: () => Effect.void,
                      process: (pipelineInput) =>
                        stageOperatorCarouselForWorkflow({
                          adapter: pipelineInput.adapter,
                          bucket: rawBucket as unknown as AcquisitionBucketLike,
                          descriptor: {
                            canonicalId: pipelineInput.canonicalId,
                            declaredPageCount: pipelineInput.declaredPageCount,
                            kind: "tiktok_carousel",
                            sourceUrl: pipelineInput.sourceUrl,
                          },
                          importId: pipelineInput.importId,
                        }).pipe(
                          Effect.andThen(
                            makeImportWorkflowStarter(
                              importAcquisitionWorkflow
                            ).ensureStarted(pipelineInput.importId)
                          )
                        ),
                    },
                    repository: makeD1ImportRepository(database),
                  })
                )
              );
              const recipeReviewServiceLive = Layer.succeed(
                RecipeReviewService,
                RecipeReviewService.of(
                  makeRecipeReviewService({
                    now: () =>
                      Schema.decodeUnknownSync(ImportTimestamp)(
                        new Date().toISOString()
                      ),
                    repository: makeD1RecipeReviewRepository(database),
                  })
                )
              );
              const providerTerminalSettlementServiceLive = Layer.succeed(
                ProviderTerminalSettlementService,
                ProviderTerminalSettlementService.of(
                  makeD1ProviderTerminalSettlementService({
                    database,
                    now: () =>
                      Schema.decodeUnknownSync(ImportTimestamp)(
                        new Date().toISOString()
                      ),
                    recipeRecoveryStarter: makeRecipeRecoveryWorkflowStarter(
                      importRecipeRecoveryWorkflow
                    ),
                    runtimeStage,
                    workflowStarter: makeImportWorkflowStarter(
                      importAcquisitionWorkflow
                    ),
                  })
                )
              );
              const serviceLive = Layer.effect(
                ImportService,
                Effect.gen(function* ImportServiceLive() {
                  const storedRepository = yield* ImportRepository;
                  const identityResolver =
                    yield* CanonicalSourceIdentityResolver;
                  const availabilityValidator =
                    yield* SourceAvailabilityValidator;
                  const workflowStarter = yield* ImportWorkflowStarter;
                  return ImportService.of(
                    makeImportService({
                      availabilityValidator,
                      identityResolver,
                      newId: () =>
                        Schema.decodeUnknownSync(ImportId)(crypto.randomUUID()),
                      now: () =>
                        Schema.decodeUnknownSync(ImportTimestamp)(
                          new Date().toISOString()
                        ),
                      repository: storedRepository,
                      workflowStarter,
                    })
                  );
                })
              ).pipe(
                Layer.provide(
                  Layer.mergeAll(
                    repositoryLive,
                    identityResolverLive,
                    availabilityValidatorLive,
                    workflowStarterLive
                  )
                )
              );

              return yield* withCurrentRequestCancellation(
                routeHandler.pipe(
                  Effect.provide(
                    Layer.mergeAll(
                      authorizerLive,
                      operatorCarouselServiceLive,
                      importObservabilityTraceStoreLive,
                      providerTerminalSettlementServiceLive,
                      recipeReviewServiceLive,
                      serviceLive
                    )
                  )
                )
              );
            }).pipe(
              Effect.provideService(
                PilotProviderBudgetRuntime,
                pilotProviderBudgetRuntime
              )
            )
        )
      ),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
        Cloudflare.Queues.EventSourceLive
      )
    )
  )
) {}
