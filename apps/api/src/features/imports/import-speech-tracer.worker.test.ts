import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, DateTime, Effect, Exit, Option, Schema, Stream } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  PilotProviderBudgetRuntime,
  makePilotProviderBudgetRuntime,
  runPilotProviderDispatch,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
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
import type {
  SpeechAudioExtractorShape,
  SpeechTranscriptionFailure,
  SpeechTranscriberShape,
} from "./import-speech-transcriber.js";
import {
  makeDeterministicSpeechAudioExtractor,
  makeDeterministicSpeechTranscriber,
} from "./import-speech-transcription.fake.js";
import {
  transcribeAcquiredImport,
  transcriptObjectKey,
} from "./import-speech-transcription.js";
import { makeD1SpeechTranscriptionRepository } from "./import-speech-transcription.repository.d1.js";
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
const decodeBudgetDispatchId = Schema.decodeUnknownSync(PilotBudgetDispatchId);
const decodeBudgetProviderStageId = Schema.decodeUnknownSync(
  PilotBudgetProviderStageId
);
const decodeBudgetRunId = Schema.decodeUnknownSync(PilotBudgetRunId);
const decodeBudgetTimestamp = Schema.decodeUnknownSync(PilotBudgetTimestamp);
const decodeCompatibilityFingerprint = Schema.decodeUnknownSync(
  CompatibilityFingerprint
);
const decodeIdempotencyKeyHash = Schema.decodeUnknownSync(IdempotencyKeyHash);
const decodeRequestFingerprint = Schema.decodeUnknownSync(RequestFingerprint);
const decodeSourceLocatorHash = Schema.decodeUnknownSync(SourceLocatorHash);

const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000110");
const canonicalId = decodeCanonicalId("7520000000000000110");
const generation = decodeGeneration(1);
const acquiredAt = decodeTimestamp("2026-07-21T10:00:00.000Z");
const transcribedAt = decodeTimestamp("2026-07-21T10:01:00.000Z");
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

const acquisitionBucket = (): AcquisitionBucketLike => ({
  get: (key) => testEnv.ImportEvidenceBucket.get(key),
  head: (key) => testEnv.ImportEvidenceBucket.head(key),
  put: (key, value, options) =>
    testEnv.ImportEvidenceBucket.put(key, value, options),
});

const makeAudioFixture = () =>
  makeDeterministicSpeechAudioExtractor({
    bytes: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]),
    durationMilliseconds: 2000,
    mimeType: "audio/wav",
    sha256: "c4ffde8d57d64bbc7a1220d8bf9560d208511252d9173d1359f5cf9a7b2f14dc",
  });

