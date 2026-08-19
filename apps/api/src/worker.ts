import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { Config, Layer, Redacted, Schema, Stream } from "effect";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import * as authSchema from "./features/auth/auth.database-schema.js";
import { makeMealPlannerAuth } from "./features/auth/auth.js";
import {
  makeAuthenticatedOrganizationResolver,
  makeAuthPrincipalResolver,
} from "./features/auth/auth.principal.js";
import { HealthRoutes } from "./features/health/health.routes.js";
import { HouseholdDomainWorker } from "./features/households/household-domain-worker.js";
import {
  makeHouseholdDomainGateway,
  makeHouseholdRequestLayer,
} from "./features/households/household-request-composition.js";
import type { ImportBatchQueueMessage } from "./features/imports/import-batch.contracts.js";
import { ImportBatchRouteDefinitions } from "./features/imports/import-batch.routes.js";
import { OperatorCarouselRouteDefinitions } from "./features/imports/import-carousel-operator.routes.js";
import {
  makeRecipeImportHttpApiLayer,
  makeRecipeImportNotFoundHttpLayer,
} from "./features/imports/import-intent-api.http.js";
import {
  HouseholdScopeId,
  ImportActorId,
  ImportPrincipal,
} from "./features/imports/import-intent.js";
import { adaptAcquisitionBucket } from "./features/imports/import-media-acquisition-bucket.alchemy.js";
import { makeD1ImportObservabilityTraceStore } from "./features/imports/import-observability.d1.js";
import {
  ImportObservabilityTraceStore,
  makeImportTraceContext,
  observeImportQueueReceipt,
} from "./features/imports/import-observability.js";
import type { ImportTraceContext } from "./features/imports/import-observability.js";
import { ProviderTerminalSettlementRouteDefinitions } from "./features/imports/import-provider-terminal-settlement.routes.js";
import { makeRecipeRecoveryWorkflowStarter } from "./features/imports/import-recipe-recovery.js";
import ImportRecipeRecoveryWorkflow from "./features/imports/import-recipe-recovery.workflow.js";
import {
  consumeImportBatchDeadLetterDelivery,
  consumeImportBatchQueueDelivery,
  makeImportBatchQueueAcceptance,
} from "./features/imports/import-runtime-composition.js";
import { makeImportWorkerRequestLayer } from "./features/imports/import-worker-request-layer.js";
import { ImportSystemAuthorizationConfig } from "./features/imports/import.auth.config.js";
import ImportAcquisitionWorkflow, {
  makeImportWorkflowTerminator,
  makeImportWorkflowStarter,
} from "./features/imports/import.workflow.js";
import {
  PilotProviderBudgetRuntime,
  makePilotProviderBudgetRuntime,
} from "./features/pilots/pilot-provider-budget.js";
import {
  ImportBatchDeadLetterQueue,
  ImportBatchQueue,
  makeCloudflareImportBatchQueue,
} from "./infrastructure/import-batch-queue.js";
import { ImportEvidenceBucket } from "./infrastructure/import-evidence-bucket.js";
import { MealPlannerAuthDatabase } from "./infrastructure/meal-planner-auth-database.js";
import { MealPlannerDatabase } from "./infrastructure/meal-planner-database.js";
import { withCurrentRequestCancellation } from "./infrastructure/request-cancellation.js";

const MealPlannerOperationalRoutes = [
  ...HealthRoutes,
  ...OperatorCarouselRouteDefinitions,
  ...ImportBatchRouteDefinitions,
  ...ProviderTerminalSettlementRouteDefinitions,
] as const;

const currentIsoTimestamp = () => new Date().toISOString();

