import { Context, DateTime, Effect, Option, Schema, Stream } from "effect";

import type {
  AcquisitionGeneration,
  AcquisitionTaskOutcome,
  MediaLimits,
  RetryableAcquisitionFailure,
  TerminalMediaFailure,
  TikTokIdentity,
  UnavailableFailure,
  UnsupportedCarouselFailure,
  VerifiedAcquisitionEvidence,
} from "./import-media.model.js";
import {
  AcquisitionGeneration as AcquisitionGenerationSchema,
  EvidenceRetentionSeconds,
  MaximumLocalCleanupMilliseconds,
  MaximumMediaBytes,
  MaximumMediaDurationSeconds,
  MaximumR2OperationMilliseconds,
  MediaStreamSummary,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import type {
  CanonicalSourceMetadata,
  ResolvedVideoSource,
} from "./import-source-resolver.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";

export interface ValidatedMediaArtifact {
  readonly audioStreams: readonly {
    readonly codec: string;
    readonly index: number;
  }[];
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly filePath: string;
  readonly metadata: CanonicalSourceMetadata;
  readonly sha256: string;
  readonly videoStreams: readonly {
    readonly codec: string;
    readonly index: number;
  }[];
}

export interface MediaAcquirerShape {
  readonly acquire: (
    source: ResolvedVideoSource,
    limits: MediaLimits,
    workspaceRoot: string
  ) => Effect.Effect<
    ValidatedMediaArtifact,
    RetryableAcquisitionFailure | TerminalMediaFailure | UnavailableFailure
  >;
}

export class MediaAcquirer extends Context.Service<
  MediaAcquirer,
  MediaAcquirerShape
>()("meal-planner/MediaAcquirer") {}

export type ContainerAcquisitionError =
  | RetryableAcquisitionFailure
  | TerminalMediaFailure
  | UnavailableFailure
  | UnsupportedCarouselFailure;

export interface PreparedMediaArtifact {
  readonly artifactId: string;
  readonly audioStreams: readonly {
    readonly codec: string;
    readonly index: number;
  }[];
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly metadata: CanonicalSourceMetadata;
  readonly sha256: string;
  readonly videoStreams: readonly {
    readonly codec: string;
    readonly index: number;
  }[];
}

interface R2ObjectLike {
  readonly checksums?: { readonly sha256?: ArrayBuffer };
  readonly customMetadata?: Record<string, string>;
  readonly httpMetadata?: {
    readonly cacheControl?: string;
    readonly contentType?: string;
  };
  readonly size: number;
}

interface R2ObjectBodyLike extends R2ObjectLike {
  readonly text: () => Promise<string>;
}

export interface AcquisitionPutOptions {
  readonly contentLength: number;
  readonly customMetadata: Record<string, string>;
  readonly httpMetadata: {
    readonly cacheControl: "private, no-store";
    readonly contentType: "application/json" | "image/jpeg" | "video/mp4";
  };
  readonly onlyIf: { readonly etagDoesNotMatch: "*" };
  readonly sha256: ArrayBuffer;
}

export interface AcquisitionBucketLike {
  readonly get: (key: string) => Promise<R2ObjectBodyLike | null>;
  readonly head: (key: string) => Promise<R2ObjectLike | null>;
  readonly put: (
    key: string,
    value: ArrayBufferView | ReadableStream,
    options: AcquisitionPutOptions
  ) => Promise<R2ObjectLike | null>;
}

export interface AcquisitionMediaObjectLike {
  readonly cleanup: (artifactId: string) => Effect.Effect<void>;
  readonly prepare: (
    input: TikTokIdentity
  ) => Effect.Effect<PreparedMediaArtifact, ContainerAcquisitionError>;
  readonly stream: (
    artifactId: string
  ) => Stream.Stream<Uint8Array, RetryableAcquisitionFailure>;
}

const NullableString = Schema.NullOr(Schema.String);
const AcquisitionManifest = Schema.Struct({
  acquiredAt: ImportTimestamp,
  audioStreams: Schema.NonEmptyArray(MediaStreamSummary),
  bytes: Schema.Number,
  canonicalId: SourceCanonicalId,
  canonicalUrl: Schema.String,
  caption: NullableString,
  creator: Schema.Struct({
    displayName: NullableString,
    handle: NullableString,
    id: NullableString,
  }),
  deleteAt: ImportTimestamp,
  durationSeconds: Schema.Number,
  ffmpegVersion: Schema.Literal("8.1.2"),
  generation: AcquisitionGenerationSchema,
  importId: ImportId,
  manifestKey: Schema.String,
  mediaKey: Schema.String,
  mediaType: Schema.Literal("video/mp4"),
  observedAt: ImportTimestamp,
  originalStreamsRemuxedToMp4: Schema.Literal(true),
  provenance: Schema.Struct({
    canonicalUrl: Schema.Literal("provider_observed"),
    caption: Schema.NullOr(Schema.Literal("creator_provided")),
    creator: Schema.Struct({
      displayName: Schema.NullOr(Schema.Literal("provider_observed")),
      handle: Schema.NullOr(Schema.Literal("provider_observed")),
      id: Schema.NullOr(Schema.Literal("provider_observed")),
    }),
    publishedAt: Schema.NullOr(Schema.Literal("provider_observed")),
  }),
  publishedAt: Schema.NullOr(ImportTimestamp),
  schemaVersion: Schema.Literal(1),
  sha256: Schema.String,
  videoStreams: Schema.NonEmptyArray(MediaStreamSummary),
  ytDlpVersion: Schema.Literal("2026.07.04"),
});

const isCanonicalUrlFor = (value: string, canonicalId: SourceCanonicalId) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === "" &&
      ["tiktok.com", "www.tiktok.com"].includes(url.hostname) &&
      new RegExp(`^/@[^/]+/video/${canonicalId}$`, "u").test(url.pathname)
    );
  } catch {
    return false;
  }
};

