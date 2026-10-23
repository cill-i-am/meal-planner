import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { applyD1Migrations, env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { Effect, Redacted, Schema } from "effect";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  privateOutputKey,
  PrivateOutputUnavailable,
} from "../private-output/private-output.contract.js";
import type { AuthOutputFence } from "./auth-output-fence.js";
import * as authSchema from "./auth.database-schema.js";
import { makeMealPlannerAuth } from "./auth.js";
import type { MealPlannerAuth } from "./auth.js";
import { resolveAuthenticatedOrganization } from "./auth.principal.js";
import { makeNativeAuthTestService } from "./auth.test-fixture.js";
import { DelegatedAccess } from "./delegated-access.js";

const testEnv = env as unknown as {
  readonly AUTH_TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
  readonly MealPlannerAuthDatabase: AnyD1Database;
};
const baseURL = "https://delegation.example.test";
const resource = `${baseURL}/mcp`;
const redirectUri = "https://client.example.test/oauth/callback";
const readScopes = ["meal-planner:read"];
const requestedScope = "meal-planner:read offline_access";
const database = () => drizzle(testEnv.MealPlannerAuthDatabase);
const makeAuth = () =>
  makeMealPlannerAuth({
    baseURL,
    database: database(),
    outputFence: (_input, canonical) => canonical(),
    schema: authSchema,
    secret: "local-delegated-auth-fixture-secret-at-least-32-characters",
  });
