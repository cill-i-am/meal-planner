import {
  AppendParticipantMessage,
  MAX_MESSAGE_LENGTH,
} from "@meal-planner/private-interview-api";
import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Label } from "../../components/ui/label.js";
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

const MessageForm = ({
  client,
  view,
}: {
  readonly client: PrivateInterviewClient;
  readonly view: PrivateInterviewView;
}) => {
  const form = useForm({
    defaultValues: {
      text:
        view.pending?.command.type === "AppendParticipantMessage"
          ? view.pending.command.text
          : "",
    },
    onSubmit: ({ value }) => {
      client.append(value.text);
    },
  });
  const disabled =
    view.pending !== null || view.notice !== null || !view.historyLoaded;
  return (
    <form
      className="private-message-form field-stack"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="text"
        validators={{
          onChange: Schema.toStandardSchemaV1(
            AppendParticipantMessage.fields.text
          ),
        }}
      >
        {(field) => (
          <>
            <Label htmlFor="private-message">Your message</Label>
            <textarea
              aria-describedby="private-message-help private-message-error"
              aria-invalid={field.state.meta.errors.length > 0}
              className="input private-message-input"
              disabled={disabled}
              id="private-message"
              maxLength={MAX_MESSAGE_LENGTH}
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              rows={4}
              value={field.state.value}
            />
            <p className="helper" id="private-message-help">
              Up to {MAX_MESSAGE_LENGTH.toLocaleString()} characters. We’ll
              confirm when your message is saved.
            </p>
            {field.state.meta.errors.length > 0 && (
              <p className="field-error" id="private-message-error">
                Enter a message within the character limit.
              </p>
            )}
          </>
        )}
      </form.Field>
      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          text: state.values.text,
        })}
      >
        {({ canSubmit, text }) => (
          <Button
            disabled={disabled || !canSubmit || text.trim().length === 0}
            type="submit"
          >
            Save message
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
};

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
          <Button onClick={client.reviewHistory}>Review updated history</Button>
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
    default: {
      return null;
    }
  }
};

const SessionHistory = ({
  client,
  view,
}: {
  readonly client: PrivateInterviewClient;
  readonly view: PrivateInterviewView;
}) => (
  <section aria-labelledby="private-history-title" className="private-history">
    <div className="review-heading">
      <h3 id="private-history-title">Session history</h3>
      {view.sessionState !== null && (
        <Badge>
          {view.sessionState.status === "completed"
            ? "Completed · history only"
            : "Open"}
        </Badge>
      )}
    </div>
    {view.historyLoaded && view.messages.length === 0 && (
      <p>No messages saved in this session.</p>
    )}
    {!view.historyLoaded && <p role="status">Loading private history…</p>}
    <ol aria-label="Saved messages" className="private-messages">
      {view.messages.map((message) => (
        <li key={message.id}>
          <div className="private-message-meta">
            <strong>
              {message.role === "participant" ? "You" : "Assistant"}
            </strong>
            <time dateTime={new Date(message.createdAt).toISOString()}>
              {dateLabel(message.createdAt)}
            </time>
          </div>
          <p>{message.text}</p>
        </li>
      ))}
    </ol>
    {view.moreHistory && (
      <Button onClick={client.loadHistory}>Load more messages</Button>
    )}
    {view.sessionState?.status === "open" && (
      <>
        <MessageForm
          client={client}
          key={`${view.sessionReference}:${view.lastAppendReceipt ?? "draft"}`}
          view={view}
        />
        <div className="private-complete">
          <p>
            Finish when you’re done. Your history stays available; new messages
            will need a new session.
          </p>
          <Button
            disabled={
              view.pending !== null ||
              view.notice !== null ||
              !view.historyLoaded
            }
            onClick={client.complete}
          >
            Complete session
          </Button>
        </div>
      </>
    )}
  </section>
);

const ConnectedPanel = ({
  client,
  view,
}: {
  readonly client: PrivateInterviewClient;
  readonly view: PrivateInterviewView;
}) => (
  <>
    <Notice client={client} view={view} />
    {view.pending !== null && (
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
          view.pending !== null ||
          view.notice === "binding_changed" ||
          view.notice === "storage_unavailable"
        }
        onClick={client.start}
      >
        Start private session
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
                  view.pending !== null &&
                  view.pending.sessionReference !== reservation.sessionReference
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
    {view.sessionReference !== null && (
      <SessionHistory client={client} view={view} />
    )}
  </>
);

interface PanelProps {
  readonly accountId: string;
  readonly householdId: string;
  readonly dependencies?: PrivateInterviewDependencies;
}

const BoundPrivateInterviewsPanel = ({
  accountId,
  householdId,
  dependencies,
}: PanelProps) => {
  const [client] = useState(
    () =>
      new PrivateInterviewClient(
        { accountId, householdId },
        dependencies ?? browserPrivateInterviewDependencies()
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
        You can save messages and return to them later. Assistant replies are
        not available yet, and these notes do not update household food
        profiles.
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
