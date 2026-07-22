import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Option, Schema } from "effect";

import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import {
  PlanningTags,
  RecipeCorrection,
  RecipeCorrectionValue,
  RecipeReviewLifecycle,
  RecipeReviewTransition,
  RecipeReviewVersion,
  RecipeReviewView,
  recipeReviewNullablePolicy,
  recipeReviewTransitionRejected,
  recipeReviewVersionConflict,
} from "./import-recipe-review.js";
import type {
  RecipeReviewRepositoryShape,
  RecipeReviewWriteError,
} from "./import-recipe-review.js";
import { EvidenceReference, ImportId } from "./import.contracts.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
} from "./import.errors.js";

const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(Schema.Number);
const ReviewSourceRow = Schema.Struct({
  draft_json: Schema.String,
  evidence_references_json: Schema.String,
  extraction_fingerprint: Schema.String,
  lifecycle: NullableString,
  tags_json: NullableString,
  version: NullableNumber,
});
type ReviewSourceRow = typeof ReviewSourceRow.Type;

const CorrectionRow = Schema.Struct({
  actor_id: Schema.String,
  after_json: Schema.String,
  before_json: Schema.String,
  corrected_at: Schema.String,
  field: Schema.String,
  reason: Schema.String,
  version: Schema.Number,
});

const TransitionRow = Schema.Struct({
  actor_id: Schema.String,
  from_lifecycle: Schema.String,
  reason: Schema.String,
  to_lifecycle: Schema.String,
  transitioned_at: Schema.String,
  version: Schema.Number,
});

const D1BatchResults = Schema.Array(
  Schema.Struct({ results: Schema.Array(Schema.Unknown) })
);

const ApprovedImportRow = Schema.Struct({ import_id: ImportId });

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: importPersistenceUnavailable,
    try: () => Promise.resolve(operation()),
  });

const decode = <S extends Schema.Top>(schema: S, value: unknown) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "ignore" })(
    value
  ).pipe(Effect.mapError(() => importPersistenceCorrupt()));

const decodeJson = <S extends Schema.Top>(schema: S, value: string) =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: () => JSON.parse(value) as unknown,
  }).pipe(Effect.flatMap((json) => decode(schema, json)));

const decodeCorrection = (value: unknown) =>
  Effect.gen(function* decodeCorrectionRow() {
    const row = yield* decode(CorrectionRow, value);
    const before = yield* decodeJson(
      Schema.NullOr(RecipeCorrectionValue),
      row.before_json
    );
    const after = yield* decodeJson(RecipeCorrectionValue, row.after_json);
    return yield* decode(RecipeCorrection, {
      actorId: row.actor_id,
      after,
      before,
      correctedAt: row.corrected_at,
      field: row.field,
      reason: row.reason,
      version: row.version,
    });
  });

const decodeTransition = (value: unknown) =>
  Effect.gen(function* decodeTransitionRow() {
    const row = yield* decode(TransitionRow, value);
    return yield* decode(RecipeReviewTransition, {
      actorId: row.actor_id,
      from: row.from_lifecycle,
      reason: row.reason,
      to: row.to_lifecycle,
      transitionedAt: row.transitioned_at,
      version: row.version,
    });
  });

const unresolvedRequiredFields = (
  draft: RecipeDraft,
  corrections: readonly RecipeCorrection[]
) => {
  const corrected = new Set(corrections.map(({ field }) => field));
  return (["name", "ingredient_lines", "instructions"] as const).filter(
    (field) =>
      draft.extraction.unresolvedFields.includes(field) && !corrected.has(field)
  );
};

const reviewFromRows = (
  sourceValue: unknown,
  correctionValues: readonly unknown[],
  transitionValues: readonly unknown[]
) =>
  Effect.gen(function* decodeReview() {
    const source = yield* decode(ReviewSourceRow, sourceValue);
    const draft = yield* decodeJson(RecipeDraft, source.draft_json);
    if (draft.extractionFingerprint !== source.extraction_fingerprint) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    const evidence = yield* decodeJson(
      Schema.Array(EvidenceReference),
      source.evidence_references_json
    );
    const corrections = yield* Effect.forEach(
      correctionValues,
      decodeCorrection
    );
    const transitions = yield* Effect.forEach(
      transitionValues,
      decodeTransition
    );
    const lifecycle =
      source.lifecycle === null
        ? "needs_review"
        : yield* decode(RecipeReviewLifecycle, source.lifecycle);
    const version =
      source.version === null
        ? 0
        : yield* decode(RecipeReviewVersion, source.version);
    const tags =
      source.tags_json === null
        ? null
        : yield* decodeJson(PlanningTags, source.tags_json);
    return {
      corrections,
      draft,
      evidence,
      lifecycle,
      nullablePolicy: recipeReviewNullablePolicy,
      tags,
      transitions,
      unresolvedRequiredFields: unresolvedRequiredFields(draft, corrections),
      version,
    } satisfies RecipeReviewView;
  });

