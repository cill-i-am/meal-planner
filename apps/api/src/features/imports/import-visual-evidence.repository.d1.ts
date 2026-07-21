import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Schema } from "effect";

import { AcquisitionGeneration } from "./import-media.model.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  importTransitionRejected,
} from "./import.errors.js";
import type { ImportTransitionError } from "./import.repository.js";

const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(Schema.Number);
const VisualEvidenceRow = Schema.Struct({
  acquisition_generation: AcquisitionGeneration,
  completed_at: NullableString,
  cost_certainty: NullableString,
  cost_currency: NullableString,
  created_at: ImportTimestamp,
  dispatch_id: Schema.String,
  estimated_cost_micro_usd: NullableNumber,
  failure_code: NullableString,
  import_id: ImportId,
  input_bytes: NullableNumber,
  input_frames: NullableNumber,
  manifest_key: NullableString,
  manifest_sha256: NullableString,
  model: NullableString,
  model_calls: NullableNumber,
  observations_count: NullableNumber,
  outcome: NullableString,
  provider: NullableString,
  source_media_sha256: Schema.String,
  state: Schema.Literals(["completed", "dispatching", "failed"]),
  updated_at: ImportTimestamp,
});
type VisualEvidenceRow = typeof VisualEvidenceRow.Type;
const D1BatchResults = Schema.Array(
  Schema.Struct({ results: Schema.Array(Schema.Unknown) })
);

export type VisualEvidenceOutcome = "empty" | "found" | "low_confidence";

/** Durable normalized metadata after private visual evidence is verified. */
export interface CompletedVisualEvidence {
  readonly completedAt: ImportTimestamp;
  readonly cost: {
    readonly certainty: "estimated" | "known";
    readonly currency: "USD";
    readonly estimatedMicroUsd: number;
  };
  readonly dispatchId: string;
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly manifestKey: string;
  readonly manifestSha256: string;
  readonly model: string;
  readonly observationsCount: number;
  readonly outcome: VisualEvidenceOutcome;
  readonly provider: string;
  readonly sourceMediaSha256: string;
  readonly usage: {
    readonly inputBytes: number;
    readonly inputFrames: number;
    readonly modelCalls: 1;
  };
}

export type VisualDispatchClaim =
  | { readonly _tag: "Completed"; readonly evidence: CompletedVisualEvidence }
  | { readonly _tag: "DispatchClaimed"; readonly dispatchId: string }
  | {
      readonly _tag: "Failed";
      readonly code: string;
      readonly dispatchId: string;
    }
  | { readonly _tag: "ResumeDispatch"; readonly dispatchId: string };

export type VisualEvidenceFailureCode =
  | "frame_evidence_failed"
  | "frame_sampling_failed"
  | "outcome_unknown"
  | "source_evidence_invalid"
  | "visual_evidence_failed"
  | "visual_extraction_failed";

export interface VisualEvidenceRepositoryShape {
  readonly claim: (input: {
    readonly dispatchId: string;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly sourceMediaSha256: string;
    readonly startedAt: ImportTimestamp;
  }) => Effect.Effect<VisualDispatchClaim, ImportTransitionError>;
  readonly complete: (
    evidence: CompletedVisualEvidence
  ) => Effect.Effect<CompletedVisualEvidence, ImportTransitionError>;
  readonly fail: (input: {
    readonly completedAt: ImportTimestamp;
    readonly dispatchId: string;
    readonly failureCode: VisualEvidenceFailureCode;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly sourceMediaSha256: string;
  }) => Effect.Effect<void, ImportTransitionError>;
}

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: importPersistenceUnavailable,
    try: () => Promise.resolve(operation()),
  });

const decodeRow = (value: unknown) =>
  Schema.decodeUnknownEffect(VisualEvidenceRow, {
    onExcessProperty: "ignore",
  })(value).pipe(Effect.mapError(() => importPersistenceCorrupt()));

const decodeBatchResults = (value: unknown) =>
  Schema.decodeUnknownEffect(D1BatchResults, {
    onExcessProperty: "ignore",
  })(value).pipe(Effect.mapError(() => importPersistenceCorrupt()));

