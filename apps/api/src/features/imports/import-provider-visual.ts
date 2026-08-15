import * as Cloudflare from "alchemy/Cloudflare";
import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import { Cause, Effect, Option } from "effect";
import type { Prompt } from "effect/unstable/ai";

import { isPilotProviderKnownZeroCostFailure } from "../pilots/pilot-provider-budget.js";
import type { ImportCorrelationId } from "./import-observability.js";
import { ImportObservabilityTraceStore } from "./import-observability.js";
import {
  ProviderName,
  adapterFailure,
  isSafeProviderFailureCode,
  noLogWorkersAiClient,
  oneForcedToolCall,
  pricedTokenUsage,
  safeFailureCode,
} from "./import-provider-kernel.js";
import type { ProviderDispatchGate } from "./import-provider-kernel.js";
import type {
  VisualEvidenceExtractionFailure,
  VisualEvidenceExtractorShape,
  VisualFrameArtifact,
} from "./import-visual-evidence-extractor.js";
import {
  projectVisualProviderSemanticsInput,
  representativeVisualFrameIndex,
  VisualEvidenceProviderSemantics,
  VisualEvidenceProviderToolArguments,
  visualEvidenceOutcomeForObservations,
} from "./import-visual-evidence-extractor.js";

export const InstalledVisualModel =
  "@cf/meta/llama-4-scout-17b-16e-instruct" as const;

const VisualMaximumCostMicroUsd = 100_000;

const visualPrompt = (frame: VisualFrameArtifact): Prompt.RawInput => [
  {
    content: [
      {
        text:
          "Record only visible text in the provided source image. " +
          "The adapter owns the source frame identity and timing. " +
          "Do not infer ingredients, quantities, steps, or other unseen facts.",
        type: "text",
      },
      {
        data: frame.bytes,
        mediaType: frame.mimeType,
        type: "file",
      },
    ],
    role: "user",
  },
];

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
                invoke: Effect.gen(function* invokeVisualForcedTool() {
                  const frameIndex = representativeVisualFrameIndex(
                    request.frames.length
                  );
                  const frame = request.frames[frameIndex];
                  if (frame === undefined) {
                    return yield* Effect.fail("insufficient_evidence" as const);
                  }
                  const { inputTokens, outputTokens, value } =
                    yield* oneForcedToolCall(
                      service,
                      {
                        description:
                          "Record only observations of text visibly present in the supplied source image.",
                        name: "record_visual_evidence",
                        normalizeValue: projectVisualProviderSemanticsInput,
                        prompt: visualPrompt(frame),
                        // Visual evidence is optional. A provider response
                        // that cannot be normalized must not abort otherwise
                        // valid transcript processing or leave the budget
                        // poisoned. Record honest empty evidence and charge
                        // the full bounded reservation; strict forced-tool
                        // envelope and argument validation still fail closed.
                        providerNormalizationFallback: () => ({
                          observations: [],
                        }),
                        schema: VisualEvidenceProviderSemantics,
                        toolSchema: VisualEvidenceProviderToolArguments,
                      },
                      {
                        correlationId: input.correlationId,
                        providerStage: "visual",
                        traceStore,
                      }
                    );
                  const observations = value.observations.map(
                    (observation) => ({
                      confidence:
                        observation.confidence > 1
                          ? observation.confidence / 100
                          : observation.confidence,
                      frameIndex,
                      kind: "visible_text" as const,
                      regions: [
                        {
                          height: 1,
                          width: 1,
                          x: 0,
                          y: 0,
                        },
                      ] as const,
                      text: observation.text,
                      timestampMilliseconds: frame.timestampMilliseconds,
                    })
                  );
                  const meteredCost = pricedTokenUsage(
                    inputTokens,
                    outputTokens,
                    {
                      inputMicroUsdPerToken: 0.27,
                      outputMicroUsdPerToken: 0.85,
                    }
                  );
                  // A schema-valid response proves this bounded visual call
                  // completed. When the provider omits trustworthy usage,
                  // charge the reservation maximum against the safety ledger
                  // while the returned estimate remains explicitly uncertain.
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
                      outcome:
                        visualEvidenceOutcomeForObservations(observations),
                      provider: ProviderName,
                      usage: {
                        inputBytes: frame.bytes.byteLength,
                        inputFrames: 1 as const,
                        modelCalls: 1 as const,
                      },
                    },
                  };
                }).pipe(
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
                  (error): VisualEvidenceExtractionFailure => {
                    const providerError =
                      isPilotProviderKnownZeroCostFailure(error) &&
                      isSafeProviderFailureCode(error.error)
                        ? error.error
                        : undefined;
                    return adapterFailure(
                      "VisualEvidenceExtractionFailure",
                      providerError ??
                        (isSafeProviderFailureCode(error)
                          ? error
                          : "outcome_unknown")
                    );
                  }
                )
              ),
    } satisfies VisualEvidenceExtractorShape;
  });
