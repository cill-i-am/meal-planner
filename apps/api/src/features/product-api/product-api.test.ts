import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { productOpenApi } from "./product-api.contract.js";
import { makeProductMcpState } from "./product-mcp-state.js";
import { toolDefinitions } from "./product-mcp-tools.js";
import {
  productToolRequest,
  productToolSchema,
} from "./product-mcp-transport.js";
import { handleProductMcp } from "./product-mcp.js";
import {
  matchProductOperation,
  ProductOperations,
} from "./product-operations.js";

const operation = (name: string) => {
  const found = ProductOperations.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`Unknown fixture operation ${name}`);
  }
  return found;
};

describe("shared public contracts", () => {
  it("keeps the full contract discoverable within Durable Pi tool bounds", () => {
    expect(ProductOperations).toHaveLength(67);
    expect(new Set(ProductOperations.map(({ name }) => name)).size).toBe(67);
    for (const item of ProductOperations) {
      expect(item.name.length).toBeLessThanOrEqual(120);
      expect(
        JSON.stringify(productToolSchema(item)).length
      ).toBeLessThanOrEqual(32_000);
      expect(item.description.length).toBeLessThanOrEqual(2000);
    }
    const { paths } = productOpenApi();
    expect(
      paths["/v1/families/{familyId}/people/{personId}/profile"]?.post
    ).toBeDefined();
    expect(
      paths["/v1/recipe-import-intents/{id}/actions/{actionId}/confirm"]?.post
    ).toBeDefined();
    expect(paths["/imports/operator-provider-accounting"]).toBeUndefined();
  });

  it("requires the same complete private assistant mutation scope on HTTP and MCP", () => {
    const path = "/v1/agent-conversations/setup/turns";
    const name = "conversation_turns_setup";
    const scopes = [
      "meal-planner:assistant",
      "meal-planner:write",
      "meal-planner:private",
    ];
    expect(matchProductOperation("POST", path)).toBe(operation(name));
    expect(matchProductOperation("POST", path)?.scopes).toEqual(scopes);
    expect(productOpenApi().paths[path]?.post?.security).toEqual([
      { mealPlannerOAuth: scopes },
    ]);

    const partiallyAuthorized = toolDefinitions({
      permits: (required) => !required.includes("meal-planner:private"),
    });
    expect(
      partiallyAuthorized.find((tool) => tool.name === name)
    ).toBeUndefined();
    const authorized = toolDefinitions({
      permits: (required) => required.every((scope) => scopes.includes(scope)),
    });
    const tool = authorized.find((candidate) => candidate.name === name);
    expect(tool?._meta.securitySchemes).toEqual([{ scopes, type: "oauth2" }]);
  });

  it("requires explicit family context and forwards only authorized protocol fields", async () => {
    const parent = new Request("https://ceird.app/mcp", {
      headers: {
        authorization: "Bearer caller-token",
        cookie: "unrelated-session",
        "x-meal-planner-household": "wrong-family",
        "x-meal-planner-user": "spoofed-user",
      },
    });
    const item = operation("recipe_import_intents_create");
    await expect(
      Effect.runPromise(productToolRequest(item, {}, parent))
    ).rejects.toBeDefined();
    const request = await Effect.runPromise(
      productToolRequest(
        item,
        {
          familyId: "chosen-family",
          headers: { "idempotency-key": "import-request-1" },
          input: {
            source: {
              kind: "tiktok",
              url: "https://www.tiktok.com/@cook/video/1234567890123456789",
            },
          },
        },
        parent
      )
    );
    expect(request.headers.get("authorization")).toBe("Bearer caller-token");
    expect(request.headers.get("x-meal-planner-household")).toBe(
      "chosen-family"
    );
    expect(request.headers.get("cookie")).toBeNull();
    expect(request.headers.get("x-meal-planner-user")).toBeNull();
    expect(request.headers.get("idempotency-key")).toBe("import-request-1");
    expect(await request.json()).toEqual({
      source: {
        kind: "tiktok",
        url: "https://www.tiktok.com/@cook/video/1234567890123456789",
      },
    });
  });

  it("rejects forged metadata and path injection before dispatch", async () => {
    const parent = new Request("https://ceird.app/mcp");
    await expect(
      Effect.runPromise(
        productToolRequest(
          operation("families_get"),
          {
            authorization: "Bearer other",
            path: { familyId: "family-a" },
          },
          parent
        )
      )
    ).rejects.toBeDefined();
    const request = await Effect.runPromise(
      productToolRequest(
        operation("families_get"),
        { path: { familyId: "family/a?admin=true" } },
        parent
      )
    );
    expect(new URL(request.url).origin).toBe("https://ceird.app");
    expect(new URL(request.url).search).toBe("");
    expect(request.url).toContain("family%2Fa%3Fadmin%3Dtrue");
    expect(
      matchProductOperation("POST", "/imports/operator-provider-recovery")
    ).toBeUndefined();
    expect(
      matchProductOperation("GET", "/v1/recipe-import-intents/import-1")
    ).toBe(operation("recipe_import_intents_get"));
  });
});

describe("MCP transport", () => {
  it("negotiates an official client, filters scopes and preserves native result/errors", async () => {
    const calls: Request[] = [];
    const state = await Effect.runPromise(
      makeProductMcpState({
        owner: { clientId: "contract-client", userId: "contract-user" },
        secret: Redacted.make(
          "local-mcp-contract-secret-at-least-32-characters"
        ),
      })
    );
    const client = new Client({ name: "contract-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://ceird.app/mcp"),
      {
        fetch: (url, init) =>
          Effect.runPromise(
            handleProductMcp(new Request(url, init), {
              call: (request) =>
                Effect.sync(() => {
                  calls.push(request);
                  return Response.json([{ id: "family-a", name: "Family" }]);
                }),
              permits: (scopes) =>
                scopes.every((scope) => scope === "meal-planner:read"),
              state,
            }).pipe(Effect.scoped)
          ),
      }
    );
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.some(({ name }) => name === "families_list")).toBe(
        true
      );
      expect(tools.tools.some(({ name }) => name === "families_create")).toBe(
        false
      );
      const result = await client.callTool({
        arguments: {},
        name: "families_list",
      });
      expect(result.structuredContent).toEqual({
        httpStatus: 200,
        result: [{ id: "family-a", name: "Family" }],
        retryAfter: null,
      });
      expect(calls).toHaveLength(1);
      const denied = await client.callTool({
        arguments: {},
        name: "families_create",
      });
      expect(denied.isError).toBe(true);
      expect(calls).toHaveLength(1);
    } finally {
      await client.close();
    }
  });
});
