import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

import { NodeServices } from "@effect/platform-node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Context, Effect, Schema } from "effect";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { expect, it } from "vitest";

import { WorkerBundle } from "../node_modules/alchemy/lib/Cloudflare/Workers/Sources/Rolldown.js";
import { Command } from "../packages/sigen/src/controls.js";

const owner = "a".repeat(64);
const operator = "b".repeat(64);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const secret = (value: string) => JSON.stringify({ _tag: "Redacted", value });

it(
  "runs the actual Sigen bundle, encrypted RPC and three scheduled renewals in workerd",
  { timeout: 60_000 },
  async () => {
    const bundler = await Effect.runPromise(
      WorkerBundle.pipe(Effect.provide(NodeServices.layer))
    );
    const bundle = await Effect.runPromise(
      bundler
        .build({
          compatibility: { date: "2026-10-19", flags: ["nodejs_compat"] },
          entry: {
            exports: {
              SigenAccountObject: {
                constructor: Effect.succeed(Effect.succeed({})),
                kind: "durableObject",
                services: Context.empty(),
              },
            },
            kind: "effect",
          },
          extraOptions: {},
          id: "SigenRuntimeCheck",
          main: new URL("../apps/sigen-api/src/worker.ts", import.meta.url)
            .href,
          stack: { name: "SigenApi", stage: "prod" },
        })
        .pipe(Effect.provide(NodeServices.layer))
    );
    const persistence = await mkdtemp(path.join(tmpdir(), "sigen-runtime-"));
    let renewals = 0;
    let solarPowerLimit = "4294967.295";
    let physicalWrites = 0;
    const makeRuntime = (controlsEnabled = false) =>
      new Miniflare(
        convertV4MiniflareOptions({
          bindings: {
            ALCHEMY_CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
            ALCHEMY_PHASE: "runtime",
            ALCHEMY_STACK_NAME: "SigenApi",
            ALCHEMY_STAGE: "prod",
            ALCHEMY_WORKER_NAME: "sigen-api",
            SIGEN_CONTROLS_ENABLED: secret(String(controlsEnabled)),
            SIGEN_OPERATOR_TOKEN_SHA256: secret(hash(operator)),
            SIGEN_OWNER_TOKEN_SHA256: secret(hash(owner)),
            SIGEN_SESSION_ENCRYPTION_KEY: secret("c".repeat(64)),
          },
          compatibilityDate: "2026-10-19",
          compatibilityFlags: ["nodejs_compat"],
          durableObjects: {
            SigenAccountObject: {
              className: "SigenAccountObject",
              useSQLite: true,
            },
          },
          host: "127.0.0.1",
          modules: bundle.files
            .filter((file) => file.path.endsWith(".js"))
            .map((file) => ({
              contents: file.content,
              path: file.path,
              type: "ESModule" as const,
            })),
          modulesRoot: path.dirname(bundle.files[0].path),
          outboundService: async (request) => {
            const url = new URL(request.url);
            expect(url.origin).toBe("https://api-eu.sigencloud.com");
            if (url.pathname === "/auth/oauth/token") {
              const form = new URLSearchParams(await request.text());
              if (form.get("username") === "rejected@example.invalid") {
                return new Response("SECRET provider rejection", {
                  status: 403,
                });
              }
              if (form.get("grant_type") === "refresh_token") {
                expect(form.get("refresh_token")).toBe(`refresh-${renewals}`);
                renewals += 1;
              } else {
                expect(form.get("grant_type")).toBe("password");
                expect(form.get("password")).not.toBe("fixture-password");
              }
              return Response.json({
                access_token: `access-${renewals}`,
                expires_in: renewals < 3 ? 61 : 3600,
                refresh_token: `refresh-${renewals}`,
              });
            }
            expect(request.headers.get("authorization")).toBe(
              `Bearer access-${renewals}`
            );
            if (url.pathname === "/device/owner/station/home") {
              return Response.json({
                code: 0,
                data: {
                  batteryCapacity: 8.1,
                  dcSnList: [],
                  hasAcCharger: false,
                  hasGateway: true,
                  hasSolar: true,
                  onGrid: true,
                  pvCapacity: 5.7,
                  stationId: 12_345,
                  stationName: "Fixture station",
                  status: 1,
                  timeZoneName: "Europe/Dublin",
                },
              });
            }
            expect(request.headers.get("sg-pkg")).toBe("sigen_app");
            if (url.pathname === "/device/sigen/station/energyflow") {
              return Response.json({
                code: 0,
                data: {
                  batteryPower: -0.2,
                  batterySoc: 38.5,
                  buySellPower: 0,
                  dateCurrTimeStamp: "",
                  loadPower: 0.6,
                  onGrid: true,
                  pvPower: 0.4,
                  stationStatus: 1,
                },
              });
            }
            if (url.pathname === "/device/energy-profile/solar/limit/12345") {
              return Response.json({
                code: 0,
                data: { powerLimit: solarPowerLimit },
              });
            }
            if (
              url.pathname === "/device/energy-profile/solar/limit" &&
              request.method === "PUT"
            ) {
              const body = Schema.decodeUnknownSync(
                Schema.Struct({ powerLimit: Schema.String })
              )(await request.json());
              solarPowerLimit = body.powerLimit;
              physicalWrites += 1;
              return Response.json({ code: 0, data: null });
            }
            if (url.pathname === "/alarm/history/page") {
              return Response.json({
                code: 0,
                data: { current: 1, pages: 0, records: [], size: 10, total: 0 },
              });
            }
            if (
              url.pathname ===
              "/data-process/sigen/station/statistics/v1/energy"
            ) {
              return Response.json({
                code: 0,
                data: {
                  chartData: {
                    dataSeries: [
                      {
                        id: "GRID",
                        points: [{ time: "20261025 01:30", value: 1 }],
                      },
                    ],
                    unit: "kW",
                  },
                  sankeyData: { links: [] },
                  stationCards: [],
                },
              });
            }
            if (
              url.pathname ===
              "/data-process/sigen/station/ai/all/prediction/v1"
            ) {
              return Response.json({
                code: 0,
                data: {
                  chartData: { dataSeries: [], unit: "" },
                  estimatedDate: "",
                  status: 0,
                },
              });
            }
            throw new Error("Unexpected provider request");
          },
          port: 0,
          ratelimits: {
            SIGEN_OWNER_LIMIT: {
              namespace_id: "61804",
              simple: { limit: 30, period: 60 },
            },
          },
          resourcePersistencePath: persistence,
        })
      );
    let runtime = makeRuntime();
    const client = new Client({ name: "sigen-runtime-check", version: "1" });
    try {
      const url = new URL("/mcp", await runtime.ready);
      const anonymous = await fetch(url, { method: "POST" });
      expect(anonymous.status).toBe(401);
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { authorization: `Bearer ${owner}` } },
      });
      // @ts-expect-error SDK 1.32.1's sessionId getter disagrees with Transport under exactOptionalPropertyTypes.
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(30);
      const initial = await client.callTool({
        arguments: {},
        name: "connection_status",
      });
      expect(initial.structuredContent).toMatchObject({
        state: "disconnected",
      });
      const rejected = await fetch(new URL("/admin/session", url), {
        body: JSON.stringify({
          password: "fixture-password",
          stationId: "12345",
          username: "rejected@example.invalid",
        }),
        headers: {
          authorization: `Bearer ${operator}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      expect(rejected.status).toBe(403);
      expect(await rejected.json()).toEqual({
        error: "PermissionDenied",
        upstreamHttpStatus: 403,
      });
      const enrolled = await fetch(new URL("/admin/session", url), {
        body: JSON.stringify({
          password: "fixture-password",
          stationId: "12345",
          username: "fixture@example.invalid",
        }),
        headers: {
          authorization: `Bearer ${operator}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      expect(enrolled.status).toBe(200);
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (renewals >= 3) {
          break;
        }
        // eslint-disable-next-line no-await-in-loop -- Wait for real workerd alarms rather than manually forcing expiry.
        await setTimeout(250);
      }
      expect(renewals).toBe(3);
      const station = await client.callTool({
        arguments: { stationId: "12345" },
        name: "get_station",
      });
      expect(station.structuredContent).toMatchObject({
        name: "Fixture station",
      });
      const solar = await client.callTool({
        arguments: { stationId: "12345" },
        name: "get_solar_settings",
      });
      expect(solar.structuredContent).toMatchObject({
        powerLimit: { kind: "unlimited" },
      });
      const history = await client.callTool({
        arguments: { date: "2026-10-25", period: "day", stationId: "12345" },
        name: "get_energy_history",
      });
      expect(history.structuredContent).toMatchObject({
        series: [
          {
            samples: [
              {
                utcCandidates: [1_792_888_200_000, 1_792_891_800_000],
                value: 1000,
              },
            ],
            unit: "W",
          },
        ],
        timezone: "Europe/Dublin",
      });
      const alarms = await client.callTool({
        arguments: {
          endAt: 1_792_972_799_000,
          page: 1,
          pageSize: 10,
          startAt: 1_792_886_400_000,
          state: "history",
          stationId: "12345",
        },
        name: "list_alarms",
      });
      expect(alarms.structuredContent).toMatchObject({
        records: [],
        state: "history",
        total: 0,
      });
      const forecast = await client.callTool({
        arguments: { date: "2026-10-25", period: "day", stationId: "12345" },
        name: "get_forecast",
      });
      expect(forecast.structuredContent).toMatchObject({
        availability: "no_data",
        series: [],
      });
      const commandId = "cc049ab9-7a31-4143-b238-7a132a04c98f";
      const preparedResult = await client.callTool({
        arguments: {
          change: {
            limit: { kind: "limited", watts: 2000 },
            operation: "set_solar_power_limit",
          },
          commandId,
          stationId: "12345",
        },
        name: "prepare_command",
      });
      const prepared = Schema.decodeUnknownSync(Command)(
        preparedResult.structuredContent
      );
      expect(prepared.phase.status).toBe("prepared");
      const approval = await client.callTool({
        arguments: {
          change: prepared.review.change,
          commandId,
          current: prepared.review.current,
          mode: "always",
          reviewFingerprint: prepared.review.reviewFingerprint,
          stationId: "12345",
        },
        name: "approve_command",
      });
      expect(approval.structuredContent).toMatchObject({
        phase: { approval: { kind: "grant" }, status: "approved" },
      });
      const disabled = await client.callTool({
        arguments: { commandId, stationId: "12345" },
        name: "execute_command",
      });
      expect(disabled.isError).toBe(true);
      expect(disabled.content).toMatchObject([
        { text: "UnsupportedCapability" },
      ]);
      await client.close();
      await runtime.dispose();
      runtime = makeRuntime(true);
      const restored = await fetch(
        new URL("/v1/connection_status", await runtime.ready),
        {
          body: "{}",
          headers: {
            authorization: `Bearer ${owner}`,
            "content-type": "application/json",
          },
          method: "POST",
        }
      );
      expect(await restored.json()).toMatchObject({
        state: "connected",
        successfulRenewals: 3,
      });
      const restoredCommand = await fetch(
        new URL("/v1/get_command", await runtime.ready),
        {
          body: JSON.stringify({ commandId, stationId: "12345" }),
          headers: {
            authorization: `Bearer ${owner}`,
            "content-type": "application/json",
          },
          method: "POST",
        }
      );
      expect(await restoredCommand.json()).toMatchObject({
        phase: { approval: { kind: "grant" }, status: "approved" },
      });
      const postCommand = async (name: string, input: object) => {
        const response = await fetch(
          new URL(`/v1/${name}`, await runtime.ready),
          {
            body: JSON.stringify(input),
            headers: {
              authorization: `Bearer ${owner}`,
              "content-type": "application/json",
            },
            method: "POST",
          }
        );
        return { body: await response.json(), status: response.status };
      };
      const commandIdentity = { commandId, stationId: "12345" };
      const executed = await postCommand("execute_command", commandIdentity);
      expect(executed.body).toMatchObject({ phase: { status: "verified" } });
      const repeated = await postCommand("execute_command", commandIdentity);
      expect(repeated.body).toMatchObject({ phase: { status: "verified" } });
      expect(physicalWrites).toBe(1);
      const nextId = "0b1b8134-73fc-4ba9-8cb0-fd07dc20ea02";
      const nextResult = await postCommand("prepare_command", {
        change: {
          limit: { kind: "limited", watts: 1500 },
          operation: "set_solar_power_limit",
        },
        commandId: nextId,
        stationId: "12345",
      });
      const next = Schema.decodeUnknownSync(Command)(nextResult.body);
      expect(next.phase.status).toBe("approved");
      if (
        next.phase.status !== "approved" ||
        next.phase.approval.kind !== "grant"
      ) {
        throw new Error("Expected persistent grant");
      }
      await postCommand("revoke_approval_grant", {
        grantId: next.phase.approval.grantId,
        stationId: "12345",
      });
      expect(
        await postCommand("execute_command", {
          commandId: nextId,
          stationId: "12345",
        })
      ).toMatchObject({ body: { error: "ApprovalRequired" }, status: 409 });
      expect(physicalWrites).toBe(1);
      await postCommand("approve_command", {
        change: next.review.change,
        commandId: nextId,
        current: next.review.current,
        mode: "once",
        reviewFingerprint: next.review.reviewFingerprint,
        stationId: "12345",
      });
      const onceExecuted = await postCommand("execute_command", {
        commandId: nextId,
        stationId: "12345",
      });
      expect(onceExecuted.body).toMatchObject({
        phase: { status: "verified" },
      });
      expect(physicalWrites).toBe(2);
      const permissions = await postCommand("list_approval_grants", {
        stationId: "12345",
      });
      expect(permissions.body).toEqual({ grants: [] });
      const report = await fetch(
        new URL("/admin/session", await runtime.ready),
        { headers: { authorization: `Bearer ${operator}` } }
      );
      expect(report.status).toBe(200);
      expect(await report.json()).toMatchObject({
        renewals: Array.from({ length: 3 }, () => ({
          trigger: "alarm",
          verification: {
            completedAt: expect.any(Number),
            energyFlowFailure: null,
            stationFailure: null,
          },
        })),
      });
    } finally {
      await client.close();
      await runtime.dispose();
      await rm(persistence, { force: true, recursive: true });
    }
  }
);
