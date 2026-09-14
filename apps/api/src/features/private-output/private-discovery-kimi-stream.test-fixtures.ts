import { emptyPrivateDiscoveryContinuityUpdates } from "./private-discovery-continuity.js";

interface SyntheticKimiUsage {
  readonly completion_tokens: number;
  readonly prompt_tokens: number;
  readonly [key: string]: unknown;
}

export const kimiChunk = (
  choices: readonly unknown[],
  usage?: SyntheticKimiUsage | null
) => {
  const chunk = {
    choices,
    id: "synthetic-completion",
    model: "kimi-k2.6",
    object: "chat.completion.chunk",
  };
  return usage === undefined ? chunk : { ...chunk, usage };
};

export const kimiEvent = (value: ReturnType<typeof kimiChunk>) =>
  `data: ${JSON.stringify(value)}\n\n`;

export const kimiChoice = (
  delta: Readonly<Record<string, unknown>>,
  finishReason: string | null = null
) => ({ delta, finish_reason: finishReason, index: 0 });

export const encodeKimiCompletion = (completion: {
  readonly choices: readonly {
    readonly finish_reason: string;
    readonly message: {
      readonly tool_calls?: readonly Record<string, unknown>[];
      readonly [key: string]: unknown;
    };
  }[];
  readonly usage?: SyntheticKimiUsage | null;
}) => {
  const deltas = completion.choices.map((choice, index) => {
    const delta = { ...choice.message };
    if (choice.message.tool_calls !== undefined) {
      delta.tool_calls = choice.message.tool_calls.map((tool, toolIndex) => ({
        ...tool,
        index: toolIndex,
      }));
    }
    return { delta, finish_reason: null, index };
  });
  const events = [
    kimiEvent(kimiChunk(deltas)),
    kimiEvent(
      kimiChunk(
        completion.choices.map((choice, index) => ({
          delta: {},
          finish_reason: choice.finish_reason,
          index,
        }))
      )
    ),
  ];
  if (completion.usage !== undefined) {
    events.push(kimiEvent(kimiChunk([], completion.usage)));
  }
  events.push("data: [DONE]\n\n");
  return events.join("");
};

export const kimiBudgetArguments = JSON.stringify({
  intent: {
    _tag: "Continue",
    proposals: [],
    updates: emptyPrivateDiscoveryContinuityUpdates(),
  },
});
export const kimiBudgetTool = {
  function: { arguments: kimiBudgetArguments, name: "submitDiscoveryTurn" },
  id: "budget-call",
  index: 0,
  type: "function",
};
export const kimiBudgetOpening = kimiEvent(
  kimiChunk([kimiChoice({ role: "assistant", tool_calls: [kimiBudgetTool] })])
);
export const kimiBudgetEnding = [
  kimiEvent(kimiChunk([kimiChoice({}, "tool_calls")])),
  kimiEvent(kimiChunk([], { completion_tokens: 50, prompt_tokens: 100 })),
  "data: [DONE]\n\n",
].join("");
