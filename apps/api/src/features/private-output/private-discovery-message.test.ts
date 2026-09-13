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
  SubmitDiscoveryTurn,
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
  change: { _tag: "AddFact", fact },
});
const storedCard = () =>
  Schema.decodeUnknownSync(ProfileCard)({
    change: { _tag: "AddConfirmedProfileFact", fact: carrots },
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
    scope: "ProfileEdit",
  });
  const output = Schema.decodeUnknownSync(SubmitDiscoveryTurn)({
    intent: options.reply ?? {
      _tag: "Continue",
      proposals,
      updates: {
        ...emptyPrivateDiscoveryContinuityUpdates(),
        notes: options.notes ?? [],
      },
    },
  });
  const reviewed = reviewPrivateDiscoveryProposals(
    output,
    context,
    storedCards
  );
  return applyPrivateDiscoveryContinuation(
    context.continuity,
    output.intent._tag === "Stop"
      ? emptyPrivateDiscoveryContinuityUpdates()
      : output.intent.updates,
    output.intent,
    participant,
    reviewed,
    { profileFacts: context.profile.facts, scope: context.scope }
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

  it.each([
    "changed_revision",
    "removed",
    "confirmed",
    "not_in_snapshot",
  ] as const)(
    "rejects a revision whose application snapshot is %s instead of rebinding to latest storage",
    (condition) => {
      const card = storedCard();
      const context = Schema.decodeUnknownSync(PrivateDiscoveryContext)({
        cards: condition === "not_in_snapshot" ? [] : [card],
        continuity: emptyPrivateDiscoveryContinuity(),
        messages: [participant],
        profile: { facts: [], version: 0 },
        scope: "ProfileEdit",
      });
      const output = Schema.decodeUnknownSync(SubmitDiscoveryTurn)({
        intent: {
          _tag: "Continue",
          proposals: [
            {
              _tag: "ReviseProposedProfileCard",
              cardId: card.id,
              change: add(tomatoes).change,
            },
          ],
          updates: emptyPrivateDiscoveryContinuityUpdates(),
        },
      });
      const current =
        condition === "removed"
          ? []
          : [
              {
                ...card,
                revision:
                  condition === "changed_revision"
                    ? card.revision + 1
                    : card.revision,
                status:
                  condition === "confirmed"
                    ? ("confirmed" as const)
                    : card.status,
              },
            ];
      expect(() =>
        reviewPrivateDiscoveryProposals(output, context, current)
      ).toThrow(expect.objectContaining({ stage: "proposal_revision_target" }));
    }
  );

  it("makes no new or revised profile claim when no operation was admitted", () => {
    expect(execute([], { storedCards: [storedCard()] }).message).toBe(
      "You can finish this conversation when you're ready."
    );
  });

  it.each([
    {
      change: { _tag: "ReplaceFact", fact: tomatoes },
      description:
        "replace your preference for the ingredient “carrots” with your preference for the ingredient “tomatoes”",
      value: carrots,
    },
    {
      change: { _tag: "RemoveFact" },
      description: "remove your preference for the ingredient “carrots”",
      value: carrots,
    },
    {
      change: { _tag: "ConfirmFact" },
      description: "confirm your preference for the ingredient “carrots”",
      value: carrots,
    },
    {
      change: { _tag: "RemoveFact" },
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
        _tag: "ReplaceFact",
        fact: { _tag: "NoKnownHardConstraints" },
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

  it("rejects model-authored question text before rendering", () => {
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
    ).toThrow();
  });

  it("rejects an oversized application-rendered fallback summary before returning a message", () => {
    const delta = {
      ...emptyPrivateDiscoveryContinuityUpdates(),
      mealFallbackNeeds: {
        declarations: Array.from({ length: 3 }, (_, index) => ({
          evidence: { messageId: participant.id, quote: participant.text },
          subject: `${index}${"s".repeat(119)}`,
        })),
        updates: Array.from({ length: 3 }, (_, index) => [
          {
            _tag: "RecordReason" as const,
            evidence: { messageId: participant.id, quote: participant.text },
            need: { _tag: "Declared" as const, index },
            revisit: null,
            value: "r".repeat(200),
          },
          {
            _tag: "RecordOption" as const,
            evidence: { messageId: participant.id, quote: participant.text },
            need: { _tag: "Declared" as const, index },
            revisit: null,
            value: {
              description: "d".repeat(200),
              kind: "exact" as const,
              quantity: "q".repeat(120),
              substitutions: "s".repeat(200),
            },
          },
        ]).flat(),
      },
    };
    expect(() =>
      applyPrivateDiscoveryContinuation(
        emptyPrivateDiscoveryContinuity(),
        delta,
        { _tag: "Continue" },
        participant,
        [],
        { profileFacts: [], scope: "ProfileEdit" }
      )
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
    expect(() =>
      Schema.decodeUnknownSync(SubmitDiscoveryTurn)({
        intent: { ...reply, proposals: [add()] },
      })
    ).toThrow();
  });
});
