import * as Cloudflare from "alchemy/Cloudflare";
import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import { WorkflowStepContext } from "alchemy/Cloudflare/Workflows";
import { Cause, Clock, Effect, Option, Schema } from "effect";
import type { LanguageModel, Prompt } from "effect/unstable/ai";
import { Tool, Toolkit } from "effect/unstable/ai";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotProviderBudgetRuntime,
  isPilotProviderKnownZeroCostFailure,
  runPilotProviderDispatch,
} from "../pilots/pilot-provider-budget.js";
import type {
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  PilotProviderKnownZeroCostFailure,
  PilotProviderBudgetRepository,
  PilotProviderBudgetRuntimeShape,
} from "../pilots/pilot-provider-budget.js";
import type {
  ImportCorrelationId,
  ImportObservabilityTraceStoreShape,
} from "./import-observability.js";
import {
  ImportObservabilityTraceStore,
  emitImportObservabilityEvent,
} from "./import-observability.js";
import type {
  RecipeEvidenceAssembly,
  RecipeExtractionFailure,
  RecipeExtractorShape,
} from "./import-recipe-extractor.js";
import {
  RecipeExtractionSemantics,
  RecipeExtractorDescriptor,
} from "./import-recipe-extractor.js";
import type {
  SpeechTranscriberShape,
  SpeechTranscriptionFailure,
  SpeechTranscriptionInput,
} from "./import-speech-transcriber.js";
import { SpeechTranscript } from "./import-speech-transcriber.js";
import type {
  VisualEvidenceExtractionFailure,
  VisualEvidenceExtractionInput,
  VisualEvidenceExtractorShape,
} from "./import-visual-evidence-extractor.js";
import { visualEvidenceSemanticsForFrameCount } from "./import-visual-evidence-extractor.js";

const ProviderName = "cloudflare-workers-ai" as const;
export const InstalledSpeechModel =
  "@cf/openai/whisper-large-v3-turbo" as const;
export const InstalledVisualModel = "@cf/google/gemma-4-26b-a4b-it" as const;
export const InstalledRecipeModel =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

const ProviderTimeout = "150 seconds";
const SpeechMaximumCostMicroUsd = 50_000;
const VisualMaximumCostMicroUsd = 100_000;
const RecipeMaximumCostMicroUsd = 100_000;
const ProviderTransportUnavailableMessage =
  "provider_transport_unavailable" as const;

type SafeProviderFailureCode =
  | "insufficient_evidence"
  | "malformed_response"
  | "model_refusal"
  | "outcome_unknown"
  | "provider_unavailable"
  | "throttled"
  | "timeout";

interface ProviderDispatchRequest<A, E> {
  readonly dispatchId: string;
  readonly invoke: Effect.Effect<
    {
      readonly cost:
        | {
            readonly _tag: "Known";
            readonly actualCostMicroUsd: number;
          }
        | { readonly _tag: "Unknown" };
      readonly value: A;
    },
    E
  >;
  readonly maximumCostMicroUsd: number;
  readonly providerStage: "recipe" | "speech" | "visual";
  readonly providerStageId: string;
}

/** Mandatory dispatch gate used by every installed provider adapter. */
export interface ProviderDispatchGate {
  readonly run: <A, E>(
    input: ProviderDispatchRequest<A, E>
  ) => Effect.Effect<A, E | { readonly _tag: "ProviderDispatchRejected" }>;
}

const dispatchRejected = {
  _tag: "ProviderDispatchRejected",
} as const;

const retryDispatchId = (base: string, attempt: number) =>
  attempt === 1 ? base : `${base}:attempt:${attempt}`;

