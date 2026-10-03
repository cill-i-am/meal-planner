import { randomBytes, randomUUID } from "node:crypto";

import { BrowserObservabilityApi } from "@meal-planner/browser-observability-api";
import {
  CreateFamily,
  makeFamilyApiClientLayer,
  FamilyApiClient,
} from "@meal-planner/families";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { createAuthClient } from "better-auth/client";
import { Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { afterAll as restoreAfterAll, expect, vi } from "vitest";

import Stack from "../../../../alchemy.run.js";
import { HealthResponse } from "../features/health/health.model.js";

const stage = `test_native_${randomUUID().slice(0, 8)}`;
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

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  stage,
  state: Alchemy.localState(),
});
const stack = beforeAll(deploy(Stack), { timeout: 1_200_000 });
afterAll(destroy(Stack), { timeout: 120_000 });

test(
  "boots the production graph locally with migrations, routing and native bindings",
  Effect.gen(function* checkNativeStack() {
    const output = yield* stack;
    if (!output.apiUrl || !output.websiteUrl) {
      return yield* Effect.die("Local stack did not expose its URLs");
    }
    expect(new URL(output.apiUrl).hostname).toMatch(
      /^(?:localhost|127\.0\.0\.1)$/u
    );
    expect(new URL(output.websiteUrl).hostname).toMatch(
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
    const page = yield* Test.getWhenReady(`${output.websiteUrl}/signup`);
    expect(page.status).toBe(200);
    expect(yield* page.text).toContain("<!DOCTYPE html>");
  })
);

test(
  "creates and reads a household through the native Website, auth D1 and Durable Object",
  Effect.gen(function* createNativeHousehold() {
    const { websiteUrl } = yield* stack;
    if (!websiteUrl) {
      return yield* Effect.die("Local Website URL is absent");
    }
    let cookie = "";
    const auth = createAuthClient({
      baseURL: websiteUrl,
      fetchOptions: {
        headers: { origin: websiteUrl },
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
          baseUrl: websiteUrl,
          headers: { cookie, origin: websiteUrl },
        })
      )
    );
  })
);

restoreAfterAll(() => vi.unstubAllEnvs());

test(
  "accepts typed browser reports through the Website and rejects cross-origin reports",
  Effect.gen(function* checkBrowserTelemetry() {
    const { websiteUrl } = yield* stack;
    if (!websiteUrl) {
      return yield* Effect.die("Local Website URL is absent");
    }
    const client = yield* HttpApiClient.make(BrowserObservabilityApi, {
      baseUrl: websiteUrl,
      transformClient: (transport) =>
        transport.pipe(
          HttpClient.mapRequest(
            HttpClientRequest.setHeader("origin", websiteUrl)
          )
        ),
    });
    const result = yield* client.browserEvents.record({
      payload: {
        event: {
          area: "recipes",
          durationMs: 42,
          kind: "api",
          method: "POST",
          operation: "recipe-import-intents",
          outcome: "success",
          requestId: randomUUID(),
          status: 201,
        },
      },
      responseMode: "response-only",
    });
    expect(result.status).toBe(204);
    expect(result.headers["x-request-id"]).toBeDefined();
    const http = yield* HttpClient.HttpClient;
    const rejected = yield* http.post(`${websiteUrl}/v1/browser-events`, {
      headers: { origin: "https://other.test" },
    });
    expect(rejected.status).toBe(403);
    const statuses: number[] = [];
    for (let index = 0; index < 60; index += 1) {
      const reported = yield* client.browserEvents.record({
        payload: { event: { area: "home", durationMs: 1, kind: "navigation" } },
        responseMode: "response-only",
      });
      statuses.push(reported.status);
    }
    expect(statuses.slice(0, 59)).toEqual(
      Array.from({ length: 59 }, () => 204)
    );
    expect(statuses[59]).toBe(429);
  }).pipe(Effect.provide(FetchHttpClient.layer))
);
