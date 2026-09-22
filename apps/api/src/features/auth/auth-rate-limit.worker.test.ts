import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";

import * as authSchema from "./auth.database-schema.js";
import { makeMealPlannerAuth } from "./auth.js";

const testEnv = env as unknown as {
  readonly AUTH_TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
  readonly MealPlannerAuthDatabase: AnyD1Database;
};
const baseURL = "https://rate-limit.example.test";
const makeAuth = () =>
  makeMealPlannerAuth({
    baseURL,
    database: drizzle(testEnv.MealPlannerAuthDatabase),
    outputFence: (_input, canonical) => canonical(),
    schema: authSchema,
    secret: "local-rate-limit-fixture-secret-at-least-32-characters",
  });

// Invalid bodies exercise the real limiter without creating users or hashing passwords.
const signIn = (headers: HeadersInit) =>
  new Request(`${baseURL}/api/auth/sign-in/email`, {
    body: JSON.stringify({}),
    headers: {
      ...Object.fromEntries(new Headers(headers)),
      "content-type": "application/json",
      origin: baseURL,
    },
    method: "POST",
  });

describe("Better Auth shared D1 rate limiting", () => {
  beforeAll(async () => {
    await applyD1Migrations(
      testEnv.MealPlannerAuthDatabase,
      testEnv.AUTH_TEST_MIGRATIONS
    );
  });

  it("atomically admits only three concurrent sign-ins across fresh auth instances", async () => {
    const auth = makeAuth();
    const context = await auth.$context;
    expect(context.rateLimit.enabled).toBe(true);
    expect(context.rateLimit.storage).toBe("database");
    const responses = await Promise.all(
      Array.from({ length: 16 }, () =>
        makeAuth().fetch(signIn({ "cf-connecting-ip": "192.0.2.31" }))
      )
    );
    expect(
      responses.filter((response) => response.status === 400)
    ).toHaveLength(3);
    const limited = responses.filter((response) => response.status === 429);
    expect(limited).toHaveLength(13);
    for (const response of limited) {
      expect(Number(response.headers.get("x-retry-after"))).toBeGreaterThan(0);
    }
    const [row] = await context.adapter.findMany<{ count: number }>({
      model: "rateLimit",
      where: [{ field: "key", value: "192.0.2.31|/sign-in/email" }],
    });
    expect(row?.count).toBe(3);

    // Expiry is persisted in D1, so a reconstructed instance can admit a new window.
    await context.adapter.update({
      model: "rateLimit",
      update: { lastRequest: 0 },
      where: [{ field: "key", value: "192.0.2.31|/sign-in/email" }],
    });
    const afterExpiry = await makeAuth().fetch(
      signIn({ "cf-connecting-ip": "192.0.2.31" })
    );
    expect(afterExpiry.status).toBe(400);
  });

  it("uses Cloudflare's client address instead of attacker-controlled forwarding headers", async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, attempt) =>
        makeAuth().fetch(
          signIn({
            "cf-connecting-ip": "192.0.2.32",
            "x-forwarded-for": `198.51.100.${attempt + 1}, 203.0.113.1`,
            "x-real-ip": `198.51.100.${attempt + 1}`,
          })
        )
      )
    );
    expect(responses.map((response) => response.status).toSorted()).toEqual([
      400, 400, 400, 429,
    ]);
    const otherClient = await makeAuth().fetch(
      signIn({ "cf-connecting-ip": "192.0.2.33" })
    );
    expect(otherClient.status).toBe(400);
  });

  it("does not trust spoofed forwarding headers when Cloudflare's address is absent", async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, attempt) =>
        makeAuth().fetch(
          signIn({ "x-forwarded-for": `198.51.100.${attempt + 10}` })
        )
      )
    );
    expect(responses.map((response) => response.status).toSorted()).toEqual([
      400, 400, 400, 429,
    ]);
  });
});
