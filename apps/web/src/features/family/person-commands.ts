import {
  CreateHouseholdPersonPayload,
  HouseholdPersonMutationId,
  HouseholdPerson,
  HouseholdPersonDisplayName,
  EmailAddress,
} from "@meal-planner/household-api";
import { Schema } from "effect";

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

/** Retains the target, version and mutation identity until the result is known. */
export const RosterCommand = Schema.Union([
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
export type RosterCommand = typeof RosterCommand.Type;
