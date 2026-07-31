import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
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
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { makeD1RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
import { makeDeterministicRecipeExtractor } from "./import-recipe-extractor.fake.js";
import type { RecipeEvidenceAssembly } from "./import-recipe-extractor.js";
import { makeDeterministicVisualEvidenceExtractor } from "./import-visual-evidence.fake.js";
import {
  IdempotencyKey,
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
  SourceUrl,
} from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import type { AcceptImportCommand, StoredImport } from "./import.repository.js";
import {
  CompatibilityFingerprint,
  IdempotencyKeyHash,
  RequestFingerprint,
  SourceLocatorHash,
} from "./import.repository.js";
import { makeTikTokCanonicalSourceIdentityResolver } from "./source-identity.tiktok.js";

interface TestR2Object {
  readonly checksums?: { readonly sha256?: ArrayBuffer };
  readonly customMetadata?: Record<string, string>;
  readonly httpMetadata?: {
    readonly cacheControl?: string;
    readonly contentType?: string;
  };
  readonly size: number;
  readonly text: () => Promise<string>;
}

interface TestR2Bucket {
  readonly get: (key: string) => Promise<TestR2Object | null>;
  readonly head: (key: string) => Promise<TestR2Object | null>;
  readonly put: (
    key: string,
    value: ArrayBufferView | ReadableStream,
    options?: unknown
  ) => Promise<TestR2Object | null>;
}

const testEnv = env as unknown as {
  readonly ImportEvidenceBucket: TestR2Bucket;
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const decodeImportId = Schema.decodeUnknownSync(ImportId);
const decodeIdempotencyKey = Schema.decodeUnknownSync(IdempotencyKey);
const decodeTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const decodeCanonicalId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodeSourceUrl = Schema.decodeUnknownSync(SourceUrl);
const decodeGeneration = Schema.decodeUnknownSync(AcquisitionGeneration);
const decodeCompatibilityFingerprint = Schema.decodeUnknownSync(
  CompatibilityFingerprint
);
const decodeIdempotencyKeyHash = Schema.decodeUnknownSync(IdempotencyKeyHash);
const decodeRequestFingerprint = Schema.decodeUnknownSync(RequestFingerprint);
const decodeSourceLocatorHash = Schema.decodeUnknownSync(SourceLocatorHash);

const generation = decodeGeneration(0);
const createdAt = decodeTimestamp("2026-07-22T08:00:00.000Z");
const observedAt = decodeTimestamp("2026-07-22T07:59:00.000Z");
const completedAt = decodeTimestamp("2026-07-22T08:01:00.000Z");
const deleteAt = decodeTimestamp("2026-07-29T08:01:00.000Z");

const fixtureHash = (value: string) =>
  Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  )
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);

const acquisitionBucket = (): AcquisitionBucketLike => ({
  get: (key) => testEnv.ImportEvidenceBucket.get(key),
  head: (key) => testEnv.ImportEvidenceBucket.head(key),
  put: (key, value, options) =>
    testEnv.ImportEvidenceBucket.put(key, value, options),
});

