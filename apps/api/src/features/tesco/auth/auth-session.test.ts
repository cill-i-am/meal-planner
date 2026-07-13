import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AppConfig, AppConfigDefinition } from "../../../app/config.js";
import { TescoAuthRefresh } from "./auth-refresh.port.js";
import { TescoAuthSessionLive } from "./auth-session.js";
import { TescoAuthSession } from "./auth-session.port.js";
import {
  OAuthTokenExpiryEpochMs,
  OAuthTokensExpiryTimeCookieName,
  TescoAuthCookieHeader,
  TescoAuthorization,
} from "./auth.model.js";
import type { TescoAuthSnapshot } from "./auth.model.js";

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

const makeAuthorization = (value: string) =>
  Schema.decodeUnknownSync(TescoAuthorization)(value);

const makeSnapshot = (
  authorization: string,
  accessTokenExpiresAt: number,
  refreshTokenExpiresAt: number
): TescoAuthSnapshot => ({
  accessTokenExpiresAt: Schema.decodeUnknownSync(OAuthTokenExpiryEpochMs)(
    accessTokenExpiresAt
  ),
  authorization: makeAuthorization(authorization),
  cookieHeader: makeCookieHeader(accessTokenExpiresAt, refreshTokenExpiresAt),
  refreshTokenExpiresAt: Schema.decodeUnknownSync(OAuthTokenExpiryEpochMs)(
    refreshTokenExpiresAt
  ),
});

const makeConfigLayer = (snapshot: TescoAuthSnapshot) =>
  AppConfigDefinition.parse(
    ConfigProvider.fromUnknown({
      HOST: "127.0.0.1",
      PORT: "3000",
      TESCO_AUTHORIZATION: snapshot.authorization,
      TESCO_AUTH_COOKIE_HEADER: snapshot.cookieHeader,
      TESCO_AUTH_REFRESH_FROM_URL: "https://www.tesco.ie/shop/en-IE",
      TESCO_LOCALE: "en-IE",
      TESCO_MANGO_API_KEY: "test-api-key",
      TESCO_MANGO_URL: "https://xapi.tesco.com/",
      TESCO_REGION: "IE",
      TESCO_SOFT_REFRESH_SIGN_IN_URL:
        "https://www.tesco.ie/account/login/en-IE",
      TESCO_SUGGESTION_URL: "https://search.api.tesco.com/search/suggestion/",
    })
  ).pipe(
    Effect.map((config) => Layer.succeed(AppConfig, AppConfig.of(config)))
  );

describe("TescoAuthSessionLive", () => {
  it("refreshes expired access tokens once for concurrent callers", async () => {
    const initial = makeSnapshot(
      "Bearer initial-token",
      Date.now() - 1000,
      Date.now() + 3_600_000
    );
    const refreshed = makeSnapshot(
      "Bearer refreshed-token",
      Date.now() + 300_000,
      Date.now() + 3_600_000
    );
    let refreshCount = 0;

    const ConfigLive = await Effect.runPromise(makeConfigLayer(initial));
    const RefreshLive = Layer.succeed(
      TescoAuthRefresh,
      TescoAuthRefresh.of({
        refresh: () =>
          Effect.sleep(10).pipe(
            Effect.asVoid,
            Effect.tap(() =>
              Effect.sync(() => {
                refreshCount += 1;
              })
            ),
            Effect.as(refreshed)
          ),
      })
    );
    const SessionLive = TescoAuthSessionLive.pipe(
      Layer.provide(Layer.mergeAll(ConfigLive, RefreshLive))
    );

    const authorizations = await Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* TescoAuthSession;
        return yield* Effect.all(
          Array.from({ length: 5 }, () => session.authorization),
          { concurrency: "unbounded" }
        );
      }).pipe(Effect.provide(SessionLive))
    );

    expect(authorizations).toStrictEqual([
      refreshed.authorization,
      refreshed.authorization,
      refreshed.authorization,
      refreshed.authorization,
      refreshed.authorization,
    ]);
    expect(refreshCount).toBe(1);
  });
});