/** Compose the GAIA-161 reserve/claim/settle authority for adapter factories. */
export const makePilotProviderDispatchGate = (input: {
  readonly correlationId: ImportCorrelationId;
  readonly now: () => PilotBudgetTimestamp;
  readonly repository: PilotProviderBudgetRepository;
  readonly runId: PilotBudgetRunId;
  readonly runtime: PilotProviderBudgetRuntimeShape;
}): ProviderDispatchGate => ({
  run: <A, E>(request: ProviderDispatchRequest<A, E>) =>
    Effect.gen(function* runBudgetedAdapterDispatch() {
      const workflowContext = Option.getOrUndefined(
        yield* Effect.serviceOption(WorkflowStepContext)
      );
      const attempt =
        request.providerStage === "speech"
          ? (workflowContext?.attempt ?? 1)
          : 1;
      const timestamp = input.now();
      const reservation = {
        dispatchId: Schema.decodeUnknownSync(PilotBudgetDispatchId)(
          retryDispatchId(request.dispatchId, attempt)
        ),
        maximumCostMicroUsd: request.maximumCostMicroUsd,
        providerStageId: Schema.decodeUnknownSync(PilotBudgetProviderStageId)(
          request.providerStageId
        ),
        runId: input.runId,
        timestamp,
      };
      return yield* runPilotProviderDispatch({
        invoke: request.invoke,
        onDispatch: emitImportObservabilityEvent({
          correlationId: input.correlationId,
          event: "provider.dispatch",
          outcome: "started",
          providerStage: request.providerStage,
        }),
        onPoison: emitImportObservabilityEvent({
          correlationId: input.correlationId,
          event: "budget.poison",
          outcome: "poisoned",
          providerStage: request.providerStage,
        }),
        onReservation: emitImportObservabilityEvent({
          correlationId: input.correlationId,
          event: "budget.reservation",
          outcome: "reserved",
          providerStage: request.providerStage,
        }),
        onSettlement: (outcome) =>
          emitImportObservabilityEvent({
            correlationId: input.correlationId,
            event: "provider.settlement",
            outcome,
            providerStage: request.providerStage,
          }),
        ...(attempt > 1
          ? {
              previousAttempt: {
                ...reservation,
                dispatchId: Schema.decodeUnknownSync(PilotBudgetDispatchId)(
                  retryDispatchId(request.dispatchId, attempt - 1)
                ),
              },
            }
          : {}),
        repository: input.repository,
        reservation,
      });
    }).pipe(
      Effect.provideService(PilotProviderBudgetRuntime, input.runtime),
      Effect.flatMap((result) => {
        switch (result._tag) {
          case "Completed":
          case "CompletedUnknownCost": {
            return Effect.succeed(result.value);
          }
          case "AlreadySettled": {
            return Effect.fail(dispatchRejected);
          }
          default: {
            return Effect.fail(dispatchRejected);
          }
        }
      }),
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
      Effect.mapError((error) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          error._tag === "PilotProviderBudgetError"
        ) {
          return dispatchRejected;
        }
        return error as E | typeof dispatchRejected;
      })
    ),
});

const safeFailureCode = (
  cause: Cause.Cause<unknown>
): SafeProviderFailureCode => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const reason =
      typeof record["reason"] === "object" && record["reason"] !== null
        ? (record["reason"] as Record<string, unknown>)
        : record;
    const original =
      typeof record["cause"] === "object" && record["cause"] !== null
        ? (record["cause"] as Record<string, unknown>)
        : record;
    const tag = String(
      original["_tag"] ?? reason["_tag"] ?? record["_tag"] ?? ""
    ).toLowerCase();
    const status = original["status"] ?? reason["status"] ?? record["status"];
    if (status === 429 || tag.includes("rate") || tag.includes("throttl")) {
      return "throttled";
    }
    if (tag.includes("refusal") || tag.includes("contentfilter")) {
      return "model_refusal";
    }
  }
  return "provider_unavailable";
};

const isProviderTransportFailure = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as Record<string, unknown>;
  const reason =
    typeof record["reason"] === "object" && record["reason"] !== null
      ? (record["reason"] as Record<string, unknown>)
      : record;
  return reason["description"] === ProviderTransportUnavailableMessage;
};

export const failAfter = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  observability: {
    readonly correlationId: ImportCorrelationId;
    readonly providerStage: "recipe" | "speech" | "visual";
  }
): Effect.Effect<A, E | SafeProviderFailureCode, R> =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: ProviderTimeout,
      orElse: () => Effect.fail("timeout" as const),
    }),
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed timeout channel.
    Effect.tapError((error) =>
      error === "timeout"
        ? emitImportObservabilityEvent({
            correlationId: observability.correlationId,
            event: "provider.timeout",
            outcome: "timed_out",
            providerStage: observability.providerStage,
          })
        : Effect.void
    )
  );