const makeTranscriptFixture = () =>
  makeDeterministicSpeechTranscriber({
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

const makeBudgetedSpeechFixture = (fixtureImportId: ImportId) => {
  const deterministic = makeTranscriptFixture();
  const repository = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  const reservation = {
    dispatchId: decodeBudgetDispatchId(
      `speech:${fixtureImportId}:${generation}`
    ),
    maximumCostMicroUsd: 50_000,
    providerStageId: decodeBudgetProviderStageId("speech-transcription"),
    runId: decodeBudgetRunId(`run-gaia-195-${fixtureImportId.slice(-6)}`),
    timestamp: decodeBudgetTimestamp("2026-07-28T21:00:00.000Z"),
  };
  const service: SpeechTranscriberShape = {
    transcribe: (request) =>
      runPilotProviderDispatch({
        invoke: deterministic.service.transcribe(request).pipe(
          Effect.map((value) => ({
            cost: {
              _tag: "Known" as const,
              actualCostMicroUsd: 0,
            },
            value,
          }))
        ),
        repository,
        reservation,
      }).pipe(
        Effect.provideService(
          PilotProviderBudgetRuntime,
          makePilotProviderBudgetRuntime("pilot-gaia-118")
        ),
        Effect.flatMap((result) => {
          if (
            result._tag === "Completed" ||
            result._tag === "CompletedUnknownCost"
          ) {
            return Effect.succeed(result.value);
          }
          return Effect.fail({
            _tag: "SpeechTranscriptionFailure",
            code: "outcome_unknown",
          } satisfies SpeechTranscriptionFailure);
        }),
        // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed test adapter channel.
        Effect.mapError((error) =>
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          error._tag === "SpeechTranscriptionFailure"
            ? (error as SpeechTranscriptionFailure)
            : ({
                _tag: "SpeechTranscriptionFailure",
                code: "outcome_unknown",
              } satisfies SpeechTranscriptionFailure)
        )
      ),
  };
  return { calls: deterministic.calls, repository, reservation, service };
};

const seedDispatchingTranscription = (
  repository: ReturnType<typeof makeD1SpeechTranscriptionRepository>,
  fixtureImportId: ImportId
) =>
  repository.claim({
    dispatchId: `speech:${fixtureImportId}:${generation}`,
    generation,
    importId: fixtureImportId,
    sourceMediaSha256,
    startedAt: transcribedAt,
  });

const makeExternalIoTrap = (reason: string) => {
  const calls: string[] = [];
  const audioExtractor: SpeechAudioExtractorShape = {
    extract: () =>
      Effect.sync(() => {
        calls.push("audio");
        throw new Error(`${reason}: audio extraction`);
      }),
  };
  const speechTranscriber: SpeechTranscriberShape = {
    transcribe: () =>
      Effect.sync(() => {
        calls.push("provider");
        throw new Error(`${reason}: provider dispatch`);
      }),
  };
  return { audioExtractor, calls, speechTranscriber };
};

const makeAcquiredImport = async ({
  fixtureCanonicalId = canonicalId,
  fixtureImportId = importId,
}: {
  readonly fixtureCanonicalId?: SourceCanonicalId;
  readonly fixtureImportId?: ImportId;
} = {}) => {
  const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase, () =>
    Date.parse("2026-07-21T09:59:00.000Z")
  );
  const createdAt = decodeTimestamp("2026-07-21T09:58:00.000Z");
  const fixtureIdentity = fixtureImportId.slice(-6);
  const candidate: StoredImport = {
    acquisitionGeneration: decodeGeneration(0),
    canonicalSourceId: fixtureCanonicalId,
    compatibilityFingerprint: decodeCompatibilityFingerprint(
      fixtureHash(`${fixtureIdentity}:speech-tracer-compatibility`)
    ),
    sourceKind: "tiktok",
    view: {
      createdAt,
      evidence: [],
      id: fixtureImportId,
      source: { canonicalId: fixtureCanonicalId, kind: "tiktok" },
      status: { kind: "queued" },
      updatedAt: createdAt,
    },
  };
  const command: AcceptImportCommand = {
    candidate,
    idempotencyKeyHash: decodeIdempotencyKeyHash(
      fixtureHash(`${fixtureIdentity}:speech-tracer-idempotency`)
    ),
    requestFingerprint: decodeRequestFingerprint(
      fixtureHash(`${fixtureIdentity}:speech-tracer-request`)
    ),
    sourceLocatorHash: decodeSourceLocatorHash(
      fixtureHash(`${fixtureIdentity}:speech-tracer-locator`)
    ),
  };
  await Effect.runPromise(repository.acceptRequest(command));
  await Effect.runPromise(repository.claimAcquisition(fixtureImportId));
  await expect(
    Effect.runPromise(repository.beginAcquisitionAttempt(fixtureImportId))
  ).resolves.toEqual({
    canonicalSourceId: fixtureCanonicalId,
    generation,
  });

  const prepared: PreparedMediaArtifact = {
    artifactId: "speech-tracer-source",
    audioStreams: [{ codec: "aac", index: 1 }],
    bytes: sourceMedia.byteLength,
    durationSeconds: 2,
    metadata: {
      canonicalId: fixtureCanonicalId,
      canonicalUrl: `https://www.tiktok.com/@cook/video/${fixtureCanonicalId}`,
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
    readArtifact: () => Stream.make(sourceMedia),
  };
  const outcome = await Effect.runPromise(
    acquireStoreVerify(acquisitionBucket(), mediaObject, {
      canonicalId: fixtureCanonicalId,
      generation,
      importId: fixtureImportId,
      now: () => new Date(DateTime.toEpochMillis(acquiredAt)),
    })
  );
  if (outcome._tag !== "VerifiedAcquisition") {
    throw new Error("Expected deterministic acquired evidence");
  }
  expect(outcome.evidence).toMatchObject({
    acquiredAt,
    generation,
    manifestKey: manifestObjectKey(fixtureImportId, generation),
    mediaKey: mediaObjectKey(fixtureImportId, generation),
    sha256: sourceMediaSha256,
  });
  expect(
    Option.getOrThrow(
      await Effect.runPromise(repository.findById(fixtureImportId))
    )
  ).toMatchObject({
    acquisitionGeneration: generation,
    view: { status: { kind: "acquiring" } },
  });
  await expect(
    Effect.runPromise(
      repository.recordAcquired(
        fixtureImportId,
        generation,
        outcome.evidence,
        outcome.evidence.acquiredAt
      )
    )
  ).resolves.toBe("Recorded");
  return repository;
};

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

describe("provider-free acquired-to-transcript tracer", () => {
  it("publishes timestamped transcript evidence tied to the exact acquired generation", async () => {
    const acquisitionRepository = await makeAcquiredImport();
    const audio = makeAudioFixture();
    const speech = makeTranscriptFixture();
    const durableRepository = makeD1SpeechTranscriptionRepository(
      testEnv.MealPlannerDatabase
    );

    const result = await Effect.runPromise(
      transcribeAcquiredImport({
        acquisitionRepository,
        audioExtractor: audio.service,
        bucket: acquisitionBucket(),
        importId,
        now: () => transcribedAt,
        speechTranscriber: speech.service,
        transcriptionRepository: durableRepository,
      })
    );

    expect(result).toMatchObject({
      _tag: "Transcribed",
      generation,
      importId,
      transcriptKey: transcriptObjectKey(importId, generation),
    });
    expect(audio.calls).toEqual([
      {
        generation,
        importId,
        mediaKey: mediaObjectKey(importId, generation),
        sourceMediaSha256,
      },
    ]);
    expect(speech.calls).toEqual([
      expect.objectContaining({
        audio: expect.objectContaining({ durationMilliseconds: 2000 }),
        dispatchId: `speech:${importId}:${generation}`,
        sourceMediaSha256,
      }),
    ]);

    const stored = Option.getOrThrow(
      await Effect.runPromise(acquisitionRepository.findById(importId))
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
      ],
      status: { kind: "transcribed" },
    });
    const transcriptObject = await testEnv.ImportEvidenceBucket.get(
      transcriptObjectKey(importId, generation)
    );
    expect(transcriptObject).not.toBeNull();
    const transcriptJson = await transcriptObject?.text();
    const transcriptSha256 = transcriptObject?.customMetadata?.["sha256"];
    expect(transcriptSha256).toMatch(/^[a-f\d]{64}$/u);
    expect(transcriptJson).toContain(
      '"sourceMediaSha256":"c43403fe022af967a0b859d3e14ea12d6633f4c8ad475816b0c55d85896e8e35"'
    );
    expect(transcriptJson).toContain('"startMilliseconds":0');
    expect(JSON.stringify(result)).not.toMatch(
      /caption|canonicalUrl|providerBody/iu
    );
    expect(JSON.stringify(stored.view)).not.toMatch(
      /Chop onions|deterministic_fake|fixture-v1|providerBody/iu
    );

    const replayTrap = makeExternalIoTrap("Replay attempted external I/O");
    await expect(
      Effect.runPromise(
        transcribeAcquiredImport({
          acquisitionRepository,
          audioExtractor: replayTrap.audioExtractor,
          bucket: acquisitionBucket(),
          importId,
          now: () => transcribedAt,
          speechTranscriber: replayTrap.speechTranscriber,
          transcriptionRepository: durableRepository,
        })
      )
    ).resolves.toEqual(result);
    expect(replayTrap.calls).toEqual([]);
    const intents = await testEnv.MealPlannerDatabase.prepare(
      `SELECT cost_certainty, dispatch_id, estimated_cost_micro_usd, model,
              provider, source_media_sha256, state, transcript_key,
              transcript_sha256, usage_audio_milliseconds, usage_input_bytes
         FROM import_transcriptions
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(importId, generation)
      .all();
    expect(intents.results).toEqual([
      {
        cost_certainty: "known",
        dispatch_id: `speech:${importId}:${generation}`,
        estimated_cost_micro_usd: 0,
        model: "fixture-v1",
        provider: "deterministic_fake",
        source_media_sha256: sourceMediaSha256,
        state: "transcribed",
        transcript_key: transcriptObjectKey(importId, generation),
        transcript_sha256: transcriptSha256,
        usage_audio_milliseconds: 2000,
        usage_input_bytes: 8,
      },
    ]);
  });

  it("recovers transcript evidence orphaned before the D1 completion CAS without redispatch", async () => {
    const orphanImportId = decodeImportId(
      "018f47ad-91aa-7c35-b6fe-000000000111"
    );
    const orphanCanonicalId = decodeCanonicalId("7520000000000000111");
    const acquisitionRepository = await makeAcquiredImport({
      fixtureCanonicalId: orphanCanonicalId,
      fixtureImportId: orphanImportId,
    });
    const audio = makeAudioFixture();
    const speech = makeTranscriptFixture();
    const durableRepository = makeD1SpeechTranscriptionRepository(
      testEnv.MealPlannerDatabase
    );
    const interruptedRepository = {
      ...durableRepository,
      complete: () => Effect.fail(importPersistenceUnavailable()),
    };

    const interrupted = await Effect.runPromiseExit(
      transcribeAcquiredImport({
        acquisitionRepository,
        audioExtractor: audio.service,
        bucket: acquisitionBucket(),
        importId: orphanImportId,
        now: () => transcribedAt,
        speechTranscriber: speech.service,
        transcriptionRepository: interruptedRepository,
      })
    );
    expect(Exit.isFailure(interrupted)).toBe(true);
    if (Exit.isSuccess(interrupted)) {
      throw new Error("Expected the simulated completion interruption");
    }
    expect(
      Option.getOrThrow(Cause.findErrorOption(interrupted.cause))
    ).toMatchObject({ _tag: "ImportPersistenceUnavailable" });
    expect(speech.calls).toHaveLength(1);
    await expect(
      testEnv.ImportEvidenceBucket.head(
        transcriptObjectKey(orphanImportId, generation)
      )
    ).resolves.not.toBeNull();
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(orphanImportId, generation)
        .first()
    ).resolves.toEqual({ state: "dispatching" });

    const recoveryTrap = makeExternalIoTrap("Recovery attempted external I/O");
    await expect(
      Effect.runPromise(
        transcribeAcquiredImport({
          acquisitionRepository,
          audioExtractor: recoveryTrap.audioExtractor,
          bucket: acquisitionBucket(),
          importId: orphanImportId,
          now: () => transcribedAt,
          speechTranscriber: recoveryTrap.speechTranscriber,
          transcriptionRepository: durableRepository,
        })
      )
    ).resolves.toMatchObject({
      _tag: "Transcribed",
      generation,
      importId: orphanImportId,
    });
    expect(recoveryTrap.calls).toEqual([]);
    expect(
      Option.getOrThrow(
        await Effect.runPromise(acquisitionRepository.findById(orphanImportId))
      ).view
    ).toMatchObject({ status: { kind: "transcribed" } });
  });

  it("recovers a committed transcript after its first verification read fails without redispatch", async () => {
    const interruptedImportId = decodeImportId(
      "018f47ad-91aa-7c35-b6fe-000000000115"
    );
    const acquisitionRepository = await makeAcquiredImport({
      fixtureCanonicalId: decodeCanonicalId("7520000000000000115"),
      fixtureImportId: interruptedImportId,
    });
    const audio = makeAudioFixture();
    const speech = makeTranscriptFixture();
    const durableRepository = makeD1SpeechTranscriptionRepository(
      testEnv.MealPlannerDatabase
    );
    const durableBucket = acquisitionBucket();
    const transcriptKey = transcriptObjectKey(interruptedImportId, generation);
    let transcriptPutCommitted = false;
    let verificationReadsFailed = 0;
    const interruptedBucket: AcquisitionBucketLike = {
      get: (key) => {
        if (
          key === transcriptKey &&
          transcriptPutCommitted &&
          verificationReadsFailed === 0
        ) {
          verificationReadsFailed += 1;
          return Promise.reject(
            new Error("simulated transcript verification read failure")
          );
        }
        return durableBucket.get(key);
      },
      head: (key) => durableBucket.head(key),
      put: async (key, value, options) => {
        const object = await durableBucket.put(key, value, options);
        if (key === transcriptKey) {
          transcriptPutCommitted = true;
        }
        return object;
      },
    };

    const interrupted = await Effect.runPromiseExit(
      transcribeAcquiredImport({
        acquisitionRepository,
        audioExtractor: audio.service,
        bucket: interruptedBucket,
        importId: interruptedImportId,
        now: () => transcribedAt,
        speechTranscriber: speech.service,
        transcriptionRepository: durableRepository,
      })
    );
    expect(Exit.isFailure(interrupted)).toBe(true);
    if (Exit.isSuccess(interrupted)) {
      throw new Error("Expected the simulated transcript verification failure");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(interrupted.cause))).toEqual(
      {
        _tag: "SpeechPipelineFailure",
        code: "transcript_evidence_unknown",
      }
    );
    expect(verificationReadsFailed).toBe(1);
    expect(speech.calls).toHaveLength(1);
    await expect(
      testEnv.ImportEvidenceBucket.head(transcriptKey)
    ).resolves.not.toBeNull();
    expect(
      Option.getOrThrow(
        await Effect.runPromise(
          acquisitionRepository.findById(interruptedImportId)
        )
      ).view.status
    ).toEqual({ kind: "transcribing" });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT failure_code, state FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(interruptedImportId, generation)
        .first()
    ).resolves.toEqual({ failure_code: null, state: "dispatching" });

    const replayTrap = makeExternalIoTrap(
      "Committed transcript replay attempted external I/O"
    );
    await expect(
      Effect.runPromise(
        transcribeAcquiredImport({
          acquisitionRepository,
          audioExtractor: replayTrap.audioExtractor,
          bucket: interruptedBucket,
          importId: interruptedImportId,
          now: () => transcribedAt,
          speechTranscriber: replayTrap.speechTranscriber,
          transcriptionRepository: durableRepository,
        })
      )
    ).resolves.toMatchObject({
      _tag: "Transcribed",
      generation,
      importId: interruptedImportId,
      transcriptKey,
    });
    expect(replayTrap.calls).toEqual([]);
    expect(speech.calls).toHaveLength(1);
  });

  it("leaves an ambiguous provider outcome dispatching for durable budget arbitration", async () => {
    const unknownImportId = decodeImportId(
      "018f47ad-91aa-7c35-b6fe-000000000116"
    );
    const acquisitionRepository = await makeAcquiredImport({
      fixtureCanonicalId: decodeCanonicalId("7520000000000000116"),
      fixtureImportId: unknownImportId,
    });
    const audio = makeAudioFixture();
    const providerCalls: string[] = [];
    const ambiguousProvider: SpeechTranscriberShape = {
      transcribe: (input) =>
        Effect.sync(() => {
          providerCalls.push(input.dispatchId);
        }).pipe(
          Effect.andThen(
            Effect.fail({
              _tag: "SpeechTranscriptionFailure",
              code: "outcome_unknown",
            } satisfies SpeechTranscriptionFailure)
          )
        ),
    };
    const durableRepository = makeD1SpeechTranscriptionRepository(
      testEnv.MealPlannerDatabase
    );

    const firstAttempt = await Effect.runPromiseExit(
      transcribeAcquiredImport({
        acquisitionRepository,
        audioExtractor: audio.service,
        bucket: acquisitionBucket(),
        importId: unknownImportId,
        now: () => transcribedAt,
        speechTranscriber: ambiguousProvider,
        transcriptionRepository: durableRepository,
      })
    );
    expect(Exit.isFailure(firstAttempt)).toBe(true);
    if (Exit.isSuccess(firstAttempt)) {
      throw new Error("Expected the provider outcome to remain unknown");
    }
    expect(
      Option.getOrThrow(Cause.findErrorOption(firstAttempt.cause))
    ).toEqual({
      _tag: "SpeechPipelineFailure",
      code: "outcome_unknown",
    });
    expect(providerCalls).toEqual([`speech:${unknownImportId}:${generation}`]);
    expect(
      Option.getOrThrow(
        await Effect.runPromise(acquisitionRepository.findById(unknownImportId))
      ).view.status
    ).toEqual({ kind: "transcribing" });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT dispatch_id, failure_code, state FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(unknownImportId, generation)
        .first()
    ).resolves.toEqual({
      dispatch_id: `speech:${unknownImportId}:${generation}`,
      failure_code: null,
      state: "dispatching",
    });

    expect(providerCalls).toHaveLength(1);
  });

  it("resumes only budget-safe dispatching transcriptions through the installed fence", async () => {
    const absentImportId = decodeImportId(
      "018f47ad-91aa-7c35-b6fe-000000000119"
    );
    const absentAcquisitionRepository = await makeAcquiredImport({
      fixtureCanonicalId: decodeCanonicalId("7520000000000000119"),
      fixtureImportId: absentImportId,
    });
    const transcriptionRepository = makeD1SpeechTranscriptionRepository(
      testEnv.MealPlannerDatabase
    );
    await expect(
      Effect.runPromise(
        seedDispatchingTranscription(transcriptionRepository, absentImportId)
      )
    ).resolves.toMatchObject({ _tag: "DispatchClaimed" });
    const absentBudget = makeBudgetedSpeechFixture(absentImportId);

    await expect(
      Effect.runPromise(
        transcribeAcquiredImport({
          acquisitionRepository: absentAcquisitionRepository,
          audioExtractor: makeAudioFixture().service,
          bucket: acquisitionBucket(),
          importId: absentImportId,
          now: () => transcribedAt,
          speechTranscriber: absentBudget.service,
          transcriptionRepository,
        })
      )
    ).resolves.toMatchObject({
      _tag: "Transcribed",
      generation,
      importId: absentImportId,
    });
    expect(absentBudget.calls).toHaveLength(1);
    await expect(
      Effect.runPromise(
        absentBudget.repository.readDispatch(absentBudget.reservation)
      )
    ).resolves.toMatchObject({
      actualCostMicroUsd: 0,
      state: "settled_known",
    });

    const reservedImportId = decodeImportId(
      "018f47ad-91aa-7c35-b6fe-000000000120"
    );
    const reservedAcquisitionRepository = await makeAcquiredImport({
      fixtureCanonicalId: decodeCanonicalId("7520000000000000120"),
      fixtureImportId: reservedImportId,
    });
    await Effect.runPromise(
      seedDispatchingTranscription(transcriptionRepository, reservedImportId)
    );
    const reservedBudget = makeBudgetedSpeechFixture(reservedImportId);
    await Effect.runPromise(
      reservedBudget.repository.reserve(reservedBudget.reservation)
    );

    await expect(
      Effect.runPromise(
        transcribeAcquiredImport({
          acquisitionRepository: reservedAcquisitionRepository,
          audioExtractor: makeAudioFixture().service,
          bucket: acquisitionBucket(),
          importId: reservedImportId,
          now: () => transcribedAt,
          speechTranscriber: reservedBudget.service,
          transcriptionRepository,
        })
      )
    ).resolves.toMatchObject({
      _tag: "Transcribed",
      generation,
      importId: reservedImportId,
    });
    expect(reservedBudget.calls).toHaveLength(1);

    const settledImportId = decodeImportId(
      "018f47ad-91aa-7c35-b6fe-000000000121"
    );
    const settledAcquisitionRepository = await makeAcquiredImport({
      fixtureCanonicalId: decodeCanonicalId("7520000000000000121"),
      fixtureImportId: settledImportId,
    });
    await Effect.runPromise(
      seedDispatchingTranscription(transcriptionRepository, settledImportId)
    );
    const settledBudget = makeBudgetedSpeechFixture(settledImportId);
    await Effect.runPromise(
      settledBudget.repository.reserve(settledBudget.reservation)
    );
    await Effect.runPromise(
      settledBudget.repository.beginInvocation(settledBudget.reservation)
    );
    await Effect.runPromise(
      settledBudget.repository.settleKnown({
        ...settledBudget.reservation,
        actualCostMicroUsd: 0,
      })
    );

    const settledReplay = await Effect.runPromiseExit(
      transcribeAcquiredImport({
        acquisitionRepository: settledAcquisitionRepository,
        audioExtractor: makeAudioFixture().service,
        bucket: acquisitionBucket(),
        importId: settledImportId,
        now: () => transcribedAt,
        speechTranscriber: settledBudget.service,
        transcriptionRepository,
      })
    );
    expect(Exit.isFailure(settledReplay)).toBe(true);
    if (Exit.isSuccess(settledReplay)) {
      throw new Error("Expected settled budget evidence to block redispatch");
    }
    expect(
      Option.getOrThrow(Cause.findErrorOption(settledReplay.cause))
    ).toEqual({
      _tag: "SpeechPipelineFailure",
      code: "outcome_unknown",
    });
    expect(settledBudget.calls).toHaveLength(0);

    const invokingImportId = decodeImportId(
      "018f47ad-91aa-7c35-b6fe-000000000122"
    );
    const invokingAcquisitionRepository = await makeAcquiredImport({
      fixtureCanonicalId: decodeCanonicalId("7520000000000000122"),
      fixtureImportId: invokingImportId,
    });
    await Effect.runPromise(
      seedDispatchingTranscription(transcriptionRepository, invokingImportId)
    );
    const invokingBudget = makeBudgetedSpeechFixture(invokingImportId);
    await Effect.runPromise(
      invokingBudget.repository.reserve(invokingBudget.reservation)
    );
    await Effect.runPromise(
      invokingBudget.repository.beginInvocation(invokingBudget.reservation)
    );

    const invokingReplay = await Effect.runPromiseExit(
      transcribeAcquiredImport({
        acquisitionRepository: invokingAcquisitionRepository,
        audioExtractor: makeAudioFixture().service,
        bucket: acquisitionBucket(),
        importId: invokingImportId,
        now: () => transcribedAt,
        speechTranscriber: invokingBudget.service,
        transcriptionRepository,
      })
    );
    expect(Exit.isFailure(invokingReplay)).toBe(true);
    if (Exit.isSuccess(invokingReplay)) {
      throw new Error("Expected invoking budget evidence to block redispatch");
    }
    expect(
      Option.getOrThrow(Cause.findErrorOption(invokingReplay.cause))
    ).toEqual({
      _tag: "SpeechPipelineFailure",
      code: "outcome_unknown",
    });
    expect(invokingBudget.calls).toHaveLength(0);

    await Effect.runPromise(
      invokingBudget.repository.settleUnknown(invokingBudget.reservation)
    );
    const unknownReplay = await Effect.runPromiseExit(
      transcribeAcquiredImport({
        acquisitionRepository: invokingAcquisitionRepository,
        audioExtractor: makeAudioFixture().service,
        bucket: acquisitionBucket(),
        importId: invokingImportId,
        now: () => transcribedAt,
        speechTranscriber: invokingBudget.service,
        transcriptionRepository,
      })
    );
    expect(Exit.isFailure(unknownReplay)).toBe(true);
    if (Exit.isSuccess(unknownReplay)) {
      throw new Error(
        "Expected unknown settled budget evidence to block redispatch"
      );
    }
    expect(
      Option.getOrThrow(Cause.findErrorOption(unknownReplay.cause))
    ).toEqual({
      _tag: "SpeechPipelineFailure",
      code: "outcome_unknown",
    });
    expect(invokingBudget.calls).toHaveLength(0);
  });

  it("terminalizes deterministic transcript evidence that exceeds the storage cap", async () => {
    const oversizedImportId = decodeImportId(
      "018f47ad-91aa-7c35-b6fe-000000000117"
    );
    const acquisitionRepository = await makeAcquiredImport({
      fixtureCanonicalId: decodeCanonicalId("7520000000000000117"),
      fixtureImportId: oversizedImportId,
    });
    const audio = makeAudioFixture();
    const oversizedSegmentText = "x".repeat(16_384);
    const oversizedSpeech = makeDeterministicSpeechTranscriber({
      cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
      detectedLanguage: "en",
      model: "fixture-v1",
      provider: "deterministic_fake",
      segments: [
        {
          endMilliseconds: 1,
          startMilliseconds: 0,
          text: oversizedSegmentText,
        },
        ...Array.from({ length: 127 }, (_, offset) => ({
          endMilliseconds: offset + 2,
          startMilliseconds: offset + 1,
          text: oversizedSegmentText,
        })),
      ],
      text: "x".repeat(1_048_576),
      usage: { audioDurationMilliseconds: 2000, inputBytes: 8 },
    });
    const durableRepository = makeD1SpeechTranscriptionRepository(
      testEnv.MealPlannerDatabase
    );

    const failed = await Effect.runPromiseExit(
      transcribeAcquiredImport({
        acquisitionRepository,
        audioExtractor: audio.service,
        bucket: acquisitionBucket(),
        importId: oversizedImportId,
        now: () => transcribedAt,
        speechTranscriber: oversizedSpeech.service,
        transcriptionRepository: durableRepository,
      })
    );
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isSuccess(failed)) {
      throw new Error("Expected oversized transcript evidence rejection");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(failed.cause))).toEqual({
      _tag: "SpeechPipelineFailure",
      code: "transcript_evidence_failed",
    });
    expect(oversizedSpeech.calls).toHaveLength(1);
    expect(
      Option.getOrThrow(
        await Effect.runPromise(
          acquisitionRepository.findById(oversizedImportId)
        )
      ).view.status
    ).toEqual({
      code: "transcription_failed",
      kind: "failed",
      recovery: "retry_later",
    });
    await expect(
      testEnv.ImportEvidenceBucket.head(
        transcriptObjectKey(oversizedImportId, generation)
      )
    ).resolves.toBeNull();
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT failure_code, state FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(oversizedImportId, generation)
        .first()
    ).resolves.toEqual({
      failure_code: "transcript_evidence_failed",
      state: "failed",
    });

    const replayTrap = makeExternalIoTrap(
      "Oversized transcript replay attempted external I/O"
    );
    const replay = await Effect.runPromiseExit(
      transcribeAcquiredImport({
        acquisitionRepository,
        audioExtractor: replayTrap.audioExtractor,
        bucket: acquisitionBucket(),
        importId: oversizedImportId,
        now: () => transcribedAt,
        speechTranscriber: replayTrap.speechTranscriber,
        transcriptionRepository: durableRepository,
      })
    );
    expect(Exit.isFailure(replay)).toBe(true);
    expect(replayTrap.calls).toEqual([]);
    expect(oversizedSpeech.calls).toHaveLength(1);
  });

  it("records a safe terminal failure and refuses a second dispatch intent", async () => {
    const failedImportId = decodeImportId(
      "018f47ad-91aa-7c35-b6fe-000000000112"
    );
    const acquisitionRepository = await makeAcquiredImport({
      fixtureCanonicalId: decodeCanonicalId("7520000000000000112"),
      fixtureImportId: failedImportId,
    });
    const audio = makeAudioFixture();
    const providerCalls: string[] = [];
    const failingProvider: SpeechTranscriberShape = {
      transcribe: (input) =>
        Effect.sync(() => {
          providerCalls.push(input.dispatchId);
        }).pipe(
          Effect.andThen(
            Effect.fail({
              _tag: "SpeechTranscriptionFailure",
              code: "transcription_failed",
            } satisfies SpeechTranscriptionFailure)
          )
        ),
    };
    const durableRepository = makeD1SpeechTranscriptionRepository(
      testEnv.MealPlannerDatabase
    );

    const failed = await Effect.runPromiseExit(
      transcribeAcquiredImport({
        acquisitionRepository,
        audioExtractor: audio.service,
        bucket: acquisitionBucket(),
        importId: failedImportId,
        now: () => transcribedAt,
        speechTranscriber: failingProvider,
        transcriptionRepository: durableRepository,
      })
    );
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isSuccess(failed)) {
      throw new Error("Expected the deterministic provider failure");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(failed.cause))).toEqual({
      _tag: "SpeechPipelineFailure",
      code: "transcription_failed",
    });
    expect(providerCalls).toEqual([`speech:${failedImportId}:${generation}`]);
    expect(
      Option.getOrThrow(
        await Effect.runPromise(acquisitionRepository.findById(failedImportId))
      ).view
    ).toMatchObject({
      evidence: [{ kind: "original_media" }, { kind: "acquisition_manifest" }],
      status: {
        code: "transcription_failed",
        kind: "failed",
        recovery: "retry_later",
      },
    });
    await expect(
      testEnv.ImportEvidenceBucket.head(
        transcriptObjectKey(failedImportId, generation)
      )
    ).resolves.toBeNull();

    const replayTrap = makeExternalIoTrap(
      "Failed replay attempted external I/O"
    );
    const replay = await Effect.runPromiseExit(
      transcribeAcquiredImport({
        acquisitionRepository,
        audioExtractor: replayTrap.audioExtractor,
        bucket: acquisitionBucket(),
        importId: failedImportId,
        now: () => transcribedAt,
        speechTranscriber: replayTrap.speechTranscriber,
        transcriptionRepository: durableRepository,
      })
    );
    expect(Exit.isFailure(replay)).toBe(true);
    expect(replayTrap.calls).toEqual([]);
    const ledger = await testEnv.MealPlannerDatabase.prepare(
      `SELECT dispatch_id, failure_code, state FROM import_transcriptions
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(failedImportId, generation)
      .all();
    expect(ledger.results).toEqual([
      {
        dispatch_id: `speech:${failedImportId}:${generation}`,
        failure_code: "transcription_failed",
        state: "failed",
      },
    ]);
  });

  it("rejects corrupt acquired evidence before audio or provider I/O", async () => {
    const corruptImportId = decodeImportId(
      "018f47ad-91aa-7c35-b6fe-000000000113"
    );
    const acquisitionRepository = await makeAcquiredImport({
      fixtureCanonicalId: decodeCanonicalId("7520000000000000113"),
      fixtureImportId: corruptImportId,
    });
    await testEnv.ImportEvidenceBucket.put(
      manifestObjectKey(corruptImportId, generation),
      new TextEncoder().encode('{"schemaVersion":1,"corrupt":true}')
    );
    const corruptEvidenceTrap = makeExternalIoTrap(
      "Corrupt evidence reached external I/O"
    );

    const exit = await Effect.runPromiseExit(
      transcribeAcquiredImport({
        acquisitionRepository,
        audioExtractor: corruptEvidenceTrap.audioExtractor,
        bucket: acquisitionBucket(),
        importId: corruptImportId,
        now: () => transcribedAt,
        speechTranscriber: corruptEvidenceTrap.speechTranscriber,
        transcriptionRepository: makeD1SpeechTranscriptionRepository(
          testEnv.MealPlannerDatabase
        ),
      })
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected corrupt acquired evidence rejection");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual({
      _tag: "SpeechPipelineFailure",
      code: "source_evidence_invalid",
    });
    expect(corruptEvidenceTrap.calls).toEqual([]);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "SELECT COUNT(*) AS count FROM import_transcriptions WHERE import_id = ?"
      )
        .bind(corruptImportId)
        .first()
    ).resolves.toEqual({ count: 0 });
    expect(
      Option.getOrThrow(
        await Effect.runPromise(acquisitionRepository.findById(corruptImportId))
      ).view.status
    ).toEqual({ kind: "acquired" });
  });
});
