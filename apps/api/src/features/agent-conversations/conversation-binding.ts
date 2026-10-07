import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { AgentProvider } from "../../infrastructure/agent-provider.js";
import type { AgentConversation } from "./conversation-session.js";

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