const oneForcedToolCall = <Name extends string, S extends Schema.Top>(
  service: LanguageModel.Service,
  input: {
    readonly description: string;
    readonly name: Name;
    readonly prompt: Prompt.RawInput;
    readonly schema: S;
  },
  observability: {
    readonly correlationId: ImportCorrelationId;
    readonly providerStage: "recipe" | "visual";
    readonly traceStore: ImportObservabilityTraceStoreShape | undefined;
  }
): Effect.Effect<
  {
    readonly inputTokens: number | undefined;
    readonly outputTokens: number | undefined;
    readonly value: S["Type"];
  },
  SafeProviderFailureCode,
  S["DecodingServices"]
> => {
  const tool = Tool.dynamic(input.name, {
    description: input.description,
    // Keep the provider-facing contract strict while retaining the untrusted
    // arguments verbatim for the explicit fail-closed decode below. Tool.make
    // decodes parameters inside Effect's response schema first, where excess
    // object properties are stripped before this adapter can reject them.
    parameters: Tool.getJsonSchemaFromSchema(input.schema),
  });
  const toolkit = Toolkit.make(tool);
  return failAfter(
    service.generateText({
      disableToolCallResolution: true,
      prompt: input.prompt,
      toolChoice: { tool: input.name },
      toolkit,
    } as never),
    observability
  ).pipe(
    // The installed Alchemy model parses the raw gateway response before this
    // Effect can succeed. A failure here is therefore a decode failure unless
    // the enclosing timeout won the race.
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
    Effect.tapError((error) =>
      typeof error === "string" || isProviderTransportFailure(error)
        ? Effect.void
        : emitImportObservabilityEvent(
            {
              correlationId: observability.correlationId,
              event: "provider.decode",
              outcome: "malformed",
              providerStage: observability.providerStage,
            },
            observability.traceStore
          )
    ),
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
    Effect.mapError((error) =>
      typeof error === "string" ? error : safeFailureCode(Cause.fail(error))
    ),
    Effect.flatMap((response) => {
      const calls = (
        response.content as readonly {
          readonly name?: string;
          readonly params?: unknown;
          readonly type: string;
        }[]
      ).filter((part) => part.type === "tool-call");
      const [call] = calls;
      if (
        call === undefined ||
        calls.length !== 1 ||
        call.name !== input.name ||
        response.text.trim().length !== 0
      ) {
        return emitImportObservabilityEvent(
          {
            correlationId: observability.correlationId,
            event: "provider.decode",
            outcome: "malformed",
            providerStage: observability.providerStage,
          },
          observability.traceStore
        ).pipe(Effect.andThen(Effect.fail("insufficient_evidence" as const)));
      }
      return Schema.decodeUnknownEffect(input.schema, {
        onExcessProperty: "error",
      })(call.params).pipe(
        Effect.matchEffect({
          onFailure: () =>
            emitImportObservabilityEvent(
              {
                correlationId: observability.correlationId,
                event: "provider.decode",
                outcome: "malformed",
                providerStage: observability.providerStage,
              },
              observability.traceStore
            ).pipe(Effect.andThen(Effect.fail("malformed_response" as const))),
          onSuccess: (value) =>
            emitImportObservabilityEvent(
              {
                correlationId: observability.correlationId,
                event: "provider.decode",
                outcome: "succeeded",
                providerStage: observability.providerStage,
              },
              observability.traceStore
            ).pipe(
              Effect.as({
                inputTokens: response.usage.inputTokens.total,
                outputTokens: response.usage.outputTokens.total,
                value,
              })
            ),
        })
      );
    })
  );
};

const recipePromptText = (input: RecipeEvidenceAssembly) =>
  [
    "Extract only recipe facts supported by the supplied evidence. " +
      "Use unresolved states for every unsupported field. " +
      "If the accessible content is not food or not a recipe, keep recipe " +
      "facts unresolved and return no invented ingredients or instructions.",
    ...input.items.map((item) =>
      JSON.stringify({
        evidenceId: item.evidenceId,
        kind: item.kind,
        origin: item.origin,
        value: item.value,
      })
    ),
  ].join("\n");

const encodeBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

