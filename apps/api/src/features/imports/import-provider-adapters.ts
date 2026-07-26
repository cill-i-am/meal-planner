import * as Cloudflare from "alchemy/Cloudflare";
import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import { Cause, Effect, Option, Schema } from "effect";
import type { LanguageModel, Prompt } from "effect/unstable/ai";
import { Tool, Toolkit } from "effect/unstable/ai";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotProviderBudgetRuntime,
  runPilotProviderDispatch,
} from "../pilots/pilot-provider-budget.js";
import type {
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  PilotProviderBudgetRepository,
  PilotProviderBudgetRuntimeShape,
} from "../pilots/pilot-provider-budget.js";
import type {
  RecipeEvidenceAssembly,
  RecipeExtractionFailure,
  RecipeExtractorShape,
} from "./import-recipe-extractor.js";
import {
  RecipeExtraction,
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
import { VisualEvidence } from "./import-visual-evidence-extractor.js";

const ProviderName = "cloudflare-workers-ai" as const;
export const InstalledSpeechModel =
  "@cf/openai/whisper-large-v3-turbo" as const;
export const InstalledVisualModel =
  "@cf/meta/llama-3.2-11b-vision-instruct" as const;
export const InstalledRecipeModel =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

const ProviderTimeout = "60 seconds";
const SpeechMaximumCostMicroUsd = 50_000;
const VisualMaximumCostMicroUsd = 100_000;
const RecipeMaximumCostMicroUsd = 100_000;

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

/** Compose the GAIA-161 reserve/claim/settle authority for adapter factories. */
export const makePilotProviderDispatchGate = (input: {
  readonly now: () => PilotBudgetTimestamp;
  readonly repository: PilotProviderBudgetRepository;
  readonly runId: PilotBudgetRunId;
  readonly runtime: PilotProviderBudgetRuntimeShape;
}): ProviderDispatchGate => ({
  run: <A, E>(request: ProviderDispatchRequest<A, E>) =>
    runPilotProviderDispatch({
      invoke: request.invoke,
      repository: input.repository,
      reservation: {
        dispatchId: Schema.decodeUnknownSync(PilotBudgetDispatchId)(
          request.dispatchId
        ),
        maximumCostMicroUsd: request.maximumCostMicroUsd,
        providerStageId: Schema.decodeUnknownSync(PilotBudgetProviderStageId)(
          request.providerStageId
        ),
        runId: input.runId,
        timestamp: input.now(),
      },
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
    const tag = String(reason["_tag"] ?? record["_tag"] ?? "").toLowerCase();
    const status = reason["status"] ?? record["status"];
    if (status === 429 || tag.includes("rate") || tag.includes("throttl")) {
      return "throttled";
    }
    if (tag.includes("refusal") || tag.includes("contentfilter")) {
      return "model_refusal";
    }
  }
  return "provider_unavailable";
};

const failAfter = <A, E>(
  effect: Effect.Effect<A, E>
): Effect.Effect<A, E | SafeProviderFailureCode> =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: ProviderTimeout,
      orElse: () => Effect.fail("timeout" as const),
    })
  );

const oneForcedToolCall = <Name extends string, S extends Schema.Top>(
  service: LanguageModel.Service,
  input: {
    readonly description: string;
    readonly name: Name;
    readonly prompt: Prompt.RawInput;
    readonly schema: S;
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
  const tool = Tool.make(input.name, {
    description: input.description,
    parameters: input.schema,
  });
  const toolkit = Toolkit.make(tool);
  return failAfter(
    service.generateText({
      disableToolCallResolution: true,
      prompt: input.prompt,
      toolChoice: { tool: input.name },
      toolkit,
    } as never)
  ).pipe(
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
        return Effect.fail("insufficient_evidence" as const);
      }
      return Schema.decodeUnknownEffect(input.schema, {
        onExcessProperty: "error",
      })(call.params).pipe(
        Effect.map((value) => ({
          inputTokens: response.usage.inputTokens.total,
          outputTokens: response.usage.outputTokens.total,
          value,
        })),
        Effect.mapError(() => "malformed_response" as const)
      );
    })
  );
};

const recipePrompt = (input: RecipeEvidenceAssembly): Prompt.RawInput => [
  {
    content: [
      {
        text:
          "Extract only recipe facts supported by the supplied evidence. " +
          "Use unresolved states for every unsupported field. " +
          "If the accessible content is not food or not a recipe, keep recipe " +
          "facts unresolved and return no invented ingredients or instructions.",
        type: "text",
      },
      ...input.items.map((item) => ({
        text: JSON.stringify({
          evidenceId: item.evidenceId,
          kind: item.kind,
          origin: item.origin,
          value: item.value,
        }),
        type: "text" as const,
      })),
    ],
    role: "user" as const,
  },
];

