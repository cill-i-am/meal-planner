import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

// This process boundary tests the real Alchemy bundle in workerd with synthetic credentials only.
// Build it first with `alchemy plan tesco.alchemy.ts --stage prod ...`.
const directory = path.resolve(".alchemy/bundles/TescoMcp-prod-TescoMcp");
const files = await readdir(directory);
const chunks = files.filter(
  (file) => file.endsWith(".js") && file !== "worker.js"
);
const executorToken = "e".repeat(64);
const operatorToken = "f".repeat(64);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const secret = (value: string) => JSON.stringify({ _tag: "Redacted", value });
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    bindings: {
      ALCHEMY_CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
      ALCHEMY_PHASE: "runtime",
      ALCHEMY_STACK_NAME: "TescoMcp",
      ALCHEMY_STAGE: "prod",
      ALCHEMY_WORKER_NAME: "tesco-mcp",
      TESCO_EXECUTOR_TOKEN_SHA256: secret(hash(executorToken)),
      TESCO_OPERATOR_TOKEN_SHA256: secret(hash(operatorToken)),
      TESCO_SESSION_ENCRYPTION_KEY: secret("a".repeat(64)),
    },
    compatibilityDate: "2026-10-18",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      TescoSessionObject: { className: "TescoSessionObject", useSQLite: true },
    },
    host: "127.0.0.1",
    modules: ["worker.js", ...chunks].map((file) => ({
      path: path.join(directory, file),
      type: "ESModule",
    })),
    modulesRoot: directory,
    port: 0,
    ratelimits: {
      TESCO_MCP_LIMIT: {
        namespace_id: "61803",
        simple: { limit: 60, period: 60 },
      },
    },
  })
);
const client = new Client({ name: "tesco-runtime-smoke", version: "1.0.0" });
try {
  const url = new URL("/mcp", await runtime.ready);
  const anonymous = await fetch(url, { method: "POST" });
  assert.equal(anonymous.status, 401);
  const wrongPrincipal = await fetch(url, {
    headers: { authorization: `Bearer ${operatorToken}` },
    method: "POST",
  });
  assert.equal(wrongPrincipal.status, 401);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${executorToken}` } },
  });
  // SDK 1.32.1's concrete getter includes undefined; its Transport interface omits it.
  // @ts-expect-error -- Upstream exactOptionalPropertyTypes mismatch.
  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).toSorted(), [
    "approve_checkout_handoff",
    "connection_status",
    "get_basket",
    "get_order_details",
    "get_product_details",
    "list_category_products",
    "list_delivery_slots",
    "list_favourites",
    "list_previous_orders",
    "prepare_checkout",
    "release_delivery_slot",
    "reserve_delivery_slot",
    "search_products",
    "set_basket_items",
    "suggest_products",
  ]);
  assert.ok(
    listed.tools
      .filter(
        (tool) =>
          ![
            "approve_checkout_handoff",
            "prepare_checkout",
            "release_delivery_slot",
            "reserve_delivery_slot",
            "set_basket_items",
          ].includes(tool.name)
      )
      .every((tool) => tool.annotations?.readOnlyHint === true)
  );
  const health = await client.callTool({
    arguments: {},
    name: "connection_status",
  });
  assert.deepEqual(health.structuredContent, {
    accessTokenExpiresAt: null,
    lastRefreshedAt: null,
    nextRefreshAt: null,
    state: "not_connected",
  });
  const catalogue = await client.callTool({
    arguments: { query: "milk" },
    name: "search_products",
  });
  assert.equal(catalogue.isError, true);
  assert.deepEqual(catalogue.content, [
    {
      text: "Tesco needs an operator to sign in again. Check connection_status; agents cannot supply or read Tesco credentials.",
      type: "text",
    },
  ]);
  console.log(
    "Tesco native runtime: authentication, discovery, durable health and missing-session handling passed."
  );
} finally {
  await client.close();
  await runtime.dispose();
}
