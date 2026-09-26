import {
  SavedSetupProgress,
  SetupProgressApi,
  SetupProgressConflict,
  SetupProgressForbidden,
  SetupProgressInvalidRequest,
  SetupProgressRateLimited,
  SetupProgressSchemaErrors,
  SetupProgressUnauthorized,
  SetupProgressUnavailable,
} from "@meal-planner/household-api";
import { Effect, Layer, Schema } from "effect";
import {
  HttpEffect,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/unstable/httpapi";

import { JsonHttpPlatformServices } from "../../infrastructure/json-http-platform.js";
import type { MealPlannerAuthService } from "./auth.alchemy.js";

type ProgressAuthHttp = Pick<MealPlannerAuthService, "fetchHttpEffect">;

const authFailure = (error: { readonly statusCode: number }) => {
  switch (error.statusCode) {
    case 400: {
      return SetupProgressInvalidRequest.make({
        message: "Your setup progress is invalid.",
      });
    }
    case 401: {
      return SetupProgressUnauthorized.make({
        message: "Sign in to continue setup.",
      });
    }
    case 403: {
      return SetupProgressForbidden.make({
        message: "This request is not allowed.",
      });
    }
    case 409: {
      return SetupProgressConflict.make({
        message: "Setup changed in another tab. Reload to continue.",
      });
    }
    case 429: {
      return SetupProgressRateLimited.make({
        message: "Too many requests. Wait a moment and try again.",
      });
    }
    default: {
      return SetupProgressUnavailable.make({
        message: "Your setup progress couldn’t be saved. Try again.",
      });
    }
  }
};

export const setupProgressHttpApiLayer = (auth: ProgressAuthHttp) => {
  const handlers = HttpApiBuilder.group(
    SetupProgressApi,
    "setupProgress",
    (group) =>
      group.handle("save", ({ payload }) =>
        Effect.gen(function* saveProgress() {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const source = yield* HttpServerRequest.toWeb(request).pipe(
            Effect.orDie
          );
          const headers = new Headers(Object.entries(request.headers));
          headers.delete("content-length");
          headers.set("content-type", "application/json");
          // The native HTTP boundary owns origin checks, rate limits, account
          // binding and the plugin's single compare-and-swap implementation.
          const native = yield* auth.fetchHttpEffect(
            new Request(new URL("/api/auth/setup/progress", source.url), {
              body: JSON.stringify(payload),
              headers,
              method: "POST",
              signal: source.signal,
            })
          );
          yield* HttpEffect.appendPreResponseHandler((_request, response) => {
            let forwarded = HttpServerResponse.mergeCookies(
              response,
              native.cookies
            );
            const retryAfter = native.headers["x-retry-after"];
            if (retryAfter !== undefined) {
              forwarded = HttpServerResponse.setHeader(
                forwarded,
                "x-retry-after",
                retryAfter
              );
            }
            return Effect.succeed(
              HttpServerResponse.setHeader(
                forwarded,
                "cache-control",
                "no-store"
              )
            );
          });
          if (native.status < 200 || native.status >= 300) {
            return yield* Effect.fail(
              authFailure({ statusCode: native.status })
            );
          }
          const result = yield* Effect.tryPromise({
            catch: () =>
              SetupProgressUnavailable.make({
                message: "Your setup progress couldn’t be confirmed.",
              }),
            try: () => HttpServerResponse.toWeb(native).json(),
          });
          return yield* Schema.decodeUnknownEffect(SavedSetupProgress)(
            result
          ).pipe(
            Effect.mapError(() =>
              SetupProgressUnavailable.make({
                message: "Your setup progress couldn’t be confirmed.",
              })
            )
          );
        })
      )
  );
  const schemaErrors = HttpApiMiddleware.layerSchemaErrorTransform(
    SetupProgressSchemaErrors,
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect middleware requires an Effect-valued callback.
    (error) =>
      error.kind === "Body" || error.kind === "ResponseHeaders"
        ? Effect.die(error)
        : Effect.fail(
            SetupProgressInvalidRequest.make({
              message: "Your setup progress is invalid.",
            })
          )
  );
  return HttpApiBuilder.layer(SetupProgressApi).pipe(
    Layer.provide(handlers),
    Layer.provide(schemaErrors),
    Layer.provide(JsonHttpPlatformServices)
  );
};
