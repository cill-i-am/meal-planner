import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Option, Schema } from "effect";

import type {
  CarouselEvidenceRepository,
  CompletedCarouselEvidence,
} from "./import-carousel.repository.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  importTransitionRejected,
} from "./import.errors.js";

export type {
  CarouselEvidenceClaim,
  CarouselEvidenceRepository,
  CompletedCarouselEvidence,
} from "./import-carousel.repository.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);
const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(Schema.Number);

const CarouselEvidenceRow = Schema.Struct({
  acquisition_generation: AcquisitionGeneration,
  completed_at: NullableString,
  created_at: ImportTimestamp,
  descriptor_fingerprint: Sha256Hex,
  dispatch_id: Schema.String,
  failure_code: NullableString,
  image_count: NullableNumber,
  import_id: ImportId,
  manifest_key: NullableString,
  manifest_sha256: NullableString,
  recovery_action: NullableString,
  state: Schema.Literals(["completed", "dispatching", "failed"]),
  updated_at: ImportTimestamp,
});
type CarouselEvidenceRow = typeof CarouselEvidenceRow.Type;

const D1MutationResult = Schema.Struct({ results: Schema.Array(Schema.Json) });
const D1InsertResult = Schema.Struct({
  results: Schema.Array(Schema.Struct({ import_id: ImportId })),
});
const D1CarouselEvidenceRows = Schema.Struct({
  results: Schema.Array(CarouselEvidenceRow),
});
const D1ClaimBatchResults = Schema.Tuple([
  D1InsertResult,
  D1CarouselEvidenceRows,
]);
const D1CompleteBatchResults = Schema.Tuple([
  D1MutationResult,
  D1CarouselEvidenceRows,
]);

const CarouselParentRow = Schema.Struct({
  acquisition_generation: AcquisitionGeneration,
  canonical_source_id: SourceCanonicalId,
  status: Schema.String,
});

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: importPersistenceUnavailable,
    try: () => Promise.resolve(operation()),
  });

const decodeFailure = (row: CarouselEvidenceRow) => {
  const candidate = {
    code: row.failure_code,
    recovery: row.recovery_action,
  };
  if (
    candidate.code === "carousel_inaccessible" &&
    candidate.recovery === "check_source_visibility"
  ) {
    return candidate as {
      readonly code: "carousel_inaccessible";
      readonly recovery: "check_source_visibility";
    };
  }
  if (
    candidate.code === "carousel_partial" &&
    candidate.recovery === "request_complete_carousel"
  ) {
    return candidate as {
      readonly code: "carousel_partial";
      readonly recovery: "request_complete_carousel";
    };
  }
  if (
    candidate.code === "carousel_layout_drift" &&
    candidate.recovery === "update_carousel_adapter"
  ) {
    return candidate as {
      readonly code: "carousel_layout_drift";
      readonly recovery: "update_carousel_adapter";
    };
  }
  return null;
};

const completedFromRow = (row: CarouselEvidenceRow) => {
  if (
    row.state !== "completed" ||
    row.completed_at === null ||
    row.image_count === null ||
    row.manifest_key === null ||
    row.manifest_sha256 === null
  ) {
    return Effect.fail(importPersistenceCorrupt());
  }
  return Effect.succeed({
    completedAt: Schema.decodeUnknownSync(ImportTimestamp)(row.completed_at),
    descriptorFingerprint: row.descriptor_fingerprint,
    dispatchId: row.dispatch_id,
    generation: row.acquisition_generation,
    imageCount: row.image_count,
    importId: row.import_id,
    manifestKey: row.manifest_key,
    manifestSha256: row.manifest_sha256,
  } satisfies CompletedCarouselEvidence);
};

const claimFromRow = (row: CarouselEvidenceRow, inserted: boolean) => {
  switch (row.state) {
    case "dispatching": {
      return Effect.succeed(
        inserted
          ? ({ _tag: "DispatchClaimed" } as const)
          : ({ _tag: "ResumeDispatch" } as const)
      );
    }
    case "completed": {
      return Effect.map(completedFromRow(row), (evidence) => ({
        _tag: "Completed" as const,
        evidence,
      }));
    }
    case "failed": {
      const failure = decodeFailure(row);
      return failure === null
        ? Effect.fail(importPersistenceCorrupt())
        : Effect.succeed({ _tag: "Failed" as const, ...failure });
    }
    default: {
      return Effect.fail(importPersistenceCorrupt());
    }
  }
};

