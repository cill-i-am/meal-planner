import { Context, Effect, Layer, Option, Schema } from "effect";

import { bytesToHex, checksumBytes, sha256Bytes } from "./import-digest.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import { ProviderTaskDiagnosticReasonCode } from "./import-provider-workflow-checkpoint.js";
import type { ProviderTaskDiagnosticReasonCode as ProviderTaskDiagnosticReasonCodeType } from "./import-provider-workflow-checkpoint.js";
import { SpeechTranscript } from "./import-speech-transcriber.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";

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
export const MaximumTranscriptEvidenceBytes = 2_097_152;

export interface TranscriptEvidenceStoreError {
  readonly _tag: "TranscriptEvidenceStoreError";
  readonly code:
    | "storage_failure"
    | "malformed"
    | "oversized"
    | "checksum_unavailable"
    | "checksum_mismatch"
    | "identity_mismatch"
    | "metadata_mismatch";
  readonly reasonCode?: ProviderTaskDiagnosticReasonCodeType;
}
export const TranscriptEvidenceStoreError =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<TranscriptEvidenceStoreError>()(
    "TranscriptEvidenceStoreError",
    {
      code: Schema.Literals([
        "storage_failure",
        "malformed",
        "oversized",
        "checksum_unavailable",
        "checksum_mismatch",
        "identity_mismatch",
        "metadata_mismatch",
      ]),
      reasonCode: Schema.optionalKey(ProviderTaskDiagnosticReasonCode),
    }
  );

export interface VerifiedTranscriptEvidence {
  readonly byteLength: number;
  readonly document: TranscriptEvidenceDocument;
  readonly sha256: Sha256Hex;
  readonly key: string;
}
export interface ReadVerifiedTranscriptEvidence {
  readonly dispatchId: string;
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly recoverySha256?: Sha256Hex;
  readonly sourceMediaSha256: Sha256Hex;
}
export interface PutVerifiedTranscriptEvidence {
  readonly document: TranscriptEvidenceDocument;
}

export class TranscriptEvidenceStore extends Context.Service<
  TranscriptEvidenceStore,
  {
    readonly readVerified: (
      expected: ReadVerifiedTranscriptEvidence
    ) => Effect.Effect<
      Option.Option<VerifiedTranscriptEvidence>,
      TranscriptEvidenceStoreError
    >;
    readonly putVerified: (
      input: PutVerifiedTranscriptEvidence
    ) => Effect.Effect<
      VerifiedTranscriptEvidence,
      TranscriptEvidenceStoreError
    >;
  }
>()("meal-planner/TranscriptEvidenceStore") {}

const failure = (
  code: TranscriptEvidenceStoreError["code"],
  reasonCode?: ProviderTaskDiagnosticReasonCodeType
) =>
  new TranscriptEvidenceStoreError(
    reasonCode === undefined ? { code } : { code, reasonCode }
  );
const transcriptObjectKey = (
  importId: ImportId,
  generation: AcquisitionGeneration
) =>
  `imports/${importId}/transcription/v1/generations/${generation}/transcript.json`;
const verifiedChecksum = (
  native: ArrayBuffer | undefined,
  recovery: Sha256Hex | undefined,
  actual: Sha256Hex
) => {
  if (native !== undefined) {
    const nativeDigest = bytesToHex(native);
    if (
      nativeDigest !== actual ||
      (recovery !== undefined && recovery !== actual)
    ) {
      return Effect.fail(
        failure("checksum_mismatch", "transcript_native_checksum_mismatch")
      );
    }
    return Effect.succeed(null);
  }
  if (recovery === undefined) {
    return Effect.fail(
      failure("checksum_unavailable", "transcript_native_checksum_missing")
    );
  }
  return recovery === actual
    ? Effect.succeed(null)
    : Effect.fail(
        failure("checksum_mismatch", "transcript_native_checksum_missing")
      );
};

