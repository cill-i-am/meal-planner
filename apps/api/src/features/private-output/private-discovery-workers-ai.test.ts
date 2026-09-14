import type * as NativeCloudflare from "@cloudflare/workers-types";
import { chat, maxIterations } from "@tanstack/ai";
import type { ChatMiddleware, ModelMessage, StreamChunk } from "@tanstack/ai";
import { createCloudflareText } from "@tanstack/ai-cloudflare";
import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { PrivateChatReply } from "./private-chat-reply.js";
import {
  emptyPrivateDiscoveryContinuity,
  emptyPrivateDiscoveryContinuityUpdates,
} from "./private-discovery-continuity.js";
import {
  encodeKimiCompletion,
  kimiChoice,
  kimiChunk,
  kimiEvent,
} from "./private-discovery-kimi-stream.test-fixtures.js";
import {
  makePrivateDiscoveryProviderOutput,
  PrivateDiscoveryContext,
  PrivateDiscoveryFailure,
  SubmitDiscoveryTurn,
} from "./private-discovery-model.js";
import type { PrivateDiscoveryResult } from "./private-discovery-model.js";
import { privateDiscoveryInstructions } from "./private-discovery-prompt.js";
import { makePrivateDiscoveryModel } from "./private-discovery-workers-ai.js";
import type { PrivateDiscoveryConfiguration } from "./private-discovery-workers-ai.js";

// Keep one spy in place before any SDK client caches bound console methods.
const providerLogs = vi.spyOn(console, "error").mockImplementation(() => {});

const ids = {
  current: "00000000-0000-4000-8000-000000000003",
  previous: "00000000-0000-4000-8000-000000000001",
  question: "00000000-0000-4000-8000-000000000002",
  reply: "00000000-0000-4000-8000-000000000004",
  run: "00000000-0000-4000-8000-000000000005",
  thread: "00000000-0000-4000-8000-000000000006",
};
const context = () =>
  Schema.decodeUnknownSync(PrivateDiscoveryContext)({
    cards: [],
    continuity: emptyPrivateDiscoveryContinuity(),
    messages: [
      { id: ids.current, role: "participant", text: "I like tomatoes." },
    ],
    profile: { facts: [], version: 0 },
    scope: "ProfileEdit",
  });
const canonicalMessages = (): ModelMessage[] => [
  {
    content: "I cook for myself.",
    createdAt: new Date(1000),
    id: ids.previous,
    role: "user",
  },
  {
    content: "Which meals do you enjoy?",
    createdAt: new Date(2000),
    id: ids.question,
    role: "assistant",
  },
  {
    content: "I like tomatoes.",
    createdAt: new Date(3000),
    id: ids.current,
    role: "user",
  },
];
const config: PrivateDiscoveryConfiguration = {
  gatewayId: "synthetic-private-discovery",
  inputUsdPerMillionTokens: 0.95,
  maxOutputTokens: 65_536,
  model: "@cf/moonshotai/kimi-k2.6",
  outputUsdPerMillionTokens: 4,
  timeoutMs: 900_000,
};
const unknownUsage = {
  estimatedCostUsd: null,
  inputTokens: null,
  outputTokens: null,
};
const output = Schema.decodeUnknownSync(SubmitDiscoveryTurn)({
  intent: {
    _tag: "Continue",
    proposals: [],
    updates: {
      ...emptyPrivateDiscoveryContinuityUpdates(),
      notes: [
        {
          detail: "Synthetic private tool detail 🍅",
          key: "preparation",
          subject: "Tomato preparation",
        },
      ],
    },
  },
});
const reply = Schema.decodeUnknownSync(PrivateChatReply)({
  createdAt: 4000,
  messageId: ids.reply,
  text: "Do you have any other food preferences?",
  type: "PrivateDiscoveryReply",
});
const tool = (
  argumentsText = JSON.stringify(output),
  name = "submitDiscoveryTurn"
) => ({
  function: { arguments: argumentsText, name },
  id: "synthetic-tool-call",
  type: "function",
});
const wire = (
  tools: readonly Record<string, unknown>[] = [tool()],
  content: string | null = null
) =>
  encodeKimiCompletion({
    choices: [
      {
        finish_reason: "tool_calls",
        message: { content, role: "assistant", tool_calls: tools },
      },
    ],
    usage: { completion_tokens: 50, prompt_tokens: 100 },
  });
