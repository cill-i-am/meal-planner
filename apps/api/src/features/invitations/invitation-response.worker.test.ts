import {
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdPeopleUnavailable,
  InvitationId,
} from "@meal-planner/household-api";
import { InvitationResponse } from "@meal-planner/invitations";
import {
  InvitationResponseService,
  InvitationResponseServiceLive,
} from "@meal-planner/invitations/application";
import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { Effect, Schema, Layer } from "effect";
import { beforeAll, expect, it } from "vitest";

import * as authSchema from "../auth/auth.database-schema.js";
import { makeMealPlannerAuth } from "../auth/auth.js";
import { makeAuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import { makeNativeAuthTestService } from "../auth/auth.test-fixture.js";
import type { HouseholdPeopleGateway } from "../households/household.gateway.js";
import { InvitationMembershipLive } from "../households/membership.js";
import { InvitationAuthorityLive } from "./authority.better-auth.js";

const testEnv = env as unknown as {
  readonly AUTH_TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
  readonly MealPlannerAuthDatabase: AnyD1Database;
};
beforeAll(() =>
  applyD1Migrations(
    testEnv.MealPlannerAuthDatabase,
    testEnv.AUTH_TEST_MIGRATIONS
  )
);
it("resumes a saved acceptance after a failed household link and rejects another account", async () => {
  const auth = makeMealPlannerAuth({
    baseURL: "https://meal-planner.test",
    database: drizzle(testEnv.MealPlannerAuthDatabase),
    outputFence: (_input, canonical) => canonical(),
    schema: authSchema,
    secret: "local-worker-test-secret-at-least-32-characters",
  });
  const signup = async (name: string) => {
    const response = await auth.api.signUpEmail({
      asResponse: true,
      body: {
        email: `${name.toLowerCase()}@example.test`,
        name,
        password: "local-test-password-only",
      },
    });
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) {
      throw new Error("Expected session cookie");
    }
    return new Headers({ cookie });
  };
  const owner = await signup("Owner");
  const recipient = await signup("Recipient");
  const organization = await auth.api.createOrganization({
    body: { name: "Family", slug: "family" },
    headers: owner,
  });
  const invitation = await auth.api.createInvitation({
    body: {
      email: "recipient@example.test",
      organizationId: organization.id,
      role: "member",
    },
    headers: owner,
  });
  const id = Schema.decodeUnknownSync(InvitationId)(invitation.id);
  const person = Schema.decodeUnknownSync(HouseholdPerson)({
    associationState: "linked",
    associationVersion: 1,
    createdAtEpochMs: 1,
    displayName: "Recipient",
    id: "person_11111111-1111-4111-8111-111111111111",
    isCurrentAdult: true,
    kind: "adult",
    lifecycle: "active",
    updatedAtEpochMs: 1,
    version: 1,
  });
  let linked = false;
  const linkCalls: string[] = [];
  const service = makeNativeAuthTestService(auth);
  const people: Pick<HouseholdPeopleGateway, "list" | "completeAdultLink"> = {
    completeAdultLink: ({ payload, principal }) => {
      expect(principal.organizationId).toBe(organization.id);
      linkCalls.push(payload.mutationId);
      if (linkCalls.length === 1) {
        return Effect.fail(HouseholdPeopleUnavailable.make({}));
      }
      linked = true;
      return Effect.succeed(person);
    },
    list: () =>
      Effect.succeed(
        Schema.decodeUnknownSync(HouseholdPeopleRoster)({
          creatorSlot: "occupied",
          currentPersonId: linked ? person.id : null,
          people: linked ? [person] : [],
        })
      ),
  };
  const resolver = makeAuthenticatedOrganizationResolver({ auth: service });
  const payload = Schema.decodeUnknownSync(InvitationResponse)({
    decision: "accept",
    mutationId: "join-request-1111",
  });
  const run = (headers: Headers) =>
    Effect.runPromise(
      InvitationResponseService.use((s) => s.respond(id, payload)).pipe(
        Effect.provide(
          InvitationResponseServiceLive.pipe(
            Layer.provide(InvitationAuthorityLive(service, headers)),
            Layer.provide(InvitationMembershipLive(people, resolver, headers))
          )
        )
      )
    );
  await expect(run(owner)).rejects.toMatchObject({ reason: "forbidden" });
  await expect(run(recipient)).rejects.toMatchObject({ reason: "unavailable" });
  const response1 = await auth.api.getSetupInvitation({
    headers: recipient,
    params: { id },
  });
  expect(response1.status).toBe("accepted");
  expect(await run(recipient)).toEqual({
    familyId: organization.id,
    status: "joined",
  });
  expect(linkCalls).toEqual([payload.mutationId, payload.mutationId]);
  expect(await run(recipient)).toEqual({
    familyId: organization.id,
    status: "joined",
  });
  expect(linkCalls).toHaveLength(2);
  const changedAccount = new Headers(recipient);
  changedAccount.set("x-meal-planner-user", "another-user");
  await expect(run(changedAccount)).rejects.toMatchObject({
    reason: "unauthorized",
  });
  await expect(
    Effect.runPromise(
      InvitationResponseService.use((s) =>
        s.respond(id, { ...payload, decision: "decline" })
      ).pipe(
        Effect.provide(
          InvitationResponseServiceLive.pipe(
            Layer.provide(InvitationAuthorityLive(service, recipient)),
            Layer.provide(InvitationMembershipLive(people, resolver, recipient))
          )
        )
      )
    )
  ).rejects.toMatchObject({ reason: "invalid_response" });
});
