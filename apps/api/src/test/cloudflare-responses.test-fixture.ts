const event = (type: string, payload: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;

/** A provider-free Responses stream carrying one completed function call. */
export const responsesToolSse = (argumentsJson: string): string => {
  const item = {
    arguments: argumentsJson,
    call_id: "call_local_review",
    id: "fc_local_review",
    name: "submitConversationTurn",
    status: "completed",
    type: "function_call",
  };
  return [
    event("response.output_item.added", {
      item: { ...item, arguments: "", status: "in_progress" },
      output_index: 0,
    }),
    event("response.function_call_arguments.delta", {
      delta: argumentsJson,
      item_id: item.id,
      output_index: 0,
    }),
    event("response.function_call_arguments.done", {
      arguments: argumentsJson,
      item_id: item.id,
      output_index: 0,
    }),
    event("response.output_item.done", { item, output_index: 0 }),
    event("response.completed", {
      response: {
        created_at: 0,
        error: null,
        id: "resp_local_review",
        incomplete_details: null,
        model: "openai/gpt-6-luna",
        object: "response",
        output: [item],
        parallel_tool_calls: false,
        status: "completed",
        usage: null,
      },
    }),
    "data: [DONE]\n\n",
  ].join("");
};
