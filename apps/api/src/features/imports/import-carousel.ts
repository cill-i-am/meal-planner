import { DateTime, Effect, Option, Schema } from "effect";

import type {
  TikTokCarouselAcquisition,
  TikTokCarouselAdapterFailure,
  TikTokCarouselAdapter,
  TikTokCarouselDescriptor,
} from "./import-carousel-adapter.js";
import {
  MaximumCarouselImages,
  decodeJpegDimensions,
  TikTokCarouselDescriptor as TikTokCarouselDescriptorSchema,
} from "./import-carousel-adapter.js";
import type {
  CarouselEvidenceRepository,
  CompletedCarouselEvidence,
} from "./import-carousel.repository.d1.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import {
  AcquisitionGeneration,
  EvidenceRetentionSeconds,
  VerifiedSourceMetadata,
} from "./import-media.model.js";
import { produceRecipeDraftFromEvidence } from "./import-recipe-draft.js";
import type { ProduceRecipeDraftFromEvidenceInput } from "./import-recipe-draft.js";
import type { RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
import type {
  RecipeEvidenceAssembly,
  RecipeEvidenceItem,
  RecipeExtractor,
} from "./import-recipe-extractor.js";
import type {
  VisualEvidenceExtractor,
  VisualFrameArtifact,
} from "./import-visual-evidence-extractor.js";
import {
  decodeVisualEvidence,
  MaximumVisualFrameBytes,
  MaximumVisualInputBytes,
  representativeVisualFrameIndex,
  validateVisualFrames,
  VisualEvidence,
} from "./import-visual-evidence-extractor.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);
const PositiveInteger = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0))
);
const SafeOrderIndex = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThan(MaximumCarouselImages)
  )
);

const TranscriptNotApplicable = Schema.Struct({
  reason: Schema.Literal("source_type_carousel"),
  status: Schema.Literal("not_applicable"),
});

const CarouselSourceProvenance = Schema.Literals([
  "operator_supplied",
  "provider_observed",
]);

const CarouselSourceMetadata = Schema.Struct({
  canonicalId: SourceCanonicalId,
  caption: VerifiedSourceMetadata.fields.caption,
  creator: VerifiedSourceMetadata.fields.creator,
  observedAt: VerifiedSourceMetadata.fields.observedAt,
  provenance: Schema.Struct({
    canonicalIdentity: CarouselSourceProvenance,
    caption: VerifiedSourceMetadata.fields.provenance.fields.caption,
    creator: VerifiedSourceMetadata.fields.provenance.fields.creator,
    publishedAt: VerifiedSourceMetadata.fields.provenance.fields.publishedAt,
  }),
  publishedAt: VerifiedSourceMetadata.fields.publishedAt,
});

const CarouselImageReference = Schema.Struct({
  byteLength: PositiveInteger,
  deleteAt: ImportTimestamp,
  height: PositiveInteger,
  key: Schema.String,
  mimeType: Schema.Literal("image/jpeg"),
  orderIndex: SafeOrderIndex,
  sha256: Sha256Hex,
  sourceAttribution: Schema.Struct({
    canonicalId: SourceCanonicalId,
    provenance: CarouselSourceProvenance,
  }),
  width: PositiveInteger,
});
type CarouselImageReference = typeof CarouselImageReference.Type;

/** Private, complete-or-nothing evidence manifest for one carousel generation. */
export const CarouselEvidenceManifestDocument = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  createdAt: ImportTimestamp,
  descriptorFingerprint: Sha256Hex,
  dispatchId: Schema.String,
  images: Schema.NonEmptyArray(CarouselImageReference).pipe(
    Schema.check(Schema.isMaxLength(MaximumCarouselImages))
  ),
  importId: ImportId,
  retention: Schema.Struct({
    configuredAgeSeconds: Schema.Literal(EvidenceRetentionSeconds),
    policy: Schema.Literal("r2_bucket_object_age"),
  }),
  schemaVersion: Schema.Literal(1),
  source: CarouselSourceMetadata,
  transcript: TranscriptNotApplicable,
  visualEvidence: VisualEvidence,
});
export type CarouselEvidenceManifestDocument =
  typeof CarouselEvidenceManifestDocument.Type;

