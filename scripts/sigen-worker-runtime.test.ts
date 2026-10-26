import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

import { NodeServices } from "@effect/platform-node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Context, Effect } from "effect";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { expect, it } from "vitest";

import { WorkerBundle } from "../node_modules/alchemy/lib/Cloudflare/Workers/Sources/Rolldown.js";

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
    const makeRuntime = () =>
      new Miniflare(
        convertV4MiniflareOptions({
          bindings: {
            ALCHEMY_CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
            ALCHEMY_PHASE: "runtime",
            ALCHEMY_STACK_NAME: "SigenApi",
            ALCHEMY_STAGE: "prod",
            ALCHEMY_WORKER_NAME: "sigen-api",
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
      expect(listed.tools).toHaveLength(4);
      const initial = await client.callTool({
        arguments: {},
        name: "connection_status",
      });
      expect(initial.structuredContent).toMatchObject({
        state: "disconnected",
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
      await client.close();
      await runtime.dispose();
      runtime = makeRuntime();
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
    } finally {
      await client.close();
      await runtime.dispose();
      await rm(persistence, { force: true, recursive: true });
    }
  }
);
