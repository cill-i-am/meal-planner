import { describe, expect, it } from "@effect/vitest";
import { Clock, Effect, Exit, Redacted, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";

import { cookieHeaderFor, TescoSessionCredentials } from "./session.model.js";
import {
  makeSessionEncryption,
  makeTescoSessionService,
} from "./session.service.js";
import type {
  TescoSessionRecord,
  TescoSessionStorage,
} from "./session.service.js";

const encryptionSecret = Redacted.make("c".repeat(64));
const cookie = (name: string, value: string, path = "/") => ({
  domain: ".tesco.ie",
  expires: -1,
  name,
  path,
  secure: true,
  value,
});
const expiryValue = (now: number) =>
  encodeURIComponent(
    JSON.stringify({
      AccessToken: now + 3_600_000,
      RefreshToken: now + 2_592_000_000,
    })
  );
const credentials = (now: number) =>
  Schema.decodeUnknownSync(TescoSessionCredentials)({
    authorization: "Bearer fake-access-0",
    cookies: [
      cookie("OAuth.AccessToken", "fake-access-0"),
      cookie("OAuth.RefreshToken", "fake-refresh-0"),
      cookie("OAuth.TokensExpiryTime", expiryValue(now)),
      cookie("deviceId", "device", "/account"),
      cookie("OAuth.Sid", "sid", "/account"),
    ],
    mangoApiKey: "fake-api-key",
    mangoUrl: "https://xapi.tesco.com/",
    userAgent: "Mozilla/5.0 (Tesco test browser)",
  });

const fixture = (failCycle = 0, externalRedirect = false) => {
  let record: TescoSessionRecord = {
    needsReauthentication: false,
    session: null,
  };
  let alarmAt: number | null = null;
  let rotations = 0;
  const requests: string[] = [];
  const storage: TescoSessionStorage = {
    read: Effect.sync(() => record),
    write: (next, nextAlarm) =>
      Effect.sync(() => {
        record = next;
        alarmAt = nextAlarm;
      }),
  };
  const client = HttpClient.make((request, url) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) => {
        requests.push(url.href);
        if (url.origin === "https://xapi.tesco.com") {
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ data: { search: { info: { total: 1 } } } })
          );
        }
        expect(url.origin).toBe("https://www.tesco.ie");
        expect(request.headers["user-agent"]).toBe(
          "Mozilla/5.0 (Tesco test browser)"
        );
        expect(request.headers["cookie"]).toContain(
          `OAuth.RefreshToken=fake-refresh-${rotations}`
        );
        expect(request.headers["cookie"]).toContain("deviceId=device");
        expect(request.headers["cookie"]).toContain("OAuth.Sid=sid");
        if (url.pathname === "/account/login/en-IE") {
          return HttpClientResponse.fromWeb(
            request,
            new Response(null, {
              headers: {
                location: externalRedirect
                  ? "https://attacker.test/collect"
                  : "/account/auth/en-IE/refresh-token",
              },
              status: 302,
            })
          );
        }
        rotations += 1;
        if (rotations === failCycle) {
          return HttpClientResponse.fromWeb(
            request,
            new Response(null, {
              headers: {
                "set-cookie":
                  "OAuth.RefreshToken=; Path=/; Domain=.tesco.ie; Max-Age=0",
              },
              status: 421,
            })
          );
        }
        const headers = new Headers({
          location: "/shop/en-IE/landing/groceries",
        });
        headers.append(
          "set-cookie",
          `OAuth.AccessToken=fake-access-${rotations}; Path=/; Domain=.tesco.ie; Secure`
        );
        headers.append(
          "set-cookie",
          `OAuth.RefreshToken=fake-refresh-${rotations}; Path=/; Domain=.tesco.ie; Secure`
        );
        headers.append(
          "set-cookie",
          `OAuth.TokensExpiryTime=${expiryValue(now)}; Path=/; Domain=.tesco.ie; Secure`
        );
        // Match the lossless string-valued header produced by TescoSessionHttpLive.
        headers.set("set-cookie", headers.getSetCookie().join(", "));
        return HttpClientResponse.fromWeb(
          request,
          new Response(null, { headers, status: 302 })
        );
      })
    )
  );
  const make = makeTescoSessionService(storage, encryptionSecret).pipe(
    Effect.provideService(HttpClient.HttpClient, client)
  );
  return {
    get alarmAt() {
      return alarmAt;
    },
    make,
    get record() {
      return record;
    },
    set record(value: TescoSessionRecord) {
      record = value;
    },
    requests,
    get requiredAlarmAt() {
      if (alarmAt === null) {
        throw new Error("Missing refresh alarm");
      }
      return alarmAt;
    },
    get rotations() {
      return rotations;
    },
  };
};

