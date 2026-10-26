/* eslint-disable no-await-in-loop -- Exercise successive calls on the same MCP session and admission policy. */
import { createHash } from "node:crypto";

import { StationId, failure } from "@meal-planner/sigen";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { operations } from "./contracts.js";
import { makeHttpHandler } from "./http.js";
import type { HttpOptions } from "./http.js";

const owner = "a".repeat(64);
const operator = "b".repeat(64);
const hash = (value: string) =>
  Redacted.make(createHash("sha256").update(value).digest("hex"));
const id = Schema.decodeUnknownSync(StationId)("12345");
const status = {
  accessTokenExpiresAt: 123_456,
  controls: "disabled_pending_acceptance" as const,
  state: "connected" as const,
  stationId: id,
  successfulRenewals: 2,
};
const options: HttpOptions = {
  capabilities: {
    energyFlow: (stationId) =>
      Effect.succeed({
        batteryPowerConvention: "positive_charge_negative_discharge",
        batteryPowerW: -200,
        batterySocPercent: 38.5,
        fetchedAt: 123,
        freshness: "unknown",
        gridPowerConvention: "provider_sign_unverified",
        gridPowerW: 0,
        loadPowerW: 600,
        onGrid: true,
        providerStatus: 1,
        providerTimestamp: null,
        solarPowerW: 400,
        stationId,
      }),
    health: Effect.succeed(status),
    operatingMode: (stationId) =>
      Effect.succeed({
        fetchedAt: 123,
        profileId: -1,
        providerMode: 999,
        stationId,
      }),
    station: (stationId) =>
      Effect.succeed({
        batteryCapacityKwh: 8.1,
        capabilities: {
          acCharger: "unavailable",
          dcCharger: "unavailable",
          gateway: "available",
          solar: "available",
        },
        fetchedAt: 123,
        name: "Fixture station",
        onGrid: true,
        providerStatus: 1,
        solarCapacityKw: 5.7,
        stationId,
        timezone: "Europe/Dublin",
      }),
  },
  disconnect: Effect.void,
  enroll: () => Effect.succeed(status),
  operatorHash: hash(operator),
  ownerHash: hash(owner),
  rateLimit: Effect.succeed(true),
  report: Effect.succeed({ health: status, renewals: [] }),
};
const run = <A, E>(program: Effect.Effect<A, E>) =>
  Effect.runPromise(program.pipe(Effect.scoped));
const request = (
  path: string,
  bearer = owner,
  body: object = {},
  method = "POST"
) => {
  const init: RequestInit = {
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    method,
  };
  if (method !== "GET") {
    init.body = JSON.stringify(body);
  }
  return new Request(`https://sigen.test${path}`, init);
};

describe("authenticated HTTP and MCP parity", () => {
  it("joins request cleanup when the HTTP caller disconnects", async () => {
    const controller = new AbortController();
    let released = false;
    const handler = makeHttpHandler({
      ...options,
      capabilities: {
        ...options.capabilities,
        health: Effect.acquireUseRelease(
          Effect.sync(() => controller.abort()),
          () => Effect.never,
          () =>
            Effect.sync(() => {
              released = true;
            })
        ),
      },
    });
    const input = new Request(request("/v1/connection_status"), {
      signal: controller.signal,
    });
    await expect(run(handler(input))).rejects.toBeDefined();
    expect(released).toBe(true);
  });

  it("joins asynchronous MCP tool cleanup before ending an aborted request", async () => {
    const controller = new AbortController();
    let released = false;
    const handler = makeHttpHandler({
      ...options,
      capabilities: {
        ...options.capabilities,
        health: Effect.acquireUseRelease(
          Effect.sync(() => controller.abort()),
          () => Effect.never,
          () =>
            Effect.sleep("30 millis").pipe(
              Effect.andThen(
                Effect.sync(() => {
                  released = true;
                })
              )
            )
        ),
      },
    });
    const input = new Request(
      request("/mcp", owner, {
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "connection_status" },
      }),
      { signal: controller.signal }
    );
    input.headers.set("accept", "application/json, text/event-stream");
    await expect(run(handler(input))).rejects.toBeDefined();
    expect(released).toBe(true);
  });

  it("uses identical contracts for all four HTTP and actual SDK MCP calls", async () => {
    const handler = makeHttpHandler(options);
    const client = new Client({ name: "sigen-verification", version: "1" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://sigen.test/mcp"),
      {
        fetch: (input, init) => run(handler(new Request(input, init))),
        requestInit: { headers: { authorization: `Bearer ${owner}` } },
      }
    );
    try {
      // @ts-expect-error SDK 1.32.1's concrete transport includes undefined in sessionId; Transport omits it under exactOptionalPropertyTypes.
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        operations.map((op) => op.name)
      );
      for (const op of operations) {
        const input = op.name === "connection_status" ? {} : { stationId: id };
        const http = await run(
          handler(request(`/v1/${op.name}`, owner, input))
        );
        const mcp = await client.callTool({ arguments: input, name: op.name });
        expect(http.status).toBe(200);
        expect(mcp.structuredContent).toEqual(await http.json());
      }
    } finally {
      await client.close();
    }
  });

  it("authenticates before discovery or enrollment and separates owner from operator", async () => {
    const handler = makeHttpHandler(options);
    for (const path of ["/mcp", "/openapi.json", "/v1/connection_status"]) {
      const invalid = await run(handler(request(path, "c".repeat(64))));
      const wrongRole = await run(handler(request(path, operator)));
      expect(invalid.status).toBe(401);
      expect(wrongRole.status).toBe(401);
    }
    const ownerAdmin = await run(
      handler(request("/admin/session", owner, {}, "GET"))
    );
    const operatorAdmin = await run(
      handler(request("/admin/session", operator, {}, "GET"))
    );
    expect(ownerAdmin.status).toBe(401);
    expect(operatorAdmin.status).toBe(200);
  });

  it("rejects browser origins, oversized bodies and unknown parameters", async () => {
    const handler = makeHttpHandler(options);
    const browserRequest = request("/v1/connection_status");
    browserRequest.headers.set("origin", "https://untrusted.invalid");
    const browserResponse = await run(handler(browserRequest));
    expect(browserResponse.status).toBe(403);
    for (const input of [
      { approved: true, stationId: id },
      { stationId: "../admin" },
      { junk: "x".repeat(65_536) },
    ]) {
      const response = await run(
        handler(request("/v1/get_station", owner, input))
      );
      expect(response.status).toBe(400);
    }
  });

  it("retains typed failures and does not expose provider diagnostics", async () => {
    const handler = makeHttpHandler({
      ...options,
      capabilities: {
        ...options.capabilities,
        station: () => Effect.fail(failure("AuthenticationRequired")),
      },
    });
    const response = await run(
      handler(request("/v1/get_station", owner, { stationId: id }))
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "AuthenticationRequired" });
  });

  it("publishes the same operation schemas without enrollment or credentials", async () => {
    const response = await run(
      makeHttpHandler(options)(request("/openapi.json", owner, {}, "GET"))
    );
    const text = await response.text();
    for (const op of operations) {
      expect(text).toContain(`/v1/${op.name}`);
    }
    expect(text).not.toContain("password");
    expect(text).not.toContain("/admin/session");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("applies admission limits to both transports", async () => {
    const handler = makeHttpHandler({
      ...options,
      rateLimit: Effect.succeed(false),
    });
    for (const path of ["/mcp", "/v1/get_station"]) {
      const response = await run(handler(request(path)));
      expect(response.status).toBe(429);
    }
  });
});
