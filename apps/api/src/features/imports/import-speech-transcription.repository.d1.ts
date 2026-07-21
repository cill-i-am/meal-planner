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
const TranscriptionRow = Schema.Struct({
  acquisition_generation: AcquisitionGeneration,
  completed_at: NullableString,
  cost_certainty: NullableString,
  cost_currency: NullableString,
  created_at: ImportTimestamp,
  detected_language: NullableString,
  dispatch_id: Schema.String,
  estimated_cost_micro_usd: NullableNumber,
  failure_code: NullableString,
  import_id: ImportId,
  model: NullableString,
  provider: NullableString,
  segments_count: NullableNumber,
  source_media_sha256: Schema.String,
  state: Schema.Literals(["dispatching", "failed", "transcribed"]),
  transcript_key: NullableString,
  transcript_sha256: NullableString,
  updated_at: ImportTimestamp,
  usage_audio_milliseconds: NullableNumber,
  usage_input_bytes: NullableNumber,
});
type TranscriptionRow = typeof TranscriptionRow.Type;
const D1BatchResults = Schema.Array(
  Schema.Struct({ results: Schema.Array(Schema.Unknown) })
);

/** Metadata persisted after one transcript object has been verified. */
export interface CompletedTranscriptEvidence {
  readonly completedAt: ImportTimestamp;
  readonly cost: {
    readonly certainty: "estimated" | "known";
    readonly currency: "USD";
    readonly estimatedMicroUsd: number;
  };
  readonly detectedLanguage: string;
  readonly dispatchId: string;
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly model: string;
  readonly provider: string;
  readonly segmentsCount: number;
  readonly sourceMediaSha256: string;
  readonly transcriptKey: string;
  readonly transcriptSha256: string;
  readonly usage: {
    readonly audioDurationMilliseconds: number;
    readonly inputBytes: number;
  };
}

/** Generation-fenced durable dispatch claim. */
export type SpeechDispatchClaim =
  | {
      readonly _tag: "Completed";
      readonly evidence: CompletedTranscriptEvidence;
    }
  | {
      readonly _tag: "DispatchClaimed";
      readonly dispatchId: string;
    }
  | {
      readonly _tag: "Failed";
      readonly code: string;
      readonly dispatchId: string;
    }
  | {
      readonly _tag: "ResumeDispatch";
      readonly dispatchId: string;
    };

