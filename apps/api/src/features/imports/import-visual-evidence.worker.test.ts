import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Option, Schema, Stream } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { acquireStoreVerify } from "./import-media-acquirer.js";
import type {
  AcquisitionBucketLike,
  AcquisitionMediaObjectLike,
  PreparedMediaArtifact,
} from "./import-media-acquirer.js";
import {
  AcquisitionGeneration,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import { produceRecipeDraftForImport } from "./import-recipe-draft.js";
import type { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import { makeD1RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
import { makeDeterministicRecipeExtractor } from "./import-recipe-extractor.fake.js";
import type { RecipeEvidenceAssembly } from "./import-recipe-extractor.js";
import { RecipeExtraction } from "./import-recipe-extractor.js";
import {
  makeDeterministicSpeechAudioExtractor,
  makeDeterministicSpeechTranscriber,
} from "./import-speech-transcription.fake.js";
import {
  transcribeAcquiredImport,
  transcriptObjectKey,
} from "./import-speech-transcription.js";
import { makeD1SpeechTranscriptionRepository } from "./import-speech-transcription.repository.d1.js";
import type { VisualEvidenceExtractorShape } from "./import-visual-evidence-extractor.js";
import { VisualEvidence } from "./import-visual-evidence-extractor.js";
import {
  makeDeterministicFrameSampler,
  makeDeterministicVisualEvidenceExtractor,
} from "./import-visual-evidence.fake.js";
import {
  extractVisualEvidenceForTranscribedImport,
  visualEvidenceManifestObjectKey,
  visualFrameObjectKey,
} from "./import-visual-evidence.js";
import { makeD1VisualEvidenceRepository } from "./import-visual-evidence.repository.d1.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { importPersistenceUnavailable } from "./import.errors.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import type { AcceptImportCommand, StoredImport } from "./import.repository.js";
import {
  CompatibilityFingerprint,
  IdempotencyKeyHash,
  RequestFingerprint,
  SourceLocatorHash,
} from "./import.repository.js";

interface TestR2Object {
  readonly checksums?: { readonly sha256?: ArrayBuffer };
  readonly customMetadata?: Record<string, string>;
  readonly httpMetadata?: {
    readonly cacheControl?: string;
    readonly contentType?: string;
  };
  readonly key: string;
  readonly size: number;
  readonly text: () => Promise<string>;
}

interface TestR2Bucket {
  readonly delete: (key: string) => Promise<void>;
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
const decodeTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const decodeCanonicalId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodeGeneration = Schema.decodeUnknownSync(AcquisitionGeneration);
const decodeCompatibilityFingerprint = Schema.decodeUnknownSync(
  CompatibilityFingerprint
);
const decodeIdempotencyKeyHash = Schema.decodeUnknownSync(IdempotencyKeyHash);
const decodeRequestFingerprint = Schema.decodeUnknownSync(RequestFingerprint);
const decodeSourceLocatorHash = Schema.decodeUnknownSync(SourceLocatorHash);

const generation = decodeGeneration(1);
const acquiredAt = decodeTimestamp("2026-07-21T10:00:00.000Z");
const transcribedAt = decodeTimestamp("2026-07-21T10:01:00.000Z");
const extractedAt = decodeTimestamp("2026-07-21T10:02:00.000Z");
const sourceMedia = new Uint8Array([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);
const sourceMediaSha256 =
  "c43403fe022af967a0b859d3e14ea12d6633f4c8ad475816b0c55d85896e8e35";

const fixtureHash = (value: string) =>
  Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  )
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);

const makeRecipeExtractorDescriptor = (version: "schema-1" | "schema-2") => ({
  model: "fixture-recipe-v1",
  provider: "deterministic_fake",
  version,
});

const acquisitionBucket = (): AcquisitionBucketLike => ({
  get: (key) => testEnv.ImportEvidenceBucket.get(key),
  head: (key) => testEnv.ImportEvidenceBucket.head(key),
  put: (key, value, options) =>
    testEnv.ImportEvidenceBucket.put(key, value, options),
});

const makeTranscribedImport = async (
  importId: ImportId,
  canonicalId: SourceCanonicalId,
  options: { readonly transcribe?: boolean } = {}
) => {
  const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase, () =>
    Date.parse("2026-07-21T09:59:00.000Z")
  );
  const createdAt = decodeTimestamp("2026-07-21T09:58:00.000Z");
  const identity = importId.slice(-6);
  const candidate: StoredImport = {
    acquisitionGeneration: decodeGeneration(0),
    canonicalSourceId: canonicalId,
    compatibilityFingerprint: decodeCompatibilityFingerprint(
      fixtureHash(`${identity}:visual-tracer-compatibility`)
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
      fixtureHash(`${identity}:visual-tracer-idempotency`)
    ),
    requestFingerprint: decodeRequestFingerprint(
      fixtureHash(`${identity}:visual-tracer-request`)
    ),
    sourceLocatorHash: decodeSourceLocatorHash(
      fixtureHash(`${identity}:visual-tracer-locator`)
    ),
  };
  await Effect.runPromise(repository.acceptRequest(command));
  await Effect.runPromise(repository.claimAcquisition(importId));
  await Effect.runPromise(repository.beginAcquisitionAttempt(importId));

  const prepared: PreparedMediaArtifact = {
    artifactId: "visual-tracer-source",
    audioStreams: [{ codec: "aac", index: 1 }],
    bytes: sourceMedia.byteLength,
    durationSeconds: 2,
    metadata: {
      canonicalId,
      canonicalUrl: `https://www.tiktok.com/@cook/video/${canonicalId}`,
      caption: "Synthetic fixture caption",
      creator: { displayName: "Cook", handle: "cook", id: "cook-id" },
      observedAt: "2026-07-21T09:57:00.000Z",
      provenance: {
        canonicalUrl: "provider_observed",
        caption: "creator_provided",
        creator: {
          displayName: "provider_observed",
          handle: "provider_observed",
          id: "provider_observed",
        },
        publishedAt: null,
      },
      publishedAt: null,
    },
    sha256: sourceMediaSha256,
    videoStreams: [{ codec: "h264", index: 0 }],
  };
  const mediaObject: AcquisitionMediaObjectLike = {
    cleanup: () => Effect.void,
    prepare: () => Effect.succeed(prepared),
    stream: () => Stream.make(sourceMedia),
  };
  const outcome = await Effect.runPromise(
    acquireStoreVerify(acquisitionBucket(), mediaObject, {
      canonicalId,
      generation,
      importId,
      now: () => new Date(DateTime.toEpochMillis(acquiredAt)),
    })
  );
  if (outcome._tag !== "VerifiedAcquisition") {
    throw new Error("Expected acquired fixture");
  }
  await Effect.runPromise(
    repository.recordAcquired(
      importId,
      generation,
      outcome.evidence,
      outcome.evidence.acquiredAt
    )
  );
  if (options.transcribe === false) {
    return repository;
  }

  const audio = makeDeterministicSpeechAudioExtractor({
    bytes: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]),
    durationMilliseconds: 2000,
    mimeType: "audio/wav",
    sha256: "c4ffde8d57d64bbc7a1220d8bf9560d208511252d9173d1359f5cf9a7b2f14dc",
  });
  const speech = makeDeterministicSpeechTranscriber({
    cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
    detectedLanguage: "en",
    model: "fixture-v1",
    provider: "deterministic_fake",
    segments: [
      { endMilliseconds: 900, startMilliseconds: 0, text: "Chop onions." },
      {
        endMilliseconds: 1900,
        startMilliseconds: 1000,
        text: "Simmer for ten minutes.",
      },
    ],
    text: "Chop onions. Simmer for ten minutes.",
    usage: { audioDurationMilliseconds: 2000, inputBytes: 8 },
  });
  await Effect.runPromise(
    transcribeAcquiredImport({
      acquisitionRepository: repository,
      audioExtractor: audio.service,
      bucket: acquisitionBucket(),
      importId,
      now: () => transcribedAt,
      speechTranscriber: speech.service,
      transcriptionRepository: makeD1SpeechTranscriptionRepository(
        testEnv.MealPlannerDatabase
      ),
    })
  );
  return repository;
};

