import type {
  RecipeSpeechTranscriber,
  SpeechTranscriptionInput,
} from "@meal-planner/recipe-imports/evidence/speech-transcriber";
import type {
  SpeechTranscript,
  SpeechTranscriptionFailure,
  SpeechTranscriptionResult,
  SpeechUnavailableEvidence,
} from "@meal-planner/transcription";
import { normalizeClipTranscript } from "@meal-planner/transcription";
import {
  decodeWorkersAiSpeechResponse,
  workersAiSpeechRequest,
} from "@meal-planner/transcription/workers-ai";
import { Effect, Option, Schema } from "effect";

import { isProviderKnownZeroCostFailure } from "../provider-accounting/provider-accounting.js";
import type { ImportCorrelationId } from "./import-observability.js";
import {
  ImportObservabilityTraceStore,
  emitImportObservabilityEvent,
} from "./import-observability.js";
import {
  ProviderName,
  adapterFailure,
  decodeProviderFailureEvidence,
  failAfter,
  isSafeProviderFailureCode,
  providerFailureFromEvidence,
} from "./import-provider-kernel.js";
import type {
  ProviderDispatchGate,
  SafeProviderFailureCode,
  WorkersAiTransport,
} from "./import-provider-kernel.js";

export { InstalledSpeechModel } from "./import-provider-kernel.js";

const SpeechMaximumCostMicroUsd = 50_000;

const speechDecodeDiagnostics = (
  decoded: ReturnType<typeof decodeWorkersAiSpeechResponse>,
  transcript: Option.Option<SpeechTranscript>
) => {
  if (decoded._tag === "Rejected") {
    const { _tag, ...diagnostics } = decoded;
    return diagnostics;
  }
  if (decoded._tag === "Absent") {
    return {};
  }
  if (Option.isNone(transcript)) {
    return {
      decodeReason: "speech_transcript_normalization_invalid" as const,
      decodeStage: "speech_transcript" as const,
    };
  }
  return {};
};

const speechFailure = (code: SafeProviderFailureCode) => {
  const checkedResult: SpeechTranscriptionFailure = adapterFailure(
    "SpeechTranscriptionFailure",
    code
  );
  return checkedResult;
};

export const makeInstalledSpeechTranscriber = (input: {
  readonly correlationId: ImportCorrelationId;
  readonly dispatch: ProviderDispatchGate;
  readonly transport: WorkersAiTransport["speech"];
}) =>
  Effect.gen(function* makeSpeechAdapter() {
    const { model } = input.transport;
    const traceStore = Option.getOrUndefined(
      yield* Effect.serviceOption(ImportObservabilityTraceStore)
    );
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
                    isProviderKnownZeroCostFailure(error)
                      ? error
                      : providerFailureFromEvidence(
                          Option.getOrUndefined(
                            decodeProviderFailureEvidence(error)
                          )
                        ).code,
                  try: () =>
                    input.transport.run(
                      workersAiSpeechRequest(request.audio.bytes, "en")
                    ),
                });
                if (!response.ok) {
                  return yield* Effect.fail({ status: response.status });
                }
                const raw = Option.getOrUndefined(
                  yield* Effect.tryPromise({
                    catch: () => "malformed_response" as const,
                    try: () => response.json(),
                  }).pipe(
                    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
                    Effect.option
                  )
                );
                const decoded = decodeWorkersAiSpeechResponse(raw);
                const transcript =
                  decoded._tag === "Decoded"
                    ? normalizeClipTranscript({
                        audio: request.audio,
                        cost: {
                          certainty: "estimated",
                          currency: "USD",
                          estimatedMicroUsd: estimatedCostMicroUsd,
                        },
                        language: "en",
                        model,
                        provider: ProviderName,
                        text: decoded.text,
                      })
                    : Option.none();
                yield* emitImportObservabilityEvent(
                  {
                    correlationId: input.correlationId,
                    ...speechDecodeDiagnostics(decoded, transcript),
                    event: "provider.decode",
                    outcome:
                      decoded._tag === "Absent" || Option.isSome(transcript)
                        ? "succeeded"
                        : "malformed",
                    providerStage: "speech",
                  },
                  traceStore
                );
                const unavailable: SpeechUnavailableEvidence = {
                  cost: {
                    certainty: "estimated",
                    currency: "USD",
                    estimatedMicroUsd: estimatedCostMicroUsd,
                  },
                  detectedLanguage: null,
                  model,
                  provider: ProviderName,
                  segments: [],
                  text: null,
                  usage: {
                    audioDurationMilliseconds:
                      request.audio.durationMilliseconds,
                    inputBytes: request.audio.bytes.byteLength,
                  },
                  ...(decoded._tag === "Absent"
                    ? { reason: "no_speech_detected", status: "absent" }
                    : { reason: "malformed_response", status: "failed" }),
                };
                const result: SpeechTranscriptionResult = Option.getOrElse(
                  transcript,
                  () => unavailable
                );
                return {
                  cost: {
                    _tag: "Known" as const,
                    actualCostMicroUsd: estimatedCostMicroUsd,
                  },
                  value: result,
                };
              }),
              {
                correlationId: input.correlationId,
                providerStage: "speech",
                traceStore,
              }
            ).pipe(
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
            maximumCostMicroUsd: SpeechMaximumCostMicroUsd,
            providerStage: "speech",
            providerStageId: "speech-transcription",
          });
          return outcome;
        }).pipe(
          // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the adapter error contract.
          Effect.mapError((error) =>
            speechFailure(
              isSafeProviderFailureCode(error) ? error : "outcome_unknown"
            )
          )
        ),
    } satisfies RecipeSpeechTranscriber;
  });
