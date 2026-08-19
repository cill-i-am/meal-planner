import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { applyD1Migrations, env } from "cloudflare:test";
import { DateTime, Effect, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { makeDeterministicTikTokCarouselAdapter } from "./import-carousel-adapter.fake.js";
import type { TikTokCarouselAdapterFailure } from "./import-carousel-adapter.js";
import { OperatorCarouselBundle } from "./import-carousel-operator.js";
import { makeOperatorCarouselImportService } from "./import-carousel-operator.service.js";
import {
  CarouselEvidenceManifestDocument,
  carouselImageObjectKey,
  carouselManifestObjectKey,
  importTikTokCarouselToRecipeDraft,
} from "./import-carousel.js";
import { makeD1CarouselEvidenceRepository } from "./import-carousel.repository.d1.js";
import { makeImportIntentApplication } from "./import-intent.js";
import type {
  AcquisitionBucketLike,
  R2ObjectBodyLike,
  R2ObjectLike,
} from "./import-media-acquirer.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { makeD1RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
import { makeDeterministicRecipeExtractor } from "./import-recipe-extractor.fake.js";
import type { RecipeEvidenceAssembly } from "./import-recipe-extractor.js";
import { makeDeterministicVisualEvidenceExtractor } from "./import-visual-evidence.fake.js";
import {
  workerTestR2PutBody,
  workerTestMigrations,
} from "./import-worker-test-environment.js";
import type {
  ImportWorkerR2TestEnvironment,
  WorkerTestR2Object,
  WorkerTestR2ObjectBody,
} from "./import-worker-test-environment.js";
import {
  IdempotencyKey,
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
  SourceUrl,
} from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import {
  admitResolvedTestImport,
  TestImportPrincipal,
  TestImportTrace,
} from "./import.test-fixtures.js";
import { makeTikTokCanonicalSourceIdentityResolver } from "./source-identity.tiktok.js";

const testEnv: ImportWorkerR2TestEnvironment = env;

const decodeIntentId = Schema.decodeUnknownSync(RecipeImportIntentId);
const decodeImportId = Schema.decodeUnknownSync(ImportId);
const decodeIdempotencyKey = Schema.decodeUnknownSync(IdempotencyKey);
const decodeTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const decodeCanonicalId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodeSourceUrl = Schema.decodeUnknownSync(SourceUrl);
const decodeGeneration = Schema.decodeUnknownSync(AcquisitionGeneration);

const generation = decodeGeneration(0);
const observedAt = decodeTimestamp("2026-07-22T07:59:00.000Z");
const completedAt = decodeTimestamp("2026-07-22T08:01:00.000Z");
const deleteAt = decodeTimestamp("2026-07-29T08:01:00.000Z");

const retryableR2Failure = (stage: "store" | "verify") =>
  new RetryableAcquisitionError({ reason: "container_rpc", stage });

const r2Object = (object: WorkerTestR2Object): R2ObjectLike => {
  let projected: R2ObjectLike = {
    checksums: object.checksums,
    size: object.size,
  };
  if (object.customMetadata !== undefined) {
    projected = { ...projected, customMetadata: object.customMetadata };
  }
  if (object.httpMetadata !== undefined) {
    projected = { ...projected, httpMetadata: object.httpMetadata };
  }
  return projected;
};

const r2ObjectBody = (object: WorkerTestR2ObjectBody): R2ObjectBodyLike => ({
  ...r2Object(object),
  arrayBuffer: () =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => object.arrayBuffer(),
    }),
  text: () =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => object.text(),
    }),
});

const acquisitionBucket = (): AcquisitionBucketLike => ({
  get: (key) =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => testEnv.ImportEvidenceBucket.get(key),
    }).pipe(
      Effect.map((object) => (object === null ? null : r2ObjectBody(object)))
    ),
  head: (key) =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => testEnv.ImportEvidenceBucket.head(key),
    }).pipe(
      Effect.map((object) => (object === null ? null : r2Object(object)))
    ),
  put: (key, value, options) =>
    Effect.gen(function* putR2Object() {
      const body = yield* workerTestR2PutBody(value, options.contentLength);
      return yield* Effect.tryPromise({
        catch: () => retryableR2Failure("store"),
        try: () => testEnv.ImportEvidenceBucket.put(key, body, options),
      });
    }).pipe(
      Effect.map((object) => (object === null ? null : r2Object(object)))
    ),
});

