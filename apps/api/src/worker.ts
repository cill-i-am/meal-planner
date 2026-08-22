import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { Config, Layer, Redacted, Schema } from "effect";
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
import {
  makeRecipeImportHttpApiLayer,
  makeRecipeImportNotFoundHttpLayer,
} from "./features/imports/import-intent-api.http.js";
import { makeImportTraceContext } from "./features/imports/import-observability.js";
import { ProviderTerminalSettlementRouteDefinitions } from "./features/imports/import-provider-terminal-settlement.routes.js";
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
import {
  PilotProviderBudgetRuntime,
  makePilotProviderBudgetRuntime,
} from "./features/pilots/pilot-provider-budget.js";
import { ImportEvidenceEventQueue } from "./infrastructure/import-evidence-event-queue.js";
import { MealPlannerAuthDatabase } from "./infrastructure/meal-planner-auth-database.js";
import { MealPlannerDatabase } from "./infrastructure/meal-planner-database.js";
import { withCurrentRequestCancellation } from "./infrastructure/request-cancellation.js";

const MealPlannerOperationalRoutes = [
  ...HealthRoutes,
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
    const runtimeStage = yield* Config.string("ALCHEMY_STAGE");
    const pilotProviderBudgetRuntime =
      makePilotProviderBudgetRuntime(runtimeStage);
    const importAcquisitionWorkflow = yield* ImportAcquisitionWorkflow;
    const importRecipeRecoveryWorkflow = yield* ImportRecipeRecoveryWorkflow;
    const importEvidenceEvents = yield* Cloudflare.Queues.WriteQueue(
      ImportEvidenceEventQueue
    );
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
    return {
      fetch: Effect.gen(function* handleMealPlannerRequest() {
        const runtimeContext = yield* RuntimeContext;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = request.source;
        if (!(webRequest instanceof Request)) {
          return yield* Effect.die("Expected a Web Request source.");
        }
        const database = yield* queryDatabase.raw;
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
          registerEvidenceRoute: (message) =>
            importEvidenceEvents
              .send(message)
              .pipe(Effect.provideService(RuntimeContext, runtimeContext)),
          runtimeContext,
          runtimeStage,
          systemApiToken: importSystemApiToken,
          systemPrincipal: importSystemPrincipal,
          trace,
        });
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
        Cloudflare.Queues.WriteQueueBinding
      )
    )
  )
) {}
