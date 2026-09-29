import type {
  ConversationBlock,
  FoodAnswer,
} from "@meal-planner/agent-conversations-api";
import type {
  HouseholdPersonId,
  MealPlanId,
  PlanningContentSnapshot,
} from "@meal-planner/household-api";
import { useState } from "react";

import { MessageScrollerItem } from "../../components/ui/message-scroller.js";
import { ConversationBlockRenderer } from "./conversation-catalog.js";
import type { AgentConversationController } from "./conversation-controller.js";
import { ConversationPresentation } from "./conversation-presentation.js";

export interface ConversationPerson {
  readonly id: HouseholdPersonId;
  readonly displayName: string;
  readonly kind: "adult" | "dependant";
  readonly isCurrentAdult: boolean;
}

export interface PlanProposalReviewActions {
  readonly confirm: () => Promise<void>;
  readonly dismiss: () => Promise<void>;
}

export type PlanProposalReview = (
  block: Extract<ConversationBlock, { _tag: "PlanChangeProposal" }>,
  actions: PlanProposalReviewActions
) => void;

export type PlanningContentProposalReview = (
  block: Extract<ConversationBlock, { _tag: "PlanningContentProposal" }>,
  actions: PlanProposalReviewActions
) => void;

const belongsToSelection = (
  block: ConversationBlock,
  selectedPersonId: HouseholdPersonId | null
) => {
  if (selectedPersonId === null) {
    return true;
  }
  switch (block._tag) {
    case "Question": {
      return (
        block.targetPersonId === null ||
        block.targetPersonId === selectedPersonId
      );
    }
    case "PersonFactProposal": {
      return block.personId === selectedPersonId;
    }
    case "RoutineProposal": {
      return (
        block.routine.scope._tag === "Household" ||
        block.routine.scope.personId === selectedPersonId
      );
    }
    case "RosterProposal":
    case "PlanningContentProposal":
    case "PlanChangeProposal":
    case "RecipeDetails": {
      return true;
    }
    default: {
      return block satisfies never;
    }
  }
};

