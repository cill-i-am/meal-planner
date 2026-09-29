import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect } from "effect";

import type { AgentConversation } from "./conversation-session.js";

/** Native Agent, explicit provider config, and the existing Workers AI capability. */
export const agentConversationBindings = {
  AGENT_CONVERSATION_CONFIG: Config.string(
    "MEAL_PLANNER_AGENT_CONVERSATION_CONFIG"
  ).pipe(Config.withDefault("")),
  AgentConversation:
    Cloudflare.DurableObject<AgentConversation>("AgentConversation"),
  ConversationAI: Cloudflare.Workers.AI(),
};

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
