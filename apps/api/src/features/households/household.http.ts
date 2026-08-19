import {
  HouseholdApi,
  HouseholdCurrentPrincipal,
  HouseholdSessionAuth,
} from "@meal-planner/household-api";
import { Effect, Layer } from "effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { AuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import { HouseholdDomainGateway } from "./household.gateway.js";

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
          return yield* httpEffect.pipe(
            Effect.provideService(HouseholdCurrentPrincipal, {
              organizationId: principal.organizationId,
            })
          );
        })
      )
    )
  )
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