export interface CarouselImportPipelineFailure {
  readonly _tag: "CarouselImportPipelineFailure";
  readonly code:
    | TikTokCarouselAdapterFailure["code"]
    | "carousel_evidence_invalid"
    | "outcome_unknown"
    | "provider_unavailable"
    | "throttled"
    | "timeout"
    | "visual_extraction_failed";
  readonly completeness: "incomplete_no_draft";
  readonly recovery:
    | TikTokCarouselAdapterFailure["recovery"]
    | "operator_reconcile";
}

const pipelineFailure = (
  code: CarouselImportPipelineFailure["code"],
  recovery: CarouselImportPipelineFailure["recovery"]
): CarouselImportPipelineFailure => ({
  _tag: "CarouselImportPipelineFailure",
  code,
  completeness: "incomplete_no_draft",
  recovery,
});

const carouselGenerationPrefix = (
  importId: ImportId,
  generation: AcquisitionGeneration
) => `imports/${importId}/carousel/v1/generations/${generation}`;

export const carouselImageObjectKey = (
  importId: ImportId,
  generation: AcquisitionGeneration,
  orderIndex: number
) =>
  `${carouselGenerationPrefix(importId, generation)}/images/${String(orderIndex).padStart(2, "0")}.jpg`;

export const carouselManifestObjectKey = (
  importId: ImportId,
  generation: AcquisitionGeneration
) => `${carouselGenerationPrefix(importId, generation)}/manifest.json`;

const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

const sha256Bytes = (value: Uint8Array) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer)
  );

const sha256Hex = (value: Uint8Array) =>
  Effect.map(sha256Bytes(value), bytesToHex);

