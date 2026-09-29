import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { AgentProvider } from "../../infrastructure/agent-provider.js";
import type { AgentConversation } from "./conversation-session.js";

/** Native Agent, explicit provider config, and the existing Workers AI capability. */
export const agentConversationBindings = Effect.gen(
  function* agentConversationBindings() {
    const provider = yield* AgentProvider;
    return {
      AGENT_CONVERSATION_CONFIG: provider.conversationConfig,
      AgentConversation:
        Cloudflare.DurableObject<AgentConversation>("AgentConversation"),
      CLOUDFLARE_ACCOUNT_ID: provider.accountId,
      CLOUDFLARE_API_TOKEN: provider.apiToken,
      ConversationAI: Cloudflare.Workers.AI(),
    };
  }
);

export type AgentConversationPort = Pick<
  AgentConversation,
  | "initialize"
  | "read"
  | "fetch"
  | "beginAction"
  | "advanceAction"
  | "markActionUnknown"
  | "rejectAction"
  | "actionState"
>;

export interface AgentConversationNamespacePort {
  readonly getByName: (name: string) => AgentConversationPort;
}

/** Read the native DO binding only at the Worker composition seam. */
export const agentConversationNamespacePort = Effect.gen(
  function* agentConversationNamespacePort() {
    const environment = yield* Cloudflare.Workers.WorkerEnvironment;
    const namespace: AgentConversationNamespacePort =
      environment["AgentConversation"];
    return namespace;
  }
);
