import {
  HouseholdAuthResourceId,
  HouseholdOrganizationId,
} from "@meal-planner/household-api";
import { Schema } from "effect";

/** The identity this view was rendered for, checked against the live session by the API. */
export const DisplayedIdentity = Schema.Struct({
  organizationId: HouseholdOrganizationId,
  userId: HouseholdAuthResourceId,
});
export type DisplayedIdentity = typeof DisplayedIdentity.Type;

/** Decode Better Auth's plain identifiers once at the UI boundary. */
export const parseDisplayedIdentity =
  Schema.decodeUnknownSync(DisplayedIdentity);

export const displayedIdentityHeaders = (scope: DisplayedIdentity) => ({
  "x-meal-planner-household": scope.organizationId,
  "x-meal-planner-user": scope.userId,
});
