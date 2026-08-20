import {
  AnswerReviewRecipeActionRequest,
  ConfirmRecipeImportActionRequest,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeImportActionId,
  RecipeImportPrincipal,
  RecipeImportIntentId,
  makeRecipeImportApiClientLayer,
  RecipeImportApiClient,
} from "@meal-planner/recipe-import-api";
import { applyD1Migrations, env } from "cloudflare:test";
import {
  Cause,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Schema,
  Stream,
} from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
} from "effect/unstable/http";
import { beforeAll, describe, expect, it } from "vitest";

import { AuthPrincipalResolutionError } from "../auth/auth.principal.js";
import { HouseholdOrganizationId } from "../households/household.contract.js";
import { makeRecipeImportWorkerHttpLayer } from "./import-intent-api.http.js";
import type { HouseholdRecipeReviewPort } from "./import-intent-review.repository.js";
import { makeImportIntentWorkflowTransitions } from "./import-intent-workflow-transitions.js";
import { ImportPrincipal } from "./import-intent.js";
import { acquireStoreVerify } from "./import-media-acquirer.js";
import type {
  AcquisitionBucketLike,
  AcquisitionMediaObjectLike,
  PreparedMediaArtifact,
  R2ObjectBodyLike,
  R2ObjectLike,
} from "./import-media-acquirer.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import { produceRecipeDraftForImport } from "./import-recipe-draft.js";
import {
  RecipeDraft,
  makeD1RecipeDraftRepository,
} from "./import-recipe-draft.repository.d1.js";
import { makeDeterministicRecipeExtractor } from "./import-recipe-extractor.fake.js";
import type { RecipeEvidenceAssembly } from "./import-recipe-extractor.js";
import {
  RecipeCorrection,
  RecipeReviewTransition,
  RecipeReviewView,
  Review,
  approvalBlockers,
  applyCorrectionOverlay,
  recipeReviewNullablePolicy,
  refineRecipeReview,
} from "./import-recipe-review.js";
import {
  makeDeterministicSpeechAudioExtractor,
  makeDeterministicSpeechTranscriber,
} from "./import-speech-transcription.fake.js";
import { transcribeAcquiredImport } from "./import-speech-transcription.js";
import { makeD1SpeechTranscriptionRepository } from "./import-speech-transcription.repository.d1.js";
import {
  makeDeterministicFrameSampler,
  makeDeterministicVisualEvidenceExtractor,
} from "./import-visual-evidence.fake.js";
import { extractVisualEvidenceForTranscribedImport } from "./import-visual-evidence.js";
import { makeD1VisualEvidenceRepository } from "./import-visual-evidence.repository.d1.js";
import type { makeImportWorkerRequestLayer as MakeImportWorkerRequestLayer } from "./import-worker-request-layer.js";
import {
  workerTestR2PutBody,
  workerTestMigrations,
} from "./import-worker-test-environment.js";
import type {
  ImportWorkerR2TestEnvironment,
  WorkerTestD1Database,
  WorkerTestR2Object,
  WorkerTestR2ObjectBody,
} from "./import-worker-test-environment.js";
import { EvidenceReference, ImportTimestamp } from "./import.contracts.js";
import type { ImportId, SourceCanonicalId } from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import {
  TestImportPrincipal,
  TestImportTrace,
} from "./import.test-fixtures.js";

const testEnv: ImportWorkerR2TestEnvironment = env;

const bearerToken = "http-worker-private-bearer";
const canonicalUrl =
  "https://www.tiktok.com/@fixture/video/7520000000000000901";
const cancellationCanonicalUrl =
  "https://www.tiktok.com/@fixture/video/7520000000000000902";
