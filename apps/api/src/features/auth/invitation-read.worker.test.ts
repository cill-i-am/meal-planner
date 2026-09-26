import { applyD1Migrations, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { HttpRouter } from "effect/unstable/http";
import { beforeAll, expect, it } from "vitest";

import * as authSchema from "./auth.database-schema.js";
import { makeMealPlannerAuth } from "./auth.js";
import { makeNativeAuthTestService } from "./auth.test-fixture.js";
import { invitationReadHttpApiLayer } from "./invitation-read.js";

const testEnv = env as unknown as {
  readonly AUTH_TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
  readonly MealPlannerAuthDatabase: AnyD1Database;
};
const baseURL = "https://meal-planner.test";

const cookieHeader = (response: Response) => {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) {
    throw new Error("Expected a session cookie");
  }
  return cookie;
};

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerAuthDatabase,
    testEnv.AUTH_TEST_MIGRATIONS
  );
});

it("reads only the recipient's invitation through the typed HTTP route", async () => {
  const auth = makeMealPlannerAuth({
    baseURL,
    database: drizzle(testEnv.MealPlannerAuthDatabase),
    outputFence: (_input, canonical) => canonical(),
    schema: authSchema,
    secret: "local-worker-test-secret-at-least-32-characters",
  });
  const postAuth = (path: string, body: object, cookie?: string) => {
    const headers = new Headers({
      "content-type": "application/json",
      origin: baseURL,
    });
    if (cookie) {
      headers.set("cookie", cookie);
    }
    return auth.fetch(
      new Request(`${baseURL}/api/auth${path}`, {
        body: JSON.stringify(body),
        headers,
        method: "POST",
      })
    );
  };
  const owner = await postAuth("/sign-up/email", {
    email: "read-owner@example.test",
    name: "Owner",
    password: "local-test-password-only",
  });
  const ownerCookie = cookieHeader(owner);
  const family = await postAuth(
    "/organization/create",
    { name: "Read family", slug: "read-family" },
    ownerCookie
  );
  const familyId = ((await family.json()) as { id: string }).id;
  const created = await postAuth(
    "/organization/invite-member",
    {
      email: "read-recipient@example.test",
      organizationId: familyId,
      role: "member",
    },
    ownerCookie
  );
  const invitationId = ((await created.json()) as { id: string }).id;
  const recipient = await postAuth("/sign-up/email", {
    email: "read-recipient@example.test",
    name: "Recipient",
    password: "local-test-password-only",
  });
  const recipientCookie = cookieHeader(recipient);
  const recipientId = ((await recipient.json()) as { user: { id: string } })
    .user.id;
  const app = HttpRouter.toWebHandler(
    invitationReadHttpApiLayer(makeNativeAuthTestService(auth)),
    { disableLogger: true }
  );
  const read = (cookie?: string, userId?: string) => {
    const headers = new Headers({ "cf-connecting-ip": "192.0.2.20" });
    if (cookie) {
      headers.set("cookie", cookie);
    }
    if (userId) {
      headers.set("x-meal-planner-user", userId);
    }
    return app.handler(
      new Request(`${baseURL}/v1/setup/invitation/${invitationId}`, {
        headers,
      })
    );
  };
  try {
    const anonymous = await read();
    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toMatchObject({
      _tag: "InvitationReadUnauthorized",
    });
    const wrong = await read(ownerCookie);
    expect(wrong.status).toBe(403);
    expect(await wrong.text()).not.toContain("read-recipient@example.test");
    const mismatchedAccount = await read(recipientCookie, "another-user");
    expect(mismatchedAccount.status).toBe(401);
    await drizzle(testEnv.MealPlannerAuthDatabase)
      .update(authSchema.session)
      .set({ expiresAt: new Date(Date.now() + 86_400_000) })
      .where(eq(authSchema.session.userId, recipientId));
    const pending = await read(recipientCookie);
    expect(pending.status).toBe(200);
    expect(pending.headers.get("cache-control")).toBe("no-store");
    expect(pending.headers.get("set-cookie")).not.toBeNull();
    await expect(pending.json()).resolves.toMatchObject({
      familyName: "Read family",
      id: invitationId,
      status: "pending",
    });
    await drizzle(testEnv.MealPlannerAuthDatabase)
      .update(authSchema.invitation)
      .set({ expiresAt: new Date(0) })
      .where(eq(authSchema.invitation.id, invitationId));
    const expired = await read(recipientCookie);
    expect(expired.status).toBe(200);
    await expect(expired.json()).resolves.toMatchObject({ status: "expired" });
    await drizzle(testEnv.MealPlannerAuthDatabase)
      .update(authSchema.invitation)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(eq(authSchema.invitation.id, invitationId));
    const accepted = await postAuth(
      "/organization/accept-invitation",
      { invitationId },
      recipientCookie
    );
    expect(accepted.status).toBe(200);
    const closed = await read(recipientCookie);
    expect(closed.status).toBe(200);
    await expect(closed.json()).resolves.toMatchObject({ status: "accepted" });
    const context = await auth.$context;
    await context.adapter.update({
      model: "rateLimit",
      update: { count: context.rateLimit.max - 1, lastRequest: Date.now() },
      where: [
        {
          field: "key",
          value: `192.0.2.20|/setup/invitation/${invitationId}`,
        },
      ],
    });
    const nativeRead = () =>
      auth.fetch(
        new Request(`${baseURL}/api/auth/setup/invitation/${invitationId}`, {
          headers: {
            "cf-connecting-ip": "192.0.2.20",
            cookie: recipientCookie,
          },
        })
      );
    const lastAllowed = await nativeRead();
    expect(lastAllowed.status).toBe(200);
    const limited = await read(recipientCookie);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("x-retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    await expect(limited.json()).resolves.toMatchObject({
      _tag: "InvitationReadRateLimited",
    });
    const nativeLimited = await nativeRead();
    expect(nativeLimited.status).toBe(429);
  } finally {
    await app.dispose();
  }
});
