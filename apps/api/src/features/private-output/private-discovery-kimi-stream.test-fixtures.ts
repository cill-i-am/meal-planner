import { emptyPrivateDiscoveryContinuityUpdates } from "./private-discovery-continuity.js";
import { PRIVATE_DISCOVERY_KIMI_STREAM_LIMITS as limits } from "./private-discovery-kimi-stream-contract.js";

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

// Generate the admitted maxima on demand; never construct the complete wire body.
export const maximalKimiStream = function* maximalKimiStream() {
  const encoder = new TextEncoder();
  let wireBytes = 0;
  const encode = (text: string) => {
    const bytes = encoder.encode(text);
    wireBytes += bytes.byteLength;
    return bytes;
  };
  yield encode(`:${"x".repeat(limits.lineBytes - 1)}\n\n`);
  for (let index = 0; index < 3; index += 1) {
    yield encode(`:${"x".repeat(limits.lineBytes - 2)}\n`);
  }
  yield encode(`:${"x".repeat(limits.lineBytes - 3)}\n\n`);
  yield encode(kimiBudgetOpening);
  const events = limits.dataEvents - 4;
  const fixedTextBytes = encoder.encode(
    `${kimiBudgetTool.id}${kimiBudgetTool.function.name}${kimiBudgetArguments}`
  ).byteLength;
  const reasoningBytes = limits.logicalTextBytes - fixedTextBytes;
  const perEvent = Math.floor(reasoningBytes / events);
  const extra = reasoningBytes % events;
  const padding = "x".repeat(256);
  for (let index = 0; index < events; index += 1) {
    const chunk = {
      ...kimiChunk([
        kimiChoice({
          reasoning_content: "r".repeat(perEvent + (index < extra ? 1 : 0)),
        }),
      ]),
      padding,
    };
    yield encode(kimiEvent(chunk));
  }
  yield encode(kimiBudgetEnding);
  if (wireBytes > limits.wireBytes) {
    throw new Error("The synthetic maximum fixture exceeded its wire budget");
  }
  while (wireBytes < limits.wireBytes) {
    const remaining = limits.wireBytes - wireBytes;
    const size = Math.min(4096, remaining);
    yield encode(size < 3 ? "\n".repeat(size) : `:${"x".repeat(size - 3)}\n\n`);
  }
};
