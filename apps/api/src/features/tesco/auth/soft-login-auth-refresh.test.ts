import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";

import { NodeHttpClient } from "@effect/platform-node";
import { Effect, Equal, Exit, Fiber, Layer, Redacted, Schema } from "effect";
import { Cookies } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import { TescoLocale } from "../tesco.config.js";
import { cookiesFromHeader } from "./auth-cookies.js";
import { TescoAuthRefresh } from "./auth-refresh.port.js";
import {
  OAuthTokensExpiryTimeCookieName,
  TescoAuthCookieHeaderValue,
  TescoAuthorizationValue,
} from "./auth.model.js";
import { makeTescoSoftLoginAuthRefreshLive } from "./soft-login-auth-refresh.js";

const makeOAuthExpiryCookieValue = (
  accessTokenExpiresAt: number,
  refreshTokenExpiresAt: number
) =>
  encodeURIComponent(
    JSON.stringify({
      AccessToken: accessTokenExpiresAt,
      RefreshToken: refreshTokenExpiresAt,
    })
  );

const makeCookieHeader = (
  accessTokenExpiresAt: number,
  refreshTokenExpiresAt: number,
  identityCookie = "other=value"
) =>
  Redacted.make(
    Schema.decodeUnknownSync(TescoAuthCookieHeaderValue)(
      [
        `${OAuthTokensExpiryTimeCookieName}=${makeOAuthExpiryCookieValue(
          accessTokenExpiresAt,
          refreshTokenExpiresAt
        )}`,
        identityCookie,
      ].join("; ")
    )
  );

const makeAuthorization = (value: string) =>
  Redacted.make(Schema.decodeUnknownSync(TescoAuthorizationValue)(value));

const cookieRecordFromHeader = async (
  cookieHeader: ReturnType<typeof makeCookieHeader>
) => Cookies.toRecord(await Effect.runPromise(cookiesFromHeader(cookieHeader)));

const discoverHtml = (authorization: string) => `
  <!doctype html>
  <script type="application/discover+json">${JSON.stringify({
    "mfe-orchestrator": {
      props: {
        config: {
          authorization,
        },
      },
    },
  })}</script>
`;

const listen = (server: Server): Promise<string> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Test server did not expose a TCP address"));
        return;
      }
      resolve(`http://${address.address}:${address.port}`);
    });
  });

const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });

const sendRedirect = (
  response: ServerResponse,
  location: string,
  cookie: string
) => {
  response.writeHead(302, {
    location,
    "set-cookie": cookie,
  });
  response.end();
};

const makeLive = (baseUrl: string) =>
  makeTescoSoftLoginAuthRefreshLive({
    locale: Schema.decodeUnknownSync(TescoLocale)("en-IE"),
    refreshFromUrl: new URL(`${baseUrl}/shop/en-IE`),
    signInUrl: new URL(`${baseUrl}/account/login/en-IE`),
  }).pipe(Layer.provide(NodeHttpClient.layerUndici));