const visualPrompt = (
  input: VisualEvidenceExtractionInput
): Prompt.RawInput => [
  {
    content: [
      {
        text:
          "Record only visible text in these ordered source images. " +
          "Do not infer ingredients, quantities, steps, or other unseen facts.",
        type: "text",
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

export const makeInstalledVisualEvidenceExtractor = (input: {
  readonly client: QueryGatewayClient;
  readonly dispatch: ProviderDispatchGate;
  readonly model?: string;
}) =>
  Effect.gen(function* makeVisualAdapter() {
    const model = input.model ?? InstalledVisualModel;
    const service = yield* Cloudflare.AI.makeLanguageModel({
      client: input.client,
      model,
      parameters: { maxTokens: 8192, temperature: 0 },
    });
    return {
      extract: (request) =>
        input.dispatch
          .run({
            dispatchId: request.dispatchId,
            invoke: oneForcedToolCall(service, {
              description: "Record bounded visual evidence from source images.",
              name: "record_visual_evidence",
              prompt: visualPrompt(request),
              schema: VisualEvidence,
            }).pipe(
              Effect.map(({ inputTokens, outputTokens, value }) => {
                const cost = pricedTokenUsage(inputTokens, outputTokens, {
                  inputMicroUsdPerToken: 0.049,
                  outputMicroUsdPerToken: 0.68,
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
                          : VisualMaximumCostMicroUsd,
                    },
                  },
                };
              })
            ),
            maximumCostMicroUsd: VisualMaximumCostMicroUsd,
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
  readonly dispatch: ProviderDispatchGate;
  readonly model?: string;
}) =>
  Effect.gen(function* makeRecipeAdapter() {
    const model = input.model ?? InstalledRecipeModel;
    const service = yield* Cloudflare.AI.makeLanguageModel({
      client: input.client,
      model,
      parameters: { maxTokens: 16_384, temperature: 0 },
    });
    return {
      descriptor: Schema.decodeUnknownSync(RecipeExtractorDescriptor)({
        model,
        provider: ProviderName,
        version: "installed-forced-tool-v1",
      }),
      extract: (request) =>
        input.dispatch
          .run({
            dispatchId: `recipe:${request.importId}:${request.generation}:${request.evidenceFingerprint}`,
            invoke: oneForcedToolCall(service, {
              description:
                "Record only provenance-backed recipe facts and unresolved fields.",
              name: "record_recipe",
              prompt: recipePrompt(request),
              schema: RecipeExtraction,
            }).pipe(
              Effect.map(({ inputTokens, outputTokens, value }) => {
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
                      ...value.usage,
                      inputTokens: inputTokens ?? 0,
                      outputTokens: outputTokens ?? 0,
                    },
                  },
                };
              })
            ),
            maximumCostMicroUsd: RecipeMaximumCostMicroUsd,
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
  transcription_info: Schema.Struct({
    text: SpeechTranscript.fields.text,
    word_count: Schema.Number.pipe(
      Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
    ),
  }),
});

const decodeSpeechResponse = Schema.decodeUnknownEffect(
  SpeechProviderResponse,
  {
    onExcessProperty: "ignore",
  }
);

const speechFailure = (
  code: SafeProviderFailureCode
): SpeechTranscriptionFailure =>
  adapterFailure("SpeechTranscriptionFailure", code);

export const makeInstalledSpeechTranscriber = (input: {
  readonly client: QueryGatewayClient;
  readonly dispatch: ProviderDispatchGate;
  readonly model?: string;
}) =>
  Effect.gen(function* makeSpeechAdapter() {
    const model = input.model ?? InstalledSpeechModel;
    const ai = yield* input.client.raw;
    const gatewayId = yield* input.client.id;
    return {
      transcribe: (request: SpeechTranscriptionInput) =>
        input.dispatch
          .run({
            dispatchId: request.dispatchId,
            invoke: failAfter(
              Effect.gen(function* invokeSpeech() {
                const response = yield* Effect.tryPromise({
                  catch: (error) => error,
                  try: () =>
                    ai.run(
                      model as never,
                      {
                        audio: [...request.audio.bytes],
                        condition_on_previous_text: false,
                        language: "en",
                        task: "transcribe",
                        vad_filter: true,
                      } as never,
                      {
                        gateway: { id: gatewayId },
                        returnRawResponse: true,
                      }
                    ),
                });
                if (!(response as Response).ok) {
                  return yield* Effect.fail({
                    _tag: "ProviderHttpError",
                    status: (response as Response).status,
                  });
                }
                const raw = yield* Effect.tryPromise({
                  catch: () => "malformed_response" as const,
                  try: () => (response as Response).json(),
                });
                const decoded = yield* decodeSpeechResponse(raw).pipe(
                  Effect.mapError(() => "malformed_response" as const)
                );
                if (decoded.text !== decoded.transcription_info.text) {
                  return yield* Effect.fail("malformed_response" as const);
                }
                const estimatedCostMicroUsd = Math.ceil(
                  (request.audio.durationMilliseconds * 510) / 60_000
                );
                if (
                  estimatedCostMicroUsd <= 0 ||
                  estimatedCostMicroUsd > SpeechMaximumCostMicroUsd
                ) {
                  return yield* Effect.fail("insufficient_evidence" as const);
                }
                return {
                  cost: {
                    _tag: "Known" as const,
                    actualCostMicroUsd: estimatedCostMicroUsd,
                  },
                  value: Schema.decodeUnknownSync(SpeechTranscript)({
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
                  }),
                };
              })
            ).pipe(
              // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks normalize provider failures.
              Effect.mapError((error) =>
                typeof error === "string"
                  ? error
                  : safeFailureCode(Cause.fail(error))
              )
            ),
            maximumCostMicroUsd: SpeechMaximumCostMicroUsd,
            providerStageId: "speech-transcription",
          })
          .pipe(
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
