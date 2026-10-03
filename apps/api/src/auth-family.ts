import { FamilyServiceLive } from "@meal-planner/families/application";
import { InvitationResponseServiceLive } from "@meal-planner/invitations/application";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

import type {
  MealPlannerAuthService,
  AuthenticatedOrganizationResolver,
} from "./features/auth/index.js";
import {
  FamilyStoreLive,
  familyHttpApiLayer,
} from "./features/families/index.js";
import type { HouseholdDomainWorkerMethods } from "./features/households/household-domain-worker.js";
import {
  makeHouseholdPeopleGateway,
  makeHouseholdPeopleRequestLayer,
} from "./features/households/household-request-composition.js";
import {
  HouseholdCreatorLive,
  InvitationMembershipLive,
} from "./features/households/membership.js";
import { makeHouseholdPeopleControlPlane } from "./features/households/people/household-people.control-plane.js";
import type { MemberDepartureWorkflowStarter } from "./features/households/people/member-departure.js";
import {
  InvitationAuthorityLive,
  invitationReadHttpApiLayer,
} from "./features/invitations/index.js";

/** Request-scoped composition shared by the production Worker and native test host. */
export const makeAuthFamilyHttpLayer = ({
  auth,
  database,
  domain,
  departureWorkflow,
  headers,
  resolver,
  sendInvitationEmail,
}: {
  readonly auth: MealPlannerAuthService;
  readonly database: DrizzleD1Database;
  readonly domain: HouseholdDomainWorkerMethods;
  readonly departureWorkflow: MemberDepartureWorkflowStarter;
  readonly headers: Headers;
  readonly resolver: AuthenticatedOrganizationResolver;
  readonly sendInvitationEmail: Parameters<
    typeof makeHouseholdPeopleGateway
  >[0]["sendInvitationEmail"];
}) => {
  const people = makeHouseholdPeopleGateway({
    controlPlane: makeHouseholdPeopleControlPlane({ auth, database }),
    departureWorkflow,
    domain,
    sendInvitationEmail,
  });
  const families = FamilyServiceLive.pipe(
    Layer.provide(HouseholdCreatorLive(domain)),
    Layer.provide(FamilyStoreLive(database))
  );
  const invitations = InvitationResponseServiceLive.pipe(
    Layer.provide(InvitationAuthorityLive(auth, headers)),
    Layer.provide(InvitationMembershipLive(people, resolver, headers))
  );
  return Layer.mergeAll(
    familyHttpApiLayer(auth).pipe(
      Layer.provide(families),
      HttpRouter.provideRequest(families)
    ),
    invitationReadHttpApiLayer(auth).pipe(
      Layer.provide(invitations),
      HttpRouter.provideRequest(invitations)
    ),
    makeHouseholdPeopleRequestLayer({ gateway: people, resolver })
  ).pipe(
    Layer.provide(
      HttpRouter.middleware((effect) =>
        effect.pipe(
          Effect.map(HttpServerResponse.setHeader("cache-control", "no-store"))
        )
      ).layer
    )
  );
};
