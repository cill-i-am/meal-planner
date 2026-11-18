import { randomBytes, randomUUID } from "node:crypto";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import {
  CreateFamily,
  makeFamilyApiClientLayer,
  FamilyApiClient,
} from "@meal-planner/families";
import { createAuthClient } from "better-auth/client";
import { Effect, Schema } from "effect";
import { afterAll as restoreAfterAll, expect, vi } from "vitest";

import Stack from "../../../../alchemy.run.js";
import { HealthResponse } from "../features/health/health.model.js";

const stage = `test_native_${randomUUID().slice(0, 8)}`;
vi.stubEnv("ALCHEMY_DEV", "true");
vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
vi.stubEnv(
  "MEAL_PLANNER_IMPORT_API_TOKEN",
  randomBytes(48).toString("base64url")
);
vi.stubEnv("MEAL_PLANNER_IMPORT_ACTOR_ID", randomBytes(32).toString("hex"));
vi.stubEnv(
  "MEAL_PLANNER_IMPORT_HOUSEHOLD_SCOPE_ID",
  randomBytes(32).toString("hex")
);
vi.stubEnv("MEAL_PLANNER_PRIVATE_DISCOVERY_CONFIG", "");
vi.stubEnv("MEAL_PLANNER_EMAIL_DELIVERY_ENABLED", "true");
vi.stubEnv("MEAL_PLANNER_PUBLIC_ORIGIN", "");

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  stage,
});
const stack = beforeAll(deploy(Stack), { timeout: 1_200_000 });
afterAll(destroy(Stack), { timeout: 120_000 });

test(
  "boots the production graph locally with migrations, routing and native bindings",
  Effect.gen(function* checkNativeStack() {
    const output = yield* stack;
    if (!output.apiUrl || !output.gatewayUrl) {
      return yield* Effect.die("Local stack did not expose its URLs");
    }
    expect(new URL(output.apiUrl).hostname).toMatch(
      /^(?:localhost|127\.0\.0\.1)$/u
    );
    expect(new URL(output.gatewayUrl).hostname).toMatch(
      /^(?:localhost|127\.0\.0\.1)$/u
    );
    const response = yield* Test.getWhenReady(`${output.apiUrl}/health`);
    expect(response.headers["x-request-id"]).toMatch(
      /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/u
    );
    const health = yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(HealthResponse))
    );
    expect(health.ok).toBe(true);
    const discovery = yield* Test.getWhenReady(
      `${output.apiUrl}/.well-known/oauth-protected-resource/v1`
    );
    expect(discovery.status).toBe(200);
    expect(yield* discovery.json).toMatchObject({
      authorization_servers: ["http://localhost:4399/api/auth"],
      resource: "http://localhost:4399/v1",
    });
    const page = yield* Test.getWhenReady(`${output.gatewayUrl}/signup`);
    expect(page.status).toBe(200);
    expect(yield* page.text).toContain("<!DOCTYPE html>");
  }),
  // A fresh CI runner builds the real media image before the API can serve.
  // Local runs may start without the image layers that CI prepares first.
  { timeout: 600_000 }
);

test(
  "creates and reads a household through the public gateway, auth D1 and Durable Object",
  Effect.gen(function* createNativeHousehold() {
    const { gatewayUrl } = yield* stack;
    if (!gatewayUrl) {
      return yield* Effect.die("Local gateway URL is absent");
    }
    let cookie = "";
    const auth = createAuthClient({
      baseURL: gatewayUrl,
      fetchOptions: {
        headers: { origin: gatewayUrl },
        onResponse: ({ response }) => {
          cookie = response.headers
            .getSetCookie()
            .map((header) => header.split(";")[0])
            .join("; ");
        },
      },
    });
    const signup = yield* Effect.promise(() =>
      auth.signUp.email({
        email: `native-${randomUUID()}@example.test`,
        name: "Local native tester",
        password: randomBytes(24).toString("base64url"),
      })
    );
    expect(signup.error).toBeNull();
    if (!cookie) {
      return yield* Effect.die("Signup did not set a session cookie");
    }
    yield* Effect.gen(function* exerciseFamilyClient() {
      const client = yield* FamilyApiClient;
      const command = yield* Schema.decodeUnknownEffect(CreateFamily)({
        mutationId: randomUUID(),
        name: "Native local family",
      });
      const family = yield* client.families.create({ payload: command });
      const replay = yield* client.families.create({ payload: command });
      const saved = yield* client.families.get({
        params: { familyId: family.id },
      });
      expect(replay.id).toBe(family.id);
      expect(saved.name).toBe("Native local family");
      expect(saved.version).toBe(family.version);
    }).pipe(
      Effect.provide(
        makeFamilyApiClientLayer({
          baseUrl: gatewayUrl,
          headers: { cookie, origin: gatewayUrl },
        })
      )
    );
  })
);

restoreAfterAll(() => vi.unstubAllEnvs());