const prefix = (argumentsText = JSON.stringify(output)) =>
  kimiEvent(
    kimiChunk([
      kimiChoice({
        role: "assistant",
        tool_calls: [{ ...tool(argumentsText), index: 0 }],
      }),
    ])
  );
const response = (body = wire()) =>
  new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
interface CapturedOptions {
  readonly extraHeaders: Readonly<Record<string, string>>;
  readonly gateway: {
    readonly collectLog: boolean;
    readonly id: string;
    readonly requestTimeoutMs: number;
    readonly skipCache: boolean;
  };
  readonly returnRawResponse: boolean;
  readonly signal: AbortSignal;
}
const fixture = (
  respond: (options: CapturedOptions) => Promise<Response> = () =>
    Promise.resolve(response()),
  configuration: PrivateDiscoveryConfiguration = config
) => {
  const run = vi.fn(
    (
      _model: string,
      _body: Record<string, unknown>,
      options: CapturedOptions
    ) => respond(options)
  );
  const model = makePrivateDiscoveryModel({
    PRIVATE_DISCOVERY_CONFIG: JSON.stringify(configuration),
    PrivateDiscoveryAI: {
      // SAFETY: This recording fake implements only the native raw-response overload used by the maintained adapter.
      run: run as unknown as NativeCloudflare.Ai["run"],
    },
  });
  const beforeDispatch = vi.fn();
  const accept = vi.fn((_result: PrivateDiscoveryResult) => reply);
  const fail = vi.fn((_failure: PrivateDiscoveryFailure) => {});
  const dispose = vi.fn();
  const onFinish = vi.fn<NonNullable<ChatMiddleware["onFinish"]>>();
  const startedMessages: (readonly ModelMessage[])[] = [];
  const middleware: ChatMiddleware = {
    name: "synthetic-persistence-observer",
    onFinish,
    onStart: (current) => {
      startedMessages.push(structuredClone(current.messages));
    },
  };
  const input = {
    beforeDispatch,
    chat: {
      accept,
      dispose,
      fail,
      messages: canonicalMessages(),
      middleware: [middleware],
      runId: ids.run,
      threadId: ids.thread,
    },
    context: context(),
    signal: new AbortController().signal,
  };
  return {
    accept,
    beforeDispatch,
    dispose,
    fail,
    input,
    model,
    onFinish,
    run,
    startedMessages,
  };
};
const observe = async (stream: AsyncIterable<StreamChunk>) => {
  const chunks: StreamChunk[] = [];
  let failure: unknown;
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
  } catch (error) {
    failure = error;
  }
  return { chunks, error: failure };
};
const expectRejected = (
  test: ReturnType<typeof fixture>,
  reason: PrivateDiscoveryFailure["reason"] = "invalid_output"
) => {
  expect(test.accept).not.toHaveBeenCalled();
  expect(test.onFinish).not.toHaveBeenCalled();
  expect(test.fail).toHaveBeenCalled();
  expect(test.fail.mock.calls.at(-1)?.[0]).toMatchObject({
    reason,
    usage: unknownUsage,
  });
};

afterEach(() => {
  vi.useRealTimers();
  providerLogs.mockClear();
});
afterAll(() => providerLogs.mockRestore());

