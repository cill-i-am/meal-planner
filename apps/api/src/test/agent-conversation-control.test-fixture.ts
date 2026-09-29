import type * as NativeCloudflare from "@cloudflare/workers-types";
import type { CloudflareBindingConfig } from "@tanstack/ai-cloudflare";
import { Schema } from "effect";

import { AgentConversation as ProductionAgentConversation } from "../features/agent-conversations/conversation-session.js";

const unexpectedBindingMethod = (): never => {
  throw new Error(
    "Unexpected Workers AI binding method in conversation fixture"
  );
};
const SyntheticConversationRequest = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({ content: Schema.String, role: Schema.String })
  ),
  tool_choice: Schema.Struct({
    function: Schema.Struct({ name: Schema.Literal("submitConversationTurn") }),
    type: Schema.Literal("function"),
  }),
});
type SyntheticConversationRequest = typeof SyntheticConversationRequest.Type;

/** Replaces only provider transport; production Agent storage and guards stay native. */
export class AgentConversation extends ProductionAgentConversation {
  #loseAdvanceStep: number | null = null;

  /** Test-only fault after the durable receipt is saved, before the caller sees it. */
  armLostAdvance(step: number): void {
    this.#loseAdvanceStep = step;
  }

  override advanceAction(
    input: Parameters<ProductionAgentConversation["advanceAction"]>[0]
  ) {
    const result = super.advanceAction(input);
    if (this.#loseAdvanceStep === input.completedStep) {
      this.#loseAdvanceStep = null;
      throw new Error("Synthetic lost conversation advance response");
    }
    return result;
  }

  constructor(
    context: NativeCloudflare.DurableObjectState,
    environment: ConstructorParameters<typeof ProductionAgentConversation>[1]
  ) {
    super(context, {
      ...environment,
      ConversationAI: {
        aiGatewayLogId: null,
        aiSearch: unexpectedBindingMethod,
        autorag: unexpectedBindingMethod,
        gateway: unexpectedBindingMethod,
        models: unexpectedBindingMethod,
        run: ((model: string, body: SyntheticConversationRequest) => {
          const request = Schema.decodeUnknownSync(
            SyntheticConversationRequest
          )(body);
          return fetch("https://conversation-model.test/run", {
            body: JSON.stringify({ body: request, model }),
            method: "POST",
          });
        }) as CloudflareBindingConfig["binding"]["run"],
        toMarkdown: unexpectedBindingMethod,
      },
    });
  }
}
