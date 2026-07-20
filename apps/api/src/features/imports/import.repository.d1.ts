import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Option, Schema } from "effect";

import {
  EvidenceReference,
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import type { ImportDisposition, ImportStatus } from "./import.contracts.js";
import { importRequests, recipeImports } from "./import.database-schema.js";
import {
  idempotencyConflict,
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  incompatibleDuplicate,
} from "./import.errors.js";
import type {
  AcceptImportCommand,
  ImportRepositoryShape,
  StoredImport,
  StoredImportRequest,
} from "./import.repository.js";
import {
  CompatibilityFingerprint,
  RequestFingerprint,
  SourceLocatorHash,
} from "./import.repository.js";

const NullableString = Schema.NullOr(Schema.String);

const DatabaseImportRow = Schema.Struct({
  canonicalSourceId: Schema.String,
  compatibilityFingerprint: CompatibilityFingerprint,
  createdAt: Schema.String,
  evidenceReferencesJson: Schema.String,
  id: Schema.String,
  recoveryAction: NullableString,
  sourceKind: Schema.Literal("tiktok"),
  status: Schema.Literals(["failed", "queued", "unsupported"]),
  statusCode: NullableString,
  updatedAt: Schema.String,
});

const DatabaseRequestFingerprints = Schema.Struct({
  requestFingerprint: RequestFingerprint,
  sourceLocatorHash: SourceLocatorHash,
});

const importSelection = {
  canonicalSourceId: recipeImports.canonicalSourceId,
  compatibilityFingerprint: recipeImports.compatibilityFingerprint,
  createdAt: recipeImports.createdAt,
  evidenceReferencesJson: recipeImports.evidenceReferencesJson,
  id: recipeImports.id,
  recoveryAction: recipeImports.recoveryAction,
  sourceKind: recipeImports.sourceKind,
  status: recipeImports.status,
  statusCode: recipeImports.statusCode,
  updatedAt: recipeImports.updatedAt,
} as const;

const decodeStatus = (row: typeof DatabaseImportRow.Type): ImportStatus => {
  if (
    row.status === "queued" &&
    row.statusCode === null &&
    row.recoveryAction === null
  ) {
    return { kind: "queued" };
  }
  if (
    row.status === "failed" &&
    row.statusCode === "private_or_unavailable" &&
    row.recoveryAction === "check_source_visibility"
  ) {
    return {
      code: "private_or_unavailable",
      kind: "failed",
      recovery: "check_source_visibility",
    };
  }
  if (
    row.status === "unsupported" &&
    row.statusCode === "unsupported_post_type" &&
    row.recoveryAction === "submit_supported_public_video"
  ) {
    return {
      code: "unsupported_post_type",
      kind: "unsupported",
      recovery: "submit_supported_public_video",
    };
  }
  throw new Error("Invalid persisted import state");
};

const decodeStoredImport = (input: unknown) =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: (): StoredImport => {
      const row = Schema.decodeUnknownSync(DatabaseImportRow)(input);
      const canonicalSourceId = Schema.decodeUnknownSync(SourceCanonicalId)(
        row.canonicalSourceId
      );
      return {
        canonicalSourceId,
        compatibilityFingerprint: row.compatibilityFingerprint,
        sourceKind: row.sourceKind,
        view: {
          createdAt: Schema.decodeUnknownSync(ImportTimestamp)(row.createdAt),
          evidence: Schema.decodeUnknownSync(Schema.Array(EvidenceReference))(
            JSON.parse(row.evidenceReferencesJson)
          ),
          id: Schema.decodeUnknownSync(ImportId)(row.id),
          source: { canonicalId: canonicalSourceId, kind: row.sourceKind },
          status: decodeStatus(row),
          updatedAt: Schema.decodeUnknownSync(ImportTimestamp)(row.updatedAt),
        },
      };
    },
  });

const decodeStoredImportRequest = (input: unknown) =>
  Effect.gen(function* decodeStoredRequest() {
    const fingerprints = yield* Effect.try({
      catch: importPersistenceCorrupt,
      try: () => Schema.decodeUnknownSync(DatabaseRequestFingerprints)(input),
    });
    return {
      import: yield* decodeStoredImport(input),
      requestFingerprint: fingerprints.requestFingerprint,
      sourceLocatorHash: fingerprints.sourceLocatorHash,
    } satisfies StoredImportRequest;
  });

const persistenceEffect = <A>(promise: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: importPersistenceUnavailable,
    try: promise,
  });

const statusColumns = (status: ImportStatus) => {
  switch (status.kind) {
    case "queued": {
      return { recoveryAction: null, statusCode: null };
    }
    case "failed": {
      return {
        recoveryAction: status.recovery,
        statusCode: status.code,
      };
    }
    case "unsupported": {
      return {
        recoveryAction: status.recovery,
        statusCode: status.code,
      };
    }
    default: {
      throw new Error("Unsupported import status");
    }
  }
};

