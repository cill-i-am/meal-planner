import type {
  HouseholdPeopleFailure,
  MealPlan,
  HouseholdMealPlanConflictReason,
} from "@meal-planner/household-api";
import {
  HouseholdApi,
  AuthenticatedHouseholdPlanningContentApi,
  HouseholdCurrentPrincipal,
  HouseholdMealPlanApi,
  HouseholdMealPlanConflictProblem,
  HouseholdMealPlanCurrentPrincipal,
  HouseholdMealPlanInternalProblem,
  HouseholdMealPlanInvalidRequestProblem,
  HouseholdMealPlanNotFoundProblem,
  HouseholdMealPlanPrincipal,
  HouseholdMealPlanSchemaErrors,
  HouseholdPlanningContentConflictProblem,
  HouseholdPlanningContentUnavailableProblem,
  HouseholdPeopleCurrentPrincipal,
  HouseholdPeopleApi,
  HouseholdPeopleAssociationConflictProblem,
  HouseholdPeopleAssociationStaleProblem,
  HouseholdPeopleBootstrapConflictProblem,
  HouseholdPeopleControlPlaneNotFoundProblem,
  HouseholdPeopleControlPlaneUnavailableProblem,
  HouseholdInvitationRejectedProblem,
  HouseholdPeopleCreatorRequiredProblem,
  HouseholdPeopleDepartureConflictProblem,
  HouseholdPeopleLifecycleConflictProblem,
  HouseholdPeopleInvalidRequestProblem,
  HouseholdPeopleMutationCollisionProblem,
  HouseholdPeopleNotFoundProblem,
  HouseholdPeopleOrganizerRequiredProblem,
  HouseholdPeoplePrincipal,
  HouseholdOrganizationId,
  HouseholdPeopleSchemaErrors,
  HouseholdPeopleStaleVersionProblem,
  HouseholdPeopleUnavailableProblem,
  HouseholdSessionAuth,
  toHouseholdMealPlanResponse,
} from "@meal-planner/household-api";
import { Effect, Layer, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/http-api";
import type { HttpApiSchemaError } from "effect/http-api/HttpApiError";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import { AuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import type {
  HouseholdPeopleGatewayFailure,
  HouseholdMealPlanFailure,
} from "./household.gateway.js";
import {
  HouseholdDomainGateway,
  HouseholdMealPlanGateway,
  HouseholdPlanningContentGateway,
  HouseholdPeopleGateway,
} from "./household.gateway.js";
import {
  deriveHouseholdPeopleAuditActorId,
  deriveHouseholdPersonLinkageSubject,
} from "./people/household-people.identity.js";
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

const mealPlanConflictProblem = (
  reason: typeof HouseholdMealPlanConflictReason.Type
) =>
  Schema.decodeUnknownSync(HouseholdMealPlanConflictProblem)({
    code: "meal_plan_conflict",
    message: "The meal plan needs review before this change can be saved.",
    reason,
    status: 409,
  });

const mealPlanInternalProblem = Schema.decodeUnknownSync(
  HouseholdMealPlanInternalProblem
)({
  code: "internal_error",
  message: "Household storage is temporarily unavailable.",
  status: 500,
});

const planningContentConflictProblem = Schema.decodeUnknownSync(
  HouseholdPlanningContentConflictProblem
)({
  code: "planning_content_conflict",
  message: "Planning content changed or conflicts with an earlier request.",
  status: 409,
});
const planningContentUnavailableProblem = Schema.decodeUnknownSync(
  HouseholdPlanningContentUnavailableProblem
)({
  code: "planning_content_unavailable",
  message: "Planning content is temporarily unavailable.",
  status: 503,
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
  message:
    "This household already has a creator person. This account remains unlinked.",
  status: 409,
});
const peopleCreatorRequiredProblem = Schema.decodeUnknownSync(
  HouseholdPeopleCreatorRequiredProblem
)({
  code: "creator_required",
  message:
    "Only the Better Auth household owner can set up the creator person.",
  status: 403,
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
const peopleOrganizerRequiredProblem = Schema.decodeUnknownSync(
  HouseholdPeopleOrganizerRequiredProblem
)({
  code: "organizer_required",
  message: "Only a current household owner may coordinate this change.",
  status: 403,
});
const peopleControlPlaneNotFoundProblem = Schema.decodeUnknownSync(
  HouseholdPeopleControlPlaneNotFoundProblem
)({
  code: "control_plane_resource_not_found",
  message: "That invitation or household member is no longer available.",
  status: 404,
});
const peopleAssociationConflictProblem = Schema.decodeUnknownSync(
  HouseholdPeopleAssociationConflictProblem
)({
  code: "association_conflict",
  message:
    "That account, invitation, or person association conflicts with current household state.",
  status: 409,
});
const peopleDepartureConflictProblem = Schema.decodeUnknownSync(
  HouseholdPeopleDepartureConflictProblem
)({
  code: "departure_conflict",
  message: "That departure conflicts with the current member or person state.",
  status: 409,
});
const peopleAssociationStaleProblem = Schema.decodeUnknownSync(
  HouseholdPeopleAssociationStaleProblem
)({
  code: "association_stale",
  message: "That account link or departure changed. Refresh and try again.",
  status: 409,
});
const peopleUnavailableProblem = Schema.decodeUnknownSync(
  HouseholdPeopleUnavailableProblem
)({
  code: "people_unavailable",
  message: "The household roster is temporarily unavailable.",
  status: 503,
});
const peopleControlPlaneUnavailableProblem = Schema.decodeUnknownSync(
  HouseholdPeopleControlPlaneUnavailableProblem
)({
  code: "control_plane_unavailable",
  message: "Household membership is temporarily unavailable.",
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

const mapInviteAdultError = (error: HouseholdPeopleGatewayFailure) => {
  switch (error._tag) {
    case "HouseholdInvitationRejected": {
      return Schema.decodeUnknownSync(HouseholdInvitationRejectedProblem)({
        code: "invitation_rejected",
        message: "This invitation could not be created.",
        reason: error.reason,
        status: 409,
      });
    }
    case "HouseholdPersonAssociationConflict": {
      return peopleAssociationConflictProblem;
    }
    case "HouseholdPeopleControlPlaneUnavailable": {
      return peopleControlPlaneUnavailableProblem;
    }
    case "HouseholdPersonMutationCollision": {
      return peopleMutationCollisionProblem;
    }
    case "HouseholdPersonNotFound": {
      return peopleNotFoundProblem;
    }
    case "HouseholdPeopleOrganizerRequired": {
      return peopleOrganizerRequiredProblem;
    }
    default: {
      return peopleUnavailableProblem;
    }
  }
};

const mapAssociateInvitationError = (error: HouseholdPeopleGatewayFailure) => {
  switch (error._tag) {
    case "HouseholdPersonAssociationConflict": {
      return peopleAssociationConflictProblem;
    }
    case "HouseholdPeopleControlPlaneNotFound": {
      return peopleControlPlaneNotFoundProblem;
    }
    case "HouseholdPersonMutationCollision": {
      return peopleMutationCollisionProblem;
    }
    case "HouseholdPersonNotFound": {
      return peopleNotFoundProblem;
    }
    case "HouseholdPeopleOrganizerRequired": {
      return peopleOrganizerRequiredProblem;
    }
    default: {
      return peopleUnavailableProblem;
    }
  }
};

const mapCompleteAdultLinkError = (error: HouseholdPeopleGatewayFailure) => {
  switch (error._tag) {
    case "HouseholdPersonAssociationConflict": {
      return peopleAssociationConflictProblem;
    }
    case "HouseholdPeopleControlPlaneNotFound": {
      return peopleControlPlaneNotFoundProblem;
    }
    case "HouseholdPersonMutationCollision": {
      return peopleMutationCollisionProblem;
    }
    default: {
      return peopleUnavailableProblem;
    }
  }
};

const mapRepairAdultLinkError = (error: HouseholdPeopleGatewayFailure) => {
  switch (error._tag) {
    case "HouseholdPersonAssociationConflict": {
      return peopleAssociationConflictProblem;
    }
    case "HouseholdPeopleControlPlaneNotFound": {
      return peopleControlPlaneNotFoundProblem;
    }
    case "HouseholdPersonMutationCollision": {
      return peopleMutationCollisionProblem;
    }
    case "HouseholdPersonNotFound": {
      return peopleNotFoundProblem;
    }
    case "HouseholdPeopleOrganizerRequired": {
      return peopleOrganizerRequiredProblem;
    }
    case "HouseholdPersonStaleVersion": {
      return peopleStaleVersionProblem;
    }
    default: {
      return peopleUnavailableProblem;
    }
  }
};

const mapDepartAdultError = (error: HouseholdPeopleGatewayFailure) => {
  switch (error._tag) {
    case "HouseholdAssociationStaleVersion": {
      return peopleAssociationStaleProblem;
    }
    case "HouseholdPeopleControlPlaneNotFound": {
      return peopleControlPlaneNotFoundProblem;
    }
    case "HouseholdPeopleControlPlaneUnavailable": {
      return peopleControlPlaneUnavailableProblem;
    }
    case "HouseholdMemberDepartureConflict":
    case "HouseholdMemberDepartureInProgress": {
      return peopleDepartureConflictProblem;
    }
    case "HouseholdPersonMutationCollision": {
      return peopleMutationCollisionProblem;
    }
    case "HouseholdPersonNotFound": {
      return peopleNotFoundProblem;
    }
    case "HouseholdPeopleOrganizerRequired": {
      return peopleOrganizerRequiredProblem;
    }
    case "HouseholdPersonStaleVersion": {
      return peopleStaleVersionProblem;
    }
    default: {
      return peopleUnavailableProblem;
    }
  }
};

const mapGetDepartureError = (error: HouseholdPeopleGatewayFailure) =>
  error._tag === "HouseholdPersonNotFound"
    ? peopleNotFoundProblem
    : peopleUnavailableProblem;

const mapCancelDepartureError = (error: HouseholdPeopleGatewayFailure) => {
  switch (error._tag) {
    case "HouseholdMemberDepartureConflict":
    case "HouseholdMemberDepartureInProgress": {
      return peopleDepartureConflictProblem;
    }
    case "HouseholdPersonMutationCollision": {
      return peopleMutationCollisionProblem;
    }
    case "HouseholdPersonNotFound": {
      return peopleNotFoundProblem;
    }
    default: {
      return peopleUnavailableProblem;
    }
  }
};

const mapRetryDepartureError = (error: HouseholdPeopleGatewayFailure) => {
  switch (error._tag) {
    case "HouseholdAssociationStaleVersion": {
      return peopleAssociationStaleProblem;
    }
    case "HouseholdPeopleControlPlaneNotFound": {
      return peopleControlPlaneNotFoundProblem;
    }
    case "HouseholdPeopleControlPlaneUnavailable": {
      return peopleControlPlaneUnavailableProblem;
    }
    case "HouseholdMemberDepartureConflict":
    case "HouseholdMemberDepartureInProgress": {
      return peopleDepartureConflictProblem;
    }
    case "HouseholdPersonMutationCollision": {
      return peopleMutationCollisionProblem;
    }
    case "HouseholdPersonNotFound": {
      return peopleNotFoundProblem;
    }
    case "HouseholdPeopleOrganizerRequired": {
      return peopleOrganizerRequiredProblem;
    }
    default: {
      return peopleUnavailableProblem;
    }
  }
};

const mapReturnAdultError = (error: HouseholdPeopleGatewayFailure) => {
  switch (error._tag) {
    case "HouseholdPersonAssociationConflict": {
      return peopleAssociationConflictProblem;
    }
    case "HouseholdPeopleControlPlaneNotFound": {
      return peopleControlPlaneNotFoundProblem;
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

const mapMealPlanError = (error: HouseholdMealPlanFailure) => {
  switch (error._tag) {
    case "MealPlanNotFound": {
      return mealPlanNotFoundProblem;
    }
    case "MealPlanPersistenceFailure": {
      return mealPlanInternalProblem;
    }
    case "MealPlanRuleViolation": {
      return mealPlanConflictProblem(error.reason);
    }
    case "MealPlanMutationConflict": {
      return mealPlanConflictProblem("mutation_conflict");
    }
    case "MealPlanRequestConflict": {
      return mealPlanConflictProblem("request_conflict");
    }
    case "MealPlanTransitionRejected": {
      return mealPlanConflictProblem("invalid_transition");
    }
    case "MealPlanVersionConflict": {
      return mealPlanConflictProblem("version_conflict");
    }
    default: {
      return error satisfies never;
    }
  }
};

const mapPlanningContentError = (error: { readonly reason: string }) =>
  error.reason === "unavailable" || error.reason === "missing_person"
    ? planningContentUnavailableProblem
    : planningContentConflictProblem;

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
        const { pathname } = new URL(request.url, "http://request.local");
        const pathFamily =
          /^\/v1\/families\/(?<familyId>[^/]+)\/people(?:\/|$)/u.exec(
            pathname
          )?.[1];
        const familyId =
          pathFamily === undefined
            ? undefined
            : yield* Effect.try({
                catch: () => unauthorizedProblem,
                try: () => decodeURIComponent(pathFamily),
              }).pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(HouseholdOrganizationId)
                ),
                Effect.mapError(() => unauthorizedProblem)
              );
        const principal = yield* resolver
          .resolve(
            new globalThis.Headers(Object.entries(request.headers)),
            familyId
          )
          .pipe(Effect.mapError(() => unauthorizedProblem));
        const actorId = yield* digest
          .sha256(principal.userId)
          .pipe(Effect.mapError(() => unauthorizedProblem));
        const peopleActorId = yield* deriveHouseholdPeopleAuditActorId(
          principal.organizationId,
          principal.userId
        ).pipe(Effect.mapError(() => unauthorizedProblem));
        const linkageSubject = yield* deriveHouseholdPersonLinkageSubject(
          principal.organizationId,
          principal.userId
        ).pipe(Effect.mapError(() => unauthorizedProblem));
        const mealPlanPrincipal = yield* Schema.decodeUnknownEffect(
          HouseholdMealPlanPrincipal
        )({
          actorId,
          organizationId: principal.organizationId,
        }).pipe(Effect.mapError(() => unauthorizedProblem));
        const peoplePrincipal = yield* Schema.decodeUnknownEffect(
          HouseholdPeoplePrincipal
        )({
          actorId: peopleActorId,
          creatorAuthority:
            principal.membershipRole === "owner" ? "better_auth_owner" : null,
          linkageSubject,
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
);

const HouseholdMealPlanHandlers = HttpApiBuilder.group(
  HouseholdMealPlanApi,
  "mealPlans",
  (handlers) =>
    handlers
      .handle("create", ({ payload }) =>
        Effect.gen(function* createMealPlan() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          return yield* exposeMealPlanResult(
            gateway.create({ payload, principal }),
            mapMealPlanError
          );
        })
      )
      .handle("list", () =>
        Effect.gen(function* listMealPlans() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          return yield* gateway
            .list({ principal })
            .pipe(Effect.mapError(() => mealPlanInternalProblem));
        })
      )
      .handle("read", ({ params }) =>
        Effect.gen(function* readMealPlan() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          return yield* exposeMealPlanResult(
            gateway.read({ planId: params.planId, principal }),
            (error) =>
              error._tag === "MealPlanNotFound"
                ? mealPlanNotFoundProblem
                : mealPlanInternalProblem
          );
        })
      )
      .handle("change", ({ params, payload }) =>
        Effect.gen(function* changeMealPlan() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          return yield* exposeMealPlanResult(
            gateway.change({ payload, planId: params.planId, principal }),
            mapMealPlanError
          );
        })
      )
      .handle("approve", ({ params, payload }) =>
        Effect.gen(function* approveMealPlan() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          return yield* exposeMealPlanResult(
            gateway.approve({ payload, planId: params.planId, principal }),
            mapMealPlanError
          );
        })
      )
      .handle("proposeRevision", ({ params, payload }) =>
        Effect.gen(function* proposeRevision() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          return yield* exposeMealPlanResult(
            gateway.proposeRevision({
              payload,
              planId: params.planId,
              principal,
            }),
            mapMealPlanError
          );
        })
      )
      .handle("acceptRevision", ({ params, payload }) =>
        Effect.gen(function* acceptRevision() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          return yield* exposeMealPlanResult(
            gateway.acceptRevision({
              payload,
              planId: params.planId,
              principal,
            }),
            mapMealPlanError
          );
        })
      )
      .handle("rejectRevision", ({ params, payload }) =>
        Effect.gen(function* rejectRevision() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdMealPlanGateway;
          return yield* exposeMealPlanResult(
            gateway.rejectRevision({
              payload,
              planId: params.planId,
              principal,
            }),
            mapMealPlanError
          );
        })
      )
);

