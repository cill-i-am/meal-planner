import {
  ActionNotFoundProblemDetails,
  IdempotencyConflictProblemDetails,
  IllegalTransitionProblemDetails,
  IntentNotFoundProblemDetails,
  InternalErrorProblemDetails,
  InvalidRequestProblemDetails,
  Recipe,
  RecipeImportApi,
  RecipeImportAction,
  RecipeImportCurrentPrincipal,
  RecipeImportDefectBoundary,
  RecipeImportPrincipal,
  RecipeImportSessionAuth,
  RecipeImportSchemaErrors,
  RecipeImportIntent,
  RecipeImportTimeline,
  RequiresActionRecipeImportIntent,
  SucceededRecipeImportIntent,
  CancelledRecipeImportIntent,
  RecipeNotFoundProblemDetails,
  UnauthorizedProblemDetails,
  VersionConflictProblemDetails,
} from "@meal-planner/recipe-import-api";
import {
  absurd,
  Cause,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
} from "effect";
import {
  Etag,
  HttpPlatform,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import {
  HttpApiBuilder,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import {
  AuthenticatedOrganizationResolver,
  AuthPrincipalResolver,
} from "../auth/auth.principal.js";
import type {
  HouseholdDomainWorkerMethods,
  HouseholdRecipeImportDomainFailure,
} from "../households/household-domain-worker.js";
import { HouseholdAdmitRecipeImportResult } from "../households/recipe-import/household-recipe-import.contract.js";
import { HouseholdMemberAdmission as HouseholdMemberAdmissionSchema } from "../households/rpc/command-envelope.js";
import { RecipeImportWorkflowDispatcher } from "./import-workflow-dispatcher.js";

export class RecipeImportHouseholdDomain extends Context.Service<
  RecipeImportHouseholdDomain,
  HouseholdDomainWorkerMethods
>()("meal-planner/RecipeImportHouseholdDomain") {}

const decodeApiPrincipal = Schema.decodeUnknownSync(RecipeImportPrincipal);

const invalidRequestProblem = Schema.decodeUnknownSync(
  InvalidRequestProblemDetails
)({
  code: "invalid_request",
  detail: "The request did not match the API contract.",
  status: 400,
  title: "Invalid request",
  type: "https://meal-planner.local/problems/invalid-request",
});
const unauthorizedProblem = Schema.decodeUnknownSync(
  UnauthorizedProblemDetails
)({
  code: "unauthorized",
  detail: "Authentication is required for this request.",
  status: 401,
  title: "Unauthorized",
  type: "https://meal-planner.local/problems/unauthorized",
});
const intentNotFoundProblem = Schema.decodeUnknownSync(
  IntentNotFoundProblemDetails
)({
  code: "intent_not_found",
  detail: "The recipe import intent was not found.",
  status: 404,
  title: "Intent not found",
  type: "https://meal-planner.local/problems/intent-not-found",
});
const actionNotFoundProblem = Schema.decodeUnknownSync(
  ActionNotFoundProblemDetails
)({
  code: "action_not_found",
  detail: "The recipe import action was not found.",
  status: 404,
  title: "Action not found",
  type: "https://meal-planner.local/problems/action-not-found",
});
const recipeNotFoundProblem = Schema.decodeUnknownSync(
  RecipeNotFoundProblemDetails
)({
  code: "recipe_not_found",
  detail: "The recipe was not found.",
  status: 404,
  title: "Recipe not found",
  type: "https://meal-planner.local/problems/recipe-not-found",
});
const idempotencyConflictProblem = Schema.decodeUnknownSync(
  IdempotencyConflictProblemDetails
)({
  code: "idempotency_conflict",
  detail: "The idempotency key was already used for a different request.",
  status: 409,
  title: "Idempotency conflict",
  type: "https://meal-planner.local/problems/idempotency-conflict",
});
const versionConflictProblem = Schema.decodeUnknownSync(
  VersionConflictProblemDetails
)({
  code: "version_conflict",
  detail: "The resource changed before this request was applied.",
  status: 409,
  title: "Version conflict",
  type: "https://meal-planner.local/problems/version-conflict",
});
const illegalTransitionProblem = Schema.decodeUnknownSync(
  IllegalTransitionProblemDetails
)({
  code: "illegal_transition",
  detail: "The requested transition is not valid in the current state.",
  status: 409,
  title: "Illegal transition",
  type: "https://meal-planner.local/problems/illegal-transition",
});
const internalErrorProblem = Schema.decodeUnknownSync(
  InternalErrorProblemDetails
)({
  code: "internal_error",
  detail: "The request could not be completed.",
  status: 500,
  title: "Internal error",
  type: "https://meal-planner.local/problems/internal-error",
});

const mapInfrastructureFailure = (
  error: Exclude<
    HouseholdRecipeImportDomainFailure,
    { readonly _tag: "HouseholdRecipeImportFailure" }
  >
) =>
  error._tag === "HouseholdInvalidInput"
    ? invalidRequestProblem
    : internalErrorProblem;

const mapAdmitFailure = (error: HouseholdRecipeImportDomainFailure) => {
  if (error._tag !== "HouseholdRecipeImportFailure") {
    return mapInfrastructureFailure(error);
  }
  if (error.reason === "idempotency_conflict") {
    return idempotencyConflictProblem;
  }
  return error.reason === "invalid_input"
    ? invalidRequestProblem
    : internalErrorProblem;
};

const mapIntentReadFailure = (error: HouseholdRecipeImportDomainFailure) => {
  if (error._tag !== "HouseholdRecipeImportFailure") {
    return mapInfrastructureFailure(error);
  }
  if (error.reason === "intent_not_found") {
    return intentNotFoundProblem;
  }
  return error.reason === "invalid_input"
    ? invalidRequestProblem
    : internalErrorProblem;
};

const mapActionReadFailure = (error: HouseholdRecipeImportDomainFailure) => {
  if (error._tag !== "HouseholdRecipeImportFailure") {
    return mapInfrastructureFailure(error);
  }
  if (error.reason === "action_not_found") {
    return actionNotFoundProblem;
  }
  return error.reason === "invalid_input"
    ? invalidRequestProblem
    : internalErrorProblem;
};

const mapActionMutationFailure = (
  error: HouseholdRecipeImportDomainFailure
) => {
  if (error._tag !== "HouseholdRecipeImportFailure") {
    return mapInfrastructureFailure(error);
  }
  switch (error.reason) {
    case "action_not_found": {
      return actionNotFoundProblem;
    }
    case "idempotency_conflict": {
      return idempotencyConflictProblem;
    }
    case "illegal_transition": {
      return illegalTransitionProblem;
    }
    case "intent_not_found": {
      return internalErrorProblem;
    }
    case "recipe_not_found": {
      return internalErrorProblem;
    }
    case "generation_conflict":
    case "version_conflict": {
      return versionConflictProblem;
    }
    case "invalid_input": {
      return invalidRequestProblem;
    }
    case "persistence_unavailable": {
      return internalErrorProblem;
    }
    default: {
      return absurd<never>(error.reason);
    }
  }
};

const mapIntentMutationFailure = (
  error: HouseholdRecipeImportDomainFailure
) => {
  if (error._tag !== "HouseholdRecipeImportFailure") {
    return mapInfrastructureFailure(error);
  }
  switch (error.reason) {
    case "idempotency_conflict": {
      return idempotencyConflictProblem;
    }
    case "illegal_transition": {
      return illegalTransitionProblem;
    }
    case "intent_not_found": {
      return intentNotFoundProblem;
    }
    case "generation_conflict":
    case "version_conflict": {
      return versionConflictProblem;
    }
    case "invalid_input": {
      return invalidRequestProblem;
    }
    case "action_not_found":
    case "persistence_unavailable":
    case "recipe_not_found": {
      return internalErrorProblem;
    }
    default: {
      return absurd<never>(error.reason);
    }
  }
};

const mapRecipeReadFailure = (error: HouseholdRecipeImportDomainFailure) => {
  if (error._tag !== "HouseholdRecipeImportFailure") {
    return mapInfrastructureFailure(error);
  }
  if (error.reason === "recipe_not_found") {
    return recipeNotFoundProblem;
  }
  return error.reason === "invalid_input"
    ? invalidRequestProblem
    : internalErrorProblem;
};

const retryAfterSeconds = 2;
const retryAfterHeaders = (status: string) =>
  status === "processing" ? { "retry-after": retryAfterSeconds } : {};

const decodeHouseholdResult = <S extends Schema.Top>(schema: S) =>
  Effect.flatMap((result: Schema.Json) =>
    Schema.decodeUnknownEffect(schema)(result).pipe(
      Effect.mapError(() => internalErrorProblem)
    )
  );

const currentHouseholdAdmission = Effect.gen(
  function* resolveCurrentHouseholdAdmission() {
    const principal = yield* RecipeImportCurrentPrincipal;
    const resolver = yield* AuthenticatedOrganizationResolver;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const organization = yield* resolver
      .resolve(new globalThis.Headers(Object.entries(request.headers)))
      .pipe(Effect.mapError(() => unauthorizedProblem));
    return yield* Schema.decodeUnknownEffect(HouseholdMemberAdmissionSchema)({
      actor: { _tag: "Member", actorId: principal.actorId },
      organizationId: organization.organizationId,
    }).pipe(Effect.mapError(() => unauthorizedProblem));
  }
);

const RecipeImportIntentHandlers = HttpApiBuilder.group(
  RecipeImportApi,
  "recipeImportIntents",
  (handlers) =>
    handlers
      .handle("create", ({ headers, payload }) =>
        Effect.gen(function* createRecipeImportIntent() {
          const admission = yield* currentHouseholdAdmission;
          const household = yield* RecipeImportHouseholdDomain;
          const workflowDispatcher = yield* RecipeImportWorkflowDispatcher;
          const admitted = yield* household
            .admitRecipeImport({
              admission,
              idempotencyKey: headers["idempotency-key"],
              source: payload.source,
            })
            .pipe(
              Effect.mapError(mapAdmitFailure),
              decodeHouseholdResult(HouseholdAdmitRecipeImportResult)
            );
          const { intent } = admitted;
          if (intent.status !== "processing") {
            return yield* Effect.fail(internalErrorProblem);
          }
          yield* workflowDispatcher.dispatch({
            admission,
            committed: admitted,
          });
          return HttpApiSchema.withHeaders({
            body: intent,
            headers: {
              location: intent.links.self,
              "retry-after": retryAfterSeconds,
            },
          });
        })
      )
      .handle("get", ({ params }) =>
        Effect.gen(function* getRecipeImportIntent() {
          const admission = yield* currentHouseholdAdmission;
          const household = yield* RecipeImportHouseholdDomain;
          const intent = yield* household
            .readRecipeImport({ admission, intentId: params.id })
            .pipe(
              Effect.mapError(mapIntentReadFailure),
              decodeHouseholdResult(RecipeImportIntent)
            );
          return HttpApiSchema.withHeaders({
            body: intent,
            headers: retryAfterHeaders(intent.status),
          });
        })
      )
      .handle("getAction", ({ params }) =>
        Effect.gen(function* getRecipeImportAction() {
          const admission = yield* currentHouseholdAdmission;
          const household = yield* RecipeImportHouseholdDomain;
          return yield* household
            .readRecipeImportAction({
              actionId: params.actionId,
              admission,
              intentId: params.id,
            })
            .pipe(
              Effect.mapError(mapActionReadFailure),
              decodeHouseholdResult(RecipeImportAction)
            );
        })
      )
      .handle("answerAction", ({ headers, params, payload }) =>
        Effect.gen(function* answerRecipeImportAction() {
          const admission = yield* currentHouseholdAdmission;
          const household = yield* RecipeImportHouseholdDomain;
          return yield* household
            .answerRecipeImportAction({
              actionId: params.actionId,
              admission,
              idempotencyKey: headers["idempotency-key"],
              intentId: params.id,
              request: payload,
            })
            .pipe(
              Effect.mapError(mapActionMutationFailure),
              decodeHouseholdResult(RequiresActionRecipeImportIntent)
            );
        })
      )
      .handle("confirmAction", ({ headers, params, payload }) =>
        Effect.gen(function* confirmRecipeImportAction() {
          const admission = yield* currentHouseholdAdmission;
          const household = yield* RecipeImportHouseholdDomain;
          return yield* household
            .confirmRecipeImportAction({
              actionId: params.actionId,
              admission,
              idempotencyKey: headers["idempotency-key"],
              intentId: params.id,
              request: payload,
            })
            .pipe(
              Effect.mapError(mapActionMutationFailure),
              decodeHouseholdResult(SucceededRecipeImportIntent)
            );
        })
      )
      .handle("cancel", ({ headers, params, payload }) =>
        Effect.gen(function* cancelRecipeImportIntent() {
          const admission = yield* currentHouseholdAdmission;
          const household = yield* RecipeImportHouseholdDomain;
          const result = yield* household
            .cancelRecipeImport({
              admission,
              idempotencyKey: headers["idempotency-key"],
              intentId: params.id,
              request: payload,
            })
            .pipe(
              Effect.mapError(mapIntentMutationFailure),
              decodeHouseholdResult(CancelledRecipeImportIntent)
            );
          return result;
        })
      )
      .handle("timeline", ({ params }) =>
        Effect.gen(function* getRecipeImportTimeline() {
          const admission = yield* currentHouseholdAdmission;
          const household = yield* RecipeImportHouseholdDomain;
          return yield* household
            .readRecipeImportTimeline({ admission, intentId: params.id })
            .pipe(
              Effect.mapError(mapIntentReadFailure),
              decodeHouseholdResult(RecipeImportTimeline)
            );
        })
      )
);

const RecipeHandlers = HttpApiBuilder.group(
  RecipeImportApi,
  "recipes",
  (handlers) =>
    handlers.handle("get", ({ params }) =>
      Effect.gen(function* getRecipe() {
        const admission = yield* currentHouseholdAdmission;
        const household = yield* RecipeImportHouseholdDomain;
        return yield* household
          .readRecipe({ admission, recipeId: params.recipeId })
          .pipe(
            Effect.mapError(mapRecipeReadFailure),
            decodeHouseholdResult(Recipe)
          );
      })
    )
);

const RecipeImportSessionAuthLive = Layer.effect(
  RecipeImportSessionAuth,
  AuthPrincipalResolver.pipe(
    Effect.map((principalResolver) =>
      RecipeImportSessionAuth.of((httpEffect) =>
        Effect.gen(function* resolveRecipeImportSession() {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const headers = new globalThis.Headers(
            Object.entries(request.headers)
          );
          const apiPrincipal = yield* principalResolver.resolve(headers).pipe(
            Effect.map(decodeApiPrincipal),
            Effect.mapError(() => unauthorizedProblem)
          );
          return yield* httpEffect.pipe(
            Effect.provideService(RecipeImportCurrentPrincipal, apiPrincipal)
          );
        })
      )
    )
  )
);

const RecipeImportSchemaErrorsLive =
  HttpApiMiddleware.layerSchemaErrorTransform(
    RecipeImportSchemaErrors,
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- HttpApi requires a synchronous Effect-valued transform.
    (error) =>
      error.kind === "Body" || error.kind === "ResponseHeaders"
        ? Effect.logError("recipe_import.http.response_schema_error").pipe(
            Effect.andThen(
              HttpServerResponse.json(internalErrorProblem, {
                headers: { "content-type": "application/problem+json" },
                status: 500,
              }).pipe(Effect.orDie)
            )
          )
        : Effect.fail(invalidRequestProblem)
  );

const RecipeImportDefectBoundaryLive = Layer.succeed(
  RecipeImportDefectBoundary,
  RecipeImportDefectBoundary.of((httpEffect) =>
    Effect.catchCauseIf(httpEffect, Cause.hasDies, () =>
      Effect.logError("recipe_import.http.defect").pipe(
        Effect.andThen(
          HttpServerResponse.json(internalErrorProblem, {
            headers: { "content-type": "application/problem+json" },
            status: 500,
          }).pipe(Effect.orDie)
        )
      )
    )
  )
);

const RecipeImportHttpMiddlewareLive = Layer.mergeAll(
  RecipeImportSessionAuthLive,
  RecipeImportSchemaErrorsLive,
  RecipeImportDefectBoundaryLive
);

/** The JSON-only Worker API never exposes Effect's file-response surface. */
const RecipeImportHttpPlatformLive = Layer.succeed(HttpPlatform.HttpPlatform, {
  compression: {
    algorithms: new Set<HttpPlatform.CompressionAlgorithm>(),
    compressResponse: (response) => Effect.succeed(response),
  },
  fileResponse: () =>
    Effect.die("Recipe import file responses are unsupported"),
  fileWebResponse: () =>
    Effect.die("Recipe import file responses are unsupported"),
  platform: "web",
});

export const RecipeImportHttpPlatformServices = Layer.mergeAll(
  Etag.layer,
  FileSystem.layerNoop({}),
  RecipeImportHttpPlatformLive,
  Path.layer
);

/** Register the complete typed API only after request-scoped services exist. */
export const makeRecipeImportHttpApiLayer = () =>
  HttpApiBuilder.layer(RecipeImportApi, {
    openapiPath: "/openapi.json",
  }).pipe(
    Layer.provide(Layer.mergeAll(RecipeImportIntentHandlers, RecipeHandlers)),
    Layer.provide(RecipeImportHttpMiddlewareLive),
    Layer.provide(RecipeImportHttpPlatformServices)
  );

// eslint-disable-next-line typescript/no-explicit-any -- Effect's heterogeneous Route collection uses unconstrained error and context parameters.
type AnyHttpRoute = HttpRouter.Route<any, any>;

const notFound = HttpServerResponse.json(
  { error: { code: "not_found", message: "The route was not found." } },
  { status: 404 }
).pipe(Effect.orDie);

const RecipeImportNotFoundRoutes = [
  HttpRouter.route("*", "*", notFound),
] as const;

export const makeRecipeImportNotFoundHttpLayer = () =>
  HttpRouter.addAll(RecipeImportNotFoundRoutes);

/** Mount the canonical typed API beside explicitly named operational routes. */
export const makeRecipeImportWorkerHttpLayer = <
  const OperationalRoutes extends readonly AnyHttpRoute[],
>(options: {
  readonly operationalRoutes: OperationalRoutes;
}) =>
  Layer.mergeAll(
    HttpRouter.addAll(options.operationalRoutes),
    makeRecipeImportHttpApiLayer(),
    makeRecipeImportNotFoundHttpLayer()
  );
