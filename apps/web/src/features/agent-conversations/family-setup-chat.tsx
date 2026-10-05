import type {
  ConversationChatMetadata,
  ReviewedRoster,
} from "@meal-planner/agent-conversations-api";
import { ArrowUpIcon } from "lucide-react";
import { createContext, use, useId, useState } from "react";
import type { ReactNode } from "react";

import { OperationError } from "../../components/operation-error.js";
import { Bubble, BubbleContent } from "../../components/ui/bubble.js";
import { Button } from "../../components/ui/button.js";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field.js";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "../../components/ui/input-group.js";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { useInteractionSound } from "../../hooks/use-interaction-sound.js";
import { cn } from "../../lib/utils.js";
import type { AgentConversationController } from "./conversation-controller.js";

export const currentSetupRoster = (conversation: AgentConversationController) =>
  conversation.view?.blocks.findLast(
    (block) => block._tag === "RosterProposal" && block.status !== "dismissed"
  ) ?? null;

interface SetupChatContext {
  readonly conversation: AgentConversationController;
  readonly draft: string;
  readonly error: string | null;
  readonly name: string;
  readonly setDraft: (text: string) => void;
  readonly send: () => Promise<void>;
}
const SetupChatContext = createContext<SetupChatContext | null>(null);
const useSetupChat = () => {
  const context = use(SetupChatContext);
  if (context === null) {
    throw new Error("Family setup chat parts require FamilySetupChat.");
  }
  return context;
};

export const FamilySetupChat = ({
  conversation,
  name,
  children,
}: {
  readonly conversation: AgentConversationController;
  readonly name: string;
  readonly children: ReactNode;
}) => {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const playSound = useInteractionSound();
  const send = async () => {
    const text = draft.trim();
    if (
      text.length === 0 ||
      conversation.busy ||
      conversation.recoveryBlocked
    ) {
      return;
    }
    setError(null);
    try {
      if (conversation.pendingAction === null) {
        const roster = currentSetupRoster(conversation);
        const displayedRoster: ConversationChatMetadata["displayedRoster"] =
          roster?._tag === "RosterProposal"
            ? { blockId: roster.id, revision: roster.revision }
            : null;
        void playSound();
        await conversation.submit(text, { displayedRoster });
      } else if (
        ["try again", "retry", "check again", "check save"].includes(
          text.toLocaleLowerCase()
        )
      ) {
        void playSound();
        await conversation.retryAction();
      } else {
        setError("Check the current save first. Send “try again” to continue.");
        return;
      }
      setDraft("");
    } catch {
      setError("Your message couldn’t be sent. Try again.");
    }
  };
  return (
    <SetupChatContext
      value={{ conversation, draft, error, name, send, setDraft }}
    >
      {children}
    </SetupChatContext>
  );
};

const setupFailure = (reason: string | null | undefined) => {
  switch (reason) {
    case "not_configured": {
      return "Chat isn’t available. You can add your family manually.";
    }
    case "outcome_unknown":
    case "runtime_interrupted": {
      return "The reply was interrupted. Check the conversation before sending again.";
    }
    case "provider_unavailable":
    case "invalid_output":
    case "context_limit": {
      return "The assistant couldn’t respond. Try sending your message again.";
    }
    default: {
      return null;
    }
  }
};