describe("private discovery native TanStack provider", () => {
  it("sends the exact forced Effect tool contract and preserves Kimi and gateway controls", async () => {
    const test = fixture();
    const result = await Effect.runPromise(test.model.generate(test.input));
    const standard = Schema.toStandardJSONSchemaV1(
      Schema.toStandardSchemaV1(
        makePrivateDiscoveryProviderOutput(test.input.context.cards)
      )
    );
    expect(test.run).toHaveBeenCalledOnce();
    expect(test.beforeDispatch).toHaveBeenCalledOnce();
    expect(test.run.mock.calls[0]).toEqual([
      config.model,
      {
        chat_template_kwargs: { thinking: true },
        max_completion_tokens: 65_536,
        messages: [
          { content: privateDiscoveryInstructions, role: "system" },
          { content: JSON.stringify(test.input.context), role: "user" },
        ],
        n: 1,
        parallel_tool_calls: false,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 1,
        tool_choice: {
          function: { name: "submitDiscoveryTurn" },
          type: "function",
        },
        tools: [
          {
            function: {
              description: expect.any(String),
              name: "submitDiscoveryTurn",
              parameters: standard["~standard"].jsonSchema.input({
                target: "draft-2020-12",
              }),
              strict: true,
            },
            type: "function",
          },
        ],
        top_p: 0.95,
      },
      {
        extraHeaders: { "cf-aig-max-attempts": "1" },
        gateway: {
          collectLog: false,
          id: config.gatewayId,
          requestTimeoutMs: 900_000,
          skipCache: true,
        },
        returnRawResponse: true,
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(result).toMatchObject({ output, usage: unknownUsage });
  });

  it("uses the same native streaming path for the supported GPT model", async () => {
    const test = fixture(undefined, {
      ...config,
      maxOutputTokens: 2048,
      model: "@cf/openai/gpt-oss-120b",
      timeoutMs: 60_000,
    });
    const result = await Effect.runPromise(test.model.generate(test.input));
    expect(result.output).toEqual(output);
    expect(test.run).toHaveBeenCalledOnce();
    expect(test.run.mock.calls[0]?.[1]).toMatchObject({
      max_tokens: 2048,
      stream: true,
      top_p: 1,
    });
    expect(test.run.mock.calls[0]?.[1]).not.toHaveProperty(
      "chat_template_kwargs"
    );
  });

  it.each([
    { body: wire(), name: "finish and DONE" },
    { body: prefix(), name: "neither finish nor DONE" },
    {
      body: wire().replace("data: [DONE]\n\n", ""),
      name: "finish without DONE",
    },
  ])("accepts a valid proposal with $name", async ({ body }) => {
    const test = fixture(() => Promise.resolve(response(body)));
    const result = await observe(test.model.stream(test.input));
    expect(result.error).toBeUndefined();
    expect(test.accept).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ output, usage: unknownUsage })
    );
    expect(test.fail).not.toHaveBeenCalled();
    expect(test.onFinish).toHaveBeenCalledOnce();
    expect(test.run).toHaveBeenCalledOnce();
    expect(result.chunks).toContainEqual({
      delta: reply.text,
      messageId: reply.messageId,
      type: "TEXT_MESSAGE_CONTENT",
    });
  });

  it.each([
    { name: "interim usage", terminalUsage: false },
    { name: "interim and final usage", terminalUsage: true },
  ])("retains unknown accounting with $name", async ({ terminalUsage }) => {
    const body = [
      kimiEvent(
        kimiChunk(
          [
            kimiChoice({
              reasoning_content: "Private reasoning",
              role: "assistant",
            }),
          ],
          { completion_tokens: 1, prompt_tokens: 100 }
        )
      ),
      prefix(),
      kimiEvent(kimiChunk([kimiChoice({}, "tool_calls")])),
      terminalUsage
        ? kimiEvent(
            kimiChunk([], { completion_tokens: 50, prompt_tokens: 100 })
          )
        : "",
      "data: [DONE]\n\n",
    ].join("");
    const test = fixture(() => Promise.resolve(response(body)));
    const result = await Effect.runPromise(test.model.generate(test.input));
    expect(result.usage).toEqual(unknownUsage);
    expect(test.run).toHaveBeenCalledOnce();
  });

  it("assembles fragmented tool arguments across single-byte UTF-8 transport chunks", async () => {
    const text = JSON.stringify(output);
    const bytes = new TextEncoder().encode(
      [
        kimiEvent(
          kimiChunk([
            kimiChoice({
              role: "assistant",
              tool_calls: [{ ...tool(text.slice(0, 27)), index: 0 }],
            }),
          ])
        ),
        kimiEvent(
          kimiChunk([
            kimiChoice({
              tool_calls: [
                { function: { arguments: text.slice(27) }, index: 0 },
              ],
            }),
          ])
        ),
        kimiEvent(kimiChunk([kimiChoice({}, "tool_calls")])),
        "data: [DONE]\n\n",
      ].join("")
    );
    let offset = 0;
    const test = fixture(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            pull(controller) {
              if (offset === bytes.length) {
                controller.close();
              } else {
                controller.enqueue(bytes.slice(offset, offset + 1));
                offset += 1;
              }
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
      )
    );
    const result = await Effect.runPromise(test.model.generate(test.input));
    expect(result.output).toEqual(output);
    expect(test.run).toHaveBeenCalledOnce();
  });

  it("exposes only the accepted reply while persistence receives the full canonical input", async () => {
    const privateReasoning = "Synthetic provider reasoning never shown";
    const body =
      kimiEvent(
        kimiChunk([kimiChoice({ reasoning_content: privateReasoning })])
      ) + wire();
    const test = fixture(() => Promise.resolve(response(body)));
    const originalMessages = canonicalMessages();
    const chunks: StreamChunk[] = [];
    for await (const chunk of test.model.stream(test.input)) {
      if (chunk.type === "RUN_FINISHED") {
        expect(test.accept).toHaveBeenCalledOnce();
      }
      chunks.push(chunk);
    }
    const result = { chunks };
    expect(test.startedMessages).toEqual([originalMessages]);
    expect(test.onFinish).toHaveBeenCalledOnce();
    const persistedInput = test.onFinish.mock.calls[0]?.[0].messages;
    expect(persistedInput?.slice(0, originalMessages.length)).toEqual(
      originalMessages
    );
    expect(JSON.stringify(persistedInput)).not.toContain(privateReasoning);
    expect(persistedInput).toContainEqual(
      expect.objectContaining({ content: JSON.stringify(reply), role: "tool" })
    );
    expect(result.chunks.map((chunk) => chunk.type)).toEqual([
      "RUN_STARTED",
      "RUN_FINISHED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
    ]);
    expect(JSON.stringify(result.chunks)).not.toContain(privateReasoning);
    expect(JSON.stringify(result.chunks)).not.toContain(
      "Synthetic private tool detail"
    );
    expect(test.run).toHaveBeenCalledOnce();
  });

  it("disables diagnostic transcript emission while ordinary SDK chats retain the opt-in default", async () => {
    const eventClient = Reflect.get(
      globalThis,
      Symbol.for("tanstack.ai.devtools.eventClient")
    );
    expect(eventClient).toBeDefined();
    const emitted = vi.spyOn(eventClient, "emit").mockImplementation(() => {});
    try {
      const ordinary = fixture();
      await observe(
        chat({
          adapter: createCloudflareText(config.model, {
            binding: {
              // SAFETY: This fake implements the SDK's native raw-response overload only.
              run: ordinary.run as unknown as NativeCloudflare.Ai["run"],
            },
            maxRetries: 0,
          }),
          agentLoopStrategy: maxIterations(1),
          debug: false,
          messages: canonicalMessages(),
        })
      );
      expect(emitted).toHaveBeenCalled();
      expect(JSON.stringify(emitted.mock.calls)).toContain(
        canonicalMessages().at(-1)?.content
      );
      emitted.mockClear();
      const privateChat = fixture();
      privateChat.input.chat.middleware.push({
        name: "synthetic-canonical-history-load",
        onConfig: (_ctx, current) => ({ messages: current.messages }),
      });
      await observe(privateChat.model.stream(privateChat.input));
      expect(privateChat.accept).toHaveBeenCalledOnce();
      expect(emitted).not.toHaveBeenCalled();
    } finally {
      emitted.mockRestore();
    }
  });

  it("rejects malformed provider JSON without logging the private event", async () => {
    const body = `${prefix()}data: {"private_detail":"Synthetic log sentinel"\n\n`;
    const ordinary = fixture(() => Promise.resolve(response(body)));
    await observe(
      chat({
        adapter: createCloudflareText(config.model, {
          binding: {
            // SAFETY: This fake implements the SDK's native raw-response overload only.
            run: ordinary.run as unknown as NativeCloudflare.Ai["run"],
          },
          maxRetries: 0,
        }),
        agentLoopStrategy: maxIterations(1),
        debug: false,
        messages: canonicalMessages(),
      })
    );
    expect(JSON.stringify(providerLogs.mock.calls)).toContain(
      "Synthetic log sentinel"
    );
    providerLogs.mockClear();
    const test = fixture(() => Promise.resolve(response(body)));
    const result = await observe(test.model.stream(test.input));
    expect(result.error).toBeInstanceOf(PrivateDiscoveryFailure);
    expectRejected(test);
    expect(providerLogs).not.toHaveBeenCalled();
  });

  it("reports HTTP 503 after one binding call without retry or fallback", async () => {
    const test = fixture(() =>
      Promise.resolve(
        new Response('{"error":{"message":"Synthetic unavailable"}}', {
          headers: {
            "content-type": "application/json",
            "retry-after-ms": "1",
          },
          status: 503,
        })
      )
    );
    await observe(test.model.stream(test.input));
    expectRejected(test, "provider_unavailable");
    expect(test.run).toHaveBeenCalledOnce();
  });

  it.each([
    { argumentsText: "{not-json", name: "malformed JSON" },
    {
      argumentsText: JSON.stringify({
        ...output,
        intent: {
          ...output.intent,
          updates: {
            ...emptyPrivateDiscoveryContinuityUpdates(),
            coverage: { usualMeals: null },
          },
        },
      }),
      name: "omitted foodRestrictions",
    },
    {
      argumentsText: JSON.stringify({
        ...output,
        intent: {
          ...output.intent,
          updates: {
            ...emptyPrivateDiscoveryContinuityUpdates(),
            notes: [
              { detail: "Synthetic omitted subject", key: "preparation" },
            ],
          },
        },
      }),
      name: "omitted continuity note subject",
    },
    {
      argumentsText: JSON.stringify({ ...output, unrecognized: "extra field" }),
      name: "unknown root field",
    },
    {
      argumentsText: JSON.stringify({
        ...output,
        intent: { ...output.intent, unrecognized: "extra field" },
      }),
      name: "unknown intent field",
    },
  ])(
    "rejects $name before acceptance or persistence completion",
    async ({ argumentsText }) => {
      const test = fixture(() =>
        Promise.resolve(response(wire([tool(argumentsText)])))
      );
      await observe(test.model.stream(test.input));
      expectRejected(test);
      expect(test.run).toHaveBeenCalledOnce();
    }
  );

  it.each([
    {
      body: wire([tool(), { ...tool(), id: "second-call" }]),
      name: "multiple tool calls",
    },
    {
      body: wire([tool(), tool()]),
      name: "multiple tool calls sharing the same ID",
    },
    {
      body: wire([tool(JSON.stringify(output), "wrongTool")]),
      name: "wrong tool",
    },
    { body: wire([], "Unapproved prose"), name: "prose only" },
    {
      body: wire([tool()], "Unapproved prose"),
      name: "prose alongside a valid tool",
    },
  ])(
    "rejects $name without acceptance or persistence completion",
    async ({ body }) => {
      const test = fixture(() => Promise.resolve(response(body)));
      await observe(test.model.stream(test.input));
      expectRejected(test);
      expect(test.run).toHaveBeenCalledOnce();
    }
  );

  it("rejects a known response-body failure after a complete valid argument prefix", async () => {
    let read = false;
    const test = fixture(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            pull(controller) {
              if (read) {
                controller.error(new Error("Synthetic body failure"));
              } else {
                controller.enqueue(new TextEncoder().encode(prefix()));
                read = true;
              }
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
      )
    );
    await observe(test.model.stream(test.input));
    expectRejected(test);
    expect(test.run).toHaveBeenCalledOnce();
  });

  it("does not dispatch or accept when the caller is already canceled", async () => {
    const test = fixture();
    const caller = new AbortController();
    caller.abort();
    await observe(test.model.stream({ ...test.input, signal: caller.signal }));
    expectRejected(test, "outcome_unknown");
    expect(test.run).not.toHaveBeenCalled();
    expect(test.beforeDispatch).not.toHaveBeenCalled();
  });

  it("cancels a pending binding request without accepting or completing persistence", async () => {
    const dispatched = Promise.withResolvers<CapturedOptions>();
    const test = fixture((options) => {
      dispatched.resolve(options);
      const pending = Promise.withResolvers<Response>();
      options.signal.addEventListener(
        "abort",
        () =>
          pending.reject(
            new DOMException("Synthetic cancellation", "AbortError")
          ),
        { once: true }
      );
      return pending.promise;
    });
    const caller = new AbortController();
    const running = observe(
      test.model.stream({ ...test.input, signal: caller.signal })
    );
    const options = await dispatched.promise;
    caller.abort();
    await running;
    expect(options.signal.aborted).toBe(true);
    expectRejected(test, "outcome_unknown");
    expect(test.run).toHaveBeenCalledOnce();
  });

  it("keeps caller cancellation authoritative after a valid tool prefix", async () => {
    const reading = Promise.withResolvers<CapturedOptions>();
    const test = fixture((options) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            pull() {
              reading.resolve(options);
            },
            start(controller) {
              options.signal.addEventListener(
                "abort",
                () =>
                  controller.error(
                    new DOMException(
                      "Synthetic native body cancellation",
                      "AbortError"
                    )
                  ),
                { once: true }
              );
              controller.enqueue(new TextEncoder().encode(prefix()));
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
      )
    );
    const caller = new AbortController();
    const running = observe(
      test.model.stream({ ...test.input, signal: caller.signal })
    );
    const options = await reading.promise;
    caller.abort();
    await running;
    expect(options.signal.aborted).toBe(true);
    expectRejected(test, "outcome_unknown");
    expect(test.run).toHaveBeenCalledOnce();
  });

  it.each(["participant stop", "deadline"] as const)(
    "cancels the original stalled body after %s even when the body ignores its signal",
    async (cause) => {
      if (cause === "deadline") {
        vi.useFakeTimers();
      }
      const reading = Promise.withResolvers<CapturedOptions>();
      const cancel = vi.fn();
      let sentPrefix = false;
      const test = fixture(
        (options) =>
          Promise.resolve(
            new Response(
              new ReadableStream(
                {
                  cancel,
                  pull(controller) {
                    if (sentPrefix) {
                      reading.resolve(options);
                    } else {
                      sentPrefix = true;
                      controller.enqueue(new TextEncoder().encode(prefix()));
                    }
                  },
                },
                { highWaterMark: 0 }
              ),
              { headers: { "content-type": "text/event-stream" } }
            )
          ),
        { ...config, timeoutMs: 1000 }
      );
      const caller = new AbortController();
      const running = observe(
        test.model.stream({ ...test.input, signal: caller.signal })
      );
      const options = await reading.promise;
      if (cause === "deadline") {
        await vi.advanceTimersByTimeAsync(1000);
      } else {
        caller.abort();
      }
      await running;
      expect(options.signal.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledOnce();
      expectRejected(test, "outcome_unknown");
      expect(test.run).toHaveBeenCalledOnce();
    }
  );

  it("enforces the application deadline while a binding request is stalled", async () => {
    vi.useFakeTimers();
    const dispatched = Promise.withResolvers<CapturedOptions>();
    const test = fixture(
      (options) => {
        dispatched.resolve(options);
        return Promise.withResolvers<Response>().promise;
      },
      { ...config, timeoutMs: 1000 }
    );
    const running = observe(test.model.stream(test.input));
    const options = await dispatched.promise;
    await vi.advanceTimersByTimeAsync(1000);
    await running;
    expect(options.signal.aborted).toBe(true);
    expectRejected(test, "outcome_unknown");
    expect(test.run).toHaveBeenCalledOnce();
  });

  it("propagates Effect interruption to a pending native binding request", async () => {
    const dispatched = Promise.withResolvers<CapturedOptions>();
    const test = fixture((options) => {
      dispatched.resolve(options);
      return Promise.withResolvers<Response>().promise;
    });
    const caller = new AbortController();
    const running = Effect.runPromiseExit(test.model.generate(test.input), {
      signal: caller.signal,
    });
    const options = await dispatched.promise;
    caller.abort();
    const result = await running;
    expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(
      true
    );
    expect(options.signal.aborted).toBe(true);
    expect(test.run).toHaveBeenCalledOnce();
  });
});
