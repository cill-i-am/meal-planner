import { Effect, Option, Schema } from "effect";
import type { Prompt } from "effect/ai";

import { isProviderKnownZeroCostFailure } from "../provider-accounting/provider-accounting.js";
import type { ImportCorrelationId } from "./import-observability.js";
import { ImportObservabilityTraceStore } from "./import-observability.js";
import {
  ProviderName,
  adapterFailure,
  decodeProviderFailureEvidence,
  isSafeProviderFailureCode,
  oneForcedToolCall,
  pricedTokenUsage,
  providerFailureFromEvidence,
} from "./import-provider-kernel.js";
import type {
  ProviderDispatchGate,
  WorkersAiTransport,
} from "./import-provider-kernel.js";
import type {
  VisualEvidenceExtractionFailure,
  VisualEvidenceExtractor,
  VisualFrameArtifact,
} from "./import-visual-evidence-extractor.js";
import {
  projectVisualProviderSemanticsInput,
  emptyVisualProviderSemantics,
  MaximumVisualFrames,
  visualEvidenceProviderSchemas,
  visualEvidenceOutcomeForObservations,
} from "./import-visual-evidence-extractor.js";

export { InstalledVisualModel } from "./import-provider-kernel.js";

const VisualMaximumCostMicroUsd = 100_000;

const visualPrompt = (
  frames: readonly VisualFrameArtifact[]
): Prompt.RawInput => [
  {
    content: [
      {
        text:
          `Record only visible text in all ${frames.length} supplied source images. ` +
          `Return exactly ${frames.length} entries in the frames array, in image order. ` +
          "Keep an empty observations array for an image without readable text; never omit a frame slot. " +
          "The adapter owns the source frame identity and timing. " +
          "Do not infer ingredients, quantities, steps, or other unseen facts. " +
          "Record at most 256 observations across all frames.",
        type: "text",
      },
      ...frames.map((frame) => ({
        data: frame.bytes,
        mediaType: frame.mimeType,
        type: "file" as const,
      })),
    ],
    role: "user",
  },
];

export const makeInstalledVisualEvidenceExtractor = (input: {
  readonly correlationId: ImportCorrelationId;
  readonly dispatch: ProviderDispatchGate;
  readonly transport: WorkersAiTransport["visual"];
}) =>
  Effect.gen(function* makeVisualAdapter() {
    const { model } = input.transport;
    const traceStore = Option.getOrUndefined(
      yield* Effect.serviceOption(ImportObservabilityTraceStore)
    );
    const service = yield* input.transport.makeLanguageModel({
      maxTokens: 8192,
      temperature: 0,
    });
    return {
      extract: (request) =>
        request.frames.length === 0 ||
        request.frames.length > MaximumVisualFrames
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
                  const { schema, toolSchema } = visualEvidenceProviderSchemas(
                    request.frames.length
                  );
                  const { inputTokens, outputTokens, value } =
                    yield* oneForcedToolCall(
                      service,
                      {
                        description:
                          "Record visible text separately for each supplied image in the same order.",
                        name: "record_visual_evidence",
                        normalizeValue: (providerValue) =>
                          projectVisualProviderSemanticsInput(
                            providerValue,
                            request.frames.length
                          ),
                        prompt: visualPrompt(request.frames),
                        // Visual evidence is optional. A provider response
                        // that cannot be normalized must not abort otherwise
                        // valid transcript processing or leave the budget
                        // poisoned. Record honest empty evidence and charge
                        // the full bounded reservation; strict forced-tool
                        // envelope and argument validation still fail closed.
                        providerNormalizationFallback: () =>
                          emptyVisualProviderSemantics(request.frames.length),
                        schema,
                        toolSchema,
                      },
                      {
                        correlationId: input.correlationId,
                        providerStage: "visual",
                        traceStore,
                      }
                    );
                  const observations = request.frames.flatMap(
                    (frame, frameIndex) =>
                      (value.frames[frameIndex]?.observations ?? []).map(
                        (observation) => ({
                          confidence:
                            observation.confidence > 1
                              ? observation.confidence / 100
                              : observation.confidence,
                          frameIndex,
                          kind: "visible_text" as const,
                          regions: [
                            { height: 1, width: 1, x: 0, y: 0 },
                          ] as const,
                          text: observation.text,
                          timestampMilliseconds: frame.timestampMilliseconds,
                        })
                      )
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
                        inputBytes: request.frames.reduce(
                          (total, frame) => total + frame.bytes.byteLength,
                          0
                        ),
                        inputFrames: request.frames.length,
                        modelCalls: 1 as const,
                      },
                    },
                  };
                }).pipe(
                  // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
                  Effect.mapError((error) => {
                    if (isProviderKnownZeroCostFailure(error)) {
                      return error;
                    }
                    return Schema.is(Schema.String)(error)
                      ? error
                      : providerFailureFromEvidence(
                          Option.getOrUndefined(
                            decodeProviderFailureEvidence(error)
                          )
                        ).code;
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
                      isProviderKnownZeroCostFailure(error) &&
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
    } satisfies VisualEvidenceExtractor;
  });
