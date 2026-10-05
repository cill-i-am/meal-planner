import {
  ConversationModelBlock,
  ConversationScope,
  ConversationTurnId,
} from "@meal-planner/agent-conversations-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { prepareConversationBlocks } from "./conversation-proposals.js";
import { ConversationCanonicalContext } from "./conversation.contract.js";

const emptyContent = {
  availability: [],
  configVersion: 0,
  cookingCapacity: {
    availableEquipment: [],
    maximumSubstantialCookEventsPerWeek: 0,
  },
  fallbacks: [],
  managedOccasions: [],
  oneOffRoutines: [],
  options: [],
  preparedPortions: [],
  routines: [],
  suitabilityReviews: [],
};
const setupContext = Schema.decodeUnknownSync(ConversationCanonicalContext)({
  family: null,
  people: [],
  plan: null,
  planningContent: null,
  profiles: [],
  setupAccountDisplayName: "Morgan",
});
const turnId = Schema.decodeUnknownSync(ConversationTurnId)(
  "a1b2c3d4-e5f6-47a8-b9c0-123456789abc"
);
const personId = "person_a1b2c3d4-e5f6-47a8-b9c0-123456789abc";
const factId = "fact_a1b2c3d4-e5f6-47a8-b9c0-123456789abc";
const familyContext = Schema.decodeUnknownSync(ConversationCanonicalContext)({
  family: {
    canManage: true,
    createdAtEpochMs: 1,
    id: "family-test",
    name: "The Table",
    setup: { completedAtEpochMs: 1, status: "complete" },
    slug: "the-table",
    updatedAtEpochMs: 1,
    version: 1,
  },
  people: [
    {
      associationState: "unlinked",
      associationVersion: null,
      createdAtEpochMs: 1,
      displayName: "Sam",
      id: personId,
      isCurrentAdult: false,
      kind: "dependant",
      lifecycle: "active",
      updatedAtEpochMs: 1,
      version: 1,
    },
  ],
  plan: null,
  planningContent: emptyContent,
  profiles: [
    {
      audit: null,
      facts: [
        {
          createdAtEpochMs: 1,
          createdBy: "a".repeat(64),
          createdInVersion: 1,
          id: factId,
          source: "manual_ui",
          standing: { _tag: "confirmed", basis: "household_adult" },
          updatedAtEpochMs: 1,
          updatedBy: "a".repeat(64),
          updatedInVersion: 1,
          value: {
            _tag: "HardConstraint",
            category: "allergen",
            handling: "exclude",
            label: "Peanuts",
          },
        },
      ],
      personId,
      version: 1,
    },
  ],
  setupAccountDisplayName: null,
});
const familyScope = Schema.decodeUnknownSync(ConversationScope)({
  _tag: "FamilyShared",
  familyId: "family-test",
});

