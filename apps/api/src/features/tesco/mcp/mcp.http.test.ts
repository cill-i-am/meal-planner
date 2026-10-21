import { createHash } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  CatalogueProductResults,
  CatalogueSuggestions,
} from "../catalogue/catalogue.model.js";
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

const setup = (overrides: Partial<TescoMcpCapabilities> = {}) => {
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
  const rateLimit = vi.fn(() => Effect.succeed(true));
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
