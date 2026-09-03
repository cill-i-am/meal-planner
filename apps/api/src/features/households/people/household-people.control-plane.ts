import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Effect } from "effect";

import * as authSchema from "../../auth/auth.database-schema.js";
import type { MealPlannerAuth } from "../../auth/auth.js";
import { HouseholdPeopleControlPlaneNotFound } from "./household-people.control-plane-not-found.js";
import { HouseholdPeopleControlPlaneUnavailable } from "./household-people.control-plane-unavailable.js";

export { HouseholdPeopleControlPlaneNotFound } from "./household-people.control-plane-not-found.js";
export { HouseholdPeopleControlPlaneUnavailable } from "./household-people.control-plane-unavailable.js";

export interface HouseholdControlPlaneInvitation {
  readonly id: string;
  readonly status: string;
}

export interface HouseholdControlPlaneMember {
  readonly id: string;
  readonly role: string;
  readonly userId: string;
}

export interface HouseholdPeopleControlPlane {
  readonly createInvitation: (input: {
    readonly email: string;
    readonly headers: Headers;
    readonly invitationId: string;
    readonly organizationId: HouseholdOrganizationId;
  }) => Effect.Effect<
    HouseholdControlPlaneInvitation,
    HouseholdPeopleControlPlaneUnavailable
  >;
  readonly getInvitation: (input: {
    readonly invitationId: string;
    readonly organizationId: HouseholdOrganizationId;
  }) => Effect.Effect<
    HouseholdControlPlaneInvitation,
    HouseholdPeopleControlPlaneNotFound | HouseholdPeopleControlPlaneUnavailable
  >;
  readonly getMember: (input: {
    readonly memberId: string;
    readonly organizationId: HouseholdOrganizationId;
  }) => Effect.Effect<
    HouseholdControlPlaneMember,
    HouseholdPeopleControlPlaneNotFound | HouseholdPeopleControlPlaneUnavailable
  >;
  readonly listMemberUserIds: (
    organizationId: HouseholdOrganizationId
  ) => Effect.Effect<readonly string[], HouseholdPeopleControlPlaneUnavailable>;
  readonly removeMember: (input: {
    readonly headers: Headers;
    readonly memberId: string;
    readonly organizationId: HouseholdOrganizationId;
    readonly self: boolean;
  }) => Effect.Effect<void, HouseholdPeopleControlPlaneUnavailable>;
}

const unavailable = () => new HouseholdPeopleControlPlaneUnavailable();

/** Better Auth control-plane adapter. Raw account and invitation data never leave this API seam. */
export const makeHouseholdPeopleControlPlane = (options: {
  readonly auth: MealPlannerAuth;
  readonly database: DrizzleD1Database;
}): HouseholdPeopleControlPlane => {
  const findInvitation = (input: {
    readonly invitationId: string;
    readonly organizationId: HouseholdOrganizationId;
  }) =>
    Effect.tryPromise({
      catch: unavailable,
      try: () =>
        options.database
          .select({
            id: authSchema.invitation.id,
            status: authSchema.invitation.status,
          })
          .from(authSchema.invitation)
          .where(
            and(
              eq(authSchema.invitation.id, input.invitationId),
              eq(authSchema.invitation.organizationId, input.organizationId)
            )
          )
          .limit(1),
    }).pipe(
      Effect.flatMap(([invitation]) =>
        invitation === undefined
          ? Effect.fail(new HouseholdPeopleControlPlaneNotFound())
          : Effect.succeed(invitation)
      )
    );

  const findMember = (input: {
    readonly memberId: string;
    readonly organizationId: HouseholdOrganizationId;
  }) =>
    Effect.tryPromise({
      catch: unavailable,
      try: () =>
        options.database
          .select({
            id: authSchema.member.id,
            role: authSchema.member.role,
            userId: authSchema.member.userId,
          })
          .from(authSchema.member)
          .where(
            and(
              eq(authSchema.member.id, input.memberId),
              eq(authSchema.member.organizationId, input.organizationId)
            )
          )
          .limit(1),
    }).pipe(
      Effect.flatMap(([member]) =>
        member === undefined
          ? Effect.fail(new HouseholdPeopleControlPlaneNotFound())
          : Effect.succeed(member)
      )
    );

  return {
    createInvitation: (input) =>
      Effect.tryPromise({
        catch: unavailable,
        try: async () => {
          const invitation = await options.auth.api.createInvitation({
            body: {
              email: input.email,
              id: input.invitationId,
              organizationId: input.organizationId,
              role: "member",
            },
            headers: input.headers,
          });
          return {
            id: invitation.id,
            status: invitation.status,
          };
        },
      }),
    getInvitation: findInvitation,
    getMember: findMember,
    listMemberUserIds: (organizationId) =>
      Effect.tryPromise({
        catch: unavailable,
        try: () =>
          options.database
            .select({ userId: authSchema.member.userId })
            .from(authSchema.member)
            .where(eq(authSchema.member.organizationId, organizationId)),
      }).pipe(Effect.map((members) => members.map(({ userId }) => userId))),
    removeMember: (input) =>
      Effect.tryPromise({
        catch: unavailable,
        try: async () => {
          if (input.self) {
            await options.auth.api.leaveOrganization({
              body: { organizationId: input.organizationId },
              headers: input.headers,
            });
            return;
          }
          await options.auth.api.removeMember({
            body: {
              memberIdOrEmail: input.memberId,
              organizationId: input.organizationId,
            },
            headers: input.headers,
          });
        },
      }),
  };
};