const checksumBuffer = (hex: string) => {
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

const descriptorFingerprint = (descriptor: TikTokCarouselDescriptor) =>
  sha256Hex(
    new TextEncoder().encode(
      JSON.stringify(
        Schema.encodeSync(TikTokCarouselDescriptorSchema)(descriptor)
      )
    )
  );

const deleteAtFor = (createdAt: ImportTimestamp) =>
  Schema.decodeUnknownSync(ImportTimestamp)(
    new Date(
      DateTime.toEpochMillis(createdAt) + EvidenceRetentionSeconds * 1000
    ).toISOString()
  );

const partialFailure = (): TikTokCarouselAdapterFailure => ({
  _tag: "TikTokCarouselAdapterFailure",
  code: "carousel_partial",
  completeness: "incomplete_no_draft",
  recovery: "request_complete_carousel",
});

const validateCompleteAcquisition = (
  acquisition: TikTokCarouselAcquisition,
  descriptor: TikTokCarouselDescriptor
) =>
  Effect.gen(function* validate() {
    const source = yield* Schema.decodeUnknownEffect(VerifiedSourceMetadata, {
      onExcessProperty: "error",
    })(acquisition.source).pipe(Effect.mapError(partialFailure));
    if (
      source.canonicalUrl !== descriptor.sourceUrl ||
      acquisition.images.length !== descriptor.declaredPageCount
    ) {
      return yield* Effect.fail(partialFailure());
    }
    const ordered = acquisition.images.toSorted(
      (left, right) => left.orderIndex - right.orderIndex
    );
    const checksums = new Set<string>();
    let totalBytes = 0;
    for (const [orderIndex, image] of ordered.entries()) {
      const dimensions = decodeJpegDimensions(image.bytes);
      totalBytes += image.bytes.byteLength;
      if (
        image.orderIndex !== orderIndex ||
        image.bytes.byteLength < 1 ||
        image.bytes.byteLength > MaximumVisualFrameBytes ||
        totalBytes > MaximumVisualInputBytes ||
        image.mimeType !== "image/jpeg" ||
        !Number.isSafeInteger(image.height) ||
        image.height <= 0 ||
        !Number.isSafeInteger(image.width) ||
        image.width <= 0 ||
        dimensions === null ||
        dimensions.height !== image.height ||
        dimensions.width !== image.width ||
        !/^[a-f\d]{64}$/u.test(image.sha256) ||
        checksums.has(image.sha256) ||
        (yield* sha256Hex(image.bytes)) !== image.sha256
      ) {
        return yield* Effect.fail(partialFailure());
      }
      checksums.add(image.sha256);
    }
    return { images: ordered, source };
  });

const imageMetadata = (
  document: Pick<
    CarouselEvidenceManifestDocument,
    "acquisitionGeneration" | "importId" | "source"
  >,
  reference: CarouselImageReference
) => ({
  generation: String(document.acquisitionGeneration),
  importId: document.importId,
  kind: "carousel_image",
  orderIndex: String(reference.orderIndex),
  retentionDeadline: DateTime.formatIso(reference.deleteAt),
  sha256: reference.sha256,
  sourceAttribution: document.source.provenance.canonicalIdentity,
  sourceCanonicalId: document.source.canonicalId,
});

const metadataMatches = (
  actual: Record<string, string> | undefined,
  expected: Record<string, string>
) =>
  actual !== undefined &&
  Object.entries(expected).every(([key, value]) => actual[key] === value);

const storeImage = (
  bucket: AcquisitionBucketLike,
  document: Pick<
    CarouselEvidenceManifestDocument,
    "acquisitionGeneration" | "importId" | "source"
  >,
  reference: CarouselImageReference,
  bytes: Uint8Array
) =>
  Effect.gen(function* store() {
    yield* bucket
      .put(reference.key, bytes, {
        contentLength: reference.byteLength,
        customMetadata: imageMetadata(document, reference),
        httpMetadata: {
          cacheControl: "private, no-store",
          contentType: "image/jpeg",
        },
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: checksumBuffer(reference.sha256),
      })
      .pipe(Effect.exit);
    const stored = yield* bucket
      .head(reference.key)
      .pipe(
        Effect.mapError(() =>
          pipelineFailure("carousel_evidence_invalid", "operator_reconcile")
        )
      );
    if (
      stored === null ||
      stored.size !== reference.byteLength ||
      nativeSha256(stored) !== reference.sha256 ||
      stored.httpMetadata?.contentType !== "image/jpeg" ||
      stored.httpMetadata.cacheControl !== "private, no-store" ||
      !metadataMatches(
        stored.customMetadata,
        imageMetadata(document, reference)
      )
    ) {
      return yield* Effect.fail(
        pipelineFailure("carousel_evidence_invalid", "operator_reconcile")
      );
    }
  });

const manifestMetadata = (
  document: CarouselEvidenceManifestDocument,
  sha256: string
) => ({
  descriptorFingerprint: document.descriptorFingerprint,
  generation: String(document.acquisitionGeneration),
  importId: document.importId,
  kind: "carousel_evidence_manifest",
  sha256,
});

const manifestMatches = (
  object: NonNullable<Effect.Success<ReturnType<AcquisitionBucketLike["get"]>>>,
  bytes: Uint8Array,
  sha256: string,
  expected: CompletedCarouselEvidence,
  descriptor: TikTokCarouselDescriptor,
  document: CarouselEvidenceManifestDocument
) =>
  [
    object.size === bytes.byteLength,
    nativeSha256(object) === sha256,
    sha256 === expected.manifestSha256,
    object.httpMetadata?.contentType === "application/json",
    object.httpMetadata?.cacheControl === "private, no-store",
    metadataMatches(object.customMetadata, manifestMetadata(document, sha256)),
    document.acquisitionGeneration === expected.generation,
    document.descriptorFingerprint === expected.descriptorFingerprint,
    document.dispatchId === expected.dispatchId,
    document.images.length === expected.imageCount,
    document.importId === expected.importId,
    document.source.canonicalId === descriptor.canonicalId,
  ].every(Boolean);

const readVerifiedManifest = (
  bucket: AcquisitionBucketLike,
  expected: CompletedCarouselEvidence,
  descriptor: TikTokCarouselDescriptor
) =>
  Effect.gen(function* read() {
    const object = yield* bucket
      .get(expected.manifestKey)
      .pipe(
        Effect.mapError(() =>
          pipelineFailure("outcome_unknown", "operator_reconcile")
        )
      );
    if (object === null) {
      return yield* Effect.fail(
        pipelineFailure("carousel_evidence_invalid", "operator_reconcile")
      );
    }
    const text = yield* object
      .text()
      .pipe(
        Effect.mapError(() =>
          pipelineFailure("outcome_unknown", "operator_reconcile")
        )
      );
    const bytes = new TextEncoder().encode(text);
    const sha256 = yield* sha256Hex(bytes);
    const parsed = yield* Effect.try({
      catch: () =>
        pipelineFailure("carousel_evidence_invalid", "operator_reconcile"),
      try: () => JSON.parse(text) as unknown,
    });
    const document = yield* Schema.decodeUnknownEffect(
      CarouselEvidenceManifestDocument,
      { onExcessProperty: "error" }
    )(parsed).pipe(
      Effect.mapError(() =>
        pipelineFailure("carousel_evidence_invalid", "operator_reconcile")
      )
    );
    if (
      !manifestMatches(object, bytes, sha256, expected, descriptor, document)
    ) {
      return yield* Effect.fail(
        pipelineFailure("carousel_evidence_invalid", "operator_reconcile")
      );
    }
    for (const [orderIndex, reference] of document.images.entries()) {
      if (
        reference.orderIndex !== orderIndex ||
        reference.key !==
          carouselImageObjectKey(
            expected.importId,
            expected.generation,
            orderIndex
          )
      ) {
        return yield* Effect.fail(
          pipelineFailure("carousel_evidence_invalid", "operator_reconcile")
        );
      }
      const stored = yield* bucket
        .head(reference.key)
        .pipe(
          Effect.mapError(() =>
            pipelineFailure("outcome_unknown", "operator_reconcile")
          )
        );
      if (
        stored === null ||
        stored.size !== reference.byteLength ||
        nativeSha256(stored) !== reference.sha256 ||
        !metadataMatches(
          stored.customMetadata,
          imageMetadata(document, reference)
        )
      ) {
        return yield* Effect.fail(
          pipelineFailure("carousel_evidence_invalid", "operator_reconcile")
        );
      }
    }
    return { document, sha256 };
  });

const storeManifest = (
  bucket: AcquisitionBucketLike,
  document: CarouselEvidenceManifestDocument
) =>
  Effect.gen(function* store() {
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        Schema.encodeSync(CarouselEvidenceManifestDocument)(document)
      )
    );
    const sha256 = yield* sha256Hex(bytes);
    const key = carouselManifestObjectKey(
      document.importId,
      document.acquisitionGeneration
    );
    yield* bucket
      .put(key, bytes, {
        contentLength: bytes.byteLength,
        customMetadata: manifestMetadata(document, sha256),
        httpMetadata: {
          cacheControl: "private, no-store",
          contentType: "application/json",
        },
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: checksumBuffer(sha256),
      })
      .pipe(Effect.exit);
    return { byteLength: bytes.byteLength, key, sha256 };
  });