const hasConsistentProvenance = (manifest: typeof AcquisitionManifest.Type) =>
  (manifest.caption === null) === (manifest.provenance.caption === null) &&
  (manifest.creator.displayName === null) ===
    (manifest.provenance.creator.displayName === null) &&
  (manifest.creator.handle === null) ===
    (manifest.provenance.creator.handle === null) &&
  (manifest.creator.id === null) ===
    (manifest.provenance.creator.id === null) &&
  (manifest.publishedAt === null) ===
    (manifest.provenance.publishedAt === null);

const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

const nativeSha256Hex = (object: R2ObjectLike) => {
  const checksum = object.checksums?.sha256;
  return checksum === undefined ? null : bytesToHex(checksum);
};

const sha256Bytes = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
};

const sha256Hex = (bytes: Uint8Array) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
  ).pipe(Effect.map(bytesToHex));

const objectMetadata = (
  importId: ImportId,
  generation: AcquisitionGeneration,
  kind: "manifest" | "media",
  sha256: string
) => ({
  generation: String(generation),
  importId,
  kind,
  sha256,
});

const hasExpectedMetadata = (
  object: R2ObjectLike,
  expected: Record<string, string>
) =>
  Object.keys(object.customMetadata ?? {}).length === 4 &&
  Object.entries(expected).every(
    ([key, value]) => object.customMetadata?.[key] === value
  );

const retryableAt = (
  stage: RetryableAcquisitionFailure["stage"]
): RetryableAcquisitionFailure => ({
  _tag: "RetryableAcquisitionFailure",
  stage,
});

const r2Effect = <A>(
  stage: RetryableAcquisitionFailure["stage"],
  operation: () => Promise<A>
) =>
  Effect.tryPromise({
    catch: () => retryableAt(stage),
    try: operation,
  }).pipe(
    Effect.timeoutOrElse({
      duration: MaximumR2OperationMilliseconds,
      orElse: () => Effect.fail(retryableAt(stage)),
    })
  );

