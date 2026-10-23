import {
  HouseholdPersonId,
  MutatePersonProfilePayload,
  ProfileVersion,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import { HouseholdPeopleMemberAdmission } from "../rpc/command-envelope.js";

export const HouseholdReadPersonProfileInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  personId: HouseholdPersonId,
  version: Schema.NullOr(ProfileVersion),
});
export type HouseholdReadPersonProfileInput =
  typeof HouseholdReadPersonProfileInput.Type;

export const HouseholdListProfileVersionsInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  beforeVersion: Schema.NullOr(ProfileVersion),
  personId: HouseholdPersonId,
});
export type HouseholdListProfileVersionsInput =
  typeof HouseholdListProfileVersionsInput.Type;

export const HouseholdMutatePersonProfileInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: MutatePersonProfilePayload,
  personId: HouseholdPersonId,
});
export type HouseholdMutatePersonProfileInput =
  typeof HouseholdMutatePersonProfileInput.Type;

export const HouseholdMutateInterviewProfileInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  // The repository admits only the linked adult's own interview profile. Its
  // common command resolver derives standing; explicit safety intent stays typed.
  payload: MutatePersonProfilePayload,
  personId: HouseholdPersonId,
});
export type HouseholdMutateInterviewProfileInput =
  typeof HouseholdMutateInterviewProfileInput.Type;
