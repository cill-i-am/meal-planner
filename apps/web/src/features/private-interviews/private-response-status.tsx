import type { AssistantTurn } from "@meal-planner/private-interview-api";

import { Button } from "../../components/ui/button.js";
import { isAssistantTurnActive } from "./private-interview-client.js";
import type {
  PrivateInterviewClient,
  PrivateInterviewView,
} from "./private-interview-client.js";

const failureMessage = (turn: AssistantTurn) => {
  switch (turn.failure) {
    case "not_configured": {
      return "Assistant replies are not available for this session right now. Your message is saved.";
    }
    case "refused": {
      return "The assistant could not respond to this message. You can add more context or try a new response.";
    }
    case "context_limit": {
      return "This session has reached the response limit. You can review its history and start a new session.";
    }
    case "invalid_output": {
      return "The response could not be saved safely. Your message is saved, and no proposals from this response were added.";
    }
    case "outcome_unknown":
    case "connection_lost":
    case "runtime_restarted": {
      return "The response was interrupted. The previous request may have been processed, but no reply was saved. Trying again starts a new response.";
    }
    default: {
      return turn.status === "cancelled"
        ? "Response stopped. The previous request may have been processed, but no reply from it will be added."
        : "The assistant could not finish this response. Your message is saved. You can try a new response.";
    }
  }
};

const responseMessage = (
  turn: AssistantTurn,
  requestStatus: PrivateInterviewView["turnRequestStatus"]
) => {
  if (turn.status === "running") {
    return "Preparing a response… Your message is saved.";
  }
  if (turn.status === "queued") {
    return requestStatus === "idle"
      ? "Your message is saved. Continue when you’re ready for a response."
      : "Your message is saved. Waiting for the response status…";
  }
  return failureMessage(turn);
};

export const PrivateResponseStatus = ({
  client,
  view,
}: {
  readonly client: PrivateInterviewClient;
  readonly view: PrivateInterviewView;
}) => {
  const turn = view.assistantTurn;
  if (turn === null || turn.status === "succeeded") {
    return null;
  }
  const active = isAssistantTurnActive(turn);
  const disabled =
    view.pending !== null ||
    view.pendingConfirmation !== null ||
    view.notice !== null ||
    !view.historyLoaded;
  return (
    <div className="private-request-status" role="status">
      <p>{responseMessage(turn, view.turnRequestStatus)}</p>
      {active ? (
        <div className="private-session-actions">
          {turn.status === "queued" && view.turnRequestStatus === "idle" && (
            <Button disabled={disabled} onClick={client.continueResponse}>
              Continue response
            </Button>
          )}
          {view.turnRequestStatus === "reconcile_required" && (
            <Button onClick={client.reconnectSession}>
              Reconnect to check response
            </Button>
          )}
          <Button disabled={disabled} onClick={client.stopResponse}>
            Stop response
          </Button>
        </div>
      ) : (
        <Button
          disabled={disabled || view.sessionState?.status !== "open"}
          onClick={client.tryNewResponse}
        >
          Try new response
        </Button>
      )}
    </div>
  );
};
