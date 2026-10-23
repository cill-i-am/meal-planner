import { createHash } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  CatalogueProductResults,
  CatalogueSuggestions,
} from "../catalogue/catalogue.model.js";
import * as Shopping from "../shopping/shopping.model.js";
import { makeHttpShoppingFixture } from "./http-shopping.test-fixture.js";
import { tescoPrivateOpenApi } from "./http.contract.js";
import type { TescoMcpCapabilities } from "./mcp.contract.js";
import { makeTescoMcpHttpHandler } from "./mcp.http.js";
import { TescoSessionFailure } from "./session.model.js";

const executorToken = "a".repeat(64);
const operatorToken = "b".repeat(64);
const digest = (token: string) =>
  Redacted.make(createHash("sha256").update(token).digest("hex"));
const products = Schema.decodeUnknownSync(CatalogueProductResults)({
  pageInformation: { count: 1, pageNo: 1, pageSize: 24, total: 1 },
  results: [{ id: "123", title: "Milk", type: "ProductType" }],
});
const suggestions = Schema.decodeUnknownSync(CatalogueSuggestions)({
  results: [{ query: "milk" }],
});
const health = {
  accessTokenExpiresAt: null,
  lastRefreshedAt: null,
  nextRefreshAt: null,
  state: "not_connected" as const,
};

const setup = (
  overrides: Partial<TescoMcpCapabilities> = {},
  admitted = true
) => {
  const search = vi.fn(() => Effect.succeed(products));
  const enroll = vi.fn(() => Effect.succeed(health));
  const disconnect = vi.fn(() => Effect.void);
  const sessionReport = vi.fn(() =>
    Effect.succeed({
      alarmAt: null,
      hasEncryptedSession: false,
      health,
      renewals: [],
    })
  );
  const rateLimit = vi.fn(() => Effect.succeed(admitted));
  const handler = makeTescoMcpHttpHandler({
    capabilities: {
      basket: Effect.fail(new TescoSessionFailure({ reason: "upstream" })),
      categoryProducts: () => Effect.succeed(products),
      checkoutHandoff: () =>
        Effect.fail(new TescoSessionFailure({ reason: "upstream" })),
      connectionHealth: Effect.succeed(health),
      deliverySlots: () =>
        Effect.fail(new TescoSessionFailure({ reason: "upstream" })),
      favourites: () =>
        Effect.fail(new TescoSessionFailure({ reason: "upstream" })),
      orderDetails: () =>
        Effect.fail(new TescoSessionFailure({ reason: "upstream" })),
      prepareCheckout: Effect.fail(
        new TescoSessionFailure({ reason: "upstream" })
      ),
      previousOrders: () =>
        Effect.fail(new TescoSessionFailure({ reason: "upstream" })),
      productDetails: () =>
        Effect.fail(new TescoSessionFailure({ reason: "upstream" })),
      releaseSlot: () =>
        Effect.fail(new TescoSessionFailure({ reason: "upstream" })),
      reserveSlot: () =>
        Effect.fail(new TescoSessionFailure({ reason: "upstream" })),
      search,
      setBasketItems: () =>
        Effect.fail(new TescoSessionFailure({ reason: "upstream" })),
      suggestions: () => Effect.succeed(suggestions),
      ...overrides,
    },
    disconnect: Effect.suspend(disconnect),
    enroll,
    executorTokenHash: digest(executorToken),
    operatorTokenHash: digest(operatorToken),
    rateLimit: Effect.suspend(rateLimit),
    sessionReport: Effect.suspend(sessionReport),
  });
  const fetch: typeof globalThis.fetch = (input, init) =>
    Effect.runPromise(handler(new Request(input, init)));
  return {
    disconnect,
    enroll,
    fetch,
    handler,
    rateLimit,
    search,
    sessionReport,
  };
};

const connect = async (fetch: typeof globalThis.fetch) => {
  const client = new Client({
    name: "executor-compatibility-test",
    version: "1.0.0",
  });
  await client.connect(
    // @ts-expect-error SDK 1.32.1's concrete transport includes undefined in sessionId; its Transport interface omits it under exactOptionalPropertyTypes.
    new StreamableHTTPClientTransport(new URL("https://tesco.test/mcp"), {
      fetch,
      requestInit: { headers: { authorization: `Bearer ${executorToken}` } },
    })
  );
  return client;
};

