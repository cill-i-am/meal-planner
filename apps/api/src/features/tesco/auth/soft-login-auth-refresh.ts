import { Clock, Effect, Layer, Option, Redacted, Ref, Schema } from "effect";
import { Cookies, Headers, HttpClient } from "effect/http";

import type { TescoSoftLoginConfig } from "../tesco.config.js";
import {
  cookiesFromHeader,
  oauthExpiryFromCookieHeader,
} from "./auth-cookies.js";
import { TescoAuthRefresh } from "./auth-refresh.port.js";
import {
  TescoCredentialsRejected,
  TescoSoftLoginResponseInvalid,
  TescoSoftLoginUnavailable,
} from "./auth.errors.js";
import type { TescoSoftLoginRefreshError } from "./auth.errors.js";
import { TescoAuthCookieHeaderValue } from './auth.model.js';
import type { TescoAuthCookieHeader } from './auth.model.js';
import { authorizationFromDiscoverHtml } from "./soft-login-discover.js";

const SoftLoginMaxRedirects = 10;

export const makeTescoSoftLoginAuthRefreshLive = (
  config: TescoSoftLoginConfig
) =>
  Layer.effect(
    TescoAuthRefresh,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      const refresh = (cookieHeader: TescoAuthCookieHeader) =>
        Effect.gen(function* () {
          const initialCookies = yield* cookiesFromHeader(cookieHeader).pipe(
            Effect.mapError(() => new TescoCredentialsRejected())
          );
          const cookieRef = yield* Ref.make(
            Cookies.mergeIntoArray(
              [],
              config.signInUrl.origin,
              initialCookies,
              yield* Clock.currentTimeMillis
            )
          );
          const refreshClient = client.pipe(
            HttpClient.withCookiesRef(cookieRef)
          );

          const requestSoftLoginHtml = (
            url: URL,
            remainingRedirects: number
          ): Effect.Effect<string, TescoSoftLoginRefreshError> =>
            Effect.gen(function* () {
              const response = yield* refreshClient
                .get(url, {
                  headers: {
                    accept:
                      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "accept-language": config.locale,
                  },
                })
                .pipe(Effect.mapError(() => new TescoSoftLoginUnavailable()));

              if (response.status >= 300 && response.status < 400) {
                if (remainingRedirects === 0) {
                  return yield* Effect.fail(new TescoSoftLoginUnavailable());
                }

                const location = Headers.get(response.headers, "location");
                if (Option.isNone(location)) {
                  return yield* Effect.fail(
                    new TescoSoftLoginResponseInvalid()
                  );
                }

                const redirectUrl = yield* Effect.try({
                  catch: () => new TescoSoftLoginResponseInvalid(),
                  try: () => new URL(location.value, url),
                });
                return yield* requestSoftLoginHtml(
                  redirectUrl,
                  remainingRedirects - 1
                );
              }

              if (response.status < 200 || response.status >= 300) {
                return yield* Effect.fail(
                  response.status === 401 || response.status === 403
                    ? new TescoCredentialsRejected()
                    : new TescoSoftLoginUnavailable()
                );
              }

              return yield* response.text.pipe(
                Effect.mapError(() => new TescoSoftLoginResponseInvalid())
              );
            });

          const refreshUrl = new URL(config.signInUrl);
          refreshUrl.searchParams.set("from", config.refreshFromUrl.href);
          refreshUrl.searchParams.set("prompt", "none");

          const html = yield* requestSoftLoginHtml(
            refreshUrl,
            SoftLoginMaxRedirects
          );
          const authorization = yield* authorizationFromDiscoverHtml(html);
          const header = Cookies.toRequestCookieHeader(
            yield* Ref.get(cookieRef),
            config.refreshFromUrl.href,
            yield* Clock.currentTimeMillis
          );
          const refreshedCookieHeader = yield* Schema.decodeUnknownEffect(
            TescoAuthCookieHeaderValue
          )(header).pipe(
            Effect.map(Redacted.make),
            Effect.mapError(() => new TescoSoftLoginResponseInvalid())
          );
          const expiry = yield* oauthExpiryFromCookieHeader(
            refreshedCookieHeader
          ).pipe(Effect.mapError(() => new TescoSoftLoginResponseInvalid()));

          return {
            accessTokenExpiresAt: expiry.accessTokenExpiresAt,
            authorization,
            cookieHeader: refreshedCookieHeader,
            refreshTokenExpiresAt: expiry.refreshTokenExpiresAt,
          };
        });

      return TescoAuthRefresh.of({ refresh });
    })
  );
