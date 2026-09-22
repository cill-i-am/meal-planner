import { Schema } from "effect";

import { EmailAddress, InvitationId } from "./auth-values.js";
import { HouseholdOrganizationId } from "./household-principal.js";
import {
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  InviteHouseholdAdultPayload,
  HouseholdPersonId,
  HouseholdPersonVersion,
  RenameHouseholdPersonPayload,
  HouseholdPersonMutationId,
  HouseholdPerson,
  HouseholdPersonDisplayName,
  InvitationRejectionReason,
} from "./people.js";

export const FamilyName = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Enter a family name." }).abort(),
  Schema.isMaxLength(80, { message: "Use 80 characters or fewer." })
);

export const PersonDraft = Schema.Struct({
  email: Schema.String.check(Schema.isMaxLength(254)),
  invite: Schema.optional(Schema.Boolean),
  name: Schema.String.check(Schema.isMaxLength(80)),
  participation: Schema.Literals(["", "adult", "dependant"]),
});
export const PersonCreation = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("managed"),
    person: CreateHouseholdPersonPayload,
  }),
  Schema.Struct({
    email: EmailAddress,
    invitationMutationId: HouseholdPersonMutationId,
    kind: Schema.Literal("invited"),
    person: Schema.Struct({
      ...CreateHouseholdPersonPayload.fields,
      kind: Schema.Literal("adult"),
    }),
  }),
]);
export type PersonCreation = typeof PersonCreation.Type;

/** The interrupted setup surface, retained while a roster action is open. */
export const SetupRosterReturn = Schema.Union([
  Schema.Struct({ draft: PersonDraft, stage: Schema.Literal("person-draft") }),
  Schema.Struct({ stage: Schema.Literal("family-review") }),
]);
export type SetupRosterReturn = typeof SetupRosterReturn.Type;

/** Retains the target, version and mutation identity until the result is known. */
export const SetupRosterCommand = Schema.Union([
  Schema.Struct({
    email: EmailAddress,
    kind: Schema.Literal("invite"),
    mutationId: HouseholdPersonMutationId,
    person: HouseholdPerson,
  }),
  Schema.Struct({
    kind: Schema.Literal("rename"),
    mutationId: HouseholdPersonMutationId,
    name: HouseholdPersonDisplayName,
    person: HouseholdPerson,
  }),
  Schema.Struct({
    kind: Schema.Literal("remove"),
    mutationId: HouseholdPersonMutationId,
    person: HouseholdPerson,
  }),
]);
export type SetupRosterCommand = typeof SetupRosterCommand.Type;

export const FamilySetupCheckpoint = Schema.Union([
  Schema.Struct({
    organizationId: HouseholdOrganizationId,
    returnTo: SetupRosterReturn,
    stage: Schema.Literal("person-manage"),
    state: Schema.Struct({
      command: SetupRosterCommand,
      phase: Schema.Literal("pending"),
    }),
  }),
  Schema.Struct({
    displayName: FamilyName,
    email: Schema.String.check(Schema.isMaxLength(254)),
    organizationId: HouseholdOrganizationId,
    personId: HouseholdPersonId,
    reason: Schema.Union([
      InvitationRejectionReason,
      Schema.Literal("not_sent"),
    ]),
    stage: Schema.Literal("person-invite-draft"),
  }),
  Schema.Struct({
    draft: PersonDraft,
    organizationId: HouseholdOrganizationId,
    stage: Schema.Literal("person-draft"),
  }),
  Schema.Struct({
    command: PersonCreation,
    organizationId: HouseholdOrganizationId,
    stage: Schema.Literal("person-create"),
  }),
  Schema.Struct({
    command: InviteHouseholdAdultPayload,
    displayName: FamilyName,
    organizationId: HouseholdOrganizationId,
    stage: Schema.Literal("person-invite"),
  }),
  Schema.Struct({
    name: Schema.String.check(Schema.isMaxLength(80)),
    organizationId: HouseholdOrganizationId,
    personId: HouseholdPersonId,
    stage: Schema.Literal("person-edit"),
    version: HouseholdPersonVersion,
  }),
  Schema.Struct({
    command: RenameHouseholdPersonPayload,
    organizationId: HouseholdOrganizationId,
    personId: HouseholdPersonId,
    stage: Schema.Literal("person-rename"),
  }),
  Schema.Struct({
    name: Schema.String.check(Schema.isMaxLength(80)),
    stage: Schema.Literal("family-name"),
  }),
  Schema.Struct({
    creator: BootstrapHouseholdCreatorPayload,
    name: FamilyName,
    slug: Schema.String.check(Schema.isPattern(/^family-[a-f0-9-]{36}$/u)),
    stage: Schema.Literal("family-create"),
  }),
  Schema.Struct({
    organizationId: HouseholdOrganizationId,
    stage: Schema.Literal("family-review"),
  }),
  Schema.Struct({
    organizationId: HouseholdOrganizationId,
    stage: Schema.Literal("ready"),
  }),
  Schema.Struct({
    organizationId: HouseholdOrganizationId,
    stage: Schema.Literal("complete"),
  }),
]);
export const SetupCheckpoint = Schema.Union([
  FamilySetupCheckpoint,
  Schema.Struct({
    decision: Schema.Literals(["accept", "decline"]),
    invitationId: InvitationId,
    linkMutationId: HouseholdPersonMutationId,
    organizationId: HouseholdOrganizationId,
    returnCheckpoint: FamilySetupCheckpoint,
    stage: Schema.Literal("invitation-response"),
  }),
  Schema.Struct({
    invitationId: InvitationId,
    linkMutationId: HouseholdPersonMutationId,
    organizationId: HouseholdOrganizationId,
    returnCheckpoint: FamilySetupCheckpoint,
    stage: Schema.Literal("invitation-link"),
  }),
]);
export type SetupCheckpoint = typeof SetupCheckpoint.Type;

/** Account-owned navigation intent, never authority for household access. No secrets. */
export const SetupProgress = Schema.Struct({
  checkpoint: SetupCheckpoint,
  status: Schema.Literals(["active", "paused"]),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type SetupProgress = typeof SetupProgress.Type;

/** Better Auth validates and persists this through the authenticated update-user endpoint. */
export const setupProgressField = {
  required: false as const,
  type: "json" as const,
  validator: { input: Schema.toStandardSchemaV1(SetupProgress) },
};