const sourceSelect = (where: string) => `
  SELECT extraction.draft_json, parent.evidence_references_json,
         extraction.extraction_fingerprint, review.lifecycle,
         review.version, review.tags_json
    FROM import_recipe_extractions AS extraction
    JOIN recipe_imports AS parent ON parent.id = extraction.import_id
    LEFT JOIN recipe_reviews AS review
      ON review.extraction_fingerprint = extraction.extraction_fingerprint
   WHERE extraction.state = 'needs_review' AND extraction.draft_json IS NOT NULL
     AND ${where}`;

const readReview = (
  binding: AnyD1Database,
  where:
    | { readonly extractionFingerprint: string }
    | { readonly importId: ImportId }
) =>
  Effect.gen(function* readRecipeReview() {
    const byImport = "importId" in where;
    const value = byImport ? where.importId : where.extractionFingerprint;
    const sourceSql = byImport
      ? sourceSelect("extraction.import_id = ? AND extraction.is_current = 1")
      : sourceSelect("extraction.extraction_fingerprint = ?");
    const raw = yield* persistenceEffect(() =>
      binding.batch([
        binding.prepare(sourceSql).bind(value),
        binding
          .prepare(
            `SELECT correction.actor_id, correction.after_json,
                    correction.before_json, correction.corrected_at,
                    correction.field, correction.reason, correction.version
               FROM recipe_review_corrections AS correction
               JOIN import_recipe_extractions AS extraction
                 ON extraction.extraction_fingerprint = correction.extraction_fingerprint
              WHERE ${
                byImport
                  ? "extraction.import_id = ? AND extraction.is_current = 1"
                  : "extraction.extraction_fingerprint = ?"
              }
              ORDER BY correction.version`
          )
          .bind(value),
        binding
          .prepare(
            `SELECT transition.actor_id, transition.from_lifecycle,
                    transition.reason, transition.to_lifecycle,
                    transition.transitioned_at, transition.version
               FROM recipe_review_transitions AS transition
               JOIN import_recipe_extractions AS extraction
                 ON extraction.extraction_fingerprint = transition.extraction_fingerprint
              WHERE ${
                byImport
                  ? "extraction.import_id = ? AND extraction.is_current = 1"
                  : "extraction.extraction_fingerprint = ?"
              }
              ORDER BY transition.version`
          )
          .bind(value),
      ])
    );
    const results = yield* decode(D1BatchResults, raw);
    const source = results[0]?.results[0];
    if (source === undefined) {
      return Option.none<RecipeReviewView>();
    }
    return Option.some(
      yield* reviewFromRows(
        source,
        results[1]?.results ?? [],
        results[2]?.results ?? []
      )
    );
  });

const reviewAfterCas = (
  binding: AnyD1Database,
  extractionFingerprint: string,
  expectedVersion: RecipeReviewVersion,
  expectedLifecycle: RecipeReviewLifecycle,
  updated: boolean
): Effect.Effect<RecipeReviewView, RecipeReviewWriteError> =>
  Effect.gen(function* readAfterReviewCas() {
    const reviewOption = yield* readReview(binding, {
      extractionFingerprint,
    });
    if (Option.isNone(reviewOption)) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    const review = reviewOption.value;
    if (updated) return review;
    if (review.version !== expectedVersion) {
      return yield* Effect.fail(
        recipeReviewVersionConflict(expectedVersion, review.version)
      );
    }
    return yield* Effect.fail(
      recipeReviewTransitionRejected(
        review.lifecycle === expectedLifecycle
          ? expectedLifecycle
          : review.lifecycle
      )
    );
  });

