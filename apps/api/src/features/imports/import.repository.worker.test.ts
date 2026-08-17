import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, Effect, Exit, Option, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import {
  AcquisitionGeneration,
  VerifiedAcquisitionEvidence,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import { ImportTraceContext } from "./import-observability.js";
import { makeD1SpeechTranscriptionRepository } from "./import-speech-transcription.repository.d1.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import {
  admitResolvedTestImport,
  seedResolvedTestImportExecution,
} from "./import.test-fixtures.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    name: string;
    queries: string[];
  }[];
};

const decodeId = Schema.decodeUnknownSync(ImportId);
const decodeTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const decodeCanonicalId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodeGeneration = Schema.decodeUnknownSync(AcquisitionGeneration);
const decodeAcquisitionEvidence = Schema.decodeUnknownSync(
  VerifiedAcquisitionEvidence
);
const fixtureHash = (value: string) =>
  Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  )
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);
const trace = Schema.decodeUnknownSync(ImportTraceContext)({
  correlationId: "10000000-0000-4000-8000-000000000001",
});

const expectCorrupt = async <A>(effect: Effect.Effect<A, unknown>) => {
  const exit = await Effect.runPromiseExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected persistence corruption");
  }
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
    _tag: "ImportPersistenceCorrupt",
  });
};

interface CurrentImportSeed {
  readonly candidate: {
    readonly canonicalSourceId: SourceCanonicalId;
    readonly view: { readonly id: ImportId };
  };
  readonly trace: ImportTraceContext;
}

const makeCommand = (
  options: {
    readonly canonicalId?: string;
    readonly id?: string;
    readonly key?: string;
    readonly trace?: ImportTraceContext;
  } = {}
): CurrentImportSeed => {
  const canonicalSourceId = decodeCanonicalId(
    options.canonicalId ?? "7520000000000000000"
  );
  return {
    candidate: {
      canonicalSourceId,
      view: {
        id: decodeId(options.id ?? "018f47ad-91aa-7c35-b6fe-000000000001"),
      },
    },
    trace: options.trace ?? trace,
  };
};

const admitCommand = (
  repository: ReturnType<typeof makeD1ImportRepository>,
  command: CurrentImportSeed
) =>
  admitResolvedTestImport({
    canonicalId: command.candidate.canonicalSourceId,
    importId: command.candidate.view.id,
    repository,
    sourceKind: "video",
    trace: command.trace,
  });

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

const failCurrentTranscription = async (
  repository: ReturnType<typeof makeD1ImportRepository>,
  command: CurrentImportSeed,
  failureCode:
    | "audio_extraction_failed"
    | "outcome_unknown"
    | "source_evidence_invalid"
    | "transcription_failed"
    | "transcript_evidence_failed"
) => {
  await Effect.runPromise(admitCommand(repository, command));
  await Effect.runPromise(
    repository.claimAcquisition(command.candidate.view.id)
  );
  const { generation } = await Effect.runPromise(
    repository.beginAcquisitionAttempt(command.candidate.view.id)
  );
  const acquiredAt = decodeTimestamp("2026-07-20T10:05:00.000Z");
  const sourceMediaSha256 = fixtureHash(`media-${command.candidate.view.id}`);
  const evidence = decodeAcquisitionEvidence({
    acquiredAt: Schema.encodeUnknownSync(ImportTimestamp)(acquiredAt),
    audioStreams: [{ codec: "aac", index: 1 }],
    bytes: 1024,
    deleteAt: "2026-07-27T10:05:00.000Z",
    durationSeconds: 1,
    generation,
    manifestKey: manifestObjectKey(command.candidate.view.id, generation),
    mediaKey: mediaObjectKey(command.candidate.view.id, generation),
    sha256: sourceMediaSha256,
    videoStreams: [{ codec: "h264", index: 0 }],
  });
  await Effect.runPromise(
    repository.recordAcquired(
      command.candidate.view.id,
      generation,
      evidence,
      evidence.acquiredAt
    )
  );
  const transcriptionRepository = makeD1SpeechTranscriptionRepository(
    testEnv.MealPlannerDatabase
  );
  const dispatchId = `speech:${command.candidate.view.id}:${generation}`;
  const startedAt = decodeTimestamp("2026-07-20T10:06:00.000Z");
  await Effect.runPromise(
    transcriptionRepository.claim({
      dispatchId,
      generation,
      importId: command.candidate.view.id,
      sourceMediaSha256,
      startedAt,
    })
  );
  await Effect.runPromise(
    transcriptionRepository.fail({
      completedAt: decodeTimestamp("2026-07-20T10:07:00.000Z"),
      dispatchId,
      failureCode,
      generation,
      importId: command.candidate.view.id,
      sourceMediaSha256,
    })
  );
  return generation;
};

