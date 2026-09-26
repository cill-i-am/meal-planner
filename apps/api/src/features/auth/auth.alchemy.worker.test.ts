import { BetterAuthApiError } from "@alchemy.run/better-auth";
import { it } from "@effect/vitest";
import { RuntimeContext } from "alchemy";
import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { Effect, Fiber, Redacted } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { beforeAll, beforeEach, describe, expect } from "vitest";

import { PrivateOutputUnavailable } from "../private-output/private-output.contract.js";
import { makeAlchemyMealPlannerAuth } from "./auth.alchemy.js";
import type { MealPlannerAuthService } from "./auth.alchemy.js";
import * as authSchema from "./auth.database-schema.js";
import type { MealPlannerAuthOptions } from "./auth.js";

const testEnv = env as unknown as {
  readonly AUTH_TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
  readonly MealPlannerAuthDatabase: AnyD1Database;
};
const baseURL = "https://meal-planner.test";
const testRuntimeContext = RuntimeContext.of({
  Type: "AuthAlchemyTestRuntimeContext",
  env: {},
  get: <T>() =>
    // eslint-disable-next-line unicorn/no-useless-undefined -- Alchemy represents an absent runtime binding with undefined.
    Effect.succeed<T | undefined>(undefined),
  id: "auth-alchemy-test",
  set: (id) => Effect.succeed(id),
});
const makeAuth = (
  overrides: Partial<
    Pick<MealPlannerAuthOptions, "outputFence" | "sendPasswordResetEmail">
  > = {}
) =>
  makeAlchemyMealPlannerAuth({
    baseURL,
    database: drizzle(testEnv.MealPlannerAuthDatabase),
    outputFence: (_input, canonical) => canonical(),
    schema: authSchema,
    secret: Redacted.make("local-alchemy-test-secret-at-least-32-characters"),
    ...overrides,
  });

const authRequest = (
  path: string,
  body: Record<string, unknown>,
  headers?: Headers
) => {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("content-type", "application/json");
  requestHeaders.set("origin", baseURL);
  requestHeaders.set("cf-connecting-ip", "192.0.2.81");
  return new Request(`${baseURL}/api/auth${path}`, {
    body: JSON.stringify(body),
    headers: requestHeaders,
    method: "POST",
  });
};

const createAccount = (auth: MealPlannerAuthService) =>
  Effect.gen(function* createSyntheticAccount() {
    const email = `${crypto.randomUUID()}@example.test`;
    const response = HttpServerResponse.toWeb(
      yield* auth.fetchHttpEffect(
        authRequest("/sign-up/email", {
          email,
          name: "Synthetic Alchemy participant",
          password: "local synthetic Alchemy password",
        })
      )
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie");
    if (cookie === null) {
      throw new Error("Expected a synthetic account session cookie.");
    }
    return {
      email,
      headers: new Headers({ cookie: cookie.split(";", 1)[0] ?? "" }),
    };
  });

describe("Alchemy Better Auth on D1", () => {
  beforeAll(async () => {
    await applyD1Migrations(
      testEnv.MealPlannerAuthDatabase,
      testEnv.AUTH_TEST_MIGRATIONS
    );
  });

  beforeEach(async () => {
    await drizzle(testEnv.MealPlannerAuthDatabase).delete(authSchema.rateLimit);
  });

  it.live(
    "reports an unauthenticated API failure in the Effect error channel",
    () =>
      Effect.gen(function* typedApiFailure() {
        const auth = yield* makeAuth();
        const error = yield* auth.api
          .getActiveMember({ headers: new Headers() })
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(BetterAuthApiError);
        expect(error.statusCode).toBe(401);
      }).pipe(
        Effect.scoped,
        Effect.provideService(RuntimeContext, testRuntimeContext)
      )
  );

  it.live(
    "keeps the session when the HTTP account guard or revocation fence rejects",
    () =>
      Effect.gen(function* rejectAccountAndFence() {
        let rejectMutations = false;
        let fenceAttempts = 0;
        const auth = yield* makeAuth({
          outputFence: (_input, canonical) => {
            fenceAttempts += 1;
            return rejectMutations
              ? Promise.reject(
                  new PrivateOutputUnavailable({
                    reason: "authority_unavailable",
                  })
                )
              : canonical();
          },
        });
        const account = yield* createAccount(auth);
        const initialFenceAttempts = fenceAttempts;
        const wrongAccountHeaders = new Headers(account.headers);
        wrongAccountHeaders.set("x-meal-planner-user", crypto.randomUUID());
        const mismatch = HttpServerResponse.toWeb(
          yield* auth.fetchHttpEffect(
            authRequest("/sign-out", {}, wrongAccountHeaders)
          )
        );
        expect(mismatch.status).toBe(401);
        expect(yield* Effect.promise(() => mismatch.json())).toMatchObject({
          code: "ACCOUNT_CHANGED",
        });
        expect(fenceAttempts).toBe(initialFenceAttempts);

        rejectMutations = true;
        const rejected = yield* auth.fetchHttpEffect(
          authRequest("/sign-out", {}, account.headers)
        );
        expect(rejected.status).toBe(503);
        expect(fenceAttempts).toBe(initialFenceAttempts + 1);
        const session = yield* auth.api.getSession({
          headers: account.headers,
          query: { disableRefresh: true },
        });
        expect(session?.user.email).toBe(account.email);
      }).pipe(
        Effect.scoped,
        Effect.provideService(RuntimeContext, testRuntimeContext)
      )
  );

  it.live(
    "drains password-reset background mail before the execution scope closes",
    () =>
      Effect.gen(function* drainBackgroundMail() {
        const releaseMail = Promise.withResolvers<null>();
        const responseReady = Promise.withResolvers<null>();
        let mailStarted = false;
        let executionSettled = false;
        const execution = yield* Effect.gen(function* requestPasswordReset() {
          const auth = yield* makeAuth({
            sendPasswordResetEmail: async () => {
              mailStarted = true;
              await releaseMail.promise;
            },
          });
          const account = yield* createAccount(auth);
          const response = yield* auth.fetchHttpEffect(
            authRequest("/request-password-reset", { email: account.email })
          );
          expect(response.status).toBe(200);
          responseReady.resolve(null);
        }).pipe(
          Effect.scoped,
          Effect.tap(() => {
            executionSettled = true;
            return Effect.void;
          }),
          Effect.forkChild
        );
        yield* Effect.gen(function* checkPendingExecution() {
          yield* Effect.raceFirst(
            Fiber.join(execution),
            Effect.promise(() => responseReady.promise)
          );
          expect(mailStarted).toBe(true);
          expect(executionSettled).toBe(false);
        }).pipe(Effect.ensuring(Effect.sync(() => releaseMail.resolve(null))));
        yield* Fiber.join(execution);
        expect(executionSettled).toBe(true);
      }).pipe(Effect.provideService(RuntimeContext, testRuntimeContext))
  );
});
