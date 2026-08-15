import { Effect, Schema } from "effect";

import type {
  AcquisitionBucketLike,
  AcquisitionMediaObjectLike,
  VerifiedPreparedMediaArtifact,
} from "./import-media-acquirer.js";
import { putPrivateArtifact } from "./import-media-r2-upload.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import {
  AcquisitionGeneration,
  FrameTimestampMilliseconds,
  MediaArtifactId,
  MediaByteCount,
  MediaDurationMilliseconds,
  Sha256Hex,
} from "./import-media.model.js";
import type {
  AcquisitionGeneration as AcquisitionGenerationType,
  MediaArtifactId as MediaArtifactIdType,
  MediaByteCount as MediaByteCountType,
  RetryableAcquisitionFailure,
  Sha256Hex as Sha256HexType,
} from "./import-media.model.js";
import type { SpeechAudioExtractorShape } from "./import-speech-transcriber.js";
import type { VisualFrameSamplerShape } from "./import-visual-evidence-extractor.js";
import { ImportId } from "./import.contracts.js";
import type { ImportId as ImportIdType } from "./import.contracts.js";

const ImportUuidPattern =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const DerivedManifestObjectKey = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      new RegExp(
        `^imports/${ImportUuidPattern}/generations/[0-9]+/provider-evidence\\.json$`,
        "iu"
      )
    )
  ),
  Schema.brand("DerivedManifestObjectKey")
);
type DerivedManifestObjectKey = typeof DerivedManifestObjectKey.Type;

const DerivedAudioObjectKey = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      new RegExp(
        `^imports/${ImportUuidPattern}/generations/[0-9]+/provider-audio\\.wav$`,
        "iu"
      )
    )
  ),
  Schema.brand("DerivedAudioObjectKey")
);
type DerivedAudioObjectKey = typeof DerivedAudioObjectKey.Type;

const DerivedFrameObjectKey = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      new RegExp(
        `^imports/${ImportUuidPattern}/generations/[0-9]+/provider-frame-[0-9]+\\.jpg$`,
        "iu"
      )
    )
  ),
  Schema.brand("DerivedFrameObjectKey")
);
type DerivedFrameObjectKey = typeof DerivedFrameObjectKey.Type;

const ImageDimension = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0))
);

const ProviderEvidenceTransport = Schema.Struct({
  audio: Schema.Struct({
    artifactId: MediaArtifactId,
    bytes: MediaByteCount,
    durationMilliseconds: MediaDurationMilliseconds,
    sha256: Sha256Hex,
  }),
  frames: Schema.NonEmptyArray(
    Schema.Struct({
      artifactId: MediaArtifactId,
      bytes: MediaByteCount,
      height: ImageDimension,
      sha256: Sha256Hex,
      timestampMilliseconds: FrameTimestampMilliseconds,
      width: ImageDimension,
    })
  ),
});

const DerivedEvidenceManifest = Schema.Struct({
  audio: Schema.Struct({
    bytes: MediaByteCount,
    durationMilliseconds: MediaDurationMilliseconds,
    key: DerivedAudioObjectKey,
    sha256: Sha256Hex,
  }),
  frames: Schema.NonEmptyArray(
    Schema.Struct({
      bytes: MediaByteCount,
      height: ImageDimension,
      key: DerivedFrameObjectKey,
      sha256: Sha256Hex,
      timestampMilliseconds: FrameTimestampMilliseconds,
      width: ImageDimension,
    })
  ),
  generation: AcquisitionGeneration,
  importId: ImportId,
  schemaVersion: Schema.Literal(1),
  sourceMediaSha256: Sha256Hex,
});

const manifestKey = (
  importId: ImportIdType,
  generation: AcquisitionGenerationType
) =>
  Schema.decodeUnknownSync(DerivedManifestObjectKey)(
    `imports/${importId}/generations/${generation}/provider-evidence.json`
  );

const audioKey = (
  importId: ImportIdType,
  generation: AcquisitionGenerationType
) =>
  Schema.decodeUnknownSync(DerivedAudioObjectKey)(
    `imports/${importId}/generations/${generation}/provider-audio.wav`
  );

const frameKey = (
  importId: ImportIdType,
  generation: AcquisitionGenerationType,
  index: number
) =>
  Schema.decodeUnknownSync(DerivedFrameObjectKey)(
    `imports/${importId}/generations/${generation}/provider-frame-${index}.jpg`
  );

const sha256Bytes = (hex: Sha256HexType) =>
  Uint8Array.from(hex.match(/.{2}/gu) ?? [], (pair) =>
    Number.parseInt(pair, 16)
  ).buffer;

const derivedFailure = (): RetryableAcquisitionFailure =>
  new RetryableAcquisitionError({ stage: "store" });

