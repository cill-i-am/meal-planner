import { DateTime, Context, Effect, Layer, Option, Schema } from "effect";

import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import {
  AcquisitionGeneration,
  EvidenceRetentionSeconds,
  Sha256Hex,
} from "./import-media.model.js";
import type {
  VisualEvidenceObservation,
  VisualFrameArtifact,
} from "./import-visual-evidence-extractor.js";
import {
  MaximumVisualFrames,
  representativeVisualFrameIndex,
  VisualEvidence,
} from "./import-visual-evidence-extractor.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";

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
export type VisualFrameReference = typeof VisualFrameReference.Type;
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
export type VisualEvidenceManifest = Omit<
  VisualEvidenceManifestDocument,
  "frames"
>;
export const MaximumVisualEvidenceManifestBytes = 1_048_576;

export interface VisualEvidenceStoreError {
  readonly _tag: "VisualEvidenceStoreError";
  readonly code:
    | "storage_failure"
    | "malformed"
    | "oversized"
    | "checksum_unavailable"
    | "checksum_mismatch"
    | "identity_mismatch"
    | "metadata_mismatch"
    | "invalid_frame"
    | "invalid_manifest";
  readonly reasonCode?: string;
}
export const VisualEvidenceStoreError =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<VisualEvidenceStoreError>()("VisualEvidenceStoreError", {
    code: Schema.Literals([
      "storage_failure",
      "malformed",
      "oversized",
      "checksum_unavailable",
      "checksum_mismatch",
      "identity_mismatch",
      "metadata_mismatch",
      "invalid_frame",
      "invalid_manifest",
    ]),
    reasonCode: Schema.optionalKey(Schema.String),
  });
const failure = (code: VisualEvidenceStoreError["code"], reasonCode?: string) =>
  new VisualEvidenceStoreError({
    code,
    ...(reasonCode === undefined ? {} : { reasonCode }),
  });

export interface VerifiedVisualEvidence {
  readonly document: VisualEvidenceManifestDocument;
  readonly sha256: Sha256Hex;
  readonly manifestKey: string;
}
export interface ReadVerifiedVisualEvidence {
  readonly dispatchId: string;
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly recoverySha256?: Sha256Hex;
  readonly sourceEvidenceDeleteAt: ImportTimestamp;
  readonly sourceMediaSha256: Sha256Hex;
}
export interface PutVerifiedVisualEvidence {
  readonly manifest: VisualEvidenceManifest;
  readonly frames: readonly VisualFrameArtifact[];
}
export class VisualEvidenceStore extends Context.Service<
  VisualEvidenceStore,
  {
    readonly putVerified: (
      input: PutVerifiedVisualEvidence
    ) => Effect.Effect<VerifiedVisualEvidence, VisualEvidenceStoreError>;
    readonly readVerified: (
      expected: ReadVerifiedVisualEvidence
    ) => Effect.Effect<
      Option.Option<VerifiedVisualEvidence>,
      VisualEvidenceStoreError
    >;
  }
>()("meal-planner/VisualEvidenceStore") {}

const visualGenerationPrefix = (
  importId: ImportId,
  generation: AcquisitionGeneration
) => `imports/${importId}/visual/v1/generations/${generation}`;
const visualFrameObjectKey = (
  importId: ImportId,
  generation: AcquisitionGeneration,
  frameIndex: number
) =>
  `${visualGenerationPrefix(importId, generation)}/frames/${String(frameIndex).padStart(2, "0")}.jpg`;
const visualEvidenceManifestObjectKey = (
  importId: ImportId,
  generation: AcquisitionGeneration
) => `${visualGenerationPrefix(importId, generation)}/manifest.json`;
const visualFrameKey = visualFrameObjectKey;
const manifestKey = visualEvidenceManifestObjectKey;
const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
const digest = (bytes: Uint8Array) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
  ).pipe(
    Effect.map(bytesToHex),
    Effect.flatMap(Schema.decodeUnknownEffect(Sha256Hex))
  );
const checksumBytes = (hex: Sha256Hex) => {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
};
const checksumMatches = (
  native: ArrayBuffer | undefined,
  recovery: Sha256Hex | undefined,
  actual: Sha256Hex,
  subject: string
) => {
  if (native !== undefined) {
    if (
      bytesToHex(native) === actual &&
      (recovery === undefined || recovery === actual)
    ) {
      return Effect.void;
    }
    return Effect.fail(
      failure("checksum_mismatch", `${subject}_checksum_conflict`)
    );
  }
  if (recovery === undefined) {
    return Effect.fail(
      failure("checksum_unavailable", `${subject}_checksum_unavailable`)
    );
  }
  if (recovery === actual) {
    return Effect.void;
  }
  return Effect.fail(
    failure("checksum_mismatch", `${subject}_recovery_checksum_mismatch`)
  );
};
const refsFor = (
  importId: ImportId,
  generation: AcquisitionGeneration,
  frames: readonly VisualFrameArtifact[]
): readonly VisualFrameReference[] =>
  frames.map((frame, frameIndex) => ({
    byteLength: frame.bytes.byteLength,
    frameIndex,
    height: frame.height,
    key: visualFrameKey(importId, generation, frameIndex),
    mimeType: frame.mimeType,
    sha256: Schema.decodeUnknownSync(Sha256Hex)(frame.sha256),
    timestampMilliseconds: frame.timestampMilliseconds,
    width: frame.width,
  }));