describe("D1 import repository in workerd", () => {
  it("fails a malformed persisted trace as ImportPersistenceCorrupt", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const command = makeCommand({
      canonicalId: "7520000000000000294",
      id: "018f47ad-91aa-7c35-b6fe-000000000294",
      key: "trace-malformed",
    });
    await Effect.runPromise(admitCommand(repository, command));
    await testEnv.MealPlannerDatabase.prepare(
      "UPDATE recipe_imports SET correlation_id = ? WHERE id = ?"
    )
      .bind("not-a-correlation-id", command.candidate.view.id)
      .run();

    await expectCorrupt(repository.findById(command.candidate.view.id));
  });

  it("rolls back a speech child transition when its public parent cannot advance", async () => {
    const parentId = "018f47ad-91aa-7c35-b6fe-000000000115";
    const timestamp = "2026-07-21T10:00:00.000Z";
    const evidence = [
      {
        kind: "original_media",
        referenceId: `imports/${parentId}/acquisition/v1/generations/1/original.mp4`,
      },
      {
        kind: "acquisition_manifest",
        referenceId: `imports/${parentId}/acquisition/v1/generations/1/manifest.json`,
      },
    ] as const;
    await seedResolvedTestImportExecution({
      acquisitionGeneration: decodeGeneration(1),
      canonicalId: decodeCanonicalId("7520000000000000115"),
      database: testEnv.MealPlannerDatabase,
      evidence,
      importId: decodeId(parentId),
      status: { kind: "acquired" },
      updatedAt: decodeTimestamp(timestamp),
    });
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_transcriptions (
        import_id, acquisition_generation, dispatch_id,
        source_media_sha256, state, created_at, updated_at
      ) VALUES (?, 1, ?, ?, 'dispatching', ?, ?)`
    )
      .bind(
        parentId,
        `speech:${parentId}:1`,
        "b".repeat(64),
        timestamp,
        timestamp
      )
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      "UPDATE recipe_imports SET status = 'acquired' WHERE id = ?"
    )
      .bind(parentId)
      .run();

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE import_transcriptions
            SET state = 'failed', failure_code = 'transcription_failed',
                completed_at = ?, updated_at = ?
          WHERE import_id = ? AND acquisition_generation = 1`
      )
        .bind(timestamp, timestamp, parentId)
        .run()
    ).rejects.toThrow("speech failure parent transition rejected");
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "SELECT state, failure_code FROM import_transcriptions WHERE import_id = ?"
      )
        .bind(parentId)
        .first()
    ).resolves.toEqual({ failure_code: null, state: "dispatching" });
    await testEnv.MealPlannerDatabase.prepare(
      "DELETE FROM import_transcriptions WHERE import_id = ?"
    )
      .bind(parentId)
      .run();
  });

  it("allocates a fresh persisted generation for every actual attempt", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const command = makeCommand({
      canonicalId: "7580000000000000000",
      id: "018f47ad-91aa-7c35-b6fe-000000000091",
      key: "generation-allocation",
    });
    await Effect.runPromise(admitCommand(repository, command));
    const claimed = await Effect.runPromise(
      repository.claimAcquisition(command.candidate.view.id)
    );
    const first = await Effect.runPromise(
      repository.beginAcquisitionAttempt(command.candidate.view.id)
    );
    const second = await Effect.runPromise(
      repository.beginAcquisitionAttempt(command.candidate.view.id)
    );
    const persisted = Option.getOrThrow(
      await Effect.runPromise(repository.findById(command.candidate.view.id))
    );

    expect(claimed.import.acquisitionGeneration).toBe(0);
    expect(first).toEqual({
      canonicalSourceId: command.candidate.canonicalSourceId,
      generation: 1,
    });
    expect(second).toEqual({
      canonicalSourceId: command.candidate.canonicalSourceId,
      generation: 2,
    });
    expect(persisted.acquisitionGeneration).toBe(2);
  });

  it("restarts acquisition with one fresh generation only after current audio extraction failure", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase, () =>
      Date.parse("2026-07-20T10:08:00.000Z")
    );
    const command = makeCommand({
      canonicalId: "7580000000000000177",
      id: "018f47ad-91aa-7c35-b6fe-000000000177",
      key: "audio-extraction-recovery",
    });
    const failedGeneration = await failCurrentTranscription(
      repository,
      command,
      "audio_extraction_failed"
    );
    const unrelatedCommand = makeCommand({
      canonicalId: "7580000000000000178",
      id: "018f47ad-91aa-7c35-b6fe-000000000178",
      key: "unrelated-transcription-failure",
    });
    const unrelatedGeneration = await failCurrentTranscription(
      repository,
      unrelatedCommand,
      "transcription_failed"
    );
    const retryMarker = await testEnv.MealPlannerDatabase.prepare(
      `SELECT state, failure_code, provider, model,
              estimated_cost_micro_usd, usage_audio_milliseconds,
              usage_input_bytes
         FROM import_transcriptions
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(command.candidate.view.id, failedGeneration)
      .first<{
        readonly estimated_cost_micro_usd: number | null;
        readonly failure_code: string;
        readonly model: string | null;
        readonly provider: string | null;
        readonly state: string;
        readonly usage_audio_milliseconds: number | null;
        readonly usage_input_bytes: number | null;
      }>();

    await expect(
      Effect.runPromise(
        repository.isAudioExtractionRecoveryEligible(command.candidate.view.id)
      )
    ).resolves.toBe(true);
    const claimed = await Effect.runPromise(
      repository.claimAcquisition(command.candidate.view.id)
    );
    const consumedFailure = await testEnv.MealPlannerDatabase.prepare(
      `SELECT COUNT(*) AS count
           FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(command.candidate.view.id, failedGeneration)
      .first<{ readonly count: number }>();
    const allocated = await Effect.runPromise(
      repository.beginAcquisitionAttempt(command.candidate.view.id)
    );
    const unrelatedFailure = await testEnv.MealPlannerDatabase.prepare(
      `SELECT state, failure_code
         FROM import_transcriptions
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(unrelatedCommand.candidate.view.id, unrelatedGeneration)
      .first<{
        readonly failure_code: string;
        readonly state: string;
      }>();
    const foreignKeyViolations = await testEnv.MealPlannerDatabase.prepare(
      "PRAGMA foreign_key_check"
    ).all();

    expect(retryMarker).toEqual({
      estimated_cost_micro_usd: null,
      failure_code: "audio_extraction_failed",
      model: null,
      provider: null,
      state: "failed",
      usage_audio_milliseconds: null,
      usage_input_bytes: null,
    });
    expect(claimed._tag).toBe("Acquiring");
    expect(claimed.import.acquisitionGeneration).toBe(failedGeneration);
    expect(consumedFailure?.count).toBe(0);
    expect(allocated.generation).toBe(failedGeneration + 1);
    expect(unrelatedFailure).toEqual({
      failure_code: "transcription_failed",
      state: "failed",
    });
    expect(foreignKeyViolations.results).toEqual([]);
    await expect(
      Effect.runPromise(
        repository.isAudioExtractionRecoveryEligible(command.candidate.view.id)
      )
    ).resolves.toBe(false);
  });

  it.each([
    "outcome_unknown",
    "source_evidence_invalid",
    "transcription_failed",
    "transcript_evidence_failed",
  ] as const)(
    "does not restart acquisition after current %s transcription failure",
    async (failureCode) => {
      const suffix = failureCode.length;
      const repository = makeD1ImportRepository(
        testEnv.MealPlannerDatabase,
        () => Date.parse("2026-07-20T10:08:00.000Z")
      );
      const command = makeCommand({
        canonicalId: `7580000000000001${String(suffix).padStart(2, "0")}`,
        id: `018f47ad-91aa-7c35-b6fe-${String(400 + suffix).padStart(12, "0")}`,
        key: `blocked-${failureCode}`,
      });
      const failedGeneration = await failCurrentTranscription(
        repository,
        command,
        failureCode
      );

      await expect(
        Effect.runPromise(
          repository.isAudioExtractionRecoveryEligible(
            command.candidate.view.id
          )
        )
      ).resolves.toBe(false);
      const claimed = await Effect.runPromise(
        repository.claimAcquisition(command.candidate.view.id)
      );
      const retainedFailure = await testEnv.MealPlannerDatabase.prepare(
        `SELECT state, failure_code
             FROM import_transcriptions
            WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(command.candidate.view.id, failedGeneration)
        .first<{
          readonly failure_code: string;
          readonly state: string;
        }>();
      const stored = Option.getOrThrow(
        await Effect.runPromise(repository.findById(command.candidate.view.id))
      );

      expect(claimed._tag).toBe("Finished");
      expect(retainedFailure).toEqual({
        failure_code: failureCode,
        state: "failed",
      });
      expect(stored.acquisitionGeneration).toBe(failedGeneration);
      expect(stored.view.status).toEqual({
        code: "transcription_failed",
        kind: "failed",
        recovery: "retry_later",
      });
    }
  );

  it("guards queued -> acquiring -> acquired and makes identical replay idempotent", async () => {
    let currentTime = Date.parse("2026-07-20T10:04:00.000Z");
    const repository = makeD1ImportRepository(
      testEnv.MealPlannerDatabase,
      () => currentTime
    );
    const command = makeCommand({
      canonicalId: "7590000000000000000",
      id: "018f47ad-91aa-7c35-b6fe-000000000101",
      key: "acquisition-lifecycle",
    });
    await Effect.runPromise(admitCommand(repository, command));

    const claimed = await Effect.runPromise(
      repository.claimAcquisition(command.candidate.view.id)
    );
    currentTime = Date.parse("2026-07-20T10:08:00.000Z");
    const claimedAgain = await Effect.runPromise(
      repository.claimAcquisition(command.candidate.view.id)
    );

    expect(claimed._tag).toBe("Acquiring");
    expect(claimed.import.view.status).toEqual({ kind: "acquiring" });
    expect(claimedAgain._tag).toBe("Acquiring");
    expect(claimed.import.view.updatedAt.toString()).toContain(
      "2026-07-20T10:04:00"
    );
    expect(claimedAgain.import.view.updatedAt).toEqual(
      claimed.import.view.updatedAt
    );

    const { generation } = await Effect.runPromise(
      repository.beginAcquisitionAttempt(command.candidate.view.id)
    );
    const acquiredAt = decodeTimestamp("2026-07-20T10:05:00.000Z");
    const evidence = decodeAcquisitionEvidence({
      acquiredAt: Schema.encodeUnknownSync(ImportTimestamp)(acquiredAt),
      audioStreams: [{ codec: "aac", index: 1 }],
      bytes: 1024,
      deleteAt: "2026-07-27T10:05:00.000Z",
      durationSeconds: 1,
      generation,
      manifestKey: manifestObjectKey(command.candidate.view.id, generation),
      mediaKey: mediaObjectKey(command.candidate.view.id, generation),
      sha256: fixtureHash("media"),
      videoStreams: [{ codec: "h264", index: 0 }],
    });
    await expect(
      Effect.runPromise(
        repository.recordAcquired(
          command.candidate.view.id,
          generation,
          evidence,
          evidence.acquiredAt
        )
      )
    ).resolves.toBe("Recorded");
    await expect(
      Effect.runPromise(
        repository.recordAcquired(
          command.candidate.view.id,
          generation,
          evidence,
          evidence.acquiredAt
        )
      )
    ).resolves.toBe("Recorded");
    const stored = Option.getOrThrow(
      await Effect.runPromise(repository.findById(command.candidate.view.id))
    );

    expect(stored.view.status).toEqual({ kind: "acquired" });
    expect(stored.view.evidence).toEqual([
      { kind: "original_media", referenceId: evidence.mediaKey },
      { kind: "acquisition_manifest", referenceId: evidence.manifestKey },
    ]);
  });

  it("supersedes all three stale generations after an emulator-only fourth execution", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase, () =>
      Date.parse("2026-07-20T10:04:00.000Z")
    );
    const command = makeCommand({
      canonicalId: "7590000000000000099",
      id: "018f47ad-91aa-7c35-b6fe-000000000199",
      key: "generation-finalization-fence",
    });
    await Effect.runPromise(admitCommand(repository, command));
    await Effect.runPromise(
      repository.claimAcquisition(command.candidate.view.id)
    );
    const [first, second, third, currentAllocation] = await Effect.runPromise(
      Effect.all(
        [
          repository.beginAcquisitionAttempt(command.candidate.view.id),
          repository.beginAcquisitionAttempt(command.candidate.view.id),
          repository.beginAcquisitionAttempt(command.candidate.view.id),
          repository.beginAcquisitionAttempt(command.candidate.view.id),
        ] as const,
        { concurrency: 1 }
      )
    );
    const staleGenerations = [
      first.generation,
      second.generation,
      third.generation,
    ];
    const stale = first.generation;
    const current = currentAllocation.generation;
    const acquiredAt = decodeTimestamp("2026-07-20T10:05:00.000Z");
    await Promise.all(
      staleGenerations.map((generation) => {
        const staleEvidence = decodeAcquisitionEvidence({
          acquiredAt: Schema.encodeUnknownSync(ImportTimestamp)(acquiredAt),
          audioStreams: [{ codec: "aac", index: 1 }],
          bytes: 1024,
          deleteAt: "2026-07-27T10:05:00.000Z",
          durationSeconds: 1,
          generation,
          manifestKey: manifestObjectKey(command.candidate.view.id, generation),
          mediaKey: mediaObjectKey(command.candidate.view.id, generation),
          sha256: fixtureHash(`stale-media-${generation}`),
          videoStreams: [{ codec: "h264", index: 0 }],
        });
        return expect(
          Effect.runPromise(
            repository.recordAcquired(
              command.candidate.view.id,
              generation,
              staleEvidence,
              staleEvidence.acquiredAt
            )
          )
        ).resolves.toBe("Superseded");
      })
    );

    expect(staleGenerations).toEqual([
      decodeGeneration(1),
      decodeGeneration(2),
      decodeGeneration(3),
    ]);
    expect(current).toBe(decodeGeneration(4));

    const staleFailures = [
      {
        _tag: "RetryExhausted",
        attempts: 3,
        generation: stale,
        stage: "store",
      },
      {
        _tag: "Unavailable",
        code: "private_or_unavailable",
        generation: stale,
      },
      {
        _tag: "TerminalMedia",
        code: "invalid_media",
        generation: stale,
        stage: "validation",
      },
      {
        _tag: "UnsupportedCarousel",
        code: "unsupported_carousel",
        generation: stale,
      },
    ] as const;
    await Promise.all(
      staleFailures.map((failure) =>
        expect(
          Effect.runPromise(
            repository.recordAcquisitionFailure(
              command.candidate.view.id,
              stale,
              failure,
              decodeTimestamp("2026-07-20T10:06:00.000Z")
            )
          )
        ).resolves.toBe("Superseded")
      )
    );

    const future = decodeGeneration(current + 1);
    await expect(
      Effect.runPromise(
        repository.recordAcquisitionFailure(
          command.candidate.view.id,
          future,
          {
            _tag: "RetryExhausted",
            attempts: 3,
            generation: future,
            stage: "store",
          },
          decodeTimestamp("2026-07-20T10:07:00.000Z")
        )
      )
    ).rejects.toMatchObject({ _tag: "ImportTransitionRejected" });

    const firstFailedAt = decodeTimestamp("2026-07-20T10:08:00.000Z");
    const currentFailure = {
      _tag: "RetryExhausted",
      attempts: 3,
      generation: current,
      stage: "store",
    } as const;
    await expect(
      Effect.runPromise(
        repository.recordAcquisitionFailure(
          command.candidate.view.id,
          current,
          currentFailure,
          firstFailedAt
        )
      )
    ).resolves.toBe("Recorded");
    await expect(
      Effect.runPromise(
        repository.recordAcquisitionFailure(
          command.candidate.view.id,
          current,
          currentFailure,
          decodeTimestamp("2026-07-20T10:09:00.000Z")
        )
      )
    ).resolves.toBe("Recorded");
    const persisted = await testEnv.MealPlannerDatabase.prepare(
      "SELECT acquisition_generation, updated_at FROM recipe_imports WHERE id = ?"
    )
      .bind(command.candidate.view.id)
      .first<{ acquisition_generation: number; updated_at: string }>();

    expect(persisted).toEqual({
      acquisition_generation: current,
      updated_at: "2026-07-20T10:08:00.000Z",
    });
  });

  it("refuses an acquired transition after the verified evidence deadline", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase, () =>
      Date.parse("2026-07-28T10:05:00.000Z")
    );
    const command = makeCommand({
      canonicalId: "7590000000000000001",
      id: "018f47ad-91aa-7c35-b6fe-000000000102",
      key: "expired-acquisition-evidence",
    });
    await Effect.runPromise(admitCommand(repository, command));
    await Effect.runPromise(
      repository.claimAcquisition(command.candidate.view.id)
    );
    const { generation } = await Effect.runPromise(
      repository.beginAcquisitionAttempt(command.candidate.view.id)
    );
    const acquiredAt = decodeTimestamp("2026-07-20T10:05:00.000Z");

    await expect(
      Effect.runPromise(
        repository.recordAcquired(
          command.candidate.view.id,
          generation,
          decodeAcquisitionEvidence({
            acquiredAt: Schema.encodeUnknownSync(ImportTimestamp)(acquiredAt),
            audioStreams: [{ codec: "aac", index: 1 }],
            bytes: 1024,
            deleteAt: "2026-07-27T10:05:00.000Z",
            durationSeconds: 1,
            generation,
            manifestKey: manifestObjectKey(
              command.candidate.view.id,
              generation
            ),
            mediaKey: mediaObjectKey(command.candidate.view.id, generation),
            sha256: fixtureHash("expired-media"),
            videoStreams: [{ codec: "h264", index: 0 }],
          }),
          acquiredAt
        )
      )
    ).rejects.toMatchObject({ _tag: "ImportTransitionRejected" });
  });

  it.each([
    [
      {
        _tag: "RetryExhausted",
        attempts: 3,
        generation: decodeGeneration(1),
        stage: "store",
      },
      {
        code: "acquisition_temporarily_unavailable",
        kind: "failed",
        recovery: "retry_later",
      },
    ],
    [
      {
        _tag: "Unavailable",
        code: "private_or_unavailable",
        generation: decodeGeneration(1),
      },
      {
        code: "private_or_unavailable",
        kind: "failed",
        recovery: "check_source_visibility",
      },
    ],
    [
      {
        _tag: "TerminalMedia",
        code: "invalid_media",
        generation: decodeGeneration(1),
        stage: "validation",
      },
      {
        code: "invalid_or_unsupported_media",
        kind: "failed",
        recovery: "submit_supported_public_video",
      },
    ],
    [
      {
        _tag: "UnsupportedCarousel",
        code: "unsupported_carousel",
        generation: decodeGeneration(1),
      },
      {
        code: "unsupported_post_type",
        kind: "unsupported",
        recovery: "submit_supported_public_video",
      },
    ],
  ] as const)(
    "records classified acquisition failure %#",
    async (outcome, expected) => {
      const index =
        outcome._tag.length + ("code" in outcome ? outcome.code.length : 0);
      const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
      const command = makeCommand({
        canonicalId: `7560000000000000${String(index).padStart(3, "0")}`,
        id: `018f47ad-91aa-7c35-b6fe-${String(200 + index).padStart(12, "0")}`,
        key: `classified-${outcome._tag}`,
      });
      await Effect.runPromise(admitCommand(repository, command));
      await Effect.runPromise(
        repository.claimAcquisition(command.candidate.view.id)
      );
      const { generation } = await Effect.runPromise(
        repository.beginAcquisitionAttempt(command.candidate.view.id)
      );

      await Effect.runPromise(
        repository.recordAcquisitionFailure(
          command.candidate.view.id,
          generation,
          outcome,
          decodeTimestamp("2026-07-20T10:06:00.000Z")
        )
      );
      const stored = Option.getOrThrow(
        await Effect.runPromise(repository.findById(command.candidate.view.id))
      );

      expect(stored.view.status).toEqual(expected);
      expect(stored.view.evidence).toEqual([]);
    }
  );

  it("rejects stale acquisition commits and permits temporary-failure reclaim", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const command = makeCommand({
      canonicalId: "7570000000000000000",
      id: "018f47ad-91aa-7c35-b6fe-000000000301",
      key: "stale-transition",
    });
    await Effect.runPromise(admitCommand(repository, command));
    const failedAt = decodeTimestamp("2026-07-20T10:07:00.000Z");

    await expect(
      Effect.runPromise(
        repository.recordAcquisitionFailure(
          command.candidate.view.id,
          decodeGeneration(1),
          {
            _tag: "RetryExhausted",
            attempts: 3,
            generation: decodeGeneration(1),
            stage: "process",
          },
          failedAt
        )
      )
    ).rejects.toMatchObject({ _tag: "ImportTransitionRejected" });

    await Effect.runPromise(
      repository.claimAcquisition(command.candidate.view.id)
    );
    const { generation } = await Effect.runPromise(
      repository.beginAcquisitionAttempt(command.candidate.view.id)
    );
    await Effect.runPromise(
      repository.recordAcquisitionFailure(
        command.candidate.view.id,
        generation,
        {
          _tag: "RetryExhausted",
          attempts: 3,
          generation,
          stage: "process",
        },
        failedAt
      )
    );
    const reclaimed = await Effect.runPromise(
      repository.claimAcquisition(command.candidate.view.id)
    );
    expect(reclaimed._tag).toBe("Acquiring");
    expect(reclaimed.import.view.status).toEqual({ kind: "acquiring" });
  });
});
