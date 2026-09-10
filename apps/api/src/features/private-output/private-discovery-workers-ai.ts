import type * as NativeCloudflare from "@cloudflare/workers-types";
import { Effect, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";

import {
  makePrivateDiscoveryProviderOutput,
  PRIVATE_DISCOVERY_CONTEXT_BYTES,
  PRIVATE_DISCOVERY_POLICY_VERSION,
  PRIVATE_DISCOVERY_PROMPT_VERSION,
  PRIVATE_DISCOVERY_TOOL_VERSION,
  PrivateDiscoveryContext,
  PrivateDiscoveryFailure,
  PrivateDiscoveryOutput,
} from "./private-discovery-model.js";
import type {
  PrivateDiscoveryInvalidOutputStage,
  PrivateDiscoveryModel,
  PrivateDiscoveryProvenance,
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
    Schema.check(Schema.isBetween({ maximum: 4096, minimum: 1 }))
  ),
  model: Schema.Literals([
    "@cf/qwen/qwen3-30b-a3b-fp8",
    "@cf/openai/gpt-oss-120b",
    "@cf/moonshotai/kimi-k2.6",
  ]),
  outputUsdPerMillionTokens: PositiveAmount,
  timeoutMs: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 120_000, minimum: 1000 }))
  ),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
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
const TokenCount = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);
const ProviderUsage = Schema.Struct({
  completion_tokens: TokenCount,
  prompt_tokens: TokenCount,
});
const Completion = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      finish_reason: Schema.String,
      message: Schema.Struct({
        content: Schema.NullOr(Schema.String),
        refusal: Schema.optionalKey(Schema.NullOr(Schema.String)),
        role: Schema.Literal("assistant"),
      }),
    })
  ).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1))),
  usage: Schema.optionalKey(ProviderUsage),
});
const configuration = Schema.decodeUnknownOption(
  Schema.fromJsonString(PrivateDiscoveryConfiguration)
);

const requestFor = (
  config: PrivateDiscoveryConfiguration,
  context: PrivateDiscoveryContext
) => {
  const outputJsonSchema = Tool.getJsonSchemaFromSchema(
    makePrivateDiscoveryProviderOutput(context.cards)
  );
  const systemInstructions = `${privateDiscoveryInstructions}\n\nOutput JSON schema:\n${JSON.stringify(outputJsonSchema)}`;
  const messages = [
    { content: systemInstructions, role: "system" as const },
    { content: JSON.stringify(context), role: "user" as const },
  ];
  if (config.model === "@cf/moonshotai/kimi-k2.6") {
    return {
      body: {
        chat_template_kwargs: { thinking: false },
        max_completion_tokens: config.maxOutputTokens,
        messages,
        n: 1,
        response_format: { type: "json_object" as const },
        stream: false as const,
        temperature: 0.6,
        top_p: 0.95,
      },
      model: config.model,
    };
  }
  return {
    body: {
      max_tokens: config.maxOutputTokens,
      messages,
      response_format: {
        json_schema: outputJsonSchema,
        type: "json_schema" as const,
      },
      stream: false as const,
      ...(config.model === "@cf/openai/gpt-oss-120b"
        ? { temperature: 1, top_p: 1 }
        : { temperature: 0.6, top_k: 20, top_p: 0.95 }),
    },
    model: config.model,
  };
};

const readBoundedResponse = async (
  response: NativeCloudflare.Response,
  signal: AbortSignal
) => {
  if (response.body === null) {
    throw failure("invalid_output", null, null, "response_body_missing");
  }
  const reader = response.body.getReader();
  const cancel = () => {
    // Cancellation is best effort; a stalled provider must not hold the deadline open.
    // oxlint-disable-next-line promise/prefer-await-to-then -- The cancellation request must not await a stalled provider cleanup promise.
    void reader.cancel().catch(() => null);
  };
  signal.addEventListener("abort", cancel, { once: true });
  let length = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    signal.throwIfAborted();
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- A stream reader has one ordered consumer; parallel reads would bypass the byte limit.
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) {
        break;
      }
      length += part.value.byteLength;
      if (length > PRIVATE_DISCOVERY_RESPONSE_BYTES) {
        throw failure("invalid_output", null, null, "response_body_limit");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
};

