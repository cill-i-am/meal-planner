import {
  HouseholdPersonMutationId,
  InvitationId,
  UserId,
} from "@meal-planner/household-api";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, resetPassword } from "better-auth/api";
import type { AuthEndpoint } from "better-auth/api";
import {
  getOrgAdapter,
  hasPermission,
  organization,
} from "better-auth/plugins/organization";
import type {
  DefaultOrganizationPlugin,
  Invitation,
  OrganizationOptions,
} from "better-auth/plugins/organization";
import { Clock, Effect, Schema } from "effect";

import {
  AcceptInvitationMutation,
  CancelInvitationMutation,
  RejectInvitationMutation,
  ResetPasswordMutation,
} from "./auth-atomic-store.js";
import type { AuthAtomicStore } from "./auth-atomic-store.js";

const parseCancellation = Schema.decodeUnknownSync(CancelInvitationMutation);
const parseCancellationPerson = Schema.decodeUnknownSync(
  Schema.Struct({
    householdPersonId: Schema.optional(Schema.NullOr(Schema.String)),
  })
);
const parseAcceptance = Schema.decodeUnknownSync(AcceptInvitationMutation);
const parseRejection = Schema.decodeUnknownSync(RejectInvitationMutation);
const parseReset = Schema.decodeUnknownSync(ResetPasswordMutation);
const parseInvitationId = Schema.decodeUnknownSync(InvitationId);
const parseUserId = Schema.decodeUnknownSync(UserId);

const requiresVerifiedEmail = (
  options: OrganizationOptions,
  generation: NonNullable<
    NonNullable<BetterAuthOptions["advanced"]>["database"]
  >["generateId"]
) =>
  options.requireEmailVerificationOnInvitation ??
  (generation !== undefined && generation !== "uuid");

const invalidToken = () =>
  new APIError("BAD_REQUEST", {
    code: "INVALID_TOKEN",
    message: "Invalid token",
  });
const unavailableInvitation = () =>
  new APIError("BAD_REQUEST", {
    code: "INVITATION_NOT_FOUND",
    message: "Invitation not found",
  });

const receiptSchema = {
  authMutationIntent: {
    fields: {
      accountId: { required: true, type: "string" },
      createdAt: { required: true, type: "date" },
    },
  },
  authMutationReceipt: {
    fields: {
      accountId: { required: true, type: "string" },
      applied: { required: true, type: "boolean" },
      attemptId: { required: true, type: "string" },
      createdAt: { required: true, type: "date" },
      requestDigest: { required: true, type: "string" },
    },
  },
} as const satisfies BetterAuthPlugin["schema"];

/** Reuses Better Auth 1.7.2's request contract, password policy and hasher; D1 owns the commit. */
export const atomicPasswordResetPlugin = (
  store: AuthAtomicStore
): {
  id: "atomic-password-reset";
  schema: typeof receiptSchema;
  endpoints: { resetPassword: typeof resetPassword };
} =>
  ({
    endpoints: {
      resetPassword: createAuthEndpoint(
        resetPassword.path,
        resetPassword.options,
        async (ctx) => {
          const token = ctx.body.token || ctx.query?.token;
          if (!token) {
            throw invalidToken();
          }
          const { newPassword } = ctx.body;
          if (
            newPassword.length < ctx.context.password.config.minPasswordLength
          ) {
            throw new APIError("BAD_REQUEST", {
              code: "PASSWORD_TOO_SHORT",
              message: "Password is too short",
            });
          }
          if (
            newPassword.length > ctx.context.password.config.maxPasswordLength
          ) {
            throw new APIError("BAD_REQUEST", {
              code: "PASSWORD_TOO_LONG",
              message: "Password is too long",
            });
          }
          const identifier = `reset-password:${token}`;
          const verification =
            await ctx.context.internalAdapter.findVerificationValue(identifier);
          const now = await Effect.runPromise(Clock.currentTimeMillis);
          if (!verification || verification.expiresAt.getTime() < now) {
            await store.reconcilePasswordReset(identifier);
            throw invalidToken();
          }
          const user = await ctx.context.internalAdapter.findUserById(
            verification.value
          );
          if (!user) {
            throw invalidToken();
          }
          const passwordHash = await ctx.context.password.hash(newPassword);
          const accountId = ctx.context.generateId({ model: "account" });
          const committed = await store.resetPassword(
            parseReset({
              accountId,
              identifier,
              // Better Auth 1.7.2's local credential issuer, also used by its canonical schema.
              issuer: "local:credential",
              passwordHash,
              requestPassword: newPassword,
              userId: user.id,
              verificationId: verification.id,
            })
          );
          if (!committed) {
            throw invalidToken();
          }
          await ctx.context.options.emailAndPassword?.onPasswordReset?.(
            { user },
            ctx.request
          );
          return ctx.json({ status: true });
        }
      ),
    },
    id: "atomic-password-reset",
    schema: receiptSchema,
  }) satisfies BetterAuthPlugin;

