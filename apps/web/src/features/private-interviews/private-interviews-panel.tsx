import { useEffect, useState, useSyncExternalStore } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { PrivateInterviewChat } from "./private-interview-chat.js";
import {
  browserPrivateInterviewDependencies,
  PrivateInterviewClient,
} from "./private-interview-client.js";
import type {
  PrivateInterviewDependencies,
  PrivateInterviewView,
} from "./private-interview-client.js";

const dateLabel = (timestamp: number) =>
  new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const Notice = ({
  client,
  view,
}: {
  readonly client: PrivateInterviewClient;
  readonly view: PrivateInterviewView;
}) => {
  switch (view.notice) {
    case "storage_unavailable": {
      return (
        <Alert>
          <p>
            This browser could not retain the request safely. Enable browser
            storage, then reconnect before making changes.
          </p>
        </Alert>
      );
    }
    case "unreadable_request": {
      return (
        <Alert>
          <p>
            This browser has a saved request it can no longer read. Its previous
            outcome is unknown. Check your sessions before clearing the saved
            request; clearing it does not undo any changes already made.
          </p>
          <Button
            disabled={!view.sessionsLoaded}
            onClick={client.discardUnreadableRequest}
          >
            Clear unreadable saved request
          </Button>
        </Alert>
      );
    }
    case "binding_changed": {
      return (
        <Alert>
          <p>
            Your participant link has changed. A saved request belongs to your
            previous link and cannot be retried here. Its outcome may still be
            unknown.
          </p>
          <Button onClick={client.discardPreviousRequest}>
            Discard saved request from previous link
          </Button>
        </Alert>
      );
    }
    case "version_conflict": {
      return (
        <Alert>
          <p>
            This session changed on another connection. Review its history
            before deciding whether to submit again.
          </p>
          <Button onClick={client.refreshSession}>
            Review updated history
          </Button>
        </Alert>
      );
    }
    case "session_completed": {
      return (
        <Alert>
          <p>
            This session is already completed. You can read its history or start
            a new session.
          </p>
        </Alert>
      );
    }
    case "mutation_collision": {
      return (
        <Alert>
          <p>
            This request conflicts with a previously saved request. Reconnect to
            review your sessions.
          </p>
          <Button onClick={client.connect}>Reconnect</Button>
        </Alert>
      );
    }
    case "assistant_turn_pending":
    case "assistant_turn_conflict": {
      return (
        <Alert>
          <p>
            This response changed on another connection. Refresh before
            continuing.
          </p>
          <Button onClick={client.reconnectSession}>
            Review response status
          </Button>
        </Alert>
      );
    }
    case "confirmation_pending":
    case "card_not_found":
    case "card_conflict":
    case "safety_confirmation_required": {
      return (
        <Alert>
          <p>This proposal needs an updated review before you can continue.</p>
          <Button onClick={client.refreshCards}>
            Review updated proposals
          </Button>
        </Alert>
      );
    }
    default: {
      return null;
    }
  }
};

