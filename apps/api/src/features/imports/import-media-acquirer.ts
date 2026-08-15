import { Clock, Context, DateTime, Effect, Option, Schema } from "effect";
import type { Stream } from "effect";

import { putPrivateArtifact } from "./import-media-r2-upload.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import type {
  AcquisitionFailureReason,
  AcquisitionGeneration,
  AcquisitionTaskOutcome,
  MediaLimits,
  MediaObjectKey,
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
  ManifestObjectKey as ManifestObjectKeySchema,
  MediaArtifactId as MediaArtifactIdSchema,
  MediaByteCount as MediaByteCountSchema,
  MediaDurationSeconds as MediaDurationSecondsSchema,
  MediaObjectKey as MediaObjectKeySchema,
  MediaStreamSummary,
  RetryableAcquisitionFailure as RetryableAcquisitionFailureSchema,
  Sha256Hex as Sha256HexSchema,
  TerminalMediaFailure as TerminalMediaFailureSchema,
  UnavailableFailure as UnavailableFailureSchema,
  UnsupportedCarouselFailure as UnsupportedCarouselFailureSchema,
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
  readonly arrayBuffer?: () => Promise<ArrayBuffer>;
  readonly text: () => Promise<string>;
}

export interface AcquisitionPutOptions {
  readonly contentLength: number;
  readonly customMetadata: Record<string, string>;
  readonly httpMetadata: {
    readonly cacheControl: "private, no-store";
    readonly contentType:
      | "application/json"
      | "audio/wav"
      | "image/jpeg"
      | "video/mp4";
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

/** Narrow the Alchemy/Cloudflare R2 binding to the capabilities used here. */
// SAFETY: Alchemy's ReadWriteBucket.raw value is the deployed Cloudflare R2
// binding. This single adapter deliberately exposes only get/head/put.
export const adaptAcquisitionBucket = (
  bucket: unknown
): AcquisitionBucketLike => bucket as AcquisitionBucketLike;

export interface AcquisitionMediaObjectLike {
  readonly cleanup: (artifactId: string) => Effect.Effect<void>;
  readonly prepare: (
    input: TikTokIdentity
  ) => Effect.Effect<PreparedMediaArtifact, ContainerAcquisitionError>;
  readonly prepareProviderEvidence?: (
    artifactId: string,
    durationSeconds: number
  ) => Effect.Effect<
    {
      readonly audio: {
        readonly artifactId: string;
        readonly bytes: number;
        readonly durationMilliseconds: number;
        readonly sha256: string;
      };
      readonly frames: readonly {
        readonly artifactId: string;
        readonly bytes: number;
        readonly height: number;
        readonly sha256: string;
        readonly timestampMilliseconds: number;
        readonly width: number;
      }[];
    },
    RetryableAcquisitionFailure
  >;
  readonly readArtifact: (
    artifactId: string
  ) => Stream.Stream<Uint8Array, RetryableAcquisitionFailure>;
}

const NullableString = Schema.NullOr(Schema.String);
const AcquisitionManifest = Schema.Struct({
  acquiredAt: ImportTimestamp,
  audioStreams: Schema.NonEmptyArray(MediaStreamSummary),
  bytes: MediaByteCountSchema,
  canonicalId: SourceCanonicalId,
  canonicalUrl: Schema.String,
  caption: NullableString,
  creator: Schema.Struct({
    displayName: NullableString,
    handle: NullableString,
    id: NullableString,
  }),
  deleteAt: ImportTimestamp,
  durationSeconds: MediaDurationSecondsSchema,
  ffmpegVersion: Schema.Literal("8.1.2"),
  generation: AcquisitionGenerationSchema,
  importId: ImportId,
  manifestKey: ManifestObjectKeySchema,
  mediaKey: MediaObjectKeySchema,
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
  sha256: Sha256HexSchema,
  videoStreams: Schema.NonEmptyArray(MediaStreamSummary),
  ytDlpVersion: Schema.Literal("2026.07.04"),
});

export const VerifiedPreparedMediaArtifact = Schema.Struct({
  artifactId: MediaArtifactIdSchema,
  audioStreams: Schema.NonEmptyArray(MediaStreamSummary),
  bytes: MediaByteCountSchema,
  durationSeconds: MediaDurationSecondsSchema,
  metadata: Schema.Struct({
    canonicalId: SourceCanonicalId,
    canonicalUrl: Schema.String,
    caption: NullableString,
    creator: Schema.Struct({
      displayName: NullableString,
      handle: NullableString,
      id: NullableString,
    }),
    observedAt: ImportTimestamp,
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
  }),
  sha256: Sha256HexSchema,
  videoStreams: Schema.NonEmptyArray(MediaStreamSummary),
});
export type VerifiedPreparedMediaArtifact =
  typeof VerifiedPreparedMediaArtifact.Type;

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
  ).pipe(
    Effect.map(bytesToHex),
    Effect.flatMap(Schema.decodeUnknownEffect(Sha256HexSchema)),
    Effect.orDie
  );

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
  stage: RetryableAcquisitionFailure["stage"],
  reason?: AcquisitionFailureReason
): RetryableAcquisitionFailure =>
  new RetryableAcquisitionError({
    ...(reason === undefined ? {} : { reason }),
    stage,
  });