/** One native provider call, guarded at dispatch; no retries or private logging. */
export const makePrivateDiscoveryModel = (
  environment: PrivateDiscoveryModelEnvironment
): PrivateDiscoveryModel => ({
  generate: (input) =>
    Effect.gen(function* generatePrivateDiscovery() {
      const configured = configuration(environment.PRIVATE_DISCOVERY_CONFIG);
      const ai = environment.PrivateDiscoveryAI;
      if (Option.isNone(configured) || ai === undefined) {
        return yield* Effect.fail(failure("not_configured"));
      }
      const config = configured.value;
      const provenance: PrivateDiscoveryProvenance = {
        model: config.model,
        policyVersion: PRIVATE_DISCOVERY_POLICY_VERSION,
        promptVersion: PRIVATE_DISCOVERY_PROMPT_VERSION,
        provider: "cloudflare-workers-ai",
        toolVersion: PRIVATE_DISCOVERY_TOOL_VERSION,
      };
      const configuredFailure = (
        reason: PrivateDiscoveryFailure["reason"],
        usage: PrivateDiscoveryUsage | null = null,
        stage: PrivateDiscoveryInvalidOutputStage | null = null
      ) => failure(reason, usage, provenance, stage);
      const context = yield* Schema.decodeUnknownEffect(
        PrivateDiscoveryContext,
        { onExcessProperty: "error" }
      )(input.context).pipe(
        Effect.mapError(() => configuredFailure("context_limit"))
      );
      const request = requestFor(config, context);
      const encoder = new TextEncoder();
      if (
        encoder.encode(JSON.stringify(context)).byteLength >
          PRIVATE_DISCOVERY_CONTEXT_BYTES ||
        encoder.encode(JSON.stringify(request.body)).byteLength >
          PRIVATE_DISCOVERY_INPUT_BYTES
      ) {
        return yield* Effect.fail(configuredFailure("context_limit"));
      }
      return yield* Effect.gen(function* callPrivateDiscoveryProvider() {
        const encoded = yield* Effect.tryPromise({
          catch: (error) =>
            error instanceof PrivateDiscoveryFailure
              ? error
              : configuredFailure("outcome_unknown"),
          try: async (signal) => {
            const transportSignal = AbortSignal.any([input.signal, signal]);
            const options = {
              extraHeaders: { "cf-aig-max-attempts": "1" },
              gateway: {
                collectLog: false,
                id: config.gatewayId,
                skipCache: true,
              },
              returnRawResponse: true as const,
              // SAFETY: The Workers and DOM libraries describe the same runtime signal with
              // incompatible event-listener overloads at this native API boundary.
              signal:
                transportSignal as unknown as NativeCloudflare.AbortSignal,
            };
            if (options.signal.aborted) {
              throw configuredFailure("outcome_unknown");
            }
            input.beforeDispatch(provenance);
            const response = await ai.run(request.model, request.body, options);
            if (!response.ok) {
              void response.body?.cancel().catch(() => null);
              throw configuredFailure("provider_unavailable");
            }
            try {
              return await readBoundedResponse(response, transportSignal);
            } catch (error) {
              if (transportSignal.aborted) {
                throw configuredFailure("outcome_unknown");
              }
              throw configuredFailure(
                "invalid_output",
                null,
                error instanceof PrivateDiscoveryFailure && error.stage !== null
                  ? error.stage
                  : "response_body_read"
              );
            }
          },
        });
        const envelope = yield* Effect.try({
          catch: () =>
            configuredFailure("invalid_output", null, "response_json"),
          try: (): unknown => JSON.parse(encoded),
        });
        const completion = yield* Schema.decodeUnknownEffect(Completion)(
          envelope
        ).pipe(
          Effect.mapError(() =>
            configuredFailure("invalid_output", null, "response_envelope")
          )
        );
        const usage: PrivateDiscoveryUsage =
          completion.usage === undefined
            ? { estimatedCostUsd: null, inputTokens: null, outputTokens: null }
            : {
                estimatedCostUsd:
                  (completion.usage.prompt_tokens *
                    config.inputUsdPerMillionTokens +
                    completion.usage.completion_tokens *
                      config.outputUsdPerMillionTokens) /
                  1_000_000,
                inputTokens: completion.usage.prompt_tokens,
                outputTokens: completion.usage.completion_tokens,
              };
        const [choice] = completion.choices;
        if (choice === undefined) {
          return yield* Effect.fail(
            configuredFailure("invalid_output", usage, "response_envelope")
          );
        }
        if (
          choice.message.refusal !== undefined &&
          choice.message.refusal !== null
        ) {
          return yield* Effect.fail(configuredFailure("refused", usage));
        }
        if (choice.finish_reason !== "stop") {
          return yield* Effect.fail(
            configuredFailure("invalid_output", usage, "incomplete_completion")
          );
        }
        const { content } = choice.message;
        if (content === null) {
          return yield* Effect.fail(
            configuredFailure("invalid_output", usage, "missing_content")
          );
        }
        const decoded = yield* Effect.try({
          catch: () =>
            configuredFailure("invalid_output", usage, "output_json"),
          try: (): unknown => JSON.parse(content),
        });
        const output = yield* Schema.decodeUnknownEffect(
          PrivateDiscoveryOutput,
          { onExcessProperty: "error" }
        )(decoded).pipe(
          Effect.mapError(() =>
            configuredFailure("invalid_output", usage, "output_schema")
          )
        );
        return {
          output,
          provenance,
          usage,
        };
      }).pipe(
        Effect.timeoutOrElse({
          duration: config.timeoutMs,
          orElse: () => Effect.fail(configuredFailure("outcome_unknown")),
        })
      );
    }),
});
