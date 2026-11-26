import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";

import { JsonHttpPlatformServices } from "../../infrastructure/json-http-platform.js";
import type { AuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import { AuthenticatedOrganizationResolver as AuthenticatedOrganizationResolverService } from "../auth/auth.principal.js";
import type {
  HouseholdDomainFailure,
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdInvalidInput } from "./household.contract.js";
import type {
  HouseholdDomainGateway,
  HouseholdMealPlanGateway,
  HouseholdPlanningContentGateway,
  HouseholdPeopleGateway,
} from "./household.gateway.js";
import {
  HouseholdDomainGateway as HouseholdDomainGatewayService,
  HouseholdMealPlanGateway as HouseholdMealPlanGatewayService,
  HouseholdPlanningContentGateway as HouseholdPlanningContentGatewayService,
  HouseholdPeopleGateway as HouseholdPeopleGatewayService,
} from "./household.gateway.js";
import {
  HouseholdHttpApiLayer,
  HouseholdMealPlanHttpApiLayer,
  HouseholdPlanningContentHttpApiLayer,
  HouseholdPeopleHttpApiLayer,
} from "./household.http.js";
import { makeHouseholdMemberAdmission } from "./rpc/command-envelope.js";

export {
  makeHouseholdMealPlanGateway,
  makeHouseholdPlanningContentGateway,
} from "./household-planning.gateway.js";
export {
  makeHouseholdInvitationRecipientVerifier,
  makeHouseholdPeopleGateway,
} from "./people/household-people.gateway.js";

interface HouseholdDomainPort {
  readonly ensureHousehold: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
}

/** Adapt the private service binding to the application gateway. */
export const makeHouseholdDomainGateway = (domain: HouseholdDomainPort) => {
  const checkedResult: HouseholdDomainGateway = {
    ensure: (principal) =>
      makeHouseholdMemberAdmission(principal).pipe(
        Effect.mapError(() => HouseholdInvalidInput.make({})),
        Effect.flatMap((admission) => domain.ensureHousehold({ admission })),
        Effect.map((metadata) => ({ ...metadata, status: "ready" as const }))
      ),
  };
  return checkedResult;
};

/**
 * Production household request composition shared by the API Worker and its
 * provider-free host proof. Authentication and membership resolution are
 * installed before the private-domain gateway can be reached.
 */
export const makeHouseholdRequestLayer = (options: {
  readonly gateway: HouseholdDomainGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) => {
  const requestServices = Layer.mergeAll(
    Layer.succeed(AuthenticatedOrganizationResolverService, options.resolver),
    Layer.succeed(HouseholdDomainGatewayService, options.gateway)
  );
  return HouseholdHttpApiLayer.pipe(
    Layer.provide(JsonHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};

/** Mount the authenticated meal-plan surface over the admitted application gateway. */
export const makeHouseholdMealPlanRequestLayer = (options: {
  readonly gateway: HouseholdMealPlanGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) => {
  const requestServices = Layer.mergeAll(
    Layer.succeed(AuthenticatedOrganizationResolverService, options.resolver),
    Layer.succeed(HouseholdMealPlanGatewayService, options.gateway)
  );
  return HouseholdMealPlanHttpApiLayer.pipe(
    Layer.provide(JsonHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};

export const makeHouseholdPlanningContentRequestLayer = (options: {
  readonly gateway: HouseholdPlanningContentGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) => {
  const requestServices = Layer.mergeAll(
    Layer.succeed(AuthenticatedOrganizationResolverService, options.resolver),
    Layer.succeed(HouseholdPlanningContentGatewayService, options.gateway)
  );
  return HouseholdPlanningContentHttpApiLayer.pipe(
    Layer.provide(JsonHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};

/** Mount the authenticated household people surface over its admitted gateway. */
export const makeHouseholdPeopleRequestLayer = (options: {
  readonly gateway: HouseholdPeopleGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) => {
  const requestServices = Layer.mergeAll(
    Layer.succeed(AuthenticatedOrganizationResolverService, options.resolver),
    Layer.succeed(HouseholdPeopleGatewayService, options.gateway)
  );
  return HouseholdPeopleHttpApiLayer.pipe(
    Layer.provide(JsonHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};
