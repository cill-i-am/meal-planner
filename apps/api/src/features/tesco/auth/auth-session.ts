import { Clock, Effect, Layer, Ref, Semaphore } from "effect";

import { AppConfig } from "../../../app/config.js";
import { TescoAuthRefreshError } from "../tesco.errors.js";
import { cookiesFromHeader, oauthExpiryFromCookies } from "./auth-cookies.js";
import { TescoAuthRefresh } from "./auth-refresh.port.js";
import { TescoAuthSession } from "./auth-session.port.js";
import type { TescoAuthorization, TescoAuthSnapshot } from "./auth.model.js";

const AccessTokenRefreshSkewMs = 120_000;

const hasUsableAccessToken = (state: TescoAuthSnapshot, now: number): boolean =>
  state.accessTokenExpiresAt > now + AccessTokenRefreshSkewMs;

const hasUsableRefreshToken = (
  state: TescoAuthSnapshot,
  now: number
): boolean => state.refreshTokenExpiresAt > now;

export const TescoAuthSessionLive = Layer.effect(
  TescoAuthSession,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const authRefresh = yield* TescoAuthRefresh;
    const initialCookies = yield* cookiesFromHeader(
      config.tesco.authCookieHeader
    );
    const initialExpiry = yield* oauthExpiryFromCookies(initialCookies);
    const stateRef = yield* Ref.make<TescoAuthSnapshot>({
      accessTokenExpiresAt: initialExpiry.accessTokenExpiresAt,
      authorization: config.tesco.authorization,
      cookieHeader: config.tesco.authCookieHeader,
      refreshTokenExpiresAt: initialExpiry.refreshTokenExpiresAt,
    });
    const refreshLock = yield* Semaphore.make(1);

    const refreshState = (state: TescoAuthSnapshot) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (!hasUsableRefreshToken(state, now)) {
          return yield* Effect.fail(
            new TescoAuthRefreshError("Tesco refresh token is expired", 401)
          );
        }

        const refreshed = yield* authRefresh.refresh(state.cookieHeader);
        const refreshedAt = yield* Clock.currentTimeMillis;
        if (!hasUsableAccessToken(refreshed, refreshedAt)) {
          return yield* Effect.fail(
            new TescoAuthRefreshError(
              "Tesco soft login did not renew the access token",
              401
            )
          );
        }

        yield* Ref.set(stateRef, refreshed);
        return refreshed;
      });

    const refreshExpiredAccessToken = () =>
      refreshLock.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(stateRef);
          const now = yield* Clock.currentTimeMillis;
          if (hasUsableAccessToken(current, now)) {
            return current.authorization;
          }

          return (yield* refreshState(current)).authorization;
        })
      );

    const authorization = Effect.gen(function* () {
      const current = yield* Ref.get(stateRef);
      const now = yield* Clock.currentTimeMillis;
      if (hasUsableAccessToken(current, now)) {
        return current.authorization;
      }

      return yield* refreshExpiredAccessToken();
    });

    const refreshAfterUnauthorized = (
      failedAuthorization: TescoAuthorization
    ) =>
      refreshLock.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(stateRef);
          if (current.authorization !== failedAuthorization) {
            return current.authorization;
          }

          return (yield* refreshState(current)).authorization;
        })
      );

    return TescoAuthSession.of({
      authorization,
      refreshAfterUnauthorized,
    });
  })
);
