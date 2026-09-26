import type { BetterAuthApiError } from "@alchemy.run/better-auth";
import type {
  InvitationRejectionReason,
  HouseholdOrganizationId,
} from "@meal-planner/household-api";
import {
  EmailAddress,
  HouseholdPersonId,
  InvitationId,
  MemberId,
  UserId,
} from "@meal-planner/household-api";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Data, Effect, Schema } from "effect";

import type { MealPlannerAuthService } from "../../auth/auth.alchemy.js";
import * as authSchema from "../../auth/auth.database-schema.js";
import { HouseholdPeopleControlPlaneNotFound } from "./household-people.control-plane-not-found.js";
import { HouseholdPeopleControlPlaneUnavailable } from "./household-people.control-plane-unavailable.js";

export { HouseholdPeopleControlPlaneNotFound } from "./household-people.control-plane-not-found.js";
export { HouseholdPeopleControlPlaneUnavailable } from "./household-people.control-plane-unavailable.js";

export class HouseholdInvitationRejected extends Data.TaggedError(
  "HouseholdInvitationRejected"
)<{ readonly reason: InvitationRejectionReason }> {}
const invitationFailure = (error: BetterAuthApiError) => {
  const code = error.body?.code;
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

const HouseholdControlPlaneInvitationSchema = Schema.Struct({
  email: EmailAddress,
  householdPersonId: Schema.NullOr(HouseholdPersonId),
  id: InvitationId,
  inviterId: UserId,
  status: Schema.String,
});
export type HouseholdControlPlaneInvitation =
  typeof HouseholdControlPlaneInvitationSchema.Type;

const HouseholdControlPlaneMemberSchema = Schema.Struct({
  id: MemberId,
  role: Schema.String,
  userId: UserId,
});
export type HouseholdControlPlaneMember =
  typeof HouseholdControlPlaneMemberSchema.Type;

const HouseholdControlPlaneInvitationStateSchema = Schema.Struct({
  expiresAt: Schema.Date,
  id: InvitationId,
  status: Schema.String,
});

const decodeInvitation = Schema.decodeUnknownEffect(
  HouseholdControlPlaneInvitationSchema
);
const decodeMember = Schema.decodeUnknownEffect(
  HouseholdControlPlaneMemberSchema
);
const decodeInvitationStates = Schema.decodeUnknownEffect(
  Schema.Array(HouseholdControlPlaneInvitationStateSchema)
);
const decodeMemberUserIds = Schema.decodeUnknownEffect(Schema.Array(UserId));

export interface HouseholdPeopleControlPlane {
  readonly listInvitationStates: (
    organizationId: HouseholdOrganizationId
  ) => Effect.Effect<
    readonly (typeof HouseholdControlPlaneInvitationStateSchema.Type)[],
    HouseholdPeopleControlPlaneUnavailable
  >;

  readonly createInvitation: (input: {
    readonly personId: HouseholdPersonId;
    readonly email: EmailAddress;
    readonly headers: Headers;
    readonly invitationId: InvitationId;
    readonly organizationId: HouseholdOrganizationId;
  }) => Effect.Effect<
    HouseholdControlPlaneInvitation,
    HouseholdPeopleControlPlaneUnavailable | HouseholdInvitationRejected
  >;
  readonly getInvitation: (input: {
    readonly invitationId: InvitationId;
    readonly organizationId: HouseholdOrganizationId;
  }) => Effect.Effect<
    HouseholdControlPlaneInvitation,
    HouseholdPeopleControlPlaneNotFound | HouseholdPeopleControlPlaneUnavailable
  >;
  readonly getMember: (input: {
    readonly memberId: MemberId;
    readonly organizationId: HouseholdOrganizationId;
  }) => Effect.Effect<
    HouseholdControlPlaneMember,
    HouseholdPeopleControlPlaneNotFound | HouseholdPeopleControlPlaneUnavailable
  >;
  readonly listMemberUserIds: (
    organizationId: HouseholdOrganizationId
  ) => Effect.Effect<readonly UserId[], HouseholdPeopleControlPlaneUnavailable>;
  readonly removeMember: (input: {
    readonly headers: Headers;
    readonly memberId: MemberId;
    readonly organizationId: HouseholdOrganizationId;
    readonly self: boolean;
  }) => Effect.Effect<void, HouseholdPeopleControlPlaneUnavailable>;
}

const unavailable = () => new HouseholdPeopleControlPlaneUnavailable();

/** Better Auth control-plane adapter. Raw account and invitation data never leave this API seam. */
export const makeHouseholdPeopleControlPlane = (options: {
  readonly auth: MealPlannerAuthService;
  readonly database: DrizzleD1Database;
}): HouseholdPeopleControlPlane => {
  const findInvitation = (input: {
    readonly invitationId: InvitationId;
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
        Effect.gen(function* parseInvitationRow() {
          if (invitation === undefined) {
            return yield* Effect.fail(
              new HouseholdPeopleControlPlaneNotFound()
            );
          }
          return yield* decodeInvitation(invitation).pipe(
            Effect.mapError(unavailable)
          );
        })
      )
    );

  const findMember = (input: {
    readonly memberId: MemberId;
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
        Effect.gen(function* parseMemberRow() {
          if (member === undefined) {
            return yield* Effect.fail(
              new HouseholdPeopleControlPlaneNotFound()
            );
          }
          return yield* decodeMember(member).pipe(Effect.mapError(unavailable));
        })
      )
    );

  return {
    createInvitation: (input) =>
      options.auth
        .createHouseholdInvitation({
          body: {
            email: input.email,
            householdPersonId: input.personId,
            organizationId: input.organizationId,
            role: "member",
          },
          headers: input.headers,
          invitationId: input.invitationId,
        })
        .pipe(
          Effect.mapError(invitationFailure),
          Effect.catchDefect(() => Effect.fail(unavailable())),
          Effect.map((invitation) => ({
            email: invitation.email,
            householdPersonId: invitation.householdPersonId ?? null,
            id: invitation.id,
            inviterId: invitation.inviterId,
            status: invitation.status,
          })),
          Effect.flatMap((invitation) =>
            decodeInvitation(invitation).pipe(Effect.mapError(unavailable))
          ),
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
      }).pipe(
        Effect.flatMap((states) =>
          decodeInvitationStates(states).pipe(Effect.mapError(unavailable))
        )
      ),
    listMemberUserIds: (organizationId) =>
      Effect.tryPromise({
        catch: unavailable,
        try: () =>
          options.database
            .select({ userId: authSchema.member.userId })
            .from(authSchema.member)
            .where(eq(authSchema.member.organizationId, organizationId)),
      }).pipe(
        Effect.flatMap((members) =>
          decodeMemberUserIds(members.map(({ userId }) => userId)).pipe(
            Effect.mapError(unavailable)
          )
        )
      ),
    removeMember: (input) =>
      (input.self
        ? options.auth.api
            .leaveOrganization({
              body: { organizationId: input.organizationId },
              headers: input.headers,
            })
            .pipe(Effect.asVoid)
        : options.auth.api
            .removeMember({
              body: {
                memberIdOrEmail: input.memberId,
                organizationId: input.organizationId,
              },
              headers: input.headers,
            })
            .pipe(Effect.asVoid)
      ).pipe(
        Effect.mapError(unavailable),
        Effect.catchDefect(() => Effect.fail(unavailable()))
      ),
  };
};