const cancellationCanonicalSourceId = "7520000000000000902";
const providerFixture = "deterministic_fake";
const recipeModelFixture = "fixture-recipe-v1";
const speechModelFixture = "fixture-speech-v1";
const transcriptFixture = "Chop onions. Simmer for ten minutes.";
const foreignHouseholdScopeId = "9".repeat(64);
const secondBearerToken = "http-worker-second-private-bearer";
const secondActorId = "8".repeat(64);
const instant = "2026-08-16T18:00:00.000Z";
const reviewTags = {
  cuisines: ["Irish"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["dinner"],
  totalTimeBand: "30_to_60_minutes",
} as const;
const privateR2References = (intentId: string) => [
  `imports/${intentId}/acquisition/v1/generations/1/original.mp4`,
  `imports/${intentId}/acquisition/v1/generations/1/manifest.json`,
  `imports/${intentId}/transcription/v1/generations/1/transcript.json`,
];

const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(instant);
const sourceMedia = new Uint8Array([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);
const sourceMediaSha256 =
  "c43403fe022af967a0b859d3e14ea12d6633f4c8ad475816b0c55d85896e8e35";

const testR2Failure = (stage: "store" | "verify") =>
  new RetryableAcquisitionError({ reason: "container_rpc", stage });

const testR2Object = (object: WorkerTestR2Object): R2ObjectLike => {
  let projected: R2ObjectLike = { size: object.size };
  if (object.checksums !== undefined) {
    projected = { ...projected, checksums: object.checksums };
  }
  if (object.customMetadata !== undefined) {
    projected = { ...projected, customMetadata: object.customMetadata };
  }
  if (object.httpMetadata !== undefined) {
    projected = { ...projected, httpMetadata: object.httpMetadata };
  }
  return projected;
};

const testR2ObjectBody = (
  object: WorkerTestR2ObjectBody
): R2ObjectBodyLike => ({
  ...testR2Object(object),
  arrayBuffer: () =>
    Effect.tryPromise({
      catch: () => testR2Failure("verify"),
      try: () => object.arrayBuffer(),
    }),
  text: () =>
    Effect.tryPromise({
      catch: () => testR2Failure("verify"),
      try: () => object.text(),
    }),
});

const acquisitionBucket = (): AcquisitionBucketLike => ({
  get: (key) =>
    Effect.tryPromise({
      catch: () => testR2Failure("verify"),
      try: () => testEnv.ImportEvidenceBucket.get(key),
    }).pipe(
      Effect.map((object) =>
        object === null ? null : testR2ObjectBody(object)
      )
    ),
  head: (key) =>
    Effect.tryPromise({
      catch: () => testR2Failure("verify"),
      try: () => testEnv.ImportEvidenceBucket.head(key),
    }).pipe(
      Effect.map((object) => (object === null ? null : testR2Object(object)))
    ),
  put: (key, value, options) =>
    Effect.gen(function* putTestR2Object() {
      const bytes = yield* workerTestR2PutBody(value, options.contentLength);
      const object = yield* Effect.tryPromise({
        catch: () => testR2Failure("store"),
        try: () => testEnv.ImportEvidenceBucket.put(key, bytes, options),
      });
      return object;
    }).pipe(
      Effect.map((object) => (object === null ? null : testR2Object(object)))
    ),
});

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

const makeVisualFixture = () =>
  makeDeterministicVisualEvidenceExtractor({
    cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
    model: "fixture-vision-v1",
    observations: [
      {
        confidence: 0.98,
        frameIndex: 1,
        kind: "visible_text" as const,
        regions: [{ height: 0.2, width: 0.8, x: 0.1, y: 0.7 }],
        text: "Bake at 180 C for 20 minutes",
        timestampMilliseconds: 1000,
      },
    ],
    outcome: "found",
    provider: providerFixture,
    usage: { inputBytes: 5, inputFrames: 1, modelCalls: 1 },
  });

const unresolvedRecipeFact = (reason: string) => ({
  citations: [],
  origin: "unresolved",
  reason,
  state: "unresolved",
});

const makeRecipeFixture = (
  input: RecipeEvidenceAssembly,
  sourceId: typeof SourceCanonicalId.Type
) => {
  const evidence = (kind: string) => {
    const item = input.items.find((candidate) => candidate.kind === kind);
    if (item === undefined) {
      throw new Error(`Missing ${kind} fixture evidence`);
    }
    return item;
  };
  const supported = (
    value: string | number,
    kind: string,
    origin: "creator_provided" | "observed"
  ) => {
    const item = evidence(kind);
    return {
      citations: [
        { confidence: 0.95, evidenceId: item.evidenceId, origin: item.origin },
      ],
      origin,
      state: "supported",
      value,
    };
  };
  const transcript = supported(
    "Chop onions.",
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
    cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
    cuisine: unresolvedRecipeFact("not stated"),
    description: unresolvedRecipeFact("not stated"),
    ingredientLines: { items: [transcript], state: "supported" },
    instructions: { items: [transcript, visual], state: "supported" },
    name: unresolvedRecipeFact("not stated"),
    nutrition: unresolvedRecipeFact("not stated"),
    prepTimeMinutes: unresolvedRecipeFact("not stated"),
    sourceUrl: supported(
      `https://www.tiktok.com/@fixture/video/${sourceId}`,
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

const makeProviderFreeWorkflowStarter = (input: {
  readonly activeWorkflowIds: Set<string>;
  readonly database: WorkerTestD1Database;
  readonly stages: string[];
  readonly started: string[];
}) => ({
  ensureStarted: (
    importId: typeof ImportId.Type,
    executionGeneration: Parameters<
      typeof makeImportIntentWorkflowTransitions
    >[0]["executionGeneration"]
  ) =>
    Effect.gen(function* runProviderFreeImportLifecycle() {
      if (input.activeWorkflowIds.has(importId)) {
        return "already_active" as const;
      }
      const repository = makeD1ImportRepository(input.database);
      const stored = yield* repository.findById(importId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.die("Provider-free import was not persisted"),
            onSome: Effect.succeed,
          })
        )
      );
      if (stored.view.status.kind !== "queued") {
        return "already_active" as const;
      }
      input.activeWorkflowIds.add(importId);
      input.started.push(importId);
      input.stages.push(`stored:${stored.view.status.kind}`);
      if (stored.canonicalSourceId === cancellationCanonicalSourceId) {
        return "created" as const;
      }

      const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(importId);
      const transitions = makeImportIntentWorkflowTransitions({
        executionGeneration,
        intentId,
        repository,
      });
      const claim = yield* repository.claimAcquisition(importId);
      input.stages.push(`claim:${claim._tag}`);
      if (claim._tag === "Finished") {
        return "already_active" as const;
      }
      const allocation = yield* repository.beginAcquisitionAttempt(importId);
      input.stages.push("allocated");
      const prepared: PreparedMediaArtifact = {
        artifactId: `provider-free-${importId}`,
        audioStreams: [{ codec: "aac", index: 1 }],
        bytes: sourceMedia.byteLength,
        durationSeconds: 2,
        metadata: {
          canonicalId: allocation.canonicalSourceId,
          canonicalUrl: `https://www.tiktok.com/@fixture/video/${allocation.canonicalSourceId}`,
          caption: "Synthetic provider-free fixture caption",
          creator: {
            displayName: "Cook",
            handle: "fixture",
            id: "fixture-id",
          },
          observedAt: instant,
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
        readArtifact: () => Stream.make(sourceMedia),
      };
      const acquisition = yield* acquireStoreVerify(
        acquisitionBucket(),
        mediaObject,
        {
          canonicalId: allocation.canonicalSourceId,
          generation: allocation.generation,
          importId,
        }
      );
      if (acquisition._tag !== "VerifiedAcquisition") {
        return yield* Effect.die("Provider-free acquisition was not verified");
      }
      yield* repository.recordAcquired(
        importId,
        allocation.generation,
        acquisition.evidence,
        acquisition.evidence.acquiredAt
      );
      input.stages.push("acquired");
      yield* transitions.advanceStage("analyzing_evidence");
      yield* transitions.advanceComponent("speech", "processing");

      const audio = makeDeterministicSpeechAudioExtractor({
        bytes: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]),
        durationMilliseconds: 2000,
        mimeType: "audio/wav",
        sha256:
          "c4ffde8d57d64bbc7a1220d8bf9560d208511252d9173d1359f5cf9a7b2f14dc",
      });
      const speech = makeDeterministicSpeechTranscriber({
        cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
        detectedLanguage: "en",
        model: speechModelFixture,
        provider: providerFixture,
        segments: [
          { endMilliseconds: 900, startMilliseconds: 0, text: "Chop onions." },
          {
            endMilliseconds: 1900,
            startMilliseconds: 1000,
            text: "Simmer for ten minutes.",
          },
        ],
        text: transcriptFixture,
        usage: { audioDurationMilliseconds: 2000, inputBytes: 8 },
      });
      yield* transcribeAcquiredImport({
        acquisitionRepository: repository,
        audioExtractor: audio.service,
        bucket: acquisitionBucket(),
        importId,
        now: () => timestamp,
        speechTranscriber: speech.service,
        transcriptionRepository: makeD1SpeechTranscriptionRepository(
          input.database
        ),
      });
      input.stages.push("transcribed");
      yield* transitions.advanceComponent("speech", "completed");
      yield* transitions.advanceComponent("visuals", "processing");
      yield* extractVisualEvidenceForTranscribedImport({
        bucket: acquisitionBucket(),
        extractor: makeVisualFixture().service,
        frameSampler: makeFrameFixture().service,
        importId,
        importRepository: repository,
        now: () => timestamp,
        visualRepository: makeD1VisualEvidenceRepository(input.database),
      });
      input.stages.push("visual");
      yield* transitions.advanceComponent("visuals", "completed");
      yield* transitions.advanceStage("extracting_recipe");
      const recipe = makeDeterministicRecipeExtractor(
        {
          model: recipeModelFixture,
          provider: providerFixture,
          version: "schema-1",
        },
        (evidence: RecipeEvidenceAssembly) =>
          makeRecipeFixture(evidence, allocation.canonicalSourceId)
      );
      yield* produceRecipeDraftForImport({
        bucket: acquisitionBucket(),
        extractor: recipe.service,
        importId,
        importRepository: repository,
        lifecycle: {
          grounding: transitions
            .advanceStage("grounding_recipe")
            .pipe(Effect.orDie),
          preparingReview: transitions
            .advanceStage("preparing_review")
            .pipe(Effect.orDie),
          reviewAvailable: (actionId) =>
            transitions.requireAction(actionId).pipe(Effect.orDie),
        },
        now: () => timestamp,
        recipeRepository: makeD1RecipeDraftRepository(input.database),
      });
      input.stages.push("review");
      return "created" as const;
    }).pipe(Effect.orDie),
});

const householdReviewKey = (organizationId: string, importId: string) =>
  `${organizationId}:${importId}`;

const householdReviewView = (
  current: typeof Review.Type,
  changes: Partial<typeof RecipeReviewView.Type>
) =>
  RecipeReviewView.make({
    corrections: changes.corrections ?? current.corrections,
    draft: current.draft,
    evidence: current.evidence,
    lifecycle: changes.lifecycle ?? current.lifecycle,
    nullablePolicy: current.nullablePolicy,
    tags: changes.tags === undefined ? current.tags : changes.tags,
    transitions: changes.transitions ?? current.transitions,
    unresolvedRequiredFields:
      changes.unresolvedRequiredFields ?? current.unresolvedRequiredFields,
    version: changes.version ?? current.version,
  });

const makeInMemoryHouseholdReviewPort = (): HouseholdRecipeReviewPort => {
  const reviews = new Map<string, typeof Review.Type>();
  const encode = Schema.encodeSync(Review);

  return {
    answerRecipeReview: (input) =>
      Effect.gen(function* answerInMemoryReview() {
        const key = householdReviewKey(input.organizationId, input.importId);
        const current = reviews.get(key);
        if (current === undefined) {
          return yield* Effect.fail({ _tag: "RecipeReviewNotFound" });
        }
        if (
          current._tag !== "NeedsReview" ||
          current.version !== input.expectedVersion
        ) {
          return yield* Effect.fail({ _tag: "RecipeReviewVersionConflict" });
        }
        const nextVersion = current.version + 1;
        const corrected = applyCorrectionOverlay(
          current.draft,
          current.corrections
        );
        const corrections = yield* Effect.all(
          input.answers.map((answer) => {
            if (answer.field === "tags") {
              return Effect.succeed(null);
            }
            if (answer.field !== "name") {
              return Effect.die(
                `Unexpected HTTP fixture field ${answer.field}`
              );
            }
            return Schema.decodeUnknownEffect(RecipeCorrection)({
              actorId: input.actorId,
              after: answer.value,
              before: corrected.name,
              correctedAt: input.answeredAt,
              field: answer.field,
              reason: "Household answered recipe review action",
              version: nextVersion,
            });
          })
        );
        const nextCorrections = [
          ...current.corrections,
          ...corrections.filter((correction) => correction !== null),
        ];
        const tags =
          input.answers.find((answer) => answer.field === "tags")?.value ??
          current.tags;
        const next = Option.getOrThrow(
          refineRecipeReview(
            householdReviewView(current, {
              corrections: nextCorrections,
              tags,
              unresolvedRequiredFields: approvalBlockers(
                current.draft,
                nextCorrections
              ).unresolvedRequiredFields,
              version: nextVersion,
            })
          )
        );
        reviews.set(key, next);
        return encode(next);
      }),
    openRecipeReview: (input) =>
      Effect.gen(function* openInMemoryReview() {
        const draft = yield* Schema.decodeUnknownEffect(RecipeDraft)(
          input.snapshot.draft
        );
        const key = householdReviewKey(input.organizationId, draft.importId);
        const existing = reviews.get(key);
        if (existing !== undefined) {
          if (
            existing.draft.extractionFingerprint !== draft.extractionFingerprint
          ) {
            return yield* Effect.fail({ _tag: "RecipeReviewOpenConflict" });
          }
          return encode(existing);
        }
        const evidence = yield* Effect.all(
          input.snapshot.evidence.map((reference) =>
            Schema.decodeUnknownEffect(EvidenceReference)(reference)
          )
        );
        const review = Option.getOrThrow(
          refineRecipeReview(
            RecipeReviewView.make({
              corrections: [],
              draft,
              evidence,
              lifecycle: "needs_review",
              nullablePolicy: recipeReviewNullablePolicy,
              tags: null,
              transitions: [],
              unresolvedRequiredFields: approvalBlockers(draft, [])
                .unresolvedRequiredFields,
              version: 0,
            })
          )
        );
        reviews.set(key, review);
        return encode(review);
      }),
    readRecipeReview: (input) => {
      const review = reviews.get(
        householdReviewKey(input.organizationId, input.importId)
      );
      return review === undefined
        ? Effect.fail({ _tag: "RecipeReviewNotFound" as const })
        : Effect.succeed(encode(review));
    },
    transitionRecipeReview: (input) =>
      Effect.gen(function* transitionInMemoryReview() {
        const key = householdReviewKey(input.organizationId, input.importId);
        const current = reviews.get(key);
        if (current === undefined) {
          return yield* Effect.fail({ _tag: "RecipeReviewNotFound" });
        }
        if (current.version !== input.expectedVersion) {
          return yield* Effect.fail({ _tag: "RecipeReviewVersionConflict" });
        }
        const nextVersion = current.version + 1;
        const transition = yield* Schema.decodeUnknownEffect(
          RecipeReviewTransition
        )({
          actorId: input.actorId,
          from: current.lifecycle,
          reason: input.reason,
          to: input.to,
          transitionedAt: input.transitionedAt,
          version: nextVersion,
        });
        const refined = refineRecipeReview(
          householdReviewView(current, {
            lifecycle: input.to,
            transitions: [...current.transitions, transition],
            version: nextVersion,
          })
        );
        if (Option.isNone(refined)) {
          return yield* Effect.fail({
            _tag: "RecipeReviewTransitionRejected",
          });
        }
        reviews.set(key, refined.value);
        return encode(refined.value);
      }),
  };
};

const failureValue = <Success, Failure>(
  exit: Exit.Exit<Success, Failure>
): Failure | undefined => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected the request to fail");
  }
  const error = Cause.findErrorOption(exit.cause);
  expect(error._tag).toBe("Some");
  return error._tag === "Some" ? error.value : undefined;
};