const seedQueuedImport = async (identity: string) => {
  const importId = decodeImportId(`018f47ad-91aa-7c35-b6fe-${identity}`);
  const canonicalId = decodeCanonicalId(`752${identity}`);
  const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
  await Effect.runPromise(
    admitResolvedTestImport({
      canonicalId,
      importId,
      repository,
      sourceKind: "carousel",
    })
  );
  return { canonicalId, importId, repository };
};

const descriptorFor = (canonicalId: SourceCanonicalId) => ({
  canonicalId,
  declaredPageCount: 2,
  kind: "tiktok_carousel" as const,
  sourceUrl: decodeSourceUrl(
    `https://www.tiktok.com/@cook/photo/${canonicalId}`
  ),
});

const decodeBase64 = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.codePointAt(0) ?? 0);

const completeAdapterOutput = (canonicalId: SourceCanonicalId) => ({
  images: [
    {
      bytes: decodeBase64(
        "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z"
      ),
      height: 3,
      mimeType: "image/jpeg" as const,
      orderIndex: 0,
      sha256:
        "7f593180ed96b891629067143da2fb44eb996b1a45e7561870a5754d5bba506e",
      width: 2,
    },
    {
      bytes: decodeBase64(
        "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCewFIh3//Z"
      ),
      height: 2,
      mimeType: "image/jpeg" as const,
      orderIndex: 1,
      sha256:
        "8a2cbe47caa698585b361ae9a034bea0363d4c5fc05807262673be911dd7cf32",
      width: 3,
    },
  ],
  source: {
    canonicalUrl: `https://www.tiktok.com/@cook/photo/${canonicalId}`,
    caption: "Two-image synthetic recipe carousel",
    creator: { displayName: "Cook", handle: "cook", id: "cook-id" },
    observedAt: DateTime.formatIso(observedAt),
    provenance: {
      canonicalUrl: "provider_observed" as const,
      caption: "creator_provided" as const,
      creator: {
        displayName: "provider_observed" as const,
        handle: "provider_observed" as const,
        id: "provider_observed" as const,
      },
      publishedAt: null,
    },
    publishedAt: null,
  },
});

const visualFixture = () =>
  makeDeterministicVisualEvidenceExtractor({
    cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
    model: "fixture-vision-v1",
    observations: [
      {
        confidence: 0.98,
        frameIndex: 1,
        kind: "visible_text",
        regions: [{ height: 0.2, width: 0.8, x: 0.1, y: 0.7 }],
        text: "Bake at 180 C for 20 minutes",
        timestampMilliseconds: 1,
      },
    ],
    outcome: "found",
    provider: "deterministic_fake",
    usage: { inputBytes: 270, inputFrames: 1, modelCalls: 1 },
  });

const unresolvedRecipeFact = (reason: string) => ({
  citations: [],
  origin: "unresolved" as const,
  reason,
  state: "unresolved" as const,
});

