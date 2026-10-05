import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AgentPlanChange,
  ConversationAction,
  ConversationModelBlock,
  ConversationTurnId,
  ConversationTurnRequest,
} from "./index.js";

const id = "a1b2c3d4-e5f6-47a8-b9c0-123456789abc";
const decodeModelBlock = Schema.decodeUnknownSync(ConversationModelBlock, {
  onExcessProperty: "error",
});

describe("agent conversation contract", () => {
  it("admits only curated food topics and no generated image URL", () => {
    expect(
      decodeModelBlock({
        _tag: "Question",
        foodTopic: "pasta",
        prompt: "How does pasta work for Alex?",
        targetPersonId: null,
      })._tag
    ).toBe("Question");
    expect(() =>
      decodeModelBlock({
        _tag: "Question",
        foodTopic: "unknown_dish",
        prompt: "How does this work?",
        targetPersonId: null,
      })
    ).toThrow();
    expect(() =>
      decodeModelBlock({
        _tag: "Question",
        foodTopic: "pasta",
        imageUrl: "https://example.test/arbitrary.png",
        prompt: "How does this work?",
        targetPersonId: null,
      })
    ).toThrow();
  });

  it("keeps model proposals free of server identities and accepts an exact reviewed roster", () => {
    expect(() =>
      decodeModelBlock({
        _tag: "RosterProposal",
        creatorName: "Alex",
        familyName: "The Family",
        id,
        people: [],
      })
    ).toThrow();
    const accept = Schema.decodeUnknownSync(ConversationAction, {
      onExcessProperty: "error",
    })({
      actionId: id,
      blockId: id,
      decision: "accept",
      expectedRevision: 1,
      reviewedRoster: {
        creatorName: "Alex",
        familyName: "The Family",
        people: [{ displayName: "Sam", draftId: id, kind: "dependant" }],
      },
      safetyConfirmation: null,
    });
    expect(accept.decision).toBe("accept");
  });

  it("requires a typed selected-person and food answer on every stream request", () => {
    const decode = Schema.decodeUnknownSync(ConversationTurnRequest, {
      onExcessProperty: "error",
    });
    expect(
      decode({
        answerToBlockId: null,
        displayedRoster: null,
        expectedVersion: 0,
        focusPersonId: null,
        foodAnswer: null,
        planId: null,
        text: "Help me plan our week",
        turnId: id,
      }).text
    ).toBe("Help me plan our week");
    expect(() =>
      decode({
        expectedVersion: 0,
        text: "Help me plan our week",
        turnId: id,
      })
    ).toThrow();
  });

  it("requires a typed setup confirmation with a displayed roster reference", () => {
    const decode = Schema.decodeUnknownSync(ConversationTurnRequest, {
      onExcessProperty: "error",
    });
    expect(
      decode({
        answerToBlockId: null,
        displayedRoster: { blockId: id, revision: 1 },
        expectedVersion: 2,
        focusPersonId: null,
        foodAnswer: null,
        planId: null,
        text: "Yes, that looks right",
        turnId: "run-confirm-roster",
      }).displayedRoster
    ).toEqual({ blockId: id, revision: 1 });
    expect(() =>
      decode({
        answerToBlockId: null,
        displayedRoster: { blockId: id, revision: 0 },
        expectedVersion: 2,
        focusPersonId: null,
        foodAnswer: null,
        planId: null,
        text: "Yes",
        turnId: "run-confirm-roster",
      })
    ).toThrow();
  });

  it("admits a bounded TanStack run ID for turn replay", () => {
    const decode = Schema.decodeUnknownSync(ConversationTurnId);
    expect(decode("run-1790634000000-a1b2c3")).toBe("run-1790634000000-a1b2c3");
    expect(() => decode("../run-1790634000000-a1b2c3")).toThrow();
    expect(() => decode(`run-${"x".repeat(100)}`)).toThrow();
  });

  it("keeps planning content proposals within the non-safety command catalog", () => {
    expect(
      decodeModelBlock({
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
        explanation: "School provides lunch.",
      })._tag
    ).toBe("PlanningContentProposal");
    expect(() =>
      decodeModelBlock({
        _tag: "PlanningContentProposal",
        command: { _tag: "PutSuitabilityReview" },
        expectedContentVersion: 0,
        explanation: "The model cannot clear food safety.",
      })
    ).toThrow();
  });

  it("excludes the system-only plan refresh from model proposals", () => {
    expect(
      Schema.decodeUnknownSync(AgentPlanChange)({
        _tag: "RemoveCookEvent",
        eventId: "cook-event-one",
      })._tag
    ).toBe("RemoveCookEvent");
    expect(() =>
      decodeModelBlock({
        _tag: "PlanChangeProposal",
        change: { _tag: "RefreshInputs" },
        expectedRevision: 1,
        explanation: "Refresh saved inputs.",
        planId: id,
      })
    ).toThrow();
    expect(() =>
      decodeModelBlock({
        _tag: "PlanChangeProposal",
        change: { _tag: "ReplaceDraftPlan", cookEvents: [], coverage: [] },
        expectedRevision: 1,
        explanation: "A raw full-matrix model output exceeds provider limits.",
        planId: id,
      })
    ).toThrow();
  });
});
