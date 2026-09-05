import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Redacted,
  Schema,
} from "effect";

import type { TescoAuthBootstrapConfig } from "../tesco.config.js";
import { TescoAuthRefresh } from "./auth-refresh.port.js";
import { makeTescoAuthSessionLive } from "./auth-session.js";
import { TescoAuthSession } from "./auth-session.port.js";
import {
  OAuthTokenExpiryEpochMs,
  OAuthTokensExpiryTimeCookieName,
  TescoAuthCookieHeaderValue,
  TescoAuthorizationValue,
} from "./auth.model.js";
import type { TescoAuthSnapshot } from "./auth.model.js";

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

const makeAuthorization = (value: string) =>
  Redacted.make(Schema.decodeUnknownSync(TescoAuthorizationValue)(value));

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

const bootstrapConfig = (
  snapshot: TescoAuthSnapshot
): TescoAuthBootstrapConfig => ({
  initialAuthorization: snapshot.authorization,
  initialCookieHeader: snapshot.cookieHeader,
});

describe("TescoAuthSessionLive", () => {
  it("preserves interruption from soft-login refresh", async () => {
    const initial = makeSnapshot(
      "Bearer initial-token",
      Date.now() - 60_000,
      Date.now() + 3_600_000
    );
    const RefreshLive = Layer.succeed(
      TescoAuthRefresh,
      TescoAuthRefresh.of({ refresh: () => Effect.interrupt })
    );
    const SessionLive = makeTescoAuthSessionLive(bootstrapConfig(initial)).pipe(
      Layer.provide(RefreshLive)
    );

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* interruptedAuthorization() {
        const session = yield* TescoAuthSession;
        return yield* session.authorization;
      }).pipe(Effect.provide(SessionLive))
    );

    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
  });

  it("reports an expired refresh token precisely", async () => {
    const initial = makeSnapshot(
      "Bearer initial-token",
      Date.now() - 60_000,
      Date.now() - 1000
    );
    const RefreshLive = Layer.succeed(
      TescoAuthRefresh,
      TescoAuthRefresh.of({ refresh: () => Effect.succeed(initial) })
    );
    const SessionLive = makeTescoAuthSessionLive(bootstrapConfig(initial)).pipe(
      Layer.provide(RefreshLive)
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* expiredRefreshToken() {
          const session = yield* TescoAuthSession;
          return yield* session.authorization;
        }).pipe(Effect.provide(SessionLive))
      )
    ).rejects.toMatchObject({ _tag: "TescoRefreshTokenExpired" });
  });

  it("reports a soft login that does not renew the access token", async () => {
    const initial = makeSnapshot(
      "Bearer initial-token",
      Date.now() - 60_000,
      Date.now() + 3_600_000
    );
    const RefreshLive = Layer.succeed(
      TescoAuthRefresh,
      TescoAuthRefresh.of({ refresh: () => Effect.succeed(initial) })
    );
    const SessionLive = makeTescoAuthSessionLive(bootstrapConfig(initial)).pipe(
      Layer.provide(RefreshLive)
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* staleRefresh() {
          const session = yield* TescoAuthSession;
          return yield* session.authorization;
        }).pipe(Effect.provide(SessionLive))
      )
    ).rejects.toMatchObject({ _tag: "TescoAccessTokenNotRenewed" });
  });

  it.effect("refreshes expired access tokens once for concurrent callers", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const initial = makeSnapshot(
        "Bearer initial-token",
        now,
        now + 3_600_000
      );
      const refreshed = makeSnapshot(
        "Bearer refreshed-token",
        now + 300_000,
        now + 3_600_000
      );
      const releaseRefresh = yield* Deferred.make<boolean>();
      let refreshCount = 0;
      const RefreshLive = Layer.succeed(
        TescoAuthRefresh,
        TescoAuthRefresh.of({
          refresh: () =>
            Effect.gen(function* () {
              refreshCount += 1;
              yield* Deferred.await(releaseRefresh);
              return refreshed;
            }),
        })
      );
      const SessionLive = makeTescoAuthSessionLive(
        bootstrapConfig(initial)
      ).pipe(Layer.provide(RefreshLive));

      const authorizations = yield* Effect.gen(function* () {
        const session = yield* TescoAuthSession;
        const callers = yield* Effect.forEach(Array.from({ length: 5 }), () =>
          session.authorization.pipe(
            Effect.forkScoped({ startImmediately: true })
          )
        );
        expect(refreshCount).toBe(1);
        yield* Deferred.succeed(releaseRefresh, true);
        return yield* Effect.forEach(Fiber.join)(callers);
      }).pipe(Effect.provide(SessionLive));

      expect(authorizations).toStrictEqual(
        Array.from({ length: 5 }, () => refreshed.authorization)
      );
      expect(refreshCount).toBe(1);
    })
  );

  it("refreshes after a 401 when the failed authorization has equal redacted content", async () => {
    const initial = makeSnapshot(
      "Bearer initial-token",
      Date.now() + 300_000,
      Date.now() + 3_600_000
    );
    const refreshed = makeSnapshot(
      "Bearer refreshed-token",
      Date.now() + 600_000,
      Date.now() + 3_600_000
    );
    let refreshCount = 0;
    const RefreshLive = Layer.succeed(
      TescoAuthRefresh,
      TescoAuthRefresh.of({
        refresh: () =>
          Effect.sync(() => {
            refreshCount += 1;
            return refreshed;
          }),
      })
    );
    const SessionLive = makeTescoAuthSessionLive(bootstrapConfig(initial)).pipe(
      Layer.provide(RefreshLive)
    );

    const authorization = await Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* TescoAuthSession;
        return yield* session.refreshAfterUnauthorized(
          makeAuthorization("Bearer initial-token")
        );
      }).pipe(Effect.provide(SessionLive))
    );

    expect(authorization).toEqual(refreshed.authorization);
    expect(refreshCount).toBe(1);
  });
});
