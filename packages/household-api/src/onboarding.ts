import { dequal } from "dequal/lite";
import { Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";

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

export const CreateSetupFamilyRequest = Schema.Struct({
  name: FamilyName,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export const CreatedSetupFamily = Schema.Struct({
  name: FamilyName,
  organizationId: HouseholdOrganizationId,
});
export const SetupFamilyUnauthorized = Schema.TaggedStruct(
  "SetupFamilyUnauthorized",
  { message: Schema.String }
).pipe(HttpApiSchema.status(401));
export const SetupFamilyInvalidRequest = Schema.TaggedStruct(
  "SetupFamilyInvalidRequest",
  { message: Schema.String }
).pipe(HttpApiSchema.status(400));
export const SetupFamilyConflict = Schema.TaggedStruct("SetupFamilyConflict", {
  message: Schema.String,
}).pipe(HttpApiSchema.status(409));
export const SetupFamilyUnavailable = Schema.TaggedStruct(
  "SetupFamilyUnavailable",
  { message: Schema.String }
).pipe(HttpApiSchema.status(503));

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
export const initialSetupProgress: SetupProgress = {
  checkpoint: { name: "", stage: "family-name" },
  status: "active",
};

/** Identity of an unresolved operation retained by a setup checkpoint. */
export const setupPendingCommandId = (
  checkpoint: SetupCheckpoint
): string | undefined => {
  switch (checkpoint.stage) {
    case "family-create": {
      return checkpoint.creator.mutationId;
    }
    case "person-create": {
      return checkpoint.command.person.mutationId;
    }
    case "person-invite":
    case "person-rename": {
      return checkpoint.command.mutationId;
    }
    case "person-manage": {
      return checkpoint.state.command.mutationId;
    }
    case "invitation-response":
    case "invitation-link": {
      return checkpoint.linkMutationId;
    }
    default: {
      return undefined;
    }
  }
};

const sameCheckpoint = (left: SetupCheckpoint, right: SetupCheckpoint) =>
  dequal(left, right);

export const sameSetupProgress = (left: SetupProgress, right: SetupProgress) =>
  dequal(left, right);

const canFinishPersonCreation = (
  from: Extract<SetupCheckpoint, { stage: "person-create" }>,
  to: SetupCheckpoint
) =>
  (from.command.kind === "managed" &&
    to.stage === "family-review" &&
    to.organizationId === from.organizationId) ||
  (from.command.kind === "invited" &&
    to.stage === "person-invite" &&
    to.organizationId === from.organizationId &&
    to.command.mutationId === from.command.invitationMutationId);

const canFinishInvitationResponse = (
  from: Extract<SetupCheckpoint, { stage: "invitation-response" }>,
  to: SetupCheckpoint
) =>
  (from.decision === "decline" && sameCheckpoint(from.returnCheckpoint, to)) ||
  (to.stage === "invitation-link" &&
    to.invitationId === from.invitationId &&
    to.linkMutationId === from.linkMutationId &&
    to.organizationId === from.organizationId &&
    sameCheckpoint(to.returnCheckpoint, from.returnCheckpoint));

const canFinishPending = (from: SetupCheckpoint, to: SetupCheckpoint) => {
  switch (from.stage) {
    case "family-create": {
      return to.stage === "family-review";
    }
    case "person-create": {
      return canFinishPersonCreation(from, to);
    }
    case "person-invite": {
      return (
        (to.stage === "family-review" &&
          to.organizationId === from.organizationId) ||
        (to.stage === "person-invite-draft" &&
          to.organizationId === from.organizationId &&
          to.personId === from.command.personId &&
          to.email === from.command.email)
      );
    }
    case "person-rename": {
      return (
        to.stage === "family-review" &&
        to.organizationId === from.organizationId
      );
    }
    case "person-manage": {
      return sameCheckpoint(
        { ...from.returnTo, organizationId: from.organizationId },
        to
      );
    }
    case "invitation-response": {
      return canFinishInvitationResponse(from, to);
    }
    case "invitation-link": {
      return to.stage === "ready" && to.organizationId === from.organizationId;
    }
    default: {
      return true;
    }
  }
};

/** A retained operation must finish before a different setup command can replace it. */
export const canReplaceSetupProgress = (
  current: SetupProgress,
  next: SetupProgress,
  sourceCommandId?: string
): boolean => {
  const from = current.checkpoint;
  const to = next.checkpoint;
  if (from.stage === to.stage && sameCheckpoint(from, to)) {
    return true;
  }
  const pendingId = setupPendingCommandId(from);
  if (pendingId === undefined) {
    return true;
  }
  return pendingId === sourceCommandId && canFinishPending(from, to);
};

/** Setup progress is saved only by the authenticated versioned setup endpoint. */
export const setupProgressField = {
  input: false as const,
  required: false as const,
  type: "json" as const,
  validator: { input: Schema.toStandardSchemaV1(SetupProgress) },
};

export const SetupProgressVersion = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);
export type SetupProgressVersion = typeof SetupProgressVersion.Type;

/** Server-owned compare-and-save version, exposed in session snapshots. */
export const setupProgressVersionField = {
  defaultValue: 0,
  input: false as const,
  required: true as const,
  type: "number" as const,
};