describe("private Tesco MCP HTTP boundary", () => {
  it("restricts the uncached renewal report to the operator without browser access", async () => {
    const app = setup();
    await Promise.all(
      [{}, { authorization: `Bearer ${executorToken}` }].map(
        async (headers) => {
          const denied = await app.fetch("https://tesco.test/admin/session", {
            headers,
          });
          expect(denied.status).toBe(401);
        }
      )
    );
    const browser = await app.fetch("https://tesco.test/admin/session", {
      headers: {
        authorization: `Bearer ${operatorToken}`,
        origin: "https://tesco.test",
      },
    });
    expect(browser.status).toBe(403);
    expect(app.sessionReport).not.toHaveBeenCalled();
    const report = await app.fetch("https://tesco.test/admin/session", {
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(report.status).toBe(200);
    expect(report.headers.get("cache-control")).toBe("no-store");
    expect(await report.json()).toEqual({
      alarmAt: null,
      hasEncryptedSession: false,
      health,
      renewals: [],
    });
    expect(app.sessionReport).toHaveBeenCalledOnce();
  });

  it("rejects unauthenticated initialization and discovery before executing or reading a body", async () => {
    const app = setup();
    await Promise.all(
      ["initialize", "tools/list", "tools/call"].map(async (method) => {
        const response = await app.fetch("https://tesco.test/mcp", {
          body: JSON.stringify({ id: 1, jsonrpc: "2.0", method }),
          method: "POST",
        });
        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain("Bearer");
      })
    );
    expect(app.search).not.toHaveBeenCalled();
    expect(app.rateLimit).not.toHaveBeenCalled();
  });

  it("keeps the Executor credential and operator credential separate", async () => {
    const app = setup();
    const deniedAdmin = await app.fetch("https://tesco.test/admin/session", {
      headers: { authorization: `Bearer ${executorToken}` },
      method: "DELETE",
    });
    const deniedMcp = await app.fetch("https://tesco.test/mcp", {
      headers: { authorization: `Bearer ${operatorToken}` },
      method: "POST",
    });
    expect(deniedAdmin.status).toBe(401);
    expect(deniedMcp.status).toBe(401);
    expect(app.disconnect).not.toHaveBeenCalled();
    const allowed = await app.fetch("https://tesco.test/admin/session", {
      headers: { authorization: `Bearer ${operatorToken}` },
      method: "DELETE",
    });
    expect(allowed.status).toBe(204);
    expect(app.disconnect).toHaveBeenCalledOnce();
  });

  it("uses fresh, closed, sessionless SDK transports across discovery and successive tool calls", async () => {
    const app = setup();
    const client = await connect(app.fetch);
    try {
      const discovery = await client.listTools();
      expect(discovery.tools.map((tool) => tool.name)).toEqual([
        "search_products",
        "list_category_products",
        "suggest_products",
        "connection_status",
        "get_product_details",
        "list_favourites",
        "list_previous_orders",
        "get_order_details",
        "get_basket",
        "list_delivery_slots",
        "set_basket_items",
        "reserve_delivery_slot",
        "release_delivery_slot",
        "prepare_checkout",
        "approve_checkout_handoff",
      ]);
      expect(
        discovery.tools
          .filter(
            (tool) =>
              ![
                "set_basket_items",
                "reserve_delivery_slot",
                "release_delivery_slot",
                "prepare_checkout",
                "approve_checkout_handoff",
              ].includes(tool.name)
          )
          .every((tool) => tool.annotations?.readOnlyHint === true)
      ).toBe(true);
      expect(
        discovery.tools.find((tool) => tool.name === "approve_checkout_handoff")
          ?.annotations?.readOnlyHint
      ).toBe(false);
      expect(
        discovery.tools.find((tool) => tool.name === "approve_checkout_handoff")
          ?.annotations?.destructiveHint
      ).toBe(false);
      expect(
        discovery.tools.find((tool) => tool.name === "set_basket_items")
          ?.annotations?.idempotentHint
      ).toBe(true);
      const strictInput = await client.callTool({
        arguments: {
          approved: true,
          items: [{ productId: "123", quantity: 1, unit: "pcs" }],
          requestId: "shopping-request-123",
        },
        name: "set_basket_items",
      });
      expect(strictInput.isError).toBe(true);
      const first = await client.callTool({
        arguments: { query: "milk" },
        name: "search_products",
      });
      const second = await client.callTool({
        arguments: {},
        name: "connection_status",
      });
      expect(first.isError).not.toBe(true);
      expect(first.structuredContent).toEqual(products);
      expect(second.structuredContent).toEqual(health);
      expect(app.search).toHaveBeenCalledWith({
        count: 24,
        page: 1,
        query: "milk",
        sortBy: "relevance",
      });
    } finally {
      await client.close();
    }
  });

  it("bounds tool input and redacts expected upstream authentication failures", async () => {
    const app = setup({
      search: () =>
        Effect.fail(new TescoSessionFailure({ reason: "authentication" })),
    });
    const client = await connect(app.fetch);
    try {
      const invalid = await client.callTool({
        arguments: { count: 49, query: "milk" },
        name: "search_products",
      });
      expect(invalid.isError).toBe(true);
      const missing = await client.callTool({
        arguments: { query: "milk" },
        name: "search_products",
      });
      expect(missing.isError).toBe(true);
      expect(JSON.stringify(missing)).toContain("operator to sign in again");
      expect(JSON.stringify(missing)).not.toContain(executorToken);
    } finally {
      await client.close();
    }
  });

  it("rejects browser origins and oversized operator uploads", async () => {
    const app = setup();
    const browser = await app.fetch("https://tesco.test/mcp", {
      headers: {
        authorization: `Bearer ${executorToken}`,
        origin: "https://attacker.test",
      },
      method: "POST",
    });
    expect(browser.status).toBe(403);
    const upload = await app.fetch("https://tesco.test/admin/session", {
      body: "x".repeat(65_537),
      headers: {
        authorization: `Bearer ${operatorToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(upload.status).toBe(400);
    expect(app.enroll).not.toHaveBeenCalled();
    expect(await upload.text()).not.toContain("xxxx");
  });

  it("interrupts a tool's Effect when its client connection closes", async () => {
    let started = false;
    let released = false;
    const app = setup({
      search: () =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            started = true;
          }),
          () => Effect.never,
          () =>
            Effect.sync(() => {
              released = true;
            })
        ),
    });
    const client = await connect(app.fetch);
    const abort = new AbortController();
    try {
      const call = client.callTool(
        { arguments: { query: "milk" }, name: "search_products" },
        undefined,
        { signal: abort.signal }
      );
      const rejected = expect(call).rejects.toBeDefined();
      await vi.waitFor(() => expect(started).toBe(true));
      abort.abort();
      await rejected;
      await client.close();
      await vi.waitFor(() => expect(released).toBe(true));
    } finally {
      abort.abort();
      await client.close();
    }
  });
});

const post = (
  app: ReturnType<typeof setup>,
  name: string,
  input: Schema.Json
) =>
  app.fetch(`https://tesco.test/v1/${name}`, {
    body: JSON.stringify(input),
    headers: {
      authorization: `Bearer ${executorToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

describe("private Tesco HTTP and MCP parity", () => {
  it("publishes all 15 private operations from the same schemas without operator enrollment", async () => {
    const app = setup();
    const client = await connect(app.fetch);
    try {
      const discovery = await client.listTools();
      const response = await app.fetch("https://tesco.test/openapi.json", {
        headers: { authorization: `Bearer ${executorToken}` },
      });
      const document = tescoPrivateOpenApi("https://tesco.test");
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual(document);
      expect(Object.keys(document.paths)).toEqual(
        discovery.tools.map((tool) => `/v1/${tool.name}`)
      );
      expect(document.paths).not.toHaveProperty("/admin/session");
      for (const tool of discovery.tools) {
        expect(document.paths[`/v1/${tool.name}`]?.post).toMatchObject({
          description: tool.description,
          security: [{ privateTescoBearer: [] }],
        });
      }
    } finally {
      await client.close();
    }
  });

  it("authenticates HTTP calls and discovery before parsing, retaining operator separation and browser denial", async () => {
    const app = setup();
    await Promise.all(
      [
        "/openapi.json",
        "/v1/search_products",
        "/v1/approve_checkout_handoff",
      ].flatMap((path) =>
        [null, operatorToken].map(async (credential) => {
          const denied = await app.fetch(`https://tesco.test${path}`, {
            body: "not-json",
            headers:
              credential === null
                ? {}
                : { authorization: `Bearer ${credential}` },
            method: "POST",
          });
          expect(denied.status).toBe(401);
        })
      )
    );
    expect(app.rateLimit).not.toHaveBeenCalled();
    expect(app.search).not.toHaveBeenCalled();
    await Promise.all(
      ["/openapi.json", "/v1/search_products"].map(async (path) => {
        const browser = await app.fetch(`https://tesco.test${path}`, {
          headers: {
            authorization: `Bearer ${executorToken}`,
            origin: "https://tesco.test",
          },
        });
        expect(browser.status).toBe(403);
      })
    );
    expect(app.enroll).not.toHaveBeenCalled();
    expect(app.sessionReport).not.toHaveBeenCalled();
    const limited = setup({}, false);
    const response = await post(limited, "search_products", { query: "milk" });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(limited.search).not.toHaveBeenCalled();
  });

  it("returns the exact MCP structured results for every read operation", async () => {
    const fixture = makeHttpShoppingFixture();
    const app = setup(await Effect.runPromise(fixture.program));
    const client = await connect(app.fetch);
    const reads = [
      { input: { query: "milk" }, name: "search_products" },
      { input: { facet: "123" }, name: "list_category_products" },
      { input: { query: "milk" }, name: "suggest_products" },
      { input: {}, name: "connection_status" },
      { input: { productId: "123" }, name: "get_product_details" },
      { input: {}, name: "list_favourites" },
      { input: {}, name: "list_previous_orders" },
      { input: { orderId: "order" }, name: "get_order_details" },
      { input: {}, name: "get_basket" },
      {
        input: { end: "2026-10-25", start: "2026-10-24" },
        name: "list_delivery_slots",
      },
    ];
    try {
      await Promise.all(
        reads.map(async ({ name, input }) => {
          const http = await post(app, name, input);
          const mcp = await client.callTool({ arguments: input, name });
          expect(http.status, name).toBe(200);
          expect(http.headers.get("cache-control"), name).toBe("no-store");
          expect(mcp.isError, name).not.toBe(true);
          expect(await http.json(), name).toEqual(mcp.structuredContent);
        })
      );
      expect(fixture.sent).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("shares durable mutation retry identity across transports and reconstructed services", async () => {
    const fixture = makeHttpShoppingFixture();
    const app = setup(await Effect.runPromise(fixture.program));
    const replayThroughRestartedMcp = async (
      name: string,
      input: Readonly<Record<string, Schema.Json>>
    ) => {
      const restarted = setup(await Effect.runPromise(fixture.program));
      const client = await connect(restarted.fetch);
      try {
        return await client.callTool({ arguments: input, name });
      } finally {
        await client.close();
      }
    };
    const commands = [
      {
        input: {
          items: [{ productId: "123", quantity: 2, unit: "pcs" }],
          requestId: "basket-request-http",
        },
        name: "set_basket_items",
      },
      {
        input: {
          expectedSlotId: "reserved-slot",
          requestId: "release-request-http",
        },
        name: "release_delivery_slot",
      },
      {
        input: { requestId: "reserve-request-http", slot: fixture.slot },
        name: "reserve_delivery_slot",
      },
    ];
    for (const { name, input } of commands) {
      // eslint-disable-next-line no-await-in-loop -- Basket/slot transitions and their replay must be observed in order.
      const first = await post(app, name, input);
      expect(first.status, name).toBe(200);
      // eslint-disable-next-line no-await-in-loop -- This body belongs to the current command before its replay.
      const firstBody = await first.json();
      const result = Schema.decodeUnknownSync(Shopping.BasketCommandResult)(
        firstBody
      );
      expect(result.outcome, name).toBe("confirmed");
      // eslint-disable-next-line no-await-in-loop -- Replay must follow the first attempt against the same durable receipt.
      const retry = await replayThroughRestartedMcp(name, input);
      expect(retry.isError, name).not.toBe(true);
      expect(retry.structuredContent, name).toMatchObject({
        basket: result.basket,
        outcome: "confirmed",
      });
    }
    expect(fixture.sent).toEqual([
      "SetPrivateBasketItems",
      "ReleasePrivateSlot",
      "ReservePrivateSlot",
    ]);
    const conflict = await post(app, "set_basket_items", {
      items: [{ productId: "123", quantity: 3, unit: "pcs" }],
      requestId: "basket-request-http",
    });
    expect(conflict.status).toBe(400);
    expect(fixture.sent).toHaveLength(3);
  });

  it("does not resend an uncertain HTTP command through MCP", async () => {
    const fixture = makeHttpShoppingFixture();
    fixture.setUnauthorized();
    const app = setup(await Effect.runPromise(fixture.program));
    const input = {
      items: [{ productId: "123", quantity: 2, unit: "pcs" }],
      requestId: "uncertain-request-http",
    };
    const first = await post(app, "set_basket_items", input);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ outcome: "uncertain" });
    const client = await connect(app.fetch);
    try {
      const retry = await client.callTool({
        arguments: input,
        name: "set_basket_items",
      });
      expect(retry.structuredContent).toMatchObject({ outcome: "uncertain" });
      expect(fixture.sent).toEqual(["SetPrivateBasketItems"]);
    } finally {
      await client.close();
    }
  });

  it("shares frozen checkout reviews, rejects tampering and consumes each handoff once across transports", async () => {
    const fixture = makeHttpShoppingFixture();
    const app = setup(await Effect.runPromise(fixture.program));
    const client = await connect(app.fetch);
    try {
      const prepared = await post(app, "prepare_checkout", {});
      const review = Schema.decodeUnknownSync(Shopping.CheckoutReview)(
        await prepared.json()
      );
      const tampered = await client.callTool({
        arguments: {
          review: { ...review, basket: { ...review.basket, guidePrice: 0 } },
        },
        name: "approve_checkout_handoff",
      });
      expect(tampered.isError).toBe(true);
      const approved = await post(app, "approve_checkout_handoff", { review });
      expect(approved.status).toBe(200);
      expect(await approved.json()).toMatchObject({ orderPlaced: false });
      const reused = await client.callTool({
        arguments: { review },
        name: "approve_checkout_handoff",
      });
      expect(reused.isError).toBe(true);
      const next = await client.callTool({
        arguments: {},
        name: "prepare_checkout",
      });
      const nextReview = Schema.decodeUnknownSync(Shopping.CheckoutReview)(
        next.structuredContent
      );
      const invalid = await post(app, "approve_checkout_handoff", {
        review: { ...nextReview, fingerprint: "forged" },
      });
      expect(invalid.status).toBe(400);
      const valid = await client.callTool({
        arguments: { review: nextReview },
        name: "approve_checkout_handoff",
      });
      expect(valid.structuredContent).toMatchObject({ orderPlaced: false });
      expect(fixture.sent).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("bounds and validates JSON before service invocation, and redacts upstream failures", async () => {
    const app = setup();
    await Promise.all(
      [{ count: 49, query: "milk" }, { approved: true, query: "milk" }, {}].map(
        async (input) => {
          const invalid = await post(app, "search_products", input);
          expect(invalid.status).toBe(400);
        }
      )
    );
    await Promise.all(
      ["not-json", "x".repeat(65_537)].map(async (body) => {
        const invalid = await app.fetch(
          "https://tesco.test/v1/search_products",
          {
            body,
            headers: {
              authorization: `Bearer ${executorToken}`,
              "content-type": "application/json",
            },
            method: "POST",
          }
        );
        expect(invalid.status).toBe(400);
      })
    );
    expect(app.search).not.toHaveBeenCalled();
    const wrongMethod = await app.fetch(
      "https://tesco.test/v1/search_products",
      {
        headers: { authorization: `Bearer ${executorToken}` },
      }
    );
    expect(wrongMethod.status).toBe(405);
    const missingJson = await app.fetch(
      "https://tesco.test/v1/search_products",
      {
        body: "{}",
        headers: { authorization: `Bearer ${executorToken}` },
        method: "POST",
      }
    );
    expect(missingJson.status).toBe(415);
    const unavailable = setup({
      search: () =>
        Effect.fail(new TescoSessionFailure({ reason: "authentication" })),
    });
    const result = await post(unavailable, "search_products", {
      query: "milk",
    });
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({
      error: "tesco_reauthentication_required",
    });
  });
});

describe("private Tesco HTTP cancellation", () => {
  it("interrupts a scoped read when the HTTP caller aborts", async () => {
    let started = false;
    let released = false;
    const app = setup({
      search: () =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            started = true;
          }),
          () => Effect.never,
          () =>
            Effect.sync(() => {
              released = true;
            })
        ),
    });
    const abort = new AbortController();
    const call = app.fetch("https://tesco.test/v1/search_products", {
      body: JSON.stringify({ query: "milk" }),
      headers: {
        authorization: `Bearer ${executorToken}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: abort.signal,
    });
    const rejected = expect(call).rejects.toBeDefined();
    try {
      await vi.waitFor(() => expect(started).toBe(true));
      abort.abort();
      await rejected;
      await vi.waitFor(() => expect(released).toBe(true));
    } finally {
      abort.abort();
    }
  });
});