export const makeD1ImportRepository = (
  binding: AnyD1Database
): ImportRepositoryShape => {
  const database = drizzle(binding);

  return {
    acceptRequest: (command: AcceptImportCommand) =>
      Effect.gen(function* acceptRequest() {
        const createdAt = DateTime.formatIso(command.candidate.view.createdAt);
        const updatedAt = DateTime.formatIso(command.candidate.view.updatedAt);
        const { recoveryAction, statusCode } = statusColumns(
          command.candidate.view.status
        );

        const insertCandidate = database
          .insert(recipeImports)
          .select(
            sql`SELECT
              ${command.candidate.canonicalSourceId},
              ${command.candidate.compatibilityFingerprint},
              ${createdAt},
              ${JSON.stringify(command.candidate.view.evidence)},
              ${command.candidate.view.id},
              ${recoveryAction},
              ${command.candidate.sourceKind},
              ${command.candidate.view.status.kind},
              ${statusCode},
              ${updatedAt}
            WHERE NOT EXISTS (
              SELECT 1 FROM ${importRequests}
              WHERE ${importRequests.idempotencyKeyHash} = ${command.idempotencyKeyHash}
            )`
          )
          .onConflictDoNothing()
          .returning({ id: recipeImports.id });

        const insertRequest = database
          .insert(importRequests)
          .select(
            sql`SELECT
              ${createdAt},
              ${command.idempotencyKeyHash},
              ${recipeImports.id},
              ${command.requestFingerprint},
              ${command.sourceLocatorHash}
            FROM ${recipeImports}
            WHERE ${recipeImports.sourceKind} = ${command.candidate.sourceKind}
              AND ${recipeImports.canonicalSourceId} = ${command.candidate.canonicalSourceId}
              AND ${recipeImports.compatibilityFingerprint} = ${command.candidate.compatibilityFingerprint}
              AND NOT EXISTS (
                SELECT 1 FROM ${importRequests}
                WHERE ${importRequests.idempotencyKeyHash} = ${command.idempotencyKeyHash}
              )
            LIMIT 1`
          )
          .onConflictDoNothing()
          .returning({ importId: importRequests.importId });

        const selectWinningRequest = database
          .select({
            ...importSelection,
            requestFingerprint: importRequests.requestFingerprint,
            sourceLocatorHash: importRequests.sourceLocatorHash,
          })
          .from(importRequests)
          .innerJoin(
            recipeImports,
            eq(importRequests.importId, recipeImports.id)
          )
          .where(
            eq(importRequests.idempotencyKeyHash, command.idempotencyKeyHash)
          )
          .limit(1);

        const selectCanonical = database
          .select(importSelection)
          .from(recipeImports)
          .where(
            and(
              eq(recipeImports.sourceKind, command.candidate.sourceKind),
              eq(
                recipeImports.canonicalSourceId,
                command.candidate.canonicalSourceId
              )
            )
          )
          .limit(1);

        const [insertedImports, insertedRequests, winningRows, canonicalRows] =
          yield* persistenceEffect(() =>
            database.batch([
              insertCandidate,
              insertRequest,
              selectWinningRequest,
              selectCanonical,
            ] as const)
          );

        const [winningRow] = winningRows;
        if (winningRow !== undefined) {
          const winningRequest = yield* decodeStoredImportRequest(winningRow);
          if (
            winningRequest.requestFingerprint !== command.requestFingerprint
          ) {
            return yield* Effect.fail(idempotencyConflict());
          }
          const winningImport = winningRequest.import;
          if (
            winningImport.compatibilityFingerprint !==
            command.candidate.compatibilityFingerprint
          ) {
            return yield* Effect.fail(incompatibleDuplicate());
          }

          const insertedImport = insertedImports.some(
            ({ id }) => id === winningImport.view.id
          );
          let disposition: ImportDisposition = "idempotency_replay";
          if (insertedImport) {
            disposition = "created";
          } else if (insertedRequests.length > 0) {
            disposition = "canonical_duplicate";
          }
          return {
            disposition,
            import: winningImport,
          };
        }

        const [canonicalRow] = canonicalRows;
        if (canonicalRow !== undefined) {
          const canonicalImport = yield* decodeStoredImport(canonicalRow);
          if (
            canonicalImport.compatibilityFingerprint !==
            command.candidate.compatibilityFingerprint
          ) {
            return yield* Effect.fail(incompatibleDuplicate());
          }
        }
        return yield* Effect.fail(importPersistenceUnavailable());
      }).pipe(
        Effect.retry({
          times: 4,
          while: (error) => error._tag === "ImportPersistenceUnavailable",
        })
      ),
    findByCanonicalIdentity: (identity) =>
      Effect.gen(function* findByCanonicalIdentity() {
        const rows = yield* persistenceEffect(() =>
          database
            .select(importSelection)
            .from(recipeImports)
            .where(
              and(
                eq(recipeImports.sourceKind, identity.kind),
                eq(recipeImports.canonicalSourceId, identity.canonicalId)
              )
            )
            .limit(1)
        );
        return rows[0] === undefined
          ? Option.none()
          : Option.some(yield* decodeStoredImport(rows[0]));
      }),
    findById: (id) =>
      Effect.gen(function* findById() {
        const rows = yield* persistenceEffect(() =>
          database
            .select(importSelection)
            .from(recipeImports)
            .where(eq(recipeImports.id, id))
            .limit(1)
        );
        return rows[0] === undefined
          ? Option.none()
          : Option.some(yield* decodeStoredImport(rows[0]));
      }),
    findRequest: (idempotencyKeyHash) =>
      Effect.gen(function* findRequest() {
        const rows = yield* persistenceEffect(() =>
          database
            .select({
              ...importSelection,
              requestFingerprint: importRequests.requestFingerprint,
              sourceLocatorHash: importRequests.sourceLocatorHash,
            })
            .from(importRequests)
            .innerJoin(
              recipeImports,
              eq(importRequests.importId, recipeImports.id)
            )
            .where(eq(importRequests.idempotencyKeyHash, idempotencyKeyHash))
            .limit(1)
        );
        const [row] = rows;
        if (row === undefined) {
          return Option.none();
        }
        return Option.some(yield* decodeStoredImportRequest(row));
      }),
  };
};
