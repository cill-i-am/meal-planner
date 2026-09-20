import type { AssistantTurn } from "@meal-planner/private-interview-api";

import { Button } from "../../components/ui/button.js";
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
      return "The assistant could not respond to this message. You can add more context in another message.";
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
      return "The response was interrupted. The previous request may have been processed, but no reply was saved. You can add another message after checking the saved conversation.";
    }
    default: {
      return turn.status === "cancelled"
        ? "Response stopped. The previous request may have been processed, but no reply from it will be added."
        : "The assistant could not finish this response. Your message is saved. You can add another message.";
    }
  }
};

export const PrivateResponseStatus = ({
  active,
  cancelStatus,
  chatError,
  client,
  stop,
  view,
}: {
  readonly active: boolean;
  readonly cancelStatus: "idle" | "sending" | "failed";
  readonly chatError: boolean;
  readonly client: PrivateInterviewClient;
  readonly stop: () => Promise<void>;
  readonly view: PrivateInterviewView;
}) => {
  const turn = view.assistantTurn;
  if (
    !active &&
    !chatError &&
    cancelStatus !== "failed" &&
    (turn === null || turn.status === "succeeded")
  ) {
    return null;
  }
  let message =
    "The connection to the response was interrupted. Reconnect to recover the saved conversation.";
  if (cancelStatus === "failed") {
    message =
      "Stop could not be confirmed. Reconnect to check whether the response is still running.";
  } else if (active) {
    message = "Preparing a response…";
  } else if (turn !== null && turn.status !== "succeeded") {
    message = failureMessage(turn);
  }
  return (
    <div className="private-request-status" role="status">
      <p>{message}</p>
      {active && (
        <Button
          disabled={cancelStatus === "sending"}
          onClick={() => {
            void stop();
          }}
        >
          Stop response
        </Button>
      )}
      {(!active || cancelStatus === "failed") && (
        <Button onClick={client.reconnectSession}>
          Reconnect to check response
        </Button>
      )}
    </div>
  );
};