/** D1-backed optimistic review ledger with append-only correction and transition audit rows. */
export const makeD1RecipeReviewRepository = (
  binding: AnyD1Database
): RecipeReviewRepositoryShape => ({
  correct: (input) =>
    Effect.gen(function* correctRecipeReview() {
      const correctedAt = DateTime.formatIso(input.correction.correctedAt);
      const mutationId = `${input.correction.actorId}:${correctedAt}:${input.correction.version}:correction`;
      const tagsAfter = JSON.stringify(
        Schema.encodeSync(PlanningTags)(input.tags)
      );
      const tagsBefore = JSON.stringify(
        input.previousTags === null
          ? null
          : Schema.encodeSync(PlanningTags)(input.previousTags)
      );
      const raw = yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `INSERT INTO recipe_reviews (
                 extraction_fingerprint, lifecycle, version, tags_json,
                 last_mutation_id, created_at, updated_at
               )
               SELECT extraction_fingerprint, 'needs_review', 0, NULL, NULL, ?, ?
                 FROM import_recipe_extractions
                WHERE extraction_fingerprint = ? AND is_current = 1
                  AND state = 'needs_review'
               ON CONFLICT(extraction_fingerprint) DO NOTHING`
            )
            .bind(correctedAt, correctedAt, input.extractionFingerprint),
          binding
            .prepare(
              `UPDATE recipe_reviews
                  SET version = version + 1, tags_json = ?,
                      last_mutation_id = ?, updated_at = ?
                WHERE extraction_fingerprint = ? AND version = ?
                  AND lifecycle = 'needs_review'
                  AND EXISTS (
                    SELECT 1 FROM import_recipe_extractions AS extraction
                     WHERE extraction.extraction_fingerprint = recipe_reviews.extraction_fingerprint
                       AND extraction.is_current = 1 AND extraction.state = 'needs_review'
                  )
               RETURNING version`
            )
            .bind(
              tagsAfter,
              mutationId,
              correctedAt,
              input.extractionFingerprint,
              input.expectedVersion
            ),
          binding
            .prepare(
              `INSERT OR IGNORE INTO recipe_review_corrections (
                 extraction_fingerprint, version, actor_id, field,
                 before_json, after_json, reason, tags_before_json,
                 tags_after_json, corrected_at
               )
               SELECT extraction_fingerprint, version, ?, ?, ?, ?, ?,
                      ?, ?, ?
                 FROM recipe_reviews
                WHERE extraction_fingerprint = ? AND version = ?
                  AND last_mutation_id = ?`
            )
            .bind(
              input.correction.actorId,
              input.correction.field,
              JSON.stringify(input.correction.before),
              JSON.stringify(input.correction.after),
              input.correction.reason,
              tagsBefore,
              tagsAfter,
              correctedAt,
              input.extractionFingerprint,
              input.correction.version,
              mutationId
            ),
        ])
      );
      const results = yield* decode(D1BatchResults, raw);
      return yield* reviewAfterCas(
        binding,
        input.extractionFingerprint,
        input.expectedVersion,
        "needs_review",
        (results[1]?.results.length ?? 0) === 1
      );
    }),
  find: (importId) => readReview(binding, { importId }),
  listApproved: () =>
    Effect.gen(function* listApprovedRecipeReviews() {
      const raw = yield* persistenceEffect(() =>
        binding
          .prepare(
            `SELECT extraction.import_id
               FROM recipe_reviews AS review
               JOIN import_recipe_extractions AS extraction
                 ON extraction.extraction_fingerprint = review.extraction_fingerprint
              WHERE review.lifecycle = 'approved'
                AND extraction.is_current = 1
              ORDER BY review.updated_at, extraction.import_id`
          )
          .all()
      );
      const rows = yield* decode(
        Schema.Struct({ results: Schema.Array(ApprovedImportRow) }),
        raw
      );
      const reviews = yield* Effect.forEach(rows.results, ({ import_id }) =>
        readReview(binding, { importId: import_id })
      );
      return reviews.flatMap((review) =>
        Option.isSome(review) ? [review.value] : []
      );
    }),
  transition: (input) =>
    Effect.gen(function* transitionRecipeReview() {
      const { transition } = input;
      const transitionedAt = DateTime.formatIso(transition.transitionedAt);
      const mutationId = `${transition.actorId}:${transitionedAt}:${transition.version}:${transition.to}`;
      const raw = yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `INSERT INTO recipe_reviews (
                 extraction_fingerprint, lifecycle, version, tags_json,
                 last_mutation_id, created_at, updated_at
               )
               SELECT extraction_fingerprint, 'needs_review', 0, NULL, NULL, ?, ?
                 FROM import_recipe_extractions
                WHERE extraction_fingerprint = ? AND is_current = 1
                  AND state = 'needs_review'
               ON CONFLICT(extraction_fingerprint) DO NOTHING`
            )
            .bind(transitionedAt, transitionedAt, input.extractionFingerprint),
          binding
            .prepare(
              `UPDATE recipe_reviews
                  SET lifecycle = ?, version = version + 1,
                      last_mutation_id = ?, updated_at = ?
                WHERE extraction_fingerprint = ? AND version = ?
                  AND lifecycle = ?
                  AND EXISTS (
                    SELECT 1 FROM import_recipe_extractions AS extraction
                     WHERE extraction.extraction_fingerprint = recipe_reviews.extraction_fingerprint
                       AND extraction.is_current = 1 AND extraction.state = 'needs_review'
                  )
               RETURNING version`
            )
            .bind(
              transition.to,
              mutationId,
              transitionedAt,
              input.extractionFingerprint,
              input.expectedVersion,
              transition.from
            ),
          binding
            .prepare(
              `INSERT OR IGNORE INTO recipe_review_transitions (
                 extraction_fingerprint, version, actor_id, from_lifecycle,
                 to_lifecycle, reason, transitioned_at
               )
               SELECT extraction_fingerprint, version, ?, ?, ?, ?, ?
                 FROM recipe_reviews
                WHERE extraction_fingerprint = ? AND version = ?
                  AND last_mutation_id = ?`
            )
            .bind(
              transition.actorId,
              transition.from,
              transition.to,
              transition.reason,
              transitionedAt,
              input.extractionFingerprint,
              transition.version,
              mutationId
            ),
        ])
      );
      const results = yield* decode(D1BatchResults, raw);
      return yield* reviewAfterCas(
        binding,
        input.extractionFingerprint,
        input.expectedVersion,
        transition.from,
        (results[1]?.results.length ?? 0) === 1
      );
    }),
});