const requiredNumber = (value: number | null) =>
  value !== null && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

const completedEvidence = (row: VisualEvidenceRow) => {
  const estimatedMicroUsd = requiredNumber(row.estimated_cost_micro_usd);
  const inputBytes = requiredNumber(row.input_bytes);
  const inputFrames = requiredNumber(row.input_frames);
  const modelCalls = requiredNumber(row.model_calls);
  const observationsCount = requiredNumber(row.observations_count);
  if (
    row.state !== "completed" ||
    row.completed_at === null ||
    (row.cost_certainty !== "estimated" && row.cost_certainty !== "known") ||
    row.cost_currency !== "USD" ||
    row.manifest_key === null ||
    row.manifest_sha256 === null ||
    row.model === null ||
    row.provider === null ||
    (row.outcome !== "empty" &&
      row.outcome !== "found" &&
      row.outcome !== "low_confidence") ||
    estimatedMicroUsd === undefined ||
    inputBytes === undefined ||
    inputFrames === undefined ||
    modelCalls !== 1 ||
    observationsCount === undefined
  ) {
    return Effect.fail(importPersistenceCorrupt());
  }
  return Effect.succeed({
    completedAt: Schema.decodeUnknownSync(ImportTimestamp)(row.completed_at),
    cost: {
      certainty: row.cost_certainty,
      currency: "USD",
      estimatedMicroUsd,
    },
    dispatchId: row.dispatch_id,
    generation: row.acquisition_generation,
    importId: row.import_id,
    manifestKey: row.manifest_key,
    manifestSha256: row.manifest_sha256,
    model: row.model,
    observationsCount,
    outcome: row.outcome,
    provider: row.provider,
    sourceMediaSha256: row.source_media_sha256,
    usage: { inputBytes, inputFrames, modelCalls: 1 },
  } satisfies CompletedVisualEvidence);
};

const claimFromRow = (row: VisualEvidenceRow, inserted: boolean) => {
  switch (row.state) {
    case "dispatching": {
      return Effect.succeed(
        inserted
          ? ({ _tag: "DispatchClaimed", dispatchId: row.dispatch_id } as const)
          : ({ _tag: "ResumeDispatch", dispatchId: row.dispatch_id } as const)
      );
    }
    case "failed": {
      return row.failure_code === null
        ? Effect.fail(importPersistenceCorrupt())
        : Effect.succeed({
            _tag: "Failed" as const,
            code: row.failure_code,
            dispatchId: row.dispatch_id,
          });
    }
    case "completed": {
      return Effect.map(completedEvidence(row), (evidence) => ({
        _tag: "Completed" as const,
        evidence,
      }));
    }
    default: {
      return Effect.fail(importPersistenceCorrupt());
    }
  }
};

