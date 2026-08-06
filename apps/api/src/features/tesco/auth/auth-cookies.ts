import { Effect, Redacted, Schema } from "effect";
import { Cookies } from "effect/unstable/http";

import { TescoAuthCookieInvalid } from "./auth.errors.js";
import {
  OAuthTokensExpiryTime,
  OAuthTokensExpiryTimeCookieName,
  TescoAuthCookieHeaderValue,
} from "./auth.model.js";
import type { TescoAuthCookieHeader, TescoAuthSnapshot } from "./auth.model.js";

export const cookiesFromHeader = (
  cookieHeader: TescoAuthCookieHeader
): Effect.Effect<Cookies.Cookies, TescoAuthCookieInvalid> =>
  Effect.forEach(
    Object.entries(Cookies.parseHeader(Redacted.value(cookieHeader))),
    ([name, value]) =>
      Effect.fromResult(Cookies.makeCookie(name, value)).pipe(
        Effect.mapError(() => new TescoAuthCookieInvalid())
      )
  ).pipe(Effect.map(Cookies.fromIterable));

export const cookieHeaderFromCookies = (
  cookies: Cookies.Cookies
): Effect.Effect<TescoAuthCookieHeader, TescoAuthCookieInvalid> =>
  Schema.decodeUnknownEffect(TescoAuthCookieHeaderValue)(
    Cookies.toCookieHeader(cookies)
  ).pipe(
    Effect.map(Redacted.make),
    Effect.mapError(() => new TescoAuthCookieInvalid())
  );

export const oauthExpiryFromCookies = (
  cookies: Cookies.Cookies
): Effect.Effect<
  Pick<TescoAuthSnapshot, "accessTokenExpiresAt" | "refreshTokenExpiresAt">,
  TescoAuthCookieInvalid
> =>
  Effect.gen(function* () {
    const cookieRecord = Cookies.toRecord(cookies);
    const expiryValue = cookieRecord[OAuthTokensExpiryTimeCookieName];
    if (expiryValue === undefined) {
      return yield* Effect.fail(new TescoAuthCookieInvalid());
    }

    const parsed = yield* Effect.try({
      catch: () => new TescoAuthCookieInvalid(),
      try: () => JSON.parse(expiryValue) as unknown,
    });
    const decoded = yield* Schema.decodeUnknownEffect(OAuthTokensExpiryTime)(
      parsed
    ).pipe(Effect.mapError(() => new TescoAuthCookieInvalid()));

    return {
      accessTokenExpiresAt: decoded.AccessToken,
      refreshTokenExpiresAt: decoded.RefreshToken,
    };
  });

export const oauthExpiryFromCookieHeader = (
  cookieHeader: TescoAuthCookieHeader
): Effect.Effect<
  Pick<TescoAuthSnapshot, "accessTokenExpiresAt" | "refreshTokenExpiresAt">,
  TescoAuthCookieInvalid
> =>
  cookiesFromHeader(cookieHeader).pipe(Effect.flatMap(oauthExpiryFromCookies));
