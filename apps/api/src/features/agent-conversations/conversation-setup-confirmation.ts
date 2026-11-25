import { ConversationActionId } from "@meal-planner/agent-conversations-api";
import type {
  ConversationAction,
  ConversationBlock,
  ConversationChatMetadata,
  ConversationScope,
  ConversationTurnState,
  SubmitConversationTurn,
} from "@meal-planner/agent-conversations-api";
import { Schema } from "effect";

import { ConversationModelFailure } from "./conversation-model.js";

/** Bind model agreement to the exact roster the caller displayed before this turn. */
export const prepareSetupConfirmation = (input: {
  readonly displayedRoster: ConversationChatMetadata["displayedRoster"];
  readonly latestRoster: Extract<
    ConversationBlock,
    { _tag: "RosterProposal" }
  > | null;
  readonly modelTurn: SubmitConversationTurn;
  readonly newActionId: () => string;
  readonly scope: ConversationScope;
}) => {
  if (input.modelTurn.setupConfirmation === null) {
    const checkedResult: ConversationTurnState["setupConfirmation"] = null;
    return checkedResult;
  }
  const { displayedRoster, latestRoster } = input;
  if (
    input.scope._tag !== "AccountPrivateSetup" ||
    input.modelTurn.blocks.length !== 0 ||
    displayedRoster === null ||
    latestRoster === null ||
    latestRoster.status !== "proposed" ||
    latestRoster.id !== displayedRoster.blockId ||
    latestRoster.revision !== displayedRoster.revision
  ) {
    throw new ConversationModelFailure({ reason: "invalid_output" });
  }
  {
    const checkedResult: ConversationTurnState["setupConfirmation"] = {
      _tag: "ConfirmDisplayedRoster",
      actionId: Schema.decodeUnknownSync(ConversationActionId)(
        input.newActionId()
      ),
      blockId: latestRoster.id,
      revision: latestRoster.revision,
    };
    return checkedResult;
  }
};

/** A conversational action cannot substitute edited roster fields after consent. */
export const matchesConfirmedRosterAction = (
  action: ConversationAction,
  roster: Extract<ConversationBlock, { _tag: "RosterProposal" }>,
  confirmation: ConversationTurnState["setupConfirmation"]
) => {
  if (
    confirmation === null ||
    action.decision !== "accept" ||
    action.reviewedRoster === null ||
    action.safetyConfirmation !== null ||
    action.actionId !== confirmation.actionId ||
    action.blockId !== confirmation.blockId ||
    action.blockId !== roster.id ||
    action.expectedRevision !== confirmation.revision ||
    action.expectedRevision !== roster.revision ||
    action.reviewedRoster.creatorName !== roster.creatorName ||
    action.reviewedRoster.familyName !== roster.familyName ||
    action.reviewedRoster.people.length !== roster.people.length
  ) {
    const checkedResult = false;
    return checkedResult;
  }
  {
    const checkedResult: boolean = action.reviewedRoster.people.every(
      (person, index) => {
        const displayed = roster.people[index];
        return (
          displayed?.draftId === person.draftId &&
          displayed.displayName === person.displayName &&
          displayed.kind === person.kind
        );
      }
    );
    return checkedResult;
  }
};
