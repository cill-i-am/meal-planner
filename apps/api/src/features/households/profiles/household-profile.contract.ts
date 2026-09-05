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
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdReadPersonProfileInput =
  typeof HouseholdReadPersonProfileInput.Type;

export const HouseholdListProfileVersionsInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  beforeVersion: Schema.NullOr(ProfileVersion),
  personId: HouseholdPersonId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdListProfileVersionsInput =
  typeof HouseholdListProfileVersionsInput.Type;

export const HouseholdMutatePersonProfileInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: MutatePersonProfilePayload,
  personId: HouseholdPersonId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdMutatePersonProfileInput =
  typeof HouseholdMutatePersonProfileInput.Type;
