import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, Effect, Exit, Option, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

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
