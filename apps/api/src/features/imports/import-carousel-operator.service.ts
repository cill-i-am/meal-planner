import { Context, Effect, Option, Schema } from "effect";

import type { OperatorCarouselBundle } from "./import-carousel-operator.js";
import { makeOperatorCarouselAdapter } from "./import-carousel-operator.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import type {
  CreateImportResponse,
  IdempotencyKey,
  ImportId,
} from "./import.contracts.js";
import { ImportTimestamp, SourceUrl } from "./import.contracts.js";
import {
  carouselProcessingUnavailable,
  idempotencyConflict,
  incompatibleDuplicate,
  invalidCarouselBundle,
  invalidSource,
} from "./import.errors.js";
import type {
  CarouselProcessingUnavailable,
  IdempotencyConflict,
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
  IncompatibleDuplicate,
  InvalidCarouselBundle,
  InvalidSource,
  SourceIdentityUnavailable,
} from "./import.errors.js";
import type {
  ImportRepositoryShape,
  StoredImport,
} from "./import.repository.js";
import {
  CompatibilityFingerprint as CompatibilityFingerprintSchema,
  IdempotencyKeyHash,
  RequestFingerprint,
  SourceLocatorHash,
} from "./import.repository.js";
import type { CanonicalSourceIdentityResolverShape } from "./source-identity.js";

const OperatorCompatibilitySource =
  "meal-planner-import:v1:operator-carousel:no-options";

const digestSha256 = (value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value)
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  });

export interface OperatorCarouselPipelineInput {
  readonly adapter: ReturnType<typeof makeOperatorCarouselAdapter>;
  readonly canonicalId: StoredImport["canonicalSourceId"];
  readonly declaredPageCount: number;
  readonly importId: ImportId;
  readonly sourceUrl: SourceUrl;
}

export interface OperatorCarouselPipelineShape {
  readonly preflight?: () => Effect.Effect<void, CarouselProcessingUnavailable>;
  readonly process: (
    input: OperatorCarouselPipelineInput
  ) => Effect.Effect<void, unknown>;
}

export type OperatorCarouselImportError =
  | CarouselProcessingUnavailable
  | IdempotencyConflict
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | IncompatibleDuplicate
  | InvalidCarouselBundle
  | InvalidSource
  | SourceIdentityUnavailable;

export interface OperatorCarouselImportServiceShape {
  readonly admit: (
    bundle: OperatorCarouselBundle,
    idempotencyKey: IdempotencyKey
  ) => Effect.Effect<CreateImportResponse, OperatorCarouselImportError>;
}

const pipelineError = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return carouselProcessingUnavailable();
  }
  if ("_tag" in error && error._tag === "CarouselProcessingUnavailable") {
    return carouselProcessingUnavailable();
  }
  if ("recovery" in error && error.recovery === "request_complete_carousel") {
    return invalidCarouselBundle();
  }
  return carouselProcessingUnavailable();
};

