import { applyD1Migrations, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { Effect } from "effect";
import { beforeAll, describe, expect, it, vi } from "vitest";

import * as authSchema from "./auth.database-schema.js";
import { makeMealPlannerAuth } from "./auth.js";
import {
  resolveAuthenticatedOrganization,
  resolveAuthPrincipal,
} from "./auth.principal.js";

const testEnv = env as unknown as {
  readonly AUTH_TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
  readonly MealPlannerAuthDatabase: AnyD1Database;
};

const baseURL = "https://meal-planner.test";
const secret = "local-worker-test-secret-at-least-32-characters";

const cookieHeader = (response: Response): string => {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) {
    throw new Error("Expected Better Auth to set a session cookie.");
  }
  return setCookie.split(";", 1)[0] ?? "";
};

const authRequest = (
  path: string,
  body: Record<string, unknown>,
  cookie?: string
) => {
  const headers = new Headers({
    "content-type": "application/json",
    origin: baseURL,
  });
  if (cookie !== undefined) {
    headers.set("cookie", cookie);
  }
  return new Request(`${baseURL}/api/auth${path}`, {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  });
};

describe("Better Auth D1 control plane", () => {
  beforeAll(async () => {
    await applyD1Migrations(
      testEnv.MealPlannerAuthDatabase,
      testEnv.AUTH_TEST_MIGRATIONS
    );
  });

  it("signs up, resolves a session, and creates an active household organization", async () => {
    const database = drizzle(testEnv.MealPlannerAuthDatabase);
    const auth = makeMealPlannerAuth({
      baseURL,
      database,
      schema: authSchema,
      secret,
    });
    const getActiveMember = vi.spyOn(auth.api, "getActiveMember");
    const signUp = await auth.fetch(
      authRequest("/sign-up/email", {
        email: "local-flow@example.test",
        name: "Local Flow",
        password: "correct horse battery staple",
      })
    );
    expect(signUp.status).toBe(200);
    const cookie = cookieHeader(signUp);

    const createOrganization = await auth.fetch(
      authRequest(
        "/organization/create",
        { name: "Local household", slug: "local-household" },
        cookie
      )
    );
    expect(createOrganization.status).toBe(200);
    const organization = (await createOrganization.json()) as { id: string };

    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session?.session.activeOrganizationId).toBe(organization.id);

    const principal = await Effect.runPromise(
      resolveAuthPrincipal({
        auth,
        headers: new Headers({ cookie }),
      })
    );
    expect(principal.actorId).toMatch(/^[a-f\d]{64}$/u);
    expect(principal.householdScopeId).toMatch(/^[a-f\d]{64}$/u);
    const authenticatedOrganization = await Effect.runPromise(
      resolveAuthenticatedOrganization({
        auth,
        headers: new Headers({ cookie }),
      })
    );
    expect(authenticatedOrganization).toEqual({
      membershipRole: "owner",
      organizationId: organization.id,
      userId: session?.user.id,
    });
    expect(getActiveMember).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    });

    const signOut = await auth.fetch(authRequest("/sign-out", {}, cookie));
    expect(signOut.status).toBe(200);
    const signIn = await auth.fetch(
      authRequest("/sign-in/email", {
        email: "local-flow@example.test",
        password: "correct horse battery staple",
      })
    );
    expect(signIn.status).toBe(200);
    const signedInCookie = cookieHeader(signIn);
    const sessionResponse = await auth.fetch(
      new Request(`${baseURL}/api/auth/get-session`, {
        headers: { cookie: signedInCookie },
      })
    );
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({
      user: { email: "local-flow@example.test" },
    });
  });

  it("persists the exact caller-supplied invitation id supported by Better Auth rc.6", async () => {
    const database = drizzle(testEnv.MealPlannerAuthDatabase);
    const auth = makeMealPlannerAuth({
      baseURL,
      database,
      schema: authSchema,
      secret,
    });
    const signUp = await auth.fetch(
      authRequest("/sign-up/email", {
        email: "exact-invitation-owner@example.test",
        name: "Exact Invitation Owner",
        password: "correct horse battery staple",
      })
    );
    const cookie = cookieHeader(signUp);
    const createOrganization = await auth.fetch(
      authRequest(
        "/organization/create",
        { name: "Exact invitation", slug: "exact-invitation" },
        cookie
      )
    );
    const organization = (await createOrganization.json()) as { id: string };
    const invitationId = "invitation-operation-fixed-0001";

    const response = await auth.fetch(
      authRequest(
        "/organization/invite-member",
        {
          email: "exact-invitation-recipient@example.test",
          id: invitationId,
          organizationId: organization.id,
          role: "member",
        },
        cookie
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: invitationId });
    expect(
      await database
        .select({ id: authSchema.invitation.id })
        .from(authSchema.invitation)
        .where(eq(authSchema.invitation.id, invitationId))
    ).toEqual([{ id: invitationId }]);
  });

  it("rejects an active organization id without a matching membership", async () => {
    const database = drizzle(testEnv.MealPlannerAuthDatabase);
    const auth = makeMealPlannerAuth({
      baseURL,
      database,
      schema: authSchema,
      secret,
    });
    const signUpA = await auth.fetch(
      authRequest("/sign-up/email", {
        email: "membership-a@example.test",
        name: "Membership A",
        password: "correct horse battery staple",
      })
    );
    const cookieA = cookieHeader(signUpA);
    const signUpB = await auth.fetch(
      authRequest("/sign-up/email", {
        email: "membership-b@example.test",
        name: "Membership B",
        password: "correct horse battery staple",
      })
    );
    const cookieB = cookieHeader(signUpB);
    const createOrganizationB = await auth.fetch(
      authRequest(
        "/organization/create",
        { name: "Foreign household", slug: "foreign-household" },
        cookieB
      )
    );
    const organizationB = (await createOrganizationB.json()) as { id: string };
    const sessionA = await auth.api.getSession({
      headers: new Headers({ cookie: cookieA }),
    });
    if (sessionA === null) {
      throw new Error("Expected user A session.");
    }

    await database
      .update(authSchema.session)
      .set({ activeOrganizationId: organizationB.id })
      .where(eq(authSchema.session.id, sessionA.session.id));

    const error = await Effect.runPromise(
      Effect.flip(
        resolveAuthPrincipal({
          auth,
          headers: new Headers({ cookie: cookieA }),
        })
      )
    );
    expect(error.reason).toBe("missing_membership");

    const householdError = await Effect.runPromise(
      Effect.flip(
        resolveAuthenticatedOrganization({
          auth,
          headers: new Headers({ cookie: cookieA }),
        })
      )
    );
    expect(householdError.reason).toBe("missing_membership");
  });

  it("keeps membership changes behind the controlled API and disables organization deletion", async () => {
    const database = drizzle(testEnv.MealPlannerAuthDatabase);
    const auth = makeMealPlannerAuth({
      baseURL,
      database,
      schema: authSchema,
      secret,
    });
    const signUp = await auth.fetch(
      authRequest("/sign-up/email", {
        email: "protected-household@example.test",
        name: "Protected Household",
        password: "correct horse battery staple",
      })
    );
    expect(signUp.status).toBe(200);
    const cookie = cookieHeader(signUp);
    const createOrganization = await auth.fetch(
      authRequest(
        "/organization/create",
        { name: "Protected household", slug: "protected-household" },
        cookie
      )
    );
    expect(createOrganization.status).toBe(200);
    const organization = (await createOrganization.json()) as { id: string };

    const removeMember = await auth.fetch(
      authRequest(
        "/organization/remove-member",
        {
          memberIdOrEmail: "protected-household@example.test",
          organizationId: organization.id,
        },
        cookie
      )
    );
    expect(removeMember.status).toBe(404);

    const leaveOrganization = await auth.fetch(
      authRequest(
        "/organization/leave",
        { organizationId: organization.id },
        cookie
      )
    );
    expect(leaveOrganization.status).toBe(404);

    const deleteOrganization = await auth.fetch(
      authRequest(
        "/organization/delete",
        { organizationId: organization.id },
        cookie
      )
    );
    expect(deleteOrganization.status).toBe(404);
    await expect(
      auth.api.deleteOrganization({
        body: { organizationId: organization.id },
        headers: new Headers({ cookie }),
      })
    ).rejects.toMatchObject({
      body: { code: "ORGANIZATION_DELETION_DISABLED" },
      status: "NOT_FOUND",
    });

    expect(
      await database
        .select({ id: authSchema.organization.id })
        .from(authSchema.organization)
        .where(eq(authSchema.organization.id, organization.id))
    ).toEqual([{ id: organization.id }]);
    expect(
      await database
        .select({ organizationId: authSchema.member.organizationId })
        .from(authSchema.member)
        .where(eq(authSchema.member.organizationId, organization.id))
    ).toEqual([{ organizationId: organization.id }]);
  });
});