/** D1 capability needed by the provider-free transcription use case. */
export interface SpeechTranscriptionRepositoryShape {
  readonly claim: (input: {
    readonly dispatchId: string;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly sourceMediaSha256: string;
    readonly startedAt: ImportTimestamp;
  }) => Effect.Effect<SpeechDispatchClaim, ImportTransitionError>;
  readonly complete: (
    evidence: CompletedTranscriptEvidence
  ) => Effect.Effect<CompletedTranscriptEvidence, ImportTransitionError>;
  readonly fail: (input: {
    readonly completedAt: ImportTimestamp;
    readonly dispatchId: string;
    readonly failureCode:
      | "audio_extraction_failed"
      | "outcome_unknown"
      | "source_evidence_invalid"
      | "transcription_failed"
      | "transcript_evidence_failed";
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
  Schema.decodeUnknownEffect(TranscriptionRow, {
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

const completedEvidence = (row: TranscriptionRow) => {
  const estimatedMicroUsd = requiredNumber(row.estimated_cost_micro_usd);
  const segmentsCount = requiredNumber(row.segments_count);
  const audioDurationMilliseconds = requiredNumber(
    row.usage_audio_milliseconds
  );
  const inputBytes = requiredNumber(row.usage_input_bytes);
  if (
    row.state !== "transcribed" ||
    row.completed_at === null ||
    (row.cost_certainty !== "estimated" && row.cost_certainty !== "known") ||
    row.cost_currency !== "USD" ||
    row.detected_language === null ||
    row.model === null ||
    row.provider === null ||
    row.transcript_key === null ||
    row.transcript_sha256 === null ||
    estimatedMicroUsd === undefined ||
    segmentsCount === undefined ||
    audioDurationMilliseconds === undefined ||
    inputBytes === undefined
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
    detectedLanguage: row.detected_language,
    dispatchId: row.dispatch_id,
    generation: row.acquisition_generation,
    importId: row.import_id,
    model: row.model,
    provider: row.provider,
    segmentsCount,
    sourceMediaSha256: row.source_media_sha256,
    transcriptKey: row.transcript_key,
    transcriptSha256: row.transcript_sha256,
    usage: { audioDurationMilliseconds, inputBytes },
  } satisfies CompletedTranscriptEvidence);
};

const claimFromRow = (row: TranscriptionRow, inserted: boolean) => {
  switch (row.state) {
    case "dispatching": {
      return Effect.succeed(
        inserted
          ? ({ _tag: "DispatchClaimed", dispatchId: row.dispatch_id } as const)
          : ({ _tag: "ResumeDispatch", dispatchId: row.dispatch_id } as const)
      );
    }
    case "failed": {
      if (row.failure_code === null) {
        return Effect.fail(importPersistenceCorrupt());
      }
      return Effect.succeed({
        _tag: "Failed",
        code: row.failure_code,
        dispatchId: row.dispatch_id,
      } as const);
    }
    case "transcribed": {
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

/** Build the D1 speech ledger adapter around the existing Meal Planner binding. */
export const makeD1SpeechTranscriptionRepository = (
  binding: AnyD1Database
): SpeechTranscriptionRepositoryShape => ({
  claim: (input) =>
    Effect.gen(function* claimSpeechDispatch() {
      const rawResults = yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `INSERT INTO import_transcriptions (
                 import_id, acquisition_generation, dispatch_id,
                 source_media_sha256, state, created_at, updated_at
               )
               SELECT id, acquisition_generation, ?, ?, 'dispatching', ?, ?
                 FROM recipe_imports
                WHERE id = ? AND acquisition_generation = ?
                  AND status = 'acquired'
                  AND json_extract(evidence_references_json, '$[0].kind') = 'original_media'
                  AND json_extract(evidence_references_json, '$[1].kind') = 'acquisition_manifest'
               ON CONFLICT(import_id, acquisition_generation) DO NOTHING
               RETURNING dispatch_id`
            )
            .bind(
              input.dispatchId,
              input.sourceMediaSha256,
              DateTime.formatIso(input.startedAt),
              DateTime.formatIso(input.startedAt),
              input.importId,
              input.generation
            ),
          binding
            .prepare(
              `SELECT transcription.*
                 FROM import_transcriptions AS transcription
                 JOIN recipe_imports AS parent
                   ON parent.id = transcription.import_id
                  AND parent.acquisition_generation = transcription.acquisition_generation
                WHERE transcription.import_id = ?
                  AND transcription.acquisition_generation = ?
                  AND (
                    (transcription.state = 'dispatching' AND parent.status = 'transcribing')
                    OR (transcription.state = 'transcribed' AND parent.status = 'transcribed')
                    OR (
                      transcription.state = 'failed'
                      AND parent.status = 'failed'
                      AND parent.status_code = 'transcription_failed'
                    )
                  )`
            )
            .bind(input.importId, input.generation),
        ])
      );
      const results = yield* decodeBatchResults(rawResults);
      const [insertResult, selectResult] = results;
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
    Effect.gen(function* completeSpeechDispatch() {
      const rawResults = yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `UPDATE import_transcriptions
                  SET state = 'transcribed', transcript_key = ?,
                      transcript_sha256 = ?, provider = ?, model = ?,
                      detected_language = ?, usage_audio_milliseconds = ?,
                      usage_input_bytes = ?, estimated_cost_micro_usd = ?,
                      cost_currency = ?, cost_certainty = ?, segments_count = ?,
                      failure_code = NULL, completed_at = ?, updated_at = ?
                WHERE import_id = ? AND acquisition_generation = ?
                  AND dispatch_id = ? AND source_media_sha256 = ?
                  AND state = 'dispatching'`
            )
            .bind(
              evidence.transcriptKey,
              evidence.transcriptSha256,
              evidence.provider,
              evidence.model,
              evidence.detectedLanguage,
              evidence.usage.audioDurationMilliseconds,
              evidence.usage.inputBytes,
              evidence.cost.estimatedMicroUsd,
              evidence.cost.currency,
              evidence.cost.certainty,
              evidence.segmentsCount,
              DateTime.formatIso(evidence.completedAt),
              DateTime.formatIso(evidence.completedAt),
              evidence.importId,
              evidence.generation,
              evidence.dispatchId,
              evidence.sourceMediaSha256
            ),
          binding
            .prepare(
              `SELECT transcription.*
                 FROM import_transcriptions AS transcription
                 JOIN recipe_imports AS parent
                   ON parent.id = transcription.import_id
                  AND parent.acquisition_generation = transcription.acquisition_generation
                WHERE transcription.import_id = ?
                  AND transcription.acquisition_generation = ?
                  AND transcription.state = 'transcribed'
                  AND parent.status = 'transcribed'
                  AND json_extract(
                    parent.evidence_references_json,
                    '$[2].referenceId'
                  ) = transcription.transcript_key`
            )
            .bind(evidence.importId, evidence.generation),
        ])
      );
      const results = yield* decodeBatchResults(rawResults);
      const [, selectResult] = results;
      const rawRow = selectResult?.results[0];
      if (rawRow === undefined) {
        return yield* Effect.fail(importTransitionRejected());
      }
      const completed = yield* completedEvidence(yield* decodeRow(rawRow));
      if (
        completed.dispatchId !== evidence.dispatchId ||
        completed.transcriptSha256 !== evidence.transcriptSha256
      ) {
        return yield* Effect.fail(importTransitionRejected());
      }
      return completed;
    }),
  fail: (input) =>
    Effect.gen(function* failSpeechDispatch() {
      yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `UPDATE import_transcriptions
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
      );
    }),
});
