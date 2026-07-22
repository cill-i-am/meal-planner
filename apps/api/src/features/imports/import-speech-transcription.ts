import { DateTime, Effect, Option, Schema } from "effect";

import { readVerifiedAcquisitionEvidence } from "./import-media-acquirer.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import type {
  SpeechAudioExtractorShape,
  SpeechTranscriberShape,
} from "./import-speech-transcriber.js";
import {
  decodeSpeechTranscript,
  SpeechTranscript,
  validateSpeechAudioArtifact,
} from "./import-speech-transcriber.js";
import type {
  CompletedTranscriptEvidence,
  SpeechTranscriptionRepositoryShape,
} from "./import-speech-transcription.repository.d1.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import { importTransitionRejected } from "./import.errors.js";
import type { ImportRepositoryShape } from "./import.repository.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

/** Private R2 evidence document produced by the normalized speech boundary. */
export const TranscriptEvidenceDocument = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  cost: SpeechTranscript.fields.cost,
  createdAt: ImportTimestamp,
  deleteAt: ImportTimestamp,
  detectedLanguage: SpeechTranscript.fields.detectedLanguage,
  dispatchId: Schema.String,
  importId: ImportId,
  model: SpeechTranscript.fields.model,
  provider: SpeechTranscript.fields.provider,
  schemaVersion: Schema.Literal(1),
  segments: SpeechTranscript.fields.segments,
  sourceMediaSha256: Sha256Hex,
  text: SpeechTranscript.fields.text,
  usage: SpeechTranscript.fields.usage,
});
export type TranscriptEvidenceDocument = typeof TranscriptEvidenceDocument.Type;

/** Maximum private normalized transcript document accepted from R2. */
export const MaximumTranscriptEvidenceBytes = 2_097_152;

/** Safe pipeline failure recorded without raw provider bodies or secrets. */
export interface SpeechPipelineFailure {
  readonly _tag: "SpeechPipelineFailure";
  readonly code:
    | "audio_extraction_failed"
    | "outcome_unknown"
    | "source_evidence_invalid"
    | "transcription_failed"
    | "transcript_evidence_failed"
    | "transcript_evidence_unknown";
}

/** Generation-scoped private transcript evidence key. */
export const transcriptObjectKey = (
  importId: ImportId,
  generation: AcquisitionGeneration
) =>
  `imports/${importId}/transcription/v1/generations/${generation}/transcript.json`;

const pipelineFailure = (
  code: SpeechPipelineFailure["code"]
): SpeechPipelineFailure => ({ _tag: "SpeechPipelineFailure", code });

const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

const sha256Hex = (bytes: Uint8Array) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
  ).pipe(Effect.map(bytesToHex));

const sha256Bytes = (hex: string) => {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
};

/** Re-verify private normalized transcript evidence before downstream use. */
export const readVerifiedTranscriptEvidence = (
  bucket: AcquisitionBucketLike,
  expected: {
    readonly dispatchId: string;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly sourceMediaSha256: string;
  }
) =>
  Effect.gen(function* readTranscript() {
    const key = transcriptObjectKey(expected.importId, expected.generation);
    const object = yield* Effect.tryPromise({
      catch: () => pipelineFailure("transcript_evidence_unknown"),
      try: () => bucket.get(key),
    });
    if (object === null) {
      return Option.none<{
        readonly document: TranscriptEvidenceDocument;
        readonly sha256: string;
      }>();
    }
    if (object.size <= 0 || object.size > MaximumTranscriptEvidenceBytes) {
      return yield* Effect.fail(pipelineFailure("transcript_evidence_failed"));
    }
    const text = yield* Effect.tryPromise({
      catch: () => pipelineFailure("transcript_evidence_unknown"),
      try: () => object.text(),
    });
    const bytes = new TextEncoder().encode(text);
    const digest = yield* sha256Hex(bytes);
    const parsed = yield* Effect.try({
      catch: () => pipelineFailure("transcript_evidence_failed"),
      try: () => JSON.parse(text) as unknown,
    });
    const document = yield* Schema.decodeUnknownEffect(
      TranscriptEvidenceDocument,
      { onExcessProperty: "error" }
    )(parsed).pipe(
      Effect.mapError(() => pipelineFailure("transcript_evidence_failed"))
    );
    const metadata = object.customMetadata ?? {};
    const nativeChecksum = object.checksums?.sha256;
    const nativeChecksumMatches =
      nativeChecksum === undefined
        ? false
        : bytesToHex(nativeChecksum) === digest;
    const matchesExpectedEvidence = [
      object.size === bytes.byteLength,
      nativeChecksumMatches,
      object.httpMetadata?.contentType === "application/json",
      object.httpMetadata?.cacheControl === "private, no-store",
      metadata["importId"] === expected.importId,
      metadata["generation"] === String(expected.generation),
      metadata["kind"] === "speech_transcript",
      metadata["sha256"] === digest,
      metadata["sourceMediaSha256"] === expected.sourceMediaSha256,
      document.importId === expected.importId,
      document.acquisitionGeneration === expected.generation,
      document.dispatchId === expected.dispatchId,
      document.sourceMediaSha256 === expected.sourceMediaSha256,
    ].every(Boolean);
    if (!matchesExpectedEvidence) {
      return yield* Effect.fail(pipelineFailure("transcript_evidence_failed"));
    }
    return Option.some({ document, sha256: digest });
  });

