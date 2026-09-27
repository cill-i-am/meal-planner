import type {
  EmailAddress,
  HouseholdOrganizationId,
  InvitationId,
  UserId,
} from "@meal-planner/household-api";
import { HouseholdPeopleUnavailable } from "@meal-planner/household-api";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Effect } from "effect";

import * as authSchema from "../../auth/auth.database-schema.js";
import type { OutboundEmail } from "../../email/index.js";
import { renderInvitationMail } from "./invitation-mail.js";

export interface HouseholdInvitationMailRequest {
  readonly email: EmailAddress;
  readonly invitationId: InvitationId;
  readonly inviterId: UserId;
  readonly organizationId: HouseholdOrganizationId;
}

/** Read display names after household association and submit the same invite ID. */
export const makeHouseholdInvitationMailer =
  (options: {
    readonly baseURL: string;
    readonly database: DrizzleD1Database;
    readonly send: (mail: OutboundEmail) => Promise<void>;
  }) =>
  (input: HouseholdInvitationMailRequest) =>
    Effect.tryPromise({
      catch: () => HouseholdPeopleUnavailable.make({}),
      try: async () => {
        const [family, inviter] = await Promise.all([
          options.database
            .select({ name: authSchema.organization.name })
            .from(authSchema.organization)
            .where(eq(authSchema.organization.id, input.organizationId))
            .limit(1),
          options.database
            .select({ name: authSchema.user.name })
            .from(authSchema.user)
            .where(eq(authSchema.user.id, input.inviterId))
            .limit(1),
        ]);
        if (family[0] === undefined || inviter[0] === undefined) {
          throw new Error("Invitation display names unavailable");
        }
        await options.send(
          await renderInvitationMail({
            email: input.email,
            familyName: family[0].name,
            inviterName: inviter[0].name,
            url: `${options.baseURL}/invitation/${encodeURIComponent(input.invitationId)}`,
          })
        );
      },
    });