const visualToolPrompt = (
  input: VisualEvidenceExtractionInput
): Prompt.RawInput => [
  {
    content: [
      {
        text:
          "Record only visible text in these ordered source images. " +
          "Each image position is its zero-based frameIndex. " +
          "Do not infer ingredients, quantities, steps, or other unseen facts.",
        type: "text" as const,
      },
      ...input.frames.map((frame) => ({
        data: frame.bytes,
        mediaType: frame.mimeType,
        type: "file" as const,
      })),
    ],
    role: "user" as const,
  },
];

const adapterFailure = <Tag extends string>(
  tag: Tag,
  code: SafeProviderFailureCode
) => ({ _tag: tag, code });

const pricedTokenUsage = (
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  prices: {
    readonly inputMicroUsdPerToken: number;
    readonly outputMicroUsdPerToken: number;
  }
) => {
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    !Number.isSafeInteger(inputTokens) ||
    !Number.isSafeInteger(outputTokens) ||
    inputTokens <= 0 ||
    outputTokens <= 0
  ) {
    return { _tag: "Unknown" as const };
  }
  return {
    _tag: "Known" as const,
    actualCostMicroUsd: Math.ceil(
      inputTokens * prices.inputMicroUsdPerToken +
        outputTokens * prices.outputMicroUsdPerToken
    ),
  };
};

const workersAiGatewayOptions = (gatewayId: string) =>
  ({
    gateway: {
      collectLog: false,
      id: gatewayId,
      skipCache: true,
    },
    returnRawResponse: true,
  }) as const;

type WorkersAiBinding = Effect.Success<QueryGatewayClient["raw"]>;

const asUnknownRecord = (
  value: unknown
): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

const tokenCount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

const malformedProviderDecode = (
  observability: {
    readonly correlationId: ImportCorrelationId;
    readonly providerStage: "recipe";
    readonly traceStore: ImportObservabilityTraceStoreShape | undefined;
  },
  failure: "insufficient_evidence" | "malformed_response"
) =>
  emitImportObservabilityEvent(
    {
      correlationId: observability.correlationId,
      event: "provider.decode",
      outcome: "malformed",
      providerStage: observability.providerStage,
    },
    observability.traceStore
  ).pipe(Effect.andThen(Effect.fail(failure)));

/**
 * Llama's native Workers AI binding accepts unwrapped tool declarations and
 * returns native tool calls. Keep this seam separate from Alchemy's OpenAI
 * response adapter so the provider-facing schema and fail-closed decode match
 * the installed model's actual wire contract.
 */
const oneNativeWorkersAiToolCall = <Name extends string, S extends Schema.Top>(
  ai: WorkersAiBinding,
  model: string,
  input: {
    readonly description: string;
    readonly name: Name;
    readonly prompt: string;
    readonly schema: S;
  },
  observability: {
    readonly correlationId: ImportCorrelationId;
    readonly providerStage: "recipe";
    readonly traceStore: ImportObservabilityTraceStoreShape | undefined;
  }
): Effect.Effect<
  {
    readonly inputTokens: number | undefined;
    readonly outputTokens: number | undefined;
    readonly value: S["Type"];
  },
  SafeProviderFailureCode,
  S["DecodingServices"]
