import {
  FamilyApi,
  FamilyConflict,
  FamilyForbidden,
  FamilyInvalidInput,
  FamilyNotFound,
  FamilyRateLimited,
  FamilySchemaErrors,
  FamilyUnauthorized,
  FamilyUnavailable,
} from "@meal-planner/families";
import {
  FamilyFailure,
  FamilyService,
} from "@meal-planner/families/application";
import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/http-api";

import { JsonHttpPlatformServices } from "../../infrastructure/json-http-platform.js";
import { authorizeApplicationRequest } from "../auth/http.js";
import type { MealPlannerAuthService } from "../auth/index.js";

const conflictMessages = {
  creation_incomplete: "The creator needs to finish creating this family.",
  mutation_collision: "This request ID was already used for different details.",
  stale_version: "The family changed. Reload before editing.",
} as const;
const accessReason = (status: number): FamilyFailure["reason"] => {
  switch (status) {
    case 401: {
      return "unauthorized";
    }
    case 403: {
      return "forbidden";
    }
    case 429: {
      return "rate_limited";
    }
    default: {
      return "unavailable";
    }
  }
};
const problem = (error: FamilyFailure) => {
  switch (error.reason) {
    case "unauthorized": {
      return FamilyUnauthorized.make({ message: "Sign in to continue." });
    }
    case "forbidden": {
      return FamilyForbidden.make({
        message: "You cannot change this family.",
      });
    }
    case "not_found": {
      return FamilyNotFound.make({
        message: "This family is not available to your account.",
      });
    }
    case "rate_limited": {
      return FamilyRateLimited.make({
        message: "Too many requests. Wait a moment and try again.",
      });
    }
    case "stale_version":
    case "mutation_collision":
    case "creation_incomplete": {
      return FamilyConflict.make({
        message: conflictMessages[error.reason],
        reason: error.reason,
      });
    }
    case "unavailable": {
      return FamilyUnavailable.make({
        message: "The result could not be confirmed. Retry the same request.",
      });
    }
    default: {
      const unreachable: never = error.reason;
      throw new Error("Unexpected family failure", { cause: unreachable });
    }
  }
};

/** HTTP supplies the actor; application operations never accept model-selected users. */
export const familyHttpApiLayer = (auth: MealPlannerAuthService) => {
  const actor = authorizeApplicationRequest(auth).pipe(
    Effect.mapError(
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect error mapping returns a typed value rather than a Promise.
      (error) =>
        new FamilyFailure({
          reason: accessReason(error.statusCode),
        })
    )
  );
  const group = HttpApiBuilder.group(FamilyApi, "families", (handlers) =>
    handlers
      .handle("list", () =>
        Effect.gen(function* listFamiliesRequest() {
          const service = yield* FamilyService;
          return yield* service.list(yield* actor);
        }).pipe(Effect.mapError(problem))
      )
      .handle("get", ({ params }) =>
        Effect.gen(function* getFamilyRequest() {
          const service = yield* FamilyService;
          return yield* service.get(yield* actor, params.familyId);
        }).pipe(Effect.mapError(problem))
      )
      .handle("create", ({ payload }) =>
        Effect.gen(function* createFamilyRequest() {
          const service = yield* FamilyService;
          return yield* service.create(yield* actor, payload);
        }).pipe(Effect.mapError(problem))
      )
      .handle("resumeCreation", ({ params }) =>
        Effect.gen(function* resumeFamilyCreationRequest() {
          const service = yield* FamilyService;
          return yield* service.resumeCreation(yield* actor, params.familyId);
        }).pipe(Effect.mapError(problem))
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* updateFamilyRequest() {
          const service = yield* FamilyService;
          return yield* service.update(yield* actor, params.familyId, payload);
        }).pipe(Effect.mapError(problem))
      )
      .handle("complete", ({ params }) =>
        Effect.gen(function* completeFamilySetupRequest() {
          const service = yield* FamilyService;
          return yield* service.complete(yield* actor, params.familyId);
        }).pipe(Effect.mapError(problem))
      )
  );
  const schemaErrors = HttpApiMiddleware.layerSchemaErrorTransform(
    FamilySchemaErrors,
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect middleware requires an Effect-valued callback.
    (error) =>
      error.kind === "Body" || error.kind === "ResponseHeaders"
        ? Effect.die(error)
        : Effect.fail(
            FamilyInvalidInput.make({
              message: "Check the family details and try again.",
            })
          )
  );
  return HttpApiBuilder.layer(FamilyApi).pipe(
    Layer.provide(group),
    Layer.provide(schemaErrors),
    Layer.provide(JsonHttpPlatformServices)
  );
};
