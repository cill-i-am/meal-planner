import { ConversationAction } from "@meal-planner/agent-conversations-api";
import type {
  ConversationBlock,
  ConversationBlockId,
  ConversationScope,
  ConversationTurnId,
  ConversationView,
  FoodAnswer,
  ReviewedRoster,
  ConversationActionState,
} from "@meal-planner/agent-conversations-api";
import type {
  HouseholdPersonId,
  MealPlanId,
  UserId,
} from "@meal-planner/household-api";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { useApiRuntime } from "../api-client/index.js";
import { invalidatePlanningContent } from "../food-book/index.js";
import { invalidateHouseholdProfiles } from "../household-profiles/index.js";
import {
  conversationChatEndpoint,
  conversationKey,
  readConversation,
  submitConversationAction,
} from "./conversation-operations.js";

export interface ConversationDisplayMessage {
  readonly id: string;
  readonly role: "adult" | "assistant";
  readonly text: string;
  readonly turnId: ConversationTurnId | null;
}

export interface ConversationSubmitContext {
  readonly focusPersonId?: HouseholdPersonId | null;
  readonly planId?: MealPlanId | null;
  readonly answerToBlockId?: ConversationBlockId | null;
  readonly foodAnswer?: FoodAnswer | null;
}

export interface AgentConversationController {
  readonly view: ConversationView | null;
  readonly status: "loading" | "ready" | "unavailable";
  readonly error: string | null;
  readonly messages: readonly ConversationDisplayMessage[];
  readonly busy: boolean;
  readonly actionState: ConversationActionState | null;
  readonly pendingAction: ConversationAction | null;
  readonly recoveryBlocked: boolean;
  readonly submit: (
    text: string,
    context?: ConversationSubmitContext
  ) => Promise<void>;
  readonly act: (
    block: ConversationBlock,
    decision: "accept" | "dismiss",
    reviewedRoster?: ReviewedRoster | null,
    safetyConfirmation?: "I confirm this safety constraint change" | null
  ) => Promise<ConversationActionState>;
  readonly retryAction: () => Promise<ConversationActionState | null>;
  readonly refresh: () => Promise<void>;
}

const AgentConversationContext =
  createContext<AgentConversationController | null>(null);

const unavailable = (): never => {
  throw new Error("The conversation is not ready.");
};

export const useAgentConversation = (): AgentConversationController => {
  const conversation = use(AgentConversationContext);
  if (conversation === null) {
    throw new Error("An AgentConversationProvider is required.");
  }
  return conversation;
};

const actionStorageKey = (accountId: UserId, scope: ConversationScope) =>
  `meal-planner:conversation-action:${accountId}:${scope._tag}:${scope._tag === "FamilyShared" ? scope.familyId : "setup"}`;

const readSavedAction = (key: string): ConversationAction | null => {
  const raw = globalThis.sessionStorage.getItem(key);
  if (raw === null) {
    return null;
  }
  try {
    return Schema.decodeUnknownSync(ConversationAction)(JSON.parse(raw));
  } catch {
    // An unreadable request could have succeeded. Do not overwrite it.
    throw new Error(
      "A saved conversation action cannot be read. Review the conversation before making another change."
    );
  }
};

const getMessages = (view: ConversationView): ConversationDisplayMessage[] =>
  view.messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    turnId: message.turnId,
  }));

interface ReadyProps {
  readonly accountId: UserId;
  readonly children: ReactNode;
  readonly scope: ConversationScope;
  readonly view: ConversationView;
}