> =>
  failAfter(
    Effect.tryPromise({
      catch: (error) => error,
      try: () =>
        ai.run(
          model as never,
          {
            max_tokens: 16_384,
            messages: [{ content: input.prompt, role: "user" }],
            temperature: 0,
            tools: [
              {
                description: input.description,
                name: input.name,
                parameters: Tool.getJsonSchemaFromSchema(input.schema),
              },
            ],
          } as never
        ) as Promise<Response>,
    }),
    observability
  ).pipe(
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
    Effect.mapError((error) =>
      typeof error === "string"
        ? (error as SafeProviderFailureCode)
        : safeFailureCode(Cause.fail(error))
    ),
    Effect.flatMap((response) =>
      response.ok
        ? Effect.tryPromise({
            catch: () => "malformed_response" as const,
            try: () => response.json() as Promise<unknown>,
          }).pipe(
            Effect.matchEffect({
              onFailure: () =>
                malformedProviderDecode(observability, "malformed_response"),
              onSuccess: Effect.succeed,
            })
          )
        : Effect.fail(
            response.status === 429
              ? ("throttled" as const)
              : ("provider_unavailable" as const)
          )
    ),
    Effect.flatMap((payload) => {
      const record = asUnknownRecord(payload);
      const response = record?.["response"];
      const calls = record?.["tool_calls"];
      const call =
        Array.isArray(calls) && calls.length === 1
          ? asUnknownRecord(calls[0])
          : undefined;
      if (
        record === undefined ||
        call === undefined ||
        call["name"] !== input.name ||
        !(
          response === undefined ||
          response === null ||
          (typeof response === "string" && response.trim().length === 0)
        )
      ) {
        return malformedProviderDecode(observability, "insufficient_evidence");
      }
      const encodedArguments = call["arguments"];
      let argumentsValue: unknown = encodedArguments;
      if (typeof encodedArguments === "string") {
        try {
          argumentsValue = JSON.parse(encodedArguments) as unknown;
        } catch {
          return malformedProviderDecode(observability, "malformed_response");
        }
      }
      return Schema.decodeUnknownEffect(input.schema, {
        onExcessProperty: "error",
      })(argumentsValue).pipe(
        Effect.matchEffect({
          onFailure: () =>
            malformedProviderDecode(observability, "malformed_response"),
          onSuccess: (value) => {
            const usage = asUnknownRecord(record["usage"]);
            return emitImportObservabilityEvent(
              {
                correlationId: observability.correlationId,
                event: "provider.decode",
                outcome: "succeeded",
                providerStage: observability.providerStage,
              },
              observability.traceStore
            ).pipe(
              Effect.as({
                inputTokens: tokenCount(usage?.["prompt_tokens"]),
                outputTokens: tokenCount(usage?.["completion_tokens"]),
                value,
              })
            );
          },
        })
      );
    })
  );

const runWorkersAi = (
  ai: WorkersAiBinding,
  model: string,
  body: unknown,
  gatewayId: string
): Promise<Response> =>
  ai.run(
    model as never,
    body as never,
    workersAiGatewayOptions(gatewayId) as never
  ) as Promise<Response>;

/**
 * Keep the installed Alchemy LanguageModel composition while dispatching
 * through the account-bound Workers AI binding. The binding cannot express
 * AI Gateway's payload-suppression header, so the proxy disables provider-side
 * gateway logging at the final SDK boundary and relies on the redacted,
 * correlation-aware Worker observability events. It never touches the
 * universal gateway binding.
 */
const noLogWorkersAiClient = (
  client: QueryGatewayClient,
  correlationId: ImportCorrelationId,
  providerStage: "recipe" | "speech" | "visual",
  traceStore: ImportObservabilityTraceStoreShape | undefined
): QueryGatewayClient => ({
  ...client,
  raw: Effect.all([client.raw, client.id]).pipe(
    Effect.map(
      ([ai, gatewayId]) =>
        ({
          run: async (model: unknown, body: unknown) => {
            let response: Response;
            try {
              response = await runWorkersAi(ai, String(model), body, gatewayId);
            } catch (error) {
              if (isPilotProviderKnownZeroCostFailure(error)) {
                throw error;
              }
              // eslint-disable-next-line preserve-caught-error -- Provider payloads and transport errors must not cross this privacy boundary, including as Error.cause.
              throw new Error(ProviderTransportUnavailableMessage);
            }
            await Effect.runPromise(
              emitImportObservabilityEvent(
                {
                  correlationId,
                  event: "provider.response",
                  outcome: "received",
                  providerStage,
                },
                traceStore
              )
            );
            return response;
          },
        }) as WorkersAiBinding
    )
  ) as QueryGatewayClient["raw"],
});

