import {
  ConversationAction,
  ConversationBlock,
  ConversationScope,
  SubmitConversationTurn,
} from "@meal-planner/agent-conversations-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  matchesConfirmedRosterAction,
  prepareSetupConfirmation,
} from "./conversation-setup-confirmation.js";

const blockId = "a1b2c3d4-e5f6-47a8-b9c0-123456789abc";
const actionId = "f1b2c3d4-e5f6-47a8-b9c0-123456789abc";
const roster = Schema.decodeUnknownSync(ConversationBlock)({
  _tag: "RosterProposal",
  creatorName: "Morgan",
  familyName: "Morgan’s family",
  id: blockId,
  people: [
    {
      displayName: "Louise",
      draftId: "b1b2c3d4-e5f6-47a8-b9c0-123456789abc",
      kind: "adult",
    },
  ],
  revision: 1,
  status: "proposed",
  turnId: "run-original-roster",
});
if (roster._tag !== "RosterProposal") {
  throw new Error("Expected setup roster");
}
const confirmation = Schema.decodeUnknownSync(SubmitConversationTurn)({
  blocks: [],
  reply: "I’ll create your family now.",
  setupConfirmation: { _tag: "ConfirmDisplayedRoster" },
});
const setupScope = Schema.decodeUnknownSync(ConversationScope)({
  _tag: "AccountPrivateSetup",
});
const confirm = (input: {
  displayedRoster: { blockId: typeof roster.id; revision: number } | null;
  latestRoster: typeof roster | null;
  modelTurn: typeof confirmation;
  scope: ConversationScope;
}) =>
  prepareSetupConfirmation({
    ...input,
    newActionId: () => actionId,
  });

describe("setup confirmation", () => {
  it("stores one action identity for the exact previously displayed roster", () => {
    expect(
      confirm({
        displayedRoster: { blockId: roster.id, revision: roster.revision },
        latestRoster: roster,
        modelTurn: confirmation,
        scope: setupScope,
      })
    ).toEqual({
      _tag: "ConfirmDisplayedRoster",
      actionId,
      blockId: roster.id,
      revision: roster.revision,
    });
  });

  it("rejects absent, undisplayed, stale, and dismissed rosters", () => {
    const base = {
      displayedRoster: { blockId: roster.id, revision: roster.revision },
      latestRoster: roster,
      modelTurn: confirmation,
      scope: setupScope,
    };
    expect(() => confirm({ ...base, latestRoster: null })).toThrow();
    expect(() => confirm({ ...base, displayedRoster: null })).toThrow();
    expect(() =>
      confirm({
        ...base,
        displayedRoster: { blockId: roster.id, revision: 2 },
      })
    ).toThrow();
    expect(() =>
      confirm({ ...base, latestRoster: { ...roster, status: "dismissed" } })
    ).toThrow();
  });

  it("rejects a confirmation with edits or in shared scope", () => {
    const base = {
      displayedRoster: { blockId: roster.id, revision: roster.revision },
      latestRoster: roster,
      modelTurn: confirmation,
      scope: setupScope,
    };
    expect(() =>
      confirm({
        ...base,
        modelTurn: {
          ...confirmation,
          blocks: [
            {
              _tag: "RosterProposal",
              creatorName: roster.creatorName,
              familyName: "The Table",
              people: [],
            },
          ],
        },
      })
    ).toThrow();
    expect(() =>
      confirm({
        ...base,
        scope: {
          _tag: "FamilyShared",
          familyId: "family-test",
        } as ConversationScope,
      })
    ).toThrow();
  });

  it("leaves ordinary turns without a confirmation", () => {
    expect(
      confirm({
        displayedRoster: null,
        latestRoster: null,
        modelTurn: { ...confirmation, setupConfirmation: null },
        scope: setupScope,
      })
    ).toBeNull();
  });

  it("requires the confirmation action to carry the exact displayed roster", () => {
    const intent = confirm({
      displayedRoster: { blockId: roster.id, revision: roster.revision },
      latestRoster: roster,
      modelTurn: confirmation,
      scope: setupScope,
    });
    if (intent === null) {
      throw new Error("Expected confirmation intent");
    }
    const action = Schema.decodeUnknownSync(ConversationAction)({
      actionId: intent.actionId,
      blockId: intent.blockId,
      decision: "accept",
      expectedRevision: intent.revision,
      reviewedRoster: {
        creatorName: roster.creatorName,
        familyName: roster.familyName,
        people: roster.people,
      },
      safetyConfirmation: null,
    });
    expect(matchesConfirmedRosterAction(action, roster, intent)).toBe(true);
    if (action.decision !== "accept" || action.reviewedRoster === null) {
      throw new Error("Expected accepted roster action");
    }
    expect(
      matchesConfirmedRosterAction(
        {
          ...action,
          reviewedRoster: { ...action.reviewedRoster, familyName: "Other" },
        },
        roster,
        intent
      )
    ).toBe(false);
    expect(
      matchesConfirmedRosterAction(
        { ...action, expectedRevision: intent.revision + 1 },
        roster,
        intent
      )
    ).toBe(false);
  });
});
