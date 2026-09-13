import { Schema } from "effect";

import { PrivateDiscoveryProviderUsage } from "./private-discovery-completion.js";
import type { PrivateDiscoveryCompletion } from "./private-discovery-completion.js";
import { KimiDiscoveryFraming } from "./private-discovery-kimi-framing.js";
import {
  PRIVATE_DISCOVERY_KIMI_STREAM_LIMITS as limits,
  PrivateDiscoveryKimiStreamFailure,
} from "./private-discovery-kimi-stream-contract.js";
import type {
  KimiStreamMetrics,
  RejectKimiStream,
} from "./private-discovery-kimi-stream-contract.js";

export {
  PRIVATE_DISCOVERY_KIMI_STREAM_LIMITS,
  PrivateDiscoveryKimiStreamDiagnostic,
  PrivateDiscoveryKimiStreamFailure,
  PrivateDiscoveryKimiStreamMetrics,
} from "./private-discovery-kimi-stream-contract.js";

const OptionalText = Schema.optionalKey(Schema.NullOr(Schema.String));
const Chunk = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      delta: Schema.Struct({
        content: OptionalText,
        reasoning: OptionalText,
        reasoning_content: OptionalText,
        refusal: OptionalText,
        role: Schema.optionalKey(Schema.NullOr(Schema.Literal("assistant"))),
        tool_calls: Schema.optionalKey(
          Schema.NullOr(
            Schema.Array(
              Schema.Struct({
                function: Schema.optionalKey(
                  Schema.Struct({
                    arguments: OptionalText,
                    name: OptionalText,
                  }).pipe(
                    Schema.annotate({
                      parseOptions: { onExcessProperty: "error" },
                    })
                  )
                ),
                id: OptionalText,
                index: Schema.Literal(0),
                type: Schema.optionalKey(
                  Schema.NullOr(Schema.Literal("function"))
                ),
              })
            ).pipe(Schema.check(Schema.isMaxLength(1)))
          )
        ),
      }).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } })),
      finish_reason: Schema.NullOr(Schema.String),
      index: Schema.Literal(0),
      usage: Schema.optionalKey(Schema.NullOr(PrivateDiscoveryProviderUsage)),
    })
  ).pipe(Schema.check(Schema.isMaxLength(1))),
  id: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  model: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  object: Schema.Literal("chat.completion.chunk"),
  usage: Schema.optionalKey(Schema.NullOr(PrivateDiscoveryProviderUsage)),
});

