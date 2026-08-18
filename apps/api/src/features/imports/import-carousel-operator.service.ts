import {
  CanonicalTikTokUrl,
  CreateRecipeImportIntentRequest,
} from "@meal-planner/recipe-import-api";
import type {
  IdempotencyKey,
  RecipeImportIntent,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Context, Effect, Schema } from "effect";

import type { TikTokCarouselAdapterFailure } from "./import-carousel-adapter.js";
import type { OperatorCarouselBundle } from "./import-carousel-operator.js";
import { makeOperatorCarouselAdapter } from "./import-carousel-operator.js";
import { ImportIntentIdGenerator } from "./import-intent.js";
import type {
  ImportPrincipal,
  makeImportIntentApplication,
} from "./import-intent.js";
import type { ImportId, SourceCanonicalId } from "./import.contracts.js";
import { ImportId as ImportIdSchema, SourceUrl } from "./import.contracts.js";
import {
  carouselProcessingUnavailable,
  idempotencyConflict,
  invalidCarouselBundle,
  invalidSource,
} from "./import.errors.js";
import type {
  CarouselProcessingUnavailable,
  IdempotencyConflict,
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
  InvalidCarouselBundle,
  InvalidSource,
  SourceIdentityUnavailable,
} from "./import.errors.js";
import { RequestFingerprint } from "./import.repository.js";
import type { CanonicalSourceIdentityResolver } from "./source-identity.js";

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

const requestFingerprintFor = (
  bundle: OperatorCarouselBundle,
  canonicalId: SourceCanonicalId
) =>
  Effect.map(
    digestSha256(
      JSON.stringify({
        canonicalId,
        declaredPageCount: bundle.declaredPageCount,
        images: bundle.images.map(({ height, orderIndex, sha256, width }) => ({
          height,
          orderIndex,
          sha256,
          width,
        })),
      })
    ),
    Schema.decodeUnknownSync(RequestFingerprint)
  );

export interface OperatorCarouselPipelineInput {
  readonly adapter: ReturnType<typeof makeOperatorCarouselAdapter>;
  readonly canonicalId: SourceCanonicalId;
  readonly declaredPageCount: number;
  readonly importId: ImportId;
  readonly sourceUrl: SourceUrl;
}

export interface OperatorCarouselPipeline {
  readonly preflight?: () => Effect.Effect<void, CarouselProcessingUnavailable>;
  readonly stage: (
    input: OperatorCarouselPipelineInput
  ) => Effect.Effect<
    void,
    CarouselProcessingUnavailable | TikTokCarouselAdapterFailure
  >;
}

export type OperatorCarouselImportError =
  | CarouselProcessingUnavailable
  | IdempotencyConflict
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | InvalidCarouselBundle
  | InvalidSource
  | SourceIdentityUnavailable;

export interface OperatorCarouselImportService {
  readonly admit: (
    principal: ImportPrincipal,
    bundle: OperatorCarouselBundle,
    idempotencyKey: IdempotencyKey
  ) => Effect.Effect<RecipeImportIntent, OperatorCarouselImportError>;
}

type ImportIntentApplication = ReturnType<typeof makeImportIntentApplication>;
type OperatorCarouselApplicationError =
  | Effect.Error<
      ReturnType<ImportIntentApplication["admitWithRequestFingerprint"]>
    >
  | Effect.Error<ReturnType<ImportIntentApplication["get"]>>
  | Effect.Error<ReturnType<ImportIntentApplication["resolveSource"]>>;

const pipelineError = (
  error: CarouselProcessingUnavailable | TikTokCarouselAdapterFailure
) =>
  error._tag === "TikTokCarouselAdapterFailure" &&
  error.recovery === "request_complete_carousel"
    ? invalidCarouselBundle()
    : carouselProcessingUnavailable();

const applicationError = (
  error: OperatorCarouselApplicationError
): OperatorCarouselImportError => {
  switch (error._tag) {
    case "RecipeImportIntentIdempotencyConflict": {
      return idempotencyConflict();
    }
    case "ImportPersistenceCorrupt":
    case "ImportPersistenceUnavailable": {
      return error;
    }
    default: {
      return carouselProcessingUnavailable();
    }
  }
};

export const makeOperatorCarouselImportService = (input: {
  readonly application: ReturnType<typeof makeImportIntentApplication>;
  readonly identityResolver: CanonicalSourceIdentityResolver;
  readonly newIntentId: () => RecipeImportIntentId;
  readonly now: () => string;
  readonly pipeline: OperatorCarouselPipeline;
}): OperatorCarouselImportService => {
  const admit = Effect.fn("OperatorCarouselImportService.admit")(
    function* admitOperatorCarousel(principal, bundle, idempotencyKey) {
      const canonicalUrl = Schema.decodeUnknownSync(SourceUrl)(
        new URL(bundle.source.url).origin + new URL(bundle.source.url).pathname
      );
      const resolution = yield* input.identityResolver.resolve(bundle.source);
      if (resolution._tag !== "UnsupportedIdentity") {
        return yield* Effect.fail(invalidSource());
      }
      const { canonicalId } = resolution.identity;
      const requestFingerprint = yield* requestFingerprintFor(
        bundle,
        canonicalId
      );

      const adapter = makeOperatorCarouselAdapter({
        bundle,
        canonicalId,
        receivedAt: input.now(),
        sourceUrl: canonicalUrl,
      });
      yield* adapter
        .acquire({
          canonicalId,
          declaredPageCount: bundle.declaredPageCount,
          kind: "tiktok_carousel",
          sourceUrl: canonicalUrl,
        })
        .pipe(Effect.mapError(() => invalidCarouselBundle()));
      if (input.pipeline.preflight !== undefined) {
        yield* input.pipeline.preflight();
      }

      const request = Schema.decodeUnknownSync(CreateRecipeImportIntentRequest)(
        {
          source: bundle.source,
        }
      );
      const admitted = yield* input.application
        .admitWithRequestFingerprint(
          principal,
          request,
          idempotencyKey,
          requestFingerprint
        )
        .pipe(
          Effect.provideService(
            ImportIntentIdGenerator,
            ImportIntentIdGenerator.of({
              next: Effect.sync(input.newIntentId),
            })
          ),
          Effect.mapError(applicationError)
        );

      const currentIntent = yield* input.application
        .get(principal, admitted.intent.id)
        .pipe(Effect.mapError(applicationError));

      if (
        currentIntent.status !== "processing" ||
        currentIntent.source.resolution !== "pending"
      ) {
        return currentIntent;
      }

      yield* input.pipeline
        .stage({
          adapter,
          canonicalId,
          declaredPageCount: bundle.declaredPageCount,
          importId: Schema.decodeUnknownSync(ImportIdSchema)(currentIntent.id),
          sourceUrl: canonicalUrl,
        })
        .pipe(Effect.mapError(pipelineError));

      return yield* input.application
        .resolveSource(principal, {
          canonicalSourceId: canonicalId,
          canonicalUrl:
            Schema.decodeUnknownSync(CanonicalTikTokUrl)(canonicalUrl),
          intentId: currentIntent.id,
          sourceKind: "carousel",
        })
        .pipe(Effect.mapError(applicationError));
    }
  );

  return { admit };
};

export const OperatorCarouselImportService =
  Context.Service<OperatorCarouselImportService>(
    "meal-planner/OperatorCarouselImportService"
  );
