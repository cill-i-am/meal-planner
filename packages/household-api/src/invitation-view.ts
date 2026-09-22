import { Schema } from "effect";

import { EmailAddress, InvitationId } from "./auth-values.js";
import { HouseholdOrganizationId } from "./household-principal.js";

/** Recipient-authorized projection. Closed outcomes remain readable for safe reconciliation. */
export const InvitationView = Schema.Struct({
  email: EmailAddress,
  familyName: Schema.String,
  id: InvitationId,
  inviterName: Schema.String,
  organizationId: HouseholdOrganizationId,
  status: Schema.Literals([
    "pending",
    "accepted",
    "rejected",
    "canceled",
    "expired",
  ]),
});
export type InvitationView = typeof InvitationView.Type;
