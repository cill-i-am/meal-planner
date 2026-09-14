import type * as NativeCloudflare from "@cloudflare/workers-types";
import { chat, EventType, maxIterations, toolDefinition } from "@tanstack/ai";
import type { ChatMiddleware, StreamChunk } from "@tanstack/ai";
import { CloudflareTextAdapter } from "@tanstack/ai-cloudflare";
import { Effect, Option, Schema } from "effect";

import { PrivateChatReply } from "./private-chat-reply.js";
import {
  makePrivateDiscoveryProviderOutput,
  PRIVATE_DISCOVERY_CONTEXT_BYTES,
  PRIVATE_DISCOVERY_POLICY_VERSION,
  PRIVATE_DISCOVERY_PROMPT_VERSION,
  PRIVATE_DISCOVERY_TOOL_VERSION,
  PrivateDiscoveryContext,
  PrivateDiscoveryFailure,
  SubmitDiscoveryTurn,
} from "./private-discovery-model.js";
import type {
  PrivateDiscoveryInvalidOutputStage,
  PrivateDiscoveryProvenance,
  PrivateDiscoveryResult,
  PrivateDiscoveryStreamInput,
  PrivateDiscoveryStreamingModel,
  PrivateDiscoveryUsage,
} from "./private-discovery-model.js";
import { privateDiscoveryInstructions } from "./private-discovery-prompt.js";

export const PRIVATE_DISCOVERY_INPUT_BYTES = 32_768;
export const PRIVATE_DISCOVERY_RESPONSE_BYTES = 65_536;
const PositiveAmount = Schema.Number.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);
export const PrivateDiscoveryConfiguration = Schema.Struct({
  gatewayId: Schema.String.pipe(
    Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(64))
  ),
  inputUsdPerMillionTokens: PositiveAmount,
  maxOutputTokens: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 65_536, minimum: 1 }))
  ),
  model: Schema.Literals([
    "@cf/openai/gpt-oss-120b",
    "@cf/moonshotai/kimi-k2.6",
  ]),
  outputUsdPerMillionTokens: PositiveAmount,
  timeoutMs: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 900_000, minimum: 1000 }))
  ),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (config) =>
        config.model === "@cf/moonshotai/kimi-k2.6" ||
        (config.maxOutputTokens <= 4096 && config.timeoutMs <= 120_000),
      { expected: "token and deadline limits supported by the selected model" }
    )
  ),
  Schema.annotate({ parseOptions: { onExcessProperty: "error" } })
);
export type PrivateDiscoveryConfiguration =
  typeof PrivateDiscoveryConfiguration.Type;
export interface PrivateDiscoveryModelEnvironment {
  readonly PRIVATE_DISCOVERY_CONFIG?: string | null;
  readonly PrivateDiscoveryAI?: Pick<NativeCloudflare.Ai, "run">;
}

const failure = (
  reason: PrivateDiscoveryFailure["reason"],
  usage: PrivateDiscoveryUsage | null = null,
  provenance: PrivateDiscoveryProvenance | null = null,
  stage: PrivateDiscoveryInvalidOutputStage | null = null
) => new PrivateDiscoveryFailure({ provenance, reason, stage, usage });
const configuration = Schema.decodeUnknownOption(
  Schema.fromJsonString(PrivateDiscoveryConfiguration)
);

const unknownUsage: PrivateDiscoveryUsage = {
  estimatedCostUsd: null,
  inputTokens: null,
  outputTokens: null,
};

const kimiThinking: NonNullable<
  NativeCloudflare.AiModels["@cf/moonshotai/kimi-k2.6"]["inputs"]["chat_template_kwargs"]
> & { readonly thinking: true } = { thinking: true };

const submissionDescription =
  "Submit one private discovery intent for application validation. This never confirms a household fact.";

const providerRequest = (
  config: PrivateDiscoveryConfiguration,
  context: PrivateDiscoveryContext,
  parameters: Record<string, unknown>
) => ({
  messages: [
    { content: privateDiscoveryInstructions, role: "system" as const },
    { content: JSON.stringify(context), role: "user" as const },
  ],
  model: config.model,
  parallel_tool_calls: false,
  stream: true as const,
  stream_options: { include_usage: true },
  temperature: 1,
  tool_choice: {
    function: { name: "submitDiscoveryTurn" },
    type: "function" as const,
  },
  tools: [
    {
      function: {
        description: submissionDescription,
        name: "submitDiscoveryTurn",
        parameters,
        strict: true,
      },
      type: "function" as const,
    },
  ],
  ...(config.model === "@cf/moonshotai/kimi-k2.6"
    ? {
        chat_template_kwargs: kimiThinking,
        max_completion_tokens: config.maxOutputTokens,
        n: 1,
        top_p: 0.95,
      }
    : { max_tokens: config.maxOutputTokens, top_p: 1 }),
});