/** Additive, generation-fenced carousel evidence sidecar. */
export const makeD1CarouselEvidenceRepository = (
  binding: AnyD1Database
): CarouselEvidenceRepository => ({
  claim: (input) =>
    Effect.gen(function* claimCarouselEvidence() {
      const raw = yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `INSERT INTO import_carousel_evidence (
                 import_id, acquisition_generation, descriptor_fingerprint,
                 dispatch_id, state, created_at, updated_at
               )
               SELECT parent.id, parent.acquisition_generation, ?, ?,
                      'dispatching', ?, ?
                 FROM import_execution_runs AS parent
                WHERE parent.id = ? AND parent.acquisition_generation = ?
                  AND parent.status = 'queued'
               ON CONFLICT(import_id, acquisition_generation) DO NOTHING
               RETURNING import_id`
            )
            .bind(
              input.descriptorFingerprint,
              input.dispatchId,
              DateTime.formatIso(input.startedAt),
              DateTime.formatIso(input.startedAt),
              input.importId,
              input.generation
            ),
          binding
            .prepare(
              `SELECT * FROM import_carousel_evidence
                WHERE import_id = ? AND acquisition_generation = ?`
            )
            .bind(input.importId, input.generation),
        ])
      );
      const [insert, select] = yield* Schema.decodeUnknownEffect(
        D1ClaimBatchResults,
        { onExcessProperty: "ignore" }
      )(raw).pipe(Effect.mapError(() => importPersistenceCorrupt()));
      const [row] = select.results;
      if (row === undefined) {
        return yield* Effect.fail(importTransitionRejected());
      }
      if (
        row.descriptor_fingerprint !== input.descriptorFingerprint ||
        row.dispatch_id !== input.dispatchId
      ) {
        return yield* Effect.fail(importTransitionRejected());
      }
      return yield* claimFromRow(row, insert.results.length === 1);
    }),
  complete: (evidence) =>
    Effect.gen(function* completeCarouselEvidence() {
      const raw = yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `UPDATE import_carousel_evidence
                  SET state = 'completed', manifest_key = ?, manifest_sha256 = ?,
                      image_count = ?, completed_at = ?, updated_at = ?
                WHERE import_id = ? AND acquisition_generation = ?
                  AND descriptor_fingerprint = ? AND dispatch_id = ?
                  AND state = 'dispatching'
               RETURNING import_id`
            )
            .bind(
              evidence.manifestKey,
              evidence.manifestSha256,
              evidence.imageCount,
              DateTime.formatIso(evidence.completedAt),
              DateTime.formatIso(evidence.completedAt),
              evidence.importId,
              evidence.generation,
              evidence.descriptorFingerprint,
              evidence.dispatchId
            ),
          binding
            .prepare(
              `SELECT * FROM import_carousel_evidence
                WHERE import_id = ? AND acquisition_generation = ?`
            )
            .bind(evidence.importId, evidence.generation),
        ])
      );
      const [update, select] = yield* Schema.decodeUnknownEffect(
        D1CompleteBatchResults,
        { onExcessProperty: "ignore" }
      )(raw).pipe(Effect.mapError(() => importPersistenceCorrupt()));
      const [row] = select.results;
      if (update.results.length !== 1 || row === undefined) {
        return yield* Effect.fail(importTransitionRejected());
      }
      return yield* completedFromRow(row);
    }),
  fail: (input) =>
    persistenceEffect(() =>
      binding.batch([
        binding
          .prepare(
            `UPDATE import_carousel_evidence
                SET state = 'failed', failure_code = ?, recovery_action = ?,
                    completed_at = ?, updated_at = ?
              WHERE import_id = ? AND acquisition_generation = ?
                AND descriptor_fingerprint = ? AND state = 'dispatching'`
          )
          .bind(
            input.code,
            input.recovery,
            DateTime.formatIso(input.completedAt),
            DateTime.formatIso(input.completedAt),
            input.importId,
            input.generation,
            input.descriptorFingerprint
          ),
      ])
    ).pipe(Effect.asVoid),
  findParent: (importId) =>
    Effect.gen(function* findCarouselParent() {
      const raw = yield* persistenceEffect(() =>
        binding
          .prepare(
            `SELECT canonical_source_id, acquisition_generation, status
               FROM import_execution_runs WHERE id = ?`
          )
          .bind(importId)
          .first()
      );
      if (raw === null) {
        return Option.none();
      }
      const row = yield* Schema.decodeUnknownEffect(CarouselParentRow, {
        onExcessProperty: "ignore",
      })(raw).pipe(Effect.mapError(() => importPersistenceCorrupt()));
      return Option.some({
        canonicalId: row.canonical_source_id,
        generation: row.acquisition_generation,
        status: row.status,
      });
    }),
});