export const ConversationSurface = ({
  conversation,
  people = [],
  selectedPersonId = null,
  onSelectPerson,
  onRosterReview,
  onOpenPrivate,
  planId,
  purpose = "food-discovery",
  onPlanChangeCommitted,
  onPlanProposalReview,
  onPlanningContentProposalReview,
  planningContent = null,
}: {
  readonly conversation: AgentConversationController;
  readonly people?: readonly ConversationPerson[];
  readonly selectedPersonId?: HouseholdPersonId | null;
  readonly onSelectPerson?: (personId: HouseholdPersonId | null) => void;
  readonly onRosterReview?: (
    block: Extract<ConversationBlock, { _tag: "RosterProposal" }>
  ) => void;
  readonly onOpenPrivate?: () => void;
  readonly planId?: MealPlanId | null;
  readonly purpose?: "food-discovery" | "family-setup";
  readonly onPlanChangeCommitted?: () => void;
  readonly onPlanProposalReview?: PlanProposalReview;
  readonly onPlanningContentProposalReview?: PlanningContentProposalReview;
  readonly planningContent?: PlanningContentSnapshot | null;
}) => {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const selectedPerson = people.find(
    (person) => person.id === selectedPersonId
  );
  const lastTurn = conversation.view?.turns.at(-1);
  const assistantNotConfigured = lastTurn?.failure === "not_configured";
  const blocks =
    conversation.view?.blocks.filter(
      (block) =>
        belongsToSelection(block, selectedPersonId) &&
        (purpose !== "family-setup" || block._tag !== "RosterProposal")
    ) ?? [];
  const answer = async (
    block: Extract<ConversationBlock, { _tag: "Question" }>,
    value: FoodAnswer
  ) => {
    if (block.foodTopic === null) {
      return;
    }
    const target = block.targetPersonId ?? selectedPersonId;
    const subject =
      target === null
        ? "Our family"
        : (people.find((person) => person.id === target)?.displayName ??
          "This person");
    const topic = block.foodTopic.replaceAll("_", " ");
    const text = {
      change: `${subject} might enjoy ${topic} with a change. Ask me what would help.`,
      no: `${subject} would not enjoy ${topic}.`,
      unsure: `I'm not sure whether ${subject} would enjoy ${topic}.`,
      yes: `${subject} would enjoy ${topic}.`,
    }[value];
    setLocalError(null);
    try {
      await conversation.submit(text, {
        answerToBlockId: block.id,
        focusPersonId: target,
        foodAnswer: value,
        planId: planId ?? null,
      });
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : "Your answer could not be sent."
      );
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    setLocalError(null);
    try {
      await conversation.submit(text, {
        focusPersonId: selectedPersonId,
        planId: planId ?? null,
      });
      setDraft("");
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : "Your message could not be sent."
      );
    }
  };

  const reviewBlock = async (
    selected: ConversationBlock,
    decision: "accept" | "dismiss",
    safetyConfirmation?: "I confirm this safety constraint change" | null
  ) => {
    try {
      const result = await conversation.act(
        selected,
        decision,
        null,
        safetyConfirmation
      );
      if (
        selected._tag === "PlanChangeProposal" &&
        result._tag === "Committed"
      ) {
        onPlanChangeCommitted?.();
      }
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : "The proposal could not be reviewed."
      );
    }
  };

  const reviewPlan = (
    block: Extract<ConversationBlock, { _tag: "PlanChangeProposal" }>
  ) => {
    onPlanProposalReview?.(block, {
      confirm: async () => {
        const result = await conversation.act(block, "accept");
        if (result._tag !== "Committed") {
          throw new Error(
            "The plan change needs another review before it can be confirmed."
          );
        }
        onPlanChangeCommitted?.();
      },
      dismiss: async () => {
        const result = await conversation.act(block, "dismiss");
        if (result._tag !== "Committed") {
          throw new Error(
            "The dismissal could not be confirmed. Check the saved action."
          );
        }
      },
    });
  };

  const reviewPlanningContent = (
    block: Extract<ConversationBlock, { _tag: "PlanningContentProposal" }>
  ) => {
    onPlanningContentProposalReview?.(block, {
      confirm: async () => {
        const result = await conversation.act(block, "accept");
        if (result._tag !== "Committed") {
          throw new Error(
            "The meal setup needs another review before it can be confirmed."
          );
        }
      },
      dismiss: async () => {
        const result = await conversation.act(block, "dismiss");
        if (result._tag !== "Committed") {
          throw new Error(
            "The dismissal could not be confirmed. Check the saved action."
          );
        }
      },
    });
  };

  const renderBlock = (block: ConversationBlock) => (
    <MessageScrollerItem
      key={`${block.id}:${block.revision}`}
      messageId={block.id}
    >
      <ConversationBlockRenderer
        block={block}
        busy={
          conversation.busy ||
          conversation.pendingAction !== null ||
          conversation.recoveryBlocked ||
          selectedPerson?.kind === "adult" ||
          assistantNotConfigured
        }
        people={people}
        onAction={reviewBlock}
        onAnswer={answer}
        onRosterReview={onRosterReview}
        onPlanReview={
          onPlanProposalReview === undefined ? undefined : reviewPlan
        }
        onPlanningContentReview={
          onPlanningContentProposalReview === undefined
            ? undefined
            : reviewPlanningContent
        }
        planningContent={planningContent}
      />
    </MessageScrollerItem>
  );

  const retry = async () => {
    const action = conversation.pendingAction;
    const result = await conversation.retryAction();
    if (
      result?._tag === "Committed" &&
      action !== null &&
      blocks.some(
        (block) =>
          block.id === action.blockId && block._tag === "PlanChangeProposal"
      )
    ) {
      onPlanChangeCommitted?.();
    }
  };

  const startFoodQuestions = async () => {
    setLocalError(null);
    try {
      await conversation.submit("Ask our first food question.", {
        focusPersonId: selectedPersonId,
        planId: planId ?? null,
      });
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : "The first question could not be requested."
      );
    }
  };

  return (
    <ConversationPresentation
      conversation={conversation}
      people={people}
      selectedPersonId={selectedPersonId}
      onSelectPerson={onSelectPerson}
      onOpenPrivate={onOpenPrivate}
      purpose={purpose}
      blocks={blocks}
      renderBlock={renderBlock}
      localError={localError}
      draft={draft}
      onDraftChange={setDraft}
      onSend={send}
      onRetry={retry}
      onStartFoodQuestions={startFoodQuestions}
    />
  );
};

export const FamilySetupConversationSurface = ({
  conversation,
}: {
  readonly conversation: AgentConversationController;
}) => (
  <ConversationSurface conversation={conversation} purpose="family-setup" />
);
