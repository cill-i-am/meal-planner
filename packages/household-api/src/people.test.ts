import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AssociateHouseholdAdultInvitationPayload,
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  HouseholdPeopleBootstrapConflictProblem,
  HouseholdPeopleRoster,
  HouseholdPeoplePrincipal,
  ListHouseholdPeopleUrlParams,
  HouseholdPerson,
  HouseholdPersonId,
  HouseholdPersonMutationId,
  TransitionHouseholdPersonPayload,
} from "./index.js";

describe("household people public contract", () => {
  it("admits one closed create command and exposes only the privacy-safe roster", () => {
    const mutationId = Schema.decodeUnknownSync(HouseholdPersonMutationId)(
      "mutation_01JQYB4N6TF3AB9XR7K2W5M8CZ"
    );

    expect(
      Schema.decodeUnknownSync(CreateHouseholdPersonPayload)({
        displayName: "Aoife",
        kind: "adult",
        mutationId,
      })
    ).toEqual({ displayName: "Aoife", kind: "adult", mutationId });
    expect(() =>
      Schema.decodeUnknownSync(CreateHouseholdPersonPayload, {
        onExcessProperty: "error",
      })({
        actorId: "a".repeat(64),
        displayName: "Aoife",
        kind: "adult",
        mutationId,
      })
    ).toThrow();

    expect(
      Schema.decodeUnknownSync(HouseholdPeopleRoster)({
        creatorSlot: "available",
        currentPersonId: null,
        people: [],
      })
    ).toEqual({ creatorSlot: "available", currentPersonId: null, people: [] });
    expect(
      Schema.decodeUnknownSync(HouseholdPeopleRoster, {
        onExcessProperty: "error",
      })({
        creatorSlot: "occupied",
        currentPersonId: null,
        people: [],
      })
    ).toEqual({ creatorSlot: "occupied", currentPersonId: null, people: [] });
    expect(() =>
      Schema.decodeUnknownSync(HouseholdPeopleRoster, {
        onExcessProperty: "error",
      })({
        creatorPersonId: "person_00000000-0000-4000-8000-000000000101",
        creatorSlot: "occupied",
        currentPersonId: null,
        people: [],
      })
    ).toThrow();
  });

  it("rejects malformed ids, versions, kinds, lifecycle values, and names", () => {
    const mutationId = "mutation-contract-boundary";
    expect(() =>
      Schema.decodeUnknownSync(HouseholdPersonId)("person-readable-name")
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TransitionHouseholdPersonPayload)({
        expectedVersion: 0,
        mutationId,
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CreateHouseholdPersonPayload)({
        displayName: "Aoife",
        kind: "visitor",
        mutationId,
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(BootstrapHouseholdCreatorPayload)({
        displayName: "x".repeat(129),
        mutationId,
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(HouseholdPerson)({
        createdAtEpochMs: 1,
        displayName: "Aoife",
        id: "person_00000000-0000-4000-8000-000000000101",
        isCurrentAdult: false,
        kind: "adult",
        lifecycle: "deleted",
        updatedAtEpochMs: 1,
        version: 1,
      })
    ).toThrow();
  });

  it("rejects excess public roster query keys with the schema default decoder", () => {
    expect(() =>
      Schema.decodeUnknownSync(ListHouseholdPeopleUrlParams)({
        includeArchived: "true",
        unexpected: "x",
      })
    ).toThrow();
  });

  it("keeps audit, linkage, and creator authority in one closed branded principal", () => {
    const principal = {
      actorId: "a".repeat(64),
      creatorAuthority: "better_auth_owner",
      linkageSubject: "b".repeat(64),
      organizationId: "organization-a",
    };
    expect(
      Schema.decodeUnknownSync(HouseholdPeoplePrincipal, {
        onExcessProperty: "error",
      })(principal)
    ).toEqual(principal);
    expect(() =>
      Schema.decodeUnknownSync(HouseholdPeoplePrincipal, {
        onExcessProperty: "error",
      })({ ...principal, userId: "raw-better-auth-user" })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(HouseholdPeoplePrincipal)({
        ...principal,
        creatorAuthority: "first_member",
      })
    ).toThrow();
  });

  it("recovers an invitation only from the retained original intent", () => {
    expect(
      Schema.decodeUnknownSync(AssociateHouseholdAdultInvitationPayload)({
        email: "adult@example.test",
        mutationId: "invitation-original-intent",
        personId: "person_00000000-0000-4000-8000-000000000101",
      })
    ).toEqual({
      email: "adult@example.test",
      mutationId: "invitation-original-intent",
      personId: "person_00000000-0000-4000-8000-000000000101",
    });
    expect(() =>
      Schema.decodeUnknownSync(AssociateHouseholdAdultInvitationPayload)({
        email: "adult@example.test",
        invitationId: "invitation-chosen-by-the-browser",
        mutationId: "invitation-original-intent",
        personId: "person_00000000-0000-4000-8000-000000000101",
      })
    ).toThrow();
  });

  it("keeps an occupied creator slot privacy-safe and explicitly unlinked", () => {
    const problem = {
      code: "bootstrap_conflict",
      message:
        "This household already has a creator person. This account remains unlinked.",
      status: 409,
    };
    expect(
      Schema.decodeUnknownSync(HouseholdPeopleBootstrapConflictProblem, {
        onExcessProperty: "error",
      })(problem)
    ).toEqual(problem);
    expect(() =>
      Schema.decodeUnknownSync(HouseholdPeopleBootstrapConflictProblem, {
        onExcessProperty: "error",
      })({ ...problem, linkedPersonId: "person-private" })
    ).toThrow();
  });
});
