import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
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
  makeHouseholdMealPlanGateway,
  makeHouseholdMealPlanRequestLayer,
  makeHouseholdRequestLayer,
} from "./features/households/household-request-composition.js";
import HouseholdImportBatchItemWorkflow from "./features/imports/household-import-batch-item.workflow.js";
import {
  decodeHouseholdBatchQueueMessage,
  householdBatchWorkflowInstanceId,
} from "./features/imports/household-import-batch-transport.js";
import { makeD1ImportEvidenceRouteRepository } from "./features/imports/import-evidence-route.repository.d1.js";
import {
  makeRecipeImportHttpApiLayer,
  makeRecipeImportNotFoundHttpLayer,
} from "./features/imports/import-intent-api.http.js";
import { makeImportTraceContext } from "./features/imports/import-observability.js";
import { ProviderRecoveryRouteDefinitions } from "./features/imports/import-provider-recovery.routes.js";
import { makeRecipeRecoveryWorkflowStarter } from "./features/imports/import-recipe-recovery.js";
import ImportRecipeRecoveryWorkflow from "./features/imports/import-recipe-recovery.workflow.js";
import {
  HouseholdScopeId,
  ImportActorId,
  ImportPrincipal,
} from "./features/imports/import-system-principal.js";
import { makeImportWorkerRequestLayer } from "./features/imports/import-worker-request-layer.js";
import { ImportSystemAuthorizationConfig } from "./features/imports/import.auth.config.js";
import ImportAcquisitionWorkflow, {
  makeImportWorkflowStarter,
} from "./features/imports/import.workflow.js";
import { ProviderAccountingRouteDefinitions } from "./features/provider-accounting/provider-accounting.routes.js";
import {
  HouseholdImportBatchDeadLetterQueue,
  HouseholdImportBatchQueue,
} from "./infrastructure/household-import-batch-queue.js";
import { MealPlannerAuthDatabase } from "./infrastructure/meal-planner-auth-database.js";
import { MealPlannerDatabase } from "./infrastructure/meal-planner-database.js";
import { withCurrentRequestCancellation } from "./infrastructure/request-cancellation.js";

const MealPlannerOperationalRoutes = [
  ...HealthRoutes,
  ...ProviderAccountingRouteDefinitions,
  ...ProviderRecoveryRouteDefinitions,
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
    const importAcquisitionWorkflow = yield* ImportAcquisitionWorkflow;
    const importRecipeRecoveryWorkflow = yield* ImportRecipeRecoveryWorkflow;
    const householdBatchItemWorkflow = yield* HouseholdImportBatchItemWorkflow;
    const householdBatchQueue = yield* HouseholdImportBatchQueue;
    const householdBatchDeadLetterQueue =
      yield* HouseholdImportBatchDeadLetterQueue;
    const householdDomain = yield* Cloudflare.Workers.bindWorker(
      HouseholdDomainWorker
    );
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
    yield* Cloudflare.Queues.consumeQueueMessages(
      householdBatchQueue,
      {
        batchSize: 1,
        deadLetterQueue: householdBatchDeadLetterQueue.queueName,
        deadLetterQueueId: householdBatchDeadLetterQueue.queueId,
        maxConcurrency: 4,
        maxRetries: 3,
      },
      (messages) =>
        Stream.runForEach(messages, ({ body }) =>
          decodeHouseholdBatchQueueMessage(body).pipe(
            Effect.flatMap((message) => {
              const instanceId = householdBatchWorkflowInstanceId(message);
              return householdBatchItemWorkflow
                .create({ id: instanceId, params: message })
                .pipe(
                  Effect.catchCause(() =>
                    householdBatchItemWorkflow.get(instanceId).pipe(
                      Effect.flatMap((instance) => instance.status()),
                      Effect.filterOrFail(
                        ({ status }) =>
                          status === "queued" ||
                          status === "running" ||
                          status === "waiting" ||
                          status === "waitingForPause" ||
                          status === "complete",
                        () => new Error("batch workflow start unavailable")
                      )
                    )
                  )
                );
            }),
            Effect.asVoid
          )
        )
    );
    yield* Cloudflare.Queues.consumeQueueMessages(
      householdBatchDeadLetterQueue,
      { batchSize: 1, maxConcurrency: 1 },
      (messages) =>
        Stream.runForEach(messages, ({ body }) =>
          decodeHouseholdBatchQueueMessage(body).pipe(
            Effect.flatMap((message) =>
              householdDomain.failImportBatchItem({
                admission: {
                  actor: { _tag: "System", purpose: "batch_item_dispatch" },
                  organizationId: message.organizationId,
                },
                batchId: message.batchId,
                expectedGeneration: message.generation,
                failureCode: "dispatch_exhausted",
                itemId: message.itemId,
              })
            ),
            Effect.asVoid
          )
        )
    );
    return {
      fetch: Effect.gen(function* handleMealPlannerRequest() {
        const runtimeContext = yield* RuntimeContext;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = request.source;
        if (!(webRequest instanceof Request)) {
          return yield* Effect.die("Expected a Web Request source.");
        }
        const database = yield* queryDatabase.raw;
        const evidenceRoutes = makeD1ImportEvidenceRouteRepository(database);
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
        const trace = makeImportTraceContext();
        const authenticatedOrganizationResolver =
          makeAuthenticatedOrganizationResolver({ auth });
        const requestLayer = makeImportWorkerRequestLayer({
          database,
          householdDomain,
          importWorkflowStarter: makeImportWorkflowStarter(
            importAcquisitionWorkflow
          ),
          now: currentIsoTimestamp,
          organizationResolver: authenticatedOrganizationResolver,
          principalResolver: makeAuthPrincipalResolver({
            auth,
          }),
          recipeRecoveryStarter: makeRecipeRecoveryWorkflowStarter(
            importRecipeRecoveryWorkflow
          ),
          registerEvidenceRoute: (route) =>
            evidenceRoutes.register(route).pipe(
              Effect.filterOrFail(
                (outcome) => outcome === "Registered",
                () => ({ reason: "route_conflict" })
              ),
              Effect.asVoid
            ),
          runtimeContext,
          systemApiToken: importSystemApiToken,
          systemPrincipal: importSystemPrincipal,
          trace,
        });
        const requestServices = requestLayer;
        const householdRequestLayer = makeHouseholdRequestLayer({
          gateway: makeHouseholdDomainGateway(householdDomain),
          resolver: authenticatedOrganizationResolver,
        });
        const householdMealPlanRequestLayer = makeHouseholdMealPlanRequestLayer(
          {
            gateway: makeHouseholdMealPlanGateway({
              domain: householdDomain,
            }),
            resolver: authenticatedOrganizationResolver,
          }
        );
        const routeHandler = yield* HttpRouter.toHttpEffect(
          Layer.mergeAll(
            HttpRouter.addAll(MealPlannerOperationalRoutes),
            makeRecipeImportHttpApiLayer(),
            householdRequestLayer,
            householdMealPlanRequestLayer,
            makeRecipeImportNotFoundHttpLayer()
          ).pipe(
            Layer.provide(requestServices),
            HttpRouter.provideRequest(requestServices)
          )
        );
        return yield* withCurrentRequestCancellation(routeHandler);
      }),
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
