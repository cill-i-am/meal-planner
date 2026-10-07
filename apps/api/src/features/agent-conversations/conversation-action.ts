import {
  ConversationAction,
  ConversationBlock,
} from "@meal-planner/agent-conversations-api";
import type { ConversationActionState } from "@meal-planner/agent-conversations-api";
import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { Schema } from "effect";

export const ActionExecution = Schema.Struct({
  action: ConversationAction,
  block: ConversationBlock,
  commandIds: Schema.Array(Schema.String.pipe(Schema.check(Schema.isUUID()))),
  familyId: Schema.NullOr(HouseholdOrganizationId),
  nextStep: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  rejectionReason: Schema.NullOr(
    Schema.Literals(["stale_review", "not_actionable", "permission_denied"])
  ),
  status: Schema.Literals(["pending", "unknown", "committed", "rejected"]),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ActionExecution = typeof ActionExecution.Type;

export const conversationActionState = (
  execution: ActionExecution
): ConversationActionState => {
  switch (execution.status) {
    case "pending": {
      return { _tag: "Pending", actionId: execution.action.actionId };
    }
    case "unknown": {
      return {
        _tag: "Unknown",
        actionId: execution.action.actionId,
        familyId: execution.familyId,
      };
    }
    case "committed": {
      return {
        _tag: "Committed",
        actionId: execution.action.actionId,
        familyId: execution.familyId,
      };
    }
    case "rejected": {
      return {
        _tag: "Rejected",
        actionId: execution.action.actionId,
        reason: execution.rejectionReason ?? "stale_review",
      };
    }
    default: {
      return execution.status satisfies never;
    }
  }
};