const r2MutationEffect = <A>(
  stage: RetryableAcquisitionFailure["stage"],
  operation: () => Promise<A>,
  onDeadline?: () => void
) =>
  Effect.callback<A, RetryableAcquisitionFailure>((resume) => {
    let completed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (effect: Effect.Effect<A, RetryableAcquisitionFailure>) => {
      if (completed) {
        return;
      }
      completed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resume(effect);
    };
    try {
      const pending = operation();
      void (async () => {
        try {
          finish(Effect.succeed(await pending));
        } catch {
          finish(Effect.fail(retryableAt(stage)));
        }
      })();
      timer = setTimeout(() => {
        onDeadline?.();
        finish(Effect.fail(retryableAt(stage)));
      }, MaximumR2OperationMilliseconds);
    } catch {
      finish(Effect.fail(retryableAt(stage)));
    }
    return Effect.sync(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      onDeadline?.();
    });
  });

const boundedCleanup = (cleanup: Effect.Effect<void>) =>
  cleanup.pipe(
    Effect.timeoutOrElse({
      duration: MaximumLocalCleanupMilliseconds,
      orElse: () => Effect.void,
    }),
    Effect.exit,
    Effect.asVoid
  );

const putMediaObject = (
  bucket: AcquisitionBucketLike,
  mediaObject: AcquisitionMediaObjectLike,
  prepared: PreparedMediaArtifact,
  input: {
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly mediaKey: string;
  }
) =>
  Effect.callback<R2ObjectLike | null, RetryableAcquisitionFailure>(
    (resume) => {
      let completed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      const finish = (
        effect: Effect.Effect<R2ObjectLike | null, RetryableAcquisitionFailure>
      ) => {
        if (completed) {
          return;
        }
        completed = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        resume(effect);
      };
      try {
        const FixedLengthStreamConstructor = (
          globalThis as unknown as {
            readonly FixedLengthStream: new (length: number) => {
              readonly readable: ReadableStream;
              readonly writable: WritableStream<Uint8Array>;
            };
          }
        ).FixedLengthStream;
        const fixedLength = new FixedLengthStreamConstructor(prepared.bytes);
        const piping = Stream.toReadableStream(
          mediaObject.stream(prepared.artifactId)
        ).pipeTo(fixedLength.writable, { signal: controller.signal });
        const putting = bucket.put(input.mediaKey, fixedLength.readable, {
          contentLength: prepared.bytes,
          customMetadata: objectMetadata(
            input.importId,
            input.generation,
            "media",
            prepared.sha256
          ),
          httpMetadata: {
            cacheControl: "private, no-store",
            contentType: "video/mp4",
          },
          onlyIf: { etagDoesNotMatch: "*" },
          sha256: sha256Bytes(prepared.sha256),
        });
        void (async () => {
          try {
            const [stored] = await Promise.all([putting, piping]);
            finish(Effect.succeed(stored));
          } catch {
            controller.abort();
            const localDeadline = setTimeout(
              () => finish(Effect.fail(retryableAt("store"))),
              MaximumLocalCleanupMilliseconds
            );
            try {
              await piping;
            } catch {
              // The local stream cancellation is expected on a failed put.
            }
            clearTimeout(localDeadline);
            finish(Effect.fail(retryableAt("store")));
          }
        })();
        timer = setTimeout(() => {
          controller.abort();
          finish(Effect.fail(retryableAt("store")));
        }, MaximumR2OperationMilliseconds);
      } catch {
        controller.abort();
        finish(Effect.fail(retryableAt("store")));
      }
      return Effect.sync(() => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        controller.abort();
      });
    }
  );

const readCommittedPair = (
  bucket: AcquisitionBucketLike,
  importId: ImportId,
  generation: AcquisitionGeneration
) =>
  Effect.gen(function* readPair() {
    const media = yield* r2Effect("verify", () =>
      bucket.head(mediaObjectKey(importId, generation))
    );
    const manifest = yield* r2Effect("verify", () =>
      bucket.get(manifestObjectKey(importId, generation))
    );
    return { manifest, media };
  });

type AcquisitionManifestValue = typeof AcquisitionManifest.Type;

const manifestMatchesIdentity = (
  value: AcquisitionManifestValue,
  importId: ImportId,
  generation: AcquisitionGeneration,
  canonicalId: SourceCanonicalId
) =>
  value.importId === importId &&
  value.generation === generation &&
  value.canonicalId === canonicalId &&
  isCanonicalUrlFor(value.canonicalUrl, canonicalId) &&
  hasConsistentProvenance(value) &&
  value.mediaKey === mediaObjectKey(importId, generation) &&
  value.manifestKey === manifestObjectKey(importId, generation);

