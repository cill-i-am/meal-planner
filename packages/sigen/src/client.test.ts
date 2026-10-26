/* eslint-disable no-await-in-loop -- Each body is consumed once by a fresh scoped transport. */
import { createCipheriv } from "node:crypto";

import { Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import type { HttpClient } from "effect/http/HttpClient";
import { describe, expect, it } from "vitest";

import { makeSigenClient, transformPassword } from "./client.js";
import { Enrollment, StationId } from "./model.js";

const stationId = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("synthetic-access-token");
const station = {
  batteryCapacity: 8.1,
  dcSnList: [],
  hasAcCharger: false,
  hasGateway: true,
  hasSolar: true,
  onGrid: true,
  pvCapacity: 5.7,
  stationId: 12_345,
  stationName: "Fixture station",
  status: 777,
  timeZoneName: "Europe/Dublin",
};
const flow = {
  batteryPower: -0.2,
  batterySoc: 38.5,
  buySellPower: 0,
  dateCurrTimeStamp: "",
  loadPower: 0.6,
  onGrid: true,
  pvPower: 0.4,
  stationStatus: 1,
};
const run = <A, E>(
  program: Effect.Effect<A, E, HttpClient>,
  fetch: (
    ...args: Parameters<typeof globalThis.fetch>
  ) => Response | Promise<Response>
) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(
        FetchHttpClient.layer.pipe(
          Layer.provide(
            Layer.succeed(FetchHttpClient.Fetch, (...args) =>
              Promise.resolve(fetch(...args))
            )
          )
        )
      ),
      Effect.scoped
    )
  );

describe("private EU client", () => {
  it("uses the app password transformation without treating it as storage encryption", async () => {
    const cipher = createCipheriv(
      "aes-128-cbc",
      "sigensigensigenp",
      "sigensigensigenp"
    );
    const expected = Buffer.concat([
      cipher.update("fixture-only-password"),
      cipher.final(),
    ]).toString("base64");
    const actual = await Effect.runPromise(
      transformPassword(Redacted.make("fixture-only-password"))
    );
    expect(Redacted.value(actual)).toBe(expected);
    expect(String(actual)).not.toContain(expected);
  });

  it("uses an explicit station, normalizes capabilities and strips unrelated account data", async () => {
    const result = await run(
      Effect.gen(function* stationRead() {
        return yield* (yield* makeSigenClient).station(stationId, token);
      }),
      (input, init) => {
        expect(String(input)).toBe(
          "https://api-eu.sigencloud.com/device/owner/station/home?stationId=12345"
        );
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer synthetic-access-token"
        );
        return Response.json({
          code: 0,
          data: { ...station, address: "must never escape", status: 777 },
        });
      }
    );
    expect(result).toMatchObject({
      capabilities: { acCharger: "unavailable", dcCharger: "unavailable" },
      providerStatus: 777,
      stationId: "12345",
    });
    expect(result).not.toHaveProperty("address");
  });

  it("rejects a provider response silently returning the default station", async () => {
    const result = await run(
      Effect.gen(function* stationRead() {
        return yield* (yield* makeSigenClient)
          .station(stationId, token)
          .pipe(Effect.result);
      }),
      () => Response.json({ code: 0, data: { ...station, stationId: 54_321 } })
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "PermissionDenied" },
    });
  });

  it("converts kW to W while keeping zero, null and absent timestamp distinct", async () => {
    const result = await run(
      Effect.gen(function* telemetryRead() {
        return yield* (yield* makeSigenClient).energyFlow(stationId, token);
      }),
      (input) => {
        expect(String(input)).toBe(
          "https://api-eu.sigencloud.com/device/sigen/station/energyflow?id=12345"
        );
        return Response.json({ code: 0, data: { ...flow, loadPower: null } });
      }
    );
    expect(result).toMatchObject({
      batteryPowerW: -200,
      freshness: "unknown",
      gridPowerW: 0,
      loadPowerW: null,
      providerTimestamp: null,
      solarPowerW: 400,
    });
  });

  it.each([
    [401, "AuthenticationRequired"],
    [403, "PermissionDenied"],
    [429, "RateLimited"],
    [1000, "UpstreamUnavailable"],
  ])("rejects HTTP-200 application error %s", async (code, reason) => {
    const result = await run(
      Effect.gen(function* errorRead() {
        return yield* (yield* makeSigenClient)
          .station(stationId, token)
          .pipe(Effect.result);
      }),
      () =>
        Response.json({
          code,
          data: station,
          msg: "SECRET provider diagnostic",
        })
    );
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason } });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it.each([
    {},
    { code: 0, data: { ...flow, batterySoc: "38.5" } },
    { code: 0, data: { ...flow, dateCurrTimeStamp: "yesterday" } },
  ])("rejects schema drift", async (body) => {
    const result = await run(
      Effect.gen(function* invalidRead() {
        return yield* (yield* makeSigenClient)
          .energyFlow(stationId, token)
          .pipe(Effect.result);
      }),
      () => Response.json(body)
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "SchemaMismatch" },
    });
  });

  it.each([true, false])(
    "decodes enveloped and standard OAuth token responses (%s)",
    async (enveloped) => {
      const input = Schema.decodeUnknownSync(Enrollment)({
        password: "fixture-password",
        stationId,
        username: "owner@example.invalid",
      });
      const result = await run(
        Effect.gen(function* login() {
          return yield* (yield* makeSigenClient).login(Redacted.make(input));
        }),
        (url, init) => {
          expect(String(url)).toBe(
            "https://api-eu.sigencloud.com/auth/oauth/token"
          );
          expect(init?.method).toBe("POST");
          const data = {
            access_token: "new-access",
            expires_in: 3600,
            refresh_token: "new-refresh",
          };
          return Response.json(enveloped ? { code: 0, data } : data);
        }
      );
      expect(Redacted.value(result)).toMatchObject({
        accessToken: "new-access",
        refreshToken: "new-refresh",
      });
      expect(Redacted.value(result).expiresAt).toBeGreaterThan(
        Date.now() + 3_590_000
      );
    }
  );

  it("honors OAuth envelope failures even when token fields are present", async () => {
    const result = await run(
      Effect.gen(function* rejectedRefresh() {
        return yield* (yield* makeSigenClient)
          .refresh(token)
          .pipe(Effect.result);
      }),
      () =>
        Response.json({
          access_token: "misleading-access",
          code: 401,
          expires_in: 3600,
          refresh_token: "misleading-refresh",
        })
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "AuthenticationRequired" },
    });
  });

  it("bounds bodies and does not return malformed or redirect payloads", async () => {
    for (const response of [
      new Response("not JSON"),
      new Response("x".repeat(600_000)),
      new Response(null, {
        headers: { location: "https://unrelated.invalid" },
        status: 302,
      }),
    ]) {
      const result = await run(
        Effect.gen(function* invalidResponse() {
          return yield* (yield* makeSigenClient)
            .station(stationId, token)
            .pipe(Effect.result);
        }),
        () => response
      );
      expect(result._tag).toBe("Failure");
    }
  });
});