const recipeEvidenceItems = (
  document: CarouselEvidenceManifestDocument,
  manifestSha256: string,
  source: VerifiedSourceMetadata
) => {
  const manifestReference = carouselManifestObjectKey(
    document.importId,
    document.acquisitionGeneration
  );
  const items: RecipeEvidenceItem[] = [
    {
      artifactReference: manifestReference,
      evidenceId: `source_url:${manifestSha256}`,
      kind: "source_url",
      origin: "observed",
      value: source.canonicalUrl,
    },
  ];
  const creator =
    document.source.creator.displayName ?? document.source.creator.handle;
  if (creator !== null) {
    items.push({
      artifactReference: manifestReference,
      evidenceId: `creator:${manifestSha256}`,
      kind: "creator",
      origin: "observed",
      value: creator,
    });
  }
  if (document.source.caption !== null) {
    items.push({
      artifactReference: manifestReference,
      evidenceId: `caption:${manifestSha256}`,
      kind: "caption",
      origin: "creator_provided",
      value: document.source.caption,
    });
  }
  for (const [
    index,
    observation,
  ] of document.visualEvidence.observations.entries()) {
    items.push({
      artifactReference: manifestReference,
      evidenceId: `visual:${manifestSha256}:${index}`,
      kind: "visual_observation",
      origin: "observed",
      value: observation.text,
    });
  }
  return items;
};