const auditConfirmation = (database: WorkerTestD1Database, intentId: string) =>
  database
    .prepare(
      `SELECT
         (SELECT count(*) FROM recipe_import_intent_history WHERE intent_id = ?) AS history,
         (SELECT public_status FROM recipe_imports WHERE id = ?) AS public_status,
         (SELECT public_recipe_id FROM recipe_imports WHERE id = ?) AS recipe_id`
    )
    .bind(intentId, intentId, intentId)
    .first();

const assertNoPrivateTransport = (
  value: Schema.Json,
  additionalSentinels: readonly string[] = []
): void => {
  const sentinels = [
    bearerToken,
    secondBearerToken,
    providerFixture,
    recipeModelFixture,
    speechModelFixture,
    transcriptFixture,
    TestImportPrincipal.actorId,
    TestImportPrincipal.householdScopeId,
    secondActorId,
    foreignHouseholdScopeId,
    ...additionalSentinels,
  ];
  if (Schema.is(Schema.String)(value)) {
    for (const sentinel of sentinels) {
      expect(value).not.toContain(sentinel);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoPrivateTransport(item, additionalSentinels);
    }
    return;
  }
  if (Schema.is(Schema.Record(Schema.String, Schema.Json))(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertNoPrivateTransport(key, additionalSentinels);
      assertNoPrivateTransport(child, additionalSentinels);
    }
  }
};

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    workerTestMigrations(testEnv.TEST_MIGRATIONS),
    "d1_migrations"
  );
});

