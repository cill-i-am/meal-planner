import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, Effect, Exit, Option, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import {
  AcquisitionGeneration,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import type { AcceptImportCommand, StoredImport } from "./import.repository.js";
import {
  CompatibilityFingerprint,
  IdempotencyKeyHash,
  RequestFingerprint,
  SourceLocatorHash,
} from "./import.repository.js";

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
const fixtureHash = (value: string) =>
  Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  )
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);
const decodeCompatibilityFingerprint = Schema.decodeUnknownSync(
  CompatibilityFingerprint
);
const decodeIdempotencyKeyHash = Schema.decodeUnknownSync(IdempotencyKeyHash);
const decodeRequestFingerprint = Schema.decodeUnknownSync(RequestFingerprint);
const decodeSourceLocatorHash = Schema.decodeUnknownSync(SourceLocatorHash);

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

const makeCommand = ({
  canonicalId = "7520000000000000000",
  compatibilityFingerprint = "compat-v1",
  id = "018f47ad-91aa-7c35-b6fe-000000000001",
  key = "key-1",
  requestFingerprint = "request-1",
}: {
  readonly canonicalId?: string;
  readonly compatibilityFingerprint?: string;
  readonly id?: string;
  readonly key?: string;
  readonly requestFingerprint?: string;
} = {}): AcceptImportCommand => {
  const timestamp = decodeTimestamp("2026-07-20T10:00:00.000Z");
  const candidate: StoredImport = {
    acquisitionGeneration: decodeGeneration(0),
    canonicalSourceId: decodeCanonicalId(canonicalId),
    compatibilityFingerprint: decodeCompatibilityFingerprint(
      fixtureHash(compatibilityFingerprint)
    ),
    sourceKind: "tiktok",
    view: {
      createdAt: timestamp,
      evidence: [],
      id: decodeId(id),
      source: { canonicalId: decodeCanonicalId(canonicalId), kind: "tiktok" },
      status: { kind: "queued" },
      updatedAt: timestamp,
    },
  };

  return {
    candidate,
    idempotencyKeyHash: decodeIdempotencyKeyHash(fixtureHash(key)),
    requestFingerprint: decodeRequestFingerprint(
      fixtureHash(requestFingerprint)
    ),
    sourceLocatorHash: decodeSourceLocatorHash(
      fixtureHash(`locator-${canonicalId}`)
    ),
  };
};

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

