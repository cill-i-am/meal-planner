import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { cookiesFromHeader, oauthExpiryFromCookies } from "./auth-cookies.js";
import {
  OAuthTokensExpiryTimeCookieName,
  TescoAuthCookieHeader,
} from "./auth.model.js";

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

describe("Tesco auth cookies", () => {
  it("decodes OAuth token expiry metadata from the browser cookie header", async () => {
    const accessTokenExpiresAt = Date.now() + 300_000;
    const refreshTokenExpiresAt = Date.now() + 3_600_000;
    const cookieHeader = makeCookieHeader(
      accessTokenExpiresAt,
      refreshTokenExpiresAt
    );

    const expiry = await Effect.runPromise(
      cookiesFromHeader(cookieHeader).pipe(
        Effect.flatMap(oauthExpiryFromCookies)
      )
    );

    expect(expiry).toStrictEqual({
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    });
  });

  it("rejects cookie headers without Tesco expiry metadata", () => {
    expect(() =>
      Schema.decodeUnknownSync(TescoAuthCookieHeader)("other=value")
    ).toThrow();
  });
});