/** Effect-native Cloudflare host for health and authenticated import routes. */
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
    workersDev: false,
  },
  Effect.gen(function* MealPlannerApiWorker() {
    const queryDatabase =
      yield* Cloudflare.D1.QueryDatabase(MealPlannerDatabase);
    const authQueryDatabase = yield* Cloudflare.D1.QueryDatabase(
      MealPlannerAuthDatabase
    );
    const evidenceBucket =
      yield* Cloudflare.R2.ReadWriteBucket(ImportEvidenceBucket);
    const runtimeStage = yield* Config.string("ALCHEMY_STAGE");
    const pilotProviderBudgetRuntime =
      makePilotProviderBudgetRuntime(runtimeStage);
    const importAcquisitionWorkflow = yield* ImportAcquisitionWorkflow;
    const importRecipeRecoveryWorkflow = yield* ImportRecipeRecoveryWorkflow;
    const importBatchQueue = yield* ImportBatchQueue;
    const importBatchDeadLetterQueue = yield* ImportBatchDeadLetterQueue;
    const householdDomain = yield* Cloudflare.Workers.bindWorker(
      HouseholdDomainWorker
    );
    const importBatchQueueWriter =
      yield* Cloudflare.Queues.WriteQueue(importBatchQueue);
    const authSecret = yield* Config.redacted("BETTER_AUTH_SECRET");
    const importSystemApiToken = yield* ImportSystemAuthorizationConfig.pipe(
      Effect.orDie
    );
    const importSystemActorId = Schema.decodeUnknownSync(ImportActorId)(
      yield* Config.string("MEAL_PLANNER_IMPORT_ACTOR_ID")
    );
    const importSystemHouseholdScopeId = Schema.decodeUnknownSync(
      HouseholdScopeId
    )(yield* Config.string("MEAL_PLANNER_IMPORT_HOUSEHOLD_SCOPE_ID"));
    const importSystemPrincipal = Schema.decodeUnknownSync(ImportPrincipal)({
      actorId: importSystemActorId,
      householdScopeId: importSystemHouseholdScopeId,
    });
    const makeBatchQueueAcceptance = (
      database: AnyD1Database,
      trace: ImportTraceContext
    ) =>
      makeImportBatchQueueAcceptance({
        database,
        importWorkflowStarter: makeImportWorkflowStarter(
          importAcquisitionWorkflow
        ),
        now: currentIsoTimestamp,
        principal: importSystemPrincipal,
        trace,
      });
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
        Stream.runForEach(messages, ({ attempts, body }) =>
          consumeImportBatchQueueDelivery(
            { attempts, body },
            {
              acquire: () =>
                Effect.gen(function* acquireImportBatchQueueRuntime() {
                  const database = yield* queryDatabase.raw;
                  const traceStore = makeD1ImportObservabilityTraceStore(
                    database,
                    currentIsoTimestamp
                  );
                  return {
                    consume: (message, deliveryAttempt, trace) =>
                      makeBatchQueueAcceptance(database, trace)
                        .consume(message, deliveryAttempt)
                        .pipe(
                          Effect.provideService(
                            ImportObservabilityTraceStore,
                            traceStore
                          )
                        ),
                    observeReceipt: () =>
                      observeImportQueueReceipt().pipe(
                        Effect.provideService(
                          ImportObservabilityTraceStore,
                          traceStore
                        )
                      ),
                  };
                }),
            }
          ).pipe(
            Effect.provideService(
              PilotProviderBudgetRuntime,
              pilotProviderBudgetRuntime
            )
          )
        )
    );
    yield* Cloudflare.Queues.consumeQueueMessages<
      typeof ImportBatchQueueMessage.Encoded
    >(
      importBatchDeadLetterQueue,
      { batchSize: 1, maxConcurrency: 1 },
      (messages) =>
        Stream.runForEach(messages, ({ body }) =>
          consumeImportBatchDeadLetterDelivery(body, (message) =>
            queryDatabase.raw.pipe(
              Effect.flatMap((database) => {
                const trace = makeImportTraceContext();
                const acceptance = makeBatchQueueAcceptance(database, trace);
                return acceptance.deadLetter(message);
              })
            )
          ).pipe(
            Effect.provideService(
              PilotProviderBudgetRuntime,
              pilotProviderBudgetRuntime
            )
          )
        )
    );
    return {
      fetch: Effect.gen(function* handleMealPlannerRequest() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = request.source;
        if (!(webRequest instanceof Request)) {
          return yield* Effect.die("Expected a Web Request source.");
        }
        const database = yield* queryDatabase.raw;
        const runtimeContext = yield* RuntimeContext;
        const acquisitionBucket = adaptAcquisitionBucket(
          evidenceBucket,
          runtimeContext
        );
        const authDatabase = drizzle(yield* authQueryDatabase.raw);
        const requestOrigin = new URL(webRequest.url).origin;
        const auth = makeMealPlannerAuth({
          baseURL: requestOrigin,
          database: authDatabase,
          schema: authSchema,
          secret: Redacted.value(authSecret),
        });
        if (new URL(webRequest.url).pathname.startsWith("/api/auth/")) {
          return HttpServerResponse.fromWeb(
            yield* Effect.promise(() => auth.fetch(webRequest))
          );
        }
        const rawImportBatchQueue = yield* importBatchQueueWriter.raw;
        const trace = makeImportTraceContext();
        const authenticatedOrganizationResolver =
          makeAuthenticatedOrganizationResolver({ auth });
        const requestLayer = makeImportWorkerRequestLayer({
          bucket: acquisitionBucket,
          database,
          importWorkflowStarter: makeImportWorkflowStarter(
            importAcquisitionWorkflow
          ),
          importWorkflowTerminator: makeImportWorkflowTerminator(
            importAcquisitionWorkflow
          ),
          now: currentIsoTimestamp,
          principalResolver: makeAuthPrincipalResolver({
            auth,
          }),
          queue: makeCloudflareImportBatchQueue(rawImportBatchQueue),
          recipeRecoveryStarter: makeRecipeRecoveryWorkflowStarter(
            importRecipeRecoveryWorkflow
          ),
          runtimeStage,
          systemApiToken: importSystemApiToken,
          systemPrincipal: importSystemPrincipal,
          trace,
        });
        const householdRequestLayer = makeHouseholdRequestLayer({
          gateway: makeHouseholdDomainGateway(householdDomain),
          resolver: authenticatedOrganizationResolver,
        });
        const routeHandler = yield* HttpRouter.toHttpEffect(
          Layer.mergeAll(
            HttpRouter.addAll(MealPlannerOperationalRoutes),
            makeRecipeImportHttpApiLayer(),
            householdRequestLayer,
            makeRecipeImportNotFoundHttpLayer()
          ).pipe(
            Layer.provide(requestLayer),
            HttpRouter.provideRequest(requestLayer)
          )
        );
        return yield* withCurrentRequestCancellation(routeHandler);
      }).pipe(
        Effect.provideService(
          PilotProviderBudgetRuntime,
          pilotProviderBudgetRuntime
        )
      ),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
        Cloudflare.Queues.EventSourceLive,
        Cloudflare.Queues.WriteQueueBinding
      )
    )
  )
) {}
