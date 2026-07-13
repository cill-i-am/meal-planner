import { createServer } from "node:http";
import type { Server } from "node:http";

import { NodeHttpClient } from "@effect/platform-node";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AppConfig, AppConfigDefinition } from "../../../app/config.js";
import { TescoAuthRefresh } from "./auth-refresh.port.js";
import {
  OAuthTokensExpiryTimeCookieName,
  TescoAuthCookieHeader,
} from "./auth.model.js";
import { TescoSoftLoginAuthRefreshLive } from "./soft-login-auth-refresh.js";

const makeCookieHeader = (
  accessTokenExpiresAt: number,
  refreshTokenExpiresAt: number
) =>
  Schema.decodeUnknownSync(TescoAuthCookieHeader)(
    [
      `${OAuthTokensExpiryTimeCookieName}=${encodeURIComponent(
        JSON.stringify({
          AccessToken: accessTokenExpiresAt,
          RefreshToken: refreshTokenExpiresAt,
        })
      )}`,
      "other=value",
    ].join("; ")
  );

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

describe("TescoSoftLoginAuthRefreshLive", () => {
  it("refreshes through the Tesco soft-login HTTP flow", async () => {
    const initialAccessTokenExpiresAt = Date.now() - 60_000;
    const initialRefreshTokenExpiresAt = Date.now() + 3_600_000;
    const refreshedAccessTokenExpiresAt = Date.now() + 600_000;
    const refreshedRefreshTokenExpiresAt = Date.now() + 7_200_000;
    const initialCookieHeader = makeCookieHeader(
      initialAccessTokenExpiresAt,
      initialRefreshTokenExpiresAt
    );
    const refreshedExpiryCookie = encodeURIComponent(
      JSON.stringify({
        AccessToken: refreshedAccessTokenExpiresAt,
        RefreshToken: refreshedRefreshTokenExpiresAt,
      })
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
      const config = await Effect.runPromise(
        AppConfigDefinition.parse(
          ConfigProvider.fromUnknown({
            HOST: "127.0.0.1",
            PORT: "3000",
            TESCO_AUTHORIZATION: "Bearer initial-token",
            TESCO_AUTH_COOKIE_HEADER: initialCookieHeader,
            TESCO_AUTH_REFRESH_FROM_URL: `${baseUrl}/shop/en-IE`,
            TESCO_LOCALE: "en-IE",
            TESCO_MANGO_API_KEY: "test-api-key",
            TESCO_MANGO_URL: "https://xapi.tesco.com/",
            TESCO_REGION: "IE",
            TESCO_SOFT_REFRESH_SIGN_IN_URL: `${baseUrl}/account/login/en-IE`,
            TESCO_SUGGESTION_URL:
              "https://search.api.tesco.com/search/suggestion/",
          })
        )
      );
      const Live = TescoSoftLoginAuthRefreshLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(AppConfig, AppConfig.of(config)),
            NodeHttpClient.layerUndici
          )
        )
      );

      const snapshot = await Effect.runPromise(
        Effect.gen(function* () {
          const authRefresh = yield* TescoAuthRefresh;
          return yield* authRefresh.refresh(initialCookieHeader);
        }).pipe(Effect.provide(Live))
      );

      expect(snapshot.authorization).toBe("Bearer refreshed-token");
      expect(snapshot.accessTokenExpiresAt).toBe(refreshedAccessTokenExpiresAt);
      expect(snapshot.refreshTokenExpiresAt).toBe(
        refreshedRefreshTokenExpiresAt
      );
      expect(snapshot.cookieHeader).toContain(
        `${OAuthTokensExpiryTimeCookieName}=`
      );
      expect(snapshot.cookieHeader).toContain("session=renewed");
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
});