const CancellationBody = Schema.toStandardSchemaV1(
  Schema.Struct({
    invitationId: InvitationId,
    mutationId: HouseholdPersonMutationId,
  }),
  { parseOptions: { onExcessProperty: "error" } }
);
type NativeCancellationEndpoint =
  DefaultOrganizationPlugin<OrganizationOptions>["endpoints"]["cancelInvitation"];
type CancellationEndpoint = AuthEndpoint<
  NativeCancellationEndpoint["path"],
  Omit<NativeCancellationEndpoint["options"], "body"> & {
    body: typeof CancellationBody;
  },
  Invitation
>;

const makeAtomicCancellation = (
  options: OrganizationOptions,
  store: AuthAtomicStore
): CancellationEndpoint => {
  const native = organization(options).endpoints.cancelInvitation;
  return createAuthEndpoint(
    native.path,
    {
      ...native.options,
      body: CancellationBody,
    },
    async (ctx) => {
      const { session } = ctx.context;
      const adapter = getOrgAdapter(ctx.context, options);
      const invitation = await adapter.findInvitationById(
        ctx.body.invitationId
      );
      if (!invitation) {
        throw unavailableInvitation();
      }
      const member = await adapter.findMemberByOrgId({
        organizationId: invitation.organizationId,
        userId: session.user.id,
      });
      if (
        !member ||
        !(await hasPermission(
          {
            options,
            organizationId: invitation.organizationId,
            permissions: { invitation: ["cancel"] },
            role: member.role,
          },
          ctx
        ))
      ) {
        throw new APIError("FORBIDDEN", {
          code: "YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION",
          message: "You are not allowed to cancel this invitation",
        });
      }
      const canceledOrganization = await adapter.findOrganizationById(
        invitation.organizationId
      );
      if (!canceledOrganization) {
        throw unavailableInvitation();
      }
      await options.organizationHooks?.beforeCancelInvitation?.({
        cancelledBy: session.user,
        invitation,
        organization: canceledOrganization,
      });
      const committed = await store.cancelInvitation(
        parseCancellation({
          householdPersonId:
            parseCancellationPerson(invitation).householdPersonId ?? null,
          invitationId: invitation.id,
          memberId: member.id,
          memberRole: member.role,
          mutationId: ctx.body.mutationId,
          organizationId: invitation.organizationId,
          sessionToken: session.session.token,
          userId: session.user.id,
        })
      );
      if (!committed) {
        throw new APIError("CONFLICT", {
          code: "INVITATION_CANCELLATION_CONFLICT",
          message: "Invitation cannot be canceled",
        });
      }
      const canceledInvitation = await adapter.findInvitationById(
        invitation.id
      );
      if (!canceledInvitation) {
        throw unavailableInvitation();
      }
      await options.organizationHooks?.afterCancelInvitation?.({
        cancelledBy: session.user,
        invitation: canceledInvitation,
        organization: canceledOrganization,
      });
      return ctx.json(canceledInvitation);
    }
  );
};

/** Keeps organization middleware; acceptance and cancellation each have one D1 commit. */
type AtomicOrganizationPlugin<Options extends OrganizationOptions> = Omit<
  DefaultOrganizationPlugin<Options>,
  "endpoints"
> & {
  endpoints: Omit<
    DefaultOrganizationPlugin<Options>["endpoints"],
    "acceptInvitation" | "cancelInvitation" | "rejectInvitation"
  > & {
    cancelInvitation: ReturnType<typeof makeAtomicCancellation>;
    acceptInvitation: DefaultOrganizationPlugin<OrganizationOptions>["endpoints"]["acceptInvitation"];
    rejectInvitation: DefaultOrganizationPlugin<OrganizationOptions>["endpoints"]["rejectInvitation"];
  };
};