const readVerified = (bucket: AcquisitionBucketLike) =>
  Effect.fn("TranscriptEvidenceStore.readVerified")(function* readEvidence(
    expected: ReadVerifiedTranscriptEvidence
  ) {
    const key = transcriptObjectKey(expected.importId, expected.generation);
    const object = yield* bucket
      .get(key)
      .pipe(
        Effect.mapError(() =>
          failure("storage_failure", "transcript_get_failed")
        )
      );
    if (object === null) {
      return Option.none();
    }
    if (object.size <= 0 || object.size > MaximumTranscriptEvidenceBytes) {
      return yield* Effect.fail(
        failure("oversized", "transcript_size_invalid")
      );
    }
    const text = yield* object
      .text()
      .pipe(
        Effect.mapError(() =>
          failure("storage_failure", "transcript_read_failed")
        )
      );
    const bytes = new TextEncoder().encode(text);
    const sha256 = yield* sha256Bytes(bytes).pipe(
      Effect.mapError(() => failure("malformed", "transcript_digest_invalid"))
    );
    const document = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(TranscriptEvidenceDocument),
      { onExcessProperty: "error" }
    )(text).pipe(
      Effect.mapError(() => failure("malformed", "transcript_schema_invalid"))
    );
    yield* verifiedChecksum(
      object.checksums?.sha256,
      expected.recoverySha256,
      sha256
    );
    const metadata = object.customMetadata ?? {};
    if (
      object.size !== bytes.byteLength ||
      object.httpMetadata?.contentType !== "application/json" ||
      object.httpMetadata?.cacheControl !== "private, no-store" ||
      metadata["importId"] !== expected.importId ||
      metadata["generation"] !== String(expected.generation) ||
      metadata["kind"] !== "speech_transcript" ||
      metadata["sha256"] !== sha256 ||
      metadata["sourceMediaSha256"] !== expected.sourceMediaSha256
    ) {
      return yield* Effect.fail(
        failure("metadata_mismatch", "transcript_metadata_mismatch")
      );
    }
    if (
      document.importId !== expected.importId ||
      document.acquisitionGeneration !== expected.generation ||
      document.dispatchId !== expected.dispatchId ||
      document.sourceMediaSha256 !== expected.sourceMediaSha256
    ) {
      return yield* Effect.fail(
        failure("identity_mismatch", "transcript_identity_mismatch")
      );
    }
    return Option.some({ byteLength: bytes.byteLength, document, key, sha256 });
  });

const putVerified = (bucket: AcquisitionBucketLike) =>
  Effect.fn("TranscriptEvidenceStore.putVerified")(function* putEvidence({
    document,
  }: PutVerifiedTranscriptEvidence) {
    const bytes = new TextEncoder().encode(
      JSON.stringify(Schema.encodeSync(TranscriptEvidenceDocument)(document))
    );
    if (bytes.byteLength > MaximumTranscriptEvidenceBytes) {
      return yield* Effect.fail(
        failure("oversized", "transcript_size_invalid")
      );
    }
    const sha256 = yield* sha256Bytes(bytes).pipe(
      Effect.mapError(() => failure("malformed", "transcript_digest_invalid"))
    );
    const key = transcriptObjectKey(
      document.importId,
      document.acquisitionGeneration
    );
    const written = yield* bucket
      .put(key, bytes, {
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
        sha256: checksumBytes(sha256),
      })
      .pipe(
        Effect.mapError(() =>
          failure("storage_failure", "transcript_put_failed")
        )
      );
    if (written === null) {
      return yield* Effect.fail(
        failure("storage_failure", "transcript_conditional_create_rejected")
      );
    }
    const verified = yield* readVerified(bucket)({
      dispatchId: document.dispatchId,
      generation: document.acquisitionGeneration,
      importId: document.importId,
      recoverySha256: sha256,
      sourceMediaSha256: document.sourceMediaSha256,
    });
    return yield* Option.match(verified, {
      onNone: () =>
        Effect.fail(
          failure("storage_failure", "transcript_missing_after_write")
        ),
      onSome: Effect.succeed,
    });
  });

export const TranscriptEvidenceStoreLive = (bucket: AcquisitionBucketLike) =>
  Layer.succeed(
    TranscriptEvidenceStore,
    TranscriptEvidenceStore.of({
      putVerified: putVerified(bucket),
      readVerified: readVerified(bucket),
    })
  );
