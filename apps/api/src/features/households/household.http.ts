import type { MealPlan } from "@meal-planner/household-api";
import {
  HouseholdApi,
  HouseholdCurrentPrincipal,
  HouseholdMealPlanApi,
  HouseholdMealPlanConflictProblem,
  HouseholdMealPlanCurrentPrincipal,
  HouseholdMealPlanInternalProblem,
  HouseholdMealPlanInvalidRequestProblem,
  HouseholdMealPlanNotFoundProblem,
  HouseholdMealPlanPrincipal,
  HouseholdMealPlanSchemaErrors,
  HouseholdSessionAuth,
  MealPlanInstant,
  toHouseholdMealPlanResponse,
} from "@meal-planner/household-api";
import { Clock, Effect, Layer, Schema } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/unstable/httpapi";
import type { HttpApiSchemaError } from "effect/unstable/httpapi/HttpApiError";

import { AuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import type {
  MealPlanCreateFailure,
  MealPlanDecisionFailure,
  MealPlanReadFailure,
  MealPlanSwapFailure,
} from "./household.gateway.js";
import {
  HouseholdDomainGateway,
  HouseholdMealPlanGateway,
} from "./household.gateway.js";

const unauthorizedProblem = {
  code: "unauthorized",
  message: "Sign in and select a household to continue.",
  status: 401,
} as const;

const internalProblem = {
  code: "internal_error",
  message: "Household storage is temporarily unavailable.",
  status: 500,
} as const;

const invalidMealPlanRequestProblem = Schema.decodeUnknownSync(
  HouseholdMealPlanInvalidRequestProblem
)({
  code: "invalid_request",
  message: "The meal-plan request is invalid.",
  status: 400,
});

const mealPlanNotFoundProblem = Schema.decodeUnknownSync(
  HouseholdMealPlanNotFoundProblem
)({
  code: "meal_plan_not_found",
  message: "Meal plan not found.",
  status: 404,
});

const mealPlanConflictProblem = Schema.decodeUnknownSync(
  HouseholdMealPlanConflictProblem
)({
  code: "meal_plan_conflict",
  message: "The meal plan changed or conflicts with an earlier request.",
  status: 409,
});

const mealPlanInternalProblem = Schema.decodeUnknownSync(
  HouseholdMealPlanInternalProblem
)({
  code: "internal_error",
  message: "Household storage is temporarily unavailable.",
  status: 500,
});

const currentMealPlanInstant = Clock.currentTimeMillis.pipe(
  Effect.map((millis) =>
    Schema.decodeUnknownSync(MealPlanInstant)(new Date(millis).toISOString())
  )
);

const mapCreateMealPlanError = (error: MealPlanCreateFailure) =>
  error._tag === "MealPlanRequestConflict"
    ? mealPlanConflictProblem
    : mealPlanInternalProblem;

const mapReadMealPlanError = (error: MealPlanReadFailure) =>
  error._tag === "MealPlanNotFound"
    ? mealPlanNotFoundProblem
    : mealPlanInternalProblem;

const mapDecisionMealPlanError = (error: MealPlanDecisionFailure) => {
  if (error._tag === "MealPlanNotFound") {
    return mealPlanNotFoundProblem;
  }
  if (error._tag === "MealPlanPersistenceFailure") {
    return mealPlanInternalProblem;
  }
  return mealPlanConflictProblem;
};

const mapSwapMealPlanError = (error: MealPlanSwapFailure) =>
  error._tag === "MealPlanSwapRejected"
    ? invalidMealPlanRequestProblem
    : mapDecisionMealPlanError(error);

const observeMealPlanFailure = <E extends { readonly _tag: string }>(
  error: E
) =>
  error._tag === "MealPlanPersistenceFailure"
    ? Effect.logError("household.meal_plan.persistence_failed")
    : Effect.void;

const exposeMealPlanResult = <E extends { readonly _tag: string }, P>(
  effect: Effect.Effect<MealPlan, E>,
  mapError: (error: E) => P
) =>
  effect.pipe(
    Effect.tapError(observeMealPlanFailure),
    Effect.mapError(mapError),
    Effect.map(toHouseholdMealPlanResponse)
  );

const HouseholdSessionAuthLive = Layer.effect(
  HouseholdSessionAuth,
  AuthenticatedOrganizationResolver.pipe(
    Effect.map((resolver) =>
      HouseholdSessionAuth.of((httpEffect) =>
        Effect.gen(function* resolveHouseholdSession() {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const principal = yield* resolver
            .resolve(new globalThis.Headers(Object.entries(request.headers)))
            .pipe(Effect.mapError(() => unauthorizedProblem));
          const mealPlanPrincipal = yield* Schema.decodeUnknownEffect(
            HouseholdMealPlanPrincipal
          )({
            actorId: principal.userId,
            organizationId: principal.organizationId,
          }).pipe(Effect.mapError(() => unauthorizedProblem));
          return yield* httpEffect.pipe(
            Effect.provideService(HouseholdCurrentPrincipal, {
              organizationId: principal.organizationId,
            }),
            Effect.provideService(
              HouseholdMealPlanCurrentPrincipal,
              mealPlanPrincipal
            )
          );
        })
      )
    )
  )
);

const HouseholdMealPlanHandlers = HttpApiBuilder.group(
  HouseholdMealPlanApi,
  "mealPlans",
  (handlers) =>
    handlers
      .handle("create", ({ payload }) =>
        Effect.gen(function* createMealPlan() {
          const principal = yield* HouseholdMealPlanCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          return yield* exposeMealPlanResult(
            gateway.create({ payload, principal }),
            mapCreateMealPlanError
          );
        })
      )
      .handle("read", ({ params }) =>
        Effect.gen(function* readMealPlan() {
          const principal = yield* HouseholdMealPlanCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          return yield* exposeMealPlanResult(
            gateway.read({ draftId: params.draftId, principal }),
            mapReadMealPlanError
          );
        })
      )
      .handle("swap", ({ params, payload }) =>
        Effect.gen(function* swapMealPlan() {
          const principal = yield* HouseholdMealPlanCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          const swappedAt = yield* currentMealPlanInstant;
          return yield* exposeMealPlanResult(
            gateway.swap({
              draftId: params.draftId,
              payload,
              principal,
              swappedAt,
            }),
            mapSwapMealPlanError
          );
        })
      )
      .handle("approve", ({ params, payload }) =>
        Effect.gen(function* approveMealPlan() {
          const principal = yield* HouseholdMealPlanCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          const decidedAt = yield* currentMealPlanInstant;
          return yield* exposeMealPlanResult(
            gateway.approve({
              decidedAt,
              draftId: params.draftId,
              payload,
              principal,
            }),
            mapDecisionMealPlanError
          );
        })
      )
      .handle("reject", ({ params, payload }) =>
        Effect.gen(function* rejectMealPlan() {
          const principal = yield* HouseholdMealPlanCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          const decidedAt = yield* currentMealPlanInstant;
          return yield* exposeMealPlanResult(
            gateway.reject({
              decidedAt,
              draftId: params.draftId,
              payload,
              principal,
            }),
            mapDecisionMealPlanError
          );
        })
      )
);

const transformMealPlanSchemaError = (error: HttpApiSchemaError) =>
  error.kind === "Body" || error.kind === "ResponseHeaders"
    ? Effect.logError("household.meal_plan.response_schema_error").pipe(
        Effect.andThen(
          HttpServerResponse.json(mealPlanInternalProblem, {
            headers: { "content-type": "application/problem+json" },
            status: 500,
          }).pipe(Effect.orDie)
        )
      )
    : Effect.fail(invalidMealPlanRequestProblem);

const HouseholdMealPlanSchemaErrorsLive =
  HttpApiMiddleware.layerSchemaErrorTransform(
    HouseholdMealPlanSchemaErrors,
    transformMealPlanSchemaError
  );

const HouseholdHandlers = HttpApiBuilder.group(
  HouseholdApi,
  "households",
  (handlers) =>
    handlers.handle("current", () =>
      Effect.gen(function* currentHousehold() {
        const principal = yield* HouseholdCurrentPrincipal;
        const gateway = yield* HouseholdDomainGateway;
        return yield* gateway.ensure(principal.organizationId).pipe(
          Effect.tapError(() =>
            Effect.logError("household.domain.ensure_failed")
          ),
          Effect.mapError(() => internalProblem)
        );
      })
    )
);

/** Mount the authenticated household tracer API. */
export const makeHouseholdHttpApiLayer = () =>
  HttpApiBuilder.layer(HouseholdApi).pipe(
    Layer.provide(HouseholdHandlers),
    Layer.provide(HouseholdSessionAuthLive)
  );

/** Mount the authenticated household-owned meal-plan API. */
export const makeHouseholdMealPlanHttpApiLayer = () =>
  HttpApiBuilder.layer(HouseholdMealPlanApi).pipe(
    Layer.provide(HouseholdMealPlanHandlers),
    Layer.provide(HouseholdSessionAuthLive),
    Layer.provide(HouseholdMealPlanSchemaErrorsLive)
  );