const hash = Effect.fn("ImportDerivedMedia.hash")(function* hashEffect(
  bytes: Uint8Array
) {
  const digest = yield* Effect.tryPromise({
    catch: derivedFailure,
    try: () => crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
  });
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return yield* Schema.decodeUnknownEffect(Sha256Hex)(hex).pipe(
    Effect.mapError(derivedFailure)
  );
});

const putStream = Effect.fn("ImportDerivedMedia.putStream")(
  function* putStreamEffect(
    bucket: AcquisitionBucketLike,
    mediaObject: AcquisitionMediaObjectLike,
    input: {
      readonly artifactId: MediaArtifactIdType;
      readonly bytes: MediaByteCountType;
      readonly contentType: "audio/wav" | "image/jpeg";
      readonly key: DerivedAudioObjectKey | DerivedFrameObjectKey;
      readonly sha256: Sha256HexType;
    }
  ) {
    const stored = yield* putPrivateArtifact(bucket, {
      key: input.key,
      options: {
        contentLength: input.bytes,
        customMetadata: {
          kind: "provider-evidence",
          sha256: input.sha256,
        },
        httpMetadata: {
          cacheControl: "private, no-store",
          contentType: input.contentType,
        },
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: sha256Bytes(input.sha256),
      },
      stream: mediaObject.readArtifact(input.artifactId),
    });
    if (!stored) {
      return yield* Effect.fail(derivedFailure());
    }
  }
);

/** Derive and privately persist bounded provider inputs before container cleanup. */
export const persistDerivedProviderEvidence = Effect.fn(
  "ImportDerivedMedia.persistProviderEvidence"
)(function* persistProviderEvidenceEffect(
  bucket: AcquisitionBucketLike,
  mediaObject: AcquisitionMediaObjectLike,
  prepared: VerifiedPreparedMediaArtifact,
  input: {
    readonly generation: AcquisitionGenerationType;
    readonly importId: ImportIdType;
  }
) {
  if (mediaObject.prepareProviderEvidence === undefined) {
    return yield* Effect.fail(derivedFailure());
  }

  const sourceMediaSha256 = yield* Schema.decodeUnknownEffect(Sha256Hex)(
    prepared.sha256
  ).pipe(Effect.mapError(derivedFailure));
  const transport = yield* mediaObject.prepareProviderEvidence(
    prepared.artifactId,
    prepared.durationSeconds
  );
  const derived = yield* Schema.decodeUnknownEffect(ProviderEvidenceTransport)(
    transport
  ).pipe(Effect.mapError(derivedFailure));

  const storedAudioKey = audioKey(input.importId, input.generation);
  yield* putStream(bucket, mediaObject, {
    ...derived.audio,
    contentType: "audio/wav",
    key: storedAudioKey,
  });

  const storedFrames = yield* Effect.forEach(
    derived.frames,
    Effect.fn("ImportDerivedMedia.storeFrame")(
      function* storeFrameEffect(frame, index) {
        const key = frameKey(input.importId, input.generation, index);
        yield* putStream(bucket, mediaObject, {
          ...frame,
          contentType: "image/jpeg",
          key,
        });
        return {
          bytes: frame.bytes,
          height: frame.height,
          key,
          sha256: frame.sha256,
          timestampMilliseconds: frame.timestampMilliseconds,
          width: frame.width,
        };
      }
    ),
    { concurrency: 1 }
  );

  const manifest = yield* Schema.decodeUnknownEffect(DerivedEvidenceManifest)({
    audio: {
      bytes: derived.audio.bytes,
      durationMilliseconds: derived.audio.durationMilliseconds,
      key: storedAudioKey,
      sha256: derived.audio.sha256,
    },
    frames: storedFrames,
    generation: input.generation,
    importId: input.importId,
    schemaVersion: 1,
    sourceMediaSha256,
  }).pipe(Effect.mapError(derivedFailure));
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const sha256 = yield* hash(bytes);
  const stored = yield* Effect.tryPromise({
    catch: derivedFailure,
    try: () =>
      bucket.put(manifestKey(input.importId, input.generation), bytes, {
        contentLength: bytes.byteLength,
        customMetadata: { kind: "provider-evidence-manifest", sha256 },
        httpMetadata: {
          cacheControl: "private, no-store",
          contentType: "application/json",
        },
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: sha256Bytes(sha256),
      }),
  });
  if (stored === null) {
    return yield* Effect.fail(derivedFailure());
  }
});

const DerivedEvidenceReadOperation = Schema.Literals([
  "getManifest",
  "decodeManifest",
  "verifyIdentity",
  "getObject",
  "verifyObject",
]);

interface DerivedEvidenceReadError {
  readonly _tag: "DerivedEvidenceReadError";
  readonly operation: typeof DerivedEvidenceReadOperation.Type;
}
const DerivedEvidenceReadError =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<DerivedEvidenceReadError>()("DerivedEvidenceReadError", {
    operation: DerivedEvidenceReadOperation,
  });