/** App-owned request contract; the maintained adapter owns SDK streaming and tool assembly. */
class PrivateDiscoveryTextAdapter extends CloudflareTextAdapter<
  PrivateDiscoveryConfiguration["model"]
> {
  readonly #request: ReturnType<typeof providerRequest>;

  constructor(
    config: ConstructorParameters<typeof CloudflareTextAdapter>[0],
    request: ReturnType<typeof providerRequest>
  ) {
    super(config, request.model);
    this.#request = request;
  }

  protected override mapOptionsToRequest() {
    // Preserve the Effect schema's closed definitions instead of the SDK's generic strict downgrade.
    return this.#request;
  }

  // oxlint-disable-next-line class-methods-use-this -- The provider hook deliberately suppresses reasoning before SDK history accumulation.
  protected override extractReasoning(): undefined {
    // Reasoning never enters TanStack's live events or internal message history.
  }
}

const safeReplyChunks = (reply: PrivateChatReply): StreamChunk[] => [
  {
    messageId: reply.messageId,
    role: "assistant",
    type: EventType.TEXT_MESSAGE_START,
  },
  {
    delta: reply.text,
    messageId: reply.messageId,
    type: EventType.TEXT_MESSAGE_CONTENT,
  },
  { messageId: reply.messageId, type: EventType.TEXT_MESSAGE_END },
];

/** Promise boundary only: cancellation cannot wait for an unresponsive binding. */
const abortable = <T>(pending: Promise<T>, signal: AbortSignal): Promise<T> => {
  signal.throwIfAborted();
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const aborted = () => reject(signal.reason);
  signal.addEventListener("abort", aborted, { once: true });
  // oxlint-disable-next-line promise/prefer-await-to-then -- Release cancellation registration after either native settlement without awaiting a stalled binding.
  void pending.then(resolve, reject).finally(() => {
    signal.removeEventListener("abort", aborted);
  });
  return promise;
};