const closeContainerFailure = (
  failure: unknown,
  generation: AcquisitionGeneration
): Effect.Effect<AcquisitionTaskOutcome, RetryableAcquisitionFailure> => {
  const retryable = Schema.decodeUnknownOption(
    RetryableAcquisitionFailureSchema
  )(failure);
  if (Option.isSome(retryable)) {
    return Effect.fail(
      retryableAt(retryable.value.stage, retryable.value.reason)
    );
  }
  const terminal = Schema.decodeUnknownOption(TerminalMediaFailureSchema)(
    failure
  );
  if (Option.isSome(terminal)) {
    return Effect.succeed({
      _tag: "TerminalMedia",
      code: terminal.value.code,
      generation,
      stage: terminal.value.stage,
    });
  }
  const unavailable = Schema.decodeUnknownOption(UnavailableFailureSchema)(
    failure
  );
  if (Option.isSome(unavailable)) {
    return Effect.succeed({
      _tag: "Unavailable",
      code: unavailable.value.code,
      generation,
    });
  }
  const unsupportedCarousel = Schema.decodeUnknownOption(
    UnsupportedCarouselFailureSchema
  )(failure);
  if (Option.isSome(unsupportedCarousel)) {
    return Effect.succeed({
      _tag: "UnsupportedCarousel",
      code: unsupportedCarousel.value.code,
      generation,
    });
  }
  return Effect.fail(retryableAt("container", "container_rpc"));
};

const r2Effect = <A>(
  stage: RetryableAcquisitionFailure["stage"],
  operation: () => Promise<A>
) =>
  Effect.tryPromise({
    catch: () => retryableAt(stage, "container_rpc"),
    try: operation,
  }).pipe(
    Effect.timeoutOrElse({
      duration: MaximumR2OperationMilliseconds,
      orElse: () => Effect.fail(retryableAt(stage, "acquisition_timeout")),
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
          finish(Effect.fail(retryableAt(stage, "container_rpc")));
        }
      })();
      timer = setTimeout(() => {
        onDeadline?.();
        finish(Effect.fail(retryableAt(stage, "acquisition_timeout")));
      }, MaximumR2OperationMilliseconds);
    } catch {
      finish(Effect.fail(retryableAt(stage, "container_rpc")));
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

const putMediaObject = Effect.fn("ImportMedia.putMediaObject")(
  (
    bucket: AcquisitionBucketLike,
    mediaObject: AcquisitionMediaObjectLike,
    prepared: VerifiedPreparedMediaArtifact,
    input: {
      readonly generation: AcquisitionGeneration;
      readonly importId: ImportId;
      readonly mediaKey: MediaObjectKey;
    }
  ) =>
    putPrivateArtifact(bucket, {
      key: input.mediaKey,
      options: {
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
      },
      stream: mediaObject.readArtifact(prepared.artifactId),
    })
);

const readCommittedPair = Effect.fn("ImportMedia.readCommittedPair")(
  function* readCommittedPairEffect(
    bucket: AcquisitionBucketLike,
    importId: ImportId,
    generation: AcquisitionGeneration
  ) {
    const media = yield* r2Effect("verify", () =>
      bucket.head(mediaObjectKey(importId, generation))
    );
    const manifest = yield* r2Effect("verify", () =>
      bucket.get(manifestObjectKey(importId, generation))
    );
    return { manifest, media };
  }
);

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

const decodeCommittedEvidence = Effect.fn(
  "ImportMedia.decodeCommittedEvidence"
)(function* decodeCommittedEvidenceEffect(
  importId: ImportId,
  generation: AcquisitionGeneration,
  canonicalId: SourceCanonicalId,
  media: R2ObjectLike | null,
  manifest: R2ObjectBodyLike | null,
  observedAt: Date
) {
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
    source: {
      canonicalUrl: value.canonicalUrl,
      caption: value.caption,
      creator: value.creator,
      observedAt: value.observedAt,
      provenance: value.provenance,
      publishedAt: value.publishedAt,
    },
    videoStreams: value.videoStreams,
  } satisfies VerifiedAcquisitionEvidence;
});