const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.String,
  scope: Schema.String,
  token_type: Schema.String,
});
const post = (path: string, body: Record<string, unknown>, cookie?: string) => {
  const headers = new Headers({
    "cf-connecting-ip": "192.0.2.81",
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
const postForm = (path: string, body: Record<string, string>) =>
  new Request(`${baseURL}/api/auth${path}`, {
    body: new URLSearchParams(body),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
const createAccount = async (auth: MealPlannerAuth) => {
  const response = await auth.fetch(
    post("/sign-up/email", {
      email: `${crypto.randomUUID()}@example.test`,
      name: "Delegation fixture",
      password: "local-worker-password-only",
    })
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (cookie === undefined) {
    throw new Error("Expected native session cookie.");
  }
  const session = await auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  if (session === null) {
    throw new Error("Expected native session.");
  }
  return {
    cookie,
    email: session.user.email,
    sessionId: session.session.id,
    userId: session.user.id,
  };
};
const createFamily = async (auth: MealPlannerAuth, cookie: string) =>
  Schema.decodeUnknownSync(Schema.Struct({ id: HouseholdOrganizationId }))(
    await auth.api.createOrganization({
      body: { name: "Delegation family", slug: crypto.randomUUID() },
      headers: new Headers({ cookie }),
    })
  );
const registerClient = async (
  auth: MealPlannerAuth,
  scope = requestedScope,
  cookie?: string
) => {
  const response = await auth.fetch(
    post(
      "/oauth2/register",
      {
        client_name: "Delegation worker fixture",
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: [redirectUri],
        response_types: ["code"],
        scope,
        token_endpoint_auth_method: "none",
      },
      cookie
    )
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return Schema.decodeUnknownSync(Schema.Struct({ client_id: Schema.String }))(
    await response.json()
  ).client_id;
};
const authorizeCode = async (
  auth: MealPlannerAuth,
  cookie: string,
  clientId: string,
  scope = requestedScope
) => {
  const verifier =
    crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  );
  const challenge = btoa(String.fromCodePoint(...digest))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const state = crypto.randomUUID();
  const query = new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "consent",
    redirect_uri: redirectUri,
    resource,
    response_type: "code",
    scope,
    state,
  });
  const authorization = await auth.fetch(
    new Request(`${baseURL}/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie },
    })
  );
  expect(authorization.status, await authorization.clone().text()).toBe(302);
  const location = authorization.headers.get("location");
  if (location === null) {
    throw new Error("Expected consent redirect.");
  }
  const consentPage = new URL(location, baseURL);
  expect(consentPage.pathname).toBe("/oauth/consent");
  const consent = await auth.fetch(
    post(
      "/oauth2/consent",
      {
        accept: true,
        oauth_query: consentPage.search.slice(1),
      },
      cookie
    )
  );
  expect(consent.status, await consent.clone().text()).toBe(200);
  const approved = Schema.decodeUnknownSync(
    Schema.Struct({ url: Schema.String })
  )(await consent.json());
  const callback = new URL(approved.url);
  expect(callback.origin + callback.pathname).toBe(redirectUri);
  expect(callback.searchParams.get("state")).toBe(state);
  const code = callback.searchParams.get("code");
  if (code === null) {
    throw new Error(`Expected authorization code: ${callback.search}`);
  }
  return { clientId, code, verifier };
};
type AuthorizationCode = Awaited<ReturnType<typeof authorizeCode>>;
const exchange = (auth: MealPlannerAuth, authorization: AuthorizationCode) =>
  auth.fetch(
    postForm("/oauth2/token", {
      client_id: authorization.clientId,
      code: authorization.code,
      code_verifier: authorization.verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      resource,
    })
  );
const issueTokens = async (
  auth: MealPlannerAuth,
  cookie: string,
  scope = requestedScope
) => {
  const clientId = await registerClient(auth, scope);
  const authorization = await authorizeCode(auth, cookie, clientId, scope);
  const response = await exchange(auth, authorization);
  expect(response.status, await response.clone().text()).toBe(200);
  return {
    ...authorization,
    ...Schema.decodeUnknownSync(TokenResponse)(await response.json()),
  };
};
const delegatedRequest = (
  token: string,
  organizationId?: string,
  userId?: string
) => {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  if (organizationId !== undefined) {
    headers.set("x-meal-planner-household", organizationId);
  }
  if (userId !== undefined) {
    headers.set("x-meal-planner-user", userId);
  }
  return new Request(resource, { headers });
};
const resolveFamily = (auth: MealPlannerAuth, request: Request) => {
  const service = makeNativeAuthTestService(auth);
  return service.withDelegatedAccess(
    request,
    resource,
    readScopes,
    resolveAuthenticatedOrganization({
      auth: service,
      headers: request.headers,
    })
  );
};

describe("native OAuth delegated access", () => {
  beforeAll(() =>
    applyD1Migrations(
      testEnv.MealPlannerAuthDatabase,
      testEnv.AUTH_TEST_MIGRATIONS
    )
  );
  beforeEach(async () => {
    await database().delete(authSchema.rateLimit);
  });

  it("registers a public client, requires consent and S256, and exchanges a code only once", async () => {
    const auth = makeAuth();
    const account = await createAccount(auth);
    const clientId = await registerClient(auth);
    const withoutPkce = await auth.fetch(
      new Request(
        `${baseURL}/api/auth/oauth2/authorize?${new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          resource,
          response_type: "code",
          scope: requestedScope,
        })}`,
        { headers: { cookie: account.cookie } }
      )
    );
    expect(withoutPkce.status).toBe(302);
    const errorRedirect = withoutPkce.headers.get("location");
    if (errorRedirect === null) {
      throw new Error("Expected PKCE rejection redirect.");
    }
    expect(new URL(errorRedirect).searchParams.get("error")).toBe(
      "invalid_request"
    );
    const invalidCode = await authorizeCode(auth, account.cookie, clientId);
    const wrongVerifier = await exchange(auth, {
      ...invalidCode,
      verifier: "x".repeat(64),
    });
    expect(wrongVerifier.status).toBe(400);
    expect(await wrongVerifier.json()).toMatchObject({
      error: "invalid_grant",
    });
    const authorization = await authorizeCode(auth, account.cookie, clientId);
    const request = postForm("/oauth2/token", {
      client_id: authorization.clientId,
      code: authorization.code,
      code_verifier: authorization.verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      resource,
    });
    request.headers.set("content-type", "Application/X-WWW-Form-Urlencoded");
    const exchanged = await auth.fetch(request);
    expect(exchanged.status, await exchanged.clone().text()).toBe(200);
    const tokens = Schema.decodeUnknownSync(TokenResponse)(
      await exchanged.json()
    );
    expect(tokens.scope.split(" ").toSorted()).toEqual(
      requestedScope.split(" ").toSorted()
    );
    expect(tokens.token_type.toLowerCase()).toBe("bearer");
    expect(tokens.expires_in).toBe(900);
    const replay = await exchange(auth, authorization);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("admits the token's user and requested family without changing the browser's active family", async () => {
    const auth = makeAuth();
    const account = await createAccount(auth);
    const selected = await createFamily(auth, account.cookie);
    const browserActive = await createFamily(auth, account.cookie);
    const tokens = await issueTokens(auth, account.cookie);
    const result = await Effect.runPromise(
      resolveFamily(
        auth,
        delegatedRequest(tokens.access_token, selected.id, account.userId)
      )
    );
    expect(result).toEqual({
      membershipRole: "owner",
      organizationId: selected.id,
      userId: account.userId,
    });
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: account.cookie }),
    });
    expect(session?.session.activeOrganizationId).toBe(browserActive.id);
    const grant = await Effect.runPromise(
      makeNativeAuthTestService(auth).withDelegatedAccess(
        delegatedRequest(tokens.access_token),
        resource,
        readScopes,
        DelegatedAccess
      )
    );
    expect(Redacted.isRedacted(grant?.token)).toBe(true);
    expect(Redacted.isRedacted(grant?.session.token)).toBe(true);
    expect(JSON.stringify(grant)).not.toContain(tokens.access_token);
    expect(JSON.stringify(grant)).not.toContain(session?.session.token);
    const missingSelection = await Effect.runPromise(
      resolveFamily(auth, delegatedRequest(tokens.access_token)).pipe(
        Effect.flip
      )
    );
    expect(missingSelection).toMatchObject({
      reason: "missing_active_household",
    });
  });

  it("checks bearer syntax, scope and resource before executing an operation", async () => {
    const auth = makeAuth();
    const account = await createAccount(auth);
    const tokens = await issueTokens(auth, account.cookie);
    const service = makeNativeAuthTestService(auth);
    let executions = 0;
    const operation = Effect.sync(() => {
      executions += 1;
      return "admitted";
    });
    const request = delegatedRequest(tokens.access_token);
    const deniedScope = await Effect.runPromise(
      service
        .withDelegatedAccess(
          request,
          resource,
          ["meal-planner:write"],
          operation
        )
        .pipe(Effect.flip)
    );
    expect(deniedScope).toMatchObject({
      reason: "insufficient_scope",
      statusCode: 403,
    });
    const deniedAudience = await Effect.runPromise(
      service
        .withDelegatedAccess(request, `${baseURL}/v1`, readScopes, operation)
        .pipe(Effect.flip)
    );
    expect(deniedAudience).toMatchObject({
      reason: "invalid_token",
      statusCode: 401,
    });
    const invalidHeaders = [
      { cookie: account.cookie },
      { authorization: "Bearer invalid token" },
      { authorization: "Bearer unknown-token" },
      { authorization: "Basic synthetic" },
    ];
    const invalidErrors = await Promise.all(
      invalidHeaders.map((headers) =>
        Effect.runPromise(
          service
            .withDelegatedAccess(
              new Request(resource, { headers }),
              resource,
              readScopes,
              operation
            )
            .pipe(Effect.flip)
        )
      )
    );
    for (const error of invalidErrors) {
      expect(error).toMatchObject({ reason: "invalid_token", statusCode: 401 });
    }
    expect(executions).toBe(0);
    await expect(
      Effect.runPromise(
        service.withDelegatedAccess(request, resource, readScopes, operation)
      )
    ).resolves.toBe("admitted");
    expect(executions).toBe(1);
  });

  it("expires persisted access tokens, refreshes them natively, and rejects revoked tokens", async () => {
    const auth = makeAuth();
    const account = await createAccount(auth);
    const tokens = await issueTokens(auth, account.cookie);
    const service = makeNativeAuthTestService(auth);
    await database()
      .update(authSchema.oauthAccessToken)
      .set({ expiresAt: new Date(0) })
      .where(eq(authSchema.oauthAccessToken.clientId, tokens.clientId));
    const expired = await Effect.runPromise(
      service
        .withDelegatedAccess(
          delegatedRequest(tokens.access_token),
          resource,
          readScopes,
          Effect.succeed("admitted")
        )
        .pipe(Effect.flip)
    );
    expect(expired).toMatchObject({ reason: "invalid_token", statusCode: 401 });
    const refresh = await auth.fetch(
      postForm("/oauth2/token", {
        client_id: tokens.clientId,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        resource,
      })
    );
    expect(refresh.status, await refresh.clone().text()).toBe(200);
    const refreshed = Schema.decodeUnknownSync(TokenResponse)(
      await refresh.json()
    );
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
    const grant = await Effect.runPromise(
      service.withDelegatedAccess(
        delegatedRequest(refreshed.access_token),
        resource,
        readScopes,
        DelegatedAccess
      )
    );
    expect(grant?.user.id).toBe(account.userId);
    const revoked = await auth.fetch(
      postForm("/oauth2/revoke", {
        client_id: tokens.clientId,
        token: refreshed.access_token,
        token_type_hint: "access_token",
      })
    );
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    const denied = await Effect.runPromise(
      service
        .withDelegatedAccess(
          delegatedRequest(refreshed.access_token),
          resource,
          readScopes,
          Effect.succeed("admitted")
        )
        .pipe(Effect.flip)
    );
    expect(denied).toMatchObject({ reason: "invalid_token", statusCode: 401 });
  });

  it("requires a live issuing session and current consent", async () => {
    const auth = makeAuth();
    const account = await createAccount(auth);
    const tokens = await issueTokens(auth, account.cookie);
    const service = makeNativeAuthTestService(auth);
    await database()
      .delete(authSchema.oauthConsent)
      .where(eq(authSchema.oauthConsent.clientId, tokens.clientId));
    const noConsent = await Effect.runPromise(
      service
        .withDelegatedAccess(
          delegatedRequest(tokens.access_token),
          resource,
          readScopes,
          Effect.succeed("admitted")
        )
        .pipe(Effect.flip)
    );
    expect(noConsent).toMatchObject({
      reason: "invalid_token",
      statusCode: 401,
    });
    const renewed = await issueTokens(auth, account.cookie);
    await database()
      .update(authSchema.session)
      .set({ expiresAt: new Date(0) })
      .where(eq(authSchema.session.id, account.sessionId));
    const noSession = await Effect.runPromise(
      service
        .withDelegatedAccess(
          delegatedRequest(renewed.access_token),
          resource,
          readScopes,
          Effect.succeed("admitted")
        )
        .pipe(Effect.flip)
    );
    expect(noSession).toMatchObject({
      reason: "invalid_token",
      statusCode: 401,
    });
  });

  it("isolates simultaneous users, rejects spoofed identities and foreign families, and rechecks membership", async () => {
    const auth = makeAuth();
    const alice = await createAccount(auth);
    const aliceFamily = await createFamily(auth, alice.cookie);
    const bob = await createAccount(auth);
    const bobFamily = await createFamily(auth, bob.cookie);
    const aliceTokens = await issueTokens(auth, alice.cookie);
    const bobTokens = await issueTokens(auth, bob.cookie);
    const aliceRequest = delegatedRequest(
      aliceTokens.access_token,
      aliceFamily.id,
      alice.userId
    );
    const bobRequest = delegatedRequest(
      bobTokens.access_token,
      bobFamily.id,
      bob.userId
    );
    const requests = Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0 ? aliceRequest : bobRequest
    );
    const results = await Effect.runPromise(
      Effect.all(
        requests.map((request) => resolveFamily(auth, request)),
        { concurrency: "unbounded" }
      )
    );
    for (const [index, result] of results.entries()) {
      expect(result).toEqual(
        index % 2 === 0
          ? {
              membershipRole: "owner",
              organizationId: aliceFamily.id,
              userId: alice.userId,
            }
          : {
              membershipRole: "owner",
              organizationId: bobFamily.id,
              userId: bob.userId,
            }
      );
    }
    const spoofed = await Effect.runPromise(
      resolveFamily(
        auth,
        delegatedRequest(aliceTokens.access_token, aliceFamily.id, bob.userId)
      ).pipe(Effect.flip)
    );
    expect(spoofed).toMatchObject({ reason: "invalid_token", statusCode: 401 });
    const foreignFamily = await Effect.runPromise(
      resolveFamily(
        auth,
        delegatedRequest(aliceTokens.access_token, bobFamily.id, alice.userId)
      ).pipe(Effect.flip)
    );
    expect(foreignFamily).toMatchObject({ reason: "missing_membership" });
    await database()
      .delete(authSchema.member)
      .where(
        and(
          eq(authSchema.member.userId, alice.userId),
          eq(authSchema.member.organizationId, aliceFamily.id)
        )
      );
    const removed = await Effect.runPromise(
      resolveFamily(auth, aliceRequest).pipe(Effect.flip)
    );
    expect(removed).toMatchObject({ reason: "missing_membership" });
    const outsideSession = await Effect.runPromise(
      makeNativeAuthTestService(auth).api.getSession({ headers: new Headers() })
    );
    expect(outsideSession).toBeNull();
    expect(await Effect.runPromise(DelegatedAccess)).toBeUndefined();
  });

  it("rechecks revocation and membership while an operation retains its delegated context", async () => {
    const auth = makeAuth();
    const account = await createAccount(auth);
    const family = await createFamily(auth, account.cookie);
    const tokens = await issueTokens(auth, account.cookie);
    const request = delegatedRequest(
      tokens.access_token,
      family.id,
      account.userId
    );
    const service = makeNativeAuthTestService(auth);
    const lostMembership = await Effect.runPromise(
      service.withDelegatedAccess(
        request,
        resource,
        readScopes,
        Effect.gen(function* removeMembershipDuringOperation() {
          const initial = yield* resolveAuthenticatedOrganization({
            auth: service,
            headers: request.headers,
          });
          expect(initial.organizationId).toBe(family.id);
          yield* Effect.promise(() =>
            database()
              .delete(authSchema.member)
              .where(
                and(
                  eq(authSchema.member.userId, account.userId),
                  eq(authSchema.member.organizationId, family.id)
                )
              )
              .run()
          );
          return yield* resolveAuthenticatedOrganization({
            auth: service,
            headers: request.headers,
          }).pipe(Effect.flip);
        })
      )
    );
    expect(lostMembership).toMatchObject({ reason: "missing_membership" });
    const revoked = await Effect.runPromise(
      service.withDelegatedAccess(
        request,
        resource,
        readScopes,
        Effect.gen(function* revokeDuringOperation() {
          const initial = yield* service.api.getSession({
            headers: request.headers,
          });
          expect(initial?.user.id).toBe(account.userId);
          const response = yield* Effect.promise(() =>
            auth.fetch(
              postForm("/oauth2/revoke", {
                client_id: tokens.clientId,
                token: tokens.access_token,
                token_type_hint: "access_token",
              })
            )
          );
          expect(response.status).toBe(200);
          return yield* service.api
            .getSession({ headers: request.headers })
            .pipe(Effect.flip);
        })
      )
    );
    expect(revoked.statusCode).toBe(401);
  });

  it("creates a family through the delegated native API without switching the browser family", async () => {
    const auth = makeAuth();
    const account = await createAccount(auth);
    const browserFamily = await createFamily(auth, account.cookie);
    const tokens = await issueTokens(
      auth,
      account.cookie,
      "meal-planner:account offline_access"
    );
    const service = makeNativeAuthTestService(auth);
    const family = await Effect.runPromise(
      service.withDelegatedAccess(
        delegatedRequest(tokens.access_token),
        resource,
        ["meal-planner:account"],
        service.api
          .createOrganization({
            body: { name: "Created by connection", slug: crypto.randomUUID() },
            headers: new Headers(),
          })
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Struct({ id: HouseholdOrganizationId })
              )
            )
          )
      )
    );
    expect(family.id).not.toBe(browserFamily.id);
    const membership = await database()
      .select()
      .from(authSchema.member)
      .where(
        and(
          eq(authSchema.member.organizationId, family.id),
          eq(authSchema.member.userId, account.userId)
        )
      );
    expect(membership).toMatchObject([{ role: "owner" }]);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: account.cookie }),
    });
    expect(session?.session.activeOrganizationId).toBe(browserFamily.id);
  });

  it("fences native OAuth revocation for its account and reports failure when that fence cannot complete", async () => {
    const observedAccounts: string[] = [];
    let failFence = false;
    const outputFence: AuthOutputFence = (input, canonical) => {
      observedAccounts.push(input.accountId);
      if (failFence) {
        return Promise.reject(
          new PrivateOutputUnavailable({ reason: "authority_unavailable" })
        );
      }
      return canonical();
    };
    const auth = makeMealPlannerAuth({
      baseURL,
      database: database(),
      outputFence,
      schema: authSchema,
      secret: "local-oauth-output-fence-secret-at-least-32-characters",
    });
    const account = await createAccount(auth);
    const tokens = await issueTokens(auth, account.cookie);
    observedAccounts.length = 0;
    failFence = true;
    const refused = await auth.fetch(
      postForm("/oauth2/revoke", {
        client_id: tokens.clientId,
        token: tokens.access_token,
        token_type_hint: "access_token",
      })
    );
    expect(refused.status).toBe(503);
    expect(observedAccounts).toEqual([account.userId]);
    failFence = false;
    const stillActive = await Effect.runPromise(
      makeNativeAuthTestService(auth).withDelegatedAccess(
        delegatedRequest(tokens.access_token),
        resource,
        readScopes,
        DelegatedAccess
      )
    );
    expect(stillActive?.user.id).toBe(account.userId);
    observedAccounts.length = 0;
    const revoked = await auth.fetch(
      postForm("/oauth2/revoke", {
        client_id: tokens.clientId,
        token: tokens.access_token,
        token_type_hint: "access_token",
      })
    );
    expect(revoked.status).toBe(200);
    expect(observedAccounts).toEqual([account.userId, account.userId]);
  });

  it("permanently disconnects one user's consent without reviving old tokens on re-consent", async () => {
    const auth = makeAuth();
    const alice = await createAccount(auth);
    const bob = await createAccount(auth);
    const clientId = await registerClient(auth);
    const [aliceTokens, bobTokens] = await Promise.all(
      [alice, bob].map(async (account) => {
        const authorization = await authorizeCode(
          auth,
          account.cookie,
          clientId
        );
        const response = await exchange(auth, authorization);
        expect(response.status, await response.clone().text()).toBe(200);
        return Schema.decodeUnknownSync(TokenResponse)(await response.json());
      })
    );
    if (aliceTokens === undefined || bobTokens === undefined) {
      throw new Error("Expected both native grants.");
    }
    const [consent] = await database()
      .select()
      .from(authSchema.oauthConsent)
      .where(
        and(
          eq(authSchema.oauthConsent.clientId, clientId),
          eq(authSchema.oauthConsent.userId, alice.userId)
        )
      );
    if (consent === undefined) {
      throw new Error("Expected Alice's consent.");
    }
    const unusedCode = await authorizeCode(auth, alice.cookie, clientId);
    const disconnected = await auth.fetch(
      post("/oauth2/delete-consent", { id: consent.id }, alice.cookie)
    );
    expect(disconnected.status, await disconnected.clone().text()).toBe(200);
    const authorization = await authorizeCode(auth, alice.cookie, clientId);
    const response = await exchange(auth, authorization);
    expect(response.status, await response.clone().text()).toBe(200);
    const reconnected = Schema.decodeUnknownSync(TokenResponse)(
      await response.json()
    );
    const service = makeNativeAuthTestService(auth);
    const denied = await Effect.runPromise(
      service
        .withDelegatedAccess(
          delegatedRequest(aliceTokens.access_token),
          resource,
          readScopes,
          DelegatedAccess
        )
        .pipe(Effect.flip)
    );
    expect(denied.statusCode).toBe(401);
    const unused = await exchange(auth, unusedCode);
    expect(unused.status).toBe(400);
    const refresh = await auth.fetch(
      postForm("/oauth2/token", {
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: aliceTokens.refresh_token,
        resource,
      })
    );
    expect(refresh.status, await refresh.clone().text()).toBe(400);
    const current = await Effect.runPromise(
      service.withDelegatedAccess(
        delegatedRequest(reconnected.access_token),
        resource,
        readScopes,
        DelegatedAccess
      )
    );
    expect(current?.user.id).toBe(alice.userId);
    const unrelated = await Effect.runPromise(
      service.withDelegatedAccess(
        delegatedRequest(bobTokens.access_token),
        resource,
        readScopes,
        DelegatedAccess
      )
    );
    expect(unrelated?.user.id).toBe(bob.userId);
  });

  it("keeps disconnect outside the native refresh rotation CAS-to-create interval", async () => {
    // The durable coordinator separately proves one dispatch per intent across
    // concurrent callers. This fixture holds that same claim while exercising
    // the native provider's real D1 CAS-to-create interval.
    const initialAuth = makeAuth();
    const account = await createAccount(initialAuth);
    const token = await issueTokens(initialAuth, account.cookie);
    const lifecycleKey = await privateOutputKey(
      "oauth-lifecycle",
      account.userId
    );
    const active = new Set<string>();
    let pauseAfterMutation = false;
    let pauseBeforeLifecycle = false;
    const reached = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    const deleteReached = Promise.withResolvers<null>();
    const deleteRelease = Promise.withResolvers<null>();
    const outputFence: AuthOutputFence = async (input, canonical) => {
      if (active.has(input.intentKey)) {
        throw new PrivateOutputUnavailable({ reason: "mutation_pending" });
      }
      active.add(input.intentKey);
      if (pauseBeforeLifecycle && input.intentKey === lifecycleKey) {
        pauseBeforeLifecycle = false;
        deleteReached.resolve(null);
        await deleteRelease.promise;
      }
      const result = await canonical();
      if (pauseAfterMutation && input.intentKey !== lifecycleKey) {
        pauseAfterMutation = false;
        reached.resolve(null);
        await release.promise;
      }
      active.delete(input.intentKey);
      return result;
    };
    const auth = makeMealPlannerAuth({
      baseURL,
      database: database(),
      outputFence,
      schema: authSchema,
      secret: "local-delegated-auth-fixture-secret-at-least-32-characters",
    });
    const [consent] = await database()
      .select()
      .from(authSchema.oauthConsent)
      .where(
        and(
          eq(authSchema.oauthConsent.clientId, token.clientId),
          eq(authSchema.oauthConsent.userId, account.userId)
        )
      );
    if (consent === undefined) {
      throw new Error("Expected native consent.");
    }
    pauseAfterMutation = true;
    const rotating = auth.fetch(
      postForm("/oauth2/token", {
        client_id: token.clientId,
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
        resource,
      })
    );
    await reached.promise;
    const [rotatedRow] = await database()
      .select()
      .from(authSchema.oauthRefreshToken)
      .where(eq(authSchema.oauthRefreshToken.clientId, token.clientId));
    expect(rotatedRow?.rotatedAt).toBeInstanceOf(Date);
    const competingDisconnect = await auth.fetch(
      post("/oauth2/delete-consent", { id: consent.id }, account.cookie)
    );
    expect(competingDisconnect.status).toBe(503);
    expect(
      await database()
        .select()
        .from(authSchema.oauthConsent)
        .where(eq(authSchema.oauthConsent.id, consent.id))
    ).toHaveLength(1);
    release.resolve(null);
    const response = await rotating;
    expect(response.status, await response.clone().text()).toBe(200);
    const rotated = Schema.decodeUnknownSync(TokenResponse)(
      await response.json()
    );
    const disconnected = await auth.fetch(
      post("/oauth2/delete-consent", { id: consent.id }, account.cookie)
    );
    expect(disconnected.status, await disconnected.clone().text()).toBe(200);
    const code = await authorizeCode(auth, account.cookie, token.clientId);
    const reconnected = await exchange(auth, code);
    expect(reconnected.status, await reconnected.clone().text()).toBe(200);
    const currentTokens = Schema.decodeUnknownSync(TokenResponse)(
      await reconnected.json()
    );
    const denied = await Effect.runPromise(
      makeNativeAuthTestService(auth)
        .withDelegatedAccess(
          delegatedRequest(rotated.access_token),
          resource,
          readScopes,
          DelegatedAccess
        )
        .pipe(Effect.flip)
    );
    expect(denied.statusCode).toBe(401);
    const oldRefresh = await auth.fetch(
      postForm("/oauth2/token", {
        client_id: token.clientId,
        grant_type: "refresh_token",
        refresh_token: rotated.refresh_token,
        resource,
      })
    );
    expect(oldRefresh.status).toBe(400);
    const [currentConsent] = await database()
      .select()
      .from(authSchema.oauthConsent)
      .where(
        and(
          eq(authSchema.oauthConsent.clientId, token.clientId),
          eq(authSchema.oauthConsent.userId, account.userId)
        )
      );
    if (currentConsent === undefined) {
      throw new Error("Expected reconnected consent.");
    }
    pauseBeforeLifecycle = true;
    const deletingFirst = auth.fetch(
      post("/oauth2/delete-consent", { id: currentConsent.id }, account.cookie)
    );
    await deleteReached.promise;
    const refreshRequest = () =>
      postForm("/oauth2/token", {
        client_id: token.clientId,
        grant_type: "refresh_token",
        refresh_token: currentTokens.refresh_token,
        resource,
      });
    const competingRefresh = await auth.fetch(refreshRequest());
    expect(competingRefresh.status).toBe(503);
    deleteRelease.resolve(null);
    const deletedFirst = await deletingFirst;
    expect(deletedFirst.status).toBe(200);
    const retryRefresh = await auth.fetch(refreshRequest());
    expect(retryRefresh.status).toBe(400);
    expect(active.size).toBe(0);
  });

  it("denies client-wide mutations while retaining user-scoped connection revocation", async () => {
    const auth = makeAuth();
    const owner = await createAccount(auth);
    const other = await createAccount(auth);
    const clientId = await registerClient(auth, requestedScope, owner.cookie);
    const tokens = await Promise.all(
      [owner, other].map(async (account) => {
        const authorization = await authorizeCode(
          auth,
          account.cookie,
          clientId
        );
        const response = await exchange(auth, authorization);
        expect(response.status, await response.clone().text()).toBe(200);
        return {
          account,
          ...Schema.decodeUnknownSync(TokenResponse)(await response.json()),
        };
      })
    );
    await Promise.all(
      (
        [
          ["/oauth2/delete-client", { client_id: clientId }],
          [
            "/oauth2/update-client",
            { client_id: clientId, update: { scope: "meal-planner:write" } },
          ],
          ["/oauth2/client/rotate-secret", { client_id: clientId }],
        ] as const
      ).map(async ([path, body]) => {
        const response = await auth.fetch(post(path, body, owner.cookie));
        expect(response.status, await response.clone().text()).toBe(401);
      })
    );
    await Promise.all(
      tokens.map(async (token) => {
        const grant = await Effect.runPromise(
          makeNativeAuthTestService(auth).withDelegatedAccess(
            delegatedRequest(token.access_token),
            resource,
            readScopes,
            DelegatedAccess
          )
        );
        expect(grant?.user.id).toBe(token.account.userId);
      })
    );
  });

  it("accepts an invitation through delegated access without switching the recipient's browser family", async () => {
    const auth = makeAuth();
    const owner = await createAccount(auth);
    const joinedFamily = await createFamily(auth, owner.cookie);
    const recipient = await createAccount(auth);
    const browserFamily = await createFamily(auth, recipient.cookie);
    const invitation = await auth.api.createInvitation({
      body: {
        email: recipient.email,
        organizationId: joinedFamily.id,
        role: "member",
      },
      headers: new Headers({ cookie: owner.cookie }),
    });
    const tokens = await issueTokens(
      auth,
      recipient.cookie,
      "meal-planner:account offline_access"
    );
    const service = makeNativeAuthTestService(auth);
    await Effect.runPromise(
      service.withDelegatedAccess(
        delegatedRequest(tokens.access_token),
        resource,
        ["meal-planner:account"],
        service.api.acceptInvitation({
          body: { invitationId: invitation.id },
          headers: new Headers(),
        })
      )
    );
    const membership = await database()
      .select()
      .from(authSchema.member)
      .where(
        and(
          eq(authSchema.member.organizationId, joinedFamily.id),
          eq(authSchema.member.userId, recipient.userId)
        )
      );
    expect(membership).toMatchObject([{ role: "member" }]);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: recipient.cookie }),
    });
    expect(session?.session.activeOrganizationId).toBe(browserFamily.id);
  });

  it.each(["/sign-in/email", "/update-user"])(
    "defers native %s OAuth hooks until consent owns the lifecycle claim",
    async (path) => {
      let blockedIntent: string | undefined;
      const auth = makeMealPlannerAuth({
        baseURL,
        database: database(),
        outputFence: (input, canonical) => {
          if (input.intentKey === blockedIntent) {
            throw new PrivateOutputUnavailable({ reason: "mutation_pending" });
          }
          return canonical();
        },
        schema: authSchema,
        secret: "local-oauth-login-fence-secret-at-least-32-characters",
      });
      const account = await createAccount(auth);
      const tokens = await issueTokens(auth, account.cookie);
      const verifier = "valid-local-worker-pkce-code-verifier-0123456789";
      const digest = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier)
        )
      );
      const challenge = btoa(String.fromCodePoint(...digest))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
      const query = new URLSearchParams({
        client_id: tokens.clientId,
        code_challenge: challenge,
        code_challenge_method: "S256",
        redirect_uri: redirectUri,
        resource,
        response_type: "code",
        scope: requestedScope,
        state: crypto.randomUUID(),
      });
      const authorization = await auth.fetch(
        new Request(`${baseURL}/api/auth/oauth2/authorize?${query}`)
      );
      const loginLocation = authorization.headers.get("location");
      if (loginLocation === null) {
        throw new Error("Expected native login redirect.");
      }
      const login = new URL(loginLocation, baseURL);
      expect(login.pathname).toBe("/login");
      blockedIntent = await privateOutputKey("oauth-lifecycle", account.userId);
      const resumed = await auth.fetch(
        post(
          path,
          {
            ...(path === "/sign-in/email"
              ? { email: account.email, password: "local-worker-password-only" }
              : { name: "Updated connection owner" }),
            oauth_query: login.search.slice(1),
          },
          path === "/update-user" ? account.cookie : undefined
        )
      );
      expect(resumed.status, await resumed.clone().text()).toBe(200);
      const redirect = Schema.decodeUnknownSync(
        Schema.Struct({ url: Schema.String })
      )(await resumed.json());
      const consentPage = new URL(redirect.url, baseURL);
      expect(consentPage.pathname).toBe("/oauth/consent");
      expect(consentPage.searchParams.has("code")).toBe(false);
      const metadata = await auth.fetch(
        post("/oauth2/public-client-prelogin", {
          client_id: tokens.clientId,
          oauth_query: consentPage.search.slice(1),
        })
      );
      expect(metadata.status).toBe(200);
      const cookie =
        resumed.headers.get("set-cookie")?.split(";", 1)[0] ?? account.cookie;
      const consentRequest = () =>
        post(
          "/oauth2/consent",
          { accept: true, oauth_query: consentPage.search.slice(1) },
          cookie
        );
      const blocked = await auth.fetch(consentRequest());
      expect(blocked.status).toBe(503);
      blockedIntent = undefined;
      const consent = await auth.fetch(consentRequest());
      expect(consent.status, await consent.clone().text()).toBe(200);
      const callback = Schema.decodeUnknownSync(
        Schema.Struct({ url: Schema.String })
      )(await consent.json());
      const code = new URL(callback.url).searchParams.get("code");
      if (code === null) {
        throw new Error(
          "Expected native authorization code after consent acquired the claim."
        );
      }
      const response = await exchange(auth, {
        clientId: tokens.clientId,
        code,
        verifier,
      });
      expect(response.status, await response.clone().text()).toBe(200);
    }
  );

  it("serves public client metadata only for unmodified, unexpired native login and consent queries", async () => {
    const auth = makeAuth();
    const clientId = await registerClient(auth);
    const query = new URLSearchParams({
      client_id: clientId,
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: requestedScope,
      state: crypto.randomUUID(),
    });
    query.append("resource", resource);
    query.append("resource", `${baseURL}/v1`);
    const login = await auth.fetch(
      new Request(`${baseURL}/api/auth/oauth2/authorize?${query}`)
    );
    expect(login.status).toBe(302);
    const loginLocation = login.headers.get("location");
    if (loginLocation === null) {
      throw new Error("Expected native login redirect.");
    }
    const loginPage = new URL(loginLocation, baseURL);
    expect(loginPage.pathname).toBe("/login");
    expect(loginPage.searchParams.getAll("resource")).toEqual([
      resource,
      `${baseURL}/v1`,
    ]);
    const account = await createAccount(auth);
    const consent = await auth.fetch(
      new Request(`${baseURL}/api/auth/oauth2/authorize?${query}`, {
        headers: { cookie: account.cookie },
      })
    );
    expect(consent.status).toBe(302);
    const consentLocation = consent.headers.get("location");
    if (consentLocation === null) {
      throw new Error("Expected native consent redirect.");
    }
    const consentPage = new URL(consentLocation, baseURL);
    expect(consentPage.pathname).toBe("/oauth/consent");
    expect(consentPage.searchParams.getAll("resource")).toEqual([
      resource,
      `${baseURL}/v1`,
    ]);
    const metadata = await Promise.all(
      [loginPage, consentPage].map((page) =>
        auth.fetch(
          post("/oauth2/public-client-prelogin", {
            client_id: clientId,
            oauth_query: page.search.slice(1),
          })
        )
      )
    );
    for (const response of metadata) {
      expect(response.status).toBe(200);
    }
    const clients = await Promise.all(
      metadata.map((response) => response.json())
    );
    for (const client of clients) {
      expect(client).toMatchObject({
        client_id: clientId,
        client_name: "Delegation worker fixture",
      });
    }
    const tampered = new URLSearchParams(loginPage.search);
    tampered.set("redirect_uri", "https://unexpected.example.test/callback");
    const rejected = await auth.fetch(
      post("/oauth2/public-client-prelogin", {
        client_id: clientId,
        oauth_query: tampered.toString(),
      })
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: "invalid_signature" });
    const expiresAt = Number(loginPage.searchParams.get("exp")) * 1000;
    expect(expiresAt).toBeGreaterThan(Date.now());
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(expiresAt + 1000);
      const expired = await auth.fetch(
        post("/oauth2/public-client-prelogin", {
          client_id: clientId,
          oauth_query: loginPage.search.slice(1),
        })
      );
      expect(expired.status).toBe(400);
      expect(await expired.json()).toMatchObject({
        error: "invalid_signature",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps preview cookie accounts usable while delegated access is disabled without a canonical origin", async () => {
    const previewOrigin = "https://unconfigured-preview.example.test";
    const auth = makeMealPlannerAuth({
      baseURL: previewOrigin,
      database: database(),
      delegatedAccessEnabled: false,
      outputFence: (_input, canonical) => canonical(),
      schema: authSchema,
      secret: "local-disabled-oauth-fixture-secret-at-least-32-characters",
    });
    const signup = await auth.fetch(
      new Request(`${previewOrigin}/api/auth/sign-up/email`, {
        body: JSON.stringify({
          email: `${crypto.randomUUID()}@example.test`,
          name: "Preview account",
          password: "local-preview-password-only",
        }),
        headers: { "content-type": "application/json", origin: previewOrigin },
        method: "POST",
      })
    );
    expect(signup.status).toBe(200);
    const cookie = signup.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeDefined();
    expect(
      await auth.api.getSession({
        headers: new Headers({ cookie: cookie ?? "" }),
      })
    ).not.toBeNull();
    const register = await auth.fetch(
      new Request(`${previewOrigin}/api/auth/oauth2/register`, {
        method: "POST",
      })
    );
    expect(register.status).toBe(503);
    const discovery = await auth.fetch(
      new Request(
        `${previewOrigin}/.well-known/oauth-authorization-server/api/auth`
      )
    );
    expect(discovery.status).toBe(503);
    const service = makeNativeAuthTestService(auth);
    const failure = await Effect.runPromise(
      service
        .withDelegatedAccess(
          new Request(`${previewOrigin}/mcp`, {
            headers: { authorization: "Bearer never-issued" },
          }),
          `${previewOrigin}/mcp`,
          readScopes,
          Effect.die("Disabled deployment admitted a caller.")
        )
        .pipe(Effect.flip)
    );
    expect(failure).toMatchObject({ reason: "unavailable", statusCode: 503 });
    const resources = await database()
      .select()
      .from(authSchema.oauthResource)
      .where(eq(authSchema.oauthResource.identifier, `${previewOrigin}/mcp`));
    expect(resources).toEqual([]);
  });
});