const streamDiscovery = (
  environment: PrivateDiscoveryModelEnvironment,
  input: PrivateDiscoveryStreamInput
) => {
  const configured = configuration(environment.PRIVATE_DISCOVERY_CONFIG);
  const ai = environment.PrivateDiscoveryAI;
  if (Option.isNone(configured) || ai === undefined) {
    throw failure("not_configured");
  }
  const config = configured.value;
  const provenance: PrivateDiscoveryProvenance = {
    model: config.model,
    policyVersion: PRIVATE_DISCOVERY_POLICY_VERSION,
    promptVersion: PRIVATE_DISCOVERY_PROMPT_VERSION,
    provider: "cloudflare-workers-ai",
    toolVersion: PRIVATE_DISCOVERY_TOOL_VERSION,
  };
  const failed = (
    reason: PrivateDiscoveryFailure["reason"],
    stage: PrivateDiscoveryInvalidOutputStage | null = null
  ) => failure(reason, unknownUsage, provenance, stage);
  let rejected: PrivateDiscoveryFailure | undefined;
  const reject = (problem: PrivateDiscoveryFailure): never => {
    rejected ??= problem;
    throw rejected;
  };
  let context: PrivateDiscoveryContext;
  try {
    context = Schema.decodeUnknownSync(PrivateDiscoveryContext)(input.context);
  } catch {
    return reject(failed("context_limit"));
  }
  const standard = Schema.toStandardJSONSchemaV1(
    Schema.toStandardSchemaV1(makePrivateDiscoveryProviderOutput(context.cards))
  );
  const request = providerRequest(
    config,
    context,
    standard["~standard"].jsonSchema.input({ target: "draft-2020-12" })
  );
  const { model: _model, ...requestBody } = request;
  const encoder = new TextEncoder();
  if (
    encoder.encode(JSON.stringify(context)).byteLength >
      PRIVATE_DISCOVERY_CONTEXT_BYTES ||
    encoder.encode(JSON.stringify(request)).byteLength >
      PRIVATE_DISCOVERY_INPUT_BYTES
  ) {
    return reject(failed("context_limit"));
  }
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal.reason);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let dispatched = false;
  let prepared: SubmitDiscoveryTurn | undefined;
  let accepted: PrivateChatReply | undefined;
  let emittedReply = false;
  let toolCallId: string | undefined;
  const cleanup = () => {
    if (deadline !== undefined) {
      clearTimeout(deadline);
    }
    input.signal.removeEventListener("abort", abort);
    input.chat.dispose?.();
  };
  const binding: Pick<NativeCloudflare.Ai, "run"> = {
    // SAFETY: The SDK and app use different Workers type versions for the same native raw-response overload.
    run: (async (...args: Parameters<NativeCloudflare.Ai["run"]>) => {
      if (dispatched || controller.signal.aborted) {
        return reject(failed("outcome_unknown"));
      }
      dispatched = true;
      input.beforeDispatch(provenance);
      try {
        const response = await abortable(
          ai.run(config.model, requestBody, {
            ...args[2],
            returnRawResponse: true,
          }),
          controller.signal
        );
        if (!response.ok) {
          return reject(failed("provider_unavailable"));
        }
        if (response.body === null) {
          return reject(failed("invalid_output", "response_body_missing"));
        }
        if (
          !response.headers
            .get("content-type")
            ?.toLowerCase()
            .includes("text/event-stream")
        ) {
          return reject(failed("invalid_output", "response_envelope"));
        }
        // Native pipe cancellation owns body cleanup; no application SSE parser is involved.
        return new Response(
          (response.body as unknown as ReadableStream<Uint8Array>).pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>(),
            { signal: controller.signal }
          ),
          {
            headers: response.headers as unknown as Headers,
            status: response.status,
          }
        );
      } catch (error) {
        return reject(
          error instanceof PrivateDiscoveryFailure
            ? error
            : failed("outcome_unknown")
        );
      }
    }) as NativeCloudflare.Ai["run"],
  };
  const guard: ChatMiddleware = {
    name: "private-discovery-contract",
    onAbort: async () => {
      rejected ??= failed("outcome_unknown");
      await input.chat.fail?.(rejected);
    },
    onAfterToolCall: (_ctx, info) => {
      if (!info.ok) {
        rejected ??= failed("invalid_output", "output_schema");
      }
    },
    onBeforeToolCall: (_ctx, info) => {
      if (rejected) {
        throw rejected;
      }
      if (controller.signal.aborted) {
        return reject(failed("outcome_unknown"));
      }
      if (
        toolCallId === undefined ||
        info.toolCallId !== toolCallId ||
        info.toolName !== "submitDiscoveryTurn" ||
        accepted !== undefined
      ) {
        return reject(failed("invalid_output", "tool_call"));
      }
      if (
        encoder.encode(info.toolCall.function.arguments).byteLength >
        PRIVATE_DISCOVERY_RESPONSE_BYTES
      ) {
        return reject(failed("invalid_output", "response_body_limit"));
      }
      let value: unknown;
      try {
        value = JSON.parse(info.toolCall.function.arguments);
      } catch {
        return reject(failed("invalid_output", "output_json"));
      }
      try {
        prepared = Schema.decodeUnknownSync(SubmitDiscoveryTurn, {
          onExcessProperty: "error",
        })(value);
      } catch {
        return reject(failed("invalid_output", "output_schema"));
      }
    },
    onChunk: (_ctx, chunk) => {
      if (chunk.type === "RUN_ERROR") {
        return reject(
          rejected ?? failed("invalid_output", "response_body_read")
        );
      }
      if (chunk.type === "RUN_STARTED") {
        return {
          runId: input.chat.runId,
          threadId: input.chat.threadId,
          type: EventType.RUN_STARTED,
        };
      }
      if (chunk.type === "TOOL_CALL_START") {
        if (toolCallId !== undefined) {
          return reject(failed("invalid_output", "tool_call"));
        }
        ({ toolCallId } = chunk);
      }
      if (chunk.type === "TEXT_MESSAGE_CONTENT" && chunk.delta !== "") {
        return reject(failed("invalid_output", "tool_call"));
      }
      if (chunk.type === "RUN_FINISHED") {
        if (toolCallId === undefined) {
          return reject(failed("invalid_output", "tool_call"));
        }
        // The SDK defers this until the tool phase and atomic application acceptance succeed.
        return {
          outcome: { type: "success" },
          runId: input.chat.runId,
          threadId: input.chat.threadId,
          type: EventType.RUN_FINISHED,
        };
      }
      if (
        chunk.type === "TOOL_CALL_RESULT" &&
        accepted !== undefined &&
        !emittedReply
      ) {
        emittedReply = true;
        return safeReplyChunks(accepted);
      }
      return null;
    },
    onError: async (_ctx, info) => {
      rejected ??=
        info.error instanceof PrivateDiscoveryFailure
          ? info.error
          : failed("invalid_output", "output_schema");
      await input.chat.fail?.(rejected);
    },
    onStart: () => {
      input.signal.addEventListener("abort", abort, { once: true });
      if (input.signal.aborted) {
        abort();
      }
      deadline = setTimeout(() => controller.abort(), config.timeoutMs);
    },
    onToolPhaseComplete: (_ctx, info) => {
      if (controller.signal.aborted) {
        return reject(failed("outcome_unknown"));
      }
      if (rejected) {
        throw rejected;
      }
      if (info.toolCalls.length !== 1 || accepted === undefined) {
        return reject(failed("invalid_output", "tool_call"));
      }
    },
  };
  const submit = toolDefinition({
    description: submissionDescription,
    inputSchema: standard,
    name: "submitDiscoveryTurn",
  }).server(async () => {
    if (controller.signal.aborted) {
      return reject(failed("outcome_unknown"));
    }
    if (rejected) {
      throw rejected;
    }
    if (prepared === undefined) {
      return reject(failed("invalid_output", "output_schema"));
    }
    try {
      accepted = Schema.decodeUnknownSync(PrivateChatReply)(
        await input.chat.accept({
          output: prepared,
          provenance,
          // Parsed SDK usage may be interim. Unknown accounting never credits a reservation.
          usage: unknownUsage,
        })
      );
      return accepted;
    } catch (error) {
      return reject(
        error instanceof PrivateDiscoveryFailure
          ? error
          : failed("invalid_output", "output_schema")
      );
    }
  });
  return chat({
    abortController: controller,
    adapter: new PrivateDiscoveryTextAdapter(
      {
        binding,
        extraHeaders: { "cf-aig-max-attempts": "1" },
        gateway: {
          collectLog: false,
          id: config.gatewayId,
          requestTimeoutMs: config.timeoutMs,
          skipCache: true,
        },
        logLevel: "off",
        maxRetries: 0,
        timeout: config.timeoutMs,
      },
      request
    ),
    agentLoopStrategy: maxIterations(1),
    debug: false,
    devtools: false,
    messages: input.chat.messages,
    middleware: [
      guard,
      ...input.chat.middleware,
      {
        name: "private-discovery-lifecycle",
        onAbort: cleanup,
        onError: cleanup,
        onFinish: cleanup,
      },
    ],
    runId: input.chat.runId,
    threadId: input.chat.threadId,
    tools: [submit],
  });
};

