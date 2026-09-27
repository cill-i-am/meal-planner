import {
  HouseholdOrganizationId,
  HouseholdPersonMutationId,
} from "@meal-planner/household-api";
import { Schema } from "effect";

export const InvitationResponse = Schema.Struct({
  decision: Schema.Literals(["accept", "decline"]),
  mutationId: HouseholdPersonMutationId,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export const InvitationResponseResult = Schema.Struct({
  familyId: HouseholdOrganizationId,
  status: Schema.Literals(["joined", "declined"]),
});

export type InvitationResponse = typeof InvitationResponse.Type;