const storeTranscriptDocument = (
  bucket: AcquisitionBucketLike,
  document: TranscriptEvidenceDocument
) =>
  Effect.gen(function* storeTranscript() {
    const bytes = new TextEncoder().encode(
      JSON.stringify(Schema.encodeSync(TranscriptEvidenceDocument)(document))
    );
    if (bytes.byteLength > MaximumTranscriptEvidenceBytes) {
      return yield* Effect.fail(pipelineFailure("transcript_evidence_failed"));
    }
    const sha256 = yield* sha256Hex(bytes);
    const key = transcriptObjectKey(
      document.importId,
      document.acquisitionGeneration
    );
    yield* Effect.tryPromise({
      catch: () => null,
      try: () =>
        bucket.put(key, bytes, {
          contentLength: bytes.byteLength,
          customMetadata: {
            generation: String(document.acquisitionGeneration),
            importId: document.importId,
            kind: "speech_transcript",
            sha256,
            sourceMediaSha256: document.sourceMediaSha256,
          },
          httpMetadata: {
            cacheControl: "private, no-store",
            contentType: "application/json",
          },
          onlyIf: { etagDoesNotMatch: "*" },
          sha256: sha256Bytes(sha256),
        }),
    }).pipe(Effect.exit);
    const verified = yield* readVerifiedTranscriptEvidence(bucket, {
      dispatchId: document.dispatchId,
      generation: document.acquisitionGeneration,
      importId: document.importId,
      sourceMediaSha256: document.sourceMediaSha256,
    });
    return yield* Option.match(verified, {
      onNone: () => Effect.fail(pipelineFailure("transcript_evidence_unknown")),
      onSome: Effect.succeed,
    });
  });

const completedFromDocument = (
  document: TranscriptEvidenceDocument,
  transcriptSha256: string
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
  transcriptKey: transcriptObjectKey(
    document.importId,
    document.acquisitionGeneration
  ),
  transcriptSha256,
  usage: document.usage,
});

/** Run one replay-safe provider-free acquired-to-transcript use case. */
export const transcribeAcquiredImport = Effect.fn("Imports.transcribeAcquired")(
  function* transcribeAcquired(input: {
    readonly acquisitionRepository: ImportRepositoryShape;
    readonly audioExtractor: SpeechAudioExtractorShape;
    readonly bucket: AcquisitionBucketLike;
    readonly importId: ImportId;
    readonly now: () => ImportTimestamp;
    readonly speechTranscriber: SpeechTranscriberShape;
    readonly transcriptionRepository: SpeechTranscriptionRepositoryShape;
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
      now: () => new Date(DateTime.toEpochMillis(now)),
    }).pipe(Effect.mapError(() => pipelineFailure("source_evidence_invalid")));
    if (evidence === null) {
      return yield* Effect.fail(pipelineFailure("source_evidence_invalid"));
    }
    const dispatchId = `speech:${input.importId}:${evidence.generation}`;
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
      const recovered = yield* readVerifiedTranscriptEvidence(input.bucket, {
        dispatchId,
        generation: evidence.generation,
        importId: input.importId,
        sourceMediaSha256: evidence.sha256,
      });
      if (Option.isSome(recovered)) {
        const completed = yield* input.transcriptionRepository.complete(
          completedFromDocument(
            recovered.value.document,
            recovered.value.sha256
          )
        );
        return {
          _tag: "Transcribed" as const,
          generation: completed.generation,
          importId: completed.importId,
          transcriptKey: completed.transcriptKey,
        };
      }
      return yield* Effect.fail(pipelineFailure("outcome_unknown"));
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
              error.code === "outcome_unknown"
                ? "outcome_unknown"
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
      const committed = yield* storeTranscriptDocument(input.bucket, document);
      return yield* input.transcriptionRepository.complete(
        completedFromDocument(committed.document, committed.sha256)
      );
    });

    const completed = yield* runDispatch.pipe(
      Effect.catchTag("SpeechPipelineFailure", (failure) => {
        if (
          failure.code === "outcome_unknown" ||
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