const assembleRecipeEvidence = (
  document: CarouselEvidenceManifestDocument,
  manifestSha256: string,
  source: VerifiedSourceMetadata
) =>
  Effect.gen(function* assemble() {
    const items = recipeEvidenceItems(document, manifestSha256, source);
    const evidenceFingerprint = yield* sha256Hex(
      new TextEncoder().encode(
        JSON.stringify({
          generation: document.acquisitionGeneration,
          importId: document.importId,
          items,
          manifestSha256,
          transcript: document.transcript,
        })
      )
    );
    return {
      evidenceFingerprint,
      generation: document.acquisitionGeneration,
      importId: document.importId,
      items,
    } satisfies RecipeEvidenceAssembly;
  });

const completedEvidence = (
  document: CarouselEvidenceManifestDocument,
  byteLength: number,
  manifestKey: string,
  manifestSha256: string
): CompletedCarouselEvidence => ({
  byteLength,
  completedAt: document.createdAt,
  descriptorFingerprint: document.descriptorFingerprint,
  deleteAt: document.images[0].deleteAt,
  dispatchId: document.dispatchId,
  generation: document.acquisitionGeneration,
  imageCount: document.images.length,
  importId: document.importId,
  manifestKey,
  manifestSha256,
});

export const prepareTikTokCarouselEvidence = Effect.fn(
  "Imports.prepareTikTokCarouselEvidence"
)(function* prepareCarousel(input: {
  readonly adapter: TikTokCarouselAdapter;
  readonly bucket: AcquisitionBucketLike;
  readonly carouselRepository: CarouselEvidenceRepository;
  readonly descriptor: TikTokCarouselDescriptor;
  readonly importId: ImportId;
  readonly now: () => ImportTimestamp;
  readonly visualExtractor: VisualEvidenceExtractor;
}) {
  const descriptor = yield* Schema.decodeUnknownEffect(
    TikTokCarouselDescriptorSchema,
    { onExcessProperty: "error" }
  )(input.descriptor).pipe(Effect.mapError(() => partialFailure()));
  const stored = yield* input.carouselRepository.findParent(input.importId);
  const parent = yield* Option.match(stored, {
    onNone: () =>
      Effect.fail(
        pipelineFailure("carousel_evidence_invalid", "operator_reconcile")
      ),
    onSome: Effect.succeed,
  });
  if (
    parent.canonicalId !== descriptor.canonicalId ||
    parent.status !== "queued"
  ) {
    return yield* Effect.fail(
      pipelineFailure("carousel_evidence_invalid", "operator_reconcile")
    );
  }
  const now = input.now();
  const fingerprint = yield* descriptorFingerprint(descriptor);
  const dispatchId = `carousel:${input.importId}:${parent.generation}`;
  const claim = yield* input.carouselRepository.claim({
    descriptorFingerprint: fingerprint,
    dispatchId,
    generation: parent.generation,
    importId: input.importId,
    startedAt: now,
  });
  if (claim._tag === "Failed") {
    return yield* Effect.fail(pipelineFailure(claim.code, claim.recovery));
  }
  if (claim._tag === "ResumeDispatch") {
    return yield* Effect.fail(
      pipelineFailure("outcome_unknown", "operator_reconcile")
    );
  }

  if (claim._tag === "Completed") {
    yield* readVerifiedManifest(input.bucket, claim.evidence, descriptor);
    return claim.evidence;
  }
  const acquired = yield* input.adapter.acquire(descriptor).pipe(
    Effect.catch((error) =>
      input.carouselRepository
        .fail({
          code: error.code,
          completedAt: now,
          descriptorFingerprint: fingerprint,
          generation: parent.generation,
          importId: input.importId,
          recovery: error.recovery,
        })
        .pipe(
          Effect.andThen(
            Effect.fail(pipelineFailure(error.code, error.recovery))
          )
        )
    )
  );
  const validated = yield* validateCompleteAcquisition(
    acquired,
    descriptor
  ).pipe(
    Effect.catch((error) =>
      input.carouselRepository
        .fail({
          code: error.code,
          completedAt: now,
          descriptorFingerprint: fingerprint,
          generation: parent.generation,
          importId: input.importId,
          recovery: error.recovery,
        })
        .pipe(
          Effect.andThen(
            Effect.fail(pipelineFailure(error.code, error.recovery))
          )
        )
    )
  );
  const frames: readonly VisualFrameArtifact[] = validated.images.map(
    (image) => ({
      bytes: image.bytes,
      height: image.height,
      mimeType: image.mimeType,
      sha256: image.sha256,
      timestampMilliseconds: image.orderIndex,
      width: image.width,
    })
  );
  if (!validateVisualFrames(frames, frames.length)) {
    return yield* Effect.fail(
      pipelineFailure("carousel_evidence_invalid", "operator_reconcile")
    );
  }
  const rawVisual = yield* input.visualExtractor
    .extract({
      dispatchId: `carousel-visual:${input.importId}:${parent.generation}`,
      frames,
      generation: parent.generation,
      importId: input.importId,
      sourceMediaSha256: fingerprint,
    })
    .pipe(
      Effect.mapError((error) =>
        pipelineFailure(
          error.code === "provider_unavailable" ||
            error.code === "throttled" ||
            error.code === "timeout"
            ? error.code
            : "visual_extraction_failed",
          "operator_reconcile"
        )
      )
    );
  const visualEvidence = yield* decodeVisualEvidence(rawVisual).pipe(
    Effect.mapError(() =>
      pipelineFailure("visual_extraction_failed", "operator_reconcile")
    )
  );
  const submittedFrame = frames[representativeVisualFrameIndex(frames.length)];
  if (
    submittedFrame === undefined ||
    visualEvidence.usage.inputFrames !== 1 ||
    visualEvidence.usage.inputBytes !== submittedFrame.bytes.byteLength ||
    visualEvidence.observations.some(
      (observation) =>
        frames[observation.frameIndex]?.timestampMilliseconds !==
        observation.timestampMilliseconds
    )
  ) {
    return yield* Effect.fail(
      pipelineFailure("visual_extraction_failed", "operator_reconcile")
    );
  }
  const deleteAt = deleteAtFor(now);
  const images = validated.images.map(
    (image): CarouselImageReference => ({
      byteLength: image.bytes.byteLength,
      deleteAt,
      height: image.height,
      key: carouselImageObjectKey(
        input.importId,
        parent.generation,
        image.orderIndex
      ),
      mimeType: image.mimeType,
      orderIndex: image.orderIndex,
      sha256: image.sha256,
      sourceAttribution: {
        canonicalId: descriptor.canonicalId,
        provenance: validated.source.provenance.canonicalUrl,
      },
      width: image.width,
    })
  );
  const [firstImage, ...remainingImages] = images;
  if (firstImage === undefined) {
    return yield* Effect.fail(
      pipelineFailure("carousel_partial", "request_complete_carousel")
    );
  }
  const document: CarouselEvidenceManifestDocument = {
    acquisitionGeneration: parent.generation,
    createdAt: now,
    descriptorFingerprint: fingerprint,
    dispatchId,
    images: [firstImage, ...remainingImages],
    importId: input.importId,
    retention: {
      configuredAgeSeconds: EvidenceRetentionSeconds,
      policy: "r2_bucket_object_age",
    },
    schemaVersion: 1,
    source: {
      canonicalId: descriptor.canonicalId,
      caption: validated.source.caption,
      creator: validated.source.creator,
      observedAt: validated.source.observedAt,
      provenance: {
        canonicalIdentity: validated.source.provenance.canonicalUrl,
        caption: validated.source.provenance.caption,
        creator: validated.source.provenance.creator,
        publishedAt: validated.source.provenance.publishedAt,
      },
      publishedAt: validated.source.publishedAt,
    },
    transcript: {
      reason: "source_type_carousel",
      status: "not_applicable",
    },
    visualEvidence,
  };
  yield* Effect.forEach(
    validated.images,
    (image, orderIndex) => {
      const reference = document.images[orderIndex];
      return reference === undefined
        ? Effect.fail(
            pipelineFailure("carousel_evidence_invalid", "operator_reconcile")
          )
        : storeImage(input.bucket, document, reference, image.bytes);
    },
    { concurrency: 1, discard: true }
  );
  const storedManifest = yield* storeManifest(input.bucket, document);
  const pendingEvidence = completedEvidence(
    document,
    storedManifest.byteLength,
    storedManifest.key,
    storedManifest.sha256
  );
  yield* readVerifiedManifest(input.bucket, pendingEvidence, descriptor);
  return yield* input.carouselRepository.complete(pendingEvidence);
});

