import { HouseholdOrganizationId } from "@meal-planner/household-api";
import type {
  HouseholdPerson,
  HouseholdPeopleRoster,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import {
  InvitationEmailInput,
  PersonNameInput,
} from "../household-people/form-input.js";
import { RosterCommand } from "./person-commands.js";

export const RosterRequest = Schema.Struct({
  command: RosterCommand,
  organizationId: HouseholdOrganizationId,
});
export interface PendingRosterRequest {
  readonly organizationId: HouseholdOrganizationId;
  readonly state: {
    readonly phase: "pending";
    readonly command: RosterCommand;
  };
}
export type RosterActionDraft =
  | {
      readonly kind: "invite";
      readonly email: string;
      readonly person: HouseholdPerson;
    }
  | {
      readonly kind: "rename";
      readonly name: string;
      readonly person: HouseholdPerson;
    }
  | { readonly kind: "remove"; readonly person: HouseholdPerson };
export type RosterAction = RosterActionDraft["kind"];
export type RosterPresentation = Omit<PendingRosterRequest, "state"> & {
  readonly state:
    | { readonly action: RosterActionDraft; readonly phase: "draft" }
    | PendingRosterRequest["state"];
};
export interface Presentation {
  readonly operation: RosterPresentation;
  readonly open: boolean;
}

export const makeDraftAction = (
  kind: RosterAction,
  person: HouseholdPerson
): RosterActionDraft => {
  if (kind === "invite") {
    return { email: "", kind, person };
  }
  if (kind === "rename") {
    return { kind, name: person.displayName, person };
  }
  return { kind, person };
};

export const commandDraft = (command: RosterCommand): RosterActionDraft => {
  if (command.kind === "invite") {
    return { email: command.email, kind: "invite", person: command.person };
  }
  if (command.kind === "rename") {
    return { kind: "rename", name: command.name, person: command.person };
  }
  return { kind: "remove", person: command.person };
};

export const commandFromForm = (
  action: RosterActionDraft,
  value: { readonly email: string; readonly name: string },
  mutationId: string
): RosterCommand => {
  if (action.kind === "invite") {
    return Schema.decodeUnknownSync(RosterCommand)({
      email: Schema.decodeUnknownSync(InvitationEmailInput)(value.email),
      kind: "invite",
      mutationId,
      person: action.person,
    });
  }
  if (action.kind === "rename") {
    return Schema.decodeUnknownSync(RosterCommand)({
      kind: "rename",
      mutationId,
      name: Schema.decodeUnknownSync(PersonNameInput)(value.name),
      person: action.person,
    });
  }
  return Schema.decodeUnknownSync(RosterCommand)({
    kind: "remove",
    mutationId,
    person: action.person,
  });
};

export const canManagePerson = (
  person: HouseholdPerson,
  roster: HouseholdPeopleRoster,
  organizer: boolean
) => ({
  invite:
    organizer &&
    person.kind === "adult" &&
    (person.associationState === "unlinked" ||
      person.associationState === "invitation_declined" ||
      person.associationState === "invitation_unavailable") &&
    !person.isCurrentAdult,
  remove: organizer && !person.isCurrentAdult,
  rename:
    roster.currentPersonId !== null && (organizer || person.isCurrentAdult),
});