const makeFrameFixture = () =>
  makeDeterministicFrameSampler([
    {
      bytes: new Uint8Array([255, 216, 255, 217]),
      height: 640,
      mimeType: "image/jpeg",
      sha256:
        "32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af",
      timestampMilliseconds: 0,
      width: 360,
    },
    {
      bytes: new Uint8Array([255, 216, 1, 255, 217]),
      height: 640,
      mimeType: "image/jpeg",
      sha256:
        "adeaec77d1bc772e9694f8b5d7ba0ab621797f61f2587493ba69bd8dbbf09bf1",
      timestampMilliseconds: 1000,
      width: 360,
    },
  ]);

const makeVisualFixture = (outcome: "empty" | "found" | "low_confidence") =>
  makeDeterministicVisualEvidenceExtractor({
    cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
    model: "fixture-vision-v1",
    observations:
      outcome === "empty"
        ? []
        : [
            {
              confidence: outcome === "found" ? 0.98 : 0.42,
              frameIndex: 1,
              kind: "visible_text" as const,
              regions: [{ height: 0.2, width: 0.8, x: 0.1, y: 0.7 }],
              text: "Bake at 180 C for 20 minutes",
              timestampMilliseconds: 1000,
            },
          ],
    outcome,
    provider: "deterministic_fake",
    usage: { inputBytes: 9, inputFrames: 2, modelCalls: 1 },
  });

const unresolvedRecipeFact = (reason: string) => ({
  citations: [],
  origin: "unresolved",
  reason,
  state: "unresolved",
});

