import type {
  ConversationBlock,
  ConversationScope,
} from "@meal-planner/agent-conversations-api";
import type { MealPlanResolution } from "@meal-planner/household-api";
import { Schema } from "effect";

import { ConversationModelContext } from "./conversation.contract.js";
import type { ConversationCanonicalContext } from "./conversation.contract.js";

const dayMs = 86_400_000;
const epochDay = (date: string) => Date.parse(`${date}T00:00:00.000Z`) / dayMs;

const compactChoice = (resolution: MealPlanResolution) => {
  switch (resolution._tag) {
    case "MealOption": {
      return {
        _tag: resolution._tag,
        option: resolution.option,
        quantity: resolution.quantity,
      };
    }
    case "Prepared": {
      return {
        _tag: resolution._tag,
        outputId: resolution.outputId,
        quantity: resolution.quantity,
      };
    }
    case "External": {
      return { _tag: resolution._tag, description: resolution.description };
    }
    case "Gap": {
      return { _tag: resolution._tag, reason: resolution.reason };
    }
    case "Skip":
    case "Flexible": {
      return { _tag: resolution._tag };
    }
    default: {
      return resolution satisfies never;
    }
  }
};

export const projectConversationModelContext = (
  context: ConversationCanonicalContext,
  scope: ConversationScope,
  setupRoster: Extract<
    ConversationBlock,
    { _tag: "RosterProposal" }
  > | null = null
): ConversationModelContext => {
  const { plan } = context;
  const setupAccountDisplayName =
    scope._tag === "AccountPrivateSetup"
      ? context.setupAccountDisplayName
      : null;
  if (plan === null) {
    return Schema.decodeUnknownSync(ConversationModelContext)({
      ...context,
      plan: null,
      setupAccountDisplayName,
      setupRoster: scope._tag === "AccountPrivateSetup" ? setupRoster : null,
    });
  }
  const version = plan._tag === "Approved" ? plan.active : plan.proposed;
  const grouped = new Map<
    string,
    {
      choice: ReturnType<typeof compactChoice>;
      occasionId: string;
      personId: string;
      weekday: number;
      weekIndices: number[];
    }
  >();
  for (const { requirement, resolution } of version.coverage) {
    const weekday = new Date(`${requirement.date}T00:00:00.000Z`).getUTCDay();
    const weekIndex = Math.floor(
      (epochDay(requirement.date) - epochDay(plan.request.startDate)) / 7
    );
    const choice = compactChoice(resolution);
    const key = JSON.stringify([
      requirement.personId,
      requirement.occasion,
      weekday,
      choice,
    ]);
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, {
        choice,
        occasionId: requirement.occasion,
        personId: requirement.personId,
        weekIndices: [weekIndex],
        weekday,
      });
    } else {
      existing.weekIndices.push(weekIndex);
    }
  }
  const currentChoices = [...grouped.values()].slice(0, 128);
  const includedCoverage = currentChoices.reduce(
    (count, row) => count + row.weekIndices.length,
    0
  );
  return Schema.decodeUnknownSync(ConversationModelContext)({
    ...context,
    plan: {
      currentChoices,
      omittedCoverageCount: version.coverage.length - includedCoverage,
      planId: plan.planId,
      request: plan.request,
      revision: plan.revision,
      state: plan._tag,
      totalCoverage: version.coverage.length,
    },
    setupAccountDisplayName,
    setupRoster: null,
  });
};