const ConnectedPanel = ({
  client,
  view,
}: {
  readonly client: PrivateInterviewClient;
  readonly view: PrivateInterviewView;
}) => (
  <>
    <Notice client={client} view={view} />
    {view.pending !== null && view.pendingConfirmation === null && (
      <div className="private-request-status" role="status">
        <p>
          The outcome of your saved request is not confirmed. Retrying uses the
          same request and cannot create a duplicate.
        </p>
        <Button
          disabled={
            view.pending.sessionReference !== null && view.sessionState === null
          }
          onClick={client.retry}
        >
          Retry saved request
        </Button>
      </div>
    )}
    <div className="private-session-actions">
      <Button
        disabled={
          view.pendingConfirmation !== null ||
          view.pending !== null ||
          view.notice === "binding_changed" ||
          view.notice === "storage_unavailable" ||
          view.notice === "unreadable_request"
        }
        onClick={() => client.start("InitialDiscovery")}
      >
        Start food discovery
      </Button>
      <Button
        disabled={
          view.pendingConfirmation !== null ||
          view.pending !== null ||
          view.notice === "binding_changed" ||
          view.notice === "storage_unavailable" ||
          view.notice === "unreadable_request"
        }
        onClick={() => client.start("ProfileEdit")}
      >
        Update my food profile
      </Button>
      <Button onClick={client.connect}>Refresh sessions</Button>
    </div>
    {view.sessionsLoaded && view.reservations.length === 0 && (
      <p className="private-empty">
        No private sessions yet. Start one to save your own notes about food and
        meals.
      </p>
    )}
    {view.sessionsLoaded && view.reservations.length > 0 && (
      <nav aria-label="Your private sessions">
        <ul className="private-session-list">
          {view.reservations.map((reservation) => (
            <li key={reservation.sessionReference}>
              <button
                aria-current={
                  view.sessionReference === reservation.sessionReference
                    ? "true"
                    : undefined
                }
                className="private-session-link"
                disabled={
                  (view.pendingConfirmation !== null &&
                    view.sessionReference !== reservation.sessionReference) ||
                  (view.pending !== null &&
                    view.pending.sessionReference !==
                      reservation.sessionReference)
                }
                onClick={() => client.select(reservation.sessionReference)}
                type="button"
              >
                <span>Session {reservation.ordinal}</span>
                <time dateTime={new Date(reservation.createdAt).toISOString()}>
                  {dateLabel(reservation.createdAt)}
                </time>
              </button>
            </li>
          ))}
        </ul>
        {view.moreSessions && (
          <Button onClick={client.loadSessions}>Load more sessions</Button>
        )}
      </nav>
    )}
    {!view.sessionsLoaded && <p role="status">Loading your sessions…</p>}
    {view.sessionReference !== null &&
      (view.generation === null ? (
        <p role="status">Loading private session…</p>
      ) : (
        <PrivateInterviewChat
          client={client}
          generation={view.generation}
          key={`${view.sessionReference}:${view.generation}`}
          sessionReference={view.sessionReference}
          view={view}
        />
      ))}
  </>
);

interface PanelProps {
  readonly accountId: string;
  readonly householdId: string;
  readonly dependencies?: PrivateInterviewDependencies;
  readonly onConfirmationSettled?: () => void;
}

const BoundPrivateInterviewsPanel = ({
  accountId,
  householdId,
  dependencies,
  onConfirmationSettled,
}: PanelProps) => {
  const [client] = useState(
    () =>
      new PrivateInterviewClient(
        { accountId, householdId },
        dependencies ?? browserPrivateInterviewDependencies(),
        onConfirmationSettled
      )
  );
  const view = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot
  );
  useEffect(() => {
    client.connect();
    return client.disconnect;
  }, [client]);
  return (
    <section
      aria-labelledby="private-interviews-title"
      className="private-interviews"
      id="private-interviews"
    >
      <h2 id="private-interviews-title">Your private sessions</h2>
      <p className="lede">
        A space for your food preferences and experiences. Only your linked
        adult account can access these sessions.
      </p>
      <p className="private-foundation-note">
        Your messages and replies stay private. Review any profile proposals
        before deciding what to share. Only proposals you explicitly confirm
        update household food profiles.
      </p>
      {view.connection === "connecting" && (
        <p role="status">Connecting to your private sessions…</p>
      )}
      {view.connection === "authentication_required" && (
        <Alert>
          <p>
            Reconnect to continue. If your sign-in has expired, sign in again
            first. Any unconfirmed request is retained for your original account
            and participant link.
          </p>
          <Button onClick={client.connect}>Reconnect</Button>
        </Alert>
      )}
      {view.connection === "unavailable" && (
        <Alert>
          <p>
            Private sessions are unavailable. If your sign-in expired, sign in
            again. Any unconfirmed request is retained; reconnect to recover its
            outcome.
          </p>
          <Button onClick={client.connect}>Reconnect private sessions</Button>
        </Alert>
      )}
      {view.connection === "ready" && (
        <ConnectedPanel client={client} view={view} />
      )}
    </section>
  );
};

export const PrivateInterviewsPanel = (props: PanelProps) => (
  <BoundPrivateInterviewsPanel
    key={JSON.stringify([props.accountId, props.householdId])}
    {...props}
  />
);
