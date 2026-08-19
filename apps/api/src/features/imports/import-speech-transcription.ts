import { Effect, Option } from "effect";

import { readVerifiedAcquisitionEvidence } from "./import-media-acquirer.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import type { ProviderTaskDiagnosticReasonCode } from "./import-provider-workflow-checkpoint.js";
import type {
  SpeechAudioExtractor,
  SpeechTranscriber,
} from "./import-speech-transcriber.js";
import {
  decodeSpeechTranscript,
  validateSpeechAudioArtifact,
} from "./import-speech-transcriber.js";
import type {
  CompletedTranscriptEvidence,
  SpeechTranscriptionRepository,
} from "./import-speech-transcription.repository.d1.js";
import type { ImportId, ImportTimestamp } from "./import.contracts.js";
import { importTransitionRejected } from "./import.errors.js";
import type { ImportRepository } from "./import.repository.js";
import type { TranscriptEvidenceDocument } from "./transcript-evidence-store.js";
import {
  TranscriptEvidenceStore,
  TranscriptEvidenceStoreLive,
} from "./transcript-evidence-store.js";

/** Safe pipeline failure recorded without raw provider bodies or secrets. */
export interface SpeechPipelineFailure {
  readonly _tag: "SpeechPipelineFailure";
  readonly code:
    | "audio_extraction_failed"
    | "outcome_unknown"
    | "provider_unavailable"
    | "source_evidence_invalid"
    | "throttled"
    | "timeout"
    | "transcription_failed"
    | "transcript_evidence_failed"
    | "transcript_evidence_unknown";
  readonly reasonCode?: ProviderTaskDiagnosticReasonCode;
}

const pipelineFailure = (
  code: SpeechPipelineFailure["code"],
  reasonCode?: ProviderTaskDiagnosticReasonCode
): SpeechPipelineFailure =>
  reasonCode === undefined
    ? { _tag: "SpeechPipelineFailure", code }
    : { _tag: "SpeechPipelineFailure", code, reasonCode };

const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

const sha256Hex = (bytes: Uint8Array) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
  ).pipe(Effect.map(bytesToHex));

const completedFromDocument = (
  document: TranscriptEvidenceDocument,
  transcriptSha256: string,
  transcriptKey: string
): CompletedTranscriptEvidence => ({
  completedAt: document.createdAt,
  cost: document.cost,
  detectedLanguage: document.detectedLanguage,
  dispatchId: document.dispatchId,
  generation: document.acquisitionGeneration,
  importId: document.importId,
  model: document.model,
  provider: document.provider,
  segmentsCount: document.segments.length,
  sourceMediaSha256: document.sourceMediaSha256,
  transcriptKey,
  transcriptSha256,
  usage: document.usage,
});

