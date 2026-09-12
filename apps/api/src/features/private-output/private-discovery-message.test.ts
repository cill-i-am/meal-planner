import { ProfileFactValue } from "@meal-planner/household-api";
import { ProfileCard } from "@meal-planner/private-interview-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { reviewPrivateDiscoveryProposals } from "./private-assistant-turns.js";
import {
  applyPrivateDiscoveryContinuation,
  emptyPrivateDiscoveryContinuity,
  emptyPrivateDiscoveryContinuityUpdates,
} from "./private-discovery-continuity.js";
import {
  PrivateDiscoveryContext,
  PrivateDiscoveryOutput,
} from "./private-discovery-model.js";

const participant = {
  id: crypto.randomUUID(),
  role: "participant" as const,
  text: "I like carrots. Please stop asking questions.",
};
const carrots = Schema.decodeUnknownSync(ProfileFactValue)({
  _tag: "FoodPreference",
  label: "carrots",
  sentiment: "like",
  targetKind: "ingredient",
});
const tomatoes = Schema.decodeUnknownSync(ProfileFactValue)({
  ...carrots,
  label: "tomatoes",
});
const add = (fact: ProfileFactValue = carrots) => ({
  _tag: "ProposeProfileCard",
  change: { _tag: "AddConfirmedProfileFact", fact },
});
const storedCard = () =>
  Schema.decodeUnknownSync(ProfileCard)({
    change: add().change,
    expectedProfileVersion: 0,
    id: crypto.randomUUID(),
    ordinal: 1,
    outcome: null,
    reviewedFact: null,
    revision: 0,
    status: "proposed",
  });
const execute = (
  proposals: readonly unknown[] = [],
  options: {
    readonly facts?: readonly unknown[];
    readonly notes?: readonly unknown[];
    readonly reply?: unknown;
    readonly storedCards?: readonly ProfileCard[];
  } = {}
) => {
  const storedCards = options.storedCards ?? [];
  const context = Schema.decodeUnknownSync(PrivateDiscoveryContext)({
    cards: storedCards.map(
      ({ change, id, reviewedFact, revision, status }) => ({
        change,
        id,
        reviewedFact,
        revision,
        status,
      })
    ),
    continuity: emptyPrivateDiscoveryContinuity(),
    messages: [participant],
    profile: { facts: options.facts ?? [], version: 0 },
  });
  const output = Schema.decodeUnknownSync(PrivateDiscoveryOutput)({
    continuity: {
      ...emptyPrivateDiscoveryContinuityUpdates(),
      notes: options.notes ?? [],
    },
    proposals,
    reply: options.reply ?? { _tag: "Continue" },
  });
  const reviewed = reviewPrivateDiscoveryProposals(
    output,
    context,
    storedCards
  );
  return applyPrivateDiscoveryContinuation(
    context.continuity,
    output.continuity,
    output.reply,
    participant,
    reviewed
  );
};

describe("application-owned private discovery messages", () => {
  it("describes an actual new proposal as unconfirmed and invites review only of the profile card", () => {
    expect(execute([add()]).message).toBe(
      [
        "New profile proposal: add your preference for the ingredient “carrots”.",
        "Review the profile proposals in the interface. They remain unconfirmed.",
        "You can finish this conversation when you're ready.",
      ].join("\n\n")
    );
  });

  it("describes an actual revision of a proposed addition without pretending it replaces a saved fact", () => {
    const card = storedCard();
    const result = execute(
      [
        {
          _tag: "ReviseProposedProfileCard",
          cardId: card.id,
          change: add(tomatoes).change,
          expectedRevision: 0,
        },
      ],
      { storedCards: [card] }
    );
    expect(result.message).toBe(
      [
        "Revised profile proposal: add your preference for the ingredient “tomatoes”.",
        "Review the profile proposals in the interface. They remain unconfirmed.",
        "You can finish this conversation when you're ready.",
      ].join("\n\n")
    );
    expect(result.message).not.toContain("replace");
  });

  it("makes no new or revised profile claim when no operation was admitted", () => {
    expect(execute([], { storedCards: [storedCard()] }).message).toBe(
      "You can finish this conversation when you're ready."
    );
  });

  it.each([
    {
      change: { _tag: "ReplaceOrdinaryProfileFact", fact: tomatoes },
      description:
        "replace your preference for the ingredient “carrots” with your preference for the ingredient “tomatoes”",
      value: carrots,
    },
    {
      change: { _tag: "RemoveOrdinaryProfileFact" },
      description: "remove your preference for the ingredient “carrots”",
      value: carrots,
    },
    {
      change: { _tag: "ConfirmProfileFact" },
      description: "confirm your preference for the ingredient “carrots”",
      value: carrots,
    },
    {
      change: { _tag: "ConfirmHardConstraintReduction", replacement: null },
      description:
        "remove your allergen “sesame” (exclude); separate safety confirmation is required",
      value: {
        _tag: "HardConstraint",
        category: "allergen",
        handling: "exclude",
        label: "sesame",
      },
    },
    {
      change: {
        _tag: "ConfirmHardConstraintReduction",
        replacement: { _tag: "NoKnownHardConstraints" },
      },
      description:
        "replace your allergen “sesame” (exclude) with your statement that you have no known hard food constraints; separate safety confirmation is required",
      value: {
        _tag: "HardConstraint",
        category: "allergen",
        handling: "exclude",
        label: "sesame",
      },
    },
  ])(
    "renders the reviewed $change._tag effect conditionally as a proposal",
    ({ change, description, value }) => {
      const id = `fact_${crypto.randomUUID()}`;
      const result = execute(
        [{ _tag: "ProposeProfileCard", change: { ...change, factId: id } }],
        {
          facts: [{ id, standing: { _tag: "provisional" }, value }],
        }
      );
      expect(result.message).toBe(
        [
          `New profile proposal: ${description}.`,
          "Review the profile proposals in the interface. They remain unconfirmed.",
          "You can finish this conversation when you're ready.",
        ].join("\n\n")
      );
    }
  );

  it.each([
    {
      description: "your strong dislike for the ingredient “carrots”",
      fact: { ...carrots, sentiment: "strong_dislike" },
    },
    {
      description: "your dietary rule “vegetarian meals” (requires adaptation)",
      fact: {
        _tag: "HardConstraint",
        category: "dietary_rule",
        handling: "requires_adaptation",
        label: "vegetarian meals",
      },
    },
    {
      description:
        "your statement that you have no known hard food constraints",
      fact: { _tag: "NoKnownHardConstraints" },
    },
  ])(
    "retains the closed fact meaning in a new proposal: $description",
    ({ fact, description }) => {
      expect(
        execute([add(Schema.decodeUnknownSync(ProfileFactValue)(fact))]).message
      ).toContain(`New profile proposal: add ${description}.`);
    }
  );

  it("rejects the complete card-and-question message at the shared bound without clipping", () => {
    expect(() =>
      execute([add()], {
        notes: [
          {
            detail: "",
            key: "routine",
            question: "q".repeat(2000),
            state: "unresolved",
            subject: "Routine",
          },
        ],
      })
    ).toThrow(expect.objectContaining({ stage: "reply_limit" }));
  });

  it("renders fixed Stop only and rejects any simultaneous proposed change", () => {
    const reply = {
      _tag: "Stop",
      evidence: {
        messageId: participant.id,
        quote: "Please stop asking questions.",
      },
    };
    expect(execute([], { reply }).message).toBe("We can stop here.");
    expect(() => execute([add()], { reply })).toThrow(
      expect.objectContaining({ stage: "reply_decision" })
    );
  });
});
