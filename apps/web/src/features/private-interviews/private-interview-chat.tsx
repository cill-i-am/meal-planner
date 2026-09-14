import {
  ParticipantMessageText,
  MAX_MESSAGE_LENGTH,
} from "@meal-planner/private-interview-api";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { useMemo, useState } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Label } from "../../components/ui/label.js";
import { isAssistantTurnActive } from "./private-interview-client.js";
import type {
  PrivateInterviewClient,
  PrivateInterviewView,
} from "./private-interview-client.js";
import { PrivateProfileCards } from "./private-profile-cards.js";
import { PrivateResponseStatus } from "./private-response-status.js";

/** The mounted generation owns the hook; losing private authority removes it. */
export const PrivateInterviewChat = ({
  client,
  generation,
  sessionReference,
  view,
}: {
  readonly client: PrivateInterviewClient;
  readonly generation: string;
  readonly sessionReference: string;
  readonly view: PrivateInterviewView;
}) => {
  const endpoint = `/v1/private-interviews/${encodeURIComponent(sessionReference)}/chat`;
  const [hydration, setHydration] = useState<"loading" | "ready" | "failed">(
    "loading"
  );
  const [cancelStatus, setCancelStatus] = useState<
    "idle" | "sending" | "failed"
  >("idle");
  const connection = useMemo(() => {
    const transport = fetchServerSentEvents(endpoint, {
      credentials: "same-origin",
      fetchClient: async (input, init) => {
        if (!client.hasGeneration(generation)) {
          throw new DOMException("Private session changed", "AbortError");
        }
        const response = await client.fetchChat(input, init);
        if (!client.hasGeneration(generation)) {
          throw new DOMException("Private session changed", "AbortError");
        }
        if (response.status === 401 || response.status === 403) {
          client.authenticationRequired(generation);
        }
        return response;
      },
      headers: { "x-private-output-generation": generation },
    });
    const { hydrate } = transport;
    if (hydrate === undefined) {
      throw new Error("Private chat requires server hydration");
    }
    return {
      ...transport,
      hydrate: async (threadId: string) => {
        try {
          const snapshot = await hydrate(threadId);
          if (client.hasGeneration(generation)) {
            setHydration("ready");
          }
          return snapshot;
        } catch (error) {
          if (client.hasGeneration(generation)) {
            setHydration("failed");
          }
          throw error;
        }
      },
    };
  }, [client, endpoint, generation]);
  const chat = useChat({
    connection,
    devtools: false,
    onError: client.refreshSession,
    onFinish: client.refreshSession,
    persistence: true,
    queue: "drop",
    threadId: sessionReference,
  });
  const active =
    chat.isLoading ||
    chat.sessionGenerating ||
    isAssistantTurnActive(view.assistantTurn);
  const disabled =
    hydration !== "ready" ||
    cancelStatus !== "idle" ||
    active ||
    view.pending !== null ||
    view.pendingConfirmation !== null ||
    view.notice !== null ||
    !view.cardsLoaded;
  const form = useForm({
    defaultValues: { text: "" },
    onSubmit: async ({ value, formApi }) => {
      if (disabled || view.sessionState === null) {
        return;
      }
      const text = Schema.decodeUnknownSync(ParticipantMessageText)(value.text);
      formApi.reset();
      setCancelStatus("idle");
      await chat.sendMessage(text, {
        body: { expectedVersion: view.sessionState.version },
        whenBusy: "drop",
      });
    },
  });
  const stop = async () => {
    const runId = chat.runId ?? view.assistantTurn?.id;
    if (runId === undefined || runId === null || cancelStatus === "sending") {
      return;
    }
    setCancelStatus("sending");
    chat.stop();
    try {
      const response = await client.fetchChat(
        `${endpoint}?runId=${encodeURIComponent(runId)}`,
        {
          credentials: "same-origin",
          headers: { "x-private-output-generation": generation },
          method: "DELETE",
        }
      );
      if (response.status === 401 || response.status === 403) {
        client.authenticationRequired(generation);
        return;
      }
      setCancelStatus(response.ok ? "idle" : "failed");
    } catch {
      setCancelStatus("failed");
    }
    client.refreshSession();
  };
  return (
    <section
      aria-labelledby="private-history-title"
      className="private-history"
    >
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
      {hydration === "loading" && <p role="status">Loading private history…</p>}
      {hydration === "ready" && chat.messages.length === 0 && (
        <p>
          Tell me about foods you enjoy, foods you avoid, or what makes meals
          easy or difficult for you. Start wherever you like.
        </p>
      )}
      <ol aria-label="Private messages" className="private-messages">
        {chat.messages
          .filter(
            (message) => message.role === "user" || message.role === "assistant"
          )
          .map((message) => {
            const text = message.parts
              .filter((part) => part.type === "text")
              .map((part) => part.content)
              .join("");
            return text.length === 0 ? null : (
              <li key={message.id}>
                <div className="private-message-meta">
                  <strong>
                    {message.role === "user" ? "You" : "Assistant"}
                  </strong>
                </div>
                <p>{text}</p>
              </li>
            );
          })}
      </ol>
      <PrivateResponseStatus
        active={active}
        cancelStatus={cancelStatus}
        chatError={chat.error !== undefined}
        client={client}
        stop={stop}
        view={view}
      />
      <fieldset
        aria-label="Profile proposal review"
        disabled={active || cancelStatus !== "idle"}
      >
        <PrivateProfileCards client={client} view={view} />
      </fieldset>
      {view.sessionState?.status === "open" && (
        <>
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
                onChange: Schema.toStandardSchemaV1(ParticipantMessageText),
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
                    Up to {MAX_MESSAGE_LENGTH.toLocaleString()} characters. Your
                    conversation is stored privately on the server.
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
                  Send message
                </Button>
              )}
            </form.Subscribe>
          </form>
          <div className="private-complete">
            <p>
              Finish when you’re done. Your history stays available; new
              messages will need a new session.
            </p>
            <Button disabled={disabled} onClick={client.complete}>
              Complete session
            </Button>
          </div>
        </>
      )}
      {hydration === "failed" && (
        <Alert>
          <p>Your private history could not be loaded.</p>
          <Button onClick={client.reconnectSession}>
            Reconnect to load history
          </Button>
        </Alert>
      )}
    </section>
  );
};
