import { Effect, Schema } from "effect";
import { Cookies } from "effect/unstable/http";

import { TescoAuthRefreshError } from "../tesco.errors.js";
import {
  OAuthTokensExpiryTime,
  OAuthTokensExpiryTimeCookieName,
  TescoAuthCookieHeader,
} from "./auth.model.js";
import type { TescoAuthSnapshot } from "./auth.model.js";

export const cookiesFromHeader = (
  cookieHeader: TescoAuthCookieHeader
): Effect.Effect<Cookies.Cookies, TescoAuthRefreshError> =>
  Effect.forEach(
    Object.entries(Cookies.parseHeader(cookieHeader)),
    ([name, value]) =>
      Effect.fromResult(Cookies.makeCookie(name, value)).pipe(
        Effect.mapError(
          (cause) =>
            new TescoAuthRefreshError(
              "Invalid Tesco auth cookie header",
              401,
              cause
            )
        )
      )
  ).pipe(Effect.map(Cookies.fromIterable));

export const cookieHeaderFromCookies = (
  cookies: Cookies.Cookies
): Effect.Effect<TescoAuthCookieHeader, TescoAuthRefreshError> =>
  Schema.decodeUnknownEffect(TescoAuthCookieHeader)(
    Cookies.toCookieHeader(cookies)
  ).pipe(
    Effect.mapError(
      (cause) =>
        new TescoAuthRefreshError(
          "Tesco auth cookies are missing expiry metadata",
          401,
          cause
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
          401
        )
      );
    }

    const parsed = yield* Effect.try({
      catch: (cause) =>
        new TescoAuthRefreshError(
          "Tesco OAuth expiry cookie is not valid JSON",
          401,
          cause
        ),
      try: () => JSON.parse(expiryValue) as unknown,
    });
    const decoded = yield* Schema.decodeUnknownEffect(OAuthTokensExpiryTime)(
      parsed
    ).pipe(
      Effect.mapError(
        (cause) =>
          new TescoAuthRefreshError(
            "Tesco OAuth expiry cookie has an unexpected shape",
            401,
            cause
          )
      )
    );

    return {
      accessTokenExpiresAt: decoded.AccessToken,
      refreshTokenExpiresAt: decoded.RefreshToken,
    };
  });
