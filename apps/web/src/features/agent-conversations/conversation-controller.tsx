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
  ConversationChatMetadata,
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
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createActor } from "xstate";

import { useApiRuntime } from "../api-client/index.js";
import { invalidatePlanningContent } from "../food-book/index.js";
import { invalidateHouseholdProfiles } from "../household-profiles/index.js";
import {
  createConversationActionMachine,
  dispatchConversationAction,
  sessionConversationActions,
} from "./conversation-action-machine.js";
import type {
  ConversationActionActor,
  ConversationActionDispatch,
} from "./conversation-action-machine.js";
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
  readonly displayedRoster?: ConversationChatMetadata["displayedRoster"];
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
  readonly confirmSetup: () => Promise<ConversationActionState | null>;
  readonly refresh: () => Promise<void>;
}

/** React action callbacks translate explicit dispatch outcomes for their existing error UI. */
export class ConversationActionDispatchError extends Error {
  readonly _tag = "ConversationActionDispatchError";
  readonly reason: Exclude<ConversationActionDispatch["_tag"], "Settled">;

  constructor(reason: Exclude<ConversationActionDispatch["_tag"], "Settled">) {
    super(
      reason === "Cancelled"
        ? "The action was interrupted."
        : "Resolve the saved action before making another change."
    );
    this.name = "ConversationActionDispatchError";
    this.reason = reason;
  }
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
  readonly refreshing: boolean;
}