const ReadyConversation = ({
  accountId,
  children,
  scope,
  view,
}: ReadyProps) => {
  const runtime = useApiRuntime();
  const queryClient = useQueryClient();
  const key = useMemo(
    () => conversationKey(accountId, scope),
    [accountId, scope]
  );
  const storageKey = actionStorageKey(accountId, scope);
  const [pendingAction, setPendingAction] = useState<ConversationAction | null>(
    null
  );
  const [actionState, setActionState] =
    useState<ConversationActionState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [localTurn, setLocalTurn] = useState<{
    readonly version: number;
    readonly fromMessage: number;
  } | null>(null);

  useEffect(() => {
    try {
      const saved = readSavedAction(storageKey);
      if (saved !== null) {
        const recorded = view.actions.find(
          (entry) => entry.state.actionId === saved.actionId
        );
        if (
          recorded?.state._tag === "Committed" ||
          recorded?.state._tag === "Rejected"
        ) {
          globalThis.sessionStorage.removeItem(storageKey);
          setActionState(recorded.state);
        } else {
          setPendingAction(saved);
          setActionState(
            recorded?.state ?? {
              _tag: "Unknown",
              actionId: saved.actionId,
              familyId: null,
            }
          );
        }
      }
    } catch (error) {
      setRecoveryBlocked(true);
      setActionError(
        error instanceof Error ? error.message : "Saved action unavailable."
      );
    }
  }, [storageKey, view.actions]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: key });
  }, [key, queryClient]);

  const connection = useMemo(
    () =>
      fetchServerSentEvents(conversationChatEndpoint(scope), {
        credentials: "same-origin",
        fetchClient: (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set("x-meal-planner-user", accountId);
          return runtime.fetch(input, { ...init, headers });
        },
      }),
    [accountId, runtime, scope]
  );

  const chat = useChat({
    connection,
    onError: async () => {
      await refresh();
    },
    onFinish: async () => {
      await refresh();
    },
    persistence: false,
    queue: "drop",
    threadId: view.id,
  });

  const dispatchAction = useCallback(
    async (action: ConversationAction): Promise<ConversationActionState> => {
      setActionError(null);
      setActionState({ _tag: "Pending", actionId: action.actionId });
      try {
        const result = await submitConversationAction(
          runtime,
          accountId,
          scope,
          action
        );
        setActionState(result);
        if (result._tag === "Committed" || result._tag === "Rejected") {
          globalThis.sessionStorage.removeItem(storageKey);
          setPendingAction(null);
          await refresh();
          if (result._tag === "Committed" && scope._tag === "FamilyShared") {
            const committedBlock = view.blocks.find(
              (block) => block.id === action.blockId
            );
            if (committedBlock?._tag === "PersonFactProposal") {
              await invalidateHouseholdProfiles(queryClient, scope.familyId);
            }
            if (
              committedBlock?._tag === "RoutineProposal" ||
              committedBlock?._tag === "PlanningContentProposal"
            ) {
              await invalidatePlanningContent(queryClient, {
                organizationId: scope.familyId,
                userId: accountId,
              });
            }
          }
        }
        return result;
      } catch {
        const unknown: ConversationActionState = {
          _tag: "Unknown",
          actionId: action.actionId,
          familyId: null,
        };
        setActionState(unknown);
        setActionError(
          "The action may have saved. Retry the exact saved action before making another change."
        );
        return unknown;
      }
    },
    [accountId, queryClient, refresh, runtime, scope, storageKey, view.blocks]
  );

  const act = useCallback(
    (
      block: ConversationBlock,
      decision: "accept" | "dismiss",
      reviewedRoster?: ReviewedRoster | null,
      safetyConfirmation?: "I confirm this safety constraint change" | null
    ): Promise<ConversationActionState> => {
      if (
        recoveryBlocked ||
        pendingAction !== null ||
        block.status !== "proposed"
      ) {
        throw new Error(
          "Resolve the saved action before making another change."
        );
      }
      if (
        decision === "accept" &&
        block._tag === "RosterProposal" &&
        !reviewedRoster
      ) {
        throw new Error("Review the family draft before saving it.");
      }
      if (
        decision === "accept" &&
        block._tag === "PersonFactProposal" &&
        block.requiresSafetyConfirmation &&
        safetyConfirmation !== "I confirm this safety constraint change"
      ) {
        throw new Error(
          "Confirm the safety change separately before saving it."
        );
      }
      const action = Schema.decodeUnknownSync(ConversationAction)(
        decision === "accept"
          ? {
              actionId: crypto.randomUUID(),
              blockId: block.id,
              decision,
              expectedRevision: block.revision,
              reviewedRoster: reviewedRoster ?? null,
              safetyConfirmation: safetyConfirmation ?? null,
            }
          : {
              actionId: crypto.randomUUID(),
              blockId: block.id,
              decision,
              expectedRevision: block.revision,
            }
      );
      try {
        globalThis.sessionStorage.setItem(storageKey, JSON.stringify(action));
      } catch {
        const message =
          "This browser cannot safely retain the action. Enable session storage before confirming.";
        setActionError(message);
        throw new Error(message);
      }
      setPendingAction(action);
      return dispatchAction(action);
    },
    [dispatchAction, pendingAction, recoveryBlocked, storageKey]
  );

  const retryAction = useCallback(() => {
    if (pendingAction === null) {
      return Promise.resolve(null);
    }
    return dispatchAction(pendingAction);
  }, [dispatchAction, pendingAction]);

  const submit = useCallback(
    async (text: string, context: ConversationSubmitContext = {}) => {
      const trimmed = text.trim();
      if (
        recoveryBlocked ||
        pendingAction !== null ||
        chat.isLoading ||
        chat.sessionGenerating
      ) {
        throw new Error("Wait for the conversation or saved action to finish.");
      }
      if (trimmed.length < 1 || trimmed.length > 2000) {
        throw new Error("Write between 1 and 2,000 characters.");
      }
      setLocalTurn({
        fromMessage: chat.messages.length,
        version: view.version,
      });
      await chat.sendMessage(trimmed, {
        body: {
          answerToBlockId: context.answerToBlockId ?? null,
          expectedVersion: view.version,
          focusPersonId: context.focusPersonId ?? null,
          foodAnswer: context.foodAnswer ?? null,
          planId: context.planId ?? null,
        },
        whenBusy: "drop",
      });
    },
    [chat, pendingAction, recoveryBlocked, view.version]
  );

  const messages: ConversationDisplayMessage[] = [
    ...getMessages(view),
    ...(localTurn !== null && view.version <= localTurn.version
      ? chat.messages
          .slice(localTurn.fromMessage)
          .filter(
            (message) => message.role === "user" || message.role === "assistant"
          )
          .map((message) => ({
            id: message.id,
            role:
              message.role === "user"
                ? ("adult" as const)
                : ("assistant" as const),
            text: message.parts
              .filter((part) => part.type === "text")
              .map((part) => part.content)
              .join(""),
            turnId: null,
          }))
      : []),
  ];

  const controller: AgentConversationController = {
    act,
    actionState,
    busy:
      actionState?._tag === "Pending" ||
      chat.isLoading ||
      chat.sessionGenerating,
    error:
      actionError ??
      (chat.error
        ? "The assistant could not respond. Your conversation is still here."
        : null),
    messages,
    pendingAction,
    recoveryBlocked,
    refresh,
    retryAction,
    status: "ready",
    submit,
    view,
  };

  return (
    <AgentConversationContext.Provider value={controller}>
      {children}
    </AgentConversationContext.Provider>
  );
};

export const AgentConversationProvider = ({
  accountId,
  children,
  scope,
}: {
  readonly accountId: UserId;
  readonly children: ReactNode;
  readonly scope: ConversationScope;
}) => {
  const runtime = useApiRuntime();
  const query = useQuery({
    queryFn: () => readConversation(runtime, accountId, scope),
    queryKey: conversationKey(accountId, scope),
    retry: false,
    staleTime: 15_000,
  });
  if (query.data !== undefined) {
    return (
      <ReadyConversation
        accountId={accountId}
        key={query.data.id}
        scope={scope}
        view={query.data}
      >
        {children}
      </ReadyConversation>
    );
  }
  const controller: AgentConversationController = {
    act: unavailable,
    actionState: null,
    busy: true,
    error: query.isError ? "The conversation could not be loaded." : null,
    messages: [],
    pendingAction: null,
    recoveryBlocked: false,
    refresh: async () => {
      await query.refetch();
    },
    retryAction: unavailable,
    status: query.isError ? "unavailable" : "loading",
    submit: unavailable,
    view: null,
  };
  return (
    <AgentConversationContext.Provider value={controller}>
      {children}
    </AgentConversationContext.Provider>
  );
};
