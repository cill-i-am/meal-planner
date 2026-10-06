import type { ConversationBlock } from "@meal-planner/agent-conversations-api";
import type { HouseholdPersonId } from "@meal-planner/household-api";
import { Fragment } from "react";
import type { ReactNode } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Bubble, BubbleContent } from "../../components/ui/bubble.js";
import { Button } from "../../components/ui/button.js";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field.js";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../../components/ui/message-scroller.js";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "../../components/ui/message.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Textarea } from "../../components/ui/textarea.js";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/toggle-group.js";
import type { AgentConversationController } from "./conversation-controller.js";
import type { ConversationPerson } from "./conversation-surface.js";

const failureMessage = (failure: string) => {
  switch (failure) {
    case "not_configured": {
      return "The assistant is not configured yet. Your saved information is still available below.";
    }
    case "provider_unavailable": {
      return "The assistant is unavailable right now. Please try again later.";
    }
    case "invalid_output": {
      return "The assistant could not produce a usable answer. Nothing was saved from that response.";
    }
    case "context_limit": {
      return "This conversation has reached its limit. Start a new conversation to continue.";
    }
    case "outcome_unknown": {
      return "The last response may have finished. Refresh the conversation before sending another message.";
    }
    case "runtime_interrupted": {
      return "The response was interrupted. Refresh to see what was saved.";
    }
    default: {
      return "The assistant could not finish that response.";
    }
  }
};

