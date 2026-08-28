import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  HouseholdPeopleRoster,
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
        currentPersonId: null,
        people: [],
      })
    ).toEqual({ currentPersonId: null, people: [] });
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
});
