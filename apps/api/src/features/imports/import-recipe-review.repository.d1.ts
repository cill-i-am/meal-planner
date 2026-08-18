import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Option, Schema } from "effect";

import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import {
  PlanningTags,
  RecipeCorrection,
  RecipeCorrectionValue,
  RecipeReviewLifecycle,
  RecipeReviewTransition,
  RecipeReviewVersion,
  refineRecipeReview,
  recipeReviewNullablePolicy,
} from "./import-recipe-review.js";
import type {
  RecipeReviewRepository,
  Review,
  RecipeReviewView,
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
type CorrectionRow = typeof CorrectionRow.Type;

const TransitionRow = Schema.Struct({
  actor_id: Schema.String,
  from_lifecycle: Schema.String,
  reason: Schema.String,
  to_lifecycle: Schema.String,
  transitioned_at: Schema.String,
  version: Schema.Number,
});
type TransitionRow = typeof TransitionRow.Type;

const D1ReviewRows = Schema.Tuple([
  Schema.Struct({ results: Schema.Array(ReviewSourceRow) }),
  Schema.Struct({ results: Schema.Array(CorrectionRow) }),
  Schema.Struct({ results: Schema.Array(TransitionRow) }),
]);

const ApprovedImportRow = Schema.Struct({ import_id: ImportId });

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: importPersistenceUnavailable,
    try: () => Promise.resolve(operation()),
  });

const decodeJson = <S extends Schema.Top>(schema: S, value: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema), {
    onExcessProperty: "ignore",
  })(value).pipe(Effect.mapError(() => importPersistenceCorrupt()));

const decodeCorrection = (row: CorrectionRow) =>
  Effect.gen(function* decodeCorrectionRow() {
    const before = yield* decodeJson(
      Schema.NullOr(RecipeCorrectionValue),
      row.before_json
    );
    const after = yield* decodeJson(RecipeCorrectionValue, row.after_json);
    return yield* Schema.decodeUnknownEffect(RecipeCorrection, {
      onExcessProperty: "ignore",
    })({
      actorId: row.actor_id,
      after,
      before,
      correctedAt: row.corrected_at,
      field: row.field,
      reason: row.reason,
      version: row.version,
    }).pipe(Effect.mapError(() => importPersistenceCorrupt()));
  });

const decodeTransition = (row: TransitionRow) =>
  Effect.gen(function* decodeTransitionRow() {
    return yield* Schema.decodeUnknownEffect(RecipeReviewTransition, {
      onExcessProperty: "ignore",
    })({
      actorId: row.actor_id,
      from: row.from_lifecycle,
      reason: row.reason,
      to: row.to_lifecycle,
      transitionedAt: row.transitioned_at,
      version: row.version,
    }).pipe(Effect.mapError(() => importPersistenceCorrupt()));
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
  source: ReviewSourceRow,
  correctionsRows: readonly CorrectionRow[],
  transitionRows: readonly TransitionRow[]
) =>
  Effect.gen(function* decodeReview() {
    const draft = yield* decodeJson(RecipeDraft, source.draft_json);
    if (draft.extractionFingerprint !== source.extraction_fingerprint) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    const evidence = yield* decodeJson(
      Schema.Array(EvidenceReference),
      source.evidence_references_json
    );
    const corrections =
      yield* Effect.forEach(decodeCorrection)(correctionsRows);
    const transitions = yield* Effect.forEach(decodeTransition)(transitionRows);
    const lifecycle =
      source.lifecycle === null
        ? "needs_review"
        : yield* Schema.decodeUnknownEffect(RecipeReviewLifecycle)(
            source.lifecycle
          ).pipe(Effect.mapError(() => importPersistenceCorrupt()));
    const version =
      source.version === null
        ? 0
        : yield* Schema.decodeUnknownEffect(RecipeReviewVersion)(
            source.version
          ).pipe(Effect.mapError(() => importPersistenceCorrupt()));
    const tags =
      source.tags_json === null
        ? null
        : yield* decodeJson(PlanningTags, source.tags_json);
    const view = {
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
    return yield* Option.match(refineRecipeReview(view), {
      onNone: () => Effect.fail(importPersistenceCorrupt()),
      onSome: Effect.succeed,
    });
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
              ORDER BY correction.version, correction.ordinal`
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
    const [sources, corrections, transitions] =
      yield* Schema.decodeUnknownEffect(D1ReviewRows, {
        onExcessProperty: "ignore",
      })(raw).pipe(Effect.mapError(() => importPersistenceCorrupt()));
    const [source] = sources.results;
    if (source === undefined) {
      return Option.none<Review>();
    }
    return Option.some(
      yield* reviewFromRows(source, corrections.results, transitions.results)
    );
  });

/** D1-backed recipe review read model. */
export const makeD1RecipeReviewRepository = (
  binding: AnyD1Database
): RecipeReviewRepository => ({
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
      const rows = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ results: Schema.Array(ApprovedImportRow) }),
        { onExcessProperty: "ignore" }
      )(raw).pipe(Effect.mapError(() => importPersistenceCorrupt()));
      const reviews = yield* Effect.forEach(({ import_id }) =>
        readReview(binding, { importId: import_id })
      )(rows.results);
      return reviews.flatMap((review) =>
        Option.isSome(review) ? [review.value] : []
      );
    }),
});
