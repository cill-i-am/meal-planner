import { applyD1Migrations, env } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";

import { PrivateOutputUnavailable } from "../private-output/private-output.contract.js";
import type { AuthOutputFence } from "./auth-output-fence.js";
import * as authSchema from "./auth.database-schema.js";
import { makeMealPlannerAuth } from "./auth.js";

const testEnv = env as unknown as {
  readonly AUTH_TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
  readonly MealPlannerAuthDatabase: AnyD1Database;
};

const baseURL = "https://meal-planner.test";
const password = "local synthetic password for fence tests";

const makeFixture = () => {
  interface Admission {
    readonly accountId: string;
    readonly intentKey: string;
  }
  const observations: Admission[] = [];
  let nextBarrier: {
    readonly entered: ReturnType<typeof Promise.withResolvers<Admission>>;
    readonly release: ReturnType<typeof Promise.withResolvers<null>>;
  } | null = null;
  const outputFence: AuthOutputFence = async (input, canonical) => {
    observations.push(input);
    const barrier = nextBarrier;
    nextBarrier = null;
    if (barrier !== null) {
      barrier.entered.resolve(input);
      await barrier.release.promise;
    }
    return canonical();
  };
  const blockNextMutation = () => {
    const entered = Promise.withResolvers<Admission>();
    const release = Promise.withResolvers<null>();
    nextBarrier = { entered, release };
    return {
      entered: entered.promise,
      reject: () =>
        release.reject(
          new PrivateOutputUnavailable({ reason: "authority_unavailable" })
        ),
      release: () => release.resolve(null),
    };
  };
  const database = drizzle(testEnv.MealPlannerAuthDatabase);
  const auth = makeMealPlannerAuth({
    baseURL,
    database,
    outputFence,
    schema: authSchema,
    secret: "local-worker-fence-test-secret-at-least-32-characters",
  });
  const createAccount = async () => {
    const email = `${crypto.randomUUID()}@example.test`;
    const signedUp = await auth.api.signUpEmail({
      body: { email, name: "Synthetic fence participant", password },
      returnHeaders: true,
    });
    const setCookie = signedUp.headers.get("set-cookie");
    if (setCookie === null) {
      throw new Error("Expected synthetic account session cookie.");
    }
    const headers = new Headers({
      cookie: setCookie.split(";", 1)[0] ?? "",
      origin: baseURL,
    });
    const session = await auth.api.getSession({
      headers,
      query: { disableRefresh: true },
    });
    if (session === null) {
      throw new Error("Expected synthetic account session.");
    }
    return {
      email,
      headers,
      session: session.session,
      userId: session.user.id,
    };
  };
  const createOrganization = async (headers: Headers) => {
    const organization = await auth.api.createOrganization({
      body: { name: "Synthetic fence household", slug: crypto.randomUUID() },
      headers,
    });
    if (organization === null) {
      throw new Error("Expected synthetic household.");
    }
    return organization;
  };
  const sessions = (userId: string) =>
    database
      .select()
      .from(authSchema.session)
      .where(eq(authSchema.session.userId, userId));
  const members = (memberId: string) =>
    database
      .select()
      .from(authSchema.member)
      .where(eq(authSchema.member.id, memberId));
  return {
    auth,
    blockNextMutation,
    createAccount,
    createOrganization,
    database,
    members,
    observations,
    sessions,
  };
};