const frameMetadata = (
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
const observationsMatchFrames = (
  observations: readonly VisualEvidenceObservation[],
  frames: readonly VisualFrameReference[]
) =>
  observations.every(
    (observation) =>
      frames[observation.frameIndex]?.timestampMilliseconds ===
      observation.timestampMilliseconds
  );

const verifiedManifestMetadata = (
  object: Exclude<Awaited<ReturnType<AcquisitionBucketLike["get"]>>, null>,
  expected: ReadVerifiedVisualEvidence,
  sha256: Sha256Hex,
  bytes: Uint8Array
) => {
  const metadata = object.customMetadata;
  if (
    object.size === bytes.byteLength &&
    object.httpMetadata?.contentType === "application/json" &&
    object.httpMetadata?.cacheControl === "private, no-store" &&
    metadata?.["generation"] === String(expected.generation) &&
    metadata?.["importId"] === expected.importId &&
    metadata?.["kind"] === "visual_evidence_manifest" &&
    metadata?.["sha256"] === sha256 &&
    metadata?.["sourceMediaSha256"] === expected.sourceMediaSha256
  ) {
    return Effect.void;
  }
  return Effect.fail(
    failure("metadata_mismatch", "visual_manifest_metadata_mismatch")
  );
};

const verifiedManifestIdentity = (
  document: VisualEvidenceManifestDocument,
  expected: ReadVerifiedVisualEvidence
) => {
  if (
    document.acquisitionGeneration === expected.generation &&
    document.dispatchId === expected.dispatchId &&
    document.importId === expected.importId &&
    DateTime.toEpochMillis(document.sourceEvidenceDeleteAt) ===
      DateTime.toEpochMillis(expected.sourceEvidenceDeleteAt) &&
    document.sourceMediaSha256 === expected.sourceMediaSha256
  ) {
    return Effect.void;
  }
  return Effect.fail(
    failure("identity_mismatch", "visual_manifest_identity_mismatch")
  );
};

const verifiedManifestFrameContract = (
  document: VisualEvidenceManifestDocument
) => {
  const submittedFrame =
    document.frames[representativeVisualFrameIndex(document.frames.length)];
  if (
    submittedFrame !== undefined &&
    document.usage.inputBytes === submittedFrame.byteLength &&
    document.usage.inputFrames === 1 &&
    observationsMatchFrames(document.observations, document.frames)
  ) {
    return Effect.void;
  }
  return Effect.fail(
    failure("invalid_manifest", "visual_manifest_frame_contract_invalid")
  );
};

const verifyFrame = (
  bucket: AcquisitionBucketLike,
  document: Pick<
    VisualEvidenceManifestDocument,
    "acquisitionGeneration" | "importId" | "sourceMediaSha256"
  >,
  frame: VisualFrameReference
) =>
  Effect.fn("VisualEvidenceStore.verifyFrame")(function* verifyStoredFrame() {
    const object = yield* Effect.tryPromise({
      catch: () => failure("storage_failure", "visual_frame_head_failed"),
      try: () => bucket.head(frame.key),
    });
    if (object === null) {
      return yield* Effect.fail(
        failure("invalid_frame", "visual_frame_missing")
      );
    }
    if (
      object.size !== frame.byteLength ||
      object.httpMetadata?.contentType !== "image/jpeg" ||
      object.httpMetadata?.cacheControl !== "private, no-store" ||
      !metadataMatches(object.customMetadata, frameMetadata(document, frame))
    ) {
      return yield* Effect.fail(
        failure("metadata_mismatch", "visual_frame_metadata_mismatch")
      );
    }
    yield* checksumMatches(
      object.checksums?.sha256,
      frame.sha256,
      frame.sha256,
      "visual_frame"
    );
  });

const verifyExpectedFrame = (
  bucket: AcquisitionBucketLike,
  expected: ReadVerifiedVisualEvidence,
  document: VisualEvidenceManifestDocument,
  frame: VisualFrameReference,
  frameIndex: number
) => {
  if (
    frame.frameIndex !== frameIndex ||
    frame.key !==
      visualFrameKey(expected.importId, expected.generation, frameIndex)
  ) {
    return Effect.fail(failure("invalid_frame", "visual_frame_key_invalid"));
  }
  return verifyFrame(bucket, document, frame)();
};

const readVerified = (bucket: AcquisitionBucketLike) =>
  Effect.fn("VisualEvidenceStore.readVerified")(function* readEvidence(
    expected: ReadVerifiedVisualEvidence
  ) {
    const key = manifestKey(expected.importId, expected.generation);
    const object = yield* Effect.tryPromise({
      catch: () => failure("storage_failure", "visual_manifest_get_failed"),
      try: () => bucket.get(key),
    });
    if (object === null) {
      return Option.none();
    }
    if (object.size < 1 || object.size > MaximumVisualEvidenceManifestBytes) {
      return yield* Effect.fail(
        failure("oversized", "visual_manifest_size_invalid")
      );
    }
    const text = yield* Effect.tryPromise({
      catch: () => failure("storage_failure", "visual_manifest_read_failed"),
      try: () => object.text(),
    });
    const bytes = new TextEncoder().encode(text);
    const sha256 = yield* digest(bytes).pipe(
      Effect.mapError(() =>
        failure("malformed", "visual_manifest_digest_invalid")
      )
    );
    const document = yield* Effect.try({
      catch: () => failure("malformed", "visual_manifest_json_invalid"),
      try: () => JSON.parse(text) as unknown,
    }).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(VisualEvidenceManifestDocument, {
          onExcessProperty: "error",
        })
      ),
      Effect.mapError(() =>
        failure("malformed", "visual_manifest_schema_invalid")
      )
    );
    yield* checksumMatches(
      object.checksums?.sha256,
      expected.recoverySha256,
      sha256,
      "visual_manifest"
    );
    yield* verifiedManifestMetadata(object, expected, sha256, bytes);
    yield* verifiedManifestIdentity(document, expected);
    yield* verifiedManifestFrameContract(document);
    yield* Effect.forEach(
      document.frames,
      (frame, frameIndex) =>
        verifyExpectedFrame(bucket, expected, document, frame, frameIndex),
      { concurrency: 1, discard: true }
    );
    return Option.some({ document, manifestKey: key, sha256 });
  });