const recipeFixture = (input: RecipeEvidenceAssembly) => {
  const evidence = (kind: string) => {
    const item = input.items.find((candidate) => candidate.kind === kind);
    if (item === undefined) {
      throw new Error(`Missing ${kind} fixture evidence`);
    }
    return item;
  };
  const supported = (
    value: string | number,
    kind: "caption" | "creator" | "source_url" | "visual_observation",
    origin: "creator_provided" | "observed"
  ) => {
    const item = evidence(kind);
    return {
      citations: [{ confidence: 0.95, evidenceId: item.evidenceId, origin }],
      origin,
      state: "supported" as const,
      value,
    };
  };
  const caption = supported(
    "Two-image synthetic recipe carousel",
    "caption",
    "creator_provided"
  );
  const visual = supported(
    "Bake at 180 C for 20 minutes",
    "visual_observation",
    "observed"
  );
  return {
    author: supported("Cook", "creator", "observed"),
    category: unresolvedRecipeFact("not stated"),
    cookTimeMinutes: supported(20, "visual_observation", "observed"),
    cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
    cuisine: unresolvedRecipeFact("not stated"),
    description: caption,
    ingredientLines: { items: [caption], state: "supported" as const },
    instructions: { items: [visual], state: "supported" as const },
    name: unresolvedRecipeFact("not stated"),
    nutrition: unresolvedRecipeFact("not stated"),
    prepTimeMinutes: unresolvedRecipeFact("not stated"),
    sourceUrl: supported(
      evidence("source_url").value,
      "source_url",
      "observed"
    ),
    supportedClaims: { items: [visual], state: "supported" as const },
    temperatureCelsius: supported(180, "visual_observation", "observed"),
    tools: { items: [], reason: "not stated", state: "unresolved" as const },
    totalTimeMinutes: unresolvedRecipeFact("not stated"),
    unresolvedFields: [
      "category",
      "cuisine",
      "ingredient_quantities",
      "ingredient_units",
      "name",
      "nutrition",
      "prep_time_minutes",
      "tools",
      "total_time_minutes",
      "yield",
    ],
    usage: {
      inputEvidenceItems: input.items.length,
      inputTokens: 100,
      latencyMilliseconds: 1,
      modelCalls: 1,
      outputTokens: 50,
    },
    yield: unresolvedRecipeFact("not stated"),
  };
};

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

const runTracer = async (
  identity: string,
  adapterOutput:
    | ReturnType<typeof completeAdapterOutput>
    | TikTokCarouselAdapterFailure
) => {
  const seeded = await seedQueuedImport(identity);
  const adapter = makeDeterministicTikTokCarouselAdapter(adapterOutput);
  const visual = visualFixture();
  const recipe = makeDeterministicRecipeExtractor(
    {
      model: "fixture-recipe-v1",
      provider: "deterministic_fake",
      version: "carousel-schema-1",
    },
    recipeFixture
  );
  const run = () =>
    Effect.runPromise(
      importTikTokCarouselToRecipeDraft({
        adapter: adapter.service,
        bucket: acquisitionBucket(),
        carouselRepository: makeD1CarouselEvidenceRepository(
          testEnv.MealPlannerDatabase
        ),
        descriptor: descriptorFor(seeded.canonicalId),
        extractor: recipe.service,
        importId: seeded.importId,
        now: () => completedAt,
        recipeRepository: makeD1RecipeDraftRepository(
          testEnv.MealPlannerDatabase
        ),
        visualExtractor: visual.service,
      })
    );
  return { ...seeded, adapter, recipe, run, visual };
};

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    workerTestMigrations(testEnv.TEST_MIGRATIONS),
    "d1_migrations"
  );
});

