import {
  HouseholdPeopleAuditActorId,
  HouseholdPersonId,
  ProfileFactId,
  ProfileVersion,
} from "@meal-planner/household-api";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { applyProfileCommand } from "./household-profile.transitions.js";

const personId = HouseholdPersonId.make(
  "person_11111111-1111-4111-8111-111111111111"
);
const actorPersonId = HouseholdPersonId.make(
  "person_22222222-2222-4222-8222-222222222222"
);
const actorId = HouseholdPeopleAuditActorId.make("a".repeat(64));
const id = ProfileFactId.make("fact_33333333-3333-4333-8333-333333333333");
const context = {
  actorId,
  actorPersonId,
  factId: id,
  now: 1000,
  personId,
  personKind: "adult" as const,
  version: ProfileVersion.make(1),
};
const preference = {
  _tag: "FoodPreference",
  label: "Broccoli",
  sentiment: "like",
  targetKind: "ingredient",
} as const;

describe("household profile transitions", () => {
  it("rejects false self confirmation and provisional safety clearance", async () => {
    await expect(
      Effect.runPromise(
        applyProfileCommand(
          [],
          { _tag: "AddConfirmedProfileFact", basis: "self", fact: preference },
          context
        )
      )
    ).rejects.toMatchObject({ reason: "self_required" });
    await expect(
      Effect.runPromise(
        applyProfileCommand(
          [],
          {
            _tag: "AddProvisionalProfileFact",
            fact: { _tag: "NoKnownHardConstraints" },
          },
          context
        )
      )
    ).rejects.toMatchObject({ reason: "safety_confirmation_required" });
  });

  it("retains fact identity but records honest standing when another adult changes a self-confirmed preference", async () => {
    const facts = await Effect.runPromise(
      applyProfileCommand(
        [],
        { _tag: "AddConfirmedProfileFact", basis: "self", fact: preference },
        { ...context, actorPersonId: personId }
      )
    );
    const updated = await Effect.runPromise(
      applyProfileCommand(
        facts,
        {
          _tag: "ReplaceOrdinaryProfileFact",
          factId: id,
          fact: { ...preference, sentiment: "dislike" },
        },
        { ...context, version: ProfileVersion.make(2) }
      )
    );
    expect(updated[0]).toMatchObject({
      id,
      standing: { _tag: "confirmed", basis: "household_adult" },
      updatedInVersion: 2,
    });
    expect(facts[0]).toMatchObject({
      standing: { _tag: "confirmed", basis: "self" },
      value: preference,
    });
    await expect(
      Effect.runPromise(
        applyProfileCommand(
          facts,
          {
            _tag: "AddProvisionalProfileFact",
            fact: { ...preference, label: "BROCCOLI", sentiment: "dislike" },
          },
          context
        )
      )
    ).rejects.toMatchObject({ reason: "fact_conflict" });
  });

  it("requires the explicit safety command and never combines safety clearance with a hard constraint", async () => {
    const facts = await Effect.runPromise(
      applyProfileCommand(
        [],
        {
          _tag: "AddProvisionalProfileFact",
          fact: {
            _tag: "HardConstraint",
            category: "allergen",
            handling: "exclude",
            label: "Peanuts",
          },
        },
        context
      )
    );
    await expect(
      Effect.runPromise(
        applyProfileCommand(
          facts,
          { _tag: "RemoveOrdinaryProfileFact", factId: id },
          context
        )
      )
    ).rejects.toMatchObject({ reason: "safety_confirmation_required" });
    await expect(
      Effect.runPromise(
        applyProfileCommand(
          facts,
          {
            _tag: "AddConfirmedProfileFact",
            basis: "household_adult",
            fact: { _tag: "NoKnownHardConstraints" },
          },
          { ...context, personKind: "dependant" }
        )
      )
    ).rejects.toMatchObject({ reason: "fact_conflict" });
    const reduced = await Effect.runPromise(
      applyProfileCommand(
        facts,
        {
          _tag: "ConfirmHardConstraintReduction",
          confirmation: "I confirm this safety constraint change",
          factId: id,
          replacement: null,
        },
        context
      )
    );
    expect(reduced).toEqual([]);
  });
});
