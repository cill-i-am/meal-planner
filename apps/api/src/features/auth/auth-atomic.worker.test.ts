import { applyD1Migrations, env } from "cloudflare:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";

import { PrivateOutputUnavailable } from "../private-output/private-output.contract.js";
import * as schema from "./auth.database-schema.js";
import { makeMealPlannerAuth } from "./auth.js";

const testEnv = env as unknown as {
  readonly AUTH_TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
  readonly MealPlannerAuthDatabase: AnyD1Database;
};
const baseURL = "https://meal-planner.test";
const oldPassword = "synthetic-old-password";
const newPassword = "synthetic-new-password";
let fixtureNumber = 0;

const responseStatus = async (pending: Promise<Response>) => {
  const response = await pending;
  return response.status;
};

const fixture = () => {
  fixtureNumber += 1;
  const ip = `192.0.2.${fixtureNumber}`;
  const database = drizzle(testEnv.MealPlannerAuthDatabase);
  const mails: { readonly url: string }[] = [];
  let failure: "before" | "after" | undefined;
  const auth = makeMealPlannerAuth({
    baseURL,
    database,
    outputFence: async (_input, canonical) => {
      if (failure === "before") {
        throw new PrivateOutputUnavailable({ reason: "authority_unavailable" });
      }
      const result = await canonical();
      if (failure === "after") {
        throw new PrivateOutputUnavailable({ reason: "authority_unavailable" });
      }
      return result;
    },
    schema,
    secret: "synthetic-atomic-auth-test-secret-long-enough",
    sendPasswordResetEmail: (mail) => {
      mails.push(mail);
      return Promise.resolve();
    },
    verifyInvitationRecipient: () => Promise.resolve(),
  });
  const account = async () => {
    const email = `${crypto.randomUUID()}@example.test`;
    const result = await auth.api.signUpEmail({
      body: { email, name: "Atomic test", password: oldPassword },
      returnHeaders: true,
    });
    return {
      email,
      headers: new Headers({
        "CF-Connecting-IP": ip,
        cookie: result.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
        origin: baseURL,
      }),
      userId: result.response.user.id,
    };
  };
  const post = (path: string, body: object, headers = new Headers()) =>
    auth.fetch(
      new Request(`${baseURL}/api/auth${path}`, {
        body: JSON.stringify(body),
        headers: {
          ...Object.fromEntries(headers),
          "CF-Connecting-IP": ip,
          "content-type": "application/json",
          origin: baseURL,
        },
        method: "POST",
      })
    );
  const resetToken = async (email: string) => {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/reset-password" },
    });
    const mail = mails.at(-1);
    if (!mail) {
      throw new Error("Expected a synthetic reset message.");
    }
    const callback = await auth.fetch(
      new Request(mail.url, { headers: { "CF-Connecting-IP": ip } })
    );
    const token = new URL(
      callback.headers.get("location") ?? "",
      baseURL
    ).searchParams.get("token");
    if (!token) {
      throw new Error("Expected reset token.");
    }
    return token;
  };
  const sessions = (userId: string) =>
    database
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, userId));
  const credentials = (userId: string) =>
    database
      .select()
      .from(schema.account)
      .where(eq(schema.account.userId, userId));
  const tokens = (token: string) =>
    database
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, `reset-password:${token}`));
  return {
    account,
    auth,
    credentials,
    database,
    fail: (mode?: typeof failure) => {
      failure = mode;
    },
    post,
    resetToken,
    sessions,
    tokens,
  };
};

