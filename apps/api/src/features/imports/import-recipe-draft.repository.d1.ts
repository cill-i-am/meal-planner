import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Schema } from "effect";

import { AcquisitionGeneration } from "./import-media.model.js";
import {
  RecipeExtraction,
  RecipeExtractorDescriptor,
} from "./import-recipe-extractor.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  importTransitionRejected,
} from "./import.errors.js";
import type { ImportTransitionError } from "./import.repository.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

export const RecipeDraft = Schema.Struct({
  createdAt: ImportTimestamp,
  evidenceFingerprint: Sha256Hex,
  extraction: RecipeExtraction,
  extractionFingerprint: Sha256Hex,
  extractor: RecipeExtractorDescriptor,
  generation: AcquisitionGeneration,
  importId: ImportId,
  lifecycle: Schema.Literal("needs_review"),
  schemaVersion: Schema.Literal(1),
});
export type RecipeDraft = typeof RecipeDraft.Type;

const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(Schema.Number);
const RecipeExtractionRow = Schema.Struct({
  acquisition_generation: AcquisitionGeneration,
  completed_at: NullableString,
  cost_certainty: NullableString,
  cost_currency: NullableString,
  created_at: ImportTimestamp,
  draft_json: NullableString,
  estimated_cost_micro_usd: NullableNumber,
  evidence_fingerprint: Sha256Hex,
  extraction_fingerprint: Sha256Hex,
  extractor_model: Schema.String,
  extractor_provider: Schema.String,
  extractor_version: Schema.String,
  failure_code: NullableString,
  import_id: ImportId,
  input_evidence_items: NullableNumber,
  input_tokens: NullableNumber,
  is_current: Schema.Number,
  latency_milliseconds: NullableNumber,
  model_calls: NullableNumber,
  output_tokens: NullableNumber,
  state: Schema.Literals(["dispatching", "failed", "needs_review"]),
  updated_at: ImportTimestamp,
});
type RecipeExtractionRow = typeof RecipeExtractionRow.Type;

const D1BatchResults = Schema.Array(
  Schema.Struct({ results: Schema.Array(Schema.Unknown) })
);

export type RecipeExtractionFailureCode =
  | "insufficient_evidence"
  | "invalid_schema"
  | "model_refusal"
  | "provider_error";

export type RecipeDispatchClaim =
  | { readonly _tag: "DispatchClaimed" }
  | { readonly _tag: "Failed"; readonly code: RecipeExtractionFailureCode }
  | { readonly _tag: "NeedsReview"; readonly draft: RecipeDraft }
  | { readonly _tag: "ResumeDispatch" };

export interface RecipeDraftRepositoryShape {
  readonly claim: (input: {
    readonly descriptor: RecipeExtractorDescriptor;
    readonly evidenceFingerprint: string;
    readonly extractionFingerprint: string;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly sourceMediaSha256: string;
    readonly startedAt: ImportTimestamp;
    readonly transcriptSha256: string;
    readonly visualManifestSha256: string;
  }) => Effect.Effect<RecipeDispatchClaim, ImportTransitionError>;
  readonly complete: (
    draft: RecipeDraft
  ) => Effect.Effect<RecipeDraft, ImportTransitionError>;
  readonly fail: (input: {
    readonly completedAt: ImportTimestamp;
    readonly extractionFingerprint: string;
    readonly failureCode: RecipeExtractionFailureCode;
  }) => Effect.Effect<void, ImportTransitionError>;
}

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: importPersistenceUnavailable,
    try: () => Promise.resolve(operation()),
  });

const decodeRow = (value: unknown) =>
  Schema.decodeUnknownEffect(RecipeExtractionRow, {
    onExcessProperty: "ignore",
  })(value).pipe(Effect.mapError(() => importPersistenceCorrupt()));

const decodeBatchResults = (value: unknown) =>
  Schema.decodeUnknownEffect(D1BatchResults, {
    onExcessProperty: "ignore",
  })(value).pipe(Effect.mapError(() => importPersistenceCorrupt()));

