import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Schema } from "effect";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import {
  TescoConnectionHealth,
  TescoSessionReport,
} from "../apps/api/src/features/tesco/mcp/session.model.js";

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
let rotations = 0;
const renewalSteps: string[] = [];
const expiryCookie = (accessAt: number) =>
  encodeURIComponent(
    JSON.stringify({
      AccessToken: accessAt,
      RefreshToken: Date.now() + 86_400_000,
    })
  );
const cookie = (name: string, value: string, cookiePath = "/") => ({
  domain: ".tesco.ie",
  expires: -1,
  name,
  path: cookiePath,
  secure: true,
  value,
});
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
    outboundService: (request) => {
      const url = new URL(request.url);
      if (url.origin === "https://xapi.tesco.com") {
        if (
          request.headers.get("authorization") !==
          `Bearer fixture-access-${rotations}`
        ) {
          return new Response(null, { status: 401 });
        }
        return Response.json({
          data: {
            search: {
              info: { total: 1 },
              pageInformation: { count: 1, pageNo: 1, pageSize: 1, total: 1 },
              results: [
                {
                  node: {
                    __typename: "ProductType",
                    id: "fixture-product",
                    title: "Fixture milk",
                  },
                },
              ],
            },
          },
          status: 200,
        });
      }
      assert.equal(url.origin, "https://www.tesco.ie");
      renewalSteps.push(url.pathname);
      const cookies = request.headers.get("cookie") ?? "";
      assert.ok(
        cookies.includes(`OAuth.RefreshToken=fixture-refresh-${rotations}`)
      );
      assert.ok(cookies.includes("OAuth.Sid=fixture-sid"));
      if (url.pathname === "/account/login/en-IE") {
        const headers = new Headers({
          location: "/account/auth/en-IE/refresh-token",
        });
        headers.append(
          "set-cookie",
          "renewalFlow=fixture; Path=/account; Secure"
        );
        headers.append(
          "set-cookie",
          "renewalFlow=global-fixture; Path=/; Secure"
        );
        return new Response(null, { headers, status: 302 });
      }
      assert.equal(url.pathname, "/account/auth/en-IE/refresh-token");
      assert.ok(
        cookies.includes("renewalFlow=fixture"),
        "Missing account-path redirect cookie"
      );
      assert.ok(
        cookies.includes("renewalFlow=global-fixture"),
        "Missing root-path redirect cookie"
      );
      rotations += 1;
      const headers = new Headers({
        location: "/shop/en-IE/landing/groceries",
      });
      headers.append(
        "set-cookie",
        `OAuth.AccessToken=fixture-access-${rotations}; Domain=.tesco.ie; Path=/; Secure`
      );
      headers.append(
        "set-cookie",
        `OAuth.RefreshToken=fixture-refresh-${rotations}; Domain=.tesco.ie; Path=/; Secure`
      );
      headers.append(
        "set-cookie",
        `OAuth.TokensExpiryTime=${expiryCookie(Date.now() + (rotations < 3 ? 123_000 : 3_600_000))}; Domain=.tesco.ie; Path=/; Secure`
      );
      return new Response(null, { headers, status: 302 });
    },
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
  const enrolled = await fetch(new URL("/admin/session", url), {
    body: JSON.stringify({
      authorization: "Bearer fixture-access-0",
      cookies: [
        cookie("OAuth.AccessToken", "fixture-access-0"),
        cookie("OAuth.RefreshToken", "fixture-refresh-0"),
        cookie("OAuth.TokensExpiryTime", expiryCookie(Date.now() + 123_000)),
        cookie("OAuth.Sid", "fixture-sid", "/account"),
      ],
      mangoApiKey: "fixture-api-key",
      mangoUrl: "https://xapi.tesco.com/",
    }),
    headers: {
      authorization: `Bearer ${operatorToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  assert.equal(enrolled.status, 200);
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const deadline = Date.now() + 10_000;
    let current;
    do {
      // eslint-disable-next-line no-await-in-loop -- Polling observes the real workerd alarm's completion.
      await setTimeout(500);
      // eslint-disable-next-line no-await-in-loop -- Each observation depends on the preceding alarm state.
      const healthResult = await client.callTool({
        arguments: {},
        name: "connection_status",
      });
      current = Schema.decodeUnknownSync(TescoConnectionHealth)(
        healthResult.structuredContent
      );
      assert.equal(
        current?.state,
        "connected",
        `Alarm renewal failed: ${JSON.stringify({ current, renewalSteps, rotations })}`
      );
      if (rotations >= cycle) {
        break;
      }
    } while (Date.now() < deadline);
    assert.equal(rotations, cycle, "Scheduled renewal did not run");
    assert.equal(current?.state, "connected");
    assert.notEqual(current.lastRefreshedAt, null);
  }
  const afterRenewal = await client.callTool({
    arguments: { count: 1, query: "milk" },
    name: "search_products",
  });
  assert.notEqual(afterRenewal.isError, true);
  const reportResponse = await fetch(new URL("/admin/session", url), {
    headers: { authorization: `Bearer ${operatorToken}` },
  });
  assert.equal(reportResponse.status, 200);
  const report = Schema.decodeUnknownSync(TescoSessionReport)(
    await reportResponse.json()
  );
  assert.equal(report.hasEncryptedSession, true);
  assert.equal(report.renewals.length, 3);
  assert.equal(
    report.alarmAt,
    (report.health.accessTokenExpiresAt ?? 0) - 120_000
  );
  for (const [index, attempt] of report.renewals.entries()) {
    assert.equal(attempt.result, "renewed");
    assert.equal(attempt.tokenChanged, true);
    assert.equal(attempt.refreshCookieChanged, true);
    assert.equal(attempt.steps.at(0)?.repeatedNames, true);
    assert.deepEqual(
      attempt.steps.map((step) => step.status),
      [302, 302]
    );
    if (index > 0) {
      assert.equal(
        attempt.previousAccessTokenExpiresAt,
        report.renewals.at(index - 1)?.accessTokenExpiresAt
      );
    }
  }
  assert.equal(JSON.stringify(report).includes("fixture-"), false);
  console.log(
    "Tesco native runtime: authentication, discovery and three scheduled persisted session renewals passed."
  );
} finally {
  await client.close();
  await runtime.dispose();
}
