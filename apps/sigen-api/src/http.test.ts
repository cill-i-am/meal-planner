/* eslint-disable no-await-in-loop -- Exercise successive calls on the same MCP session and admission policy. */
import { createHash } from "node:crypto";

import { SerialNumber, StationId, failure } from "@meal-planner/sigen";
import { Command } from "@meal-planner/sigen/controls";
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
const serialNumber = Schema.decodeUnknownSync(SerialNumber)("AIO-1");
const command = Schema.decodeUnknownSync(Command)({
  phase: { status: "prepared" },
  review: {
    change: {
      limit: { kind: "limited", watts: 2000 },
      operation: "set_solar_power_limit",
    },
    commandId: "3eae3bc8-a13e-4b37-a2ab-77bd565d598a",
    current: {
      kind: "solar",
      settings: {
        fetchedAt: 1,
        powerLimit: { kind: "unlimited" },
        stationId: id,
      },
    },
    expiresAt: 300_001,
    preparedAt: 1,
    reviewFingerprint: "a".repeat(64),
    stationId: id,
  },
});
const tax = {
  taxSettings: { enableNegativePriceTax: false, fixedTaxRate: 0, taxMode: 0 },
};
const status = {
  accessTokenExpiresAt: 123_456,
  controls: "disabled_pending_acceptance" as const,
  state: "connected" as const,
  stationId: id,
  successfulRenewals: 2,
};
const options: HttpOptions = {
  capabilities: {
    aioDevices: (stationId) =>
      Effect.succeed({ fetchedAt: 123, serialNumbers: [], stationId }),
    aioPowerStatus: (input) =>
      Effect.succeed({
        ...input,
        fetchedAt: 123,
        onOffState: false,
        powerOn: true,
      }),
    alarms: (input) =>
      Effect.succeed({
        fetchedAt: 123,
        page: input.page,
        pageSize: input.pageSize,
        pages: 0,
        records: [],
        state: input.state,
        stationId: input.stationId,
        total: 0,
      }),
    approvalGrants: () => Effect.succeed({ grants: [] }),
    approveCommand: () => Effect.succeed(command),
    automationSettings: (stationId) =>
      Effect.succeed({
        batteryEnabled: false,
        batteryGroups: [],
        fetchedAt: 123,
        gridEnabled: false,
        gridGroups: [],
        profileName: "Fixture",
        providerActiveStatus: 0,
        providerProfileId: null,
        stationId,
        timezone: "Europe/Dublin",
      }),
    batterySettings: (stationId) =>
      Effect.succeed({
        backupReservePercent: 20,
        backupSocPercent: 20,
        chargeLimit: { kind: "unlimited" },
        chargeSocPercent: 100,
        dischargeLimit: { kind: "unlimited" },
        dischargeSocPercent: 20,
        export: {
          effectiveEnabled: false,
          installerEnabled: null,
          ownerEnabled: null,
        },
        fetchedAt: 123,
        ja12SocPercent: 0,
        peakShavingSocPercent: null,
        providerOperationMode: 1,
        stationId,
      }),
    deviceInfo: (input) =>
      Effect.succeed({
        ...input,
        fetchedAt: 123,
        freshness: "unknown",
        parameters: [],
        providerDeviceType: 2,
        providerRunStatus: 1,
        providerTimestamp: null,
        softwareVersion: "1",
        staticParameters: [],
      }),
    deviceValues: (input) =>
      Effect.succeed({
        aioSerialNumber: input.serialNumber,
        fetchedAt: 123,
        readings: [],
        stationId: input.stationId,
      }),
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
    energyHistory: (input) =>
      Effect.succeed({
        endDate: input.date,
        fetchedAt: 123,
        flows: [],
        period: input.period,
        providerSignConvention: "provider_series",
        series: [],
        startDate: input.date,
        stationId: input.stationId,
        timezone: "Europe/Dublin",
        totals: [],
      }),
    executeCommand: () => Effect.succeed(command),
    forecast: (input) =>
      Effect.succeed({
        availability: "no_data",
        endDate: input.date,
        estimatedDate: "",
        fetchedAt: 123,
        period: input.period,
        providerStatus: 0,
        series: [],
        startDate: input.date,
        stationId: input.stationId,
        timezone: "Europe/Dublin",
      }),
    gateway: (stationId) =>
      Effect.succeed({
        fetchedAt: 123,
        generator: [],
        grid: [],
        inverter: [],
        model: "Fixture gateway",
        providerCommunicationStatus: 2,
        serialNumber,
        softwareVersion: "1",
        stationId,
      }),
    getCommand: () => Effect.succeed(command),
    gridDevices: (stationId) =>
      Effect.succeed({ devices: [], fetchedAt: 123, stationId }),
    gridSettings: (stationId) =>
      Effect.succeed({
        connectionCurrent: {
          effectiveAmps: null,
          enabled: false,
          installerAmps: null,
          ownerAmps: null,
        },
        exportPower: {
          effective: { kind: "unset" },
          enabled: false,
          installer: { kind: "unset" },
          owner: { kind: "unset" },
        },
        fetchedAt: 123,
        importPower: {
          effective: { kind: "unset" },
          enabled: false,
          installer: { kind: "unset" },
          owner: { kind: "unset" },
        },
        stationId,
      }),
    health: Effect.succeed(status),
    manualOverride: (stationId) =>
      Effect.succeed({
        batteryPowerW: 0,
        batterySocPercent: 20,
        enabled: false,
        fetchedAt: 123,
        providerEndTime: null,
        providerMode: null,
        stationId,
      }),
    operatingMode: (stationId) =>
      Effect.succeed({
        fetchedAt: 123,
        profileId: -1,
        providerMode: 999,
        stationId,
      }),
    operatingModes: (stationId) =>
      Effect.succeed({
        customProfiles: [],
        fetchedAt: 123,
        modes: [{ label: "Sigen AI", providerMode: "1" }],
        stationId,
      }),
    peakShavingSchedule: (stationId) =>
      Effect.succeed({
        fetchedAt: 123,
        providerControlMode: 0,
        reserveSocPercent: 0,
        slots: [],
        stationId,
        timezone: "Europe/Dublin",
      }),
    predictionPlan: () =>
      Effect.succeed({
        currencySymbol: "€",
        fetchedAt: 1,
        providerNowLocal: "2026-10-26 12:00",
        series: [],
        stationId: id,
        timezone: "Europe/Dublin",
      }),
    prepareCommand: () => Effect.succeed(command),
    revokeApproval: () => Effect.succeed({ grants: [] }),
    solarSettings: (stationId) =>
      Effect.succeed({
        fetchedAt: 123,
        powerLimit: { kind: "unlimited" },
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
    stationIncome: (input) =>
      Effect.succeed({
        ...input,
        currencySymbol: "€",
        fetchedAt: 123,
        providerAverage: 0,
        providerMaximum: 0,
        providerMinimum: 0,
        providerTotal: 0,
        samples: [],
        timezone: "Europe/Dublin",
      }),
    stationStatus: (stationId) =>
      Effect.succeed({
        devices: [],
        fetchedAt: 123,
        onGrid: true,
        providerNetworkType: 1,
        providerStatus: 1,
        stationId,
      }),
    tariffs: () =>
      Effect.succeed({
        buy: tax,
        currencySymbol: "€",
        fetchedAt: 1,
        priceModel: {
          buyCoefficient: 1,
          buyCost: 0,
          buyTaxAndFee: tax,
          sellCoefficient: 1,
          sellCost: 0,
          sellTaxAndFee: tax,
        },
        providerFeeUnits: "unverified",
        sell: tax,
        stationId: id,
      }),
    topology: (stationId) =>
      Effect.succeed({
        devices: [],
        fetchedAt: 123,
        providerStationStatus: 1,
        stationId,
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
        const inputForOperation = () => {
          if (op.name === "prepare_command") {
            return {
              change: command.review.change,
              commandId: command.review.commandId,
              stationId: id,
            };
          }
          if (op.name === "approve_command") {
            return {
              change: command.review.change,
              commandId: command.review.commandId,
              current: command.review.current,
              mode: "once",
              reviewFingerprint: command.review.reviewFingerprint,
              stationId: id,
            };
          }
          if (["get_command", "execute_command"].includes(op.name)) {
            return { commandId: command.review.commandId, stationId: id };
          }
          if (op.name === "revoke_approval_grant") {
            return { grantId: command.review.commandId, stationId: id };
          }
          if (op.name === "connection_status") {
            return {};
          }
          if (["get_energy_history", "get_forecast"].includes(op.name)) {
            return { date: "2026-10-25", period: "day", stationId: id };
          }
          if (op.name === "get_station_income") {
            return { date: "2026-10-25", stationId: id };
          }
          if (op.name === "list_alarms") {
            return { page: 1, pageSize: 10, state: "active", stationId: id };
          }
          if (
            [
              "get_device_info",
              "get_device_values",
              "get_aio_power_status",
            ].includes(op.name)
          ) {
            return { serialNumber, stationId: id };
          }
          return { stationId: id };
        };
        const input = inputForOperation();
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
