import {
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  HouseholdPerson,
  HouseholdPersonId,
  ListHouseholdPeopleUrlParams,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import {
  HouseholdPeopleCreatorAdmission,
  HouseholdPeopleMemberAdmission,
} from "../rpc/command-envelope.js";

const PersonWire = Schema.toEncoded(HouseholdPerson);

/** Closed private creator bootstrap input. */
export const HouseholdBootstrapCreatorPersonInput = Schema.Struct({
  admission: HouseholdPeopleCreatorAdmission,
  payload: BootstrapHouseholdCreatorPayload,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdBootstrapCreatorPersonInput =
  typeof HouseholdBootstrapCreatorPersonInput.Type;

/** Closed private unlinked-person creation input. */
export const HouseholdCreatePersonInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: CreateHouseholdPersonPayload,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdCreatePersonInput = typeof HouseholdCreatePersonInput.Type;

/** Closed private roster-list input. */
export const HouseholdListPeopleInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  query: Schema.toEncoded(ListHouseholdPeopleUrlParams),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdListPeopleInput = typeof HouseholdListPeopleInput.Type;

/** Closed private person-read input. */
export const HouseholdGetPersonInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  personId: HouseholdPersonId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdGetPersonInput = typeof HouseholdGetPersonInput.Type;

/** Closed private lifecycle-transition input. */
export const HouseholdTransitionPersonInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: TransitionHouseholdPersonPayload,
  personId: HouseholdPersonId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdTransitionPersonInput =
  typeof HouseholdTransitionPersonInput.Type;

/** Encoded privacy-safe person result crossing the private Worker boundary. */
export const HouseholdPersonWire = PersonWire;
