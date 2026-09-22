import { Schema } from "effect";

import {
  BootstrapHouseholdCreatorPayload,
  HouseholdAuthResourceId,
  CreateHouseholdPersonPayload,
  InviteHouseholdAdultPayload,
  HouseholdPersonId,
  HouseholdPersonVersion,
  RenameHouseholdPersonPayload,
  HouseholdPersonMutationId,
  HouseholdInvitationEmail,
  InvitationRejectionReason,
} from "./people.js";

export const FamilyName = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Enter a family name." }).abort(),
  Schema.isMaxLength(80, { message: "Use 80 characters or fewer." })
);

export const PersonDraft = Schema.Struct({
  email: Schema.String.check(Schema.isMaxLength(254)),
  name: Schema.String.check(Schema.isMaxLength(80)),
  participation: Schema.Literals(["", "adult", "dependant"]),
});
export const PersonCreation = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("managed"),
    person: Schema.Struct({
      ...CreateHouseholdPersonPayload.fields,
      kind: Schema.Literal("dependant"),
    }),
  }),
  Schema.Struct({
    email: HouseholdInvitationEmail,
    invitationMutationId: HouseholdPersonMutationId,
    kind: Schema.Literal("invited"),
    person: Schema.Struct({
      ...CreateHouseholdPersonPayload.fields,
      kind: Schema.Literal("adult"),
    }),
  }),
]);
export type PersonCreation = typeof PersonCreation.Type;
export const FamilySetupCheckpoint = Schema.Union([
  Schema.Struct({
    displayName: FamilyName,
    email: Schema.String.check(Schema.isMaxLength(254)),
    organizationId: HouseholdAuthResourceId,
    personId: HouseholdPersonId,
    reason: Schema.Union([
      InvitationRejectionReason,
      Schema.Literal("not_sent"),
    ]),
    stage: Schema.Literal("person-invite-draft"),
  }),
  Schema.Struct({
    draft: PersonDraft,
    organizationId: HouseholdAuthResourceId,
    stage: Schema.Literal("person-draft"),
  }),
  Schema.Struct({
    command: PersonCreation,
    organizationId: HouseholdAuthResourceId,
    stage: Schema.Literal("person-create"),
  }),
  Schema.Struct({
    command: InviteHouseholdAdultPayload,
    displayName: FamilyName,
    organizationId: HouseholdAuthResourceId,
    stage: Schema.Literal("person-invite"),
  }),
  Schema.Struct({
    name: Schema.String.check(Schema.isMaxLength(80)),
    organizationId: HouseholdAuthResourceId,
    personId: HouseholdPersonId,
    stage: Schema.Literal("person-edit"),
    version: HouseholdPersonVersion,
  }),
  Schema.Struct({
    command: RenameHouseholdPersonPayload,
    organizationId: HouseholdAuthResourceId,
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
    organizationId: HouseholdAuthResourceId,
    stage: Schema.Literal("family-review"),
  }),
  Schema.Struct({
    organizationId: HouseholdAuthResourceId,
    stage: Schema.Literal("ready"),
  }),
  Schema.Struct({
    organizationId: HouseholdAuthResourceId,
    stage: Schema.Literal("complete"),
  }),
]);
export const SetupCheckpoint = Schema.Union([
  FamilySetupCheckpoint,
  Schema.Struct({
    decision: Schema.Literals(["accept", "decline"]),
    invitationId: HouseholdAuthResourceId,
    linkMutationId: HouseholdPersonMutationId,
    organizationId: HouseholdAuthResourceId,
    returnCheckpoint: FamilySetupCheckpoint,
    stage: Schema.Literal("invitation-response"),
  }),
  Schema.Struct({
    invitationId: HouseholdAuthResourceId,
    linkMutationId: HouseholdPersonMutationId,
    organizationId: HouseholdAuthResourceId,
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
