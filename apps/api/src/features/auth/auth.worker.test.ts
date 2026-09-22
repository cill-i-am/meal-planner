import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { applyD1Migrations, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { makeHouseholdPeopleControlPlane } from "../households/people/household-people.control-plane.js";
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
    "cf-connecting-ip": "192.0.2.10",
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

  beforeEach(async () => {
    // Each scenario has its own request window; rate-limit behavior has a dedicated suite.
    await drizzle(testEnv.MealPlannerAuthDatabase).delete(authSchema.rateLimit);
  });

  it("uses real single-use reset tokens with generic confirmation and session revocation", async () => {
    const mails: { email: string; url: string }[] = [];
    const auth = makeMealPlannerAuth({
      baseURL,
      database: drizzle(testEnv.MealPlannerAuthDatabase),
      outputFence: (_input, canonical) => canonical(),
      schema: authSchema,
      secret,
      sendPasswordResetEmail: (mail) => {
        mails.push(mail);
        return Promise.resolve();
      },
    });
    const email = "recovery-fixture@example.test";
    const signup = await auth.fetch(
      authRequest("/sign-up/email", {
        email,
        name: "Recovery fixture",
        password: "old-local-password",
      })
    );
    const cookie = cookieHeader(signup);
    const callback = `${baseURL}/reset-password?redirect=%2Finvitation%2Fsynthetic`;
    const known = await auth.fetch(
      authRequest("/request-password-reset", { email, redirectTo: callback })
    );
    const unknown = await auth.fetch(
      authRequest("/request-password-reset", {
        email: "unknown-recovery@example.test",
        redirectTo: callback,
      })
    );
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    expect(mails).toHaveLength(1);
    const [mail] = mails;
    if (!mail) {
      throw new Error("Expected captured mock delivery");
    }
    const callbackResponse = await auth.fetch(new Request(mail.url));
    const location = callbackResponse.headers.get("location");
    if (!location) {
      throw new Error("Expected reset callback");
    }
    const resetURL = new URL(location);
    expect(resetURL.searchParams.get("redirect")).toBe("/invitation/synthetic");
    const token = resetURL.searchParams.get("token");
    const invalid = await auth.fetch(
      authRequest("/reset-password", {
        newPassword: "new-local-password",
        token: "invalid-token",
      })
    );
    expect(invalid.status).toBe(400);
    const changed = await auth.fetch(
      authRequest("/reset-password", {
        newPassword: "new-local-password",
        token,
      })
    );
    expect(changed.status).toBe(200);
    const replay = await auth.fetch(
      authRequest("/reset-password", { newPassword: "another-password", token })
    );
    expect(replay.status).toBe(400);
    const oldSession = await auth.fetch(
      new Request(`${baseURL}/api/auth/get-session`, { headers: { cookie } })
    );
    expect(await oldSession.json()).toBeNull();
    const oldLogin = await auth.fetch(
      authRequest("/sign-in/email", { email, password: "old-local-password" })
    );
    expect(oldLogin.status).toBe(401);
    const login = await auth.fetch(
      authRequest("/sign-in/email", { email, password: "new-local-password" })
    );
    expect(login.status).toBe(200);
    await auth.fetch(
      authRequest("/request-password-reset", { email, redirectTo: callback })
    );
    const [, expiredMail] = mails;
    if (!expiredMail) {
      throw new Error("Expected second reset");
    }
    await drizzle(testEnv.MealPlannerAuthDatabase)
      .update(authSchema.verification)
      .set({ expiresAt: new Date(0) });
    const expired = await auth.fetch(new Request(expiredMail.url));
    expect(expired.headers.get("location")).toContain("error=INVALID_TOKEN");
  });

  it.each(["accept", "reject"])(
    "reads recipient-only invitation outcomes after %s",
    async (decision) => {
      const database = drizzle(testEnv.MealPlannerAuthDatabase);
      const auth = makeMealPlannerAuth({
        baseURL,
        database,
        outputFence: (_input, canonical) => canonical(),
        schema: authSchema,
        secret,
      });
      const owner = await auth.fetch(
        authRequest("/sign-up/email", {
          email: `view-owner-${decision}@example.test`,
          name: "Synthetic Owner",
          password: "local-test-password-only",
        })
      );
      const ownerCookie = cookieHeader(owner);
      const createdFamily = await auth.fetch(
        authRequest(
          "/organization/create",
          { name: "Synthetic Family", slug: `view-family-${decision}` },
          ownerCookie
        )
      );
      const family = Schema.decodeUnknownSync(
        Schema.Struct({ id: Schema.String })
      )(await createdFamily.json());
      const invitationResponse = await auth.fetch(
        authRequest(
          "/organization/invite-member",
          {
            email: `view-recipient-${decision}@example.test`,
            organizationId: family.id,
            role: "member",
          },
          ownerCookie
        )
      );
      const { id: invitationId } = Schema.decodeUnknownSync(
        Schema.Struct({ id: Schema.String })
      )(await invitationResponse.json());
      const view = (cookie?: string) =>
        auth.fetch(
          new Request(`${baseURL}/api/auth/setup/invitation/${invitationId}`, {
            headers: cookie ? { cookie } : {},
          })
        );
      const anonymous = await view();
      expect(anonymous.status).toBe(401);
      const wrong = await view(ownerCookie);
      expect(wrong.status).toBe(403);
      expect(await wrong.text()).not.toContain(
        `view-recipient-${decision}@example.test`
      );
      const recipient = await auth.fetch(
        authRequest("/sign-up/email", {
          email: `view-recipient-${decision}@example.test`,
          name: "Synthetic Recipient",
          password: "local-test-password-only",
        })
      );
      const recipientCookie = cookieHeader(recipient);
      const pending = await view(recipientCookie);
      expect(await pending.json()).toMatchObject({
        familyName: "Synthetic Family",
        status: "pending",
      });
      const [inviterMembership] = await database
        .select()
        .from(authSchema.member)
        .where(eq(authSchema.member.organizationId, family.id));
      if (!inviterMembership) {
        throw new Error("Expected inviter membership");
      }
      await database
        .delete(authSchema.member)
        .where(eq(authSchema.member.id, inviterMembership.id));
      const unavailableInviter = await view(recipientCookie);
      expect(unavailableInviter.status).toBe(404);
      await database.insert(authSchema.member).values(inviterMembership);
      const response = await auth.fetch(
        authRequest(
          `/organization/${decision}-invitation`,
          { invitationId },
          recipientCookie
        )
      );
      expect(response.status).toBe(200);
      const completed = await view(recipientCookie);
      expect(await completed.json()).toMatchObject({
        status: decision === "accept" ? "accepted" : "rejected",
      });
      expect(completed.headers.get("cache-control")).toBe("no-store");
    }
  );

  it("persists only valid account-owned setup checkpoints", async () => {
    const auth = makeMealPlannerAuth({
      baseURL,
      database: drizzle(testEnv.MealPlannerAuthDatabase),
      outputFence: (_input, canonical) => canonical(),
      schema: authSchema,
      secret,
    });
    const signup = await auth.fetch(
      authRequest("/sign-up/email", {
        email: "checkpoint@example.test",
        name: "Checkpoint",
        password: "correct horse battery staple",
      })
    );
    const cookie = cookieHeader(signup);
    const progress = {
      checkpoint: { name: "The Morgan family", stage: "family-name" },
      status: "paused",
    };
    const saved = await auth.fetch(
      authRequest("/update-user", { setupProgress: progress }, cookie)
    );
    expect(saved.status).toBe(200);
    const wrongAccount = authRequest(
      "/update-user",
      { setupProgress: { ...progress, status: "active" } },
      cookie
    );
    wrongAccount.headers.set("x-meal-planner-user", "different-account");
    const rejectedAccount = await auth.fetch(wrongAccount);
    expect(rejectedAccount.status).toBe(401);
    const wrongCreation = authRequest(
      "/organization/create",
      { name: "Wrong account", slug: "wrong-account" },
      cookie
    );
    wrongCreation.headers.set("x-meal-planner-user", "different-account");
    const rejectedCreation = await auth.fetch(wrongCreation);
    expect(rejectedCreation.status).toBe(401);
    const session = await auth.fetch(
      new Request(`${baseURL}/api/auth/get-session`, { headers: { cookie } })
    );
    expect(await session.json()).toMatchObject({
      user: { setupProgress: progress },
    });
    const rejected = await auth.fetch(
      authRequest(
        "/update-user",
        {
          setupProgress: {
            ...progress,
            checkpoint: { ...progress.checkpoint, password: "never-persist" },
          },
        },
        cookie
      )
    );
    expect(rejected.status).toBe(400);
    const anonymous = await auth.fetch(
      authRequest("/update-user", { setupProgress: progress })
    );
    expect(anonymous.status).toBe(401);
  });

  it("signs up, resolves a session, and creates an active household organization", async () => {
    const database = drizzle(testEnv.MealPlannerAuthDatabase);
    const auth = makeMealPlannerAuth({
      baseURL,
      database,
      outputFence: (_input, canonical) => canonical(),
      schema: authSchema,
      secret,
    });
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
    const mismatched = new Headers({
      cookie,
      "x-meal-planner-household": "another-family",
    });
    const refused = await Effect.runPromiseExit(
      resolveAuthenticatedOrganization({ auth, headers: mismatched })
    );
    expect(refused._tag).toBe("Failure");

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

  it("preserves the server's retained invitation id without exposing core ID input", async () => {
    const database = drizzle(testEnv.MealPlannerAuthDatabase);
    const auth = makeMealPlannerAuth({
      baseURL,
      database,
      outputFence: (_input, canonical) => canonical(),
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

    const untrustedResponse = await auth.fetch(
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

    expect(untrustedResponse.status).toBe(200);
    expect(await untrustedResponse.json()).not.toMatchObject({
      id: invitationId,
    });
    const controlPlane = makeHouseholdPeopleControlPlane({ auth, database });
    const invitation = await Effect.runPromise(
      controlPlane.createInvitation({
        email: "retained-invitation-recipient@example.test",
        headers: new Headers({ cookie }),
        invitationId,
        organizationId: Schema.decodeUnknownSync(HouseholdOrganizationId)(
          organization.id
        ),
        personId: "synthetic-person",
      })
    );
    expect(invitation.id).toBe(invitationId);
    expect(
      await database
        .select({ id: authSchema.invitation.id })
        .from(authSchema.invitation)
        .where(eq(authSchema.invitation.id, invitationId))
    ).toEqual([{ id: invitationId }]);
    const rejected = await Effect.runPromise(
      Effect.flip(
        controlPlane.createInvitation({
          email: "exact-invitation-owner@example.test",
          headers: new Headers({ cookie }),
          invitationId: "cannot-invite-existing-member",
          organizationId: Schema.decodeUnknownSync(HouseholdOrganizationId)(
            organization.id
          ),
          personId: "synthetic-person",
        })
      )
    );
    expect(rejected).toMatchObject({
      _tag: "HouseholdInvitationRejected",
      reason: "already_member",
    });
  });

  it("rejects an active organization id without a matching membership", async () => {
    const database = drizzle(testEnv.MealPlannerAuthDatabase);
    const auth = makeMealPlannerAuth({
      baseURL,
      database,
      outputFence: (_input, canonical) => canonical(),
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
      outputFence: (_input, canonical) => canonical(),
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