export const FamilySetupChatHistory = () => {
  const { conversation, error, name } = useSetupChat();
  const failure = conversation.view?.turns.at(-1)?.failure;
  const issue = error ?? conversation.error ?? setupFailure(failure);
  const unknown = conversation.actionState?._tag === "Unknown";
  let progress = "";
  if (conversation.busy) {
    progress =
      conversation.actionState?._tag === "Pending"
        ? "Saving your family…"
        : "Thinking…";
  }
  return (
    <section
      aria-label="Family conversation"
      className="flex min-h-0 min-w-0 flex-col gap-3"
    >
      <div
        className={cn(
          "min-h-0",
          conversation.messages.length === 0 ? "h-20" : "h-44 sm:h-52 lg:h-56"
        )}
      >
        <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
          <MessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent>
                {conversation.status === "loading" && (
                  <MessageScrollerItem messageId="loading">
                    <Skeleton className="h-5 w-3/4" />
                  </MessageScrollerItem>
                )}
                {conversation.status === "ready" &&
                  conversation.messages.length === 0 && (
                    <MessageScrollerItem messageId="welcome">
                      <Message>
                        <MessageContent>
                          <Bubble variant="ghost">
                            <BubbleContent size="comfortable">
                              You’re here, {name}. Who’s joining you?
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  )}
                {conversation.messages
                  .filter((message) => message.text.trim().length > 0)
                  .map((message) => {
                    const question =
                      message.role === "assistant"
                        ? conversation.view?.blocks.find(
                            (block) =>
                              block._tag === "Question" &&
                              block.foodTopic === null &&
                              block.turnId === message.turnId
                          )
                        : undefined;
                    const text =
                      question?._tag === "Question"
                        ? question.prompt
                        : message.text;
                    return (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        scrollAnchor={message.role === "adult"}
                      >
                        <Message>
                          <MessageContent>
                            <MessageHeader
                              className={
                                message.role === "assistant"
                                  ? "sr-only"
                                  : undefined
                              }
                            >
                              {message.role === "adult"
                                ? "You"
                                : "Meal Planner"}
                            </MessageHeader>
                            <Bubble variant="ghost">
                              <BubbleContent size="comfortable">
                                {text}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    );
                  })}
                <MessageScrollerItem messageId="working">
                  <p role="status" className="text-muted-foreground text-sm">
                    {progress}
                  </p>
                </MessageScrollerItem>
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <Tooltip>
              <TooltipTrigger render={<MessageScrollerButton />} />
              <TooltipContent>Scroll to latest message</TooltipContent>
            </Tooltip>
          </MessageScroller>
        </MessageScrollerProvider>
      </div>
      {issue && <OperationError>{issue}</OperationError>}
      {unknown && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground text-sm">
            The save needs checking. Send “try again”.
          </p>
          <Button
            variant="link"
            onClick={() => {
              void conversation.retryAction();
            }}
          >
            Check save
          </Button>
        </div>
      )}
      {(failure === "runtime_interrupted" || failure === "outcome_unknown") && (
        <Button
          variant="link"
          onClick={() => {
            void conversation.refresh();
          }}
        >
          Check reply
        </Button>
      )}
    </section>
  );
};

export const FamilySetupChatComposer = () => {
  const { conversation, draft, send, setDraft } = useSetupChat();
  const id = useId();
  const roster = currentSetupRoster(conversation);
  const needsAgreement =
    roster?.status === "proposed" &&
    conversation.pendingAction === null &&
    !conversation.view?.turns.at(-1)?.setupConfirmation;
  const disabled =
    conversation.busy ||
    conversation.recoveryBlocked ||
    conversation.status !== "ready" ||
    conversation.view?.turns.at(-1)?.failure === "not_configured";
  return (
    <form
      className="pb-safe-bottom w-full"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={id}>Your message</FieldLabel>
          <InputGroup>
            <InputGroupTextarea
              id={id}
              aria-describedby={needsAgreement ? `${id}-agreement` : undefined}
              name="family-message"
              rows={1}
              maxLength={2000}
              className="field-sizing-content max-h-36 min-h-14"
              placeholder={
                conversation.pendingAction === null
                  ? "Tell me what to add or change…"
                  : "Type “try again” to check the save…"
              }
              value={draft}
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <InputGroupAddon align="inline-end">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon"
                      type="submit"
                      aria-label="Send message"
                      disabled={disabled || draft.trim().length === 0}
                    />
                  }
                >
                  <ArrowUpIcon />
                </TooltipTrigger>
                <TooltipContent>Send message</TooltipContent>
              </Tooltip>
            </InputGroupAddon>
          </InputGroup>
          {needsAgreement && (
            <FieldDescription id={`${id}-agreement`}>
              Reply yes to save your family and explore their tastes.
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>
    </form>
  );
};

export const setupRosterValue = (
  conversation: AgentConversationController
): ReviewedRoster | null => {
  const roster = currentSetupRoster(conversation);
  return roster?._tag === "RosterProposal"
    ? {
        creatorName: roster.creatorName,
        familyName: roster.familyName,
        people: roster.people,
      }
    : null;
};