describe("agent conversation proposals", () => {
  it("assigns stable server IDs and keeps a setup roster noncanonical", () => {
    const blocks = prepareConversationBlocks({
      blocks: [
        Schema.decodeUnknownSync(ConversationModelBlock)({
          _tag: "RosterProposal",
          creatorName: "Alex",
          familyName: "The Table",
          people: [{ displayName: "Sam", kind: "dependant" }],
        }),
      ],
      context: setupContext,
      focusPersonId: null,
      scope: { _tag: "AccountPrivateSetup" },
      turnId,
    });
    const [block] = blocks;
    expect(block?._tag).toBe("RosterProposal");
    if (block?._tag !== "RosterProposal") {
      throw new Error("Expected roster proposal");
    }
    expect(block.turnId).toBe(turnId);
    expect(block.status).toBe("proposed");
    expect(block.people[0]?.draftId).toMatch(/^[\da-f-]{36}$/u);
  });

  it("keeps unchanged people identities when a corrected roster replaces the draft", () => {
    const [first] = prepareConversationBlocks({
      blocks: [
        Schema.decodeUnknownSync(ConversationModelBlock)({
          _tag: "RosterProposal",
          creatorName: "Morgan",
          familyName: "Morgan’s family",
          people: [
            { displayName: "Louise", kind: "adult" },
            { displayName: "Seth", kind: "dependant" },
          ],
        }),
      ],
      context: setupContext,
      focusPersonId: null,
      scope: { _tag: "AccountPrivateSetup" },
      turnId,
    });
    if (first?._tag !== "RosterProposal") {
      throw new Error("Expected a roster");
    }
    const [corrected] = prepareConversationBlocks({
      blocks: [
        Schema.decodeUnknownSync(ConversationModelBlock)({
          _tag: "RosterProposal",
          creatorName: "Morgan",
          familyName: "The Table",
          people: [
            { displayName: "Louise", kind: "adult" },
            { displayName: "Farah", kind: "dependant" },
          ],
        }),
      ],
      context: setupContext,
      focusPersonId: null,
      previousRoster: first,
      scope: { _tag: "AccountPrivateSetup" },
      turnId,
    });
    if (corrected?._tag !== "RosterProposal") {
      throw new Error("Expected a corrected roster");
    }
    expect(corrected.people[0]?.draftId).toBe(first.people[0]?.draftId);
    expect(corrected.people[1]?.draftId).not.toBe(first.people[1]?.draftId);
  });

  it("rejects person facts and family planning blocks in account-private setup", () => {
    expect(() =>
      prepareConversationBlocks({
        blocks: [
          Schema.decodeUnknownSync(ConversationModelBlock)({
            _tag: "RecipeDetails",
            recipeId: "a1b2c3d4-e5f6-47a8-b9c0-123456789abc",
          }),
        ],
        context: setupContext,
        focusPersonId: null,
        scope: { _tag: "AccountPrivateSetup" },
        turnId,
      })
    ).toThrow();
  });

  it("rejects a child kind outside the canonical vocabulary", () => {
    expect(() =>
      Schema.decodeUnknownSync(ConversationModelBlock)({
        _tag: "RosterProposal",
        creatorName: "Morgan",
        familyName: "Cedar Table",
        people: [{ displayName: "Riley", kind: "child" }],
      })
    ).toThrow();
  });

  it("derives safety confirmation and a reviewed before-value from the current fact", () => {
    const [block] = prepareConversationBlocks({
      blocks: [
        Schema.decodeUnknownSync(ConversationModelBlock)({
          _tag: "PersonFactProposal",
          change: { _tag: "Remove", factId },
          explanation: "Sam no longer needs this exclusion.",
          personId,
          profileVersion: 1,
        }),
      ],
      context: familyContext,
      focusPersonId: personId,
      scope: familyScope,
      turnId,
    });
    expect(block?._tag).toBe("PersonFactProposal");
    if (block?._tag !== "PersonFactProposal") {
      throw new Error("Expected a person fact proposal");
    }
    expect(block.requiresSafetyConfirmation).toBe(true);
    expect(block.reviewedBefore).toEqual({
      _tag: "HardConstraint",
      category: "allergen",
      handling: "exclude",
      label: "Peanuts",
    });
  });

  it("assigns a stable canonical ID before an adult reviews a new food option", () => {
    const [block] = prepareConversationBlocks({
      blocks: [
        Schema.decodeUnknownSync(ConversationModelBlock)({
          _tag: "PlanningContentProposal",
          command: {
            _tag: "PutOption",
            value: {
              cover: null,
              kind: "external",
              label: "School lunch",
              provider: "School",
            },
          },
          expectedContentVersion: 0,
          explanation: "Sam eats lunch at school on weekdays.",
        }),
      ],
      context: familyContext,
      focusPersonId: personId,
      scope: familyScope,
      turnId,
    });
    expect(block?._tag).toBe("PlanningContentProposal");
    if (
      block?._tag !== "PlanningContentProposal" ||
      block.command._tag !== "PutOption"
    ) {
      throw new Error("Expected a saved food option proposal");
    }
    expect(block.command.value.optionId).toMatch(/^[\da-f-]{36}$/u);
    expect(block.command.value.optionVersion).toBe(1);
  });

  it("rejects a fallback that cites food absent from the saved catalog", () => {
    expect(() =>
      prepareConversationBlocks({
        blocks: [
          Schema.decodeUnknownSync(ConversationModelBlock)({
            _tag: "PlanningContentProposal",
            command: {
              _tag: "PutFallback",
              value: {
                locations: ["school"],
                occasionIds: [],
                optionRef: {
                  kind: "external",
                  optionId: "missing_option",
                  optionVersion: 1,
                },
                personId,
                priority: 1,
                state: "active",
                substitutionPolicy: "ask",
              },
            },
            expectedContentVersion: 0,
            explanation: "Use this when lunch falls through.",
          }),
        ],
        context: familyContext,
        focusPersonId: personId,
        scope: familyScope,
        turnId,
      })
    ).toThrow();
  });
});