const decodeDraft = (row: RecipeExtractionRow) =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: () => {
      if (
        row.state !== "needs_review" ||
        row.draft_json === null ||
        row.is_current !== 1
      ) {
        throw new Error("Recipe draft row is not current");
      }
      const draft = Schema.decodeUnknownSync(RecipeDraft, {
        onExcessProperty: "error",
      })(JSON.parse(row.draft_json));
      if (
        draft.extractionFingerprint !== row.extraction_fingerprint ||
        draft.evidenceFingerprint !== row.evidence_fingerprint ||
        draft.importId !== row.import_id ||
        draft.generation !== row.acquisition_generation
      ) {
        throw new Error("Recipe draft identity mismatch");
      }
      return draft;
    },
  });

const failureCode = (value: string | null) => {
  switch (value) {
    case "insufficient_evidence":
    case "invalid_schema":
    case "model_refusal":
    case "provider_error": {
      return value;
    }
    default: {
      return null;
    }
  }
};

const claimFromRow = (row: RecipeExtractionRow, inserted: boolean) => {
  switch (row.state) {
    case "dispatching": {
      return Effect.succeed(
        inserted
          ? ({ _tag: "DispatchClaimed" } as const)
          : ({ _tag: "ResumeDispatch" } as const)
      );
    }
    case "failed": {
      const code = failureCode(row.failure_code);
      return code === null
        ? Effect.fail(importPersistenceCorrupt())
        : Effect.succeed({ _tag: "Failed" as const, code });
    }
    case "needs_review": {
      return Effect.map(decodeDraft(row), (draft) => ({
        _tag: "NeedsReview" as const,
        draft,
      }));
    }
    default: {
      return Effect.fail(importPersistenceCorrupt());
    }
  }
};

