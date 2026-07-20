import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Layer, Schema } from "effect";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { HealthRoutes } from "./features/health/health.routes.js";
import {
  ImportAuthorizer,
  makeImportAuthorizer,
} from "./features/imports/import.auth.js";
import {
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
import {
  ImportWorkflowStarter,
  ImportWorkflowStarterDeferred,
} from "./features/imports/import.workflow.js";
import {
  CanonicalSourceIdentityResolver,
  SourceAvailabilityValidator,
} from "./features/imports/source-resolver.js";
import {
  makeTikTokCanonicalSourceIdentityResolver,
  makeTikTokSourceAvailabilityValidator,
} from "./features/imports/source-resolver.tiktok.js";
import { MealPlannerDatabase } from "./infrastructure/meal-planner-database.js";

const notFound = HttpServerResponse.json(
  { error: { code: "not_found", message: "The route was not found." } },
  { status: 404 }
).pipe(Effect.orDie);

const MealPlannerWorkerRoutes = HttpRouter.addAll([
  ...HealthRoutes,
  ...ImportRouteDefinitions,
  HttpRouter.route("*", "*", notFound),
]);

/** Effect-native Cloudflare host for health and authenticated recipe imports. */
export default class MealPlannerApi extends Cloudflare.Worker<MealPlannerApi>()(
  "MealPlannerApi",
  { main: import.meta.url },
  Effect.gen(function* MealPlannerApiWorker() {
    const queryDatabase =
      yield* Cloudflare.D1.QueryDatabase(MealPlannerDatabase);
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

    return {
      fetch: Effect.scoped(
        Effect.map(
          HttpRouter.toHttpEffect(MealPlannerWorkerRoutes),
          (routeHandler) =>
            Effect.gen(function* handleMealPlannerRequest() {
              const database = yield* queryDatabase.raw;
              const repositoryLive = Layer.succeed(
                ImportRepository,
                ImportRepository.of(makeD1ImportRepository(database))
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
                    ImportWorkflowStarterDeferred
                  )
                )
              );

              return yield* routeHandler.pipe(
                Effect.provide(Layer.mergeAll(authorizerLive, serviceLive))
              );
            })
        )
      ),
    };
  }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseBinding))
) {}
