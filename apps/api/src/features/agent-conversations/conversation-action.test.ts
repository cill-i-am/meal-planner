import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActionExecution,
  conversationActionState,
} from "./conversation-action.js";

const actionId = "f1b2c3d4-e5f6-47a8-b9c0-123456789abc";
const blockId = "a1b2c3d4-e5f6-47a8-b9c0-123456789abc";
const receipt = {
  action: {
    actionId,
    blockId,
    decision: "dismiss",
    expectedRevision: 1,
  },
  block: {
    _tag: "RosterProposal",
    creatorName: "Morgan",
    familyName: "The Table",
    id: blockId,
    people: [],
    revision: 1,
    status: "proposed",
    turnId: "run-original-roster",
  },
  commandIds: ["b1b2c3d4-e5f6-47a8-b9c0-123456789abc"],
  nextStep: 0,
};

describe("conversation action state", () => {
  it.each([
    {
      expected: { _tag: "Pending", actionId },
      familyId: "family-test",
      rejectionReason: null,
      status: "pending",
    },
    {
      expected: { _tag: "Unknown", actionId, familyId: null },
      familyId: null,
      rejectionReason: null,
      status: "unknown",
    },
    {
      expected: { _tag: "Unknown", actionId, familyId: "family-test" },
      familyId: "family-test",
      rejectionReason: null,
      status: "unknown",
    },
    {
      expected: { _tag: "Committed", actionId, familyId: null },
      familyId: null,
      rejectionReason: null,
      status: "committed",
    },
    {
      expected: { _tag: "Committed", actionId, familyId: "family-test" },
      familyId: "family-test",
      rejectionReason: null,
      status: "committed",
    },
    ...["stale_review", "not_actionable", "permission_denied"].map(
      (rejectionReason) => ({
        expected: { _tag: "Rejected", actionId, reason: rejectionReason },
        familyId: "family-test",
        rejectionReason,
        status: "rejected",
      })
    ),
    {
      expected: { _tag: "Rejected", actionId, reason: "stale_review" },
      familyId: null,
      rejectionReason: null,
      status: "rejected",
    },
  ])(
    "projects $status with family $familyId and rejection $rejectionReason",
    ({ expected, ...state }) => {
      const execution = Schema.decodeUnknownSync(ActionExecution)({
        ...receipt,
        ...state,
      });
      expect(conversationActionState(execution)).toEqual(expected);
    }
  );
});
