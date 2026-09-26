import {
  InvitationReadApi,
  InvitationReadForbidden,
  InvitationReadInvalidRequest,
  InvitationReadNotFound,
  InvitationReadRateLimited,
  InvitationReadSchemaErrors,
  InvitationReadUnauthorized,
  InvitationReadUnavailable,
  InvitationView,
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

type InvitationAuthHttp = Pick<MealPlannerAuthService, "fetchHttpEffect">;

const invitationFailure = (error: { readonly statusCode: number }) => {
  switch (error.statusCode) {
    case 400: {
      return InvitationReadInvalidRequest.make({
        message: "This invitation is unavailable.",
      });
    }
    case 401: {
      return InvitationReadUnauthorized.make({
        message: "Sign in to continue.",
      });
    }
    case 403: {
      return InvitationReadForbidden.make({
        message: "This invitation is for another account.",
      });
    }
    case 404: {
      return InvitationReadNotFound.make({
        message: "This invitation is unavailable.",
      });
    }
    case 429: {
      return InvitationReadRateLimited.make({
        message: "Too many requests. Wait a moment and try again.",
      });
    }
    default: {
      return InvitationReadUnavailable.make({
        message: "This invitation couldn’t be loaded right now.",
      });
    }
  }
};

const parseInvitation = Schema.decodeUnknownEffect(InvitationView);

export const invitationReadHttpApiLayer = (auth: InvitationAuthHttp) => {
  const handlers = HttpApiBuilder.group(
    InvitationReadApi,
    "invitationRead",
    (group) =>
      group.handle("read", ({ params }) =>
        Effect.gen(function* handleInvitationRead() {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const source = yield* HttpServerRequest.toWeb(request).pipe(
            Effect.orDie
          );
          // Keep account binding, rate limits and recipient checks at the
          // same native HTTP boundary used by Better Auth's own client.
          const native = yield* auth.fetchHttpEffect(
            new Request(
              new URL(
                `/api/auth/setup/invitation/${encodeURIComponent(params.id)}`,
                source.url
              ),
              {
                headers: new Headers(Object.entries(request.headers)),
                method: "GET",
                signal: source.signal,
              }
            )
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
              invitationFailure({ statusCode: native.status })
            );
          }
          const invitation = yield* Effect.tryPromise({
            catch: () =>
              InvitationReadUnavailable.make({
                message: "This invitation couldn’t be loaded right now.",
              }),
            try: () => HttpServerResponse.toWeb(native).json(),
          });
          return yield* parseInvitation(invitation).pipe(
            Effect.mapError(() =>
              InvitationReadUnavailable.make({
                message: "This invitation couldn’t be loaded right now.",
              })
            )
          );
        })
      )
  );
  const schemaErrors = HttpApiMiddleware.layerSchemaErrorTransform(
    InvitationReadSchemaErrors,
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect middleware requires an Effect-valued callback.
    (error) =>
      error.kind === "Body" || error.kind === "ResponseHeaders"
        ? Effect.die(error)
        : Effect.fail(
            InvitationReadInvalidRequest.make({
              message: "This invitation is unavailable.",
            })
          )
  );
  return HttpApiBuilder.layer(InvitationReadApi).pipe(
    Layer.provide(handlers),
    Layer.provide(schemaErrors),
    Layer.provide(JsonHttpPlatformServices)
  );
};