const HouseholdPlanningContentHandlers = HttpApiBuilder.group(
  AuthenticatedHouseholdPlanningContentApi,
  "planningContent",
  (handlers) =>
    handlers
      .handle("read", () =>
        Effect.gen(function* readPlanningContent() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPlanningContentGateway;
          return yield* gateway
            .read(principal)
            .pipe(Effect.mapError(() => planningContentUnavailableProblem));
        })
      )
      .handle("mutate", ({ payload }) =>
        Effect.gen(function* mutatePlanningContent() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPlanningContentGateway;
          return yield* gateway
            .mutate({ payload, principal })
            .pipe(Effect.mapError(mapPlanningContentError));
        })
      )
      .handle("listSavedRecipes", ({ query }) =>
        Effect.gen(function* listSavedRecipes() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPlanningContentGateway;
          return yield* gateway
            .listSavedRecipes({ principal, query })
            .pipe(Effect.mapError(() => planningContentUnavailableProblem));
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
      .handle("getProfileVersion", ({ params }) =>
        Effect.gen(function* getProfileVersion() {
          const gateway = yield* HouseholdPeopleGateway;
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          return yield* gateway
            .getProfile({
              personId: params.personId,
              principal,
              version: params.version,
            })
            .pipe(
              Effect.mapError((error) => ({
                code: error.reason,
                message: "The profile request could not be completed.",
              }))
            );
        })
      )
      .handle("listProfileAudit", ({ params, query }) =>
        Effect.gen(function* listProfileAudit() {
          const gateway = yield* HouseholdPeopleGateway;
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const page = yield* gateway
            .listProfileVersions({
              beforeVersion: query.beforeVersion ?? null,
              personId: params.personId,
              principal,
            })
            .pipe(
              Effect.mapError((error) => ({
                code: error.reason,
                message: "The profile request could not be completed.",
              }))
            );
          return {
            events: page.versions.flatMap((version) =>
              version.audit === null ? [] : [version.audit]
            ),
            nextBeforeVersion: page.nextBeforeVersion,
          };
        })
      )
      .handle("getProfile", ({ params }) =>
        Effect.gen(function* getProfile() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .getProfile({ personId: params.personId, principal })
            .pipe(
              Effect.mapError((error) => ({
                code: error.reason,
                message: "The profile request could not be completed.",
              }))
            );
        })
      )
      .handle("listProfileVersions", ({ params, query }) =>
        Effect.gen(function* listProfileVersions() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .listProfileVersions({
              beforeVersion: query.beforeVersion ?? null,
              personId: params.personId,
              principal,
            })
            .pipe(
              Effect.mapError((error) => ({
                code: error.reason,
                message: "The profile request could not be completed.",
              }))
            );
        })
      )
      .handle("mutateProfile", ({ params, payload }) =>
        Effect.gen(function* mutateProfile() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .mutateProfile({ payload, personId: params.personId, principal })
            .pipe(
              Effect.mapError((error) => ({
                code: error.reason,
                message: "The profile request could not be completed.",
              }))
            );
        })
      )
      .handle("bootstrapCreator", ({ payload }) =>
        Effect.gen(function* bootstrapCreatorPerson() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          if (principal.creatorAuthority === null) {
            return yield* Effect.fail(peopleCreatorRequiredProblem);
          }
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
      .handle("rename", ({ params, payload }) =>
        Effect.gen(function* renamePerson() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .rename({ payload, personId: params.personId, principal })
            .pipe(Effect.mapError(mapPeopleTransitionError));
        })
      )
      .handle("remove", ({ params, payload }) =>
        Effect.gen(function* removePerson() {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .remove({
              headers: new globalThis.Headers(Object.entries(request.headers)),
              payload,
              personId: params.personId,
              principal,
            })
            .pipe(
              Effect.mapError((error) => {
                if (error._tag === "HouseholdPersonAssociationConflict") {
                  return peopleAssociationConflictProblem;
                }
                if (error._tag === "HouseholdPersonLifecycleConflict") {
                  return peopleLifecycleConflictProblem;
                }
                return mapDepartAdultError(error);
              })
            );
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
      .handle("inviteAdult", ({ payload }) =>
        Effect.gen(function* inviteAdult() {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .inviteAdult({
              headers: new globalThis.Headers(Object.entries(request.headers)),
              payload,
              principal,
            })
            .pipe(Effect.mapError(mapInviteAdultError));
        })
      )
      .handle("associateInvitation", ({ payload }) =>
        Effect.gen(function* associateAdultInvitation() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .associateInvitation({ payload, principal })
            .pipe(Effect.mapError(mapAssociateInvitationError));
        })
      )
      .handle("completeAdultLink", ({ payload }) =>
        Effect.gen(function* completeAdultLink() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .completeAdultLink({ payload, principal })
            .pipe(Effect.mapError(mapCompleteAdultLinkError));
        })
      )
      .handle("repairAdultLink", ({ payload }) =>
        Effect.gen(function* repairAdultLink() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .repairAdultLink({ payload, principal })
            .pipe(Effect.mapError(mapRepairAdultLinkError));
        })
      )
      .handle("departAdult", ({ payload }) =>
        Effect.gen(function* departAdult() {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .departAdult({
              headers: new globalThis.Headers(Object.entries(request.headers)),
              payload,
              principal,
            })
            .pipe(Effect.mapError(mapDepartAdultError));
        })
      )
      .handle("getDeparture", ({ params }) =>
        Effect.gen(function* getDeparture() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .getDeparture({ operationId: params.operationId, principal })
            .pipe(Effect.mapError(mapGetDepartureError));
        })
      )
      .handle("getDepartureByMutation", ({ params }) =>
        Effect.gen(function* getDepartureByMutation() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .getDepartureByMutation({
              mutationId: params.mutationId,
              principal,
            })
            .pipe(Effect.mapError(mapGetDepartureError));
        })
      )
      .handle("cancelDeparture", ({ params, payload }) =>
        Effect.gen(function* cancelDeparture() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .cancelDeparture({
              operationId: params.operationId,
              payload,
              principal,
            })
            .pipe(Effect.mapError(mapCancelDepartureError));
        })
      )
      .handle("retryDeparture", ({ params, payload }) =>
        Effect.gen(function* retryDeparture() {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .retryDeparture({
              headers: new globalThis.Headers(Object.entries(request.headers)),
              operationId: params.operationId,
              payload,
              principal,
            })
            .pipe(Effect.mapError(mapRetryDepartureError));
        })
      )
      .handle("returnAdult", ({ payload }) =>
        Effect.gen(function* returnAdult() {
          const principal = yield* HouseholdPeopleCurrentPrincipal;
          const gateway = yield* HouseholdPeopleGateway;
          return yield* gateway
            .returnAdult({ payload, principal })
            .pipe(Effect.mapError(mapReturnAdultError));
        })
      )
);

