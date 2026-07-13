import { Effect, Layer, Option, Ref } from "effect";
import { Cookies, Headers, HttpClient } from "effect/unstable/http";

import { AppConfig } from "../../../app/config.js";
import { TescoAuthRefreshError } from "../tesco.errors.js";
import {
  cookieHeaderFromCookies,
  cookiesFromHeader,
  oauthExpiryFromCookies,
} from "./auth-cookies.js";
import { TescoAuthRefresh } from "./auth-refresh.port.js";
import type { TescoAuthCookieHeader } from "./auth.model.js";
import {
  authorizationFromDiscoverConfig,
  discoverJsonFromHtml,
} from "./soft-login-discover.js";

const SoftLoginMaxRedirects = 10;

export const TescoSoftLoginAuthRefreshLive = Layer.effect(
  TescoAuthRefresh,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const client = yield* HttpClient.HttpClient;
    const initialCookies = yield* cookiesFromHeader(
      config.tesco.authCookieHeader
    );
    const cookieRef = yield* Ref.make(initialCookies);
    const refreshClient = client.pipe(HttpClient.withCookiesRef(cookieRef));

    const requestSoftLoginHtml = (
      url: URL,
      remainingRedirects: number
    ): Effect.Effect<string, TescoAuthRefreshError> =>
      Effect.gen(function* () {
        const response = yield* refreshClient
          .get(url, {
            headers: {
              accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "accept-language": config.tesco.locale,
            },
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new TescoAuthRefreshError(
                  "Tesco soft login request failed",
                  502,
                  cause
                )
            )
          );
        yield* Ref.update(cookieRef, (cookies) =>
          Cookies.merge(cookies, response.cookies)
        );

        if (response.status >= 300 && response.status < 400) {
          if (remainingRedirects === 0) {
            return yield* Effect.fail(
              new TescoAuthRefreshError(
                "Tesco soft login exceeded redirect limit",
                502
              )
            );
          }

          const location = Headers.get(response.headers, "location");
          if (Option.isNone(location)) {
            return yield* Effect.fail(
              new TescoAuthRefreshError(
                "Tesco soft login redirect is missing Location",
                502
              )
            );
          }

          return yield* requestSoftLoginHtml(
            new URL(location.value, url),
            remainingRedirects - 1
          );
        }

        if (response.status < 200 || response.status >= 300) {
          return yield* Effect.fail(
            new TescoAuthRefreshError(
              "Tesco soft login returned a non-success status",
              response.status
            )
          );
        }

        return yield* response.text.pipe(
          Effect.mapError(
            (cause) =>
              new TescoAuthRefreshError(
                "Tesco soft login returned unreadable HTML",
                502,
                cause
              )
          )
        );
      });

    const refresh = (cookieHeader: TescoAuthCookieHeader) =>
      Effect.gen(function* () {
        const cookies = yield* cookiesFromHeader(cookieHeader);
        yield* Ref.set(cookieRef, cookies);

        const refreshUrl = new URL(config.tesco.softRefreshSignInUrl);
        refreshUrl.searchParams.set(
          "from",
          config.tesco.authRefreshFromUrl.href
        );
        refreshUrl.searchParams.set("prompt", "none");

        const html = yield* requestSoftLoginHtml(
          refreshUrl,
          SoftLoginMaxRedirects
        );
        const discoverJson = yield* discoverJsonFromHtml(html);
        const authorization =
          yield* authorizationFromDiscoverConfig(discoverJson);
        const refreshedCookies = yield* Ref.get(cookieRef);
        const refreshedCookieHeader =
          yield* cookieHeaderFromCookies(refreshedCookies);
        const expiry = yield* oauthExpiryFromCookies(refreshedCookies);

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
