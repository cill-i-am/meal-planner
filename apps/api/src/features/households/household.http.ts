import type {
  HouseholdPeopleFailure,
  MealPlan,
} from "@meal-planner/household-api";
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
  HouseholdPeopleCurrentPrincipal,
  HouseholdPeopleApi,
  HouseholdPeopleBootstrapConflictProblem,
  HouseholdPeopleLifecycleConflictProblem,
  HouseholdPeopleInvalidRequestProblem,
  HouseholdPeopleMutationCollisionProblem,
  HouseholdPeopleNotFoundProblem,
  HouseholdPeoplePrincipal,
  HouseholdPeopleSchemaErrors,
  HouseholdPeopleStaleVersionProblem,
  HouseholdPeopleUnavailableProblem,
  HouseholdSessionAuth,
  toHouseholdMealPlanResponse,
} from "@meal-planner/household-api";
import { Effect, Layer, Schema } from "effect";
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
  HouseholdPeopleGateway,
} from "./household.gateway.js";
import { HouseholdDigest } from "./shared-kernel/authority-services.js";
import { HouseholdAuthorityServicesLive } from "./shared-kernel/authority-services.live.js";

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

const invalidPeopleRequestProblem = Schema.decodeUnknownSync(
  HouseholdPeopleInvalidRequestProblem
)({
  code: "invalid_request",
  message: "The household people request is invalid.",
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

const peopleNotFoundProblem = Schema.decodeUnknownSync(
  HouseholdPeopleNotFoundProblem
)({ code: "person_not_found", message: "Person not found.", status: 404 });
const peopleMutationCollisionProblem = Schema.decodeUnknownSync(
  HouseholdPeopleMutationCollisionProblem
)({
  code: "mutation_collision",
  message: "That retry identifier was already used for a different change.",
  status: 409,
});
const peopleBootstrapConflictProblem = Schema.decodeUnknownSync(
  HouseholdPeopleBootstrapConflictProblem
)({
  code: "bootstrap_conflict",
  message: "This account is already linked to a household person.",
  status: 409,
});
const peopleStaleVersionProblem = Schema.decodeUnknownSync(
  HouseholdPeopleStaleVersionProblem
)({
  code: "stale_version",
  message: "This person changed. Refresh the roster and try again.",
  status: 409,
});
const peopleLifecycleConflictProblem = Schema.decodeUnknownSync(
  HouseholdPeopleLifecycleConflictProblem
)({
  code: "lifecycle_conflict",
  message: "This lifecycle change is no longer valid.",
  status: 409,
});
const peopleUnavailableProblem = Schema.decodeUnknownSync(
  HouseholdPeopleUnavailableProblem
)({
  code: "people_unavailable",
  message: "The household roster is temporarily unavailable.",
  status: 503,
});

const mapPeopleBootstrapError = (error: HouseholdPeopleFailure) => {
  if (error._tag === "HouseholdCreatorBootstrapConflict") {
    return peopleBootstrapConflictProblem;
  }
  return error._tag === "HouseholdPersonMutationCollision"
    ? peopleMutationCollisionProblem
    : peopleUnavailableProblem;
};
const mapPeopleCreateError = (error: HouseholdPeopleFailure) =>
  error._tag === "HouseholdPersonMutationCollision"
    ? peopleMutationCollisionProblem
    : peopleUnavailableProblem;
const mapPeopleGetError = (error: HouseholdPeopleFailure) =>
  error._tag === "HouseholdPersonNotFound"
    ? peopleNotFoundProblem
    : peopleUnavailableProblem;
const mapPeopleTransitionError = (error: HouseholdPeopleFailure) => {
  switch (error._tag) {
    case "HouseholdPersonLifecycleConflict": {
      return peopleLifecycleConflictProblem;
    }
    case "HouseholdPersonMutationCollision": {
      return peopleMutationCollisionProblem;
    }
    case "HouseholdPersonNotFound": {
      return peopleNotFoundProblem;
    }
    case "HouseholdPersonStaleVersion": {
      return peopleStaleVersionProblem;
    }
    default: {
      return peopleUnavailableProblem;
    }
  }
};

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
  Effect.gen(function* makeHouseholdSessionAuth() {
    const resolver = yield* AuthenticatedOrganizationResolver;
    const digest = yield* HouseholdDigest;
    return HouseholdSessionAuth.of((httpEffect) =>
      Effect.gen(function* resolveHouseholdSession() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const principal = yield* resolver
          .resolve(new globalThis.Headers(Object.entries(request.headers)))
          .pipe(Effect.mapError(() => unauthorizedProblem));
        const actorId = yield* digest
          .sha256(principal.userId)
          .pipe(Effect.mapError(() => unauthorizedProblem));
        const mealPlanPrincipal = yield* Schema.decodeUnknownEffect(
          HouseholdMealPlanPrincipal
        )({
          actorId,
          organizationId: principal.organizationId,
        }).pipe(Effect.mapError(() => unauthorizedProblem));
        const peoplePrincipal = yield* Schema.decodeUnknownEffect(
          HouseholdPeoplePrincipal
        )({
          actorId,
          organizationId: principal.organizationId,
        }).pipe(Effect.mapError(() => unauthorizedProblem));
        return yield* httpEffect.pipe(
          Effect.provideService(HouseholdCurrentPrincipal, {
            organizationId: principal.organizationId,
          }),
          Effect.provideService(
            HouseholdMealPlanCurrentPrincipal,
            mealPlanPrincipal
          ),
          Effect.provideService(
            HouseholdPeopleCurrentPrincipal,
            peoplePrincipal
          )
        );
      })
    );
  })
).pipe(Layer.provide(HouseholdAuthorityServicesLive));

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
          return yield* exposeMealPlanResult(
            gateway.swap({
              draftId: params.draftId,
              payload,
              principal,
            }),
            mapSwapMealPlanError
          );
        })
      )
      .handle("approve", ({ params, payload }) =>
        Effect.gen(function* approveMealPlan() {
          const principal = yield* HouseholdMealPlanCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          return yield* exposeMealPlanResult(
            gateway.approve({
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
          return yield* exposeMealPlanResult(
            gateway.reject({
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

const transformPeopleSchemaError = (error: HttpApiSchemaError) =>
  error.kind === "Body" || error.kind === "ResponseHeaders"
    ? Effect.logError("household.people.response_schema_error").pipe(
        Effect.andThen(
          HttpServerResponse.json(peopleUnavailableProblem, {
            headers: { "content-type": "application/problem+json" },
            status: 503,
          }).pipe(Effect.orDie)
        )
      )
    : Effect.fail(invalidPeopleRequestProblem);

const HouseholdPeopleSchemaErrorsLive =
  HttpApiMiddleware.layerSchemaErrorTransform(
    HouseholdPeopleSchemaErrors,
    transformPeopleSchemaError
  );

const HouseholdHandlers = HttpApiBuilder.group(
  HouseholdApi,
  "households",
  (handlers) =>
    handlers.handle("current", () =>
      Effect.gen(function* currentHousehold() {
        yield* HouseholdCurrentPrincipal;
        const principal = yield* HouseholdMealPlanCurrentPrincipal;
        const gateway = yield* HouseholdDomainGateway;
        return yield* gateway.ensure(principal).pipe(
          Effect.tapError(() =>
            Effect.logError("household.domain.ensure_failed")
          ),
          Effect.mapError(() => internalProblem)
        );
      })
    )
);

const HouseholdPeopleHandlers = HttpApiBuilder.group(
  HouseholdPeopleApi,
  "people",
  (handlers) =>
    handlers
      .handle("bootstrapCreator", ({ payload }) =>
        Effect.gen(function* bootstrapCreatorPerson() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .bootstrapCreator({ payload, principal })
            .pipe(Effect.mapError(mapPeopleBootstrapError));
        })
      )
      .handle("list", ({ query }) =>
        Effect.gen(function* listPeople() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .list({
              includeArchived: query.includeArchived === "true",
              principal,
            })
            .pipe(Effect.mapError(() => peopleUnavailableProblem));
        })
      )
      .handle("get", ({ params }) =>
        Effect.gen(function* getPerson() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .get({ personId: params.personId, principal })
            .pipe(Effect.mapError(mapPeopleGetError));
        })
      )
      .handle("create", ({ payload }) =>
        Effect.gen(function* createPerson() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .create({ payload, principal })
            .pipe(Effect.mapError(mapPeopleCreateError));
        })
      )
      .handle("archive", ({ params, payload }) =>
        Effect.gen(function* archivePerson() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .archive({ payload, personId: params.personId, principal })
            .pipe(Effect.mapError(mapPeopleTransitionError));
        })
      )
      .handle("restore", ({ params, payload }) =>
        Effect.gen(function* restorePerson() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .restore({ payload, personId: params.personId, principal })
            .pipe(Effect.mapError(mapPeopleTransitionError));
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

/** Mount the authenticated household people API. */
export const makeHouseholdPeopleHttpApiLayer = () =>
  HttpApiBuilder.layer(HouseholdPeopleApi).pipe(
    Layer.provide(HouseholdPeopleHandlers),
    Layer.provide(HouseholdSessionAuthLive),
    Layer.provide(HouseholdPeopleSchemaErrorsLive)
  );