export const atomicOrganization = <Options extends OrganizationOptions>(
  options: Options,
  store: AuthAtomicStore
): AtomicOrganizationPlugin<Options> => {
  if (options.teams?.enabled) {
    throw new Error("Atomic household invitations do not support teams.");
  }
  const plugin = organization(options);
  const nativeOptions: OrganizationOptions = options;
  const nativeEndpoints = organization(nativeOptions).endpoints;
  const native = nativeEndpoints.acceptInvitation;
  Object.assign(plugin.schema.member, {
    indexes: [
      {
        fields: ["organizationId", "userId"],
        name: "member_organization_user_uidx",
        unique: true,
      },
    ],
  });
  return {
    ...plugin,
    endpoints: {
      ...plugin.endpoints,
      acceptInvitation: createAuthEndpoint(
        native.path,
        native.options,
        async (ctx) => {
          const { session } = ctx.context;
          const adapterOptions: OrganizationOptions = options;
          const adapter = getOrgAdapter(ctx.context, adapterOptions);
          const invitation = await adapter.findInvitationById(
            ctx.body.invitationId
          );
          const now = await Effect.runPromise(Clock.currentTimeMillis);
          if (!invitation) {
            throw unavailableInvitation();
          }
          if (
            invitation.email.toLowerCase() !== session.user.email.toLowerCase()
          ) {
            throw new APIError("FORBIDDEN", {
              code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
              message: "You are not the recipient of this invitation",
            });
          }
          if (
            invitation.status !== "pending" ||
            invitation.expiresAt.getTime() < now
          ) {
            await store.reconcileInvitation(
              parseInvitationId(invitation.id),
              session.session.token,
              parseUserId(session.user.id)
            );
            throw unavailableInvitation();
          }
          // Matches native 1.7.2's default for opaque IDs; custom generation requires verification.
          const generation = ctx.context.options.advanced?.database?.generateId;
          const requireVerified = requiresVerifiedEmail(options, generation);
          if (requireVerified && !session.user.emailVerified) {
            throw new APIError("FORBIDDEN", {
              code: "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
              message: "Verify your email before accepting this invitation",
            });
          }
          const acceptedOrganization = await adapter.findOrganizationById(
            invitation.organizationId
          );
          if (!acceptedOrganization) {
            throw unavailableInvitation();
          }
          const limit = options.membershipLimit || 100;
          const membershipLimit = Schema.is(Schema.Number)(limit)
            ? limit
            : await limit(session.user, acceptedOrganization);
          if (
            (await adapter.countMembers({
              organizationId: invitation.organizationId,
            })) >= membershipLimit
          ) {
            throw new APIError("FORBIDDEN", {
              code: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED",
              message: "Organization membership limit reached",
            });
          }
          await options.organizationHooks?.beforeAcceptInvitation?.({
            invitation,
            organization: acceptedOrganization,
            user: session.user,
          });
          const acceptance = parseAcceptance({
            email: session.user.email,
            invitationId: invitation.id,
            memberId: ctx.context.generateId({ model: "member" }),
            membershipLimit,
            organizationId: invitation.organizationId,
            sessionToken: session.session.token,
            userId: session.user.id,
          });
          const committed = await store.acceptInvitation(acceptance);
          if (!committed) {
            throw unavailableInvitation();
          }
          const [acceptedInvitation, member] = await Promise.all([
            adapter.findInvitationById(invitation.id),
            adapter.findMemberById(acceptance.memberId),
          ]);
          if (!acceptedInvitation || !member) {
            throw new Error("Atomic invitation commit is missing its records.");
          }
          await options.organizationHooks?.afterAcceptInvitation?.({
            invitation: acceptedInvitation,
            member,
            organization: acceptedOrganization,
            user: session.user,
          });
          return ctx.json({ invitation: acceptedInvitation, member });
        }
      ),
      cancelInvitation: makeAtomicCancellation(options, store),
      rejectInvitation: createAuthEndpoint(
        nativeEndpoints.rejectInvitation.path,
        nativeEndpoints.rejectInvitation.options,
        async (ctx) => {
          const { session } = ctx.context;
          const adapterOptions: OrganizationOptions = options;
          const adapter = getOrgAdapter(ctx.context, adapterOptions);
          const invitation = await adapter.findInvitationById(
            ctx.body.invitationId
          );
          if (!invitation || invitation.status !== "pending") {
            throw unavailableInvitation();
          }
          if (
            invitation.email.toLowerCase() !== session.user.email.toLowerCase()
          ) {
            throw new APIError("FORBIDDEN", {
              code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
              message: "You are not the recipient of this invitation",
            });
          }
          const generation = ctx.context.options.advanced?.database?.generateId;
          if (
            requiresVerifiedEmail(options, generation) &&
            !session.user.emailVerified
          ) {
            throw new APIError("FORBIDDEN", {
              code: "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
              message: "Verify your email before rejecting this invitation",
            });
          }
          const acceptedOrganization = await adapter.findOrganizationById(
            invitation.organizationId
          );
          if (!acceptedOrganization) {
            throw unavailableInvitation();
          }
          await options.organizationHooks?.beforeRejectInvitation?.({
            invitation,
            organization: acceptedOrganization,
            user: session.user,
          });
          const committed = await store.rejectInvitation(
            parseRejection({
              email: session.user.email,
              invitationId: invitation.id,
              organizationId: invitation.organizationId,
              sessionToken: session.session.token,
              userId: session.user.id,
            })
          );
          if (!committed) {
            throw unavailableInvitation();
          }
          const rejectedInvitation = await adapter.findInvitationById(
            invitation.id
          );
          if (!rejectedInvitation) {
            throw new Error("Rejected invitation is missing after its commit.");
          }
          await options.organizationHooks?.afterRejectInvitation?.({
            invitation: rejectedInvitation,
            organization: acceptedOrganization,
            user: session.user,
          });
          return ctx.json({ invitation: rejectedInvitation, member: null });
        }
      ),
    },
  };
};
