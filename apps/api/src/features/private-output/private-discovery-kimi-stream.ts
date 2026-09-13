import { Schema } from "effect";

import { PrivateDiscoveryProviderUsage } from "./private-discovery-completion.js";
import type { PrivateDiscoveryCompletion } from "./private-discovery-completion.js";
import { PrivateDiscoveryFailure } from "./private-discovery-model.js";
import type { PrivateDiscoveryInvalidOutputStage } from "./private-discovery-model.js";

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

const reject = (
  stage: PrivateDiscoveryInvalidOutputStage = "response_envelope"
): never => {
  throw new PrivateDiscoveryFailure({
    provenance: null,
    reason: "invalid_output",
    stage,
    usage: null,
  });
};

// SSE recognizes CR, LF and CRLF, and joins multiple data lines with LF.
const kimiEvents = function* kimiEvents(encoded: string) {
  let data: string[] = [];
  let event = "";
  const lines = encoded.replace(/^\uFEFF/u, "").split(/\r\n|\r|\n/u);
  const trailing = lines.pop();
  for (const line of lines) {
    if (line === "") {
      if (data.length !== 0) {
        if (event !== "" && event !== "message") {
          reject();
        }
        yield data.join("\n");
      }
      data = [];
      event = "";
      continue;
    }
    if (line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? "" : line.slice(colon + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "data") {
      data.push(value);
    } else if (field === "event") {
      event = value;
    }
  }
  if (data.length !== 0 || (trailing !== "" && !trailing?.startsWith(":"))) {
    reject("incomplete_completion");
  }
};

/** Decode a complete, bounded SSE body. This assembles deltas; it never repairs tool arguments. */
export const decodePrivateDiscoveryKimiStream = (
  encoded: string
): typeof PrivateDiscoveryCompletion.Type => {
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

  const recordUsage = (
    next: typeof PrivateDiscoveryProviderUsage.Type | null | undefined
  ) => {
    if (next === null || next === undefined) {
      return;
    }
    if (
      finishReason === undefined ||
      (usage !== undefined &&
        (usage.prompt_tokens !== next.prompt_tokens ||
          usage.completion_tokens !== next.completion_tokens))
    ) {
      reject();
    }
    usage = next;
  };

  const acceptChoice = (choice: (typeof Chunk.Type.choices)[number]) => {
    if (finishReason !== undefined) {
      reject();
    }
    const { delta } = choice;
    roleSeen ||= delta.role === "assistant";
    content += delta.content ?? "";
    if (delta.refusal !== undefined && delta.refusal !== null) {
      refusal = (refusal ?? "") + delta.refusal;
    }
    const [tool] = delta.tool_calls ?? [];
    if (tool !== undefined) {
      toolSeen = true;
      toolTypeSeen ||= tool.type === "function";
      // Moonshot documents ID, name and arguments as concatenated deltas at one index.
      toolId += tool.id ?? "";
      toolName += tool.function?.name ?? "";
      toolArguments += tool.function?.arguments ?? "";
    }
    if (choice.finish_reason !== null) {
      finishReason = choice.finish_reason;
    }
    recordUsage(choice.usage);
  };

  const acceptEvent = (value: string) => {
    if (done) {
      reject();
    }
    if (value === "[DONE]") {
      if (finishReason === undefined) {
        reject("incomplete_completion");
      }
      done = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return reject("response_json");
    }
    const decoded = Schema.decodeUnknownOption(Chunk)(parsed);
    if (decoded._tag === "None") {
      return reject();
    }
    const { value: chunk } = decoded;
    if (
      (completionId !== undefined && completionId !== chunk.id) ||
      (model !== undefined && model !== chunk.model)
    ) {
      reject();
    }
    ({ id: completionId, model } = chunk);
    const [choice] = chunk.choices;
    if (choice === undefined) {
      if (
        finishReason === undefined ||
        finalUsageSeen ||
        chunk.usage === undefined ||
        chunk.usage === null
      ) {
        reject();
      }
      finalUsageSeen = true;
      recordUsage(chunk.usage);
      return;
    }
    acceptChoice(choice);
    recordUsage(chunk.usage);
  };

  for (const value of kimiEvents(encoded)) {
    acceptEvent(value);
  }
  if (!done || !roleSeen || finishReason === undefined) {
    return reject("incomplete_completion");
  }
  if (toolSeen && (!toolTypeSeen || toolId.trim() === "")) {
    return reject("tool_call");
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
  return usage === undefined ? completion : { ...completion, usage };
};
