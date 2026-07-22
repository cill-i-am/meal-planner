import { DateTime, Effect, Option, Schema } from "effect";

import { readVerifiedAcquisitionEvidence } from "./import-media-acquirer.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import {
  AcquisitionGeneration,
  EvidenceRetentionSeconds,
} from "./import-media.model.js";
import { readVerifiedTranscriptEvidence } from "./import-speech-transcription.js";
import type {
  VisualEvidenceObservation,
  VisualEvidenceExtractorShape,
  VisualFrameArtifact,
  VisualFrameSamplerShape,
} from "./import-visual-evidence-extractor.js";
import {
  decodeVisualEvidence,
  MaximumVisualFrames,
  VisualEvidence,
  validateVisualFrames,
} from "./import-visual-evidence-extractor.js";
import type {
  CompletedVisualEvidence,
  VisualEvidenceFailureCode,
  VisualEvidenceRepositoryShape,
} from "./import-visual-evidence.repository.d1.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import { importTransitionRejected } from "./import.errors.js";
import type { ImportRepositoryShape } from "./import.repository.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);
const PositiveInteger = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0))
);

const VisualFrameReference = Schema.Struct({
  byteLength: PositiveInteger,
  frameIndex: Schema.Number.pipe(
    Schema.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThan(MaximumVisualFrames)
    )
  ),
  height: PositiveInteger,
  key: Schema.String,
  mimeType: Schema.Literal("image/jpeg"),
  sha256: Sha256Hex,
  timestampMilliseconds: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  ),
  width: PositiveInteger,
});
type VisualFrameReference = typeof VisualFrameReference.Type;

/** Private generation-fenced normalized visual evidence document. */
export const VisualEvidenceManifestDocument = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  cost: VisualEvidence.fields.cost,
  createdAt: ImportTimestamp,
  dispatchId: Schema.String,
  frames: Schema.NonEmptyArray(VisualFrameReference).pipe(
    Schema.check(Schema.isMaxLength(MaximumVisualFrames))
  ),
  importId: ImportId,
  model: VisualEvidence.fields.model,
  observations: VisualEvidence.fields.observations,
  outcome: VisualEvidence.fields.outcome,
  provider: VisualEvidence.fields.provider,
  retention: Schema.Struct({
    configuredAgeSeconds: Schema.Literal(EvidenceRetentionSeconds),
    policy: Schema.Literal("r2_bucket_object_age"),
  }),
  schemaVersion: Schema.Literal(1),
  sourceEvidenceDeleteAt: ImportTimestamp,
  sourceMediaSha256: Sha256Hex,
  usage: VisualEvidence.fields.usage,
});
export type VisualEvidenceManifestDocument =
  typeof VisualEvidenceManifestDocument.Type;

export const MaximumVisualEvidenceManifestBytes = 1_048_576;

export interface VisualEvidencePipelineFailure {
  readonly _tag: "VisualEvidencePipelineFailure";
  readonly code: VisualEvidenceFailureCode | "visual_evidence_unknown";
}

const pipelineFailure = (
  code: VisualEvidencePipelineFailure["code"]
): VisualEvidencePipelineFailure => ({
  _tag: "VisualEvidencePipelineFailure",
  code,
});

const visualGenerationPrefix = (
  importId: ImportId,
  generation: AcquisitionGeneration
) => `imports/${importId}/visual/v1/generations/${generation}`;

export const visualFrameObjectKey = (
  importId: ImportId,
  generation: AcquisitionGeneration,
  frameIndex: number
) =>
  `${visualGenerationPrefix(importId, generation)}/frames/${String(frameIndex).padStart(2, "0")}.jpg`;

export const visualEvidenceManifestObjectKey = (
  importId: ImportId,
  generation: AcquisitionGeneration
) => `${visualGenerationPrefix(importId, generation)}/manifest.json`;

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

const nativeSha256 = (object: {
  readonly checksums?: { readonly sha256?: ArrayBuffer };
}) => {
  const checksum = object.checksums?.sha256;
  return checksum === undefined ? null : bytesToHex(checksum);
};

