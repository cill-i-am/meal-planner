import { Effect, Redacted, Schema } from "effect";
import { Cookies } from "effect/unstable/http";

import { TescoAuthRefreshError } from "../tesco.errors.js";
import {
  OAuthTokensExpiryTime,
  OAuthTokensExpiryTimeCookieName,
  TescoAuthCookieHeaderValue,
} from "./auth.model.js";
import type { TescoAuthCookieHeader, TescoAuthSnapshot } from "./auth.model.js";

export const cookiesFromHeader = (
  cookieHeader: TescoAuthCookieHeader
): Effect.Effect<Cookies.Cookies, TescoAuthRefreshError> =>
  Effect.forEach(
    Object.entries(Cookies.parseHeader(Redacted.value(cookieHeader))),
    ([name, value]) =>
      Effect.fromResult(Cookies.makeCookie(name, value)).pipe(
        Effect.mapError(
          () =>
            new TescoAuthRefreshError(
              "Invalid Tesco auth cookie header",
              401,
              "invalid-cookie-header"
            )
        )
      )
  ).pipe(Effect.map(Cookies.fromIterable));

export const cookieHeaderFromCookies = (
  cookies: Cookies.Cookies
): Effect.Effect<TescoAuthCookieHeader, TescoAuthRefreshError> =>
  Schema.decodeUnknownEffect(TescoAuthCookieHeaderValue)(
    Cookies.toCookieHeader(cookies)
  ).pipe(
    Effect.map(Redacted.make),
    Effect.mapError(
      () =>
        new TescoAuthRefreshError(
          "Tesco auth cookies are missing expiry metadata",
          401,
          "missing-oauth-expiry"
        )
    )
  );

export const oauthExpiryFromCookies = (
  cookies: Cookies.Cookies
): Effect.Effect<
  Pick<TescoAuthSnapshot, "accessTokenExpiresAt" | "refreshTokenExpiresAt">,
  TescoAuthRefreshError
> =>
  Effect.gen(function* () {
    const cookieRecord = Cookies.toRecord(cookies);
    const expiryValue = cookieRecord[OAuthTokensExpiryTimeCookieName];
    if (expiryValue === undefined) {
      return yield* Effect.fail(
        new TescoAuthRefreshError(
          "Tesco auth cookies are missing OAuth expiry metadata",
          401,
          "missing-oauth-expiry"
        )
      );
    }

    const parsed = yield* Effect.try({
      catch: () =>
        new TescoAuthRefreshError(
          "Tesco OAuth expiry cookie is not valid JSON",
          401,
          "invalid-oauth-expiry-json"
        ),
      try: () => JSON.parse(expiryValue) as unknown,
    });
    const decoded = yield* Schema.decodeUnknownEffect(OAuthTokensExpiryTime)(
      parsed
    ).pipe(
      Effect.mapError(
        () =>
          new TescoAuthRefreshError(
            "Tesco OAuth expiry cookie has an unexpected shape",
            401,
            "invalid-oauth-expiry-shape"
          )
      )
    );

    return {
      accessTokenExpiresAt: decoded.AccessToken,
      refreshTokenExpiresAt: decoded.RefreshToken,
    };
  });

export const oauthExpiryFromCookieHeader = (
  cookieHeader: TescoAuthCookieHeader
): Effect.Effect<
  Pick<TescoAuthSnapshot, "accessTokenExpiresAt" | "refreshTokenExpiresAt">,
  TescoAuthRefreshError
> =>
  cookiesFromHeader(cookieHeader).pipe(Effect.flatMap(oauthExpiryFromCookies));