const PersonSelector = ({
  people,
  selectedPersonId,
  onSelectPerson,
  onOpenPrivate,
}: {
  readonly people: readonly ConversationPerson[];
  readonly selectedPersonId: HouseholdPersonId | null;
  readonly onSelectPerson: (personId: HouseholdPersonId | null) => void;
  readonly onOpenPrivate?: (() => void) | undefined;
}) => {
  const selected = people.find((person) => person.id === selectedPersonId);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">Who are we talking about?</p>
      <ToggleGroup
        aria-label="Choose a person"
        className="flex w-full flex-wrap justify-start"
        value={selectedPersonId === null ? ["family"] : [selectedPersonId]}
        onValueChange={(values) => {
          if (values[0] === "family") {
            onSelectPerson(null);
            return;
          }
          const person = people.find((candidate) => candidate.id === values[0]);
          if (person !== undefined) {
            onSelectPerson(person.id);
          }
        }}
      >
        <ToggleGroupItem value="family" variant="outline">
          Family
        </ToggleGroupItem>
        {people.map((person) => (
          <ToggleGroupItem key={person.id} value={person.id} variant="outline">
            {person.displayName}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {selected?.kind === "dependant" && (
        <p className="text-muted-foreground text-sm">
          You’re answering for {selected.displayName}. Their profile shows who
          provided each fact.
        </p>
      )}
      {selected?.kind === "adult" && !selected.isCurrentAdult && (
        <p className="text-muted-foreground text-sm">
          {selected.displayName} can answer in their own private space. Shared
          information about them stays provisional until they confirm it.
        </p>
      )}
      {selected?.isCurrentAdult && (
        <p className="text-muted-foreground text-sm">
          Your own food conversation is private.{" "}
          <a
            className="underline"
            href="#private-food-conversations"
            onClick={onOpenPrivate}
          >
            Open your private sessions
          </a>{" "}
          to review what to share.
        </p>
      )}
    </div>
  );
};

const messageBubble = (role: "adult" | "assistant", text: string) => {
  const adult = role === "adult";
  return (
    <Message align={adult ? "end" : "start"}>
      <MessageContent>
        <MessageHeader>{adult ? "You" : "Meal Planner"}</MessageHeader>
        <Bubble
          variant={adult ? "default" : "muted"}
          align={adult ? "end" : "start"}
        >
          <BubbleContent>{text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
};

const ConversationHistory = ({
  conversation,
  blocks,
  renderBlock,
  localError,
  onRetry,
}: {
  readonly conversation: AgentConversationController;
  readonly blocks: readonly ConversationBlock[];
  readonly renderBlock: (block: ConversationBlock) => ReactNode;
  readonly localError: string | null;
  readonly onRetry: () => Promise<void>;
}) => {
  const lastTurn = conversation.view?.turns.at(-1);
  const pairedTurnIds = new Set(
    conversation.messages
      .filter(
        (message) => message.role === "assistant" && message.turnId !== null
      )
      .map((message) => message.turnId)
  );
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent>
            {conversation.messages.map((message) => (
              <Fragment key={message.id}>
                <MessageScrollerItem
                  messageId={message.id}
                  scrollAnchor={message.role === "adult"}
                >
                  {messageBubble(message.role, message.text)}
                </MessageScrollerItem>
                {message.role === "assistant" &&
                  message.turnId !== null &&
                  blocks
                    .filter((block) => block.turnId === message.turnId)
                    .map(renderBlock)}
              </Fragment>
            ))}
            {blocks
              .filter((block) => !pairedTurnIds.has(block.turnId))
              .map(renderBlock)}
            {lastTurn?.failure !== null && lastTurn?.failure !== undefined && (
              <MessageScrollerItem messageId={`turn-failure-${lastTurn.id}`}>
                <Alert>
                  <p>{failureMessage(lastTurn.failure)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={async () => {
                        await conversation.refresh();
                      }}
                    >
                      Refresh conversation
                    </Button>
                    <Button
                      render={<a href="#saved-food-facts" />}
                      variant="outline"
                    >
                      Review saved facts
                    </Button>
                  </div>
                </Alert>
              </MessageScrollerItem>
            )}
            {conversation.error !== null && (
              <MessageScrollerItem messageId="conversation-error">
                <Alert>
                  <p>{conversation.error}</p>
                </Alert>
              </MessageScrollerItem>
            )}
            {conversation.pendingAction !== null && (
              <MessageScrollerItem
                messageId={`pending-action-${conversation.pendingAction.actionId}`}
              >
                <Alert>
                  <p>
                    A reviewed action has an unknown outcome. Retry the same
                    action before reviewing another proposal.
                  </p>
                  <Button
                    disabled={conversation.actionState?._tag === "Pending"}
                    onClick={onRetry}
                  >
                    Retry saved action
                  </Button>
                </Alert>
              </MessageScrollerItem>
            )}
            {localError !== null && (
              <MessageScrollerItem messageId="local-error">
                <Alert>
                  <p>{localError}</p>
                </Alert>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
};

const composerPlaceholder = (
  selectedPerson: ConversationPerson | undefined
) => {
  if (selectedPerson !== undefined) {
    return `Tell us about ${selectedPerson.displayName}…`;
  }
  return "Tell us what you need help with…";
};

const ConversationComposer = ({
  selectedPerson,
  draft,
  onDraftChange,
  onSend,
  disabled,
  buttonLabel,
}: {
  readonly selectedPerson: ConversationPerson | undefined;
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSend: () => Promise<void>;
  readonly disabled: boolean;
  readonly buttonLabel: string;
}) => (
  <form
    className="border-border bg-background border-t p-4"
    onSubmit={(event) => {
      event.preventDefault();
      void onSend();
    }}
  >
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="food-conversation-message">
          Your message
        </FieldLabel>
        <Textarea
          id="food-conversation-message"
          maxLength={2000}
          value={draft}
          disabled={disabled}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={composerPlaceholder(selectedPerson)}
        />
      </Field>
      <Button
        className="self-end"
        disabled={disabled || draft.trim().length === 0}
        type="submit"
      >
        {buttonLabel}
      </Button>
    </FieldGroup>
  </form>
);

const FirstFoodInvitation = ({
  disabled,
  onStart,
}: {
  readonly disabled: boolean;
  readonly onStart: () => Promise<void>;
}) => (
  <div className="bg-accent grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(17rem,0.8fr)]">
    <div className="flex flex-col items-start justify-center p-6 md:p-8">
      <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
        First food question
      </p>
      <h2 className="font-display mt-3 text-3xl leading-tight md:text-4xl">
        Let’s find a first yes.
      </h2>
      <p className="text-muted-foreground mt-3 max-w-sm text-sm leading-6">
        We’ll ask about one familiar kind of food. You can say yes, no, or what
        might help.
      </p>
      <Button className="mt-5" disabled={disabled} onClick={onStart}>
        Ask our first food question
      </Button>
    </div>
    <img
      alt=""
      aria-hidden="true"
      className="h-52 w-full object-cover md:h-full"
      height={600}
      loading="lazy"
      src="/images/journey/pesto-pasta.avif"
      width={800}
    />
  </div>
);

const ReadyConversationPanel = ({
  conversation,
  selectedPerson,
  blocks,
  renderBlock,
  localError,
  draft,
  onDraftChange,
  onSend,
  onRetry,
  onStartFoodQuestions,
}: {
  readonly conversation: AgentConversationController;
  readonly selectedPerson: ConversationPerson | undefined;
  readonly blocks: readonly ConversationBlock[];
  readonly renderBlock: (block: ConversationBlock) => ReactNode;
  readonly localError: string | null;
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSend: () => Promise<void>;
  readonly onRetry: () => Promise<void>;
  readonly onStartFoodQuestions: () => Promise<void>;
}) => {
  const lastFailure = conversation.view?.turns.at(-1)?.failure;
  const unavailable = lastFailure === "not_configured";
  const hasHistory =
    conversation.messages.length > 0 ||
    blocks.length > 0 ||
    (lastFailure !== null && lastFailure !== undefined) ||
    conversation.error !== null ||
    conversation.pendingAction !== null ||
    localError !== null;
  const disabled =
    conversation.busy ||
    conversation.pendingAction !== null ||
    conversation.recoveryBlocked ||
    selectedPerson?.kind === "adult" ||
    unavailable;
  let buttonLabel = "Send message";
  if (unavailable) {
    buttonLabel = "Assistant unavailable";
  } else if (conversation.busy) {
    buttonLabel = "Working…";
  }
  return (
    <div className="border-border bg-card flex h-[min(36rem,65dvh)] min-h-[20rem] flex-col overflow-hidden rounded-3xl border">
      {hasHistory ? (
        <div className="min-h-0 flex-1">
          <ConversationHistory
            conversation={conversation}
            blocks={blocks}
            renderBlock={renderBlock}
            localError={localError}
            onRetry={onRetry}
          />
        </div>
      ) : (
        <FirstFoodInvitation
          disabled={disabled}
          onStart={onStartFoodQuestions}
        />
      )}
      <ConversationComposer
        selectedPerson={selectedPerson}
        draft={draft}
        onDraftChange={onDraftChange}
        onSend={onSend}
        disabled={disabled}
        buttonLabel={buttonLabel}
      />
    </div>
  );
};

export const ConversationPresentation = ({
  conversation,
  people,
  selectedPersonId,
  onSelectPerson,
  onOpenPrivate,
  blocks,
  renderBlock,
  localError,
  draft,
  onDraftChange,
  onSend,
  onRetry,
  onStartFoodQuestions,
}: {
  readonly conversation: AgentConversationController;
  readonly people: readonly ConversationPerson[];
  readonly selectedPersonId: HouseholdPersonId | null;
  readonly onSelectPerson?:
    | ((personId: HouseholdPersonId | null) => void)
    | undefined;
  readonly onOpenPrivate?: (() => void) | undefined;
  readonly blocks: readonly ConversationBlock[];
  readonly renderBlock: (block: ConversationBlock) => ReactNode;
  readonly localError: string | null;
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSend: () => Promise<void>;
  readonly onRetry: () => Promise<void>;
  readonly onStartFoodQuestions: () => Promise<void>;
}) => {
  const selectedPerson = people.find(
    (person) => person.id === selectedPersonId
  );
  return (
    <section
      aria-label="Food conversation"
      className="flex min-w-0 flex-col gap-6 [overflow-anchor:none]"
    >
      {people.length > 0 && onSelectPerson !== undefined && (
        <PersonSelector
          people={people}
          selectedPersonId={selectedPersonId}
          onSelectPerson={onSelectPerson}
          onOpenPrivate={onOpenPrivate}
        />
      )}
      {conversation.status === "loading" && (
        <div
          role="status"
          className="border-border bg-card flex h-[min(36rem,65dvh)] min-h-[20rem] flex-col overflow-hidden rounded-3xl border"
        >
          <div className="bg-accent flex min-h-0 flex-1 flex-col justify-center gap-2 p-4">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-10 w-4/5" />
          </div>
          <Skeleton className="h-20 w-full shrink-0 md:hidden" />
          <div className="border-border flex flex-col gap-3 border-t p-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-20 w-full" />
          </div>
          <span className="sr-only">Loading conversation…</span>
        </div>
      )}
      {conversation.status === "unavailable" && (
        <div className="border-border bg-card h-[min(36rem,65dvh)] min-h-[20rem] rounded-3xl border p-6">
          <Alert>
            <p>
              {conversation.error ?? "The conversation could not be loaded."}
            </p>
            <Button
              variant="outline"
              onClick={async () => {
                await conversation.refresh();
              }}
            >
              Try again
            </Button>
          </Alert>
        </div>
      )}
      {conversation.status === "ready" && (
        <ReadyConversationPanel
          conversation={conversation}
          selectedPerson={selectedPerson}
          blocks={blocks}
          renderBlock={renderBlock}
          localError={localError}
          draft={draft}
          onDraftChange={onDraftChange}
          onSend={onSend}
          onRetry={onRetry}
          onStartFoodQuestions={onStartFoodQuestions}
        />
      )}
    </section>
  );
};