/** Mount the authenticated household tracer API. */
export const HouseholdHttpApiLayer = HttpApiBuilder.layer(HouseholdApi).pipe(
  Layer.provide(HouseholdHandlers),
  Layer.provide(HouseholdSessionAuthLive),
  Layer.provide(HouseholdAuthorityServicesLive)
);

/** Mount the authenticated household-owned meal-plan API. */
export const HouseholdMealPlanHttpApiLayer = HttpApiBuilder.layer(
  HouseholdMealPlanApi
).pipe(
  Layer.provide(HouseholdMealPlanHandlers),
  Layer.provide(HouseholdSessionAuthLive),
  Layer.provide(HouseholdMealPlanSchemaErrorsLive),
  Layer.provide(HouseholdAuthorityServicesLive)
);

/** Mount the authenticated household planning content API. */
export const HouseholdPlanningContentHttpApiLayer = HttpApiBuilder.layer(
  AuthenticatedHouseholdPlanningContentApi
).pipe(
  Layer.provide(HouseholdPlanningContentHandlers),
  Layer.provide(HouseholdSessionAuthLive),
  Layer.provide(HouseholdAuthorityServicesLive)
);

/** Mount the authenticated household people API. */
export const HouseholdPeopleHttpApiLayer = HttpApiBuilder.layer(
  HouseholdPeopleApi
).pipe(
  Layer.provide(HouseholdPeopleHandlers),
  Layer.provide(HouseholdSessionAuthLive),
  Layer.provide(HouseholdPeopleSchemaErrorsLive),
  Layer.provide(HouseholdAuthorityServicesLive)
);
