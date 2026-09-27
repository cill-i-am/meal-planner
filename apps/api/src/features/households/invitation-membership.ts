import { HouseholdPeoplePrincipal } from "@meal-planner/household-api";
import {
  InvitationMembership,
  InvitationResponseFailure,
} from "@meal-planner/invitations/application";
import { Effect, Layer, Schema } from "effect";

import type { AuthenticatedOrganizationResolver } from "../auth/index.js";
import type { HouseholdPeopleGateway } from "./household.gateway.js";
import {
  deriveHouseholdPeopleAuditActorId,
  deriveHouseholdPersonLinkageSubject,
} from "./people/household-people.identity.js";

export const InvitationMembershipLive = (
  people: Pick<HouseholdPeopleGateway, "list" | "completeAdultLink">,
  resolver: AuthenticatedOrganizationResolver,
  headers: Headers
) =>
  Layer.succeed(InvitationMembership, {
    link: (familyId, invitationId, mutationId) =>
      Effect.gen(function* linkInvitedPerson() {
        const scopedHeaders = new Headers(headers);
        scopedHeaders.delete("x-meal-planner-household");
        const actor = yield* resolver
          .resolve(scopedHeaders, familyId)
          .pipe(
            Effect.mapError(
              () => new InvitationResponseFailure({ reason: "forbidden" })
            )
          );
        const [actorId, linkageSubject] = yield* Effect.all([
          deriveHouseholdPeopleAuditActorId(actor.organizationId, actor.userId),
          deriveHouseholdPersonLinkageSubject(
            actor.organizationId,
            actor.userId
          ),
        ]).pipe(
          Effect.mapError(
            () => new InvitationResponseFailure({ reason: "unavailable" })
          )
        );
        const principal = yield* Schema.decodeUnknownEffect(
          HouseholdPeoplePrincipal
        )({
          actorId,
          creatorAuthority:
            actor.membershipRole === "owner" ? "better_auth_owner" : null,
          linkageSubject,
          organizationId: actor.organizationId,
        }).pipe(
          Effect.mapError(
            () => new InvitationResponseFailure({ reason: "unavailable" })
          )
        );
        const roster = yield* people
          .list({ includeArchived: false, principal })
          .pipe(
            Effect.mapError(
              () => new InvitationResponseFailure({ reason: "unavailable" })
            )
          );
        if (roster.currentPersonId === null) {
          yield* people
            .completeAdultLink({
              payload: { invitationId, mutationId },
              principal,
            })
            .pipe(
              Effect.mapError(
                () => new InvitationResponseFailure({ reason: "unavailable" })
              )
            );
        }
      }),
  });