describe("atomic Better Auth mutations on D1", () => {
  beforeAll(async () => {
    await applyD1Migrations(
      testEnv.MealPlannerAuthDatabase,
      testEnv.AUTH_TEST_MIGRATIONS
    );
  });

  it("retains token, password and sessions when reset's fence cannot admit the operation", async () => {
    const f = fixture();
    const account = await f.account();
    const token = await f.resetToken(account.email);
    const before = await f.credentials(account.userId);
    f.fail("before");
    expect(
      await responseStatus(f.post("/reset-password", { newPassword, token }))
    ).toBe(503);
    expect(await f.credentials(account.userId)).toEqual(before);
    expect(await f.tokens(token)).toHaveLength(1);
    expect(await f.sessions(account.userId)).toHaveLength(1);
    f.fail();
    expect(
      await responseStatus(f.post("/reset-password", { newPassword, token }))
    ).toBe(200);
    expect(await f.tokens(token)).toHaveLength(0);
    expect(await f.sessions(account.userId)).toHaveLength(0);
    expect(
      await responseStatus(f.post("/reset-password", { newPassword, token }))
    ).toBe(400);
  });

  it.each([
    "auth_mutation_receipt",
    "account",
    "session",
    "verification",
  ] as const)(
    "rolls the whole reset back when the %s statement fails",
    async (table) => {
      const f = fixture();
      const account = await f.account();
      const token = await f.resetToken(account.email);
      const before = await f.credentials(account.userId);
      const trigger = `reset_failure_${table}`;
      const operation = {
        account: "UPDATE",
        auth_mutation_receipt: "INSERT",
        session: "DELETE",
        verification: "DELETE",
      }[table];
      const condition = {
        account: sql`OLD.user_id = ${account.userId}`,
        auth_mutation_receipt: sql`NEW.account_id = ${account.userId}`,
        session: sql`OLD.user_id = ${account.userId}`,
        verification: sql`OLD.identifier = ${`reset-password:${token}`}`,
      }[table];
      await f.database.run(
        sql`CREATE TRIGGER ${sql.raw(trigger)} BEFORE ${sql.raw(operation)} ON ${sql.raw(table)} WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'synthetic batch failure'); END`.inlineParams()
      );
      try {
        expect(
          await responseStatus(
            f.post("/reset-password", { newPassword, token })
          )
        ).toBeGreaterThanOrEqual(500);
        expect(await f.credentials(account.userId)).toEqual(before);
        expect(await f.tokens(token)).toHaveLength(1);
        expect(await f.sessions(account.userId)).toHaveLength(1);
      } finally {
        await f.database.run(sql`DROP TRIGGER ${sql.raw(trigger)}`);
      }
      expect(
        await responseStatus(f.post("/reset-password", { newPassword, token }))
      ).toBe(200);
      expect(await f.sessions(account.userId)).toHaveLength(0);
    }
  );

  it("has already revoked every old session when reset's completion acknowledgement is lost", async () => {
    const f = fixture();
    const account = await f.account();
    const token = await f.resetToken(account.email);
    f.fail("after");
    expect(
      await responseStatus(f.post("/reset-password", { newPassword, token }))
    ).toBe(503);
    expect(await f.sessions(account.userId)).toHaveLength(0);
    expect(await f.tokens(token)).toHaveLength(0);
    f.fail();
    expect(
      await f.auth.api.getSession({ headers: account.headers })
    ).toBeNull();
    expect(
      await responseStatus(
        f.post("/sign-in/email", {
          email: account.email,
          password: newPassword,
        })
      )
    ).toBe(200);
  });

  it("allows only one concurrent reset to consume the token and commit a password", async () => {
    const f = fixture();
    const account = await f.account();
    const token = await f.resetToken(account.email);
    const responses = await Promise.all([
      f.post("/reset-password", { newPassword, token }),
      f.post("/reset-password", {
        newPassword: "another-synthetic-password",
        token,
      }),
    ]);
    expect(responses.map((response) => response.status).toSorted()).toEqual([
      200, 400,
    ]);
    expect(await f.sessions(account.userId)).toHaveLength(0);
  });

  it("allows one concurrent acceptance and returns a definite rejection for the losing attempt", async () => {
    const f = fixture();
    const owner = await f.account();
    const recipient = await f.account();
    const organization = await f.auth.api.createOrganization({
      body: { name: "Concurrent family", slug: crypto.randomUUID() },
      headers: owner.headers,
    });
    if (!organization) {
      throw new Error("Expected organization.");
    }
    const invitation = await f.auth.api.createInvitation({
      body: {
        email: recipient.email,
        organizationId: organization.id,
        role: "member",
      },
      headers: owner.headers,
    });
    const responses = await Promise.all([
      f.post(
        "/organization/accept-invitation",
        { invitationId: invitation.id },
        recipient.headers
      ),
      f.post(
        "/organization/accept-invitation",
        { invitationId: invitation.id },
        recipient.headers
      ),
    ]);
    expect(responses.map((response) => response.status).toSorted()).toEqual([
      200, 400,
    ]);
    expect(
      await f.database
        .select()
        .from(schema.member)
        .where(
          and(
            eq(schema.member.userId, recipient.userId),
            eq(schema.member.organizationId, organization.id)
          )
        )
    ).toHaveLength(1);
  });

  it.each([
    "fence",
    "auth_mutation_receipt",
    "invitation",
    "member",
    "session",
  ] as const)(
    "does not admit membership on %s failure, then retries without duplication",
    async (stage) => {
      const f = fixture();
      const owner = await f.account();
      const recipient = await f.account();
      const organization = await f.auth.api.createOrganization({
        body: { name: "Atomic family", slug: crypto.randomUUID() },
        headers: owner.headers,
      });
      if (!organization) {
        throw new Error("Expected organization.");
      }
      const invitation = await f.auth.api.createInvitation({
        body: {
          email: recipient.email,
          organizationId: organization.id,
          role: "member",
        },
        headers: owner.headers,
      });
      const members = () =>
        f.database
          .select()
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, organization.id),
              eq(schema.member.userId, recipient.userId)
            )
          );
      const readInvitation = () =>
        f.database
          .select()
          .from(schema.invitation)
          .where(eq(schema.invitation.id, invitation.id));
      const trigger = `invitation_failure_${stage}`;
      if (stage === "fence") {
        f.fail("before");
      } else {
        const operation =
          stage === "member" || stage === "auth_mutation_receipt"
            ? "INSERT"
            : "UPDATE";
        const condition = {
          auth_mutation_receipt: sql`NEW.account_id = ${recipient.userId}`,
          invitation: sql`NEW.id = ${invitation.id}`,
          member: sql`NEW.user_id = ${recipient.userId}`,
          session: sql`NEW.user_id = ${recipient.userId}`,
        }[stage];
        await f.database.run(
          sql`CREATE TRIGGER ${sql.raw(trigger)} BEFORE ${sql.raw(operation)} ON ${sql.raw(stage)} WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'synthetic batch failure'); END`.inlineParams()
        );
      }
      try {
        expect(
          await responseStatus(
            f.post(
              "/organization/accept-invitation",
              { invitationId: invitation.id },
              recipient.headers
            )
          )
        ).toBeGreaterThanOrEqual(500);
        expect(await members()).toHaveLength(0);
        expect(await readInvitation()).toMatchObject([{ status: "pending" }]);
        expect(await f.sessions(recipient.userId)).toMatchObject([
          { activeOrganizationId: null },
        ]);
      } finally {
        f.fail();
        if (stage !== "fence") {
          await f.database.run(sql`DROP TRIGGER ${sql.raw(trigger)}`);
        }
      }
      expect(
        await responseStatus(
          f.post(
            "/organization/accept-invitation",
            { invitationId: invitation.id },
            recipient.headers
          )
        )
      ).toBe(200);
      const acceptedMembers = await members();
      expect(acceptedMembers).toHaveLength(1);
      expect(await readInvitation()).toMatchObject([{ status: "accepted" }]);
      const [acceptedMember] = acceptedMembers;
      if (!acceptedMember) {
        throw new Error("Expected accepted member.");
      }
      await f.auth.api.removeMember({
        body: {
          memberIdOrEmail: acceptedMember.id,
          organizationId: organization.id,
        },
        headers: owner.headers,
      });
      expect(await members()).toHaveLength(0);
      await expect(
        f.auth.api.setActiveOrganization({
          body: { organizationId: organization.id },
          headers: recipient.headers,
        })
      ).rejects.toBeDefined();
    }
  );
});