const mediaObjectMatchesManifest = (
  media: R2ObjectLike,
  value: AcquisitionManifestValue,
  expectedMetadata: Record<string, string>
) =>
  value.bytes === media.size &&
  value.sha256 === nativeSha256Hex(media) &&
  hasExpectedMetadata(media, expectedMetadata) &&
  media.httpMetadata?.contentType === "video/mp4" &&
  media.httpMetadata.cacheControl === "private, no-store";

const manifestObjectMatchesBody = (
  manifest: R2ObjectBodyLike,
  manifestBytes: Uint8Array,
  manifestSha256: string,
  expectedMetadata: Record<string, string>
) =>
  manifest.size === manifestBytes.byteLength &&
  manifestSha256 === nativeSha256Hex(manifest) &&
  hasExpectedMetadata(manifest, expectedMetadata) &&
  manifest.httpMetadata?.contentType === "application/json" &&
  manifest.httpMetadata.cacheControl === "private, no-store";

const manifestIsCurrentAndBounded = (
  value: AcquisitionManifestValue,
  observedAt: Date
) =>
  Number.isSafeInteger(value.bytes) &&
  value.bytes > 0 &&
  value.bytes <= MaximumMediaBytes &&
  Number.isFinite(value.durationSeconds) &&
  value.durationSeconds > 0 &&
  value.durationSeconds <= MaximumMediaDurationSeconds &&
  DateTime.toEpochMillis(value.deleteAt) -
    DateTime.toEpochMillis(value.acquiredAt) ===
    EvidenceRetentionSeconds * 1000 &&
  DateTime.toEpochMillis(value.deleteAt) > observedAt.getTime() &&
  /^[a-f\d]{64}$/u.test(value.sha256);

const decodeCommittedEvidence = (
  importId: ImportId,
  generation: AcquisitionGeneration,
  canonicalId: SourceCanonicalId,
  media: R2ObjectLike | null,
  manifest: R2ObjectBodyLike | null,
  observedAt: Date
) =>
  Effect.gen(function* decodeEvidence() {
    if (media === null || manifest === null) {
      return null;
    }
    const manifestText = yield* r2Effect("verify", () => manifest.text());
    const manifestBytes = new TextEncoder().encode(manifestText);
    const manifestSha256 = yield* sha256Hex(manifestBytes);
    const parsed = yield* Effect.try({
      catch: () => null,
      try: () => JSON.parse(manifestText) as unknown,
    }).pipe(Effect.option);
    if (Option.isNone(parsed)) {
      return null;
    }
    const value = Option.getOrUndefined(
      Schema.decodeUnknownOption(AcquisitionManifest, {
        onExcessProperty: "error",
      })(parsed.value)
    );
    if (value === undefined) {
      return null;
    }
    const expectedMediaMetadata = objectMetadata(
      importId,
      generation,
      "media",
      value.sha256
    );
    const expectedManifestMetadata = objectMetadata(
      importId,
      generation,
      "manifest",
      manifestSha256
    );
    const valid =
      manifestMatchesIdentity(value, importId, generation, canonicalId) &&
      mediaObjectMatchesManifest(media, value, expectedMediaMetadata) &&
      manifestObjectMatchesBody(
        manifest,
        manifestBytes,
        manifestSha256,
        expectedManifestMetadata
      ) &&
      manifestIsCurrentAndBounded(value, observedAt);
    if (!valid) {
      return null;
    }
    return {
      acquiredAt: value.acquiredAt,
      audioStreams: value.audioStreams,
      bytes: value.bytes,
      deleteAt: value.deleteAt,
      durationSeconds: value.durationSeconds,
      generation,
      manifestKey: value.manifestKey,
      mediaKey: value.mediaKey,
      sha256: value.sha256,
      videoStreams: value.videoStreams,
    } satisfies VerifiedAcquisitionEvidence;
  });