export const makeInstalledVisualEvidenceExtractor = (input: {
  readonly client: QueryGatewayClient;
  readonly correlationId: ImportCorrelationId;
  readonly dispatch: ProviderDispatchGate;
  readonly model?: string;
}) =>
  Effect.gen(function* makeVisualAdapter() {
    const model = input.model ?? InstalledVisualModel;
    const traceStore = Option.getOrUndefined(
      yield* Effect.serviceOption(ImportObservabilityTraceStore)
    );
    const client = noLogWorkersAiClient(
      input.client,
      input.correlationId,
      "visual",
      traceStore
    );
    const service = yield* Cloudflare.AI.makeLanguageModel({
      client,
      model,
      parameters: { maxTokens: 8192, temperature: 0 },
    });
    return {
      extract: (request) =>
        request.frames.length === 0
          ? Effect.fail(
              adapterFailure(
                "VisualEvidenceExtractionFailure",
                "insufficient_evidence"
              )
            )
          : input.dispatch
              .run({
                dispatchId: request.dispatchId,
                invoke: failAfter(
                  Effect.gen(function* invokeVisualTool() {
                    const semanticsSchema =
                      visualEvidenceSemanticsForFrameCount(
                        request.frames.length
                      );
                    const { inputTokens, outputTokens, value } =
                      yield* oneForcedToolCall(
                        service,
                        {
                          description:
                            "Record only visible text and the bounded semantic outcome for the supplied ordered images.",
                          name: "record_visual_evidence",
                          prompt: visualToolPrompt(request),
                          schema: semanticsSchema,
                        },
                        {
                          correlationId: input.correlationId,
                          providerStage: "visual",
                          traceStore,
                        }
                      );
                    const observations = yield* Effect.all(
                      value.observations.map((observation) => {
                        const frame = request.frames[observation.frameIndex];
                        return frame === undefined
                          ? Effect.fail("malformed_response" as const)
                          : Effect.succeed({
                              ...observation,
                              kind: "visible_text" as const,
                              regions: [
                                {
                                  height: 1,
                                  width: 1,
                                  x: 0,
                                  y: 0,
                                },
                              ] as const,
                              timestampMilliseconds:
                                frame.timestampMilliseconds,
                            });
                      })
                    );
                    const meteredCost = pricedTokenUsage(
                      inputTokens,
                      outputTokens,
                      {
                        inputMicroUsdPerToken: 0.1,
                        outputMicroUsdPerToken: 0.3,
                      }
                    );
                    // A schema-valid response proves this bounded visual call
                    // completed. When the provider omits trustworthy usage,
                    // charge the reservation maximum against the safety ledger
                    // without representing it as known provider spend.
                    const cost =
                      meteredCost._tag === "Known"
                        ? meteredCost
                        : {
                            _tag: "Known" as const,
                            actualCostMicroUsd: VisualMaximumCostMicroUsd,
                          };
                    return {
                      cost,
                      value: {
                        cost: {
                          certainty: "estimated" as const,
                          currency: "USD" as const,
                          estimatedMicroUsd: cost.actualCostMicroUsd,
                        },
                        model,
                        observations,
                        outcome: value.outcome,
                        provider: ProviderName,
                        usage: {
                          inputBytes: request.frames.reduce(
                            (total, frame) => total + frame.bytes.byteLength,
                            0
                          ),
                          inputFrames: request.frames.length,
                          modelCalls: 1 as const,
                        },
                      },
                    };
                  }),
                  {
                    correlationId: input.correlationId,
                    providerStage: "visual",
                  }
                ).pipe(
                  // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
                  Effect.mapError((error) => {
                    if (isPilotProviderKnownZeroCostFailure(error)) {
                      return error;
                    }
                    return typeof error === "string"
                      ? error
                      : safeFailureCode(Cause.fail(error));
                  })
                ),
                maximumCostMicroUsd: VisualMaximumCostMicroUsd,
                providerStage: "visual",
                providerStageId: "visual-evidence",
              })
              .pipe(
                Effect.mapError(
                  // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the adapter error contract.
                  (error): VisualEvidenceExtractionFailure =>
                    adapterFailure(
                      "VisualEvidenceExtractionFailure",
                      typeof error === "object" ? "outcome_unknown" : error
                    )
                )
              ),
    } satisfies VisualEvidenceExtractorShape;
  });

