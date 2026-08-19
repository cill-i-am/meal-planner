import {
  HouseholdOrganizationId,
  HouseholdStatus,
} from "@meal-planner/household-api";
import { Effect, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterAll, describe, expect, it } from "vitest";

import {
  AuthenticatedOrganizationResolver,
  AuthPrincipalResolutionError,
} from "../auth/auth.principal.js";
import { makeHouseholdRequestLayer } from "./household-request-composition.js";
import type { HouseholdDomainGateway } from "./household.gateway.js";
import { HouseholdDomainGateway as HouseholdDomainGatewayService } from "./household.gateway.js";

const organizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
  "organization-a"
);
const householdStatus = Schema.decodeUnknownSync(HouseholdStatus)({
  createdAtEpochMs: 1_777_777_777_777,
  organizationId,
  status: "ready",
});

const makeApp = (options: {
  readonly gateway: HouseholdDomainGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) =>
  HttpRouter.toWebHandler(makeHouseholdRequestLayer(options), {
    disableLogger: true,
  });

describe("household HttpApi boundary", () => {
  const apps: ReturnType<typeof makeApp>[] = [];

  afterAll(async () => {
    await Promise.all(apps.map(({ dispose }) => dispose()));
  });

  it("routes only the organization admitted from the authenticated session", async () => {
    const routedOrganizationIds: string[] = [];
    const app = makeApp({
      gateway: HouseholdDomainGatewayService.of({
        ensure: (admittedOrganizationId) =>
          Effect.sync(() => {
            routedOrganizationIds.push(admittedOrganizationId);
            return householdStatus;
          }),
      }),
      resolver: AuthenticatedOrganizationResolver.of({
        resolve: () =>
          Effect.succeed({ organizationId, userId: "authenticated-user" }),
      }),
    });
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/household", {
        headers: { cookie: "better-auth.session_token=session" },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(householdStatus);
    expect(routedOrganizationIds).toEqual([organizationId]);
  });

  it("rejects before routing when authentication cannot admit an organization", async () => {
    let routed = false;
    const app = makeApp({
      gateway: HouseholdDomainGatewayService.of({
        ensure: () => {
          routed = true;
          return Effect.succeed(householdStatus);
        },
      }),
      resolver: AuthenticatedOrganizationResolver.of({
        resolve: () =>
          Effect.fail(
            new AuthPrincipalResolutionError({
              reason: "missing_membership",
            })
          ),
      }),
    });
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/household")
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized",
      message: "Sign in and select a household to continue.",
      status: 401,
    });
    expect(routed).toBe(false);
  });
});
