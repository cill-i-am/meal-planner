import {
  EmailAddress,
  HouseholdOrganizationId,
  InvitationId,
  InvitationView,
  UserId,
} from "@meal-planner/household-api";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from "better-auth/api";
import { Result, Schema } from "effect";

const StoredInvitation = Schema.Struct({
  email: EmailAddress,
  expiresAt: Schema.Date,
  id: InvitationId,
  inviterId: UserId,
  organizationId: HouseholdOrganizationId,
  status: Schema.Literals(["pending", "accepted", "rejected", "canceled"]),
});
const NamedRecord = Schema.Struct({ name: Schema.String });
const parseInvitationId = Schema.decodeUnknownResult(InvitationId);
const parseInvitationPathId = Schema.decodeUnknownResult(
  Schema.StringFromUriComponent.pipe(Schema.decodeTo(InvitationId))
);
const parseStoredInvitation = Schema.decodeUnknownResult(StoredInvitation);

/** Better Auth's pending-only read cannot reconcile an accepted or declined response. */
export const invitationViewPlugin = () =>
  ({
    endpoints: {
      getSetupInvitation: createAuthEndpoint(
        "/setup/invitation/:id",
        { method: "GET", use: [sessionMiddleware] },
        async (ctx) => {
          ctx.setHeader("cache-control", "no-store");
          // Better Call leaves HTTP route parameters percent-encoded; direct API
          // callers already supply the underlying identity.
          const parsedId = ctx.request
            ? parseInvitationPathId(ctx.params.id)
            : parseInvitationId(ctx.params.id);
          if (Result.isFailure(parsedId)) {
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_INVITATION_ID",
              message: "This invitation is unavailable.",
            });
          }
          const stored = await ctx.context.adapter.findOne({
            model: "invitation",
            where: [{ field: "id", value: parsedId.success }],
          });
          if (stored === null) {
            throw new APIError("NOT_FOUND", {
              code: "INVITATION_NOT_FOUND",
              message: "This invitation is unavailable.",
            });
          }
          const parsedInvitation = parseStoredInvitation(stored);
          if (Result.isFailure(parsedInvitation)) {
            throw new APIError("NOT_FOUND", {
              code: "INVITATION_NOT_FOUND",
              message: "This invitation is unavailable.",
            });
          }
          const invitation = parsedInvitation.success;
          if (
            invitation.email.toLowerCase() !==
            ctx.context.session.user.email.toLowerCase()
          ) {
            throw new APIError("FORBIDDEN", {
              code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
              message: "This invitation is for another account.",
            });
          }
          const [organization, inviter] = await Promise.all([
            ctx.context.adapter.findOne({
              model: "organization",
              where: [{ field: "id", value: invitation.organizationId }],
            }),
            ctx.context.adapter.findOne({
              model: "user",
              where: [{ field: "id", value: invitation.inviterId }],
            }),
          ]);
          if (!organization || !inviter) {
            throw new APIError("NOT_FOUND", {
              code: "INVITATION_NOT_FOUND",
              message: "This invitation is unavailable.",
            });
          }
          if (invitation.status === "pending") {
            const membership = await ctx.context.adapter.findOne({
              model: "member",
              where: [
                { field: "organizationId", value: invitation.organizationId },
                { field: "userId", value: invitation.inviterId },
              ],
            });
            if (membership === null) {
              throw new APIError("NOT_FOUND", {
                code: "INVITATION_NOT_FOUND",
                message: "Ask a current family organiser for a new invitation.",
              });
            }
          }
          const status =
            invitation.status === "pending" &&
            invitation.expiresAt.getTime() <= Date.now()
              ? "expired"
              : invitation.status;
          return ctx.json(
            Schema.decodeUnknownSync(InvitationView)({
              email: invitation.email,
              familyName:
                Schema.decodeUnknownSync(NamedRecord)(organization).name,
              id: invitation.id,
              inviterName: Schema.decodeUnknownSync(NamedRecord)(inviter).name,
              organizationId: invitation.organizationId,
              status,
            })
          );
        }
      ),
    },
    id: "invitation-view",
  }) satisfies BetterAuthPlugin;
