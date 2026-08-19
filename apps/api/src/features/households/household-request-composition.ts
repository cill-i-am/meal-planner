import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import type { AuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import { AuthenticatedOrganizationResolver as AuthenticatedOrganizationResolverService } from "../auth/auth.principal.js";
import { RecipeImportHttpPlatformServices } from "../imports/import-intent-api.http.js";
import type {
  HouseholdDomainFailure,
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import type { HouseholdDomainGateway } from "./household.gateway.js";
import { HouseholdDomainGateway as HouseholdDomainGatewayService } from "./household.gateway.js";
import { makeHouseholdHttpApiLayer } from "./household.http.js";

interface HouseholdDomainPort {
  readonly ensureHousehold: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
}

/** Adapt the private service binding to the application gateway. */
export const makeHouseholdDomainGateway = (
  domain: HouseholdDomainPort
): HouseholdDomainGateway => ({
  ensure: (organizationId) =>
    domain.ensureHousehold({ organizationId }).pipe(
      Effect.map((metadata) => ({
        ...metadata,
        status: "ready" as const,
      }))
    ),
});

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
  return makeHouseholdHttpApiLayer().pipe(
    Layer.provide(RecipeImportHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};