export const makeInstalledRecipeExtractor = (input: {
  readonly client: QueryGatewayClient;
  readonly correlationId: ImportCorrelationId;
  readonly dispatch: ProviderDispatchGate;
  readonly model?: string;
}) =>
  Effect.gen(function* makeRecipeAdapter() {
    const model = input.model ?? InstalledRecipeModel;
    const traceStore = Option.getOrUndefined(
      yield* Effect.serviceOption(ImportObservabilityTraceStore)
    );
    const client = noLogWorkersAiClient(
      input.client,
      input.correlationId,
      "recipe",
      traceStore
    );
    const ai = yield* client.raw;
    return {
      descriptor: Schema.decodeUnknownSync(RecipeExtractorDescriptor)({
        model,
        provider: ProviderName,
        version: "installed-native-forced-tool-v1",
      }),
      extract: (request) =>
        input.dispatch
          .run({
            dispatchId: `recipe:${request.importId}:${request.generation}:${request.evidenceFingerprint}`,
            invoke: Effect.gen(function* extractRecipeSemantics() {
              const startedAt = yield* Clock.currentTimeMillis;
              const { inputTokens, outputTokens, value } =
                yield* oneNativeWorkersAiToolCall(
                  ai,
                  model,
                  {
                    description:
                      "Record only provenance-backed recipe facts and unresolved fields.",
                    name: "record_recipe",
                    prompt: recipePromptText(request),
                    schema: RecipeExtractionSemantics,
                  },
                  {
                    correlationId: input.correlationId,
                    providerStage: "recipe",
                    traceStore,
                  }
                );
              const completedAt = yield* Clock.currentTimeMillis;
              const cost = pricedTokenUsage(inputTokens, outputTokens, {
                inputMicroUsdPerToken: 0.29,
                outputMicroUsdPerToken: 2.25,
              });
              return {
                cost,
                value: {
                  ...value,
                  cost: {
                    certainty: "estimated" as const,
                    currency: "USD" as const,
                    estimatedMicroUsd:
                      cost._tag === "Known"
                        ? cost.actualCostMicroUsd
                        : RecipeMaximumCostMicroUsd,
                  },
                  usage: {
                    inputEvidenceItems: request.items.length,
                    inputTokens: inputTokens ?? 0,
                    latencyMilliseconds: Math.max(0, completedAt - startedAt),
                    modelCalls: 1 as const,
                    outputTokens: outputTokens ?? 0,
                  },
                },
              };
            }),
            maximumCostMicroUsd: RecipeMaximumCostMicroUsd,
            providerStage: "recipe",
            providerStageId: "recipe-extraction",
          })
          .pipe(
            Effect.mapError(
              // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the adapter error contract.
              (error): RecipeExtractionFailure =>
                adapterFailure(
                  "RecipeExtractionFailure",
                  typeof error === "object" ? "outcome_unknown" : error
                )
            )
          ),
    } satisfies RecipeExtractorShape;
  });

const SpeechProviderResponse = Schema.Struct({
  text: SpeechTranscript.fields.text,
  transcription_info: Schema.optionalKey(
    Schema.Struct({
      duration: Schema.optionalKey(
        Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
      ),
      duration_after_vad: Schema.optionalKey(
        Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
      ),
      language: Schema.optionalKey(Schema.String),
      language_probability: Schema.optionalKey(
        Schema.Number.pipe(
          Schema.check(
            Schema.isGreaterThanOrEqualTo(0),
            Schema.isLessThanOrEqualTo(1)
          )
        )
      ),
    })
  ),
  word_count: Schema.optionalKey(
    Schema.Number.pipe(
      Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
    )
  ),
});

const decodeSpeechResponse = Schema.decodeUnknownOption(
  SpeechProviderResponse,
  {
    onExcessProperty: "ignore",
  }
);

const speechFailure = (
  code: SafeProviderFailureCode
): SpeechTranscriptionFailure =>
  adapterFailure("SpeechTranscriptionFailure", code);

type SpeechDispatchOutcome =
  | {
      readonly _tag: "Failed";
      readonly code: "malformed_response";
    }
  | {
      readonly _tag: "Transcribed";
      readonly transcript: SpeechTranscript;
    };

