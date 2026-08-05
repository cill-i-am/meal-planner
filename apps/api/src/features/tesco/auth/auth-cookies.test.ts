import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { oauthExpiryFromCookieHeader } from "./auth-cookies.js";
import {
  OAuthTokensExpiryTimeCookieName,
  TescoAuthCookieHeaderValue,
} from "./auth.model.js";

const makeCookieHeader = (
  accessTokenExpiresAt: number,
  refreshTokenExpiresAt: number
) =>
  Redacted.make(
    Schema.decodeUnknownSync(TescoAuthCookieHeaderValue)(
      [
        `${OAuthTokensExpiryTimeCookieName}=${encodeURIComponent(
          JSON.stringify({
            AccessToken: accessTokenExpiresAt,
            RefreshToken: refreshTokenExpiresAt,
          })
        )}`,
        "other=value",
      ].join("; ")
    )
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
      oauthExpiryFromCookieHeader(cookieHeader)
    );

    expect(expiry).toStrictEqual({
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    });
  });

  it("rejects cookie headers without Tesco expiry metadata", () => {
    expect(() =>
      Schema.decodeUnknownSync(TescoAuthCookieHeaderValue)("other=value")
    ).toThrow();
  });

  it("keeps cookie header diagnostics redacted", () => {
    const cookieHeader = makeCookieHeader(Date.now(), Date.now() + 10_000);

    expect(JSON.stringify({ cookieHeader })).toBe(
      '{"cookieHeader":"<redacted>"}'
    );
    expect(String(cookieHeader)).toBe("<redacted>");
  });

  it("reports malformed expiry metadata without retaining its parse cause", async () => {
    const malformedValue = "sensitive-not-json";
    const cookieHeader = Redacted.make(
      Schema.decodeUnknownSync(TescoAuthCookieHeaderValue)(
        `${OAuthTokensExpiryTimeCookieName}=${malformedValue}`
      )
    );

    const error = await Effect.runPromise(
      Effect.flip(oauthExpiryFromCookieHeader(cookieHeader))
    );

    expect(error).toMatchObject({
      _tag: "TescoAuthRefreshError",
      reason: "invalid-oauth-expiry-json",
      status: 401,
    });
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).not.toContain(malformedValue);
  });
});