describe("provider-free TikTok carousel tracer", () => {
  it("persists every ordered private image and a provenance-backed needs-review draft once", async () => {
    const tracer = await runTracer(
      "000000000301",
      completeAdapterOutput(decodeCanonicalId("752000000000301"))
    );

    const result = await tracer.run();

    expect(result).toMatchObject({
      _tag: "CarouselRecipeDraftReady",
      evidence: {
        imageCount: 2,
        manifestKey: carouselManifestObjectKey(tracer.importId, generation),
        transcript: {
          reason: "source_type_carousel",
          status: "not_applicable",
        },
      },
      status: { kind: "needs_review" },
    });
    expect(result.draft).toMatchObject({
      lifecycle: "needs_review",
      schemaVersion: 2,
      transcript: {
        reason: "source_type_carousel",
        status: "not_applicable",
      },
    });
    expect(tracer.adapter.calls).toEqual([descriptorFor(tracer.canonicalId)]);
    expect(tracer.visual.calls).toHaveLength(1);
    expect(
      tracer.visual.calls[0]?.frames.map(
        ({ timestampMilliseconds }) => timestampMilliseconds
      )
    ).toEqual([0, 1]);
    expect(
      tracer.recipe.calls[0]?.items.map(({ kind }) => kind).toSorted()
    ).toEqual(
      ["caption", "creator", "source_url", "visual_observation"].toSorted()
    );

    const storedImages = await Promise.all(
      [0, 1].map((orderIndex) =>
        testEnv.ImportEvidenceBucket.head(
          carouselImageObjectKey(tracer.importId, generation, orderIndex)
        )
      )
    );
    for (const [orderIndex, image] of storedImages.entries()) {
      expect(image).toMatchObject({
        customMetadata: expect.objectContaining({
          importId: tracer.importId,
          kind: "carousel_image",
          orderIndex: String(orderIndex),
          retentionDeadline: DateTime.formatIso(deleteAt),
        }),
        httpMetadata: {
          cacheControl: "private, no-store",
          contentType: "image/jpeg",
        },
      });
    }
    const manifestObject = await testEnv.ImportEvidenceBucket.get(
      carouselManifestObjectKey(tracer.importId, generation)
    );
    if (manifestObject === null) {
      throw new Error("Expected a persisted carousel manifest");
    }
    const manifest = Schema.decodeUnknownSync(CarouselEvidenceManifestDocument)(
      JSON.parse(await manifestObject.text())
    );
    expect(manifest.images.map(({ orderIndex }) => orderIndex)).toEqual([0, 1]);
    expect(
      manifest.images.every(
        ({ deleteAt: value }) =>
          DateTime.formatIso(value) === DateTime.formatIso(deleteAt)
      )
    ).toBe(true);
    expect(manifest.images.map(({ sha256 }) => sha256)).toEqual([
      "7f593180ed96b891629067143da2fb44eb996b1a45e7561870a5754d5bba506e",
      "8a2cbe47caa698585b361ae9a034bea0363d4c5fc05807262673be911dd7cf32",
    ]);
    expect(manifest.source).toMatchObject({
      canonicalId: tracer.canonicalId,
      provenance: { canonicalIdentity: "provider_observed" },
    });
    expect(manifest.source).not.toHaveProperty("canonicalUrl");
    expect(manifest.images[0]?.sourceAttribution).toEqual({
      canonicalId: tracer.canonicalId,
      provenance: "provider_observed",
    });
    expect(manifest.transcript).toEqual({
      reason: "source_type_carousel",
      status: "not_applicable",
    });
    expect(
      await testEnv.MealPlannerDatabase.prepare(
        "SELECT count(*) AS count FROM import_transcriptions WHERE import_id = ?"
      )
        .bind(tracer.importId)
        .first<{ count: number }>()
    ).toEqual({ count: 0 });

    await expect(
      Effect.runPromise(tracer.repository.findById(tracer.importId))
    ).resolves.toMatchObject({
      _tag: "Some",
      value: {
        view: {
          evidence: [
            {
              kind: "carousel_evidence_manifest",
              referenceId: carouselManifestObjectKey(
                tracer.importId,
                generation
              ),
            },
            {
              kind: "recipe_draft",
              referenceId: `recipe-drafts/${result.draft.extractionFingerprint}`,
            },
          ],
          status: { kind: "needs_review" },
        },
      },
    });

    const replay = await tracer.run();
    expect(replay).toEqual(result);
    expect(tracer.adapter.calls).toHaveLength(1);
    expect(tracer.visual.calls).toHaveLength(1);
    expect(tracer.recipe.calls).toHaveLength(1);
  });

  it.each([
    {
      failure: {
        _tag: "TikTokCarouselAdapterFailure",
        code: "carousel_inaccessible",
        completeness: "incomplete_no_draft",
        recovery: "check_source_visibility",
      } satisfies TikTokCarouselAdapterFailure,
      identity: "000000000302",
    },
    {
      failure: {
        _tag: "TikTokCarouselAdapterFailure",
        code: "carousel_partial",
        completeness: "incomplete_no_draft",
        recovery: "request_complete_carousel",
      } satisfies TikTokCarouselAdapterFailure,
      identity: "000000000303",
    },
    {
      failure: {
        _tag: "TikTokCarouselAdapterFailure",
        code: "carousel_layout_drift",
        completeness: "incomplete_no_draft",
        recovery: "update_carousel_adapter",
      } satisfies TikTokCarouselAdapterFailure,
      identity: "000000000304",
    },
  ] as const)(
    "fails closed for $failure.code with an explicit recovery policy",
    async ({ failure, identity }) => {
      const tracer = await runTracer(identity, failure);

      await expect(tracer.run()).rejects.toEqual({
        _tag: "CarouselImportPipelineFailure",
        code: failure.code,
        completeness: "incomplete_no_draft",
        recovery: failure.recovery,
      });
      expect(tracer.adapter.calls).toHaveLength(1);
      expect(tracer.visual.calls).toEqual([]);
      expect(tracer.recipe.calls).toEqual([]);
      expect(
        await testEnv.ImportEvidenceBucket.head(
          carouselImageObjectKey(tracer.importId, generation, 0)
        )
      ).toBeNull();
      expect(
        await testEnv.MealPlannerDatabase.prepare(
          "SELECT count(*) AS count FROM import_recipe_extractions WHERE import_id = ?"
        )
          .bind(tracer.importId)
          .first<{ count: number }>()
      ).toEqual({ count: 0 });
    }
  );

  it("classifies duplicate or missing page indexes as partial without dropping a page", async () => {
    const canonicalId = decodeCanonicalId("752000000000305");
    const output = completeAdapterOutput(canonicalId);
    const [firstImage, secondImage] = output.images;
    if (firstImage === undefined || secondImage === undefined) {
      throw new Error("Expected two synthetic carousel images");
    }
    const tracer = await runTracer("000000000305", {
      ...output,
      images: [firstImage, { ...secondImage, orderIndex: 0 }],
    });

    await expect(tracer.run()).rejects.toMatchObject({
      _tag: "CarouselImportPipelineFailure",
      code: "carousel_partial",
      completeness: "incomplete_no_draft",
      recovery: "request_complete_carousel",
    });
    expect(tracer.visual.calls).toEqual([]);
    expect(tracer.recipe.calls).toEqual([]);
    expect(
      await testEnv.ImportEvidenceBucket.head(
        carouselImageObjectKey(tracer.importId, generation, 0)
      )
    ).toBeNull();
  });

  it("fails closed when a carousel adapter repeats the same JPEG page", async () => {
    const canonicalId = decodeCanonicalId("752000000000307");
    const output = completeAdapterOutput(canonicalId);
    const [firstImage] = output.images;
    if (firstImage === undefined) {
      throw new Error("Expected a synthetic carousel image");
    }
    const tracer = await runTracer("000000000307", {
      ...output,
      images: [firstImage, { ...firstImage, orderIndex: 1 }],
    });

    await expect(tracer.run()).rejects.toMatchObject({
      _tag: "CarouselImportPipelineFailure",
      code: "carousel_partial",
      recovery: "request_complete_carousel",
    });
    expect(tracer.visual.calls).toEqual([]);
    expect(tracer.recipe.calls).toEqual([]);
  });

  it("admits, stages, and starts one canonical operator intent exactly once", async () => {
    const identity = "000000000306";
    const intentId = decodeIntentId(`018f47ad-91aa-7c35-b6fe-${identity}`);
    const canonicalId = decodeCanonicalId(`752${identity}`);
    const output = completeAdapterOutput(canonicalId);
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const stageCalls: unknown[] = [];
    const starterCalls: unknown[][] = [];
    let providerCalls = 0;
    const application = makeImportIntentApplication(
      repository,
      {
        ensureStarted: (startedImportId, executionGeneration, startedTrace) =>
          Effect.sync(() => {
            starterCalls.push([
              startedImportId,
              executionGeneration,
              startedTrace,
            ]);
            return "created" as const;
          }),
      },
      TestImportTrace
    );
    const service = makeOperatorCarouselImportService({
      application,
      identityResolver: makeTikTokCanonicalSourceIdentityResolver(() => {
        providerCalls += 1;
        return Promise.reject(new Error("Provider must not be used"));
      }),
      newIntentId: () => intentId,
      now: () => Schema.encodeSync(ImportTimestamp)(completedAt),
      pipeline: {
        stage: (input) =>
          Effect.sync(() => {
            stageCalls.push(input);
          }),
      },
    });
    const bundle = Schema.decodeUnknownSync(OperatorCarouselBundle)({
      declaredPageCount: 2,
      images: output.images.map(
        ({ bytes, height, orderIndex, sha256, width }) => ({
          height,
          jpegBase64: base64(bytes),
          orderIndex,
          sha256,
          width,
        })
      ),
      source: {
        kind: "tiktok",
        url: `${descriptorFor(canonicalId).sourceUrl}?tracking=discard`,
      },
    });

    const idempotencyKey = decodeIdempotencyKey("operator-306");
    const admitted = await Effect.runPromise(
      service.admit(TestImportPrincipal, bundle, idempotencyKey)
    );
    const replay = await Effect.runPromise(
      service.admit(TestImportPrincipal, bundle, idempotencyKey)
    );

    expect(admitted).toMatchObject({
      id: intentId,
      intentVersion: 2,
      processing: { sourceKind: "carousel", type: "acquiring_media" },
      source: { resolution: "resolved" },
      status: "processing",
    });
    expect(replay).toEqual(admitted);
    expect(stageCalls).toEqual([
      expect.objectContaining({
        canonicalId,
        declaredPageCount: 2,
        importId: intentId,
        sourceUrl: descriptorFor(canonicalId).sourceUrl,
      }),
    ]);
    expect(starterCalls).toEqual([[intentId, 1, TestImportTrace]]);
    expect(providerCalls).toBe(0);
    expect(
      await testEnv.MealPlannerDatabase.prepare(
        `SELECT public_source_kind AS sourceKind,
                public_stage AS stage,
                public_status AS status,
                resolved_canonical_source_id AS canonicalId
           FROM recipe_imports WHERE id = ?`
      )
        .bind(intentId)
        .first()
    ).toEqual({
      canonicalId,
      sourceKind: "carousel",
      stage: "acquiring_media",
      status: "processing",
    });
    expect(
      await testEnv.MealPlannerDatabase.prepare(
        "SELECT count(*) AS count FROM import_requests WHERE import_id = ?"
      )
        .bind(intentId)
        .first()
    ).toEqual({ count: 1 });

    const fingerprintConflictBundle = Schema.decodeUnknownSync(
      OperatorCarouselBundle
    )({
      ...bundle,
      declaredPageCount: 1,
      images: [bundle.images[0]],
    });
    await expect(
      Effect.runPromise(
        service.admit(
          TestImportPrincipal,
          fingerprintConflictBundle,
          idempotencyKey
        )
      )
    ).rejects.toMatchObject({ _tag: "IdempotencyConflict" });
    expect(stageCalls).toHaveLength(1);
    expect(starterCalls).toHaveLength(1);
    expect(providerCalls).toBe(0);

    const invalidCanonicalId = decodeCanonicalId("752000000000308");
    const invalidOutput = completeAdapterOutput(invalidCanonicalId);
    const [duplicateImage] = invalidOutput.images;
    if (duplicateImage === undefined) {
      throw new Error("Expected a synthetic carousel image");
    }
    const invalidBundle = Schema.decodeUnknownSync(OperatorCarouselBundle)({
      declaredPageCount: 2,
      images: [0, 1].map((orderIndex) => ({
        height: duplicateImage.height,
        jpegBase64: base64(duplicateImage.bytes),
        orderIndex,
        sha256: duplicateImage.sha256,
        width: duplicateImage.width,
      })),
      source: {
        kind: "tiktok",
        url: descriptorFor(invalidCanonicalId).sourceUrl,
      },
    });
    await expect(
      Effect.runPromise(
        service.admit(
          TestImportPrincipal,
          invalidBundle,
          decodeIdempotencyKey("operator-308-invalid")
        )
      )
    ).rejects.toMatchObject({
      _tag: "InvalidCarouselBundle",
    });
    expect(
      await testEnv.MealPlannerDatabase.prepare(
        "SELECT count(*) AS count FROM recipe_imports WHERE resolved_canonical_source_id = ?"
      )
        .bind(invalidCanonicalId)
        .first()
    ).toEqual({ count: 0 });
  });
});
