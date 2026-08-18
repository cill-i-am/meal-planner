import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
/**
 * Local-only browser acceptance host for the recipe-import Worker application.
 *
 * This entrypoint deliberately uses deterministic adapters, loopback HTTP, and
 * temporary Miniflare D1/R2 bindings. It must never be deployed or supplied
 * real provider credentials.
 */
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
// oxlint-disable-next-line unicorn/import-style -- API tsconfig disallows synthetic default imports.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import {
  RecipeImportIntentId,
  RecipeImportPrincipal,
} from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Option, Redacted, Schema, Stream } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { Miniflare } from "miniflare";

import { AuthPrincipalResolutionError } from "../auth/auth.principal.js";
import { makeRecipeImportWorkerHttpLayer } from "./import-intent-api.http.js";
import { makeImportIntentWorkflowTransitions } from "./import-intent-workflow-transitions.js";
import { ImportPrincipal } from "./import-intent.js";
import { acquireStoreVerify } from "./import-media-acquirer.js";
import type {
  AcquisitionBucketLike,
  AcquisitionMediaObjectLike,
  PreparedMediaArtifact,
} from "./import-media-acquirer.js";
import { produceRecipeDraftForImport } from "./import-recipe-draft.js";
import { makeD1RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
import { makeDeterministicRecipeExtractor } from "./import-recipe-extractor.fake.js";
import type { RecipeEvidenceAssembly } from "./import-recipe-extractor.js";
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
import { makeImportWorkerRequestLayer } from "./import-worker-request-layer.js";
import { ImportTimestamp } from "./import.contracts.js";
import type { ImportId, SourceCanonicalId } from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import {
  TestImportPrincipal,
  TestImportTrace,
} from "./import.test-fixtures.js";

interface LocalR2Object {
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

interface LocalR2Bucket {
  readonly get: (key: string) => Promise<LocalR2Object | null>;
  readonly head: (key: string) => Promise<LocalR2Object | null>;
  readonly put: (
    key: string,
    value: ArrayBufferView | ReadableStream,
    options?: unknown
  ) => Promise<LocalR2Object | null>;
}

interface LocalBindings {
  readonly ImportEvidenceBucket: LocalR2Bucket;
  readonly MealPlannerDatabase: AnyD1Database;
}

type LocalFixedLengthStreamConstructor = new (length: number) => {
  readonly readable: ReadableStream;
  readonly writable: WritableStream<Uint8Array>;
};

const makeLocalFixedLengthStream = (): LocalFixedLengthStreamConstructor =>
  class LocalFixedLengthStream {
    readonly readable: ReadableStream;
    readonly writable: WritableStream<Uint8Array>;

    constructor(length: number) {
      let bytes = 0;
      const stream = new TransformStream<Uint8Array, Uint8Array>({
        flush: () => {
          if (bytes !== length) {
            throw new Error("Local fixed-length stream size mismatch");
          }
        },
        transform: (chunk, controller) => {
          bytes += chunk.byteLength;
          if (bytes > length) {
            throw new Error("Local fixed-length stream overflow");
          }
          controller.enqueue(chunk);
        },
      });
      this.readable = stream.readable;
      this.writable = stream.writable;
    }
  };

const host = "127.0.0.1";
const port = 4311;
const bearerTokenA = "browser-acceptance-household-a-private";
const bearerTokenB = "browser-acceptance-household-b-private";
const systemBearerToken = "browser-acceptance-system-private";
const actorIdB = "8".repeat(64);
const householdScopeIdB = "9".repeat(64);
const canonicalUrl =
  "https://www.tiktok.com/@fixture/video/7520000000000000901";
const cancellationCanonicalSourceId = "7520000000000000902";
const providerFixture = "deterministic_fake";
const recipeModelFixture = "fixture-recipe-v1";
const speechModelFixture = "fixture-speech-v1";
const instant = "2026-08-16T18:00:00.000Z";
const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(instant);
const sourceMedia = new Uint8Array([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);
const sourceMediaSha256 =
  "c43403fe022af967a0b859d3e14ea12d6633f4c8ad475816b0c55d85896e8e35";

const acquisitionBucket = (bucket: LocalR2Bucket): AcquisitionBucketLike => ({
  get: (key) => bucket.get(key),
  head: (key) => bucket.head(key),
  put: async (key, value, options) =>
    bucket.put(
      key,
      value instanceof ReadableStream
        ? new Uint8Array(await new Response(value).arrayBuffer())
        : value,
      options
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
  readonly bucket: LocalR2Bucket;
  readonly database: AnyD1Database;
  readonly stages: string[];
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
      const bucket = acquisitionBucket(input.bucket);
      const acquisition = yield* acquireStoreVerify(bucket, mediaObject, {
        canonicalId: allocation.canonicalSourceId,
        generation: allocation.generation,
        importId,
      });
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
        text: "Chop onions. Simmer for ten minutes.",
        usage: { audioDurationMilliseconds: 2000, inputBytes: 8 },
      });
      yield* transcribeAcquiredImport({
        acquisitionRepository: repository,
        audioExtractor: audio.service,
        bucket,
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
        bucket,
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
        bucket,
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

const applyProductionMigrations = async (database: AnyD1Database) => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("../../../migrations", import.meta.url))
  );
  for (const migration of migrations) {
    // oxlint-disable-next-line no-await-in-loop -- D1 migrations are ordered.
    await database.batch(
      migration.queries.map((query) => database.prepare(query))
    );
  }
};

const requestBody = async (request: IncomingMessage) => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return chunks.length === 0
    ? undefined
    : new Uint8Array(Buffer.concat(chunks));
};

const requestHeaders = (request: IncomingMessage) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
};

const sendResponse = async (
  response: Response,
  nodeResponse: ServerResponse
) => {
  nodeResponse.statusCode = response.status;
  for (const [name, value] of response.headers) {
    nodeResponse.setHeader(name, value);
  }
  nodeResponse.end(new Uint8Array(await response.arrayBuffer()));
};

const listen = async (server: Server) => {
  server.listen(port, host);
  await once(server, "listening");
};

const close = async (server: Server | undefined) => {
  if (server?.listening === true) {
    await server[Symbol.asyncDispose]();
  }
};

const main = async () => {
  const persistenceRoot = await mkdtemp(
    join(tmpdir(), "meal-planner-browser-acceptance-")
  );
  const originalFetch = globalThis.fetch;
  const hostGlobal = globalThis as unknown as {
    FixedLengthStream?: LocalFixedLengthStreamConstructor;
  };
  const originalFixedLengthStream = hostGlobal.FixedLengthStream;
  let outboundHttpAttempts = 0;
  let server: Server | undefined;
  let mounted: ReturnType<typeof HttpRouter.toWebHandler> | undefined;
  let miniflare: Miniflare | undefined;
  const stages: string[] = [];
  const terminated: string[] = [];
  const shutdown = new EventTarget();
  const requestShutdown = () => {
    shutdown.dispatchEvent(new Event("requested"));
  };

  try {
    globalThis.fetch = (() => {
      outboundHttpAttempts += 1;
      return Promise.reject(
        new Error("Provider-free browser harness denied outbound HTTP")
      );
    }) as typeof globalThis.fetch;
    hostGlobal.FixedLengthStream = makeLocalFixedLengthStream();

    miniflare = new Miniflare({
      compatibilityDate: "2026-07-14",
      d1Databases: ["MealPlannerDatabase"],
      d1Persist: join(persistenceRoot, "d1"),
      modules: true,
      r2Buckets: ["ImportEvidenceBucket"],
      r2Persist: join(persistenceRoot, "r2"),
      script:
        'export default { fetch() { return new Response("local binding host"); } };',
    });
    const bindings = await miniflare.getBindings<LocalBindings>();
    const database = bindings.MealPlannerDatabase;
    const bucket = bindings.ImportEvidenceBucket;
    await applyProductionMigrations(database);

    const principalB = Schema.decodeUnknownSync(ImportPrincipal)({
      actorId: actorIdB,
      householdScopeId: householdScopeIdB,
    });
    const systemPrincipal = Schema.decodeUnknownSync(ImportPrincipal)({
      actorId: "a".repeat(64),
      householdScopeId: "b".repeat(64),
    });
    const requestLayer = makeImportWorkerRequestLayer({
      bucket: acquisitionBucket(bucket),
      database,
      importWorkflowStarter: makeProviderFreeWorkflowStarter({
        activeWorkflowIds: new Set(),
        bucket,
        database,
        stages,
      }),
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
          if (token === bearerTokenA) {
            principal = TestImportPrincipal;
          } else if (token === bearerTokenB) {
            principal = principalB;
          }
          return principal === undefined
            ? Effect.fail(
                new AuthPrincipalResolutionError({
                  reason: "invalid_session",
                })
              )
            : Effect.succeed(
                Schema.decodeUnknownSync(RecipeImportPrincipal)(principal)
              );
        },
      },
      queue: { enqueue: () => Effect.void },
      recipeRecoveryStarter: { start: () => Effect.void },
      runtimeStage: "provider-free-browser-acceptance",
      systemApiToken: Redacted.make(systemBearerToken),
      systemPrincipal,
      trace: TestImportTrace,
    });
    const localMounted = HttpRouter.toWebHandler(
      makeRecipeImportWorkerHttpLayer({ operationalRoutes: [] }).pipe(
        Layer.provide(requestLayer),
        HttpRouter.provideRequest(requestLayer)
      ),
      { disableLogger: true }
    );
    mounted = localMounted;

    const handleRequest = async (
      nodeRequest: IncomingMessage,
      nodeResponse: ServerResponse
    ) => {
      try {
        const method = nodeRequest.method ?? "GET";
        const requestUrl = new URL(
          nodeRequest.url ?? "/",
          `http://${host}:${port}`
        );
        if (
          method === "POST" &&
          requestUrl.pathname === "/__browser-acceptance/shutdown"
        ) {
          nodeResponse.statusCode = 204;
          nodeResponse.end();
          queueMicrotask(requestShutdown);
          return;
        }
        const body =
          method === "GET" || method === "HEAD"
            ? undefined
            : await requestBody(nodeRequest);
        const webRequest = new Request(requestUrl, {
          ...(body === undefined ? {} : { body }),
          headers: requestHeaders(nodeRequest),
          method,
        });
        const response = await localMounted.handler(webRequest);
        console.log(
          `[recipe-import-api] ${method} ${requestUrl.pathname} ${response.status}`
        );
        await sendResponse(response, nodeResponse);
      } catch (error) {
        console.error(
          "[recipe-import-api] request failed",
          error instanceof Error ? error.name : "UnknownFailure"
        );
        if (!nodeResponse.headersSent) {
          nodeResponse.statusCode = 500;
        }
        nodeResponse.end();
      }
    };
    server = createServer((nodeRequest, nodeResponse) => {
      void handleRequest(nodeRequest, nodeResponse);
    });
    await listen(server);
    console.log(
      `[browser-acceptance] API ready at http://${host}:${port}; profiles=2; databaseBindings=1; r2Bindings=1; canonicalFixture=${canonicalUrl}; cancellationFixture=https://www.tiktok.com/@fixture/video/${cancellationCanonicalSourceId}`
    );
    process.once("SIGINT", requestShutdown);
    process.once("SIGTERM", requestShutdown);
    await once(shutdown, "requested");
  } finally {
    process.off("SIGINT", requestShutdown);
    process.off("SIGTERM", requestShutdown);
    await close(server);
    await mounted?.dispose();
    await miniflare?.dispose();
    globalThis.fetch = originalFetch;
    if (originalFixedLengthStream === undefined) {
      delete hostGlobal.FixedLengthStream;
    } else {
      hostGlobal.FixedLengthStream = originalFixedLengthStream;
    }
    await rm(persistenceRoot, { force: true, recursive: true });
    console.log(
      `[browser-acceptance] stopped; outboundHttpAttempts=${outboundHttpAttempts}; lifecycleStages=${stages.join(",")}; terminated=${terminated.length}`
    );
  }
};

try {
  await main();
} catch (error) {
  console.error(
    "[browser-acceptance] startup failed",
    error instanceof Error ? error.name : "UnknownFailure"
  );
  process.exitCode = 1;
}
