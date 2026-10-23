import { CreateFamily, Family } from "@meal-planner/families";
import {
  FamilyServiceLive,
  FamilyStore,
  HouseholdCreator,
} from "@meal-planner/families/application";
import { UserId } from "@meal-planner/household-api";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { applyD1Migrations, env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as authSchema from "../auth/auth.database-schema.js";
import { makeMealPlannerAuth } from "../auth/auth.js";
import { resolveAuthenticatedOrganization } from "../auth/auth.principal.js";
import { makeNativeAuthTestService } from "../auth/auth.test-fixture.js";
import { DelegatedAccess } from "../auth/delegated-access.js";
import { makeOAuthFlowFixture } from "../auth/oauth-flow.test-fixture.js";
import { FamilyStoreLive } from "../families/family-store.d1.js";
import { familyHttpApiLayer } from "../families/http.js";
import { handleProductHttp } from "./product-api.http.js";

const testEnv = env as unknown as {
  readonly AUTH_TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
  readonly MealPlannerAuthDatabase: AnyD1Database;
};
const baseURL = "https://product-oauth.example.test";
const database = () => drizzle(testEnv.MealPlannerAuthDatabase);
const makeFixture = (
  rateLimit: (key: string) => Effect.Effect<boolean> = () =>
    Effect.succeed(true)
) => {
  const db = database();
  const native = makeMealPlannerAuth({
    baseURL,
    database: db,
    outputFence: (_input, canonical) => canonical(),
    schema: authSchema,
    secret: "local-product-oauth-fixture-secret-at-least-32-characters",
  });
  const auth = makeNativeAuthTestService(native);
  const store = FamilyStoreLive(db);
  const services = FamilyServiceLive.pipe(
    Layer.provide(store),
    Layer.provide(
      Layer.succeed(HouseholdCreator, {
        link: () =>
          Effect.die("Creator linking is outside this authorization fixture."),
      })
    )
  );
  const familyRoutes = familyHttpApiLayer(auth).pipe(
    Layer.provide(services),
    HttpRouter.provideRequest(services)
  );
  // Capture dependencies before authorization, including the absent reference.
  // The production dispatcher restores the verified grant inside this context.
  // eslint-disable-next-line unicorn/no-useless-undefined -- The captured context must explicitly contain an absent grant to prove restoration wins.
  const capturedDependencies = Context.make(DelegatedAccess, undefined);
  let calls = 0;
  const dispatch = (request: Request) =>
    Effect.gen(function* dispatchNativeFamilyRequest() {
      calls += 1;
      const grant = yield* DelegatedAccess;
      // This probe exercises the same native resolver used by ambient import and
      // household handlers; business responses below use the real family API.
      const operation =
        new URL(request.url).pathname === "/v1/household"
          ? resolveAuthenticatedOrganization({
              auth,
              headers: request.headers,
            }).pipe(
              Effect.map((principal) => Response.json(principal)),
              Effect.orElseSucceed(() =>
                Response.json(
                  { error: "family_not_available" },
                  { status: 403 }
                )
              )
            )
          : Effect.gen(function* serveNativeFamilyRequest() {
              const handler = yield* HttpRouter.toHttpEffect(familyRoutes);
              return HttpServerResponse.toWeb(
                yield* handler.pipe(
                  Effect.provideService(
                    HttpServerRequest.HttpServerRequest,
                    HttpServerRequest.fromWeb(request)
                  )
                )
              );
            }).pipe(
              Effect.orElseSucceed(() =>
                Response.json({ error: "unavailable" }, { status: 503 })
              )
            );
      return yield* operation.pipe(
        Effect.provideService(DelegatedAccess, grant),
        Effect.provideContext(capturedDependencies)
      );
    }).pipe(Effect.scoped);
  const fetch = (request: Request) =>
    Effect.runPromise(
      handleProductHttp(request, {
        auth,
        baseURL,
        dispatch,
        rateLimit,
      }).pipe(
        Effect.scoped,
        Effect.map(
          (response) => response ?? new Response(null, { status: 404 })
        )
      )
    );
  return {
    ...makeOAuthFlowFixture(native, baseURL),
    createFamily: async (userId: string, name: string) => {
      const created = await Effect.runPromise(
        FamilyStore.use((service) =>
          service.create(
            Schema.decodeUnknownSync(UserId)(userId),
            "Product fixture",
            Schema.decodeUnknownSync(CreateFamily)({
              mutationId: crypto.randomUUID(),
              name,
            })
          )
        ).pipe(Effect.provide(store))
      );
      return created.family;
    },
    dispatchCount: () => calls,
    fetch,
    native,
  };
};
type Fixture = ReturnType<typeof makeFixture>;
const request = (
  path: string,
  token: string,
  options: {
    readonly method?: string;
    readonly body?: object;
    readonly headers?: Record<string, string>;
  } = {}
) => {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const init: RequestInit = { headers, method: options.method ?? "GET" };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    headers["content-type"] = "application/json";
  }
  Object.assign(headers, options.headers);
  return new Request(`${baseURL}${path}`, init);
};
const connect = async (fixture: Fixture, token: string, cookie?: string) => {
  const client = new Client({ name: "product-native-oauth", version: "1" });
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (cookie !== undefined) {
    headers["cookie"] = cookie;
  }
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseURL}/mcp`),
    {
      fetch: (url, init) => fixture.fetch(new Request(url, init)),
      requestInit: { headers },
    }
  );
  await client.connect({
    close: () => transport.close(),
    // eslint-disable-next-line accessor-pairs -- The MCP SDK assigns transport callbacks; this adapter only forwards those assignments.
    set onclose(handler: NonNullable<Transport["onclose"]>) {
      // eslint-disable-next-line unicorn/prefer-add-event-listener -- The SDK transport exposes callback properties, not EventTarget listeners.
      transport.onclose = handler;
    },
    // eslint-disable-next-line accessor-pairs -- The MCP SDK assigns transport callbacks; this adapter only forwards those assignments.
    set onerror(handler: NonNullable<Transport["onerror"]>) {
      // eslint-disable-next-line unicorn/prefer-add-event-listener -- The SDK transport exposes callback properties, not EventTarget listeners.
      transport.onerror = handler;
    },
    // eslint-disable-next-line accessor-pairs -- The MCP SDK assigns transport callbacks; this adapter only forwards those assignments.
    set onmessage(handler: NonNullable<Transport["onmessage"]>) {
      // eslint-disable-next-line unicorn/prefer-add-event-listener -- The SDK transport exposes callback properties, not EventTarget listeners.
      transport.onmessage = handler;
    },
    send: (message, options) => transport.send(message, options),
    start: () => transport.start(),
  });
  return client;
};

describe("product HTTP and MCP with native OAuth credentials", () => {
  beforeAll(() =>
    applyD1Migrations(
      testEnv.MealPlannerAuthDatabase,
      testEnv.AUTH_TEST_MIGRATIONS
    )
  );
  beforeEach(async () => {
    await database().delete(authSchema.rateLimit);
  });

  it("shares the account admission allowance across separately registered clients", async () => {
    const admitted = new Set<string>();
    const keys: string[] = [];
    const fixture = makeFixture((key) =>
      Effect.sync(() => {
        keys.push(key);
        if (admitted.has(key)) {
          return false;
        }
        admitted.add(key);
        return true;
      })
    );
    const alice = await fixture.createAccount();
    const bob = await fixture.createAccount();
    const first = await fixture.issueTokens(
      alice.cookie,
      `${baseURL}/v1`,
      "meal-planner:read"
    );
    const second = await fixture.issueTokens(
      alice.cookie,
      `${baseURL}/v1`,
      "meal-planner:read"
    );
    const other = await fixture.issueTokens(
      bob.cookie,
      `${baseURL}/v1`,
      "meal-planner:read"
    );
    expect(first.clientId).not.toBe(second.clientId);
    const allowedFirst = await fixture.fetch(
      request("/v1/families", first.access_token)
    );
    expect(allowedFirst.status).toBe(200);
    const denied = await fixture.fetch(
      request("/v1/families", second.access_token)
    );
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("60");
    const allowedOther = await fixture.fetch(
      request("/v1/families", other.access_token)
    );
    expect(allowedOther.status).toBe(200);
    expect(keys).toEqual([alice.user.id, alice.user.id, bob.user.id]);
    expect(fixture.dispatchCount()).toBe(2);
  });

  it("serves issuer-path discovery and resource challenges from the native provider", async () => {
    const fixture = makeFixture();
    const metadata = await fixture.native.fetch(
      new Request(`${baseURL}/.well-known/oauth-authorization-server/api/auth`)
    );
    expect(metadata.status, await metadata.clone().text()).toBe(200);
    expect(await metadata.json()).toMatchObject({
      authorization_endpoint: `${baseURL}/api/auth/oauth2/authorize`,
      code_challenge_methods_supported: ["S256"],
      issuer: `${baseURL}/api/auth`,
      registration_endpoint: `${baseURL}/api/auth/oauth2/register`,
      token_endpoint: `${baseURL}/api/auth/oauth2/token`,
    });
    await Promise.all(
      ["v1", "mcp"].map(async (resource) => {
        const response = await fixture.fetch(
          new Request(
            `${baseURL}/.well-known/oauth-protected-resource/${resource}`
          )
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          authorization_servers: [`${baseURL}/api/auth`],
          resource: `${baseURL}/${resource}`,
        });
      })
    );
    const unauthenticated = await fixture.fetch(new Request(`${baseURL}/mcp`));
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toContain(
      `resource_metadata="${baseURL}/.well-known/oauth-protected-resource/mcp"`
    );
  });

  it("preserves the verified actor through captured dependencies and enforces exact HTTP scopes and audience", async () => {
    const fixture = makeFixture();
    const alice = await fixture.createAccount();
    const bob = await fixture.createAccount();
    const aliceFamily = await fixture.createFamily(
      alice.user.id,
      "Alice family"
    );
    const bobFamily = await fixture.createFamily(bob.user.id, "Bob family");
    const read = await fixture.issueTokens(
      alice.cookie,
      `${baseURL}/v1`,
      "meal-planner:read"
    );
    const write = await fixture.issueTokens(
      alice.cookie,
      `${baseURL}/v1`,
      "meal-planner:write"
    );
    const wrongAudience = await fixture.issueTokens(
      alice.cookie,
      `${baseURL}/mcp`,
      "meal-planner:read"
    );
    const list = await fixture.fetch(
      request("/v1/families", read.access_token, {
        headers: { cookie: bob.cookie },
      })
    );
    expect(list.status, await list.clone().text()).toBe(200);
    expect(
      Schema.decodeUnknownSync(Schema.Array(Family))(await list.json()).map(
        ({ id }) => id
      )
    ).toEqual([aliceFamily.id]);
    const otherFamily = await fixture.fetch(
      request(`/v1/families/${bobFamily.id}`, read.access_token)
    );
    expect(otherFamily.status).toBe(404);
    const spoofedUser = await fixture.fetch(
      request("/v1/families", read.access_token, {
        headers: { "x-meal-planner-user": bob.user.id },
      })
    );
    expect(spoofedUser.status).toBe(401);
    const wrongResource = await fixture.fetch(
      request("/v1/families", wrongAudience.access_token)
    );
    expect(wrongResource.status).toBe(401);
    const rename = {
      expectedVersion: aliceFamily.version,
      mutationId: crypto.randomUUID(),
      name: "Alice renamed",
    };
    const before = fixture.dispatchCount();
    const denied = await fixture.fetch(
      request(`/v1/families/${aliceFamily.id}`, read.access_token, {
        body: rename,
        method: "PATCH",
      })
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get("www-authenticate")).toContain(
      'scope="meal-planner:write"'
    );
    expect(fixture.dispatchCount()).toBe(before);
    const saved = await fixture.fetch(
      request(`/v1/families/${aliceFamily.id}`, write.access_token, {
        body: rename,
        method: "PATCH",
      })
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await saved.json()).toMatchObject({
      id: aliceFamily.id,
      name: "Alice renamed",
      version: 2,
    });
    const replay = await fixture.fetch(
      request(`/v1/families/${aliceFamily.id}`, write.access_token, {
        body: rename,
        method: "PATCH",
      })
    );
    expect(await replay.json()).toMatchObject({ version: 2 });
    const writeCannotRead = await fixture.fetch(
      request("/v1/families", write.access_token)
    );
    expect(writeCannotRead.status).toBe(403);
    await fixture.revoke(read.clientId, read.access_token);
    const revoked = await fixture.fetch(
      request("/v1/families", read.access_token)
    );
    expect(revoked.status).toBe(401);
  });

  it("uses explicit household context and fresh membership without changing the browser selection", async () => {
    const fixture = makeFixture();
    const alice = await fixture.createAccount();
    const bob = await fixture.createAccount();
    const first = await fixture.createFamily(alice.user.id, "First family");
    const browser = await fixture.createFamily(alice.user.id, "Browser family");
    const other = await fixture.createFamily(
      bob.user.id,
      "Other account family"
    );
    await fixture.native.api.setActiveOrganization({
      body: { organizationId: browser.id },
      headers: new Headers({ cookie: alice.cookie }),
    });
    const token = await fixture.issueTokens(
      alice.cookie,
      `${baseURL}/v1`,
      "meal-planner:read"
    );
    const selected = request("/v1/household", token.access_token, {
      headers: { "x-meal-planner-household": first.id },
    });
    const response = await fixture.fetch(selected);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      organizationId: first.id,
      userId: alice.user.id,
    });
    const missingHousehold = await fixture.fetch(
      request("/v1/household", token.access_token)
    );
    expect(missingHousehold.status).toBe(403);
    const foreignHousehold = await fixture.fetch(
      request("/v1/household", token.access_token, {
        headers: { "x-meal-planner-household": other.id },
      })
    );
    expect(foreignHousehold.status).toBe(403);
    await database()
      .delete(authSchema.member)
      .where(
        and(
          eq(authSchema.member.organizationId, first.id),
          eq(authSchema.member.userId, alice.user.id)
        )
      );
    const removedMembership = await fixture.fetch(selected.clone());
    expect(removedMembership.status).toBe(403);
    const browserSession = await fixture.native.api.getSession({
      headers: new Headers({ cookie: alice.cookie }),
    });
    expect(browserSession?.session.activeOrganizationId).toBe(browser.id);
  });

  it("negotiates real MCP clients, isolates simultaneous accounts, dispatches mutations and rejects revoked connections", async () => {
    const fixture = makeFixture();
    const alice = await fixture.createAccount();
    const bob = await fixture.createAccount();
    const aliceFamily = await fixture.createFamily(alice.user.id, "MCP Alice");
    const bobFamily = await fixture.createFamily(bob.user.id, "MCP Bob");
    const aliceToken = await fixture.issueTokens(
      alice.cookie,
      `${baseURL}/mcp`,
      "meal-planner:read meal-planner:write"
    );
    const bobToken = await fixture.issueTokens(
      bob.cookie,
      `${baseURL}/mcp`,
      "meal-planner:read"
    );
    const aliceClient = await connect(
      fixture,
      aliceToken.access_token,
      bob.cookie
    );
    const bobClient = await connect(
      fixture,
      bobToken.access_token,
      alice.cookie
    );
    try {
      const tools = await bobClient.listTools();
      expect(tools.tools.some(({ name }) => name === "families_list")).toBe(
        true
      );
      expect(tools.tools.some(({ name }) => name === "families_update")).toBe(
        false
      );
      expect(tools.tools.some(({ name }) => name === "account_read")).toBe(
        false
      );
      await Promise.all(
        (
          [
            [aliceClient, aliceFamily],
            [bobClient, bobFamily],
          ] as const
        ).map(async ([client, family]) => {
          const responses = await Promise.all(
            Array.from({ length: 4 }, () =>
              client.callTool({ arguments: {}, name: "families_list" })
            )
          );
          for (const response of responses) {
            expect(response.structuredContent).toMatchObject({
              httpStatus: 200,
              result: [{ id: family.id }],
            });
          }
        })
      );
      const denied = await bobClient.callTool({
        arguments: {
          input: {
            expectedVersion: 1,
            mutationId: crypto.randomUUID(),
            name: "No permission",
          },
          path: { familyId: bobFamily.id },
        },
        name: "families_update",
      });
      expect(denied.isError).toBe(true);
      const wrongFamily = await bobClient.callTool({
        arguments: { path: { familyId: aliceFamily.id } },
        name: "families_get",
      });
      expect(wrongFamily.structuredContent).toMatchObject({ httpStatus: 404 });
      const saved = await aliceClient.callTool({
        arguments: {
          input: {
            expectedVersion: 1,
            mutationId: crypto.randomUUID(),
            name: "MCP Alice renamed",
          },
          path: { familyId: aliceFamily.id },
        },
        name: "families_update",
      });
      expect(saved.structuredContent).toMatchObject({
        httpStatus: 200,
        result: { id: aliceFamily.id, name: "MCP Alice renamed", version: 2 },
      });
      await fixture.revoke(aliceToken.clientId, aliceToken.access_token);
      await expect(aliceClient.listTools()).rejects.toBeDefined();
      const bobStillConnected = await bobClient.callTool({
        arguments: {},
        name: "families_list",
      });
      expect(bobStillConnected.structuredContent).toMatchObject({
        result: [{ id: bobFamily.id, name: "MCP Bob" }],
      });
    } finally {
      await Promise.all([aliceClient.close(), bobClient.close()]);
    }
  });

  it("runs the stateless 2026 MCP transport with the same scope and household authority", async () => {
    const fixture = makeFixture();
    const account = await fixture.createAccount();
    const family = await fixture.createFamily(
      account.user.id,
      "Stateless family"
    );
    const token = await fixture.issueTokens(
      account.cookie,
      `${baseURL}/mcp`,
      "meal-planner:read"
    );
    const call = (
      method: string,
      params: { readonly name?: string; readonly arguments?: object }
    ) => {
      const headers: Record<string, string> = {
        accept: "application/json, text/event-stream",
        "mcp-method": method,
        "mcp-protocol-version": "2026-07-28",
      };
      if (params.name !== undefined) {
        headers["mcp-name"] = params.name;
      }
      return fixture.fetch(
        request("/mcp", token.access_token, {
          body: {
            id: crypto.randomUUID(),
            jsonrpc: "2.0",
            method,
            params: {
              ...params,
              _meta: {
                "io.modelcontextprotocol/clientCapabilities": {},
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              },
            },
          },
          headers,
          method: "POST",
        })
      );
    };
    const listed = await call("tools/list", {});
    expect(listed.status, await listed.clone().text()).toBe(200);
    const list = Schema.decodeUnknownSync(
      Schema.Struct({
        result: Schema.Struct({
          tools: Schema.Array(Schema.Struct({ name: Schema.String })),
        }),
      })
    )(await listed.json());
    expect(list.result.tools.some(({ name }) => name === "families_list")).toBe(
      true
    );
    expect(
      list.result.tools.some(({ name }) => name === "families_update")
    ).toBe(false);
    const result = await call("tools/call", {
      arguments: { familyId: family.id },
      name: "households_current",
    });
    expect(result.status, await result.clone().text()).toBe(200);
    expect(await result.json()).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          httpStatus: 200,
          result: { organizationId: family.id, userId: account.user.id },
        },
      },
    });
    const missing = await call("tools/call", {
      arguments: {},
      name: "households_current",
    });
    expect(await missing.json()).toMatchObject({ result: { isError: true } });
  });
});