const frameReference = (
  importId: ImportId,
  generation: AcquisitionGeneration,
  frame: VisualFrameArtifact,
  frameIndex: number
): VisualFrameReference => ({
  byteLength: frame.bytes.byteLength,
  frameIndex,
  height: frame.height,
  key: visualFrameObjectKey(importId, generation, frameIndex),
  mimeType: frame.mimeType,
  sha256: frame.sha256,
  timestampMilliseconds: frame.timestampMilliseconds,
  width: frame.width,
});

const expectedFrameMetadata = (
  document: Pick<
    VisualEvidenceManifestDocument,
    "acquisitionGeneration" | "importId" | "sourceMediaSha256"
  >,
  frame: VisualFrameReference
) => ({
  frameIndex: String(frame.frameIndex),
  generation: String(document.acquisitionGeneration),
  importId: document.importId,
  kind: "visual_frame",
  sha256: frame.sha256,
  sourceMediaSha256: document.sourceMediaSha256,
  timestampMilliseconds: String(frame.timestampMilliseconds),
});

const metadataMatches = (
  actual: Record<string, string> | undefined,
  expected: Record<string, string>
) =>
  actual !== undefined &&
  Object.entries(expected).every(([key, value]) => actual[key] === value);

const verifyFrameObject = (
  bucket: AcquisitionBucketLike,
  document: Pick<
    VisualEvidenceManifestDocument,
    "acquisitionGeneration" | "importId" | "sourceMediaSha256"
  >,
  frame: VisualFrameReference
) =>
  Effect.gen(function* verifyFrame() {
    const object = yield* Effect.tryPromise({
      catch: () => pipelineFailure("outcome_unknown"),
      try: () => bucket.head(frame.key),
    });
    if (
      object === null ||
      object.size !== frame.byteLength ||
      nativeSha256(object) !== frame.sha256 ||
      object.httpMetadata?.contentType !== "image/jpeg" ||
      object.httpMetadata.cacheControl !== "private, no-store" ||
      !metadataMatches(
        object.customMetadata,
        expectedFrameMetadata(document, frame)
      )
    ) {
      return yield* Effect.fail(pipelineFailure("frame_evidence_failed"));
    }
  });

const storeFrames = (
  bucket: AcquisitionBucketLike,
  documentIdentity: Pick<
    VisualEvidenceManifestDocument,
    "acquisitionGeneration" | "importId" | "sourceMediaSha256"
  >,
  frames: readonly VisualFrameArtifact[]
) =>
  Effect.forEach(
    frames,
    (frame, frameIndex) =>
      Effect.gen(function* storeFrame() {
        const reference = frameReference(
          documentIdentity.importId,
          documentIdentity.acquisitionGeneration,
          frame,
          frameIndex
        );
        yield* Effect.tryPromise({
          catch: () => null,
          try: () =>
            bucket.put(reference.key, frame.bytes, {
              contentLength: reference.byteLength,
              customMetadata: expectedFrameMetadata(
                documentIdentity,
                reference
              ),
              httpMetadata: {
                cacheControl: "private, no-store",
                contentType: "image/jpeg",
              },
              onlyIf: { etagDoesNotMatch: "*" },
              sha256: sha256Bytes(reference.sha256),
            }),
        }).pipe(Effect.exit);
        yield* verifyFrameObject(bucket, documentIdentity, reference);
        return reference;
      }),
    { concurrency: 1 }
  );

const observationsMatchFrames = (
  observations: readonly VisualEvidenceObservation[],
  frames: readonly VisualFrameReference[]
) =>
  observations.every((observation) => {
    const frame = frames[observation.frameIndex];
    return frame?.timestampMilliseconds === observation.timestampMilliseconds;
  });

