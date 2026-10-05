import {
  AgentConversationsApiClient,
  makeAgentConversationsApiClientLayer,
} from "@meal-planner/agent-conversations-api";
import type {
  AgentConversationsApiClient as AgentConversationsApiClientType,
  ConversationAction,
  ConversationScope,
} from "@meal-planner/agent-conversations-api";
import type { UserId } from "@meal-planner/household-api";
import { Effect } from "effect";

import { apiHttpLayer } from "../api-client/index.js";
import type { ApiRuntime } from "../api-client/index.js";

export const conversationKey = (accountId: UserId, scope: ConversationScope) =>
  [
    "agent-conversations",
    accountId,
    scope._tag,
    scope._tag === "FamilyShared" ? scope.familyId : "setup",
  ] as const;

const operation = <A, E>(
  runtime: ApiRuntime,
  accountId: UserId,
  run: (api: AgentConversationsApiClientType) => Effect.Effect<A, E>
) =>
  Effect.runPromise(
    AgentConversationsApiClient.use(run).pipe(
      Effect.provide(
        makeAgentConversationsApiClientLayer({
          baseUrl: runtime.baseUrl,
          headers: { "x-meal-planner-user": accountId },
        })
      ),
      Effect.provide(apiHttpLayer(runtime))
    )
  );

export const readConversation = (
  runtime: ApiRuntime,
  accountId: UserId,
  scope: ConversationScope
) =>
  operation(runtime, accountId, (api) =>
    scope._tag === "AccountPrivateSetup"
      ? api.agentConversations.setup()
      : api.agentConversations.family({ params: { familyId: scope.familyId } })
  );

export const submitConversationAction = (
  runtime: ApiRuntime,
  accountId: UserId,
  scope: ConversationScope,
  action: ConversationAction
) =>
  operation(runtime, accountId, (api) => {
    if (scope._tag === "AccountPrivateSetup") {
      return action.decision === "accept"
        ? api.agentConversations.setupAction({ payload: action })
        : api.agentConversations.setupAction({ payload: action });
    }
    return action.decision === "accept"
      ? api.agentConversations.familyAction({
          params: { familyId: scope.familyId },
          payload: action,
        })
      : api.agentConversations.familyAction({
          params: { familyId: scope.familyId },
          payload: action,
        });
  });

export const conversationChatEndpoint = (scope: ConversationScope) =>
  scope._tag === "AccountPrivateSetup"
    ? "/v1/agent-conversations/setup/chat"
    : `/v1/families/${encodeURIComponent(scope.familyId)}/agent-conversation/chat`;
