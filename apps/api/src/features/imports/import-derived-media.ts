import { Effect, Schema } from "effect";

import type {
  AcquisitionBucketLike,
  AcquisitionMediaObjectLike,
  PreparedMediaArtifact,
} from "./import-media-acquirer.js";
import { putPrivateArtifact } from "./import-media-r2-upload.js";
import type { AcquisitionGeneration } from "./import-media.model.js";
import type { SpeechAudioExtractorShape } from "./import-speech-transcriber.js";
import type { VisualFrameSamplerShape } from "./import-visual-evidence-extractor.js";
import type { ImportId } from "./import.contracts.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);
const DerivedEvidenceManifest = Schema.Struct({
  audio: Schema.Struct({
    bytes: Schema.Number,
    durationMilliseconds: Schema.Number,
    key: Schema.String,
    sha256: Sha256Hex,
  }),
  frames: Schema.NonEmptyArray(
    Schema.Struct({
      bytes: Schema.Number,
      height: Schema.Number,
      key: Schema.String,
      sha256: Sha256Hex,
      timestampMilliseconds: Schema.Number,
      width: Schema.Number,
    })
  ),
  generation: Schema.Number,
  importId: Schema.String,
  schemaVersion: Schema.Literal(1),
  sourceMediaSha256: Sha256Hex,
});

const manifestKey = (importId: ImportId, generation: AcquisitionGeneration) =>
  `imports/${importId}/generations/${generation}/provider-evidence.json`;
const audioKey = (importId: ImportId, generation: AcquisitionGeneration) =>
  `imports/${importId}/generations/${generation}/provider-audio.wav`;
const frameKey = (
  importId: ImportId,
  generation: AcquisitionGeneration,
  index: number
) =>
  `imports/${importId}/generations/${generation}/provider-frame-${index}.jpg`;

const sha256Bytes = (hex: string) =>
  Uint8Array.from(hex.match(/.{2}/gu) ?? [], (pair) =>
    Number.parseInt(pair, 16)
  ).buffer;

const hash = (bytes: Uint8Array) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      Uint8Array.from(bytes).buffer
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  });

const derivedFailure = {
  _tag: "RetryableAcquisitionFailure",
  stage: "store",
} as const;

const putStream = (
  bucket: AcquisitionBucketLike,
  mediaObject: AcquisitionMediaObjectLike,
  input: {
    readonly artifactId: string;
    readonly bytes: number;
    readonly contentType: "audio/wav" | "image/jpeg";
    readonly key: string;
    readonly sha256: string;
  }
) =>
  putPrivateArtifact(bucket, {
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
  }).pipe(
    Effect.flatMap((stored) =>
      stored ? Effect.void : Effect.fail(derivedFailure)
    )
  );

/** Derive and privately persist bounded provider inputs before container cleanup. */
export const persistDerivedProviderEvidence = (
  bucket: AcquisitionBucketLike,
  mediaObject: AcquisitionMediaObjectLike,
  prepared: PreparedMediaArtifact,
  input: {
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
  }
) =>
  Effect.gen(function* persistDerivedEvidence() {
    if (mediaObject.prepareProviderEvidence === undefined) {
      return yield* Effect.fail(derivedFailure);
    }
    const derived = yield* mediaObject.prepareProviderEvidence(
      prepared.artifactId,
      prepared.durationSeconds
    );
    const storedAudioKey = audioKey(input.importId, input.generation);
    yield* putStream(bucket, mediaObject, {
      ...derived.audio,
      contentType: "audio/wav",
      key: storedAudioKey,
    });
    const storedFrames = yield* Effect.forEach(
      derived.frames,
      (frame, index) =>
        Effect.gen(function* storeFrame() {
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
        }),
      { concurrency: 1 }
    );
    const manifest = {
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
      sourceMediaSha256: prepared.sha256,
    } as const;
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    const sha256 = yield* hash(bytes);
    const stored = yield* Effect.tryPromise({
      catch: () => derivedFailure,
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
      return yield* Effect.fail(derivedFailure);
    }
  });

const readManifest = (
  bucket: AcquisitionBucketLike,
  importId: ImportId,
  generation: AcquisitionGeneration,
  sourceMediaSha256: string
) =>
  Effect.tryPromise({
    catch: () => new Error("Derived evidence unavailable"),
    try: async () => {
      const object = await bucket.get(manifestKey(importId, generation));
      if (object === null) {
        throw new Error("Derived evidence unavailable");
      }
      const decoded = Schema.decodeUnknownSync(DerivedEvidenceManifest, {
        onExcessProperty: "error",
      })(JSON.parse(await object.text()));
      if (
        decoded.importId !== importId ||
        decoded.generation !== generation ||
        decoded.sourceMediaSha256 !== sourceMediaSha256
      ) {
        throw new Error("Derived evidence identity mismatch");
      }
      return decoded;
    },
  });

const readBytes = (bucket: AcquisitionBucketLike, key: string) =>
  Effect.tryPromise({
    catch: () => new Error("Derived evidence unavailable"),
    try: async () => {
      const object = await bucket.get(key);
      if (object === null || object.arrayBuffer === undefined) {
        throw new Error("Derived evidence unavailable");
      }
      return new Uint8Array(await object.arrayBuffer());
    },
  });

/** Private-R2 audio adapter for the real workflow. */
export const makeR2SpeechAudioExtractor = (
  bucket: AcquisitionBucketLike
): SpeechAudioExtractorShape => ({
  extract: (input) =>
    Effect.gen(function* extractAudio() {
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
        return yield* Effect.fail(new Error("Audio evidence mismatch"));
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
    ),
});

/** Private-R2 ordered frame adapter for the real workflow. */
export const makeR2VisualFrameSampler = (
  bucket: AcquisitionBucketLike
): VisualFrameSamplerShape => ({
  sample: (input) =>
    Effect.gen(function* sampleFrames() {
      const manifest = yield* readManifest(
        bucket,
        input.importId,
        input.generation,
        input.sourceMediaSha256
      );
      return yield* Effect.forEach(
        manifest.frames,
        (frame) =>
          Effect.gen(function* readFrame() {
            const bytes = yield* readBytes(bucket, frame.key);
            const actualHash = yield* hash(bytes);
            if (
              bytes.byteLength !== frame.bytes ||
              actualHash !== frame.sha256
            ) {
              return yield* Effect.fail(new Error("Frame evidence mismatch"));
            }
            return {
              bytes,
              height: frame.height,
              mimeType: "image/jpeg" as const,
              sha256: actualHash,
              timestampMilliseconds: frame.timestampMilliseconds,
              width: frame.width,
            };
          }),
        { concurrency: 1 }
      );
    }).pipe(
      Effect.mapError(() => ({
        _tag: "VisualFrameSamplingFailure" as const,
        code: "frame_sampling_failed" as const,
      }))
    ),
});