/** Re-verify private normalized visual evidence before downstream use. */
export const readVerifiedVisualEvidence = (
  bucket: AcquisitionBucketLike,
  expected: {
    readonly dispatchId: string;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly sourceEvidenceDeleteAt: ImportTimestamp;
    readonly sourceMediaSha256: string;
  }
) =>
  Effect.gen(function* readManifest() {
    const key = visualEvidenceManifestObjectKey(
      expected.importId,
      expected.generation
    );
    const object = yield* Effect.tryPromise({
      catch: () => pipelineFailure("visual_evidence_unknown"),
      try: () => bucket.get(key),
    });
    if (object === null) {
      return Option.none<{
        readonly document: VisualEvidenceManifestDocument;
        readonly sha256: string;
      }>();
    }
    if (object.size < 1 || object.size > MaximumVisualEvidenceManifestBytes) {
      return yield* Effect.fail(pipelineFailure("visual_evidence_failed"));
    }
    const text = yield* Effect.tryPromise({
      catch: () => pipelineFailure("visual_evidence_unknown"),
      try: () => object.text(),
    });
    const bytes = new TextEncoder().encode(text);
    const sha256 = yield* sha256Hex(bytes);
    const parsed = yield* Effect.try({
      catch: () => pipelineFailure("visual_evidence_failed"),
      try: () => JSON.parse(text) as unknown,
    });
    const document = yield* Schema.decodeUnknownEffect(
      VisualEvidenceManifestDocument,
      { onExcessProperty: "error" }
    )(parsed).pipe(
      Effect.mapError(() => pipelineFailure("visual_evidence_failed"))
    );
    const valid = [
      object.size === bytes.byteLength,
      nativeSha256(object) === sha256,
      object.httpMetadata?.contentType === "application/json",
      object.httpMetadata?.cacheControl === "private, no-store",
      object.customMetadata?.["generation"] === String(expected.generation),
      object.customMetadata?.["importId"] === expected.importId,
      object.customMetadata?.["kind"] === "visual_evidence_manifest",
      object.customMetadata?.["sha256"] === sha256,
      object.customMetadata?.["sourceMediaSha256"] ===
        expected.sourceMediaSha256,
      document.acquisitionGeneration === expected.generation,
      document.dispatchId === expected.dispatchId,
      document.importId === expected.importId,
      DateTime.toEpochMillis(document.sourceEvidenceDeleteAt) ===
        DateTime.toEpochMillis(expected.sourceEvidenceDeleteAt),
      document.sourceMediaSha256 === expected.sourceMediaSha256,
      document.usage.inputBytes ===
        document.frames.reduce((total, frame) => total + frame.byteLength, 0),
      document.usage.inputFrames === document.frames.length,
      observationsMatchFrames(document.observations, document.frames),
    ].every(Boolean);
    if (!valid) {
      return yield* Effect.fail(pipelineFailure("visual_evidence_failed"));
    }
    yield* Effect.forEach(
      document.frames,
      (frame, frameIndex) =>
        frame.frameIndex === frameIndex &&
        frame.key ===
          visualFrameObjectKey(
            expected.importId,
            expected.generation,
            frameIndex
          )
          ? verifyFrameObject(bucket, document, frame)
          : Effect.fail(pipelineFailure("frame_evidence_failed")),
      { concurrency: 1, discard: true }
    );
    return Option.some({ document, sha256 });
  });

const storeVisualManifest = (
  bucket: AcquisitionBucketLike,
  document: VisualEvidenceManifestDocument
) =>
  Effect.gen(function* storeManifest() {
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        Schema.encodeSync(VisualEvidenceManifestDocument)(document)
      )
    );
    if (bytes.byteLength > MaximumVisualEvidenceManifestBytes) {
      return yield* Effect.fail(pipelineFailure("visual_evidence_failed"));
    }
    const sha256 = yield* sha256Hex(bytes);
    const key = visualEvidenceManifestObjectKey(
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
            kind: "visual_evidence_manifest",
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
    const verified = yield* readVerifiedVisualEvidence(bucket, {
      dispatchId: document.dispatchId,
      generation: document.acquisitionGeneration,
      importId: document.importId,
      sourceEvidenceDeleteAt: document.sourceEvidenceDeleteAt,
      sourceMediaSha256: document.sourceMediaSha256,
    });
    return yield* Option.match(verified, {
      onNone: () => Effect.fail(pipelineFailure("visual_evidence_unknown")),
      onSome: Effect.succeed,
    });
  });