export const makeOperatorCarouselImportService = (input: {
  readonly identityResolver: CanonicalSourceIdentityResolverShape;
  readonly newId: () => ImportId;
  readonly now: () => ImportTimestamp;
  readonly pipeline: OperatorCarouselPipelineShape;
  readonly repository: ImportRepositoryShape;
}): OperatorCarouselImportServiceShape => ({
  admit: (bundle, idempotencyKey) =>
    Effect.gen(function* admitOperatorCarousel() {
      const resolution = yield* input.identityResolver.resolve(bundle.source);
      if (resolution._tag !== "UnsupportedIdentity") {
        return yield* Effect.fail(invalidSource());
      }
      const canonicalUrl = Schema.decodeUnknownSync(SourceUrl)(
        new URL(bundle.source.url).origin + new URL(bundle.source.url).pathname
      );
      const compatibilityFingerprint = Schema.decodeUnknownSync(
        CompatibilityFingerprintSchema
      )(yield* digestSha256(OperatorCompatibilitySource));
      const idempotencyKeyHash = Schema.decodeUnknownSync(IdempotencyKeyHash)(
        yield* digestSha256(`idempotency-key:v1:${idempotencyKey}`)
      );
      const requestFingerprint = Schema.decodeUnknownSync(RequestFingerprint)(
        yield* digestSha256(
          JSON.stringify({
            canonicalId: resolution.identity.canonicalId,
            compatibilityFingerprint,
            declaredPageCount: bundle.declaredPageCount,
            images: bundle.images.map(
              ({ height, orderIndex, sha256, width }) => ({
                height,
                orderIndex,
                sha256,
                width,
              })
            ),
          })
        )
      );
      const sourceLocatorHash = Schema.decodeUnknownSync(SourceLocatorHash)(
        yield* digestSha256(
          `source-locator:v1:${resolution.identity.kind}:${resolution.identity.canonicalId}`
        )
      );
      const receivedAt = input.now();
      const adapter = makeOperatorCarouselAdapter({
        bundle,
        canonicalId: resolution.identity.canonicalId,
        receivedAt: Schema.encodeSync(ImportTimestamp)(receivedAt),
        sourceUrl: canonicalUrl,
      });
      yield* adapter
        .acquire({
          canonicalId: resolution.identity.canonicalId,
          declaredPageCount: bundle.declaredPageCount,
          kind: "tiktok_carousel",
          sourceUrl: canonicalUrl,
        })
        .pipe(Effect.mapError(() => invalidCarouselBundle()));
      if (input.pipeline.preflight !== undefined) {
        yield* input.pipeline.preflight();
      }
      const existingRequest =
        yield* input.repository.findRequest(idempotencyKeyHash);
      if (
        Option.isSome(existingRequest) &&
        existingRequest.value.requestFingerprint !== requestFingerprint
      ) {
        return yield* Effect.fail(idempotencyConflict());
      }

      let accepted: StoredImport;
      let disposition: CreateImportResponse["disposition"];
      if (Option.isSome(existingRequest)) {
        accepted = existingRequest.value.import;
        disposition = "idempotency_replay";
      } else {
        const canonical = yield* input.repository.findByCanonicalIdentity(
          resolution.identity
        );
        if (
          Option.isSome(canonical) &&
          canonical.value.compatibilityFingerprint !== compatibilityFingerprint
        ) {
          return yield* Effect.fail(incompatibleDuplicate());
        }
        const candidate: StoredImport = Option.isSome(canonical)
          ? canonical.value
          : {
              acquisitionGeneration: Schema.decodeUnknownSync(
                AcquisitionGeneration
              )(0),
              canonicalSourceId: resolution.identity.canonicalId,
              compatibilityFingerprint,
              sourceKind: resolution.identity.kind,
              view: {
                createdAt: receivedAt,
                evidence: [],
                id: input.newId(),
                source: resolution.identity,
                status: { kind: "queued" },
                updatedAt: receivedAt,
              },
            };
        const result = yield* input.repository.acceptRequest({
          candidate,
          idempotencyKeyHash,
          requestFingerprint,
          sourceLocatorHash,
        });
        ({ disposition, import: accepted } = result);
      }

      if (
        accepted.view.status.kind !== "queued" &&
        accepted.view.status.kind !== "needs_review"
      ) {
        return yield* Effect.fail(incompatibleDuplicate());
      }
      yield* input.pipeline
        .process({
          adapter,
          canonicalId: accepted.canonicalSourceId,
          declaredPageCount: bundle.declaredPageCount,
          importId: accepted.view.id,
          sourceUrl: canonicalUrl,
        })
        .pipe(Effect.mapError(pipelineError));
      const stored = yield* input.repository.findById(accepted.view.id);
      return yield* Option.match(stored, {
        onNone: () => Effect.fail(carouselProcessingUnavailable()),
        onSome: (value) => Effect.succeed({ disposition, import: value.view }),
      });
    }),
});

export class OperatorCarouselImportService extends Context.Service<
  OperatorCarouselImportService,
  OperatorCarouselImportServiceShape
>()("meal-planner/OperatorCarouselImportService") {}