describe("durable Tesco session lifecycle", () => {
  it("requires a bounded header-safe browser identity at enrollment", () => {
    const valid = credentials(Date.now());
    expect(Schema.is(TescoSessionCredentials)(valid)).toBe(true);
    for (const userAgent of [
      undefined,
      "",
      "x".repeat(513),
      "browser\r\ninjected: value",
    ]) {
      expect(Schema.is(TescoSessionCredentials)({ ...valid, userAgent })).toBe(
        false
      );
    }
  });

  it.effect(
    "chains three encrypted, persisted rotations through reconstructed services and reschedules from actual expiry",
    () =>
      Effect.gen(function* threeConsecutiveRotations() {
        const now = Date.now();
        yield* TestClock.setTime(now);
        const app = fixture();
        const initial = yield* app.make;
        yield* initial.enroll(credentials(now));
        expect(app.rotations).toBe(0);
        expect(JSON.stringify(app.record)).not.toContain("fake-access");
        expect(JSON.stringify(app.record)).not.toContain("fake-refresh");
        for (let cycle = 1; cycle <= 3; cycle += 1) {
          const alarm = app.alarmAt;
          if (alarm === null) {
            throw new Error("Missing next refresh alarm");
          }
          yield* TestClock.setTime(alarm - 1);
          const restarted = yield* app.make;
          yield* restarted.onAlarm;
          expect(app.rotations).toBe(cycle - 1);
          yield* TestClock.setTime(alarm);
          yield* restarted.onAlarm;
          expect(app.rotations).toBe(cycle);
          expect(
            Redacted.value(yield* restarted.credentials).authorization
          ).toBe(`Bearer fake-access-${cycle}`);
          if (app.record.session === null) {
            throw new Error("Missing rotated session");
          }
          expect(app.alarmAt).toBe(
            app.record.session.accessTokenExpiresAt - 120_000
          );
          expect((yield* restarted.health).state).toBe("connected");
          const renewals = yield* restarted.renewalHistory;
          expect(renewals).toHaveLength(cycle);
          expect(renewals.at(-1)).toEqual({
            accessTokenExpiresAt: app.record.session.accessTokenExpiresAt,
            failure: null,
            finishedAt: alarm,
            previousAccessTokenExpiresAt: alarm + 120_000,
            refreshCookieChanged: true,
            result: "renewed",
            startedAt: alarm,
            steps: [
              {
                receivedCookies: 0,
                repeatedNames: false,
                stage: "login",
                status: 302,
              },
              {
                receivedCookies: 3,
                repeatedNames: false,
                stage: "refresh",
                status: 302,
              },
            ],
            tokenChanged: true,
          });
          expect(JSON.stringify(renewals)).not.toContain("fake-");
        }
      })
  );

  it.effect(
    "stops and erases the session when a subsequent refresh is rejected",
    () =>
      Effect.gen(function* rejectSecondRefresh() {
        const now = Date.now();
        yield* TestClock.setTime(now);
        const app = fixture(2);
        const service = yield* app.make;
        yield* service.enroll(credentials(now));
        yield* TestClock.setTime(app.requiredAlarmAt);
        yield* service.onAlarm;
        yield* TestClock.setTime(app.requiredAlarmAt);
        expect(Exit.isFailure(yield* Effect.exit(service.onAlarm))).toBe(true);
        expect(app.record.needsReauthentication).toBe(true);
        expect(app.record.session).toBeNull();
        const renewals = yield* service.renewalHistory;
        expect(renewals.map((attempt) => attempt.result)).toEqual([
          "renewed",
          "failed",
        ]);
        expect(renewals.at(-1)).toMatchObject({
          failure: "rejected",
          steps: [
            { stage: "login", status: 302 },
            { stage: "refresh", status: 421 },
          ],
        });
        expect(JSON.stringify(app.record)).not.toContain("fake-");
        expect(app.alarmAt).toBeNull();
        const restarted = yield* app.make;
        yield* restarted.onAlarm;
        expect(app.rotations).toBe(2);
        expect((yield* restarted.health).state).toBe(
          "reauthentication_required"
        );
      })
  );

  it.effect("retains only the latest five renewal attempts", () =>
    Effect.gen(function* boundRenewalHistory() {
      const now = Date.now();
      yield* TestClock.setTime(now);
      const app = fixture();
      const service = yield* app.make;
      yield* service.enroll(credentials(now));
      for (let cycle = 0; cycle < 6; cycle += 1) {
        yield* TestClock.setTime(app.requiredAlarmAt);
        yield* service.onAlarm;
      }
      const renewals = yield* service.renewalHistory;
      expect(renewals).toHaveLength(5);
      expect(renewals.at(0)?.previousAccessTokenExpiresAt).toBe(
        now + 7_080_000
      );
      expect(renewals.at(-1)?.accessTokenExpiresAt).toBe(
        app.record.session?.accessTokenExpiresAt
      );
    })
  );

  it.effect(
    "does not replay an ambiguous refresh after interruption or restart",
    () =>
      Effect.gen(function* interruptedRefresh() {
        const now = Date.now();
        yield* TestClock.setTime(now);
        const app = fixture();
        const service = yield* app.make;
        yield* service.enroll(credentials(now));
        if (app.record.session === null) {
          throw new Error("No enrolled session");
        }
        app.record = {
          ...app.record,
          session: { ...app.record.session, phase: "refreshing" },
        };
        const restarted = yield* app.make;
        yield* restarted.onAlarm;
        expect(app.rotations).toBe(0);
        expect(app.alarmAt).toBeNull();
        expect(app.record.session).toBeNull();
        expect((yield* restarted.health).state).toBe(
          "reauthentication_required"
        );
      })
  );

  it.effect("never forwards cookies across a redirect to another origin", () =>
    Effect.gen(function* restrictRedirectOrigin() {
      const now = Date.now();
      yield* TestClock.setTime(now);
      const app = fixture(0, true);
      const service = yield* app.make;
      yield* service.enroll(credentials(now));
      yield* TestClock.setTime(app.requiredAlarmAt);
      expect(Exit.isFailure(yield* Effect.exit(service.onAlarm))).toBe(true);
      expect(app.requests.some((url) => url.includes("attacker.test"))).toBe(
        false
      );
      expect(app.record.session).toBeNull();
    })
  );

  it.effect(
    "rejects tampered ciphertext without exposing encrypted or decoded credentials",
    () =>
      Effect.gen(function* ciphertextTampering() {
        const encryption = makeSessionEncryption(encryptionSecret);
        const encrypted = yield* encryption.encrypt(
          Redacted.make(credentials(Date.now()))
        );
        const tampered = {
          ...encrypted,
          cipher: `${encrypted.cipher.slice(0, -5)}AAAAA`,
        };
        const exit = yield* Effect.exit(encryption.decrypt(tampered));
        expect(Exit.isFailure(exit)).toBe(true);
        expect(JSON.stringify(exit)).not.toContain("fake-access");
        expect(JSON.stringify(exit)).not.toContain("fake-api-key");
      })
  );

  it("keeps account-path cookies away from catalogue and unrelated hosts", () => {
    const all = credentials(Date.now()).cookies;
    expect(
      cookieHeaderFor(
        all,
        new URL("https://www.tesco.ie/account/login/en-IE"),
        Date.now()
      )
    ).toContain("deviceId=device");
    expect(
      cookieHeaderFor(
        all,
        new URL("https://www.tesco.ie/shop/en-IE"),
        Date.now()
      )
    ).not.toContain("deviceId");
    expect(
      cookieHeaderFor(all, new URL("https://attacker.test/account"), Date.now())
    ).toBe("");
  });
});
