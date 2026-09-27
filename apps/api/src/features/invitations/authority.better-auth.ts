import { InvitationView } from "@meal-planner/household-api";
import {
  InvitationAuthority,
  InvitationResponseFailure,
} from "@meal-planner/invitations/application";
import { Effect, Layer, Schema } from "effect";

import type { MealPlannerAuthService } from "../auth/index.js";

const failure = (error: { readonly statusCode: number }) => {
  const reasons: Readonly<Record<number, InvitationResponseFailure["reason"]>> =
    {
      400: "invalid_response",
      401: "unauthorized",
      403: "forbidden",
      404: "not_found",
      429: "rate_limited",
    };
  return new InvitationResponseFailure({
    reason: reasons[error.statusCode] ?? "unavailable",
  });
};

/** Headers stay in this request-scoped adapter; application operations receive domain values. */
export const InvitationAuthorityLive = (
  auth: MealPlannerAuthService,
  headers: Headers
) =>
  Layer.succeed(InvitationAuthority, {
    accept: (id) =>
      auth.api
        .acceptInvitation({ body: { invitationId: id }, headers })
        .pipe(Effect.asVoid, Effect.mapError(failure)),
    decline: (id) =>
      auth.api
        .rejectInvitation({ body: { invitationId: id }, headers })
        .pipe(Effect.asVoid, Effect.mapError(failure)),
    read: (id) =>
      Effect.gen(function* readRecipientInvitation() {
        const session = yield* auth.api
          .getSession({ headers })
          .pipe(Effect.mapError(failure));
        if (
          session === null ||
          (headers.has("x-meal-planner-user") &&
            headers.get("x-meal-planner-user") !== session.user.id)
        ) {
          return yield* Effect.fail(
            new InvitationResponseFailure({ reason: "unauthorized" })
          );
        }
        const raw = yield* auth.api
          .getSetupInvitation({ headers, params: { id } })
          .pipe(Effect.mapError(failure));
        return yield* Schema.decodeUnknownEffect(InvitationView)(raw).pipe(
          Effect.mapError(
            () => new InvitationResponseFailure({ reason: "unavailable" })
          )
        );
      }),
  });