export const makePrivateDiscoveryModel = (
  environment: PrivateDiscoveryModelEnvironment
): PrivateDiscoveryStreamingModel => ({
  generate: (input) =>
    Effect.tryPromise({
      catch: (error) =>
        error instanceof PrivateDiscoveryFailure
          ? error
          : failure("outcome_unknown"),
      try: async (signal) => {
        let result: PrivateDiscoveryResult | undefined;
        let problem: PrivateDiscoveryFailure | undefined;
        const stream = streamDiscovery(environment, {
          ...input,
          chat: {
            accept: (received) => {
              result = received;
              return {
                createdAt: Date.now(),
                messageId: crypto.randomUUID(),
                text: "Validated private discovery proposal.",
                type: "PrivateDiscoveryReply",
              };
            },
            fail: (error) => {
              problem = error;
            },
            messages: [],
            middleware: [],
            runId: crypto.randomUUID(),
            threadId: crypto.randomUUID(),
          },
          signal: AbortSignal.any([input.signal, signal]),
        });
        // This non-chat host consumes the same native SDK stream; it has no separate inference path.
        for await (const _chunk of stream) {
          /* The caller receives the validated domain result. */
        }
        if (problem) {
          throw problem;
        }
        if (result === undefined) {
          throw failure("invalid_output", null, null, "tool_call");
        }
        return result;
      },
    }),
  stream: (input) => streamDiscovery(environment, input),
});