const completedFromDocument = (
  document: VisualEvidenceManifestDocument,
  manifestSha256: string
): CompletedVisualEvidence => ({
  completedAt: document.createdAt,
  cost: document.cost,
  dispatchId: document.dispatchId,
  generation: document.acquisitionGeneration,
  importId: document.importId,
  manifestKey: visualEvidenceManifestObjectKey(
    document.importId,
    document.acquisitionGeneration
  ),
  manifestSha256,
  model: document.model,
  observationsCount: document.observations.length,
  outcome: document.outcome,
  provider: document.provider,
  sourceMediaSha256: document.sourceMediaSha256,
  usage: document.usage,
});

/** Run one replay-safe provider-free transcript-to-visual-evidence tracer. */
export const extractVisualEvidenceForTranscribedImport = Effect.fn(
  "Imports.extractVisualEvidence"
)(function* extractVisualEvidence(input: {
  readonly bucket: AcquisitionBucketLike;
  readonly extractor: VisualEvidenceExtractorShape;
  readonly frameSampler: VisualFrameSamplerShape;
  readonly importId: ImportId;
  readonly importRepository: ImportRepositoryShape;
  readonly now: () => ImportTimestamp;
  readonly visualRepository: VisualEvidenceRepositoryShape;
}) {
  const storedOption = yield* input.importRepository.findById(input.importId);
  const stored = yield* Option.match(storedOption, {
    onNone: () => Effect.fail(importTransitionRejected()),
    onSome: Effect.succeed,
  });
  if (
    ![
      "extracting_visual",
      "transcribed",
      "visual_evidence_empty",
      "visual_evidence_found",
      "visual_evidence_low_confidence",
    ].includes(stored.view.status.kind)
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
  const speechDispatchId = `speech:${input.importId}:${evidence.generation}`;
  const transcript = yield* readVerifiedTranscriptEvidence(input.bucket, {
    dispatchId: speechDispatchId,
    generation: evidence.generation,
    importId: input.importId,
    sourceMediaSha256: evidence.sha256,
  }).pipe(Effect.mapError(() => pipelineFailure("source_evidence_invalid")));
  if (Option.isNone(transcript)) {
    return yield* Effect.fail(pipelineFailure("source_evidence_invalid"));
  }

  const dispatchId = `visual:${input.importId}:${evidence.generation}`;
  const claim = yield* input.visualRepository.claim({
    dispatchId,
    generation: evidence.generation,
    importId: input.importId,
    sourceMediaSha256: evidence.sha256,
    startedAt: now,
  });
  if (claim._tag === "Completed") {
    const committed = yield* readVerifiedVisualEvidence(input.bucket, {
      dispatchId,
      generation: evidence.generation,
      importId: input.importId,
      sourceEvidenceDeleteAt: evidence.deleteAt,
      sourceMediaSha256: evidence.sha256,
    });
    if (
      Option.isNone(committed) ||
      committed.value.sha256 !== claim.evidence.manifestSha256 ||
      claim.evidence.manifestKey !==
        visualEvidenceManifestObjectKey(input.importId, evidence.generation) ||
      committed.value.document.outcome !== claim.evidence.outcome
    ) {
      return yield* Effect.fail(pipelineFailure("visual_evidence_failed"));
    }
    return {
      _tag: "VisualEvidenceReady" as const,
      generation: claim.evidence.generation,
      importId: claim.evidence.importId,
      manifestKey: claim.evidence.manifestKey,
      outcome: claim.evidence.outcome,
    };
  }
  if (claim._tag === "Failed") {
    return yield* Effect.fail(pipelineFailure("outcome_unknown"));
  }
  if (claim._tag === "ResumeDispatch") {
    const recovered = yield* readVerifiedVisualEvidence(input.bucket, {
      dispatchId,
      generation: evidence.generation,
      importId: input.importId,
      sourceEvidenceDeleteAt: evidence.deleteAt,
      sourceMediaSha256: evidence.sha256,
    });
    if (Option.isSome(recovered)) {
      const completed = yield* input.visualRepository.complete(
        completedFromDocument(recovered.value.document, recovered.value.sha256)
      );
      return {
        _tag: "VisualEvidenceReady" as const,
        generation: completed.generation,
        importId: completed.importId,
        manifestKey: completed.manifestKey,
        outcome: completed.outcome,
      };
    }
    return yield* Effect.fail(pipelineFailure("outcome_unknown"));
  }

  const runDispatch = Effect.gen(function* runVisualDispatch() {
    const durationMilliseconds = Math.round(evidence.durationSeconds * 1000);
    const frames = yield* input.frameSampler
      .sample({
        durationMilliseconds,
        generation: evidence.generation,
        importId: input.importId,
        mediaKey: evidence.mediaKey,
        sourceMediaSha256: evidence.sha256,
      })
      .pipe(Effect.mapError(() => pipelineFailure("frame_sampling_failed")));
    if (!validateVisualFrames(frames, durationMilliseconds)) {
      return yield* Effect.fail(pipelineFailure("frame_sampling_failed"));
    }
    for (const frame of frames) {
      if ((yield* sha256Hex(frame.bytes)) !== frame.sha256) {
        return yield* Effect.fail(pipelineFailure("frame_sampling_failed"));
      }
    }
    const documentIdentity = {
      acquisitionGeneration: evidence.generation,
      importId: input.importId,
      sourceMediaSha256: evidence.sha256,
    };
    const frameReferences = yield* storeFrames(
      input.bucket,
      documentIdentity,
      frames
    );
    const [firstFrameReference, ...remainingFrameReferences] = frameReferences;
    if (firstFrameReference === undefined) {
      return yield* Effect.fail(pipelineFailure("frame_evidence_failed"));
    }
    const rawVisualEvidence = yield* input.extractor
      .extract({
        dispatchId,
        frames,
        generation: evidence.generation,
        importId: input.importId,
        sourceMediaSha256: evidence.sha256,
      })
      .pipe(
        Effect.mapError((error) =>
          pipelineFailure(
            error.code === "outcome_unknown"
              ? "outcome_unknown"
              : "visual_extraction_failed"
          )
        )
      );
    const visualEvidence = yield* decodeVisualEvidence(rawVisualEvidence).pipe(
      Effect.mapError(() => pipelineFailure("visual_extraction_failed"))
    );
    const inputBytes = frames.reduce(
      (total, frame) => total + frame.bytes.byteLength,
      0
    );
    if (
      visualEvidence.usage.inputBytes !== inputBytes ||
      visualEvidence.usage.inputFrames !== frames.length ||
      !observationsMatchFrames(visualEvidence.observations, frameReferences)
    ) {
      return yield* Effect.fail(pipelineFailure("visual_extraction_failed"));
    }
    const document: VisualEvidenceManifestDocument = {
      acquisitionGeneration: evidence.generation,
      cost: visualEvidence.cost,
      createdAt: now,
      dispatchId,
      frames: [firstFrameReference, ...remainingFrameReferences],
      importId: input.importId,
      model: visualEvidence.model,
      observations: visualEvidence.observations,
      outcome: visualEvidence.outcome,
      provider: visualEvidence.provider,
      retention: {
        configuredAgeSeconds: EvidenceRetentionSeconds,
        policy: "r2_bucket_object_age",
      },
      schemaVersion: 1,
      sourceEvidenceDeleteAt: evidence.deleteAt,
      sourceMediaSha256: evidence.sha256,
      usage: visualEvidence.usage,
    };
    const committed = yield* storeVisualManifest(input.bucket, document);
    return yield* input.visualRepository.complete(
      completedFromDocument(committed.document, committed.sha256)
    );
  });

  const completed = yield* runDispatch.pipe(
    Effect.catchTag("VisualEvidencePipelineFailure", (failure) => {
      if (
        failure.code === "outcome_unknown" ||
        failure.code === "visual_evidence_unknown"
      ) {
        return Effect.fail(failure);
      }
      return input.visualRepository
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
    _tag: "VisualEvidenceReady" as const,
    generation: completed.generation,
    importId: completed.importId,
    manifestKey: completed.manifestKey,
    outcome: completed.outcome,
  };
});