describe("recipe import intent HTTP API with real D1", () => {
  it("isolates two configured households through one Worker and one D1 database", async () => {
    const { makeImportWorkerRequestLayer } =
      await import("./import-worker-request-layer.js");
    const app: {
      current?: ReturnType<typeof HttpRouter.toWebHandler>;
    } = {};
    const database = testEnv.MealPlannerDatabase;
    const started: string[] = [];
    const workflowStages: string[] = [];
    const activeWorkflowIds = new Set<string>();
    const terminated: string[] = [];
    const firstPrincipal = {
      ...Schema.decodeUnknownSync(RecipeImportPrincipal)(TestImportPrincipal),
      organizationId: Schema.decodeUnknownSync(HouseholdOrganizationId)(
        "http-worker-first-household"
      ),
    };
    const secondPrincipal = {
      ...Schema.decodeUnknownSync(RecipeImportPrincipal)(
        Schema.decodeUnknownSync(ImportPrincipal)({
          actorId: secondActorId,
          householdScopeId: foreignHouseholdScopeId,
        })
      ),
      organizationId: Schema.decodeUnknownSync(HouseholdOrganizationId)(
        "http-worker-second-household"
      ),
    };
    const systemPrincipal = Schema.decodeUnknownSync(ImportPrincipal)({
      actorId: "a".repeat(64),
      householdScopeId: "b".repeat(64),
    });
    const originalFetch = globalThis.fetch;
    let outboundHttpAttempts = 0;
    let requestLayer: ReturnType<typeof MakeImportWorkerRequestLayer>;
    const workflowStarter = makeProviderFreeWorkflowStarter({
      activeWorkflowIds,
      database,
      stages: workflowStages,
      started,
    });
    try {
      globalThis.fetch = (() => {
        outboundHttpAttempts += 1;
        return Promise.reject(
          new Error("Provider-free test denied outbound HTTP")
        );
      }) as typeof globalThis.fetch;
      requestLayer = makeImportWorkerRequestLayer({
        bucket: acquisitionBucket(),
        database,
        householdDomain: makeInMemoryHouseholdReviewPort(),
        importWorkflowStarter: workflowStarter,
        importWorkflowTerminator: {
          terminate: (intentId) =>
            Effect.sync(() => {
              terminated.push(intentId);
            }),
        },
        now: () => instant,
        principalResolver: {
          resolve: (headers) => {
            const token = headers.get("authorization")?.replace("Bearer ", "");
            let principal;
            if (token === bearerToken) {
              principal = firstPrincipal;
            } else if (token === secondBearerToken) {
              principal = secondPrincipal;
            }
            return principal === undefined
              ? Effect.fail(
                  new AuthPrincipalResolutionError({
                    reason: "invalid_session",
                  })
                )
              : Effect.succeed(principal);
          },
        },
        queue: { enqueue: () => Effect.void },
        recipeRecoveryStarter: { start: () => Effect.void },
        runtimeStage: "provider-free-worker-test",
        systemApiToken: Redacted.make("http-worker-system-private-bearer"),
        systemPrincipal,
        trace: TestImportTrace,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(database).toBe(testEnv.MealPlannerDatabase);
    const program = Effect.gen(function* realD1HttpScenario() {
      const mounted = HttpRouter.toWebHandler(
        makeRecipeImportWorkerHttpLayer({ operationalRoutes: [] }).pipe(
          Layer.provide(requestLayer),
          HttpRouter.provideRequest(requestLayer)
        ),
        { disableLogger: true }
      );
      app.current = mounted;
      const makeClientLayer = (token: string) => {
        const webHttpClient = HttpClient.make((request, _url, signal) =>
          HttpClientRequest.toWeb(request, { signal }).pipe(
            Effect.orDie,
            Effect.flatMap((webRequest) => {
              webRequest.headers.set("authorization", `Bearer ${token}`);
              return Effect.promise(() => mounted.handler(webRequest));
            }),
            Effect.map((response) =>
              HttpClientResponse.fromWeb(request, response)
            )
          )
        );
        return makeRecipeImportApiClientLayer({
          baseUrl: "http://meal-planner.test",
        }).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, webHttpClient))
        );
      };
      const firstClientLayer = makeClientLayer(bearerToken);
      const secondClientLayer = makeClientLayer(secondBearerToken);
      const request = Schema.decodeUnknownSync(CreateRecipeImportIntentRequest)(
        {
          source: { kind: "tiktok", url: canonicalUrl },
        }
      );
      const changedRequest = Schema.decodeUnknownSync(
        CreateRecipeImportIntentRequest
      )({
        source: {
          kind: "tiktok",
          url: "https://www.tiktok.com/@fixture/video/7520000000000000999",
        },
      });
      const cancellationRequest = Schema.decodeUnknownSync(
        CreateRecipeImportIntentRequest
      )({
        source: { kind: "tiktok", url: cancellationCanonicalUrl },
      });
      const idempotencyKey = Schema.decodeUnknownSync(IdempotencyKey);

      const results = yield* Effect.gen(function* generatedClientScenario() {
        const client = yield* RecipeImportApiClient;
        const created = yield* client.recipeImportIntents.create({
          headers: {
            "idempotency-key": idempotencyKey("http-worker-admission"),
          },
          payload: request,
        });
        let continued = yield* client.recipeImportIntents.get({
          params: { id: created.body.id },
        });
        for (
          let attempt = 0;
          attempt < 200 && continued.body.status === "processing";
          attempt += 1
        ) {
          yield* Effect.sleep("5 millis");
          continued = yield* client.recipeImportIntents.get({
            params: { id: created.body.id },
          });
        }
        const replayed = yield* client.recipeImportIntents.create({
          headers: {
            "idempotency-key": idempotencyKey("http-worker-admission"),
          },
          payload: request,
        });
        const redirected = yield* client.recipeImportIntents.create({
          headers: {
            "idempotency-key": idempotencyKey(
              "http-worker-same-household-duplicate"
            ),
          },
          payload: request,
        });
        let redirectedIntent = yield* client.recipeImportIntents.get({
          params: { id: redirected.body.id },
        });
        for (
          let attempt = 0;
          attempt < 20 &&
          redirectedIntent.body.status === "processing" &&
          redirectedIntent.body.processing.type === "resolving_source";
          attempt += 1
        ) {
          yield* Effect.sleep("1 millis");
          redirectedIntent = yield* client.recipeImportIntents.get({
            params: { id: redirected.body.id },
          });
        }
        const conflictExit = yield* Effect.exit(
          client.recipeImportIntents.create({
            headers: {
              "idempotency-key": idempotencyKey("http-worker-admission"),
            },
            payload: changedRequest,
          })
        );
        const conflict = failureValue(conflictExit);

        const requiresAction = yield* client.recipeImportIntents.get({
          params: { id: created.body.id },
        });
        if (requiresAction.body.status !== "requires_action") {
          return yield* Effect.die(
            `The provider-free lifecycle did not reach review: ${workflowStages.join("|")}`
          );
        }
        const actionId = Schema.decodeUnknownSync(RecipeImportActionId)(
          requiresAction.body.action.id
        );
        const activeAction = yield* client.recipeImportIntents.getAction({
          params: { actionId, id: created.body.id },
        });
        const answerRequest = Schema.decodeUnknownSync(
          AnswerReviewRecipeActionRequest
        )({
          answers: [
            { field: "name", value: "Tomato and Onion Stew" },
            { field: "tags", value: reviewTags },
          ],
          expectedActionVersion: 1,
        });
        const answered = yield* client.recipeImportIntents.answerAction({
          headers: {
            "idempotency-key": idempotencyKey("http-worker-answer"),
          },
          params: { actionId, id: created.body.id },
          payload: answerRequest,
        });
        const confirmRequest = Schema.decodeUnknownSync(
          ConfirmRecipeImportActionRequest
        )({ expectedActionVersion: 2 });
        const confirmed = yield* client.recipeImportIntents.confirmAction({
          headers: {
            "idempotency-key": idempotencyKey("http-worker-confirm"),
          },
          params: { actionId, id: created.body.id },
          payload: confirmRequest,
        });
        const afterConfirm = yield* Effect.promise(() =>
          auditConfirmation(database, created.body.id)
        );
        const confirmReplay = yield* client.recipeImportIntents.confirmAction({
          headers: {
            "idempotency-key": idempotencyKey("http-worker-confirm"),
          },
          params: { actionId, id: created.body.id },
          payload: confirmRequest,
        });
        const afterReplay = yield* Effect.promise(() =>
          auditConfirmation(database, created.body.id)
        );
        const completedAction = yield* client.recipeImportIntents.getAction({
          params: { actionId, id: created.body.id },
        });
        const recipe = yield* client.recipes.get({
          params: { recipeId: confirmed.result.recipeId },
        });

        return {
          actionId,
          activeAction,
          afterConfirm,
          afterReplay,
          answered,
          completedAction,
          confirmReplay,
          confirmed,
          conflict,
          continued,
          created,
          recipe,
          redirected,
          redirectedIntent,
          replayed,
          requiresAction,
        };
      }).pipe(Effect.provide(firstClientLayer));

      const secondResults = yield* Effect.gen(
        function* secondGeneratedClientScenario() {
          const client = yield* RecipeImportApiClient;
          const created = yield* client.recipeImportIntents.create({
            headers: {
              "idempotency-key": idempotencyKey(
                "http-worker-second-household-admission"
              ),
            },
            payload: request,
          });
          let continued = yield* client.recipeImportIntents.get({
            params: { id: created.body.id },
          });
          for (
            let attempt = 0;
            attempt < 200 && continued.body.status === "processing";
            attempt += 1
          ) {
            yield* Effect.sleep("5 millis");
            continued = yield* client.recipeImportIntents.get({
              params: { id: created.body.id },
            });
          }

          const requiresAction = yield* client.recipeImportIntents.get({
            params: { id: created.body.id },
          });
          if (requiresAction.body.status !== "requires_action") {
            return yield* Effect.die(
              "The second provider-free lifecycle did not reach review"
            );
          }
          const actionId = Schema.decodeUnknownSync(RecipeImportActionId)(
            requiresAction.body.action.id
          );
          const activeAction = yield* client.recipeImportIntents.getAction({
            params: { actionId, id: created.body.id },
          });
          const answered = yield* client.recipeImportIntents.answerAction({
            headers: {
              "idempotency-key": idempotencyKey(
                "http-worker-second-household-answer"
              ),
            },
            params: { actionId, id: created.body.id },
            payload: Schema.decodeUnknownSync(AnswerReviewRecipeActionRequest)({
              answers: [
                { field: "name", value: "Second Household Stew" },
                { field: "tags", value: reviewTags },
              ],
              expectedActionVersion: 1,
            }),
          });
          const confirmRequest = Schema.decodeUnknownSync(
            ConfirmRecipeImportActionRequest
          )({ expectedActionVersion: 2 });
          const confirmed = yield* client.recipeImportIntents.confirmAction({
            headers: {
              "idempotency-key": idempotencyKey(
                "http-worker-second-household-confirm"
              ),
            },
            params: { actionId, id: created.body.id },
            payload: confirmRequest,
          });
          const afterConfirm = yield* Effect.promise(() =>
            auditConfirmation(database, created.body.id)
          );
          const completedAction = yield* client.recipeImportIntents.getAction({
            params: { actionId, id: created.body.id },
          });
          const recipe = yield* client.recipes.get({
            params: { recipeId: confirmed.result.recipeId },
          });
          const timeline = yield* client.recipeImportIntents.timeline({
            params: { id: created.body.id },
          });
          const firstIntentRead = failureValue(
            yield* Effect.exit(
              client.recipeImportIntents.get({
                params: { id: results.created.body.id },
              })
            )
          );
          const firstActionRead = failureValue(
            yield* Effect.exit(
              client.recipeImportIntents.getAction({
                params: {
                  actionId: results.actionId,
                  id: results.created.body.id,
                },
              })
            )
          );
          const firstRecipeRead = failureValue(
            yield* Effect.exit(
              client.recipes.get({
                params: { recipeId: results.confirmed.result.recipeId },
              })
            )
          );
          const firstAnswerMutation = failureValue(
            yield* Effect.exit(
              client.recipeImportIntents.answerAction({
                headers: {
                  "idempotency-key": idempotencyKey(
                    "http-worker-cross-household-answer"
                  ),
                },
                params: {
                  actionId: results.actionId,
                  id: results.created.body.id,
                },
                payload: Schema.decodeUnknownSync(
                  AnswerReviewRecipeActionRequest
                )({
                  answers: [{ field: "name", value: "Hidden mutation" }],
                  expectedActionVersion: 2,
                }),
              })
            )
          );
          const firstConfirmMutation = failureValue(
            yield* Effect.exit(
              client.recipeImportIntents.confirmAction({
                headers: {
                  "idempotency-key": idempotencyKey(
                    "http-worker-cross-household-confirm"
                  ),
                },
                params: {
                  actionId: results.actionId,
                  id: results.created.body.id,
                },
                payload: Schema.decodeUnknownSync(
                  ConfirmRecipeImportActionRequest
                )({ expectedActionVersion: 2 }),
              })
            )
          );
          const firstCancelMutation = failureValue(
            yield* Effect.exit(
              client.recipeImportIntents.cancel({
                headers: {
                  "idempotency-key": idempotencyKey(
                    "http-worker-cross-household-cancel"
                  ),
                },
                params: { id: results.created.body.id },
                payload: {
                  expectedIntentVersion: results.confirmed.intentVersion,
                },
              })
            )
          );
          const cancellationCreated = yield* client.recipeImportIntents.create({
            headers: {
              "idempotency-key": idempotencyKey(
                "http-worker-second-household-cancellation-admission"
              ),
            },
            payload: cancellationRequest,
          });
          const cancellable = yield* client.recipeImportIntents.get({
            params: { id: cancellationCreated.body.id },
          });
          if (cancellable.body.status !== "processing") {
            return yield* Effect.die(
              "The provider-free cancellation fixture must remain mutable"
            );
          }
          const cancelled = yield* client.recipeImportIntents.cancel({
            headers: {
              "idempotency-key": idempotencyKey(
                "http-worker-second-household-cancel"
              ),
            },
            params: { id: cancellable.body.id },
            payload: {
              expectedIntentVersion: cancellable.body.intentVersion,
            },
          });
          const cancellationTimeline =
            yield* client.recipeImportIntents.timeline({
              params: { id: cancellationCreated.body.id },
            });
          const succeededAfterCancellation =
            yield* client.recipeImportIntents.get({
              params: { id: created.body.id },
            });

          return {
            actionId,
            activeAction,
            afterConfirm,
            answered,
            cancellable,
            cancellationCreated,
            cancellationTimeline,
            cancelled,
            completedAction,
            confirmed,
            continued,
            created,
            firstActionRead,
            firstAnswerMutation,
            firstCancelMutation,
            firstConfirmMutation,
            firstIntentRead,
            firstRecipeRead,
            recipe,
            requiresAction,
            succeededAfterCancellation,
            timeline,
          };
        }
      ).pipe(Effect.provide(secondClientLayer));
      const firstHouseholdCancellationRead = yield* Effect.gen(
        function* firstHouseholdCancellationIsolation() {
          const client = yield* RecipeImportApiClient;
          return failureValue(
            yield* Effect.exit(
              client.recipeImportIntents.get({
                params: { id: secondResults.cancellationCreated.body.id },
              })
            )
          );
        }
      ).pipe(Effect.provide(firstClientLayer));

      expect(results.created.body).toMatchObject({ status: "processing" });
      expect(results.created.body).toMatchObject({
        processing: { type: "resolving_source" },
        source: { resolution: "pending" },
      });
      expect(results.continued.body.status).not.toBe("processing");
      expect(results.continued.body).toMatchObject({
        source: { canonicalUrl, resolution: "resolved" },
        status: "requires_action",
      });
      expect(results.created.headers.location).toContain(
        results.created.body.id
      );
      expect(results.replayed).toEqual(results.created);
      expect(results.redirectedIntent.body).toMatchObject({
        redirect: { intentId: results.created.body.id },
        status: "redirected",
      });
      expect(results.redirected.body.id).not.toBe(results.created.body.id);
      expect(results.conflict).toMatchObject({
        code: "idempotency_conflict",
        status: 409,
      });
      expect(results.requiresAction.body).toMatchObject({
        source: { canonicalUrl, resolution: "resolved" },
        status: "requires_action",
      });
      expect(results.activeAction).toMatchObject({
        actionVersion: 1,
        id: results.actionId,
        status: "active",
      });
      expect(results.answered).toMatchObject({
        action: { id: results.actionId },
        status: "requires_action",
      });
      expect(results.confirmed).toMatchObject({
        id: results.created.body.id,
        result: { recipeId: results.created.body.id },
        status: "succeeded",
      });
      expect(results.confirmReplay).toEqual(results.confirmed);
      expect(results.afterReplay).toEqual(results.afterConfirm);
      expect(results.afterConfirm).toEqual({
        history: results.confirmed.intentVersion,
        public_status: "succeeded",
        recipe_id: results.created.body.id,
      });
      expect(results.completedAction).toMatchObject({
        actionVersion: 2,
        completion: { type: "confirmed" },
        id: results.actionId,
        status: "completed",
      });
      expect(results.recipe).toMatchObject({
        id: results.created.body.id,
        recipe: { name: "Tomato and Onion Stew" },
        tags: reviewTags,
      });
      expect(secondResults.created.body.id).not.toBe(results.created.body.id);
      expect(secondResults.created.body).toMatchObject({
        source: { resolution: "pending" },
        status: "processing",
      });
      expect(secondResults.continued.body.status).not.toBe("processing");
      expect(secondResults.continued.body).toMatchObject({
        source: { canonicalUrl, resolution: "resolved" },
        status: "requires_action",
      });
      expect(secondResults.requiresAction.body).toMatchObject({
        source: { canonicalUrl, resolution: "resolved" },
        status: "requires_action",
      });
      expect(secondResults.activeAction).toMatchObject({
        actionVersion: 1,
        id: secondResults.actionId,
        status: "active",
      });
      expect(secondResults.answered).toMatchObject({
        action: { id: secondResults.actionId },
        status: "requires_action",
      });
      expect(secondResults.confirmed).toMatchObject({
        id: secondResults.created.body.id,
        result: { recipeId: secondResults.created.body.id },
        status: "succeeded",
      });
      expect(secondResults.completedAction).toMatchObject({
        completion: { type: "confirmed" },
        id: secondResults.actionId,
        status: "completed",
      });
      expect(secondResults.recipe).toMatchObject({
        id: secondResults.created.body.id,
        recipe: { name: "Second Household Stew" },
        tags: reviewTags,
      });
      expect(secondResults.afterConfirm).toEqual({
        history: secondResults.confirmed.intentVersion,
        public_status: "succeeded",
        recipe_id: secondResults.created.body.id,
      });
      expect(secondResults.timeline.data.at(-1)).toMatchObject({
        recipeId: secondResults.created.body.id,
        type: "intent_succeeded",
      });
      expect(secondResults.firstIntentRead).toMatchObject({
        code: "intent_not_found",
        status: 404,
      });
      expect(secondResults.firstActionRead).toMatchObject({
        code: "action_not_found",
        status: 404,
      });
      expect(secondResults.firstRecipeRead).toMatchObject({
        code: "recipe_not_found",
        status: 404,
      });
      expect(secondResults.firstAnswerMutation).toMatchObject({
        code: "action_not_found",
        status: 404,
      });
      expect(secondResults.firstConfirmMutation).toMatchObject({
        code: "action_not_found",
        status: 404,
      });
      expect(secondResults.firstCancelMutation).toMatchObject({
        code: "intent_not_found",
        status: 404,
      });
      expect(secondResults.cancellable.body).toMatchObject({
        source: { resolution: "pending" },
        status: "processing",
      });
      expect(secondResults.cancelled).toMatchObject({
        id: secondResults.cancellationCreated.body.id,
        status: "cancelled",
      });
      expect(secondResults.cancellationTimeline.data.at(-1)).toMatchObject({
        type: "intent_cancelled",
      });
      expect(secondResults.succeededAfterCancellation.body).toEqual(
        secondResults.confirmed
      );
      expect(firstHouseholdCancellationRead).toMatchObject({
        code: "intent_not_found",
        status: 404,
      });
      const publicPayloads = [
        results.created,
        results.continued,
        results.replayed,
        results.redirected,
        results.redirectedIntent,
        results.conflict,
        results.requiresAction,
        results.activeAction,
        results.answered,
        results.confirmed,
        results.confirmReplay,
        results.completedAction,
        results.recipe,
        secondResults.created,
        secondResults.continued,
        secondResults.requiresAction,
        secondResults.activeAction,
        secondResults.answered,
        secondResults.confirmed,
        secondResults.completedAction,
        secondResults.recipe,
        secondResults.timeline,
        secondResults.firstIntentRead,
        secondResults.firstActionRead,
        secondResults.firstRecipeRead,
        secondResults.firstAnswerMutation,
        secondResults.firstConfirmMutation,
        secondResults.firstCancelMutation,
        secondResults.cancellationCreated,
        secondResults.cancellable,
        secondResults.cancelled,
        secondResults.cancellationTimeline,
        secondResults.succeededAfterCancellation,
        firstHouseholdCancellationRead,
      ];
      const serializedPublicPayloads = JSON.stringify(publicPayloads);
      if (serializedPublicPayloads === undefined) {
        throw new Error("Expected serializable public payloads");
      }
      assertNoPrivateTransport(
        Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
          serializedPublicPayloads
        ),
        [
          ...privateR2References(results.created.body.id),
          ...privateR2References(secondResults.created.body.id),
        ]
      );
      expect(JSON.stringify(publicPayloads)).toContain(canonicalUrl);
      expect(workflowStages.slice(0, 14)).toEqual([
        "stored:queued",
        "claim:Acquiring",
        "allocated",
        "acquired",
        "transcribed",
        "visual",
        "review",
        "stored:queued",
        "claim:Acquiring",
        "allocated",
        "acquired",
        "transcribed",
        "visual",
        "review",
      ]);
      expect(started).toEqual([
        results.created.body.id,
        secondResults.created.body.id,
      ]);
      expect(terminated).toEqual([secondResults.cancellationCreated.body.id]);
    });
    try {
      await Effect.runPromise(program);
    } finally {
      await app.current?.dispose();
    }
    expect(outboundHttpAttempts).toBe(0);
  });
});