const readFailure = (operation: typeof DerivedEvidenceReadOperation.Type) =>
  new DerivedEvidenceReadError({ operation });

const readManifest = Effect.fn("ImportDerivedMedia.readManifest")(
  function* readManifestEffect(
    bucket: AcquisitionBucketLike,
    importId: ImportIdType,
    generation: AcquisitionGenerationType,
    sourceMediaSha256: string
  ) {
    const expectedSha256 = yield* Schema.decodeUnknownEffect(Sha256Hex)(
      sourceMediaSha256
    ).pipe(Effect.mapError(() => readFailure("verifyIdentity")));
    const object = yield* Effect.tryPromise({
      catch: () => readFailure("getManifest"),
      try: () => bucket.get(manifestKey(importId, generation)),
    });
    if (object === null) {
      return yield* Effect.fail(readFailure("getManifest"));
    }
    const text = yield* Effect.tryPromise({
      catch: () => readFailure("decodeManifest"),
      try: () => object.text(),
    });
    const unknownManifest = yield* Effect.try({
      catch: () => readFailure("decodeManifest"),
      try: () => JSON.parse(text) as unknown,
    });
    const decoded = yield* Schema.decodeUnknownEffect(DerivedEvidenceManifest, {
      onExcessProperty: "error",
    })(unknownManifest).pipe(
      Effect.mapError(() => readFailure("decodeManifest"))
    );
    if (
      decoded.importId !== importId ||
      decoded.generation !== generation ||
      decoded.sourceMediaSha256 !== expectedSha256
    ) {
      return yield* Effect.fail(readFailure("verifyIdentity"));
    }
    return decoded;
  }
);

const readBytes = Effect.fn("ImportDerivedMedia.readBytes")(
  function* readBytesEffect(
    bucket: AcquisitionBucketLike,
    key: DerivedAudioObjectKey | DerivedFrameObjectKey
  ) {
    const object = yield* Effect.tryPromise({
      catch: () => readFailure("getObject"),
      try: () => bucket.get(key),
    });
    if (object === null || object.arrayBuffer === undefined) {
      return yield* Effect.fail(readFailure("getObject"));
    }
    const readObject = object.arrayBuffer.bind(object);
    const bytes = yield* Effect.tryPromise({
      catch: () => readFailure("getObject"),
      try: () => readObject(),
    });
    return new Uint8Array(bytes);
  }
);

/** Private-R2 audio adapter for the real workflow. */
export const makeR2SpeechAudioExtractor = (
  bucket: AcquisitionBucketLike
): SpeechAudioExtractorShape => ({
  extract: Effect.fn("ImportDerivedMedia.extractAudio")((input) =>
    Effect.gen(function* extractAudioEffect() {
      const manifest = yield* readManifest(
        bucket,
        input.importId,
        input.generation,
        input.sourceMediaSha256
      );
      const bytes = yield* readBytes(bucket, manifest.audio.key);
      const actualHash = yield* hash(bytes);
      if (
        bytes.byteLength !== manifest.audio.bytes ||
        actualHash !== manifest.audio.sha256
      ) {
        return yield* Effect.fail(readFailure("verifyObject"));
      }
      return {
        bytes,
        durationMilliseconds: manifest.audio.durationMilliseconds,
        mimeType: "audio/wav" as const,
        sha256: actualHash,
      };
    }).pipe(
      Effect.mapError(() => ({
        _tag: "SpeechAudioExtractionFailure" as const,
        code: "audio_extraction_failed" as const,
      }))
    )
  ),
});

/** Private-R2 ordered frame adapter for the real workflow. */
export const makeR2VisualFrameSampler = (
  bucket: AcquisitionBucketLike
): VisualFrameSamplerShape => ({
  sample: Effect.fn("ImportDerivedMedia.sampleFrames")((input) =>
    Effect.gen(function* sampleFramesEffect() {
      const manifest = yield* readManifest(
        bucket,
        input.importId,
        input.generation,
        input.sourceMediaSha256
      );
      return yield* Effect.forEach(
        manifest.frames,
        Effect.fn("ImportDerivedMedia.readFrame")(
          function* readFrameEffect(frame) {
            const bytes = yield* readBytes(bucket, frame.key);
            const actualHash = yield* hash(bytes);
            if (
              bytes.byteLength !== frame.bytes ||
              actualHash !== frame.sha256
            ) {
              return yield* Effect.fail(readFailure("verifyObject"));
            }
            return {
              bytes,
              height: frame.height,
              mimeType: "image/jpeg" as const,
              sha256: actualHash,
              timestampMilliseconds: frame.timestampMilliseconds,
              width: frame.width,
            };
          }
        ),
        { concurrency: 1 }
      );
    }).pipe(
      Effect.mapError(() => ({
        _tag: "VisualFrameSamplingFailure" as const,
        code: "frame_sampling_failed" as const,
      }))
    )
  ),
});