describe("D1 import repository in workerd", () => {
  it("applies the versioned two-table migration", async () => {
    const tables = await testEnv.MealPlannerDatabase.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).all<{ name: string }>();

    expect(tables.results.map((row: { name: string }) => row.name)).toEqual(
      expect.arrayContaining([
        "d1_migrations",
        "import_requests",
        "recipe_imports",
      ])
    );

    const insertValidImport = testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_imports (
        id, source_kind, canonical_source_id, compatibility_fingerprint,
        status, status_code, recovery_action, evidence_references_json,
        created_at, updated_at
      ) VALUES (?, 'tiktok', ?, 'constraint-probe', 'queued', NULL, NULL, '[]', ?, ?)`
    );
    const timestamp = "2026-07-20T10:00:00.000Z";
    await insertValidImport
      .bind("constraint-probe", "7500000000000000000", timestamp, timestamp)
      .run();
    const generationDefault = await testEnv.MealPlannerDatabase.prepare(
      "SELECT acquisition_generation FROM recipe_imports WHERE id = ?"
    )
      .bind("constraint-probe")
      .first<{ acquisition_generation: number }>();
    expect(generationDefault?.acquisition_generation).toBe(0);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_imports (
          acquisition_generation, id, source_kind, canonical_source_id,
          compatibility_fingerprint, status, status_code, recovery_action,
          evidence_references_json, created_at, updated_at
        ) VALUES (-1, ?, 'tiktok', ?, 'constraint-negative', 'queued', NULL, NULL, '[]', ?, ?)`
      )
        .bind(
          "constraint-negative-generation",
          "7500000000000000099",
          timestamp,
          timestamp
        )
        .run()
    ).rejects.toThrow();
    await expect(
      insertValidImport
        .bind(null, "7500000000000000001", timestamp, timestamp)
        .run()
    ).rejects.toThrow();
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_requests (
          created_at, idempotency_key_hash, import_id,
          request_fingerprint, source_locator_hash
        ) VALUES (?, ?, ?, 'constraint-request', 'constraint-locator')`
      )
        .bind(timestamp, null, "constraint-probe")
        .run()
    ).rejects.toThrow();
    await testEnv.MealPlannerDatabase.prepare(
      "DELETE FROM recipe_imports WHERE id = ?"
    )
      .bind("constraint-probe")
      .run();
  });

  it("allocates a fresh persisted generation for every actual attempt", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const command = makeCommand({
      canonicalId: "7580000000000000000",
      id: "018f47ad-91aa-7c35-b6fe-000000000091",
      key: "generation-allocation",
    });
    await Effect.runPromise(repository.acceptRequest(command));
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
    await Effect.runPromise(repository.acceptRequest(command));

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
    const evidence = {
      acquiredAt,
      audioStreams: [{ codec: "aac", index: 1 }],
      bytes: 1024,
      deleteAt: decodeTimestamp("2026-07-27T10:05:00.000Z"),
      durationSeconds: 1,
      generation,
      manifestKey: manifestObjectKey(command.candidate.view.id, generation),
      mediaKey: mediaObjectKey(command.candidate.view.id, generation),
      sha256: fixtureHash("media"),
      videoStreams: [{ codec: "h264", index: 0 }],
    } as const;
    await expect(
      Effect.runPromise(
        repository.recordAcquired(
          command.candidate.view.id,
          generation,
          evidence,
          acquiredAt
        )
      )
    ).resolves.toBe("Recorded");
    await expect(
      Effect.runPromise(
        repository.recordAcquired(
          command.candidate.view.id,
          generation,
          evidence,
          acquiredAt
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
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const command = makeCommand({
      canonicalId: "7590000000000000099",
      id: "018f47ad-91aa-7c35-b6fe-000000000199",
      key: "generation-finalization-fence",
    });
    await Effect.runPromise(repository.acceptRequest(command));
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
        const staleEvidence = {
          acquiredAt,
          audioStreams: [{ codec: "aac", index: 1 }],
          bytes: 1024,
          deleteAt: decodeTimestamp("2026-07-27T10:05:00.000Z"),
          durationSeconds: 1,
          generation,
          manifestKey: manifestObjectKey(command.candidate.view.id, generation),
          mediaKey: mediaObjectKey(command.candidate.view.id, generation),
          sha256: fixtureHash(`stale-media-${generation}`),
          videoStreams: [{ codec: "h264", index: 0 }],
        } as const;
        return expect(
          Effect.runPromise(
            repository.recordAcquired(
              command.candidate.view.id,
              generation,
              staleEvidence,
              acquiredAt
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
    await Effect.runPromise(repository.acceptRequest(command));
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
          {
            acquiredAt,
            audioStreams: [{ codec: "aac", index: 1 }],
            bytes: 1024,
            deleteAt: decodeTimestamp("2026-07-27T10:05:00.000Z"),
            durationSeconds: 1,
            generation,
            manifestKey: manifestObjectKey(
              command.candidate.view.id,
              generation
            ),
            mediaKey: mediaObjectKey(command.candidate.view.id, generation),
            sha256: fixtureHash("expired-media"),
            videoStreams: [{ codec: "h264", index: 0 }],
          },
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
      await Effect.runPromise(repository.acceptRequest(command));
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
    await Effect.runPromise(repository.acceptRequest(command));
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

  it("uses one atomic batch to attach K1 and K2 to one canonical import", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const first = await Effect.runPromise(
      repository.acceptRequest(makeCommand())
    );
    const second = await Effect.runPromise(
      repository.acceptRequest(
        makeCommand({
          id: "018f47ad-91aa-7c35-b6fe-000000000002",
          key: "key-2",
        })
      )
    );
    const imports = await testEnv.MealPlannerDatabase.prepare(
      "SELECT COUNT(*) AS count FROM recipe_imports WHERE canonical_source_id = ?"
    )
      .bind("7520000000000000000")
      .first<{ count: number }>();
    const requests = await testEnv.MealPlannerDatabase.prepare(
      `SELECT COUNT(*) AS count
       FROM import_requests
       INNER JOIN recipe_imports ON recipe_imports.id = import_requests.import_id
       WHERE recipe_imports.canonical_source_id = ?`
    )
      .bind("7520000000000000000")
      .first<{ count: number }>();

    expect(first.disposition).toBe("created");
    expect(second.disposition).toBe("canonical_duplicate");
    expect(second.import.view.id).toBe(first.import.view.id);
    expect(imports?.count).toBe(1);
    expect(requests?.count).toBe(2);
  });

  it("maps malformed persisted fingerprints to corruption", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const acceptedCommand = makeCommand({
      canonicalId: "7525000000000000000",
      id: "018f47ad-91aa-7c35-b6fe-000000000007",
      key: "corruption-key",
    });
    await Effect.runPromise(repository.acceptRequest(acceptedCommand));

    await testEnv.MealPlannerDatabase.prepare(
      "UPDATE import_requests SET request_fingerprint = 'malformed' WHERE idempotency_key_hash = ?"
    )
      .bind(acceptedCommand.idempotencyKeyHash)
      .run();
    await expectCorrupt(
      repository.findRequest(acceptedCommand.idempotencyKeyHash)
    );

    await testEnv.MealPlannerDatabase.prepare(
      "UPDATE import_requests SET request_fingerprint = ?, source_locator_hash = 'malformed' WHERE idempotency_key_hash = ?"
    )
      .bind(
        acceptedCommand.requestFingerprint,
        acceptedCommand.idempotencyKeyHash
      )
      .run();
    await expectCorrupt(
      repository.findRequest(acceptedCommand.idempotencyKeyHash)
    );

    await testEnv.MealPlannerDatabase.prepare(
      "UPDATE recipe_imports SET compatibility_fingerprint = 'malformed' WHERE id = ?"
    )
      .bind(acceptedCommand.candidate.view.id)
      .run();
    await expectCorrupt(repository.findById(acceptedCommand.candidate.view.id));
  });

  it("prevents a changed K1 from creating an orphan import", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    await Effect.runPromise(
      repository.acceptRequest(makeCommand({ key: "conflict-key" }))
    );
    const before = await testEnv.MealPlannerDatabase.prepare(
      "SELECT COUNT(*) AS count FROM recipe_imports"
    ).first<{ count: number }>();
    const exit = await Effect.runPromiseExit(
      repository.acceptRequest(
        makeCommand({
          canonicalId: "7530000000000000000",
          id: "018f47ad-91aa-7c35-b6fe-000000000003",
          key: "conflict-key",
          requestFingerprint: "different-request",
        })
      )
    );
    const after = await testEnv.MealPlannerDatabase.prepare(
      "SELECT COUNT(*) AS count FROM recipe_imports"
    ).first<{ count: number }>();

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected idempotency conflict");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))._tag).toBe(
      "IdempotencyConflict"
    );
    expect(after?.count).toBe(before?.count);
  });

  it("atomically assigns one winner when the same K1 competes across sources", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const commands = [
      makeCommand({
        canonicalId: "7531000000000000000",
        id: "018f47ad-91aa-7c35-b6fe-000000000008",
        key: "competing-source-key",
        requestFingerprint: "competing-source-a",
      }),
      makeCommand({
        canonicalId: "7532000000000000000",
        id: "018f47ad-91aa-7c35-b6fe-000000000009",
        key: "competing-source-key",
        requestFingerprint: "competing-source-b",
      }),
    ] as const;
    const exits = await Promise.all(
      commands.map((command) =>
        Effect.runPromiseExit(repository.acceptRequest(command))
      )
    );
    const successes = exits.filter(Exit.isSuccess).map((exit) => exit.value);
    const failures = exits
      .filter(Exit.isFailure)
      .map((exit) => Option.getOrThrow(Cause.findErrorOption(exit.cause)));
    const imports = await testEnv.MealPlannerDatabase.prepare(
      `SELECT id, canonical_source_id
       FROM recipe_imports
       WHERE canonical_source_id IN (?, ?)`
    )
      .bind("7531000000000000000", "7532000000000000000")
      .all<{ canonical_source_id: string; id: string }>();
    const ledger = await testEnv.MealPlannerDatabase.prepare(
      `SELECT import_id
       FROM import_requests
       WHERE idempotency_key_hash = ?`
    )
      .bind(commands[0].idempotencyKeyHash)
      .all<{ import_id: string }>();

    expect(successes).toHaveLength(1);
    expect(successes[0]?.disposition).toBe("created");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ _tag: "IdempotencyConflict" });
    expect(imports.results).toEqual([
      expect.objectContaining({ id: successes[0]?.import.view.id }),
    ]);
    expect(ledger.results).toEqual([
      { import_id: successes[0]?.import.view.id },
    ]);
  });

  it("rejects an incompatible canonical K2 without creating a ledger row", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    await Effect.runPromise(
      repository.acceptRequest(
        makeCommand({
          canonicalId: "7535000000000000000",
          id: "018f47ad-91aa-7c35-b6fe-000000000005",
          key: "compatible-first",
        })
      )
    );
    const exit = await Effect.runPromiseExit(
      repository.acceptRequest(
        makeCommand({
          canonicalId: "7535000000000000000",
          compatibilityFingerprint: "compat-v2",
          id: "018f47ad-91aa-7c35-b6fe-000000000006",
          key: "incompatible-second",
        })
      )
    );
    const ledger = await testEnv.MealPlannerDatabase.prepare(
      "SELECT import_id FROM import_requests WHERE idempotency_key_hash = ?"
    )
      .bind(decodeIdempotencyKeyHash(fixtureHash("incompatible-second")))
      .first();

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected incompatible duplicate");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))._tag).toBe(
      "IncompatibleDuplicate"
    );
    expect(ledger).toBeNull();
  });

  it("collapses concurrent K1 and canonical K2 races", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const k1 = await Promise.all(
      [1, 2].map((value) =>
        Effect.runPromise(
          repository.acceptRequest(
            makeCommand({
              canonicalId: "7540000000000000000",
              id: `018f47ad-91aa-7c35-b6fe-${String(value).padStart(12, "0")}`,
              key: "race-k1",
              requestFingerprint: "race-request",
            })
          )
        )
      )
    );
    const k2 = await Promise.all(
      [3, 4].map((value) =>
        Effect.runPromise(
          repository.acceptRequest(
            makeCommand({
              canonicalId: "7550000000000000000",
              id: `018f47ad-91aa-7c35-b6fe-${String(value).padStart(12, "0")}`,
              key: `race-k2-${value}`,
              requestFingerprint: "race-request-k2",
            })
          )
        )
      )
    );
    const imports = await testEnv.MealPlannerDatabase.prepare(
      "SELECT COUNT(*) AS count FROM recipe_imports WHERE canonical_source_id IN (?, ?)"
    )
      .bind("7540000000000000000", "7550000000000000000")
      .first<{ count: number }>();
    const requests = await testEnv.MealPlannerDatabase.prepare(
      `SELECT COUNT(*) AS count
       FROM import_requests
       INNER JOIN recipe_imports ON recipe_imports.id = import_requests.import_id
       WHERE recipe_imports.canonical_source_id IN (?, ?)`
    )
      .bind("7540000000000000000", "7550000000000000000")
      .first<{ count: number }>();

    expect(k1.map(({ disposition }) => disposition).toSorted()).toEqual([
      "created",
      "idempotency_replay",
    ]);
    expect(new Set(k1.map((result) => result.import.view.id))).toHaveLength(1);
    expect(k2.map(({ disposition }) => disposition).toSorted()).toEqual([
      "canonical_duplicate",
      "created",
    ]);
    expect(new Set(k2.map((result) => result.import.view.id))).toHaveLength(1);
    expect(imports?.count).toBe(2);
    expect(requests?.count).toBe(3);
  });

  it("rolls back both production tables when the repository batch fails", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const command = makeCommand({
      canonicalId: "7555000000000000000",
      id: "018f47ad-91aa-7c35-b6fe-000000000010",
      key: "repository-rollback-key",
      requestFingerprint: "repository-rollback-request",
    });
    const triggerName = "import_requests_repository_rollback_probe";

    await testEnv.MealPlannerDatabase.prepare(
      `CREATE TRIGGER ${triggerName}
       AFTER INSERT ON import_requests
       WHEN NEW.idempotency_key_hash = '${command.idempotencyKeyHash}'
       BEGIN
         SELECT RAISE(ABORT, 'repository rollback probe');
       END`
    ).run();

    try {
      const exit = await Effect.runPromiseExit(
        repository.acceptRequest(command)
      );
      const imports = await testEnv.MealPlannerDatabase.prepare(
        "SELECT id FROM recipe_imports WHERE id = ?"
      )
        .bind(command.candidate.view.id)
        .all();
      const requests = await testEnv.MealPlannerDatabase.prepare(
        "SELECT import_id FROM import_requests WHERE idempotency_key_hash = ?"
      )
        .bind(command.idempotencyKeyHash)
        .all();

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected repository persistence failure");
      }
      expect(
        Option.getOrThrow(Cause.findErrorOption(exit.cause))
      ).toMatchObject({ _tag: "ImportPersistenceUnavailable" });
      expect(imports.results).toEqual([]);
      expect(requests.results).toEqual([]);
    } finally {
      await testEnv.MealPlannerDatabase.prepare(
        `DROP TRIGGER IF EXISTS ${triggerName}`
      ).run();
    }
  });

  it("rolls back every statement when a native D1 batch member fails", async () => {
    const rollbackId = "018f47ad-91aa-7c35-b6fe-999999999999";
    await expect(
      testEnv.MealPlannerDatabase.batch([
        testEnv.MealPlannerDatabase.prepare(
          `INSERT INTO recipe_imports (
            id, source_kind, canonical_source_id, compatibility_fingerprint,
            status, status_code, recovery_action, evidence_references_json,
            created_at, updated_at
          ) VALUES (?, 'tiktok', ?, 'compat-v1', 'queued', NULL, NULL, '[]', ?, ?)`
        ).bind(
          rollbackId,
          "7560000000000000000",
          "2026-07-20T10:00:00.000Z",
          "2026-07-20T10:00:00.000Z"
        ),
        testEnv.MealPlannerDatabase.prepare(
          "INSERT INTO table_that_does_not_exist (id) VALUES ('failure')"
        ),
      ])
    ).rejects.toThrow();

    const row = await testEnv.MealPlannerDatabase.prepare(
      "SELECT id FROM recipe_imports WHERE id = ?"
    )
      .bind(rollbackId)
      .first();
    expect(row).toBeNull();
  });
});