const makeRecipeFixture = (
  input: RecipeEvidenceAssembly,
  canonicalId: SourceCanonicalId,
  options: {
    readonly citationEvidenceId?: string;
    readonly ingredientValue?: string;
  } = {}
) => {
  const evidence = (kind: string) => {
    const item = input.items.find((candidate) => candidate.kind === kind);
    if (item === undefined) {
      throw new Error(`Missing ${kind} fixture evidence`);
    }
    return item;
  };
  const citation = (kind: string, confidence: number) => {
    const item = evidence(kind);
    return {
      confidence,
      evidenceId: options.citationEvidenceId ?? item.evidenceId,
      origin: item.origin,
    };
  };
  const supported = (
    value: string | number,
    kind: string,
    origin: "creator_provided" | "inferred" | "observed"
  ) => ({
    citations: [citation(kind, 0.95)],
    origin,
    state: "supported",
    value,
  });
  const transcript = supported(
    options.ingredientValue ?? "Chop onions.",
    "transcript",
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
    cost: {
      certainty: "known",
      currency: "USD",
      estimatedMicroUsd: 0,
    },
    cuisine: unresolvedRecipeFact("not stated"),
    description: unresolvedRecipeFact("not stated"),
    ingredientLines: { items: [transcript], state: "supported" },
    instructions: { items: [transcript, visual], state: "supported" },
    name: unresolvedRecipeFact("not stated"),
    nutrition: unresolvedRecipeFact("not stated"),
    prepTimeMinutes: unresolvedRecipeFact("not stated"),
    sourceUrl: supported(
      `https://www.tiktok.com/@cook/video/${canonicalId}`,
      "source_url",
      "observed"
    ),
    supportedClaims: { items: [visual], state: "supported" },
    temperatureCelsius: supported(180, "visual_observation", "observed"),
    tools: { items: [], reason: "not stated", state: "unresolved" },
    totalTimeMinutes: unresolvedRecipeFact("not stated"),
    unresolvedFields: [
      "category",
      "cuisine",
      "description",
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

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

describe("provider-free transcript-to-visual-evidence tracer", () => {
  it("stores bounded private frames and normalized evidence exactly once", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000210");
    const canonicalId = decodeCanonicalId("7520000000000000210");
    const importRepository = await makeTranscribedImport(importId, canonicalId);
    const frames = makeFrameFixture();
    const extractor = makeVisualFixture("found");
    const visualRepository = makeD1VisualEvidenceRepository(
      testEnv.MealPlannerDatabase
    );

    const result = await Effect.runPromise(
      extractVisualEvidenceForTranscribedImport({
        bucket: acquisitionBucket(),
        extractor: extractor.service,
        frameSampler: frames.service,
        importId,
        importRepository,
        now: () => extractedAt,
        visualRepository,
      })
    );

    expect(result).toEqual({
      _tag: "VisualEvidenceReady",
      generation,
      importId,
      manifestKey: visualEvidenceManifestObjectKey(importId, generation),
      outcome: "found",
    });
    expect(frames.calls).toEqual([
      {
        durationMilliseconds: 2000,
        generation,
        importId,
        mediaKey: mediaObjectKey(importId, generation),
        sourceMediaSha256,
      },
    ]);
    expect(extractor.calls).toHaveLength(1);
    expect(extractor.calls[0]).toMatchObject({
      dispatchId: `visual:${importId}:${generation}`,
      generation,
      importId,
    });

    const stored = Option.getOrThrow(
      await Effect.runPromise(importRepository.findById(importId))
    );
    expect(stored.view).toMatchObject({
      evidence: [
        {
          kind: "original_media",
          referenceId: mediaObjectKey(importId, generation),
        },
        {
          kind: "acquisition_manifest",
          referenceId: manifestObjectKey(importId, generation),
        },
        {
          kind: "speech_transcript",
          referenceId: transcriptObjectKey(importId, generation),
        },
        {
          kind: "visual_evidence_manifest",
          referenceId: visualEvidenceManifestObjectKey(importId, generation),
        },
      ],
      status: { kind: "visual_evidence_found" },
      updatedAt: extractedAt,
    });
    const storedFrames = await Promise.all(
      [0, 1].map((frameIndex) =>
        testEnv.ImportEvidenceBucket.head(
          visualFrameObjectKey(importId, generation, frameIndex)
        )
      )
    );
    for (const frame of storedFrames) {
      expect(frame).toMatchObject({
        customMetadata: expect.objectContaining({
          generation: String(generation),
          importId,
          kind: "visual_frame",
        }),
        httpMetadata: {
          cacheControl: "private, no-store",
          contentType: "image/jpeg",
        },
      });
    }
    const manifest = await testEnv.ImportEvidenceBucket.get(
      visualEvidenceManifestObjectKey(importId, generation)
    );
    expect(manifest).toMatchObject({
      customMetadata: expect.objectContaining({
        generation: String(generation),
        importId,
        kind: "visual_evidence_manifest",
      }),
      httpMetadata: {
        cacheControl: "private, no-store",
        contentType: "application/json",
      },
    });
    const manifestText = await manifest?.text();
    expect(manifestText).not.toMatch(/providerBody|authorization|token/iu);
    expect(JSON.parse(manifestText ?? "{}")).toMatchObject({
      retention: {
        configuredAgeSeconds: 604_800,
        policy: "r2_bucket_object_age",
      },
      schemaVersion: 1,
      sourceEvidenceDeleteAt: "2026-07-28T10:00:00.000Z",
    });

    const duplicate = await Effect.runPromise(
      importRepository.acceptRequest({
        candidate: stored,
        idempotencyKeyHash: decodeIdempotencyKeyHash(
          fixtureHash("visual-complete-canonical-duplicate")
        ),
        requestFingerprint: decodeRequestFingerprint(
          fixtureHash("visual-complete-canonical-request")
        ),
        sourceLocatorHash: decodeSourceLocatorHash(
          fixtureHash("visual-complete-canonical-locator")
        ),
      })
    );
    expect(duplicate).toMatchObject({
      disposition: "canonical_duplicate",
      import: { view: { status: { kind: "visual_evidence_found" } } },
    });

    const replayFrames = makeDeterministicFrameSampler([]);
    const replayExtractor = makeDeterministicVisualEvidenceExtractor({
      cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
      model: "must-not-run",
      observations: [],
      outcome: "empty",
      provider: "deterministic_fake",
      usage: { inputBytes: 1, inputFrames: 1, modelCalls: 1 },
    });
    await expect(
      Effect.runPromise(
        extractVisualEvidenceForTranscribedImport({
          bucket: acquisitionBucket(),
          extractor: replayExtractor.service,
          frameSampler: replayFrames.service,
          importId,
          importRepository,
          now: () => extractedAt,
          visualRepository,
        })
      )
    ).resolves.toEqual(result);
    expect(replayFrames.calls).toEqual([]);
    expect(replayExtractor.calls).toEqual([]);

    await testEnv.ImportEvidenceBucket.delete(
      visualEvidenceManifestObjectKey(importId, generation)
    );
    await expect(
      Effect.runPromise(
        extractVisualEvidenceForTranscribedImport({
          bucket: acquisitionBucket(),
          extractor: replayExtractor.service,
          frameSampler: replayFrames.service,
          importId,
          importRepository,
          now: () => extractedAt,
          visualRepository,
        })
      )
    ).rejects.toMatchObject({
      _tag: "VisualEvidencePipelineFailure",
      code: "visual_evidence_failed",
    });
    expect(replayFrames.calls).toEqual([]);
    expect(replayExtractor.calls).toEqual([]);
  });

  it("recovers committed R2 evidence after D1 completion loss without redispatch", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000216");
    const canonicalId = decodeCanonicalId("7520000000000000216");
    const importRepository = await makeTranscribedImport(importId, canonicalId);
    const frames = makeFrameFixture();
    const extractor = makeVisualFixture("found");
    const durableRepository = makeD1VisualEvidenceRepository(
      testEnv.MealPlannerDatabase
    );
    let rejectCompletion = true;
    const interruptedRepository = {
      ...durableRepository,
      complete: (evidence: Parameters<typeof durableRepository.complete>[0]) =>
        Effect.suspend(() => {
          if (rejectCompletion) {
            rejectCompletion = false;
            return Effect.fail(importPersistenceUnavailable());
          }
          return durableRepository.complete(evidence);
        }),
    };

    await expect(
      Effect.runPromise(
        extractVisualEvidenceForTranscribedImport({
          bucket: acquisitionBucket(),
          extractor: extractor.service,
          frameSampler: frames.service,
          importId,
          importRepository,
          now: () => extractedAt,
          visualRepository: interruptedRepository,
        })
      )
    ).rejects.toMatchObject({ _tag: "ImportPersistenceUnavailable" });
    expect(frames.calls).toHaveLength(1);
    expect(extractor.calls).toHaveLength(1);
    expect(
      Option.getOrThrow(
        await Effect.runPromise(importRepository.findById(importId))
      ).view
    ).toMatchObject({
      status: { kind: "extracting_visual" },
      updatedAt: extractedAt,
    });

    const replayFrames = makeDeterministicFrameSampler([]);
    const replayExtractor = makeVisualFixture("empty");
    await expect(
      Effect.runPromise(
        extractVisualEvidenceForTranscribedImport({
          bucket: acquisitionBucket(),
          extractor: replayExtractor.service,
          frameSampler: replayFrames.service,
          importId,
          importRepository,
          now: () => extractedAt,
          visualRepository: durableRepository,
        })
      )
    ).resolves.toMatchObject({
      _tag: "VisualEvidenceReady",
      outcome: "found",
    });
    expect(replayFrames.calls).toEqual([]);
    expect(replayExtractor.calls).toEqual([]);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state FROM import_visual_evidence
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(importId, generation)
        .first()
    ).resolves.toEqual({ state: "completed" });
  });

  it("fails closed on a pre-manifest replay without redispatching", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000217");
    const canonicalId = decodeCanonicalId("7520000000000000217");
    const importRepository = await makeTranscribedImport(importId, canonicalId);
    const visualRepository = makeD1VisualEvidenceRepository(
      testEnv.MealPlannerDatabase
    );
    await Effect.runPromise(
      visualRepository.claim({
        dispatchId: `visual:${importId}:${generation}`,
        generation,
        importId,
        sourceMediaSha256,
        startedAt: extractedAt,
      })
    );
    const frames = makeFrameFixture();
    const extractor = makeVisualFixture("found");

    await expect(
      Effect.runPromise(
        extractVisualEvidenceForTranscribedImport({
          bucket: acquisitionBucket(),
          extractor: extractor.service,
          frameSampler: frames.service,
          importId,
          importRepository,
          now: () => extractedAt,
          visualRepository,
        })
      )
    ).rejects.toMatchObject({
      _tag: "VisualEvidencePipelineFailure",
      code: "outcome_unknown",
    });
    expect(frames.calls).toEqual([]);
    expect(extractor.calls).toEqual([]);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state FROM import_visual_evidence
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(importId, generation)
        .first()
    ).resolves.toEqual({ state: "dispatching" });
  });

  it("fails closed before sampling when transcript evidence is missing", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000211");
    const canonicalId = decodeCanonicalId("7520000000000000211");
    const importRepository = await makeTranscribedImport(importId, canonicalId);
    await testEnv.ImportEvidenceBucket.delete(
      transcriptObjectKey(importId, generation)
    );
    const frames = makeFrameFixture();
    const extractor = makeVisualFixture("found");

    await expect(
      Effect.runPromise(
        extractVisualEvidenceForTranscribedImport({
          bucket: acquisitionBucket(),
          extractor: extractor.service,
          frameSampler: frames.service,
          importId,
          importRepository,
          now: () => extractedAt,
          visualRepository: makeD1VisualEvidenceRepository(
            testEnv.MealPlannerDatabase
          ),
        })
      )
    ).rejects.toMatchObject({
      _tag: "VisualEvidencePipelineFailure",
      code: "source_evidence_invalid",
    });
    expect(frames.calls).toEqual([]);
    expect(extractor.calls).toEqual([]);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "SELECT COUNT(*) AS count FROM import_visual_evidence WHERE import_id = ?"
      )
        .bind(importId)
        .first()
    ).resolves.toEqual({ count: 0 });
    expect(
      Option.getOrThrow(
        await Effect.runPromise(importRepository.findById(importId))
      ).view.status
    ).toEqual({ kind: "transcribed" });
  });

  it("rejects the visual lifecycle before a transcript exists", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000212");
    const canonicalId = decodeCanonicalId("7520000000000000212");
    const importRepository = await makeTranscribedImport(
      importId,
      canonicalId,
      { transcribe: false }
    );
    const frames = makeFrameFixture();
    const extractor = makeVisualFixture("found");

    await expect(
      Effect.runPromise(
        extractVisualEvidenceForTranscribedImport({
          bucket: acquisitionBucket(),
          extractor: extractor.service,
          frameSampler: frames.service,
          importId,
          importRepository,
          now: () => extractedAt,
          visualRepository: makeD1VisualEvidenceRepository(
            testEnv.MealPlannerDatabase
          ),
        })
      )
    ).rejects.toMatchObject({ _tag: "ImportTransitionRejected" });
    expect(frames.calls).toEqual([]);
    expect(extractor.calls).toEqual([]);
  });

  it("records bounded-sampling failure as terminal and never redispatches it", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000213");
    const canonicalId = decodeCanonicalId("7520000000000000213");
    const importRepository = await makeTranscribedImport(importId, canonicalId);
    const invalidFrames = makeDeterministicFrameSampler([
      {
        bytes: new Uint8Array([255, 216, 255, 217]),
        height: 640,
        mimeType: "image/jpeg",
        sha256:
          "32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af",
        timestampMilliseconds: 2000,
        width: 360,
      },
    ]);
    const extractor = makeVisualFixture("found");

    await expect(
      Effect.runPromise(
        extractVisualEvidenceForTranscribedImport({
          bucket: acquisitionBucket(),
          extractor: extractor.service,
          frameSampler: invalidFrames.service,
          importId,
          importRepository,
          now: () => extractedAt,
          visualRepository: makeD1VisualEvidenceRepository(
            testEnv.MealPlannerDatabase
          ),
        })
      )
    ).rejects.toMatchObject({
      _tag: "VisualEvidencePipelineFailure",
      code: "frame_sampling_failed",
    });
    expect(extractor.calls).toEqual([]);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT failure_code, state FROM import_visual_evidence
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(importId, generation)
        .first()
    ).resolves.toEqual({
      failure_code: "frame_sampling_failed",
      state: "failed",
    });
    expect(
      Option.getOrThrow(
        await Effect.runPromise(importRepository.findById(importId))
      ).view
    ).toMatchObject({
      status: {
        code: "visual_evidence_failed",
        kind: "failed",
        recovery: "operator_reconcile",
      },
      updatedAt: extractedAt,
    });

    const replayFrames = makeDeterministicFrameSampler([]);
    const replayExtractor = makeVisualFixture("found");
    await expect(
      Effect.runPromise(
        extractVisualEvidenceForTranscribedImport({
          bucket: acquisitionBucket(),
          extractor: replayExtractor.service,
          frameSampler: replayFrames.service,
          importId,
          importRepository,
          now: () => extractedAt,
          visualRepository: makeD1VisualEvidenceRepository(
            testEnv.MealPlannerDatabase
          ),
        })
      )
    ).rejects.toMatchObject({ _tag: "ImportTransitionRejected" });
    expect(replayFrames.calls).toEqual([]);
    expect(replayExtractor.calls).toEqual([]);
  });

  it("rejects extractor output with an undeclared provider payload", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000218");
    const canonicalId = decodeCanonicalId("7520000000000000218");
    const importRepository = await makeTranscribedImport(importId, canonicalId);
    const calls: unknown[] = [];
    const validEvidence = Schema.decodeUnknownSync(VisualEvidence)({
      cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
      model: "fixture-vision-v1",
      observations: [],
      outcome: "empty",
      provider: "deterministic_fake",
      usage: { inputBytes: 9, inputFrames: 2, modelCalls: 1 },
    });
    const extractor: VisualEvidenceExtractorShape = {
      extract: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return { ...validEvidence, providerBody: "must-not-cross-boundary" };
        }),
    };

    await expect(
      Effect.runPromise(
        extractVisualEvidenceForTranscribedImport({
          bucket: acquisitionBucket(),
          extractor,
          frameSampler: makeFrameFixture().service,
          importId,
          importRepository,
          now: () => extractedAt,
          visualRepository: makeD1VisualEvidenceRepository(
            testEnv.MealPlannerDatabase
          ),
        })
      )
    ).rejects.toMatchObject({
      _tag: "VisualEvidencePipelineFailure",
      code: "visual_extraction_failed",
    });
    expect(calls).toHaveLength(1);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT failure_code, state FROM import_visual_evidence
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(importId, generation)
        .first()
    ).resolves.toEqual({
      failure_code: "visual_extraction_failed",
      state: "failed",
    });
  });

  it.each([
    ["empty", "visual_evidence_empty"],
    ["low_confidence", "visual_evidence_low_confidence"],
  ] as const)(
    "keeps %s evidence explicit in the public lifecycle",
    async (outcome, expectedStatus) => {
      const suffix = outcome === "empty" ? "214" : "215";
      const importId = decodeImportId(
        `018f47ad-91aa-7c35-b6fe-000000000${suffix}`
      );
      const canonicalId = decodeCanonicalId(`7520000000000000${suffix}`);
      const importRepository = await makeTranscribedImport(
        importId,
        canonicalId
      );
      const result = await Effect.runPromise(
        extractVisualEvidenceForTranscribedImport({
          bucket: acquisitionBucket(),
          extractor: makeVisualFixture(outcome).service,
          frameSampler: makeFrameFixture().service,
          importId,
          importRepository,
          now: () => extractedAt,
          visualRepository: makeD1VisualEvidenceRepository(
            testEnv.MealPlannerDatabase
          ),
        })
      );

      expect(result.outcome).toBe(outcome);
      expect(
        Option.getOrThrow(
          await Effect.runPromise(importRepository.findById(importId))
        ).view.status
      ).toEqual({ kind: expectedStatus });
    }
  );
});