/** Re-verify the immutable GAIA-109 media/manifest pair before downstream use. */
export const readVerifiedAcquisitionEvidence = Effect.fn(
  "ImportMedia.readVerifiedAcquisitionEvidence"
)(function* readVerifiedAcquisitionEvidenceEffect(
  bucket: AcquisitionBucketLike,
  input: {
    readonly canonicalId: SourceCanonicalId;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly observedAt?: ImportTimestamp;
  }
) {
  const observedAt =
    input.observedAt === undefined
      ? new Date(yield* Clock.currentTimeMillis)
      : new Date(DateTime.toEpochMillis(input.observedAt));
  const { manifest, media } = yield* readCommittedPair(
    bucket,
    input.importId,
    input.generation
  );
  return yield* decodeCommittedEvidence(
    input.importId,
    input.generation,
    input.canonicalId,
    media,
    manifest,
    observedAt
  );
});

export const acquireStoreVerify = Effect.fn("ImportMedia.acquireStoreVerify")(
  function* acquireStoreVerifyEffect(
    bucket: AcquisitionBucketLike,
    mediaObject: AcquisitionMediaObjectLike,
    input: {
      readonly beforeCleanup?: (
        prepared: VerifiedPreparedMediaArtifact,
        mediaObject: AcquisitionMediaObjectLike
      ) => Effect.Effect<void, RetryableAcquisitionFailure>;
      readonly canonicalId: SourceCanonicalId;
      readonly generation: AcquisitionGeneration;
      readonly importId: ImportId;
    }
  ): Effect.fn.Return<AcquisitionTaskOutcome, RetryableAcquisitionFailure> {
    const preparedTransport = yield* mediaObject
      .prepare({
        canonicalId: input.canonicalId,
        generation: input.generation,
        importId: input.importId,
        kind: "tiktok",
      })
      .pipe(
        Effect.matchEffect({
          onFailure: (failure) =>
            closeContainerFailure(failure, input.generation),
          onSuccess: Effect.succeed,
        })
      );
    if ("_tag" in preparedTransport) {
      return preparedTransport;
    }
    const decodedPrepared = yield* Schema.decodeUnknownEffect(
      VerifiedPreparedMediaArtifact
    )(preparedTransport).pipe(
      Effect.mapError(() => retryableAt("container", "container_rpc"))
    );
    const observedAtTransport = yield* Schema.encodeUnknownEffect(
      ImportTimestamp
    )(decodedPrepared.metadata.observedAt).pipe(
      Effect.mapError(() => retryableAt("container", "container_rpc"))
    );
    const publishedAtTransport =
      decodedPrepared.metadata.publishedAt === null
        ? null
        : yield* Schema.encodeUnknownEffect(ImportTimestamp)(
            decodedPrepared.metadata.publishedAt
          ).pipe(
            Effect.mapError(() => retryableAt("container", "container_rpc"))
          );
    const prepared: VerifiedPreparedMediaArtifact = decodedPrepared;
    return yield* Effect.gen(function* storePrepared() {
      const acquiredAtDate = new Date(yield* Clock.currentTimeMillis);
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
      if (!storedMedia) {
        return yield* Effect.fail(retryableAt("store"));
      }
      if (input.beforeCleanup !== undefined) {
        yield* input.beforeCleanup(prepared, mediaObject);
      }
      const decodedManifest = yield* Schema.decodeUnknownEffect(
        AcquisitionManifest
      )({
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
        observedAt: observedAtTransport,
        originalStreamsRemuxedToMp4: true,
        provenance: prepared.metadata.provenance,
        publishedAt: publishedAtTransport,
        schemaVersion: 1,
        sha256: prepared.sha256,
        videoStreams: prepared.videoStreams,
        ytDlpVersion: "2026.07.04",
      }).pipe(Effect.mapError(() => retryableAt("store")));
      const manifest = yield* Schema.encodeUnknownEffect(AcquisitionManifest)(
        decodedManifest
      ).pipe(Effect.mapError(() => retryableAt("store")));
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
        new Date(yield* Clock.currentTimeMillis)
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
  }
);