export const makeInstalledSpeechTranscriber = (input: {
  readonly client: QueryGatewayClient;
  readonly correlationId: ImportCorrelationId;
  readonly dispatch: ProviderDispatchGate;
  readonly model?: string;
}) =>
  Effect.gen(function* makeSpeechAdapter() {
    const model = input.model ?? InstalledSpeechModel;
    const traceStore = Option.getOrUndefined(
      yield* Effect.serviceOption(ImportObservabilityTraceStore)
    );
    const ai = yield* input.client.raw;
    const gatewayId = yield* input.client.id;
    return {
      transcribe: (request: SpeechTranscriptionInput) =>
        Effect.gen(function* transcribeSpeech() {
          const estimatedCostMicroUsd = Math.ceil(
            (request.audio.durationMilliseconds * 510) / 60_000
          );
          if (
            estimatedCostMicroUsd <= 0 ||
            estimatedCostMicroUsd > SpeechMaximumCostMicroUsd
          ) {
            return yield* Effect.fail("insufficient_evidence" as const);
          }
          const outcome = yield* input.dispatch.run({
            dispatchId: request.dispatchId,
            invoke: failAfter(
              Effect.gen(function* invokeSpeech() {
                const response = yield* Effect.tryPromise({
                  catch: (error) =>
                    isPilotProviderKnownZeroCostFailure(error)
                      ? error
                      : safeFailureCode(Cause.fail(error)),
                  try: () =>
                    runWorkersAi(
                      ai,
                      model,
                      {
                        audio: encodeBase64(request.audio.bytes),
                        condition_on_previous_text: false,
                        language: "en",
                        task: "transcribe",
                        vad_filter: true,
                      },
                      gatewayId
                    ),
                });
                yield* emitImportObservabilityEvent(
                  {
                    correlationId: input.correlationId,
                    event: "provider.response",
                    outcome: "received",
                    providerStage: "speech",
                  },
                  traceStore
                );
                if (!response.ok) {
                  return yield* Effect.fail({ status: response.status });
                }
                const raw = Option.getOrUndefined(
                  yield* Effect.tryPromise({
                    catch: () => "malformed_response" as const,
                    try: () => response.json(),
                  }).pipe(Effect.option)
                );
                const decoded = Option.getOrUndefined(
                  decodeSpeechResponse(raw)
                );
                const transcript =
                  decoded === undefined
                    ? Option.none()
                    : Schema.decodeUnknownOption(SpeechTranscript)({
                        cost: {
                          certainty: "estimated",
                          currency: "USD",
                          estimatedMicroUsd: estimatedCostMicroUsd,
                        },
                        detectedLanguage: "en",
                        model,
                        provider: ProviderName,
                        segments: [
                          {
                            endMilliseconds: request.audio.durationMilliseconds,
                            startMilliseconds: 0,
                            text: decoded.text,
                          },
                        ],
                        text: decoded.text,
                        usage: {
                          audioDurationMilliseconds:
                            request.audio.durationMilliseconds,
                          inputBytes: request.audio.bytes.byteLength,
                        },
                      });
                yield* emitImportObservabilityEvent(
                  {
                    correlationId: input.correlationId,
                    event: "provider.decode",
                    outcome: Option.isSome(transcript)
                      ? "succeeded"
                      : "malformed",
                    providerStage: "speech",
                  },
                  traceStore
                );
                return {
                  cost: {
                    _tag: "Known" as const,
                    actualCostMicroUsd: estimatedCostMicroUsd,
                  },
                  value: Option.match(transcript, {
                    onNone: () =>
                      ({
                        _tag: "Failed",
                        code: "malformed_response",
                      }) satisfies SpeechDispatchOutcome,
                    onSome: (value) =>
                      ({
                        _tag: "Transcribed",
                        transcript: value,
                      }) satisfies SpeechDispatchOutcome,
                  }),
                };
              }),
              {
                correlationId: input.correlationId,
                providerStage: "speech",
              }
            ).pipe(
              Effect.mapError((error) => {
                if (isPilotProviderKnownZeroCostFailure(error)) {
                  return error as PilotProviderKnownZeroCostFailure<SafeProviderFailureCode>;
                }
                return typeof error === "string"
                  ? error
                  : safeFailureCode(Cause.fail(error));
              })
            ),
            maximumCostMicroUsd: SpeechMaximumCostMicroUsd,
            providerStage: "speech",
            providerStageId: "speech-transcription",
          });
          if (outcome._tag === "Failed") {
            return yield* Effect.fail(outcome.code);
          }
          return outcome.transcript;
        }).pipe(
          // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the adapter error contract.
          Effect.mapError((error) =>
            speechFailure(
              typeof error === "object"
                ? "outcome_unknown"
                : (error as SafeProviderFailureCode)
            )
          )
        ),
    } satisfies SpeechTranscriberShape;
  });