const seedQueuedImport = async (identity: string) => {
  const importId = decodeImportId(`018f47ad-91aa-7c35-b6fe-${identity}`);
  const canonicalId = decodeCanonicalId(`752${identity}`);
  const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
  const candidate: StoredImport = {
    acquisitionGeneration: generation,
    canonicalSourceId: canonicalId,
    compatibilityFingerprint: decodeCompatibilityFingerprint(
      fixtureHash(`${identity}:carousel-compatibility`)
    ),
    sourceKind: "tiktok",
    view: {
      createdAt,
      evidence: [],
      id: importId,
      source: { canonicalId, kind: "tiktok" },
      status: { kind: "queued" },
      updatedAt: createdAt,
    },
  };
  const command: AcceptImportCommand = {
    candidate,
    idempotencyKeyHash: decodeIdempotencyKeyHash(
      fixtureHash(`${identity}:carousel-idempotency`)
    ),
    requestFingerprint: decodeRequestFingerprint(
      fixtureHash(`${identity}:carousel-request`)
    ),
    sourceLocatorHash: decodeSourceLocatorHash(
      fixtureHash(`${identity}:carousel-locator`)
    ),
  };
  await Effect.runPromise(repository.acceptRequest(command));
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

const operatorRecipeFixture = (input: RecipeEvidenceAssembly) => {
  const source = input.items.find(({ kind }) => kind === "source_url");
  const visual = input.items.find(({ kind }) => kind === "visual_observation");
  if (source === undefined || visual === undefined) {
    throw new Error("Missing canonical recipe evidence");
  }
  const unresolved = unresolvedRecipeFact("not supplied");
  const unresolvedList = {
    items: [],
    reason: "not supplied",
    state: "unresolved" as const,
  };
  const supportedVisual = {
    citations: [
      {
        confidence: 1,
        evidenceId: visual.evidenceId,
        origin: "observed" as const,
      },
    ],
    origin: "observed" as const,
    state: "supported" as const,
    value: visual.value,
  };
  return {
    author: unresolved,
    category: unresolved,
    cookTimeMinutes: unresolved,
    cost: {
      certainty: "known" as const,
      currency: "USD" as const,
      estimatedMicroUsd: 0,
    },
    cuisine: unresolved,
    description: unresolved,
    ingredientLines: {
      items: [supportedVisual],
      state: "supported" as const,
    },
    instructions: { items: [supportedVisual], state: "supported" as const },
    name: unresolved,
    nutrition: unresolved,
    prepTimeMinutes: unresolved,
    sourceUrl: {
      citations: [
        {
          confidence: 1,
          evidenceId: source.evidenceId,
          origin: "observed" as const,
        },
      ],
      origin: "observed" as const,
      state: "supported" as const,
      value: source.value,
    },
    supportedClaims: unresolvedList,
    temperatureCelsius: unresolved,
    tools: unresolvedList,
    totalTimeMinutes: unresolved,
    unresolvedFields: [
      "author",
      "category",
      "cook_time_minutes",
      "cuisine",
      "description",
      "ingredient_quantities",
      "ingredient_units",
      "name",
      "nutrition",
      "prep_time_minutes",
      "temperature_celsius",
      "tools",
      "total_time_minutes",
      "yield",
    ],
    usage: {
      inputEvidenceItems: input.items.length,
      inputTokens: 0,
      latencyMilliseconds: 0,
      modelCalls: 1 as const,
      outputTokens: 0,
    },
    yield: unresolved,
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
    [...testEnv.TEST_MIGRATIONS],
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

  it("admits an operator bundle from queued through the installed D1/R2 carousel service exactly once", async () => {
    const identity = "000000000306";
    const importId = decodeImportId(`018f47ad-91aa-7c35-b6fe-${identity}`);
    const canonicalId = decodeCanonicalId(`752${identity}`);
    const output = completeAdapterOutput(canonicalId);
    const visual = makeDeterministicVisualEvidenceExtractor({
      cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
      model: "provider-free-proof",
      observations: [
        {
          confidence: 1,
          frameIndex: 0,
          kind: "visible_text",
          regions: [{ height: 1, width: 1, x: 0, y: 0 }],
          text: "Chop onion then cook",
          timestampMilliseconds: 0,
        },
      ],
      outcome: "found",
      provider: "deterministic_fake",
      usage: {
        inputBytes: output.images[1]?.bytes.byteLength ?? 0,
        inputFrames: 1,
        modelCalls: 1,
      },
    });
    const recipe = makeDeterministicRecipeExtractor(
      {
        model: "provider-free-proof",
        provider: "deterministic_fake",
        version: "operator-carousel-v1",
      },
      operatorRecipeFixture
    );
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const service = makeOperatorCarouselImportService({
      identityResolver: makeTikTokCanonicalSourceIdentityResolver(() =>
        Promise.reject(new Error("Network must not be used"))
      ),
      newId: () => importId,
      now: () => completedAt,
      pipeline: {
        process: (input) =>
          importTikTokCarouselToRecipeDraft({
            adapter: input.adapter,
            bucket: acquisitionBucket(),
            carouselRepository: makeD1CarouselEvidenceRepository(
              testEnv.MealPlannerDatabase
            ),
            descriptor: {
              canonicalId: input.canonicalId,
              declaredPageCount: input.declaredPageCount,
              kind: "tiktok_carousel",
              sourceUrl: input.sourceUrl,
            },
            extractor: recipe.service,
            importId: input.importId,
            now: () => completedAt,
            recipeRepository: makeD1RecipeDraftRepository(
              testEnv.MealPlannerDatabase
            ),
            visualExtractor: visual.service,
          }).pipe(Effect.asVoid),
      },
      repository,
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
      service.admit(bundle, idempotencyKey)
    );
    const replay = await Effect.runPromise(
      service.admit(bundle, idempotencyKey)
    );

    expect(admitted).toMatchObject({
      disposition: "created",
      import: { id: importId, status: { kind: "needs_review" } },
    });
    expect(replay).toMatchObject({
      disposition: "idempotency_replay",
      import: { id: importId, status: { kind: "needs_review" } },
    });
    expect(visual.calls).toHaveLength(1);
    expect(recipe.calls).toHaveLength(1);
    expect(
      await testEnv.MealPlannerDatabase.prepare(
        "SELECT status FROM recipe_imports WHERE id = ?"
      )
        .bind(importId)
        .first()
    ).toEqual({ status: "queued" });
    expect(
      await testEnv.MealPlannerDatabase.prepare(
        "SELECT count(*) AS count FROM import_transcriptions WHERE import_id = ?"
      )
        .bind(importId)
        .first()
    ).toEqual({ count: 0 });
    const manifestObject = await testEnv.ImportEvidenceBucket.get(
      carouselManifestObjectKey(importId, generation)
    );
    if (manifestObject === null) {
      throw new Error("Expected an operator carousel manifest");
    }
    const manifest = Schema.decodeUnknownSync(CarouselEvidenceManifestDocument)(
      JSON.parse(await manifestObject.text())
    );
    expect(manifest.source).toMatchObject({
      canonicalId,
      provenance: { canonicalIdentity: "operator_supplied" },
    });
    expect(JSON.stringify(manifest)).not.toContain("https://");
    expect(JSON.stringify(manifest)).not.toContain("tracking=discard");
    expect(
      manifest.images.every(
        ({ sourceAttribution }) =>
          sourceAttribution.provenance === "operator_supplied"
      )
    ).toBe(true);
    expect(manifest.retention.configuredAgeSeconds).toBe(604_800);
    expect(manifest.transcript).toEqual({
      reason: "source_type_carousel",
      status: "not_applicable",
    });

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
          invalidBundle,
          decodeIdempotencyKey("operator-308-invalid")
        )
      )
    ).rejects.toMatchObject({
      _tag: "InvalidCarouselBundle",
    });
    expect(
      await testEnv.MealPlannerDatabase.prepare(
        "SELECT count(*) AS count FROM recipe_imports WHERE canonical_source_id = ?"
      )
        .bind(invalidCanonicalId)
        .first()
    ).toEqual({ count: 0 });
  });
});
