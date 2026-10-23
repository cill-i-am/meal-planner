import { Effect, Option, Schema } from "effect";

import { sha256Bytes } from "./import-digest.js";
import type { HouseholdImportEvidenceCurrentRepository } from "./import-evidence.repository.household.js";
import { readVerifiedAcquisitionEvidence } from "./import-media-acquirer.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import type { ProviderTaskDiagnosticReasonCode } from "./import-provider-workflow-checkpoint.js";
import type {
  NoAudioSpeechEvidence,
  SpeechAudioExtractor,
  SpeechTranscriber,
} from "./import-speech-transcriber.js";
import {
  decodeSpeechTranscriptionResult,
  SpeechAudioAbsence,
  validateSpeechAudioArtifact,
} from "./import-speech-transcriber.js";
import type {
  CompletedTranscriptEvidence,
  SpeechTranscriptionRepository,
} from "./import-speech-transcription.repository.js";
import type { ImportId, ImportTimestamp } from "./import.contracts.js";
import { importTransitionRejected } from "./import.errors.js";
import type { TranscriptEvidenceDocument } from "./transcript-evidence-store.js";
import {
  TranscriptEvidenceStore,
  TranscriptEvidenceStoreLive,
  transcriptEvidenceStatus,
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

const completedFromDocument = (
  document: TranscriptEvidenceDocument,
  byteLength: number,
  transcriptSha256: string,
  transcriptKey: string
): CompletedTranscriptEvidence => ({
  byteLength,
  completedAt: document.createdAt,
  cost: document.cost,
  deleteAt: document.deleteAt,
  detectedLanguage: document.detectedLanguage,
  dispatchId: document.dispatchId,
  generation: document.acquisitionGeneration,
  importId: document.importId,
  model: document.model,
  provider: document.provider,
  segmentsCount: document.segments.length,
  sourceMediaSha256: document.sourceMediaSha256,
  transcript: transcriptEvidenceStatus(document),
  transcriptKey,
  transcriptSha256,
  usage: document.usage,
});

/** Run one replay-safe provider-free acquired-to-transcript use case. */
export const transcribeAcquiredImport = Effect.fn("Imports.transcribeAcquired")(
  function* transcribeAcquired(input: {
    readonly acquisitionRepository: HouseholdImportEvidenceCurrentRepository;
    readonly audioExtractor: SpeechAudioExtractor;
    readonly bucket: AcquisitionBucketLike;
    readonly dispatchId?: string;
    readonly importId: ImportId;
    readonly now: () => ImportTimestamp;
    readonly speechTranscriber: SpeechTranscriber;
    readonly transcriptionRepository: SpeechTranscriptionRepository;
  }) {
    const storedOption = yield* input.acquisitionRepository.readCurrent(
      input.importId
    );
    const stored = yield* Option.match(storedOption, {
      onNone: () => Effect.fail(importTransitionRejected()),
      onSome: Effect.succeed,
    });
    if (
      !["acquired", "transcribing", "transcribed"].includes(stored.status.kind)
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
    if (claim._tag === "Failed") {
      return yield* Effect.fail(pipelineFailure(claim.code));
    }
    if (claim._tag === "Completed" || claim._tag === "ResumeDispatch") {
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
        if (
          claim._tag === "Completed" &&
          (claim.evidence.transcriptKey !== recovered.value.key ||
            claim.evidence.transcriptSha256 !== recovered.value.sha256)
        ) {
          return yield* Effect.fail(
            pipelineFailure("transcript_evidence_failed")
          );
        }
        const completed =
          claim._tag === "Completed"
            ? claim.evidence
            : yield* input.transcriptionRepository.complete(
                completedFromDocument(
                  recovered.value.document,
                  recovered.value.byteLength,
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
      if (claim._tag === "Completed") {
        return yield* Effect.fail(
          pipelineFailure("transcript_evidence_failed")
        );
      }
    }

    const runDispatch = Effect.gen(function* runSpeechDispatch() {
      const transcript = yield* Effect.gen(function* produceSpeechEvidence() {
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
        if (Schema.is(SpeechAudioAbsence)(audio)) {
          if (evidence.audioStreams.length !== 0) {
            return yield* Effect.fail(
              pipelineFailure("source_evidence_invalid")
            );
          }
          return {
            cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
            detectedLanguage: null,
            model: null,
            provider: null,
            reason: "no_audio_stream",
            segments: [],
            status: "absent",
            text: null,
            usage: { audioDurationMilliseconds: 0, inputBytes: 0 },
          } satisfies NoAudioSpeechEvidence;
        }
        if (evidence.audioStreams.length === 0) {
          return yield* Effect.fail(pipelineFailure("source_evidence_invalid"));
        }
        if (!validateSpeechAudioArtifact(audio, evidence.sha256)) {
          return yield* Effect.fail(pipelineFailure("audio_extraction_failed"));
        }
        const audioSha256 = yield* sha256Bytes(audio.bytes);
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
        const normalized = yield* decodeSpeechTranscriptionResult(
          rawTranscript
        ).pipe(Effect.mapError(() => pipelineFailure("transcription_failed")));
        const finalSegment = normalized.segments.at(-1);
        if (
          normalized.usage.audioDurationMilliseconds !==
            audio.durationMilliseconds ||
          normalized.usage.inputBytes !== audio.bytes.byteLength ||
          (normalized.text !== null &&
            (finalSegment === undefined ||
              finalSegment.endMilliseconds > audio.durationMilliseconds))
        ) {
          return yield* Effect.fail(pipelineFailure("transcription_failed"));
        }
        return normalized;
      });
      const identity = {
        acquisitionGeneration: evidence.generation,
        createdAt: claim.startedAt,
        deleteAt: evidence.deleteAt,
        dispatchId,
        importId: input.importId,
        sourceMediaSha256: evidence.sha256,
      };
      const document: TranscriptEvidenceDocument =
        transcript.text === null
          ? { ...identity, ...transcript, schemaVersion: 2 }
          : { ...identity, ...transcript, schemaVersion: 1 };
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
          committed.byteLength,
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