/** Generation-fenced, fingerprint-idempotent D1 recipe extraction ledger. */
export const makeD1RecipeDraftRepository = (
  binding: AnyD1Database
): RecipeDraftRepositoryShape => ({
  claim: (input) =>
    Effect.gen(function* claimRecipeExtraction() {
      const raw = yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `INSERT INTO import_recipe_extractions (
                 extraction_fingerprint, import_id, acquisition_generation,
                 evidence_fingerprint, extractor_provider, extractor_model,
                 extractor_version, state, created_at, updated_at
               )
               SELECT ?, parent.id, parent.acquisition_generation, ?, ?, ?, ?,
                      'dispatching', ?, ?
                 FROM recipe_imports AS parent
                 JOIN import_transcriptions AS transcript
                   ON transcript.import_id = parent.id
                  AND transcript.acquisition_generation = parent.acquisition_generation
                 JOIN import_visual_evidence AS visual
                   ON visual.import_id = parent.id
                  AND visual.acquisition_generation = parent.acquisition_generation
                WHERE parent.id = ? AND parent.acquisition_generation = ?
                  AND parent.status = 'transcribed'
                  AND transcript.state = 'transcribed'
                  AND transcript.source_media_sha256 = ?
                  AND transcript.transcript_sha256 = ?
                  AND visual.state = 'completed'
                  AND visual.source_media_sha256 = ?
                  AND visual.manifest_sha256 = ?
               ON CONFLICT(extraction_fingerprint) DO NOTHING
               RETURNING extraction_fingerprint`
            )
            .bind(
              input.extractionFingerprint,
              input.evidenceFingerprint,
              input.descriptor.provider,
              input.descriptor.model,
              input.descriptor.version,
              DateTime.formatIso(input.startedAt),
              DateTime.formatIso(input.startedAt),
              input.importId,
              input.generation,
              input.sourceMediaSha256,
              input.transcriptSha256,
              input.sourceMediaSha256,
              input.visualManifestSha256
            ),
          binding
            .prepare(
              `SELECT * FROM import_recipe_extractions
                WHERE extraction_fingerprint = ?`
            )
            .bind(input.extractionFingerprint),
        ])
      );
      const [insert, select] = yield* decodeBatchResults(raw);
      const rawRow = select?.results[0];
      if (insert === undefined || rawRow === undefined) {
        return yield* Effect.fail(importTransitionRejected());
      }
      const row = yield* decodeRow(rawRow);
      if (
        row.import_id !== input.importId ||
        row.acquisition_generation !== input.generation ||
        row.evidence_fingerprint !== input.evidenceFingerprint ||
        row.extractor_provider !== input.descriptor.provider ||
        row.extractor_model !== input.descriptor.model ||
        row.extractor_version !== input.descriptor.version
      ) {
        return yield* Effect.fail(importTransitionRejected());
      }
      return yield* claimFromRow(row, insert.results.length === 1);
    }),
  complete: (draft) =>
    Effect.gen(function* completeRecipeExtraction() {
      const encodedDraft = JSON.stringify(
        Schema.encodeSync(RecipeDraft)(draft)
      );
      const usage = draft.extraction.usage;
      const cost = draft.extraction.cost;
      const raw = yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `UPDATE import_recipe_extractions
                  SET state = 'needs_review', draft_json = ?,
                      input_evidence_items = ?, input_tokens = ?, output_tokens = ?,
                      model_calls = ?, latency_milliseconds = ?,
                      estimated_cost_micro_usd = ?, cost_currency = ?,
                      cost_certainty = ?, completed_at = ?, updated_at = ?
                WHERE extraction_fingerprint = ? AND import_id = ?
                  AND acquisition_generation = ? AND state = 'dispatching'`
            )
            .bind(
              encodedDraft,
              usage.inputEvidenceItems,
              usage.inputTokens,
              usage.outputTokens,
              usage.modelCalls,
              usage.latencyMilliseconds,
              cost.estimatedMicroUsd,
              cost.currency,
              cost.certainty,
              DateTime.formatIso(draft.createdAt),
              DateTime.formatIso(draft.createdAt),
              draft.extractionFingerprint,
              draft.importId,
              draft.generation
            ),
          binding
            .prepare(
              `UPDATE import_recipe_extractions
                  SET is_current = 0
                WHERE import_id = ? AND acquisition_generation = ?
                  AND is_current = 1
                  AND EXISTS (
                    SELECT 1 FROM import_recipe_extractions AS target
                     WHERE target.extraction_fingerprint = ?
                       AND target.state = 'needs_review'
                  )`
            )
            .bind(
              draft.importId,
              draft.generation,
              draft.extractionFingerprint
            ),
          binding
            .prepare(
              `UPDATE import_recipe_extractions
                  SET is_current = 1
                WHERE extraction_fingerprint = ? AND import_id = ?
                  AND acquisition_generation = ? AND state = 'needs_review'`
            )
            .bind(
              draft.extractionFingerprint,
              draft.importId,
              draft.generation
            ),
          binding
            .prepare(
              `SELECT * FROM import_recipe_extractions
                WHERE extraction_fingerprint = ? AND is_current = 1`
            )
            .bind(draft.extractionFingerprint),
        ])
      );
      const results = yield* decodeBatchResults(raw);
      const rawRow = results[3]?.results[0];
      if (rawRow === undefined) {
        return yield* Effect.fail(importTransitionRejected());
      }
      return yield* decodeDraft(yield* decodeRow(rawRow));
    }),
  fail: (input) =>
    persistenceEffect(() =>
      binding.batch([
        binding
          .prepare(
            `UPDATE import_recipe_extractions
                SET state = 'failed', failure_code = ?, completed_at = ?, updated_at = ?
              WHERE extraction_fingerprint = ? AND state = 'dispatching'`
          )
          .bind(
            input.failureCode,
            DateTime.formatIso(input.completedAt),
            DateTime.formatIso(input.completedAt),
            input.extractionFingerprint
          ),
      ])
    ).pipe(Effect.asVoid),
});
