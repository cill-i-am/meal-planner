import { Schema } from "effect";

import { HouseholdAuthResourceId } from "./people.js";

/** Recipient-authorized projection. Closed outcomes remain readable for safe reconciliation. */
export const InvitationView = Schema.Struct({
  email: Schema.String,
  familyName: Schema.String,
  id: HouseholdAuthResourceId,
  inviterName: Schema.String,
  organizationId: HouseholdAuthResourceId,
  status: Schema.Literals([
    "pending",
    "accepted",
    "rejected",
    "canceled",
    "expired",
  ]),
});
export type InvitationView = typeof InvitationView.Type;
