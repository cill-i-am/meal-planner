import {
  ActionNotFoundProblemDetails,
  IdempotencyConflictProblemDetails,
  IllegalTransitionProblemDetails,
  IntentNotFoundProblemDetails,
  IntentRedirectedProblem,
  InternalErrorProblemDetails,
  InvalidRequestProblemDetails,
  RecipeImportApi,
  RecipeImportBearerAuth,
  RecipeImportCurrentPrincipal,
  RecipeImportDefectBoundary,
  RecipeImportPrincipal,
  RecipeImportSchemaErrors,
  RecipeNotFoundProblemDetails,
  UnauthorizedProblemDetails,
  VersionConflictProblemDetails,
} from "@meal-planner/recipe-import-api";
import type { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
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
  HttpServerResponse,
} from "effect/unstable/http";
import {
  HttpApiBuilder,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import type {
  RecipeImportActionMutationConflict,
  RecipeImportActionNotFound,
  RecipeImportActionTransitionRejected,
  RecipeImportActionVersionConflict,
  RecipeImportRecipeNotFound,
} from "./import-intent-review.js";
import { RecipeImportIntentReviewApplication } from "./import-intent-review.js";
import type { ImportIntentTransitionMutationConflict } from "./import-intent-transition.js";
import {
  ImportPrincipal as ImportPrincipalSchema,
  ReconcileStalledImportIntentContinuationsRequest,
  RecipeImportIntentRedirected as RecipeImportIntentRedirectedSchema,
} from "./import-intent.js";
import type {
  ImportPrincipal,
  RecipeImportIntentIdempotencyConflict,
  RecipeImportIntentNotFound,
  RecipeImportIntentRedirected,
  RecipeImportIntentTransitionRejected,
  makeImportIntentApplication,
} from "./import-intent.js";
import { ImportAuthorizer } from "./import.auth.js";
import type {
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
} from "./import.errors.js";

export type RecipeImportIntentApplicationShape = ReturnType<
  typeof makeImportIntentApplication
>;

export class RecipeImportIntentApplication extends Context.Service<
  RecipeImportIntentApplication,
  RecipeImportIntentApplicationShape
>()("meal-planner/RecipeImportIntentApplication") {}

const decodeApiPrincipal = Schema.decodeUnknownSync(RecipeImportPrincipal);
const decodeDomainPrincipal = Schema.decodeUnknownSync(ImportPrincipalSchema);

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

type PersistenceError = ImportPersistenceCorrupt | ImportPersistenceUnavailable;
type ReviewMutationError =
  | PersistenceError
  | RecipeImportActionMutationConflict
  | RecipeImportActionNotFound
  | RecipeImportActionTransitionRejected
  | RecipeImportActionVersionConflict
  | RecipeImportRecipeNotFound;

const mapPersistenceError = (_error: PersistenceError) => internalErrorProblem;

const mapIntentReadError = (
  error: PersistenceError | RecipeImportIntentNotFound
) =>
  error._tag === "RecipeImportIntentNotFound"
    ? intentNotFoundProblem
    : mapPersistenceError(error);

const mapActionReadError = (error: ReviewMutationError) => {
  switch (error._tag) {
    case "RecipeImportActionNotFound": {
      return actionNotFoundProblem;
    }
    case "ImportPersistenceCorrupt":
    case "ImportPersistenceUnavailable":
    case "RecipeImportActionMutationConflict":
    case "RecipeImportActionTransitionRejected":
    case "RecipeImportActionVersionConflict":
    case "RecipeImportRecipeNotFound": {
      return internalErrorProblem;
    }
    default: {
      return absurd<never>(error);
    }
  }
};

const mapActionMutationError = (error: ReviewMutationError) => {
  switch (error._tag) {
    case "ImportPersistenceCorrupt":
    case "ImportPersistenceUnavailable": {
      return internalErrorProblem;
    }
    case "RecipeImportActionMutationConflict": {
      return idempotencyConflictProblem;
    }
    case "RecipeImportActionNotFound": {
      return actionNotFoundProblem;
    }
    case "RecipeImportActionTransitionRejected": {
      return illegalTransitionProblem;
    }
    case "RecipeImportActionVersionConflict": {
      return versionConflictProblem;
    }
    case "RecipeImportRecipeNotFound": {
      return internalErrorProblem;
    }
    default: {
      return absurd<never>(error);
    }
  }
};

const mapRecipeReadError = (error: ReviewMutationError) =>
  error._tag === "RecipeImportRecipeNotFound"
    ? recipeNotFoundProblem
    : internalErrorProblem;

const mapAdmitError = (
  error:
    | ImportIntentTransitionMutationConflict
    | PersistenceError
    | RecipeImportIntentIdempotencyConflict
    | RecipeImportIntentNotFound
    | RecipeImportIntentRedirected
    | RecipeImportIntentTransitionRejected
) => {
  switch (error._tag) {
    case "RecipeImportIntentIdempotencyConflict": {
      return idempotencyConflictProblem;
    }
    case "ImportPersistenceCorrupt":
    case "ImportPersistenceUnavailable":
    case "ImportIntentTransitionMutationConflict":
    case "RecipeImportIntentNotFound":
    case "RecipeImportIntentRedirected":
    case "RecipeImportIntentTransitionRejected": {
      return internalErrorProblem;
    }
    default: {
      return absurd<never>(error);
    }
  }
};

const mapUnknownIntentMutationError = (error: unknown) => {
  if (typeof error !== "object" || error === null || !("_tag" in error)) {
    return internalErrorProblem;
  }
  switch (error._tag) {
    case "ImportIntentTransitionMutationConflict": {
      return idempotencyConflictProblem;
    }
    case "RecipeImportIntentNotFound": {
      return intentNotFoundProblem;
    }
    case "RecipeImportIntentRedirected": {
      if (!Schema.is(RecipeImportIntentRedirectedSchema)(error)) {
        return internalErrorProblem;
      }
      return Schema.decodeUnknownSync(IntentRedirectedProblem)({
        code: "intent_redirected",
        detail: "This intent redirects to the canonical recipe import intent.",
        intent: error.intent,
        redirect: error.redirect,
        status: 409,
        title: "Intent redirected",
        type: "https://meal-planner.local/problems/intent-redirected",
      });
    }
    case "RecipeImportIntentTransitionRejected": {
      return illegalTransitionProblem;
    }
    case "RecipeImportIntentVersionConflict": {
      return versionConflictProblem;
    }
    default: {
      return internalErrorProblem;
    }
  }
};

const toDomainPrincipal = (
  principal: typeof RecipeImportPrincipal.Type
): ImportPrincipal =>
  decodeDomainPrincipal({
    actorId: principal.actorId,
    householdScopeId: principal.householdScopeId,
  });

const retryAfterSeconds = 2;
const retryAfterHeaders = (status: string) =>
  status === "processing" ? { "retry-after": retryAfterSeconds } : {};

const stalledContinuationRequest = Schema.decodeUnknownSync(
  ReconcileStalledImportIntentContinuationsRequest
)({ limit: 25, minimumAgeMilliseconds: 300_000 });

const deferIntentContinuations = (
  application: RecipeImportIntentApplicationShape,
  principal: ImportPrincipal,
  intentId?: RecipeImportIntentId
) =>
  Effect.addFinalizer(() =>
    Effect.all(
      [
        ...(intentId === undefined
          ? []
          : [application.continueSourceResolution(principal, intentId)]),
        application.reconcileStalledContinuations(stalledContinuationRequest),
      ],
      { concurrency: 1, discard: true }
    ).pipe(
      Effect.catchCause(() =>
        Effect.logError("recipe_import.intent_continuation_failed")
      )
    )
  );

const RecipeImportIntentHandlers = HttpApiBuilder.group(
  RecipeImportApi,
  "recipeImportIntents",
  (handlers) =>
    handlers
      .handle("create", ({ headers, payload }) =>
        Effect.gen(function* createRecipeImportIntent() {
          const principal = toDomainPrincipal(
            yield* RecipeImportCurrentPrincipal
          );
          const application = yield* RecipeImportIntentApplication;
          const admitted = yield* application
            .admit(principal, payload, headers["idempotency-key"])
            .pipe(Effect.mapError(mapAdmitError));
          const { intent } = admitted;
          if (intent.status !== "processing") {
            return yield* Effect.fail(internalErrorProblem);
          }
          yield* deferIntentContinuations(application, principal, intent.id);
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
          const principal = toDomainPrincipal(
            yield* RecipeImportCurrentPrincipal
          );
          const application = yield* RecipeImportIntentApplication;
          const intent = yield* application
            .get(principal, params.id)
            .pipe(Effect.mapError(mapIntentReadError));
          yield* deferIntentContinuations(
            application,
            principal,
            intent.status === "processing" &&
              intent.processing.type === "resolving_source"
              ? intent.id
              : undefined
          );
          return HttpApiSchema.withHeaders({
            body: intent,
            headers: retryAfterHeaders(intent.status),
          });
        })
      )
      .handle("getAction", ({ params }) =>
        Effect.gen(function* getRecipeImportAction() {
          const principal = toDomainPrincipal(
            yield* RecipeImportCurrentPrincipal
          );
          const application = yield* RecipeImportIntentReviewApplication;
          return yield* application
            .getAction(principal, params.id, params.actionId)
            .pipe(Effect.mapError(mapActionReadError));
        })
      )
      .handle("answerAction", ({ headers, params, payload }) =>
        Effect.gen(function* answerRecipeImportAction() {
          const principal = toDomainPrincipal(
            yield* RecipeImportCurrentPrincipal
          );
          const application = yield* RecipeImportIntentReviewApplication;
          return yield* application
            .answerAction(
              principal,
              params.id,
              params.actionId,
              payload,
              headers["idempotency-key"]
            )
            .pipe(Effect.mapError(mapActionMutationError));
        })
      )
      .handle("confirmAction", ({ headers, params, payload }) =>
        Effect.gen(function* confirmRecipeImportAction() {
          const principal = toDomainPrincipal(
            yield* RecipeImportCurrentPrincipal
          );
          const application = yield* RecipeImportIntentReviewApplication;
          return yield* application
            .confirmAction(
              principal,
              params.id,
              params.actionId,
              payload,
              headers["idempotency-key"]
            )
            .pipe(Effect.mapError(mapActionMutationError));
        })
      )
      .handle("cancel", ({ headers, params, payload }) =>
        Effect.gen(function* cancelRecipeImportIntent() {
          const principal = toDomainPrincipal(
            yield* RecipeImportCurrentPrincipal
          );
          const application = yield* RecipeImportIntentApplication;
          const result = yield* application
            .cancel(principal, params.id, payload, headers["idempotency-key"])
            .pipe(Effect.mapError(mapUnknownIntentMutationError));
          return result.status === "cancelled"
            ? result
            : yield* Effect.fail(internalErrorProblem);
        })
      )
      .handle("timeline", ({ params }) =>
        Effect.gen(function* getRecipeImportTimeline() {
          const principal = toDomainPrincipal(
            yield* RecipeImportCurrentPrincipal
          );
          const application = yield* RecipeImportIntentApplication;
          return yield* application
            .timeline(principal, params.id)
            .pipe(Effect.mapError(mapIntentReadError));
        })
      )
);

const RecipeHandlers = HttpApiBuilder.group(
  RecipeImportApi,
  "recipes",
  (handlers) =>
    handlers.handle("get", ({ params }) =>
      Effect.gen(function* getRecipe() {
        const principal = toDomainPrincipal(
          yield* RecipeImportCurrentPrincipal
        );
        const application = yield* RecipeImportIntentReviewApplication;
        return yield* application
          .getRecipe(principal, params.recipeId)
          .pipe(Effect.mapError(mapRecipeReadError));
      })
    )
);

const RecipeImportBearerAuthLive = Layer.effect(
  RecipeImportBearerAuth,
  // eslint-disable-next-line unicorn/no-array-method-this-argument -- This is Effect.map's dual data-first form, not Array.prototype.map's thisArg.
  Effect.map(ImportAuthorizer, (authorizer) => ({
    bearerAuth: (httpEffect, { credential }) =>
      authorizer.authorizeBearer(credential).pipe(
        Effect.map((principal) =>
          decodeApiPrincipal({
            actorId: principal.actorId,
            householdScopeId: principal.householdScopeId,
          })
        ),
        Effect.mapError(() => unauthorizedProblem),
        Effect.flatMap((principal) =>
          httpEffect.pipe(
            Effect.provideService(RecipeImportCurrentPrincipal, principal)
          )
        )
      ),
  }))
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
  RecipeImportBearerAuthLive,
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

const RecipeImportHttpPlatformServices = Layer.mergeAll(
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

/** Mount the canonical typed API beside explicitly named operational routes. */
export const makeRecipeImportWorkerHttpLayer = <
  const OperationalRoutes extends readonly AnyHttpRoute[],
>(options: {
  readonly operationalRoutes: OperationalRoutes;
}) =>
  Layer.mergeAll(
    HttpRouter.addAll(options.operationalRoutes),
    makeRecipeImportHttpApiLayer(),
    HttpRouter.addAll(RecipeImportNotFoundRoutes)
  );