/** Run one replay-safe provider-free acquired-to-transcript use case. */
export const transcribeAcquiredImport = Effect.fn("Imports.transcribeAcquired")(
  function* transcribeAcquired(input: {
    readonly acquisitionRepository: ImportRepository;
    readonly audioExtractor: SpeechAudioExtractor;
    readonly bucket: AcquisitionBucketLike;
    readonly dispatchId?: string;
    readonly importId: ImportId;
    readonly now: () => ImportTimestamp;
    readonly speechTranscriber: SpeechTranscriber;
    readonly transcriptionRepository: SpeechTranscriptionRepository;
  }) {
    const storedOption = yield* input.acquisitionRepository.findById(
      input.importId
    );
    const stored = yield* Option.match(storedOption, {
      onNone: () => Effect.fail(importTransitionRejected()),
      onSome: Effect.succeed,
    });
    if (
      !["acquired", "transcribing", "transcribed"].includes(
        stored.view.status.kind
      )
    ) {
      return yield* Effect.fail(importTransitionRejected());
    }
    const now = input.now();
    const evidence = yield* readVerifiedAcquisitionEvidence(input.bucket, {
      canonicalId: stored.canonicalSourceId,
      generation: stored.acquisitionGeneration,
      importId: input.importId,
      observedAt: now,
    }).pipe(Effect.mapError(() => pipelineFailure("source_evidence_invalid")));
    if (evidence === null) {
      return yield* Effect.fail(pipelineFailure("source_evidence_invalid"));
    }
    const dispatchId =
      input.dispatchId ?? `speech:${input.importId}:${evidence.generation}`;
    const claim = yield* input.transcriptionRepository.claim({
      dispatchId,
      generation: evidence.generation,
      importId: input.importId,
      sourceMediaSha256: evidence.sha256,
      startedAt: now,
    });
    if (claim._tag === "Completed") {
      return {
        _tag: "Transcribed" as const,
        generation: claim.evidence.generation,
        importId: claim.evidence.importId,
        transcriptKey: claim.evidence.transcriptKey,
      };
    }
    if (claim._tag === "Failed") {
      return yield* Effect.fail(pipelineFailure("outcome_unknown"));
    }
    if (claim._tag === "ResumeDispatch") {
      const recovered = yield* TranscriptEvidenceStore.pipe(
        Effect.flatMap((store) =>
          store.readVerified({
            dispatchId,
            generation: evidence.generation,
            importId: input.importId,
            sourceMediaSha256: evidence.sha256,
          })
        ),
        Effect.provide(TranscriptEvidenceStoreLive(input.bucket)),
        Effect.mapError((error) =>
          pipelineFailure(
            error.code === "storage_failure"
              ? "transcript_evidence_unknown"
              : "transcript_evidence_failed"
          )
        )
      );
      if (Option.isSome(recovered)) {
        const completed = yield* input.transcriptionRepository.complete(
          completedFromDocument(
            recovered.value.document,
            recovered.value.sha256,
            recovered.value.key
          )
        );
        return {
          _tag: "Transcribed" as const,
          generation: completed.generation,
          importId: completed.importId,
          transcriptKey: completed.transcriptKey,
        };
      }
    }

    const runDispatch = Effect.gen(function* runSpeechDispatch() {
      const audio = yield* input.audioExtractor
        .extract({
          generation: evidence.generation,
          importId: input.importId,
          mediaKey: evidence.mediaKey,
          sourceMediaSha256: evidence.sha256,
        })
        .pipe(
          Effect.mapError(() => pipelineFailure("audio_extraction_failed"))
        );
      if (!validateSpeechAudioArtifact(audio, evidence.sha256)) {
        return yield* Effect.fail(pipelineFailure("audio_extraction_failed"));
      }
      const audioSha256 = yield* sha256Hex(audio.bytes);
      if (audioSha256 !== audio.sha256) {
        return yield* Effect.fail(pipelineFailure("audio_extraction_failed"));
      }
      const rawTranscript = yield* input.speechTranscriber
        .transcribe({
          audio,
          dispatchId,
          generation: evidence.generation,
          importId: input.importId,
          sourceMediaSha256: evidence.sha256,
        })
        .pipe(
          Effect.mapError((error) =>
            pipelineFailure(
              error.code === "outcome_unknown" ||
                error.code === "provider_unavailable" ||
                error.code === "throttled" ||
                error.code === "timeout"
                ? error.code
                : "transcription_failed"
            )
          )
        );
      const transcript = yield* decodeSpeechTranscript(rawTranscript).pipe(
        Effect.mapError(() => pipelineFailure("transcription_failed"))
      );
      const finalSegment = transcript.segments.at(-1);
      if (
        transcript.usage.audioDurationMilliseconds !==
          audio.durationMilliseconds ||
        transcript.usage.inputBytes !== audio.bytes.byteLength ||
        finalSegment === undefined ||
        finalSegment.endMilliseconds > audio.durationMilliseconds
      ) {
        return yield* Effect.fail(pipelineFailure("transcription_failed"));
      }
      const document: TranscriptEvidenceDocument = {
        acquisitionGeneration: evidence.generation,
        cost: transcript.cost,
        createdAt: now,
        deleteAt: evidence.deleteAt,
        detectedLanguage: transcript.detectedLanguage,
        dispatchId,
        importId: input.importId,
        model: transcript.model,
        provider: transcript.provider,
        schemaVersion: 1,
        segments: transcript.segments,
        sourceMediaSha256: evidence.sha256,
        text: transcript.text,
        usage: transcript.usage,
      };
      const committed = yield* TranscriptEvidenceStore.pipe(
        Effect.flatMap((store) => store.putVerified({ document })),
        Effect.provide(TranscriptEvidenceStoreLive(input.bucket)),
        Effect.mapError((error) =>
          pipelineFailure(
            error.code === "storage_failure"
              ? "transcript_evidence_unknown"
              : "transcript_evidence_failed"
          )
        )
      );
      return yield* input.transcriptionRepository.complete(
        completedFromDocument(
          committed.document,
          committed.sha256,
          committed.key
        )
      );
    });

    const completed = yield* runDispatch.pipe(
      Effect.catchTag("SpeechPipelineFailure", (failure) => {
        if (
          failure.code === "outcome_unknown" ||
          failure.code === "provider_unavailable" ||
          failure.code === "throttled" ||
          failure.code === "timeout" ||
          failure.code === "transcript_evidence_unknown"
        ) {
          return Effect.fail(failure);
        }
        return input.transcriptionRepository
          .fail({
            completedAt: now,
            dispatchId,
            failureCode: failure.code,
            generation: evidence.generation,
            importId: input.importId,
            sourceMediaSha256: evidence.sha256,
          })
          .pipe(Effect.andThen(Effect.fail(failure)));
      })
    );
    return {
      _tag: "Transcribed" as const,
      generation: completed.generation,
      importId: completed.importId,
      transcriptKey: completed.transcriptKey,
    };
  }
);
