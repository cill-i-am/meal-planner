import type {
  HouseholdOrganizationId,
  InvitationId,
  InvitationView,
  HouseholdPersonMutationId,
} from "@meal-planner/household-api";
import { Context, Data, Effect, Layer } from "effect";

import type {
  InvitationResponse,
  InvitationResponseResult,
} from "./invitation.js";

export class InvitationResponseFailure extends Data.TaggedError(
  "InvitationResponseFailure"
)<{
  readonly reason:
    | "invalid_response"
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "rate_limited"
    | "unavailable";
}> {}

/** Request-scoped invitation authority. The adapter authenticates the caller. */
export interface InvitationAuthority {
  readonly read: (
    id: InvitationId
  ) => Effect.Effect<typeof InvitationView.Type, InvitationResponseFailure>;
  readonly accept: (
    id: InvitationId
  ) => Effect.Effect<void, InvitationResponseFailure>;
  readonly decline: (
    id: InvitationId
  ) => Effect.Effect<void, InvitationResponseFailure>;
}
export const InvitationAuthority = Context.Service<InvitationAuthority>(
  "meal-planner/invitations/InvitationAuthority"
);

/** The household adapter owns membership admission and account/person linking. */
export interface InvitationMembership {
  readonly link: (
    familyId: HouseholdOrganizationId,
    invitationId: InvitationId,
    mutationId: HouseholdPersonMutationId
  ) => Effect.Effect<void, InvitationResponseFailure>;
}
export const InvitationMembership = Context.Service<InvitationMembership>(
  "meal-planner/invitations/InvitationMembership"
);

export interface InvitationResponseService {
  readonly respond: (
    id: InvitationId,
    payload: InvitationResponse
  ) => Effect.Effect<
    typeof InvitationResponseResult.Type,
    InvitationResponseFailure
  >;
}
export const InvitationResponseService =
  Context.Service<InvitationResponseService>(
    "meal-planner/invitations/InvitationResponseService"
  );
export const InvitationResponseServiceLive = Layer.effect(
  InvitationResponseService,
  Effect.gen(function* invitationApplication() {
    const authority = yield* InvitationAuthority;
    const membership = yield* InvitationMembership;
    return InvitationResponseService.of({
      respond: (id, payload) =>
        Effect.gen(function* respondToInvitation() {
          const view = yield* authority.read(id);
          if (payload.decision === "decline") {
            if (view.status === "pending") {
              yield* authority.decline(id);
            } else if (view.status !== "rejected") {
              return yield* Effect.fail(
                new InvitationResponseFailure({ reason: "invalid_response" })
              );
            }
            return {
              familyId: view.organizationId,
              status: "declined" as const,
            };
          }
          if (view.status === "pending") {
            yield* authority.accept(id);
          } else if (view.status !== "accepted") {
            return yield* Effect.fail(
              new InvitationResponseFailure({ reason: "invalid_response" })
            );
          }
          yield* membership.link(view.organizationId, id, payload.mutationId);
          return { familyId: view.organizationId, status: "joined" as const };
        }),
    });
  })
);