const putVerified = (bucket: AcquisitionBucketLike) =>
  Effect.fn("VisualEvidenceStore.putVerified")(function* putEvidence({
    manifest,
    frames,
  }: PutVerifiedVisualEvidence) {
    const [firstFrame, ...remainingFrames] = refsFor(
      manifest.importId,
      manifest.acquisitionGeneration,
      frames
    );
    if (firstFrame === undefined) {
      return yield* Effect.fail(
        failure("invalid_frame", "visual_frame_missing")
      );
    }
    const document: VisualEvidenceManifestDocument = {
      ...manifest,
      frames: [firstFrame, ...remainingFrames],
    };
    for (const [index, frame] of frames.entries()) {
      const reference = document.frames[index];
      if (reference === undefined) {
        return yield* Effect.fail(
          failure("invalid_frame", "visual_frame_missing")
        );
      }
      const written = yield* Effect.tryPromise({
        catch: () => failure("storage_failure", "visual_frame_put_failed"),
        try: () =>
          bucket.put(reference.key, frame.bytes, {
            contentLength: reference.byteLength,
            customMetadata: frameMetadata(document, reference),
            httpMetadata: {
              cacheControl: "private, no-store",
              contentType: "image/jpeg",
            },
            onlyIf: { etagDoesNotMatch: "*" },
            sha256: checksumBytes(reference.sha256),
          }),
      });
      if (written === null) {
        return yield* Effect.fail(
          failure("storage_failure", "visual_frame_conditional_create_rejected")
        );
      }
      yield* verifyFrame(bucket, document, reference)();
    }
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        Schema.encodeSync(VisualEvidenceManifestDocument)(document)
      )
    );
    if (bytes.byteLength > MaximumVisualEvidenceManifestBytes) {
      return yield* Effect.fail(
        failure("oversized", "visual_manifest_size_invalid")
      );
    }
    const sha256 = yield* digest(bytes).pipe(
      Effect.mapError(() =>
        failure("malformed", "visual_manifest_digest_invalid")
      )
    );
    const key = manifestKey(document.importId, document.acquisitionGeneration);
    const written = yield* Effect.tryPromise({
      catch: () => failure("storage_failure", "visual_manifest_put_failed"),
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
          sha256: checksumBytes(sha256),
        }),
    });
    if (written === null) {
      return yield* Effect.fail(
        failure(
          "storage_failure",
          "visual_manifest_conditional_create_rejected"
        )
      );
    }
    const verified = yield* readVerified(bucket)({
      dispatchId: document.dispatchId,
      generation: document.acquisitionGeneration,
      importId: document.importId,
      recoverySha256: sha256,
      sourceEvidenceDeleteAt: document.sourceEvidenceDeleteAt,
      sourceMediaSha256: document.sourceMediaSha256,
    });
    return yield* Option.match(verified, {
      onNone: () =>
        Effect.fail(
          failure("storage_failure", "visual_manifest_missing_after_write")
        ),
      onSome: Effect.succeed,
    });
  });

export const VisualEvidenceStoreLive = (bucket: AcquisitionBucketLike) =>
  Layer.succeed(
    VisualEvidenceStore,
    VisualEvidenceStore.of({
      putVerified: putVerified(bucket),
      readVerified: readVerified(bucket),
    })
  );