describe("provider-free evidence-to-recipe-draft tracer", () => {
  const landVisualEvidence = async (
    importId: ImportId,
    canonicalId: SourceCanonicalId
  ) => {
    const importRepository = await makeTranscribedImport(importId, canonicalId);
    await Effect.runPromise(
      extractVisualEvidenceForTranscribedImport({
        bucket: acquisitionBucket(),
        extractor: makeVisualFixture("found").service,
        frameSampler: makeFrameFixture().service,
        importId,
        importRepository,
        now: () => extractedAt,
        visualRepository: makeD1VisualEvidenceRepository(
          testEnv.MealPlannerDatabase
        ),
      })
    );
    return importRepository;
  };

  it("persists a cited needs-review draft once without retaining raw evidence", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000230");
    const canonicalId = decodeCanonicalId("7520000000000000230");
    const importRepository = await landVisualEvidence(importId, canonicalId);
    const now = decodeTimestamp("2026-07-21T10:03:00.000Z");
    const descriptor = {
      model: "fixture-recipe-v1",
      provider: "deterministic_fake",
      version: "schema-1",
    } as const;
    const extractor = makeDeterministicRecipeExtractor(
      descriptor,
      (input: RecipeEvidenceAssembly) => makeRecipeFixture(input, canonicalId)
    );
    const recipeRepository = makeD1RecipeDraftRepository(
      testEnv.MealPlannerDatabase
    );

    const draft = await Effect.runPromise(
      produceRecipeDraftForImport({
        bucket: acquisitionBucket(),
        extractor: extractor.service,
        importId,
        importRepository,
        now: () => now,
        recipeRepository,
      })
    );

    expect(draft).toMatchObject({
      extractor: descriptor,
      importId,
      lifecycle: "needs_review",
      schemaVersion: 1,
    });
    expect(draft.extraction.unresolvedFields).toContain("ingredient_units");
    expect(extractor.calls).toHaveLength(1);
    expect(extractor.calls[0]?.items.map(({ kind }) => kind)).toEqual([
      "source_url",
      "creator",
      "caption",
      "transcript",
      "visual_observation",
    ]);
    const persisted = await testEnv.MealPlannerDatabase.prepare(
      `SELECT state, draft_json, model_calls, is_current
         FROM import_recipe_extractions WHERE import_id = ?`
    )
      .bind(importId)
      .first<{
        draft_json: string;
        is_current: number;
        model_calls: number;
        state: string;
      }>();
    expect(persisted).toMatchObject({
      is_current: 1,
      model_calls: 1,
      state: "needs_review",
    });
    expect(persisted?.draft_json).not.toMatch(
      /Synthetic fixture caption|Simmer for ten minutes|providerBody|authorization|secret/iu
    );
    expect(
      Option.getOrThrow(
        await Effect.runPromise(importRepository.findById(importId))
      ).view
    ).toMatchObject({
      evidence: [
        {},
        {},
        {},
        {},
        {
          kind: "recipe_draft",
          referenceId: `recipe-drafts/${draft.extractionFingerprint}`,
        },
      ],
      status: { kind: "needs_review" },
      updatedAt: now,
    });

    const replay = makeDeterministicRecipeExtractor(descriptor, {
      malformed: true,
    });
    await expect(
      Effect.runPromise(
        produceRecipeDraftForImport({
          bucket: acquisitionBucket(),
          extractor: replay.service,
          importId,
          importRepository,
          now: () => now,
          recipeRepository,
        })
      )
    ).resolves.toEqual(draft);
    expect(replay.calls).toEqual([]);

    const reviewable = Option.getOrThrow(
      await Effect.runPromise(importRepository.findById(importId))
    );
    await expect(
      Effect.runPromise(
        importRepository.acceptRequest({
          candidate: reviewable,
          idempotencyKeyHash: decodeIdempotencyKeyHash(
            fixtureHash("recipe-review-canonical-duplicate")
          ),
          requestFingerprint: decodeRequestFingerprint(
            fixtureHash("recipe-review-canonical-request")
          ),
          sourceLocatorHash: decodeSourceLocatorHash(
            fixtureHash("recipe-review-canonical-locator")
          ),
        })
      )
    ).resolves.toMatchObject({
      disposition: "canonical_duplicate",
      import: { view: { id: importId, status: { kind: "needs_review" } } },
    });

    const updatedDescriptor = { ...descriptor, version: "schema-2" };
    const updatedExtractor = makeDeterministicRecipeExtractor(
      updatedDescriptor,
      (input: RecipeEvidenceAssembly) => makeRecipeFixture(input, canonicalId)
    );
    const updatedDraft = await Effect.runPromise(
      produceRecipeDraftForImport({
        bucket: acquisitionBucket(),
        extractor: updatedExtractor.service,
        importId,
        importRepository,
        now: () => now,
        recipeRepository,
      })
    );
    expect(updatedExtractor.calls).toHaveLength(1);
    expect(updatedDraft.extractionFingerprint).not.toBe(
      draft.extractionFingerprint
    );

    const historicalReplay = makeDeterministicRecipeExtractor(descriptor, {
      malformed: true,
    });
    await expect(
      Effect.runPromise(
        produceRecipeDraftForImport({
          bucket: acquisitionBucket(),
          extractor: historicalReplay.service,
          importId,
          importRepository,
          now: () => now,
          recipeRepository,
        })
      )
    ).resolves.toEqual(draft);
    expect(historicalReplay.calls).toEqual([]);
    expect(
      Option.getOrThrow(
        await Effect.runPromise(importRepository.findById(importId))
      ).view.evidence.at(-1)
    ).toEqual({
      kind: "recipe_draft",
      referenceId: `recipe-drafts/${updatedDraft.extractionFingerprint}`,
    });
  });

  it("keeps the newer extraction current when an older version completes late", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000236");
    const canonicalId = decodeCanonicalId("7520000000000000236");
    const importRepository = await landVisualEvidence(importId, canonicalId);
    const recipeRepository = makeD1RecipeDraftRepository(
      testEnv.MealPlannerDatabase
    );
    const completedAt = decodeTimestamp("2026-07-21T10:03:00.000Z");
    const evidenceFingerprint = fixtureHash("recipe-overlap-evidence");
    const evidenceHashes = await testEnv.MealPlannerDatabase.prepare(
      `SELECT transcript.transcript_sha256, visual.manifest_sha256
         FROM import_transcriptions AS transcript
         JOIN import_visual_evidence AS visual
           ON visual.import_id = transcript.import_id
          AND visual.acquisition_generation = transcript.acquisition_generation
        WHERE transcript.import_id = ?
          AND transcript.acquisition_generation = ?`
    )
      .bind(importId, generation)
      .first<{
        manifest_sha256: string;
        transcript_sha256: string;
      }>();
    if (evidenceHashes === null) {
      throw new Error("Expected landed transcript and visual evidence");
    }

    const assembly: RecipeEvidenceAssembly = {
      evidenceFingerprint,
      generation,
      importId,
      items: [
        {
          artifactReference: "source",
          evidenceId: "source:url",
          kind: "source_url",
          origin: "observed",
          value: `https://www.tiktok.com/@cook/video/${canonicalId}`,
        },
        {
          artifactReference: "source",
          evidenceId: "source:creator",
          kind: "creator",
          origin: "observed",
          value: "Cook",
        },
        {
          artifactReference: "transcript",
          evidenceId: "transcript:0",
          kind: "transcript",
          origin: "creator_provided",
          value: "Chop onions.",
        },
        {
          artifactReference: "visual",
          evidenceId: "visual:0",
          kind: "visual_observation",
          origin: "observed",
          value: "Bake at 180 C for 20 minutes",
        },
      ],
    };
    const extraction = Schema.decodeUnknownSync(RecipeExtraction)(
      makeRecipeFixture(assembly, canonicalId)
    );
    const fingerprint = (version: "schema-1" | "schema-2") =>
      fixtureHash(`recipe-overlap-${version}`);
    const draft = (version: "schema-1" | "schema-2"): RecipeDraft => ({
      createdAt: completedAt,
      evidenceFingerprint,
      extraction,
      extractionFingerprint: fingerprint(version),
      extractor: makeRecipeExtractorDescriptor(version),
      generation,
      importId,
      lifecycle: "needs_review",
      schemaVersion: 1,
    });
    const claim = (version: "schema-1" | "schema-2") =>
      recipeRepository.claim({
        descriptor: makeRecipeExtractorDescriptor(version),
        evidenceFingerprint,
        extractionFingerprint: fingerprint(version),
        generation,
        importId,
        sourceMediaSha256,
        startedAt: completedAt,
        transcriptSha256: evidenceHashes.transcript_sha256,
        visualManifestSha256: evidenceHashes.manifest_sha256,
      });

    await expect(Effect.runPromise(claim("schema-1"))).resolves.toEqual({
      _tag: "DispatchClaimed",
    });
    await expect(Effect.runPromise(claim("schema-2"))).resolves.toEqual({
      _tag: "DispatchClaimed",
    });
    await expect(
      Effect.runPromise(recipeRepository.complete(draft("schema-2")))
    ).resolves.toMatchObject({ extractor: { version: "schema-2" } });
    await expect(
      Effect.runPromise(recipeRepository.complete(draft("schema-1")))
    ).rejects.toMatchObject({ _tag: "ImportTransitionRejected" });

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT extractor_version, is_current, state
           FROM import_recipe_extractions
          WHERE import_id = ?
          ORDER BY extractor_version`
      )
        .bind(importId)
        .all()
    ).resolves.toMatchObject({
      results: [
        { extractor_version: "schema-1", is_current: 0, state: "needs_review" },
        { extractor_version: "schema-2", is_current: 1, state: "needs_review" },
      ],
    });
    expect(
      Option.getOrThrow(
        await Effect.runPromise(importRepository.findById(importId))
      ).view.evidence.at(-1)
    ).toEqual({
      kind: "recipe_draft",
      referenceId: `recipe-drafts/${fingerprint("schema-2")}`,
    });
  });

  it("classifies malformed extractor output without persisting a draft", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000231");
    const canonicalId = decodeCanonicalId("7520000000000000231");
    const importRepository = await landVisualEvidence(importId, canonicalId);
    const extractor = makeDeterministicRecipeExtractor(
      {
        model: "fixture-recipe-invalid",
        provider: "deterministic_fake",
        version: "schema-1",
      },
      { name: "untrusted and incomplete" }
    );

    await expect(
      Effect.runPromise(
        produceRecipeDraftForImport({
          bucket: acquisitionBucket(),
          extractor: extractor.service,
          importId,
          importRepository,
          now: () => decodeTimestamp("2026-07-21T10:03:00.000Z"),
          recipeRepository: makeD1RecipeDraftRepository(
            testEnv.MealPlannerDatabase
          ),
        })
      )
    ).rejects.toMatchObject({
      _tag: "RecipeDraftPipelineFailure",
      code: "invalid_schema",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, draft_json, failure_code, is_current
           FROM import_recipe_extractions WHERE import_id = ?`
      )
        .bind(importId)
        .first()
    ).resolves.toEqual({
      draft_json: null,
      failure_code: "invalid_schema",
      is_current: 0,
      state: "failed",
    });
    expect(
      Option.getOrThrow(
        await Effect.runPromise(importRepository.findById(importId))
      ).view.status
    ).toEqual({ kind: "visual_evidence_found" });
  });

  it("rejects citations that do not identify landed evidence", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000232");
    const canonicalId = decodeCanonicalId("7520000000000000232");
    const importRepository = await landVisualEvidence(importId, canonicalId);
    const extractor = makeDeterministicRecipeExtractor(
      {
        model: "fixture-recipe-forged-citation",
        provider: "deterministic_fake",
        version: "schema-1",
      },
      (input: RecipeEvidenceAssembly) =>
        makeRecipeFixture(input, canonicalId, {
          citationEvidenceId: "forged:evidence",
        })
    );

    await expect(
      Effect.runPromise(
        produceRecipeDraftForImport({
          bucket: acquisitionBucket(),
          extractor: extractor.service,
          importId,
          importRepository,
          now: () => decodeTimestamp("2026-07-21T10:03:00.000Z"),
          recipeRepository: makeD1RecipeDraftRepository(
            testEnv.MealPlannerDatabase
          ),
        })
      )
    ).rejects.toMatchObject({
      _tag: "RecipeDraftPipelineFailure",
      code: "invalid_schema",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, draft_json, failure_code, is_current
           FROM import_recipe_extractions WHERE import_id = ?`
      )
        .bind(importId)
        .first()
    ).resolves.toEqual({
      draft_json: null,
      failure_code: "invalid_schema",
      is_current: 0,
      state: "failed",
    });
    expect(extractor.calls).toHaveLength(1);
  });

  it("rejects unsupported facts even when they cite real landed evidence", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000233");
    const canonicalId = decodeCanonicalId("7520000000000000233");
    const importRepository = await landVisualEvidence(importId, canonicalId);
    const extractor = makeDeterministicRecipeExtractor(
      {
        model: "fixture-recipe-unsupported-fact",
        provider: "deterministic_fake",
        version: "schema-1",
      },
      (input: RecipeEvidenceAssembly) =>
        makeRecipeFixture(input, canonicalId, {
          ingredientValue: "10 kg plutonium",
        })
    );

    await expect(
      Effect.runPromise(
        produceRecipeDraftForImport({
          bucket: acquisitionBucket(),
          extractor: extractor.service,
          importId,
          importRepository,
          now: () => decodeTimestamp("2026-07-21T10:03:00.000Z"),
          recipeRepository: makeD1RecipeDraftRepository(
            testEnv.MealPlannerDatabase
          ),
        })
      )
    ).rejects.toMatchObject({
      _tag: "RecipeDraftPipelineFailure",
      code: "invalid_schema",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, draft_json, failure_code, is_current
           FROM import_recipe_extractions WHERE import_id = ?`
      )
        .bind(importId)
        .first()
    ).resolves.toEqual({
      draft_json: null,
      failure_code: "invalid_schema",
      is_current: 0,
      state: "failed",
    });
  });

  it("rejects time and temperature values swapped within real cited evidence", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000235");
    const canonicalId = decodeCanonicalId("7520000000000000235");
    const importRepository = await landVisualEvidence(importId, canonicalId);
    const extractor = makeDeterministicRecipeExtractor(
      {
        model: "fixture-recipe-numeric-collision",
        provider: "deterministic_fake",
        version: "schema-1",
      },
      (input: RecipeEvidenceAssembly) => {
        const fixture = makeRecipeFixture(input, canonicalId);
        return {
          ...fixture,
          cookTimeMinutes: { ...fixture.cookTimeMinutes, value: 180 },
          temperatureCelsius: {
            ...fixture.temperatureCelsius,
            value: 20,
          },
        };
      }
    );

    await expect(
      Effect.runPromise(
        produceRecipeDraftForImport({
          bucket: acquisitionBucket(),
          extractor: extractor.service,
          importId,
          importRepository,
          now: () => decodeTimestamp("2026-07-21T10:03:00.000Z"),
          recipeRepository: makeD1RecipeDraftRepository(
            testEnv.MealPlannerDatabase
          ),
        })
      )
    ).rejects.toMatchObject({
      _tag: "RecipeDraftPipelineFailure",
      code: "invalid_schema",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, draft_json, failure_code, is_current
           FROM import_recipe_extractions WHERE import_id = ?`
      )
        .bind(importId)
        .first()
    ).resolves.toEqual({
      draft_json: null,
      failure_code: "invalid_schema",
      is_current: 0,
      state: "failed",
    });
  });

  it("does not project needs-review for a corrupt durable draft", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000234");
    const canonicalId = decodeCanonicalId("7520000000000000234");
    const importRepository = await landVisualEvidence(importId, canonicalId);
    const extractor = makeDeterministicRecipeExtractor(
      {
        model: "fixture-recipe-corrupt-draft",
        provider: "deterministic_fake",
        version: "schema-1",
      },
      (input: RecipeEvidenceAssembly) => makeRecipeFixture(input, canonicalId)
    );
    await Effect.runPromise(
      produceRecipeDraftForImport({
        bucket: acquisitionBucket(),
        extractor: extractor.service,
        importId,
        importRepository,
        now: () => decodeTimestamp("2026-07-21T10:03:00.000Z"),
        recipeRepository: makeD1RecipeDraftRepository(
          testEnv.MealPlannerDatabase
        ),
      })
    );
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_recipe_extractions SET draft_json = '{}'
        WHERE import_id = ? AND is_current = 1`
    )
      .bind(importId)
      .run();

    await expect(
      Effect.runPromise(importRepository.findById(importId))
    ).rejects.toMatchObject({ _tag: "ImportPersistenceCorrupt" });
  });
});
