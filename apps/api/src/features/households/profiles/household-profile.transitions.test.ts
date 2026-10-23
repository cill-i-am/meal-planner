import {
  HouseholdPeopleAuditActorId,
  HouseholdPersonId,
  ProfileFactId,
  ProfileVersion,
  profileCommandFromRecord,
} from "@meal-planner/household-api";
import type {
  ProfileCommand,
  ProfileFact,
  RecordedProfileCommand,
} from "@meal-planner/household-api";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyProfileCommand,
  recordProfileCommand,
} from "./household-profile.transitions.js";

const personId = HouseholdPersonId.make(
  "person_11111111-1111-4111-8111-111111111111"
);
const actorPersonId = HouseholdPersonId.make(
  "person_22222222-2222-4222-8222-222222222222"
);
const actorId = HouseholdPeopleAuditActorId.make("a".repeat(64));
const id = ProfileFactId.make("fact_33333333-3333-4333-8333-333333333333");
const context: Parameters<typeof applyProfileCommand>[2] = {
  actorId,
  actorPersonId,
  factId: id,
  now: 1000,
  personId,
  personKind: "adult",
  source: "direct",
  version: ProfileVersion.make(1),
};
const preference = {
  _tag: "FoodPreference",
  label: "Broccoli",
  sentiment: "like",
  targetKind: "ingredient",
} as const;
const change = (
  facts: readonly ProfileFact[],
  command: ProfileCommand,
  authority = context
) =>
  Effect.runPromise(
    recordProfileCommand(command, authority).pipe(
      Effect.flatMap((recorded) =>
        applyProfileCommand(facts, recorded, authority)
      )
    )
  );

describe("household profile transitions", () => {
  it("derives acceptance from the linked adult and target rather than caller labels", async () => {
    const command: ProfileCommand = {
      _tag: "AddProfileFact",
      fact: preference,
    };
    expect(await change([], command)).toMatchObject([
      { standing: { _tag: "provisional" }, value: preference },
    ]);
    expect(
      await change([], command, { ...context, actorPersonId: personId })
    ).toMatchObject([{ standing: { _tag: "confirmed", basis: "self" } }]);
    expect(
      await change([], command, { ...context, personKind: "dependant" })
    ).toMatchObject([
      { standing: { _tag: "confirmed", basis: "household_adult" } },
    ]);
    await expect(
      change([], {
        _tag: "AddProfileFact",
        fact: { _tag: "NoKnownHardConstraints" },
      })
    ).rejects.toMatchObject({ reason: "safety_confirmation_required" });
  });

  it("never promotes another adult's report merely by editing it", async () => {
    const provisional = await change([], {
      _tag: "AddProfileFact",
      fact: preference,
    });
    const updated = await change(
      provisional,
      {
        _tag: "ReplaceOrdinaryProfileFact",
        fact: { ...preference, sentiment: "dislike" },
        factId: id,
      },
      { ...context, version: ProfileVersion.make(2) }
    );
    expect(updated).toMatchObject([
      { id, standing: { _tag: "provisional" }, updatedInVersion: 2 },
    ]);
    await expect(
      change(updated, { _tag: "ConfirmProfileFact", factId: id })
    ).rejects.toMatchObject({ reason: "self_required" });
    expect(
      await change(
        updated,
        { _tag: "ConfirmProfileFact", factId: id },
        { ...context, actorPersonId: personId }
      )
    ).toMatchObject([{ id, standing: { _tag: "confirmed", basis: "self" } }]);
  });

  it("marks a change to another adult's accepted preference as a report", async () => {
    const facts = await change(
      [],
      { _tag: "AddProfileFact", fact: preference },
      { ...context, actorPersonId: personId }
    );
    const updated = await change(facts, {
      _tag: "ReplaceOrdinaryProfileFact",
      fact: { ...preference, sentiment: "dislike" },
      factId: id,
    });
    expect(updated).toMatchObject([{ id, standing: { _tag: "provisional" } }]);
    expect(facts).toMatchObject([
      { standing: { _tag: "confirmed", basis: "self" } },
    ]);
    await expect(
      change(facts, {
        _tag: "AddProfileFact",
        fact: { ...preference, label: "BROCCOLI" },
      })
    ).rejects.toMatchObject({ reason: "fact_conflict" });
  });

  it("retains explicit safety changes and never turns unknown information into clearance", async () => {
    const facts = await change([], {
      _tag: "AddProfileFact",
      fact: {
        _tag: "HardConstraint",
        category: "allergen",
        handling: "exclude",
        label: "Peanuts",
      },
    });
    await expect(
      change(facts, { _tag: "RemoveOrdinaryProfileFact", factId: id })
    ).rejects.toMatchObject({ reason: "safety_confirmation_required" });
    await expect(
      change(
        facts,
        { _tag: "AddProfileFact", fact: { _tag: "NoKnownHardConstraints" } },
        { ...context, personKind: "dependant" }
      )
    ).rejects.toMatchObject({ reason: "fact_conflict" });
    const reduction: ProfileCommand = {
      _tag: "ConfirmHardConstraintReduction",
      confirmation: "I confirm this safety constraint change",
      factId: id,
      replacement: null,
    };
    await expect(change(facts, reduction)).rejects.toMatchObject({
      reason: "self_required",
    });
    expect(
      await change(facts, reduction, { ...context, actorPersonId: personId })
    ).toEqual([]);
  });

  it("reconstructs identical recorded intent for existing valid mutation receipts", async () => {
    const records: readonly [RecordedProfileCommand, typeof context][] = [
      [{ _tag: "AddProvisionalProfileFact", fact: preference }, context],
      [
        { _tag: "AddConfirmedProfileFact", basis: "self", fact: preference },
        { ...context, actorPersonId: personId },
      ],
      [
        { _tag: "AddConfirmedProfileFact", basis: "self", fact: preference },
        { ...context, source: "interview" },
      ],
      [
        { _tag: "ConfirmProfileFact", basis: "household_adult", factId: id },
        { ...context, personKind: "dependant" },
      ],
    ];
    await Promise.all(
      records.map(async ([recorded, authority]) => {
        expect(
          await Effect.runPromise(
            recordProfileCommand(profileCommandFromRecord(recorded), authority)
          )
        ).toEqual(recorded);
      })
    );
  });
});
