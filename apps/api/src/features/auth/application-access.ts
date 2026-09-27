import {
  HouseholdPersonDisplayName,
  UserId,
} from "@meal-planner/household-api";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { Data, Effect, Schema } from "effect";
import {
  HttpEffect,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import type { MealPlannerAuthService } from "./auth.alchemy.js";

export const AuthenticatedAccount = Schema.Struct({
  id: UserId,
  name: HouseholdPersonDisplayName,
});
/** Reuse Better Auth's session, origin and rate-limit boundary for application routes. */
export const applicationAccessPlugin = () =>
  ({
    endpoints: {
      authorizeApplicationAccess: createAuthEndpoint(
        "/application/access",
        {
          method: ["GET", "POST"],
          use: [sessionMiddleware],
        },
        (ctx) =>
          Promise.resolve(
            ctx.json({
              id: ctx.context.session.user.id,
              name: ctx.context.session.user.name,
            })
          )
      ),
    },
    id: "application-access",
    rateLimit: [
      {
        max: 60,
        pathMatcher: (path: string) => path === "/application/access",
        window: 60,
      },
    ],
  }) satisfies BetterAuthPlugin;

export class ApplicationAccessFailure extends Data.TaggedError(
  "ApplicationAccessFailure"
)<{ readonly statusCode: number }> {}
export const authorizeApplicationRequest = (
  auth: Pick<MealPlannerAuthService, "fetchHttpEffect">
) =>
  Effect.gen(function* resolveApplicationAccess() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const source = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
    if (
      (source.headers.has("origin") &&
        source.headers.get("origin") !== new URL(source.url).origin) ||
      source.headers.get("sec-fetch-site") === "cross-site"
    ) {
      return yield* Effect.fail(
        new ApplicationAccessFailure({ statusCode: 403 })
      );
    }
    const headers = new Headers(source.headers);
    headers.delete("content-length");
    headers.delete("content-type");
    const response = yield* auth.fetchHttpEffect(
      new Request(new URL("/api/auth/application/access", source.url), {
        headers,
        method: request.method === "GET" ? "GET" : "POST",
        signal: source.signal,
      })
    );
    yield* HttpEffect.appendPreResponseHandler((_request, outgoing) => {
      let result = HttpServerResponse.mergeCookies(outgoing, response.cookies);
      const retryAfter = response.headers["x-retry-after"];
      if (retryAfter) {
        result = HttpServerResponse.setHeader(
          result,
          "x-retry-after",
          retryAfter
        );
      }
      return Effect.succeed(
        HttpServerResponse.setHeader(result, "cache-control", "no-store")
      );
    });
    if (response.status !== 200) {
      return yield* Effect.fail(
        new ApplicationAccessFailure({ statusCode: response.status })
      );
    }
    const value = yield* Effect.tryPromise({
      catch: () => new ApplicationAccessFailure({ statusCode: 503 }),
      try: () => HttpServerResponse.toWeb(response).json(),
    });
    return yield* Schema.decodeUnknownEffect(AuthenticatedAccount)(value).pipe(
      Effect.mapError(() => new ApplicationAccessFailure({ statusCode: 503 }))
    );
  });