/** Re-verify the immutable GAIA-109 media/manifest pair before downstream use. */
export const readVerifiedAcquisitionEvidence = (
  bucket: AcquisitionBucketLike,
  input: {
    readonly canonicalId: SourceCanonicalId;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly now: () => Date;
  }
) =>
  readCommittedPair(bucket, input.importId, input.generation).pipe(
    Effect.flatMap(({ manifest, media }) =>
      decodeCommittedEvidence(
        input.importId,
        input.generation,
        input.canonicalId,
        media,
        manifest,
        input.now()
      )
    )
  );

export const acquireStoreVerify = (
  bucket: AcquisitionBucketLike,
  mediaObject: AcquisitionMediaObjectLike,
  input: {
    readonly canonicalId: SourceCanonicalId;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly now: () => Date;
  }
): Effect.Effect<AcquisitionTaskOutcome, RetryableAcquisitionFailure> =>
  Effect.gen(function* acquireAndStore() {
    const prepared = yield* mediaObject
      .prepare({
        canonicalId: input.canonicalId,
        generation: input.generation,
        importId: input.importId,
        kind: "tiktok",
      })
      .pipe(
        Effect.matchEffect({
          onFailure: (failure) =>
            failure._tag === "RetryableAcquisitionFailure"
              ? Effect.fail(failure)
              : Effect.succeed({ ...failure, generation: input.generation }),
          onSuccess: Effect.succeed,
        })
      );
    if ("_tag" in prepared) {
      return prepared;
    }
    return yield* Effect.gen(function* storePrepared() {
      const acquiredAtDate = input.now();
      const acquiredAt = acquiredAtDate.toISOString();
      const deleteAt = new Date(
        acquiredAtDate.getTime() + EvidenceRetentionSeconds * 1000
      ).toISOString();
      const mediaKey = mediaObjectKey(input.importId, input.generation);
      const manifestKey = manifestObjectKey(input.importId, input.generation);
      const storedMedia = yield* putMediaObject(bucket, mediaObject, prepared, {
        generation: input.generation,
        importId: input.importId,
        mediaKey,
      });
      if (storedMedia === null) {
        return yield* Effect.fail(retryableAt("store"));
      }
      const manifest = {
        acquiredAt,
        audioStreams: prepared.audioStreams,
        bytes: prepared.bytes,
        canonicalId: input.canonicalId,
        canonicalUrl: prepared.metadata.canonicalUrl,
        caption: prepared.metadata.caption,
        creator: prepared.metadata.creator,
        deleteAt,
        durationSeconds: prepared.durationSeconds,
        ffmpegVersion: "8.1.2",
        generation: input.generation,
        importId: input.importId,
        manifestKey,
        mediaKey,
        mediaType: "video/mp4",
        observedAt: prepared.metadata.observedAt,
        originalStreamsRemuxedToMp4: true,
        provenance: prepared.metadata.provenance,
        publishedAt: prepared.metadata.publishedAt,
        schemaVersion: 1,
        sha256: prepared.sha256,
        videoStreams: prepared.videoStreams,
        ytDlpVersion: "2026.07.04",
      } as const;
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
      const manifestSha256 = yield* sha256Hex(manifestBytes);
      const storedManifest = yield* r2MutationEffect("store", () =>
        bucket.put(manifestKey, manifestBytes, {
          contentLength: manifestBytes.byteLength,
          customMetadata: objectMetadata(
            input.importId,
            input.generation,
            "manifest",
            manifestSha256
          ),
          httpMetadata: {
            cacheControl: "private, no-store",
            contentType: "application/json",
          },
          onlyIf: { etagDoesNotMatch: "*" },
          sha256: sha256Bytes(manifestSha256),
        })
      );
      if (storedManifest === null) {
        return yield* Effect.fail(retryableAt("store"));
      }
      const stored = yield* readCommittedPair(
        bucket,
        input.importId,
        input.generation
      );
      const evidence = yield* decodeCommittedEvidence(
        input.importId,
        input.generation,
        input.canonicalId,
        stored.media,
        stored.manifest,
        input.now()
      );
      if (evidence === null) {
        return yield* Effect.fail(retryableAt("verify"));
      }
      return {
        _tag: "VerifiedAcquisition",
        evidence,
        generation: input.generation,
      } as const;
    }).pipe(
      Effect.ensuring(boundedCleanup(mediaObject.cleanup(prepared.artifactId)))
    );
  });