describe("Better Auth canonical output fence on D1", () => {
  beforeAll(async () => {
    await applyD1Migrations(
      testEnv.MealPlannerAuthDatabase,
      testEnv.AUTH_TEST_MIGRATIONS
    );
  });

  it("keeps a sign-out session canonical until its account fence acknowledges", async () => {
    const fixture = makeFixture();
    const account = await fixture.createAccount();
    const barrier = fixture.blockNextMutation();
    const signingOut = fixture.auth.api.signOut({ headers: account.headers });
    expect(await barrier.entered).toMatchObject({ accountId: account.userId });
    expect(await fixture.sessions(account.userId)).toHaveLength(1);
    barrier.release();
    await signingOut;
    expect(await fixture.sessions(account.userId)).toHaveLength(0);
  });

  it("rejects public API sign-out when its deletion fence fails", async () => {
    const fixture = makeFixture();
    const account = await fixture.createAccount();
    const barrier = fixture.blockNextMutation();
    const signingOut = fixture.auth.api.signOut({ headers: account.headers });
    const rejected = expect(signingOut).rejects.toMatchObject({
      _tag: "PrivateOutputUnavailable",
      reason: "authority_unavailable",
    });
    await barrier.entered;
    barrier.reject();
    await rejected;
    expect(await fixture.sessions(account.userId)).toHaveLength(1);
  });

  it("returns HTTP 503 when sign-out's deletion fence fails", async () => {
    const fixture = makeFixture();
    const account = await fixture.createAccount();
    const barrier = fixture.blockNextMutation();
    const signingOut = fixture.auth.fetch(
      new Request(`${baseURL}/api/auth/sign-out`, {
        headers: account.headers,
        method: "POST",
      })
    );
    await barrier.entered;
    barrier.reject();
    const response = await signingOut;
    expect(response.status).toBe(503);
    expect(await fixture.sessions(account.userId)).toHaveLength(1);
  });

  it("fences the user-scoped bulk deletion beyond Better Auth's 100-row hook page", async () => {
    const fixture = makeFixture();
    const account = await fixture.createAccount();
    await Promise.all(
      Array.from({ length: 105 }, () =>
        fixture.database.insert(authSchema.session).values({
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3_600_000),
          id: crypto.randomUUID(),
          token: crypto.randomUUID(),
          updatedAt: new Date(),
          userId: account.userId,
        })
      )
    );
    const barrier = fixture.blockNextMutation();
    const revoking = fixture.auth.api.revokeSessions({
      headers: account.headers,
    });
    expect(await barrier.entered).toMatchObject({ accountId: account.userId });
    expect(await fixture.sessions(account.userId)).toHaveLength(106);
    barrier.release();
    await revoking;
    expect(await fixture.sessions(account.userId)).toHaveLength(0);
  });

  it("holds an active household change behind the account fence", async () => {
    const fixture = makeFixture();
    const account = await fixture.createAccount();
    const first = await fixture.createOrganization(account.headers);
    const second = await fixture.createOrganization(account.headers);
    const barrier = fixture.blockNextMutation();
    const switching = fixture.auth.api.setActiveOrganization({
      body: { organizationId: first.id },
      headers: account.headers,
    });
    expect(await barrier.entered).toMatchObject({ accountId: account.userId });
    expect(await fixture.sessions(account.userId)).toMatchObject([
      { activeOrganizationId: second.id },
    ]);
    barrier.release();
    await switching;
    expect(await fixture.sessions(account.userId)).toMatchObject([
      { activeOrganizationId: first.id },
    ]);
  });

  it.each(["remove", "leave"] as const)(
    "fences programmatic membership %s despite disabled HTTP routes",
    async (operation) => {
      const fixture = makeFixture();
      const owner = await fixture.createAccount();
      const participant = await fixture.createAccount();
      const organization = await fixture.createOrganization(owner.headers);
      const member = await fixture.auth.api.addMember({
        body: {
          organizationId: organization.id,
          role: "member",
          userId: participant.userId,
        },
      });
      await fixture.auth.api.setActiveOrganization({
        body: { organizationId: organization.id },
        headers: participant.headers,
      });
      const barrier = fixture.blockNextMutation();
      const removing =
        operation === "remove"
          ? fixture.auth.api.removeMember({
              body: {
                memberIdOrEmail: member.id,
                organizationId: organization.id,
              },
              headers: owner.headers,
            })
          : fixture.auth.api.leaveOrganization({
              body: { organizationId: organization.id },
              headers: participant.headers,
            });
      expect(await barrier.entered).toMatchObject({
        accountId: participant.userId,
      });
      expect(await fixture.members(member.id)).toHaveLength(1);
      barrier.release();
      await removing;
      expect(await fixture.members(member.id)).toHaveLength(0);
    }
  );

  it("fences the real get-session expiry refresh before D1 changes", async () => {
    const fixture = makeFixture();
    const account = await fixture.createAccount();
    const oldExpiry = new Date(Date.now() + 3_600_000);
    await fixture.database
      .update(authSchema.session)
      .set({ expiresAt: oldExpiry })
      .where(eq(authSchema.session.id, account.session.id));
    const barrier = fixture.blockNextMutation();
    const refreshing = fixture.auth.api.getSession({
      headers: account.headers,
    });
    expect(await barrier.entered).toMatchObject({ accountId: account.userId });
    expect(await fixture.sessions(account.userId)).toMatchObject([
      { expiresAt: oldExpiry },
    ]);
    barrier.release();
    const refreshed = await refreshing;
    expect(refreshed?.session.expiresAt.getTime()).toBeGreaterThan(
      oldExpiry.getTime()
    );
    expect(await fixture.sessions(account.userId)).toMatchObject([
      { expiresAt: refreshed?.session.expiresAt },
    ]);
  });

  it("rejects unsupported bulk selectors and identity reassignment before canonical writes", async () => {
    const fixture = makeFixture();
    const account = await fixture.createAccount();
    const other = await fixture.createAccount();
    const organization = await fixture.createOrganization(account.headers);
    const member = await fixture.auth.api.addMember({
      body: {
        organizationId: organization.id,
        role: "member",
        userId: other.userId,
      },
    });
    const { adapter } = await fixture.auth.$context;
    const rejected = {
      _tag: "PrivateOutputUnavailable",
      reason: "unsupported_mutation",
    };
    const before = fixture.observations.length;
    await expect(
      adapter.deleteMany({
        model: "session",
        where: [
          { field: "token", operator: "in", value: [account.session.token] },
        ],
      })
    ).rejects.toMatchObject(rejected);
    await expect(
      adapter.deleteMany({
        model: "member",
        where: [{ field: "organizationId", value: organization.id }],
      })
    ).rejects.toMatchObject(rejected);
    await expect(
      adapter.update({
        model: "session",
        update: { userId: other.userId },
        where: [{ field: "token", value: account.session.token }],
      })
    ).rejects.toMatchObject(rejected);
    await expect(
      adapter.update({
        model: "member",
        update: { userId: account.userId },
        where: [{ field: "id", value: member.id }],
      })
    ).rejects.toMatchObject(rejected);
    await expect(
      adapter.update({
        model: "member",
        update: { organizationId: crypto.randomUUID() },
        where: [{ field: "id", value: member.id }],
      })
    ).rejects.toMatchObject(rejected);
    await expect(
      adapter.update({
        model: "member",
        update: { role: "" },
        where: [{ field: "id", value: member.id }],
      })
    ).rejects.toMatchObject(rejected);
    expect(fixture.observations).toHaveLength(before);
    expect(await fixture.sessions(account.userId)).toMatchObject([
      { id: account.session.id, userId: account.userId },
    ]);
    expect(await fixture.members(member.id)).toMatchObject([
      { organizationId: organization.id, role: "member", userId: other.userId },
    ]);
  });

  it("preserves the fence inside the public D1 transaction callback", async () => {
    const fixture = makeFixture();
    const account = await fixture.createAccount();
    const { adapter } = await fixture.auth.$context;
    const barrier = fixture.blockNextMutation();
    const deleting = adapter.transaction((transaction) =>
      transaction.delete({
        model: "session",
        where: [{ field: "token", value: account.session.token }],
      })
    );
    expect(await barrier.entered).toMatchObject({ accountId: account.userId });
    expect(await fixture.sessions(account.userId)).toHaveLength(1);
    barrier.release();
    await deleting;
    expect(await fixture.sessions(account.userId)).toHaveLength(0);
  });

  it("refuses deletion if the target account changes while its fence is pending", async () => {
    const fixture = makeFixture();
    const account = await fixture.createAccount();
    const other = await fixture.createAccount();
    const { adapter } = await fixture.auth.$context;
    const barrier = fixture.blockNextMutation();
    const deleting = adapter.delete({
      model: "session",
      where: [{ field: "token", value: account.session.token }],
    });
    const rejected = expect(deleting).rejects.toMatchObject({
      _tag: "PrivateOutputUnavailable",
      reason: "unsupported_mutation",
    });
    expect(await barrier.entered).toMatchObject({ accountId: account.userId });
    await fixture.database
      .update(authSchema.session)
      .set({ userId: other.userId })
      .where(eq(authSchema.session.id, account.session.id));
    barrier.release();
    await rejected;
    expect(await fixture.sessions(other.userId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: account.session.id }),
      ])
    );
  });

  it("retries a refresh with newly computed dates after a lost fence acknowledgment and writes once", async () => {
    const fixture = makeFixture();
    const account = await fixture.createAccount();
    const { adapter } = await fixture.auth.$context;
    await fixture.database.run(
      sql`CREATE TABLE auth_fence_test_writes (session_id TEXT PRIMARY KEY, writes INTEGER NOT NULL)`
    );
    await fixture.database.run(
      sql`INSERT INTO auth_fence_test_writes (session_id, writes) VALUES (${account.session.id}, 0)`
    );
    await fixture.database.run(
      sql`CREATE TRIGGER auth_fence_test_count_writes AFTER UPDATE ON session BEGIN UPDATE auth_fence_test_writes SET writes = writes + 1 WHERE session_id = NEW.id; END`
    );
    const firstDate = new Date("2030-01-01T00:00:00.000Z");
    const retryDate = new Date("2030-01-01T00:00:01.000Z");
    const barrier = fixture.blockNextMutation();
    const firstAttempt = adapter.update({
      model: "session",
      update: { expiresAt: firstDate, updatedAt: firstDate },
      where: [{ field: "token", value: account.session.token }],
    });
    const rejected = expect(firstAttempt).rejects.toMatchObject({
      reason: "authority_unavailable",
    });
    const firstIntent = await barrier.entered;
    barrier.reject();
    await rejected;
    expect(
      await fixture.database.all(
        sql`SELECT writes FROM auth_fence_test_writes WHERE session_id = ${account.session.id}`
      )
    ).toEqual([{ writes: 0 }]);
    expect(await fixture.sessions(account.userId)).toMatchObject([
      { expiresAt: account.session.expiresAt },
    ]);

    await adapter.update({
      model: "session",
      update: { expiresAt: retryDate, updatedAt: retryDate },
      where: [
        {
          connector: "AND",
          field: "token",
          operator: "eq",
          value: account.session.token,
        },
      ],
    });
    expect(fixture.observations).toHaveLength(2);
    expect(fixture.observations[1]).toEqual(firstIntent);
    expect(
      await fixture.database.all(
        sql`SELECT writes FROM auth_fence_test_writes WHERE session_id = ${account.session.id}`
      )
    ).toEqual([{ writes: 1 }]);
    expect(await fixture.sessions(account.userId)).toMatchObject([
      { expiresAt: retryDate, updatedAt: retryDate },
    ]);
  });

  it.each([
    "changed token",
    "active organization",
    "extra active organization field",
    "expiry only",
    "userId selector",
    "bulk token",
    "bulk userId",
  ] as const)(
    "keeps %s writes outside refresh-intent normalization",
    async (scenario) => {
      const fixture = makeFixture();
      const account = await fixture.createAccount();
      const other = await fixture.createAccount();
      const { adapter } = await fixture.auth.$context;
      const firstDate = new Date("2030-01-01T00:00:00.000Z");
      const nextDate = new Date("2030-01-01T00:00:01.000Z");
      const bulk = scenario === "bulk token" || scenario === "bulk userId";
      const byUser =
        scenario === "userId selector" || scenario === "bulk userId";
      const where = [
        {
          field: byUser ? "userId" : "token",
          value: byUser ? account.userId : account.session.token,
        },
      ];
      let firstUpdate: Record<string, unknown> = {
        expiresAt: firstDate,
        updatedAt: firstDate,
      };
      let secondUpdate: Record<string, unknown> = {
        expiresAt: scenario === "changed token" ? firstDate : nextDate,
        updatedAt: scenario === "changed token" ? firstDate : nextDate,
      };
      if (scenario === "active organization") {
        firstUpdate = { activeOrganizationId: "synthetic-first-household" };
        secondUpdate = { activeOrganizationId: "synthetic-second-household" };
      }
      if (scenario === "extra active organization field") {
        firstUpdate["activeOrganizationId"] = null;
        secondUpdate["activeOrganizationId"] = null;
      }
      if (scenario === "expiry only") {
        firstUpdate = { expiresAt: firstDate };
        secondUpdate = { expiresAt: nextDate };
      }
      if (bulk) {
        await adapter.updateMany({
          model: "session",
          update: firstUpdate,
          where,
        });
        await adapter.updateMany({
          model: "session",
          update: secondUpdate,
          where,
        });
      } else {
        await adapter.update({ model: "session", update: firstUpdate, where });
        await adapter.update({
          model: "session",
          update: secondUpdate,
          where:
            scenario === "changed token"
              ? [{ field: "token", value: other.session.token }]
              : where,
        });
      }
      expect(fixture.observations).toHaveLength(2);
      expect(fixture.observations[0]?.intentKey).toEqual(expect.any(String));
      expect(fixture.observations[1]?.intentKey).not.toBe(
        fixture.observations[0]?.intentKey
      );
    }
  );
});