describe("TescoSoftLoginAuthRefreshLive", () => {
  it("keeps concurrent refresh cookie transactions isolated", async () => {
    const initialAccessTokenExpiresAt = Date.now() - 60_000;
    const initialRefreshTokenExpiresAt = Date.now() + 3_600_000;
    const refreshedAccessTokenExpiresAtA = Date.now() + 600_000;
    const refreshedRefreshTokenExpiresAtA = Date.now() + 7_200_000;
    const refreshedAccessTokenExpiresAtB = Date.now() + 900_000;
    const refreshedRefreshTokenExpiresAtB = Date.now() + 10_800_000;
    const initialCookieHeaderA = makeCookieHeader(
      initialAccessTokenExpiresAt,
      initialRefreshTokenExpiresAt,
      "flow=A"
    );
    const initialCookieHeaderB = makeCookieHeader(
      initialAccessTokenExpiresAt,
      initialRefreshTokenExpiresAt,
      "flow=B"
    );
    const firstRequestAReceived = Promise.withResolvers<null>();
    let pendingInitialResponseA: ServerResponse | undefined;
    let pendingInitialResponseB: ServerResponse | undefined;
    const redirectCookies = new Map<string, string | null>();

    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const cookie = Array.isArray(request.headers.cookie)
        ? request.headers.cookie.join("; ")
        : (request.headers.cookie ?? null);

      if (requestUrl.pathname === "/account/login/en-IE") {
        if (cookie?.includes("flow=A") === true) {
          pendingInitialResponseA = response;
          firstRequestAReceived.resolve(null);
          return;
        }

        if (cookie?.includes("flow=B") === true) {
          pendingInitialResponseB = response;
          if (pendingInitialResponseA === undefined) {
            response.writeHead(500);
            response.end("Flow A did not reach the barrier first");
            return;
          }
          sendRedirect(
            pendingInitialResponseA,
            "/shop/en-IE?flow=A",
            "mid=A-redirect; Path=/"
          );
          pendingInitialResponseA = undefined;
          return;
        }

        response.writeHead(400);
        response.end("Missing flow cookie");
        return;
      }

      const flow = requestUrl.searchParams.get("flow");
      if (flow !== "A" && flow !== "B") {
        response.writeHead(400);
        response.end("Missing flow query");
        return;
      }

      redirectCookies.set(flow, cookie);
      if (flow === "A") {
        if (pendingInitialResponseB === undefined) {
          response.writeHead(500);
          response.end("Flow B did not reach the barrier");
          return;
        }
        sendRedirect(
          pendingInitialResponseB,
          "/shop/en-IE?flow=B",
          "mid=B-redirect; Path=/"
        );
        pendingInitialResponseB = undefined;
      }

      const accessTokenExpiresAt =
        flow === "A"
          ? refreshedAccessTokenExpiresAtA
          : refreshedAccessTokenExpiresAtB;
      const refreshTokenExpiresAt =
        flow === "A"
          ? refreshedRefreshTokenExpiresAtA
          : refreshedRefreshTokenExpiresAtB;
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": [
          `${OAuthTokensExpiryTimeCookieName}=${makeOAuthExpiryCookieValue(
            accessTokenExpiresAt,
            refreshTokenExpiresAt
          )}; Path=/`,
          `session=${flow}-renewed; Path=/`,
        ],
      });
      response.end(discoverHtml(`Bearer refreshed-token-${flow}`));
    });

    const baseUrl = await listen(server);
    try {
      const Live = makeLive(baseUrl);

      const [snapshotA, snapshotB] = await Effect.runPromise(
        Effect.gen(function* () {
          const authRefresh = yield* TescoAuthRefresh;
          const fiberA = yield* Effect.forkChild(
            authRefresh.refresh(initialCookieHeaderA)
          );
          yield* Effect.promise(() => firstRequestAReceived.promise);
          const fiberB = yield* Effect.forkChild(
            authRefresh.refresh(initialCookieHeaderB)
          );
          return yield* Effect.all([Fiber.join(fiberA), Fiber.join(fiberB)], {
            concurrency: "unbounded",
          });
        }).pipe(Effect.provide(Live))
      );

      expect(
        Equal.equals(
          snapshotA.authorization,
          makeAuthorization("Bearer refreshed-token-A")
        )
      ).toBe(true);
      expect(snapshotA.accessTokenExpiresAt).toBe(
        refreshedAccessTokenExpiresAtA
      );
      expect(snapshotA.refreshTokenExpiresAt).toBe(
        refreshedRefreshTokenExpiresAtA
      );
      const cookieRecordA = await cookieRecordFromHeader(
        snapshotA.cookieHeader
      );
      expect(cookieRecordA["flow"]).toBe("A");
      expect(cookieRecordA["mid"]).toBe("A-redirect");
      expect(cookieRecordA["session"]).toBe("A-renewed");

      expect(
        Equal.equals(
          snapshotB.authorization,
          makeAuthorization("Bearer refreshed-token-B")
        )
      ).toBe(true);
      expect(snapshotB.accessTokenExpiresAt).toBe(
        refreshedAccessTokenExpiresAtB
      );
      expect(snapshotB.refreshTokenExpiresAt).toBe(
        refreshedRefreshTokenExpiresAtB
      );
      const cookieRecordB = await cookieRecordFromHeader(
        snapshotB.cookieHeader
      );
      expect(cookieRecordB["flow"]).toBe("B");
      expect(cookieRecordB["mid"]).toBe("B-redirect");
      expect(cookieRecordB["session"]).toBe("B-renewed");

      expect(redirectCookies.get("A")).toContain("flow=A");
      expect(redirectCookies.get("A")).not.toContain("flow=B");
      expect(redirectCookies.get("A")).toContain("mid=A-redirect");
      expect(redirectCookies.get("A")).not.toContain("mid=B-redirect");
      expect(redirectCookies.get("B")).toContain("flow=B");
      expect(redirectCookies.get("B")).not.toContain("flow=A");
      expect(redirectCookies.get("B")).toContain("mid=B-redirect");
      expect(redirectCookies.get("B")).not.toContain("mid=A-redirect");
    } finally {
      await close(server);
    }
  });

  it("keeps an interrupted refresh from contaminating a peer transaction", async () => {
    const initialAccessTokenExpiresAt = Date.now() - 60_000;
    const initialRefreshTokenExpiresAt = Date.now() + 3_600_000;
    const refreshedAccessTokenExpiresAt = Date.now() + 900_000;
    const refreshedRefreshTokenExpiresAt = Date.now() + 10_800_000;
    const initialCookieHeaderA = makeCookieHeader(
      initialAccessTokenExpiresAt,
      initialRefreshTokenExpiresAt,
      "flow=A"
    );
    const initialCookieHeaderB = makeCookieHeader(
      initialAccessTokenExpiresAt,
      initialRefreshTokenExpiresAt,
      "flow=B"
    );
    const firstRequestAReceived = Promise.withResolvers<null>();
    const firstRequestBReceived = Promise.withResolvers<null>();
    const redirectRequestAReceived = Promise.withResolvers<null>();
    const interruptedRequestAClosed = Promise.withResolvers<null>();
    let pendingInitialResponseA: ServerResponse | undefined;
    let pendingInitialResponseB: ServerResponse | undefined;
    let redirectCookieB: string | null = null;

    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const cookie = Array.isArray(request.headers.cookie)
        ? request.headers.cookie.join("; ")
        : (request.headers.cookie ?? null);

      if (requestUrl.pathname === "/account/login/en-IE") {
        if (cookie?.includes("flow=A") === true) {
          pendingInitialResponseA = response;
          firstRequestAReceived.resolve(null);
          return;
        }

        if (cookie?.includes("flow=B") === true) {
          pendingInitialResponseB = response;
          firstRequestBReceived.resolve(null);
          if (pendingInitialResponseA === undefined) {
            response.writeHead(500);
            response.end("Flow A did not reach the barrier first");
            return;
          }
          sendRedirect(
            pendingInitialResponseA,
            "/shop/en-IE?flow=A",
            "interrupted=A; Path=/"
          );
          pendingInitialResponseA = undefined;
          return;
        }

        response.writeHead(400);
        response.end("Missing flow cookie");
        return;
      }

      const flow = requestUrl.searchParams.get("flow");
      if (flow === "A") {
        response.once("close", () => interruptedRequestAClosed.resolve(null));
        redirectRequestAReceived.resolve(null);
        return;
      }

      if (flow !== "B") {
        response.writeHead(400);
        response.end("Missing flow query");
        return;
      }

      redirectCookieB = cookie;
      const refreshedExpiryCookie = makeOAuthExpiryCookieValue(
        refreshedAccessTokenExpiresAt,
        refreshedRefreshTokenExpiresAt
      );
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": [
          `${OAuthTokensExpiryTimeCookieName}=${refreshedExpiryCookie}; Path=/`,
          "session=B-renewed; Path=/",
        ],
      });
      response.end(discoverHtml("Bearer refreshed-token-B"));
    });

    const baseUrl = await listen(server);
    try {
      const Live = makeLive(baseUrl);

      const { exitA, snapshotB } = await Effect.runPromise(
        Effect.gen(function* () {
          const authRefresh = yield* TescoAuthRefresh;
          const fiberA = yield* Effect.forkChild(
            authRefresh.refresh(initialCookieHeaderA)
          );
          yield* Effect.promise(() => firstRequestAReceived.promise);
          const fiberB = yield* Effect.forkChild(
            authRefresh.refresh(initialCookieHeaderB)
          );
          yield* Effect.promise(() => firstRequestBReceived.promise);
          yield* Effect.promise(() => redirectRequestAReceived.promise);
          yield* Fiber.interrupt(fiberA);
          const interruptedExit = yield* Fiber.await(fiberA);
          yield* Effect.promise(() => interruptedRequestAClosed.promise);
          yield* Effect.sync(() => {
            if (pendingInitialResponseB === undefined) {
              throw new Error("Flow B did not reach the barrier");
            }
            sendRedirect(
              pendingInitialResponseB,
              "/shop/en-IE?flow=B",
              "live=B; Path=/"
            );
            pendingInitialResponseB = undefined;
          });
          const peerSnapshot = yield* Fiber.join(fiberB);
          return { exitA: interruptedExit, snapshotB: peerSnapshot };
        }).pipe(Effect.provide(Live))
      );

      expect(Exit.hasInterrupts(exitA)).toBe(true);
      expect(redirectCookieB).toContain("flow=B");
      expect(redirectCookieB).toContain("live=B");
      expect(redirectCookieB).not.toContain("flow=A");
      expect(redirectCookieB).not.toContain("interrupted=A");
      expect(
        Equal.equals(
          snapshotB.authorization,
          makeAuthorization("Bearer refreshed-token-B")
        )
      ).toBe(true);
      expect(snapshotB.accessTokenExpiresAt).toBe(
        refreshedAccessTokenExpiresAt
      );
      expect(snapshotB.refreshTokenExpiresAt).toBe(
        refreshedRefreshTokenExpiresAt
      );
      const cookieRecordB = await cookieRecordFromHeader(
        snapshotB.cookieHeader
      );
      expect(cookieRecordB["flow"]).toBe("B");
      expect(cookieRecordB["live"]).toBe("B");
      expect(cookieRecordB["session"]).toBe("B-renewed");
      expect(cookieRecordB["interrupted"]).toBeUndefined();
    } finally {
      await close(server);
    }
  });

  it("refreshes through the Tesco soft-login HTTP flow", async () => {
    const initialAccessTokenExpiresAt = Date.now() - 60_000;
    const initialRefreshTokenExpiresAt = Date.now() + 3_600_000;
    const refreshedAccessTokenExpiresAt = Date.now() + 600_000;
    const refreshedRefreshTokenExpiresAt = Date.now() + 7_200_000;
    const initialCookieHeader = makeCookieHeader(
      initialAccessTokenExpiresAt,
      initialRefreshTokenExpiresAt
    );
    const refreshedExpiryCookie = makeOAuthExpiryCookieValue(
      refreshedAccessTokenExpiresAt,
      refreshedRefreshTokenExpiresAt
    );
    const requests: {
      readonly url: URL;
      readonly cookie: string | null;
    }[] = [];

    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const cookie = Array.isArray(request.headers.cookie)
        ? request.headers.cookie.join("; ")
        : (request.headers.cookie ?? null);
      requests.push({ cookie, url: requestUrl });

      if (requestUrl.pathname === "/account/login/en-IE") {
        response.writeHead(302, {
          location: "/shop/en-IE",
          "set-cookie": "mid=redirect; Path=/",
        });
        response.end();
        return;
      }

      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": [
          `${OAuthTokensExpiryTimeCookieName}=${refreshedExpiryCookie}; Path=/`,
          "session=renewed; Path=/",
        ],
      });
      response.end(discoverHtml("Bearer refreshed-token"));
    });

    const baseUrl = await listen(server);
    try {
      const Live = makeLive(baseUrl);

      const snapshot = await Effect.runPromise(
        Effect.gen(function* () {
          const authRefresh = yield* TescoAuthRefresh;
          return yield* authRefresh.refresh(initialCookieHeader);
        }).pipe(Effect.provide(Live))
      );

      expect(Redacted.isRedacted(snapshot.authorization)).toBe(true);
      expect(
        Equal.equals(
          snapshot.authorization,
          Redacted.make(
            Schema.decodeUnknownSync(TescoAuthorizationValue)(
              "Bearer refreshed-token"
            )
          )
        )
      ).toBe(true);
      expect(snapshot.accessTokenExpiresAt).toBe(refreshedAccessTokenExpiresAt);
      expect(snapshot.refreshTokenExpiresAt).toBe(
        refreshedRefreshTokenExpiresAt
      );
      expect(Redacted.isRedacted(snapshot.cookieHeader)).toBe(true);
      const refreshedCookies = await Effect.runPromise(
        cookiesFromHeader(snapshot.cookieHeader)
      );
      const refreshedCookieRecord = Cookies.toRecord(refreshedCookies);
      expect(
        Object.hasOwn(refreshedCookieRecord, OAuthTokensExpiryTimeCookieName)
      ).toBe(true);
      expect(refreshedCookieRecord["session"]).toBe("renewed");
      expect(requests).toHaveLength(2);
      expect(requests[0]?.url.searchParams.get("prompt")).toBe("none");
      expect(requests[0]?.url.searchParams.get("from")).toBe(
        `${baseUrl}/shop/en-IE`
      );
      expect(requests[0]?.cookie).toContain(
        `${OAuthTokensExpiryTimeCookieName}=`
      );
      expect(requests[0]?.cookie).toContain("other=value");
      expect(requests[1]?.cookie).toContain("mid=redirect");
    } finally {
      await close(server);
    }
  });

  it("classifies upstream failures without retaining their raw cause", async () => {
    const initialCookieHeader = makeCookieHeader(
      Date.now() - 60_000,
      Date.now() + 3_600_000
    );
    const server = createServer((_request, response) => {
      response.writeHead(503);
      response.end();
    });

    const baseUrl = await listen(server);
    try {
      const Live = makeLive(baseUrl);

      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const authRefresh = yield* TescoAuthRefresh;
          return yield* authRefresh.refresh(initialCookieHeader);
        }).pipe(Effect.provide(Live), Effect.flip)
      );

      expect(error._tag).toBe("TescoAuthRefreshError");
      expect(error.reason).toBe("upstream-response-invalid");
      expect(error.status).toBe(503);
      expect(Object.hasOwn(error, "cause")).toBe(false);
    } finally {
      await close(server);
    }
  });
});
