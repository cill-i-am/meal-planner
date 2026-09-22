import type {
  InvitationRejectionReason,
  HouseholdOrganizationId,
} from "@meal-planner/household-api";
import { HouseholdAuthResourceId } from "@meal-planner/household-api";
import { isAPIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Data, Effect, Schema } from "effect";

import * as authSchema from "../../auth/auth.database-schema.js";
import type { MealPlannerAuth } from "../../auth/auth.js";
import { HouseholdPeopleControlPlaneNotFound } from "./household-people.control-plane-not-found.js";
import { HouseholdPeopleControlPlaneUnavailable } from "./household-people.control-plane-unavailable.js";

export { HouseholdPeopleControlPlaneNotFound } from "./household-people.control-plane-not-found.js";
export { HouseholdPeopleControlPlaneUnavailable } from "./household-people.control-plane-unavailable.js";

export class HouseholdInvitationRejected extends Data.TaggedError(
  "HouseholdInvitationRejected"
)<{ readonly reason: InvitationRejectionReason }> {}
const invitationFailure = (code: string | undefined) => {
  const reasons: Readonly<Record<string, InvitationRejectionReason>> = {
    INVALID_EMAIL: "invalid_email",
    INVITATION_LIMIT_REACHED: "limit",
    USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: "already_member",
    USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: "already_invited",
    YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: "forbidden",
    YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE: "forbidden",
  };
  const reason = code ? reasons[code] : undefined;
  return reason
    ? new HouseholdInvitationRejected({ reason })
    : new HouseholdPeopleControlPlaneUnavailable();
};

export interface HouseholdControlPlaneInvitation {
  readonly email: string;
  readonly householdPersonId: string | null;
  readonly inviterId: string;
  readonly id: string;
  readonly status: string;
}

export interface HouseholdControlPlaneMember {
  readonly id: string;
  readonly role: string;
  readonly userId: string;
}

export interface HouseholdPeopleControlPlane {
  readonly listInvitationStates: (
    organizationId: HouseholdOrganizationId
  ) => Effect.Effect<
    readonly {
      readonly id: string;
      readonly status: string;
      readonly expiresAt: Date;
    }[],
    HouseholdPeopleControlPlaneUnavailable
  >;

  readonly createInvitation: (input: {
    readonly personId: string;
    readonly email: string;
    readonly headers: Headers;
    readonly invitationId: string;
    readonly organizationId: HouseholdOrganizationId;
  }) => Effect.Effect<
    HouseholdControlPlaneInvitation,
    HouseholdPeopleControlPlaneUnavailable | HouseholdInvitationRejected
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
            email: authSchema.invitation.email,
            householdPersonId: authSchema.invitation.householdPersonId,
            id: authSchema.invitation.id,
            inviterId: authSchema.invitation.inviterId,
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
        catch: (error) =>
          invitationFailure(isAPIError(error) ? error.body?.code : undefined),
        try: async () => {
          const invitation = await options.auth.createHouseholdInvitation({
            body: {
              email: input.email,
              householdPersonId: input.personId,
              organizationId: input.organizationId,
              role: "member",
            },
            headers: input.headers,
            invitationId: Schema.decodeUnknownSync(HouseholdAuthResourceId)(
              input.invitationId
            ),
          });
          return {
            email: invitation.email,
            householdPersonId: invitation.householdPersonId ?? null,
            id: invitation.id,
            inviterId: invitation.inviterId,
            status: invitation.status,
          };
        },
      }).pipe(
        Effect.catchTag("HouseholdInvitationRejected", (rejection) =>
          findInvitation(input).pipe(
            Effect.catchTag("HouseholdPeopleControlPlaneNotFound", () =>
              Effect.fail(rejection)
            )
          )
        )
      ),
    getInvitation: findInvitation,
    getMember: findMember,
    listInvitationStates: (organizationId) =>
      Effect.tryPromise({
        catch: unavailable,
        try: () =>
          options.database
            .select({
              expiresAt: authSchema.invitation.expiresAt,
              id: authSchema.invitation.id,
              status: authSchema.invitation.status,
            })
            .from(authSchema.invitation)
            .where(eq(authSchema.invitation.organizationId, organizationId)),
      }),
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
