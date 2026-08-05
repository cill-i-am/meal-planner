import { Clock, Effect, Equal, Layer, Ref, Semaphore } from "effect";

import type { TescoAuthBootstrapConfig } from "../tesco.config.js";
import { TescoAuthRefreshError } from "../tesco.errors.js";
import { oauthExpiryFromCookieHeader } from "./auth-cookies.js";
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

export const makeTescoAuthSessionLive = (config: TescoAuthBootstrapConfig) =>
  Layer.effect(
    TescoAuthSession,
    Effect.gen(function* () {
      const authRefresh = yield* TescoAuthRefresh;
      const initialExpiry = yield* oauthExpiryFromCookieHeader(
        config.initialCookieHeader
      );
      const stateRef = yield* Ref.make<TescoAuthSnapshot>({
        accessTokenExpiresAt: initialExpiry.accessTokenExpiresAt,
        authorization: config.initialAuthorization,
        cookieHeader: config.initialCookieHeader,
        refreshTokenExpiresAt: initialExpiry.refreshTokenExpiresAt,
      });
      const refreshLock = yield* Semaphore.make(1);

      const refreshState = (state: TescoAuthSnapshot) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          if (!hasUsableRefreshToken(state, now)) {
            return yield* Effect.fail(
              new TescoAuthRefreshError(
                "Tesco refresh token is expired",
                401,
                "refresh-token-expired"
              )
            );
          }

          const refreshed = yield* authRefresh.refresh(state.cookieHeader);
          const refreshedAt = yield* Clock.currentTimeMillis;
          if (!hasUsableAccessToken(refreshed, refreshedAt)) {
            return yield* Effect.fail(
              new TescoAuthRefreshError(
                "Tesco soft login did not renew the access token",
                401,
                "access-token-not-renewed"
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
            if (!Equal.equals(current.authorization, failedAuthorization)) {
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