const ReadyConversation = ({
  accountId,
  children,
  scope,
  view,
  refreshing,
}: ReadyProps) => {
  const runtime = useApiRuntime();
  const queryClient = useQueryClient();
  const key = useMemo(
    () => conversationKey(accountId, scope),
    [accountId, scope]
  );
  const storageKey = actionStorageKey(accountId, scope);
  const [actionActor, setActionActor] =
    useState<ConversationActionActor | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [localTurn, setLocalTurn] = useState<{
    readonly version: number;
    readonly fromMessage: number;
  } | null>(null);

  useEffect(() => {
    const actor = createActor(
      createConversationActionMachine(
        sessionConversationActions(
          storageKey,
          () => globalThis.sessionStorage,
          (action) =>
            submitConversationAction(runtime, accountId, scope, action)
        )
      )
    ).start();
    setActionActor(actor);
    return () => {
      actor.stop();
    };
  }, [accountId, runtime, scope, storageKey]);

  const subscribe = useCallback(
    (notify: () => void) => {
      const subscription = actionActor?.subscribe(notify);
      return () => subscription?.unsubscribe();
    },
    [actionActor]
  );
  const getSnapshot = useCallback(
    () => actionActor?.getSnapshot() ?? null,
    [actionActor]
  );
  const actionSnapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => null
  );
  const pendingAction = actionSnapshot?.context.request ?? null;
  const actionState = actionSnapshot?.context.result ?? null;
  const recoveryBlocked = actionSnapshot?.matches("blocked") ?? false;
  const recoveryReady =
    actionSnapshot !== null && !actionSnapshot.matches("reading");

  useEffect(() => {
    actionActor?.send({ receipts: view.actions, type: "RECEIPTS" });
  }, [actionActor, view.actions]);

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
    async (
      action: ConversationAction,
      retry = false
    ): Promise<ConversationActionDispatch> => {
      if (actionActor === null) {
        return { _tag: "NotAdmitted" };
      }
      setActionError(null);
      const outcome = await dispatchConversationAction(
        actionActor,
        action,
        retry
      );
      if (outcome._tag !== "Settled") {
        return outcome;
      }
      const { state: result } = outcome;
      if (result._tag === "Committed" || result._tag === "Rejected") {
        try {
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
        } catch {
          setActionError(
            "The action is confirmed. Refresh the conversation to load the latest view."
          );
        }
      }
      return outcome;
    },
    [accountId, actionActor, queryClient, refresh, scope, view.blocks]
  );

  const act = useCallback(
    async (
      block: ConversationBlock,
      decision: "accept" | "dismiss",
      reviewedRoster?: ReviewedRoster | null,
      safetyConfirmation?: "I confirm this safety constraint change" | null
    ): Promise<ConversationActionState> => {
      if (recoveryBlocked) {
        throw new ConversationActionDispatchError("Blocked");
      }
      if (
        !recoveryReady ||
        pendingAction !== null ||
        block.status !== "proposed"
      ) {
        throw new ConversationActionDispatchError("NotAdmitted");
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
      const outcome = await dispatchAction(action);
      if (outcome._tag === "Settled") {
        return outcome.state;
      }
      throw new ConversationActionDispatchError(outcome._tag);
    },
    [dispatchAction, pendingAction, recoveryBlocked, recoveryReady]
  );

  const confirmSetup =
    useCallback(async (): Promise<ConversationActionState | null> => {
      const turn = view.turns.at(-1);
      const confirmation =
        turn?.status === "succeeded" ? turn.setupConfirmation : null;
      if (
        scope._tag !== "AccountPrivateSetup" ||
        !confirmation ||
        !recoveryReady ||
        recoveryBlocked
      ) {
        return null;
      }
      const recorded = view.actions.find(
        (entry) => entry.action.actionId === confirmation.actionId
      );
      if (
        recorded?.state._tag === "Committed" ||
        recorded?.state._tag === "Rejected"
      ) {
        return recorded.state;
      }
      // Unknown actions need an explicit retry, including after a reload.
      if (pendingAction !== null) {
        return null;
      }
      const block = view.blocks.find(
        (candidate) => candidate.id === confirmation.blockId
      );
      if (
        block?._tag !== "RosterProposal" ||
        block.revision !== confirmation.revision ||
        block.status !== "proposed"
      ) {
        setActionError(
          "The table changed. Check the current family before confirming again."
        );
        return null;
      }
      const action = Schema.decodeUnknownSync(ConversationAction)({
        actionId: confirmation.actionId,
        blockId: block.id,
        decision: "accept",
        expectedRevision: block.revision,
        reviewedRoster: {
          creatorName: block.creatorName,
          familyName: block.familyName,
          people: block.people,
        },
        safetyConfirmation: null,
      });
      const outcome = await dispatchAction(action);
      switch (outcome._tag) {
        case "Settled": {
          return outcome.state;
        }
        case "NotAdmitted":
        case "Blocked":
        case "Cancelled": {
          // Another dispatch, a visible storage block, or navigation needs no automatic retry.
          return null;
        }
        default: {
          return outcome satisfies never;
        }
      }
    }, [
      dispatchAction,
      pendingAction,
      recoveryBlocked,
      recoveryReady,
      scope,
      view.actions,
      view.blocks,
      view.turns,
    ]);

  const retryAction = useCallback(async () => {
    if (pendingAction === null) {
      return null;
    }
    if (actionState?._tag === "Committed" || actionState?._tag === "Rejected") {
      await refresh();
      return actionState;
    }
    const outcome = await dispatchAction(pendingAction, true);
    switch (outcome._tag) {
      case "Settled": {
        return outcome.state;
      }
      case "NotAdmitted":
      case "Blocked":
      case "Cancelled": {
        // Keep the saved request; the machine already owns any storage error.
        return null;
      }
      default: {
        return outcome satisfies never;
      }
    }
  }, [actionState, dispatchAction, pendingAction, refresh]);

  const submit = useCallback(
    async (text: string, context: ConversationSubmitContext = {}) => {
      const trimmed = text.trim();
      if (
        !recoveryReady ||
        recoveryBlocked ||
        pendingAction !== null ||
        refreshing ||
        chat.isLoading ||
        chat.sessionGenerating
      ) {
        throw new Error("Wait for the conversation or saved action to finish.");
      }
      if (trimmed.length < 1 || trimmed.length > 2000) {
        throw new Error("Write between 1 and 2,000 characters.");
      }
      setActionError(null);
      actionActor?.send({ type: "CLEAR_ERROR" });
      setLocalTurn({
        fromMessage: chat.messages.length,
        version: view.version,
      });
      await chat.sendMessage(trimmed, {
        body: {
          answerToBlockId: context.answerToBlockId ?? null,
          displayedRoster: context.displayedRoster ?? null,
          expectedVersion: view.version,
          focusPersonId: context.focusPersonId ?? null,
          foodAnswer: context.foodAnswer ?? null,
          planId: context.planId ?? null,
        },
        whenBusy: "drop",
      });
    },
    [
      actionActor,
      chat,
      pendingAction,
      recoveryBlocked,
      recoveryReady,
      refreshing,
      view.version,
    ]
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
      refreshing ||
      actionSnapshot?.hasTag("busy") === true ||
      chat.isLoading ||
      chat.sessionGenerating,
    confirmSetup,
    error:
      actionSnapshot?.context.error ??
      actionError ??
      (chat.error
        ? "The assistant could not respond. Your conversation is still here."
        : null),
    messages,
    pendingAction,
    recoveryBlocked,
    refresh,
    retryAction,
    status: recoveryReady ? "ready" : "loading",
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
  const familyId = scope._tag === "FamilyShared" ? scope.familyId : null;
  const stableScope = useMemo<ConversationScope>(
    () =>
      familyId === null
        ? { _tag: "AccountPrivateSetup" }
        : { _tag: "FamilyShared", familyId },
    [familyId]
  );
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
        key={`${accountId}:${query.data.id}`}
        scope={stableScope}
        view={query.data}
        refreshing={query.isFetching}
      >
        {children}
      </ReadyConversation>
    );
  }
  const controller: AgentConversationController = {
    act: unavailable,
    actionState: null,
    busy: !query.isError,
    confirmSetup: unavailable,
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