export const produceTikTokCarouselRecipeDraft = Effect.fn(
  "Imports.produceTikTokCarouselRecipeDraft"
)(function* produceCarouselRecipe(input: {
  readonly bucket: AcquisitionBucketLike;
  readonly descriptor: TikTokCarouselDescriptor;
  readonly evidence: CompletedCarouselEvidence;
  readonly extractor: RecipeExtractor;
  readonly importId: ImportId;
  readonly lifecycle?: Parameters<
    typeof produceRecipeDraftFromEvidence
  >[0]["lifecycle"];
  readonly now: () => ImportTimestamp;
  readonly recipeRepository: RecipeDraftRepository;
}) {
  const committed = yield* readVerifiedManifest(
    input.bucket,
    input.evidence,
    input.descriptor
  );
  const source: VerifiedSourceMetadata = {
    canonicalUrl: input.descriptor.sourceUrl,
    caption: committed.document.source.caption,
    creator: committed.document.source.creator,
    observedAt: committed.document.source.observedAt,
    provenance: {
      canonicalUrl: committed.document.source.provenance.canonicalIdentity,
      caption: committed.document.source.provenance.caption,
      creator: committed.document.source.provenance.creator,
      publishedAt: committed.document.source.provenance.publishedAt,
    },
    publishedAt: committed.document.source.publishedAt,
  };
  const assembly = yield* assembleRecipeEvidence(
    committed.document,
    committed.sha256,
    source
  );
  const now = input.now();
  const draftInput: ProduceRecipeDraftFromEvidenceInput = {
    assembly,
    claim: ({
      descriptor: extractorDescriptor,
      evidenceFingerprint,
      extractionFingerprint,
    }) =>
      input.recipeRepository.claimCarousel({
        carouselManifestSha256: committed.sha256,
        descriptor: extractorDescriptor,
        evidenceFingerprint,
        extractionFingerprint,
        generation: committed.document.acquisitionGeneration,
        importId: input.importId,
        startedAt: now,
      }),
    extractor: input.extractor,
    now,
    recipeRepository: input.recipeRepository,
    source,
    transcript: {
      reason: "source_type_carousel",
      route: "carousel_v2",
      status: "not_applicable",
    },
  };
  const draft = yield* produceRecipeDraftFromEvidence(
    input.lifecycle === undefined
      ? draftInput
      : { ...draftInput, lifecycle: input.lifecycle }
  );
  return {
    _tag: "CarouselRecipeDraftReady" as const,
    draft,
    evidence: {
      imageCount: committed.document.images.length,
      manifestKey: input.evidence.manifestKey,
      transcript: committed.document.transcript,
    },
    status: { kind: "needs_review" as const },
  };
});

/** Deterministic composition retained for local tests and synthetic harnesses. */
export const importTikTokCarouselToRecipeDraft = Effect.fn(
  "Imports.importTikTokCarouselToRecipeDraft"
)(function* importCarousel(input: {
  readonly adapter: TikTokCarouselAdapter;
  readonly bucket: AcquisitionBucketLike;
  readonly carouselRepository: CarouselEvidenceRepository;
  readonly descriptor: TikTokCarouselDescriptor;
  readonly extractor: RecipeExtractor;
  readonly importId: ImportId;
  readonly now: () => ImportTimestamp;
  readonly recipeRepository: RecipeDraftRepository;
  readonly visualExtractor: VisualEvidenceExtractor;
}) {
  const evidence = yield* prepareTikTokCarouselEvidence(input);
  return yield* produceTikTokCarouselRecipeDraft({
    bucket: input.bucket,
    descriptor: input.descriptor,
    evidence,
    extractor: input.extractor,
    importId: input.importId,
    now: input.now,
    recipeRepository: input.recipeRepository,
  });
});