/** Build the generation-fenced D1 visual dispatch ledger. */
export const makeD1VisualEvidenceRepository = (
  binding: AnyD1Database
): VisualEvidenceRepositoryShape => ({
  claim: (input) =>
    Effect.gen(function* claimVisualDispatch() {
      const rawResults = yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `INSERT INTO import_visual_evidence (
                 import_id, acquisition_generation, dispatch_id,
                 source_media_sha256, state, created_at, updated_at
               )
               SELECT parent.id, parent.acquisition_generation, ?, ?,
                      'dispatching', ?, ?
                 FROM recipe_imports AS parent
                 JOIN import_transcriptions AS transcription
                   ON transcription.import_id = parent.id
                  AND transcription.acquisition_generation = parent.acquisition_generation
                WHERE parent.id = ? AND parent.acquisition_generation = ?
                  AND parent.status = 'transcribed'
                  AND transcription.state = 'transcribed'
                  AND transcription.source_media_sha256 = ?
                  AND json_array_length(parent.evidence_references_json) = 3
                  AND json_extract(parent.evidence_references_json, '$[2].kind') = 'speech_transcript'
               ON CONFLICT(import_id, acquisition_generation) DO NOTHING
               RETURNING dispatch_id`
            )
            .bind(
              input.dispatchId,
              input.sourceMediaSha256,
              DateTime.formatIso(input.startedAt),
              DateTime.formatIso(input.startedAt),
              input.importId,
              input.generation,
              input.sourceMediaSha256
            ),
          binding
            .prepare(
              `SELECT visual.*
                 FROM import_visual_evidence AS visual
                 JOIN recipe_imports AS parent
                   ON parent.id = visual.import_id
                  AND parent.acquisition_generation = visual.acquisition_generation
                 JOIN import_transcriptions AS transcription
                   ON transcription.import_id = visual.import_id
                  AND transcription.acquisition_generation = visual.acquisition_generation
                WHERE visual.import_id = ?
                  AND visual.acquisition_generation = ?
                  AND parent.status = 'transcribed'
                  AND transcription.state = 'transcribed'`
            )
            .bind(input.importId, input.generation),
        ])
      );
      const [insertResult, selectResult] =
        yield* decodeBatchResults(rawResults);
      const rawRow = selectResult?.results[0];
      if (insertResult === undefined || rawRow === undefined) {
        return yield* Effect.fail(importTransitionRejected());
      }
      const row = yield* decodeRow(rawRow);
      if (
        row.dispatch_id !== input.dispatchId ||
        row.source_media_sha256 !== input.sourceMediaSha256
      ) {
        return yield* Effect.fail(importTransitionRejected());
      }
      return yield* claimFromRow(row, insertResult.results.length === 1);
    }),
  complete: (evidence) =>
    Effect.gen(function* completeVisualDispatch() {
      const rawResults = yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `UPDATE import_visual_evidence
                  SET state = 'completed', outcome = ?, manifest_key = ?,
                      manifest_sha256 = ?, provider = ?, model = ?,
                      input_frames = ?, input_bytes = ?, model_calls = ?,
                      estimated_cost_micro_usd = ?, cost_currency = ?,
                      cost_certainty = ?, observations_count = ?,
                      failure_code = NULL, completed_at = ?, updated_at = ?
                WHERE import_id = ? AND acquisition_generation = ?
                  AND dispatch_id = ? AND source_media_sha256 = ?
                  AND state = 'dispatching'`
            )
            .bind(
              evidence.outcome,
              evidence.manifestKey,
              evidence.manifestSha256,
              evidence.provider,
              evidence.model,
              evidence.usage.inputFrames,
              evidence.usage.inputBytes,
              evidence.usage.modelCalls,
              evidence.cost.estimatedMicroUsd,
              evidence.cost.currency,
              evidence.cost.certainty,
              evidence.observationsCount,
              DateTime.formatIso(evidence.completedAt),
              DateTime.formatIso(evidence.completedAt),
              evidence.importId,
              evidence.generation,
              evidence.dispatchId,
              evidence.sourceMediaSha256
            ),
          binding
            .prepare(
              `SELECT * FROM import_visual_evidence
                WHERE import_id = ? AND acquisition_generation = ?
                  AND state = 'completed'`
            )
            .bind(evidence.importId, evidence.generation),
        ])
      );
      const [, selectResult] = yield* decodeBatchResults(rawResults);
      const rawRow = selectResult?.results[0];
      if (rawRow === undefined) {
        return yield* Effect.fail(importTransitionRejected());
      }
      const completed = yield* completedEvidence(yield* decodeRow(rawRow));
      if (
        completed.dispatchId !== evidence.dispatchId ||
        completed.manifestSha256 !== evidence.manifestSha256
      ) {
        return yield* Effect.fail(importTransitionRejected());
      }
      return completed;
    }),
  fail: (input) =>
    persistenceEffect(() =>
      binding.batch([
        binding
          .prepare(
            `UPDATE import_visual_evidence
                SET state = 'failed', failure_code = ?, completed_at = ?,
                    updated_at = ?
              WHERE import_id = ? AND acquisition_generation = ?
                AND dispatch_id = ? AND source_media_sha256 = ?
                AND state = 'dispatching'`
          )
          .bind(
            input.failureCode,
            DateTime.formatIso(input.completedAt),
            DateTime.formatIso(input.completedAt),
            input.importId,
            input.generation,
            input.dispatchId,
            input.sourceMediaSha256
          ),
      ])
    ).pipe(Effect.asVoid),
});