/** Incremental private Kimi protocol state. Only EOF can return a complete tool envelope. */
export const makePrivateDiscoveryKimiStreamDecoder = () => {
  const metrics: KimiStreamMetrics = {
    dataEvents: 0,
    logicalTextBytes: 0,
    peakEventBytes: 0,
    peakLineBytes: 0,
    pendingEventBytes: 0,
    pendingLineBytes: 0,
    retainedTextBytes: 0,
    wireBytes: 0,
  };
  let completionId: string | undefined;
  let model: string | undefined;
  let roleSeen = false;
  let content = "";
  let refusal: string | null = null;
  let toolSeen = false;
  let toolTypeSeen = false;
  let toolId = "";
  let toolName = "";
  let toolArguments = "";
  let finishReason: string | undefined;
  let usage: typeof PrivateDiscoveryProviderUsage.Type | undefined;
  let finalUsageSeen = false;
  let done = false;
  let closed = false;
  let failure: PrivateDiscoveryKimiStreamFailure | undefined;
  const encoder = new TextEncoder();
  const highSurrogate = {
    arguments: false,
    content: false,
    id: false,
    name: false,
    reasoning: false,
    reasoning_content: false,
    refusal: false,
  };
  const reject: RejectKimiStream = (check, stage, observed, limit) => {
    throw new PrivateDiscoveryKimiStreamFailure({
      diagnostic: {
        check,
        limit: limit ?? null,
        metrics: { ...metrics },
        observed: observed ?? null,
        stage: stage ?? "response_envelope",
      },
    });
  };
  const countText = (
    field: keyof typeof highSurrogate,
    value: string | null | undefined
  ) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    let bytes = encoder.encode(value).byteLength;
    const first = value.codePointAt(0);
    if (
      highSurrogate[field] &&
      first !== undefined &&
      first >= 0xdc_00 &&
      first <= 0xdf_ff
    ) {
      // Previously counted lone high surrogate (3 bytes) plus a new low surrogate becomes one 4-byte scalar.
      bytes -= 2;
    }
    const last = value.codePointAt(value.length - 1);
    highSurrogate[field] =
      last !== undefined && last >= 0xd8_00 && last <= 0xdb_ff;
    metrics.logicalTextBytes += bytes;
    if (metrics.logicalTextBytes > limits.logicalTextBytes) {
      reject(
        "logical_text_limit",
        "response_body_limit",
        metrics.logicalTextBytes,
        limits.logicalTextBytes
      );
    }
    if (field !== "reasoning" && field !== "reasoning_content") {
      metrics.retainedTextBytes += bytes;
    }
  };
  const recordTerminalUsage = (
    next: typeof PrivateDiscoveryProviderUsage.Type | null | undefined
  ) => {
    if (next === null || next === undefined) {
      return;
    }
    if (finishReason === undefined) {
      // Valid interim counters are snapshots, not completed usage or zero-cost evidence.
      return;
    }
    if (
      usage !== undefined &&
      (usage.prompt_tokens !== next.prompt_tokens ||
        usage.completion_tokens !== next.completion_tokens)
    ) {
      reject("usage_conflict");
    }
    usage = next;
  };
  const acceptChoice = (choice: (typeof Chunk.Type.choices)[number]) => {
    if (finishReason !== undefined) {
      reject("choice_after_finish");
    }
    const { delta } = choice;
    countText("content", delta.content);
    countText("refusal", delta.refusal);
    countText("reasoning", delta.reasoning);
    countText("reasoning_content", delta.reasoning_content);
    roleSeen ||= delta.role === "assistant";
    content += delta.content ?? "";
    if (delta.refusal !== undefined && delta.refusal !== null) {
      refusal = (refusal ?? "") + delta.refusal;
    }
    const [tool] = delta.tool_calls ?? [];
    if (tool !== undefined) {
      countText("id", tool.id);
      countText("name", tool.function?.name);
      countText("arguments", tool.function?.arguments);
      toolSeen = true;
      toolTypeSeen ||= tool.type === "function";
      toolId += tool.id ?? "";
      toolName += tool.function?.name ?? "";
      toolArguments += tool.function?.arguments ?? "";
    }
    if (choice.finish_reason !== null) {
      finishReason = choice.finish_reason;
    }
    recordTerminalUsage(choice.usage);
  };
  const decodeChunk = Schema.decodeUnknownOption(Chunk);
  const acceptEvent = (value: string) => {
    if (done) {
      reject("data_after_done");
    }
    if (value === "[DONE]") {
      if (finishReason === undefined) {
        reject("missing_finish", "incomplete_completion");
      }
      done = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return reject("event_json", "response_json");
    }
    const decoded = decodeChunk(parsed);
    if (decoded._tag === "None") {
      return reject("chunk_schema");
    }
    const { value: chunk } = decoded;
    if (
      (completionId !== undefined && completionId !== chunk.id) ||
      (model !== undefined && model !== chunk.model)
    ) {
      reject("completion_identity");
    }
    ({ id: completionId, model } = chunk);
    const [choice] = chunk.choices;
    if (choice === undefined) {
      if (finishReason === undefined) {
        reject("usage_event_before_finish");
      }
      if (finalUsageSeen) {
        reject("duplicate_usage_event");
      }
      if (chunk.usage === undefined || chunk.usage === null) {
        reject("missing_usage");
      }
      finalUsageSeen = true;
      recordTerminalUsage(chunk.usage);
      return;
    }
    acceptChoice(choice);
    recordTerminalUsage(chunk.usage);
  };
  const framing = new KimiDiscoveryFraming(metrics, reject, acceptEvent);
  const discard = () => {
    framing.clear();
    completionId = undefined;
    model = undefined;
    content = "";
    refusal = null;
    toolId = "";
    toolName = "";
    toolArguments = "";
    metrics.retainedTextBytes = 0;
  };
  const guarded = <T>(operation: () => T): T => {
    if (failure !== undefined) {
      throw failure;
    }
    try {
      if (closed) {
        reject("stream_closed");
      }
      return operation();
    } catch (error) {
      failure =
        error instanceof PrivateDiscoveryKimiStreamFailure
          ? error
          : new PrivateDiscoveryKimiStreamFailure({
              diagnostic: {
                check: "decoder_failure",
                limit: null,
                metrics: { ...metrics },
                observed: null,
                stage: "response_envelope",
              },
            });
      discard();
      throw failure;
    }
  };
  return {
    finish: (): typeof PrivateDiscoveryCompletion.Type =>
      guarded(() => {
        framing.finish();
        if (!done || finishReason === undefined) {
          return reject("missing_done", "incomplete_completion");
        }
        if (!roleSeen) {
          return reject("missing_role", "incomplete_completion");
        }
        if (toolSeen && (!toolTypeSeen || toolId.trim() === "")) {
          return reject("missing_tool_identity", "tool_call");
        }
        const completion: typeof PrivateDiscoveryCompletion.Type = {
          choices: [
            {
              finish_reason: finishReason,
              message: {
                content,
                refusal,
                role: "assistant",
                tool_calls: toolSeen
                  ? [
                      {
                        function: { arguments: toolArguments, name: toolName },
                        id: toolId,
                        type: "function",
                      },
                    ]
                  : [],
              },
            },
          ],
        };
        closed = true;
        discard();
        return usage === undefined ? completion : { ...completion, usage };
      }),
    push: (bytes: Uint8Array): void => guarded(() => framing.push(bytes)),
    readMetrics: () => ({ ...metrics }),
  };
};
