import { InvitationId, UserId } from "@meal-planner/household-api";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, resetPassword } from "better-auth/api";
import { getOrgAdapter, organization } from "better-auth/plugins/organization";
import type {
  DefaultOrganizationPlugin,
  OrganizationOptions,
} from "better-auth/plugins/organization";
import { Clock, Effect, Schema } from "effect";

import {
  AcceptInvitationMutation,
  ResetPasswordMutation,
} from "./auth-atomic-store.js";
import type { AuthAtomicStore } from "./auth-atomic-store.js";

const parseAcceptance = Schema.decodeUnknownSync(AcceptInvitationMutation);
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

/** Keeps organization middleware and all other native endpoints; acceptance has one D1 commit. */
type AtomicOrganizationPlugin<Options extends OrganizationOptions> = Omit<
  DefaultOrganizationPlugin<Options>,
  "endpoints"
> & {
  endpoints: Omit<
    DefaultOrganizationPlugin<Options>["endpoints"],
    "acceptInvitation"
  > & {
    acceptInvitation: DefaultOrganizationPlugin<OrganizationOptions>["endpoints"]["acceptInvitation"];
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
  const native = organization(nativeOptions).endpoints.acceptInvitation;
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
    },
  };
};
