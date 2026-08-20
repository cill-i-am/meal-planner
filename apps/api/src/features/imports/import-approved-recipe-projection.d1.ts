import type { RecipeImportHouseholdScopeId } from "@meal-planner/recipe-import-api";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";
import { Data, Effect, Option, Schema } from "effect";

import { Sha256Hex } from "./import-media.model.js";
import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import {
  ApprovedRecipe,
  applyCorrectionOverlay,
  PlanningTags,
  RecipeReviewVersion,
} from "./import-recipe-review.js";
import type { RecipeReviewPersistenceError } from "./import-recipe-review.js";
import type { ImportId as ImportIdType } from "./import.contracts.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import {
  importRecipeExtractions,
  recipeImports,
  recipeReviewCorrections,
  recipeReviews,
  recipeReviewTransitions,
} from "./import.database-schema.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
} from "./import.errors.js";

const ProjectionSourceRow = Schema.Struct({
  draftJson: Schema.String,
  extractionFingerprint: Sha256Hex,
  importId: ImportId,
  tagsJson: Schema.String,
  version: RecipeReviewVersion,
});
type ProjectionSourceRow = typeof ProjectionSourceRow.Type;

const CandidateSourceRow = Schema.Struct({
  extractionFingerprint: Sha256Hex,
  importId: Schema.NullOr(Schema.String),
  importIdBytes: Schema.Number,
  tagsBytes: Schema.Number,
  tagsJson: Schema.NullOr(Schema.String),
  version: RecipeReviewVersion,
});

export const ApprovedRecipeAuthorityToken = Schema.Struct({
  extractionFingerprint: Sha256Hex,
  reviewVersion: RecipeReviewVersion,
  tagsFingerprint: Sha256Hex,
});
export type ApprovedRecipeAuthorityToken =
  typeof ApprovedRecipeAuthorityToken.Type;

export const ApprovedRecipeCandidateFact = Schema.Struct({
  authorityToken: ApprovedRecipeAuthorityToken,
  importId: ImportId,
  tags: PlanningTags,
});
export type ApprovedRecipeCandidateFact =
  typeof ApprovedRecipeCandidateFact.Type;

export interface ApprovedRecipeCandidateCatalogue {
  readonly pages: readonly (readonly ApprovedRecipeCandidateFact[])[];
}

/** One persisted candidate tag projection exceeds the safe decode budget. */
export const ApprovedRecipeCandidatePageTooLarge = Data.TaggedError(
  "ApprovedRecipeCandidatePageTooLarge"
);
export type ApprovedRecipeCandidatePageTooLarge = InstanceType<
  typeof ApprovedRecipeCandidatePageTooLarge
>;

/** D1's per-invocation query budget cannot complete another candidate page. */
export const ApprovedRecipeCandidateQueryCapacityExceeded = Data.TaggedError(
  "ApprovedRecipeCandidateQueryCapacityExceeded"
);
export type ApprovedRecipeCandidateQueryCapacityExceeded = InstanceType<
  typeof ApprovedRecipeCandidateQueryCapacityExceeded
>;

/** The approved authority changed between candidate discovery and hydration. */
export const ApprovedRecipeAuthorityMismatch = Data.TaggedError(
  "ApprovedRecipeAuthorityMismatch"
);
export type ApprovedRecipeAuthorityMismatch = InstanceType<
  typeof ApprovedRecipeAuthorityMismatch
>;

/** A selected projection cannot fit safely within one Worker invocation. */
export const ApprovedRecipeProjectionTooLarge = Data.TaggedError(
  "ApprovedRecipeProjectionTooLarge"
);
export type ApprovedRecipeProjectionTooLarge = InstanceType<
  typeof ApprovedRecipeProjectionTooLarge
>;

export const ApprovedRecipeCandidatePageSize = 256;
export const MaximumApprovedRecipeCandidatePages = 8;
// Candidate discovery uses one native transactional D1 batch containing eight
// static Drizzle SELECTs and selected hydration uses five more statements. Two
// complete passes for the composition-owned authority retry therefore use 26
// of D1 Free's 50-query invocation limit.
export const MaximumDiscoverableApprovedRecipes =
  ApprovedRecipeCandidatePageSize * MaximumApprovedRecipeCandidatePages;
const MaximumCandidateTagsJsonBytes = 4096;
const MaximumSelectedRecipeJsonBytes = 65_536;
export const MaximumApprovedRecipeSelections = 31;
// ImportId admits the canonical UUID text form: exactly 36 ASCII/UTF-8 bytes.
const EncodedImportIdBytes = 36;
// ImportTimestamp encodes through DateTime.formatIso / Date.toISOString. UTC
// ISO text is at most 27 ASCII/UTF-8 bytes when JavaScript uses an extended
// signed six-digit year.
const MaximumEncodedImportTimestampBytes = 27;

type RelevantCorrectionField = "name" | "ingredient_lines" | "instructions";
const RelevantCorrectionFields: readonly RelevantCorrectionField[] = [
  "name",
  "ingredient_lines",
  "instructions",
];

const RelevantCorrectionField = Schema.Literals(RelevantCorrectionFields);
const ProjectionText = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(4096)
  )
);
const ProjectionTextList = Schema.NonEmptyArray(ProjectionText).pipe(
  Schema.check(Schema.isMaxLength(256))
);

const BatchSourcePreflightRow = Schema.Struct({
  draftBytes: Schema.Number,
  extractionFingerprint: Sha256Hex,
  importId: ImportId,
  tagsBytes: Schema.Number,
  version: RecipeReviewVersion,
});

const BatchCorrectionPreflightRow = Schema.Struct({
  afterBytes: Schema.Number,
  extractionFingerprint: Sha256Hex,
  field: RelevantCorrectionField,
});

const BatchCorrectionRow = Schema.Struct({
  afterJson: Schema.String,
  extractionFingerprint: Sha256Hex,
  field: RelevantCorrectionField,
});
type BatchCorrectionRow = typeof BatchCorrectionRow.Type;

const BatchTransitionSourceRow = Schema.Struct({
  extractionFingerprint: Sha256Hex,
  to: Schema.String,
  transitionedAt: Schema.NullOr(Schema.String),
  transitionedAtBytes: Schema.Number,
  version: RecipeReviewVersion,
});
const BatchTransitionRow = Schema.Struct({
  extractionFingerprint: Sha256Hex,
  to: Schema.String,
  transitionedAt: ImportTimestamp,
  version: RecipeReviewVersion,
});
type BatchTransitionRow = typeof BatchTransitionRow.Type;

const ExactCandidateSourceRow = Schema.Struct({
  extractionFingerprint: Sha256Hex,
  tagsBytes: Schema.Number,
  tagsJson: Schema.NullOr(Schema.String),
  version: RecipeReviewVersion,
});

export const ApprovedRecipeSelection = Schema.Struct({
  authorityToken: ApprovedRecipeAuthorityToken,
  importId: ImportId,
});
export type ApprovedRecipeSelection = typeof ApprovedRecipeSelection.Type;

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: importPersistenceUnavailable,
    try: () => Promise.resolve(operation()),
  });

const decodeJson = <S extends Schema.Top>(schema: S, value: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema), {
    onExcessProperty: "ignore",
  })(value).pipe(Effect.mapError(() => importPersistenceCorrupt()));

const sha256Text = (value: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(Sha256Hex)),
    Effect.mapError(() => importPersistenceCorrupt())
  );

const candidateCatalogueQuery = (
  binding: AnyD1Database,
  householdScopeId: RecipeImportHouseholdScopeId,
  offset: number,
  limit: number
) =>
  drizzle(binding)
    .select({
      extractionFingerprint: importRecipeExtractions.extractionFingerprint,
      importId: sql<
        string | null
      >`case when length(cast(${recipeImports.id} as blob)) = ${EncodedImportIdBytes} then ${recipeImports.id} else null end`,
      importIdBytes: sql<number>`length(cast(${recipeImports.id} as blob))`,
      tagsBytes: sql<number>`length(cast(${recipeReviews.tagsJson} as blob))`,
      tagsJson: sql<string | null>`case
        when length(cast(${recipeReviews.tagsJson} as blob)) <= ${MaximumCandidateTagsJsonBytes}
        then ${recipeReviews.tagsJson}
        else null
      end`,
      version: recipeReviews.version,
    })
    .from(recipeImports)
    .innerJoin(
      importRecipeExtractions,
      and(
        eq(importRecipeExtractions.importId, recipeImports.id),
        eq(
          importRecipeExtractions.acquisitionGeneration,
          recipeImports.acquisitionGeneration
        ),
        eq(importRecipeExtractions.isCurrent, 1),
        eq(importRecipeExtractions.state, "needs_review"),
        isNotNull(importRecipeExtractions.draftJson)
      )
    )
    .innerJoin(
      recipeReviews,
      and(
        eq(
          recipeReviews.extractionFingerprint,
          importRecipeExtractions.extractionFingerprint
        ),
        eq(recipeReviews.lifecycle, "approved"),
        isNotNull(recipeReviews.tagsJson)
      )
    )
    .where(eq(recipeImports.householdScopeId, householdScopeId))
    .orderBy(asc(recipeImports.id))
    .limit(limit)
    .offset(offset);

/**
 * Read one coherent, bounded snapshot of all current approved candidate facts.
 *
 * Eight static ordered Drizzle SELECTs execute through D1's native
 * transactional batch. The final statement requests one lookahead row, so the
 * 2,049th candidate returns an explicit capacity outcome rather than being
 * silently truncated. Oversized tags are replaced with NULL inside SQLite;
 * their raw JSON never crosses the seam.
 */
export const readCurrentApprovedRecipeCandidateCatalogue = (
  binding: AnyD1Database,
  householdScopeId: RecipeImportHouseholdScopeId
): Effect.Effect<
  ApprovedRecipeCandidateCatalogue,
  | ApprovedRecipeAuthorityMismatch
  | ApprovedRecipeCandidatePageTooLarge
  | ApprovedRecipeCandidateQueryCapacityExceeded
  | RecipeReviewPersistenceError
> =>
  Effect.gen(function* readApprovedCandidateCatalogue() {
    const database = drizzle(binding);
    const rawPages = yield* persistenceEffect(() =>
      database.batch([
        candidateCatalogueQuery(binding, householdScopeId, 0, 256),
        candidateCatalogueQuery(binding, householdScopeId, 256, 256),
        candidateCatalogueQuery(binding, householdScopeId, 512, 256),
        candidateCatalogueQuery(binding, householdScopeId, 768, 256),
        candidateCatalogueQuery(binding, householdScopeId, 1024, 256),
        candidateCatalogueQuery(binding, householdScopeId, 1280, 256),
        candidateCatalogueQuery(binding, householdScopeId, 1536, 256),
        candidateCatalogueQuery(binding, householdScopeId, 1792, 257),
      ])
    );
    const pages = yield* Effect.forEach(
      rawPages,
      (rawRows, pageIndex) =>
        Effect.gen(function* decodeCandidatePage() {
          const rows = yield* Schema.decodeUnknownEffect(
            Schema.Array(CandidateSourceRow),
            { onExcessProperty: "ignore" }
          )(rawRows).pipe(Effect.mapError(() => importPersistenceCorrupt()));
          if (
            pageIndex === MaximumApprovedRecipeCandidatePages - 1 &&
            rows.length > ApprovedRecipeCandidatePageSize
          ) {
            return yield* new ApprovedRecipeCandidateQueryCapacityExceeded(
              undefined
            );
          }
          return yield* Effect.forEach(
            rows,
            (row) =>
              Effect.gen(function* decodeCandidateFact() {
                if (
                  row.importIdBytes !== EncodedImportIdBytes ||
                  row.importId === null
                ) {
                  return yield* Effect.fail(importPersistenceCorrupt());
                }
                if (
                  row.tagsBytes > MaximumCandidateTagsJsonBytes ||
                  row.tagsJson === null
                ) {
                  return yield* new ApprovedRecipeCandidatePageTooLarge(
                    undefined
                  );
                }
                return ApprovedRecipeCandidateFact.make({
                  authorityToken: {
                    extractionFingerprint: row.extractionFingerprint,
                    reviewVersion: row.version,
                    tagsFingerprint: yield* sha256Text(row.tagsJson),
                  },
                  importId: yield* Schema.decodeUnknownEffect(ImportId)(
                    row.importId
                  ).pipe(Effect.mapError(() => importPersistenceCorrupt())),
                  tags: yield* decodeJson(PlanningTags, row.tagsJson),
                });
              }),
            { concurrency: 1 }
          );
        }),
      { concurrency: 1 }
    );
    return { pages: pages.filter((page) => page.length > 0) };
  });

const decodeRows = <S extends Schema.Top>(schema: S, rows: object) =>
  Schema.decodeUnknownEffect(Schema.Array(schema), {
    onExcessProperty: "ignore",
  })(rows).pipe(Effect.mapError(() => importPersistenceCorrupt()));

const distinctSelections = (
  selections: readonly ApprovedRecipeSelection[]
): Effect.Effect<
  readonly ApprovedRecipeSelection[],
  ApprovedRecipeAuthorityMismatch
> =>
  Effect.gen(function* distinctApprovedSelections() {
    const byImportId = new Map<string, ApprovedRecipeSelection>();
    for (const selection of selections) {
      const existing = byImportId.get(selection.importId);
      if (
        existing !== undefined &&
        (existing.authorityToken.extractionFingerprint !==
          selection.authorityToken.extractionFingerprint ||
          existing.authorityToken.reviewVersion !==
            selection.authorityToken.reviewVersion ||
          existing.authorityToken.tagsFingerprint !==
            selection.authorityToken.tagsFingerprint)
      ) {
        return yield* new ApprovedRecipeAuthorityMismatch(undefined);
      }
      if (existing === undefined) {
        byImportId.set(selection.importId, selection);
      }
    }
    return [...byImportId.values()];
  });

const authorityPredicate = (selections: readonly ApprovedRecipeSelection[]) =>
  inArray(
    sql<string>`${recipeImports.id} || ':' || ${importRecipeExtractions.extractionFingerprint} || ':' || ${recipeReviews.version}`,
    selections.map(
      ({ authorityToken, importId }) =>
        `${importId}:${authorityToken.extractionFingerprint}:${authorityToken.reviewVersion}`
    )
  );

const latestCorrectionPredicate = (
  binding: AnyD1Database,
  newerCorrection: ReturnType<
    typeof alias<typeof recipeReviewCorrections, string>
  >
) =>
  notExists(
    drizzle(binding)
      .select({
        extractionFingerprint: newerCorrection.extractionFingerprint,
      })
      .from(newerCorrection)
      .where(
        and(
          eq(
            newerCorrection.extractionFingerprint,
            recipeReviewCorrections.extractionFingerprint
          ),
          eq(newerCorrection.field, recipeReviewCorrections.field),
          or(
            gt(newerCorrection.version, recipeReviewCorrections.version),
            and(
              eq(newerCorrection.version, recipeReviewCorrections.version),
              gt(newerCorrection.ordinal, recipeReviewCorrections.ordinal)
            )
          )
        )
      )
      .limit(1)
  );

const latestTransitionPredicate = (
  binding: AnyD1Database,
  newerTransition: ReturnType<
    typeof alias<typeof recipeReviewTransitions, string>
  >
) =>
  notExists(
    drizzle(binding)
      .select({
        extractionFingerprint: newerTransition.extractionFingerprint,
      })
      .from(newerTransition)
      .where(
        and(
          eq(
            newerTransition.extractionFingerprint,
            recipeReviewTransitions.extractionFingerprint
          ),
          gt(newerTransition.version, recipeReviewTransitions.version)
        )
      )
      .limit(1)
  );

const selectedAuthorityJoins = (
  selections: readonly ApprovedRecipeSelection[],
  householdScopeId: RecipeImportHouseholdScopeId
) =>
  and(
    eq(recipeImports.householdScopeId, householdScopeId),
    eq(importRecipeExtractions.isCurrent, 1),
    eq(importRecipeExtractions.state, "needs_review"),
    isNotNull(importRecipeExtractions.draftJson),
    eq(recipeReviews.lifecycle, "approved"),
    isNotNull(recipeReviews.tagsJson),
    authorityPredicate(selections)
  );

const readBatchSourcePreflight = (
  binding: AnyD1Database,
  householdScopeId: RecipeImportHouseholdScopeId,
  selections: readonly ApprovedRecipeSelection[]
) =>
  persistenceEffect(() =>
    drizzle(binding)
      .select({
        draftBytes: sql<number>`length(cast(${importRecipeExtractions.draftJson} as blob))`,
        extractionFingerprint: importRecipeExtractions.extractionFingerprint,
        importId: recipeImports.id,
        tagsBytes: sql<number>`length(cast(${recipeReviews.tagsJson} as blob))`,
        version: recipeReviews.version,
      })
      .from(recipeImports)
      .innerJoin(
        importRecipeExtractions,
        and(
          eq(importRecipeExtractions.importId, recipeImports.id),
          eq(
            importRecipeExtractions.acquisitionGeneration,
            recipeImports.acquisitionGeneration
          )
        )
      )
      .innerJoin(
        recipeReviews,
        eq(
          recipeReviews.extractionFingerprint,
          importRecipeExtractions.extractionFingerprint
        )
      )
      .where(selectedAuthorityJoins(selections, householdScopeId))
      .orderBy(asc(recipeImports.id))
  ).pipe(Effect.flatMap((rows) => decodeRows(BatchSourcePreflightRow, rows)));

const readBatchCorrectionPreflight = (
  binding: AnyD1Database,
  householdScopeId: RecipeImportHouseholdScopeId,
  selections: readonly ApprovedRecipeSelection[]
) => {
  const newerCorrection = alias(
    recipeReviewCorrections,
    "newer_projection_correction_preflight"
  );
  return persistenceEffect(() =>
    drizzle(binding)
      .select({
        afterBytes: sql<number>`length(cast(${recipeReviewCorrections.afterJson} as blob))`,
        extractionFingerprint: recipeReviewCorrections.extractionFingerprint,
        field: recipeReviewCorrections.field,
      })
      .from(recipeReviewCorrections)
      .innerJoin(
        recipeReviews,
        eq(
          recipeReviews.extractionFingerprint,
          recipeReviewCorrections.extractionFingerprint
        )
      )
      .innerJoin(
        importRecipeExtractions,
        eq(
          importRecipeExtractions.extractionFingerprint,
          recipeReviews.extractionFingerprint
        )
      )
      .innerJoin(
        recipeImports,
        and(
          eq(recipeImports.id, importRecipeExtractions.importId),
          eq(
            recipeImports.acquisitionGeneration,
            importRecipeExtractions.acquisitionGeneration
          )
        )
      )
      .where(
        and(
          selectedAuthorityJoins(selections, householdScopeId),
          inArray(recipeReviewCorrections.field, RelevantCorrectionFields),
          latestCorrectionPredicate(binding, newerCorrection)
        )
      )
      .orderBy(
        asc(recipeReviewCorrections.extractionFingerprint),
        asc(recipeReviewCorrections.field)
      )
  ).pipe(
    Effect.flatMap((rows) => decodeRows(BatchCorrectionPreflightRow, rows))
  );
};

const readBatchSources = (
  binding: AnyD1Database,
  householdScopeId: RecipeImportHouseholdScopeId,
  selections: readonly ApprovedRecipeSelection[]
) =>
  persistenceEffect(() =>
    drizzle(binding)
      .select({
        draftJson: importRecipeExtractions.draftJson,
        extractionFingerprint: importRecipeExtractions.extractionFingerprint,
        importId: recipeImports.id,
        tagsJson: recipeReviews.tagsJson,
        version: recipeReviews.version,
      })
      .from(recipeImports)
      .innerJoin(
        importRecipeExtractions,
        and(
          eq(importRecipeExtractions.importId, recipeImports.id),
          eq(
            importRecipeExtractions.acquisitionGeneration,
            recipeImports.acquisitionGeneration
          )
        )
      )
      .innerJoin(
        recipeReviews,
        eq(
          recipeReviews.extractionFingerprint,
          importRecipeExtractions.extractionFingerprint
        )
      )
      .where(
        and(
          selectedAuthorityJoins(selections, householdScopeId),
          lte(
            sql<number>`length(cast(${importRecipeExtractions.draftJson} as blob))`,
            MaximumSelectedRecipeJsonBytes
          ),
          lte(
            sql<number>`length(cast(${recipeReviews.tagsJson} as blob))`,
            MaximumCandidateTagsJsonBytes
          )
        )
      )
      .orderBy(asc(recipeImports.id))
  ).pipe(Effect.flatMap((rows) => decodeRows(ProjectionSourceRow, rows)));

const readBatchCorrections = (
  binding: AnyD1Database,
  householdScopeId: RecipeImportHouseholdScopeId,
  selections: readonly ApprovedRecipeSelection[]
) => {
  const newerCorrection = alias(
    recipeReviewCorrections,
    "newer_projection_correction"
  );
  return persistenceEffect(() =>
    drizzle(binding)
      .select({
        afterJson: recipeReviewCorrections.afterJson,
        extractionFingerprint: recipeReviewCorrections.extractionFingerprint,
        field: recipeReviewCorrections.field,
      })
      .from(recipeReviewCorrections)
      .innerJoin(
        recipeReviews,
        eq(
          recipeReviews.extractionFingerprint,
          recipeReviewCorrections.extractionFingerprint
        )
      )
      .innerJoin(
        importRecipeExtractions,
        eq(
          importRecipeExtractions.extractionFingerprint,
          recipeReviews.extractionFingerprint
        )
      )
      .innerJoin(
        recipeImports,
        and(
          eq(recipeImports.id, importRecipeExtractions.importId),
          eq(
            recipeImports.acquisitionGeneration,
            importRecipeExtractions.acquisitionGeneration
          )
        )
      )
      .where(
        and(
          selectedAuthorityJoins(selections, householdScopeId),
          inArray(recipeReviewCorrections.field, RelevantCorrectionFields),
          latestCorrectionPredicate(binding, newerCorrection),
          lte(
            sql<number>`length(cast(${recipeReviewCorrections.afterJson} as blob))`,
            MaximumSelectedRecipeJsonBytes
          )
        )
      )
      .orderBy(
        asc(recipeReviewCorrections.extractionFingerprint),
        asc(recipeReviewCorrections.field)
      )
  ).pipe(Effect.flatMap((rows) => decodeRows(BatchCorrectionRow, rows)));
};

const readBatchTransitions = (
  binding: AnyD1Database,
  householdScopeId: RecipeImportHouseholdScopeId,
  selections: readonly ApprovedRecipeSelection[]
) => {
  const newerTransition = alias(
    recipeReviewTransitions,
    "newer_projection_transition"
  );
  return persistenceEffect(() =>
    drizzle(binding)
      .select({
        extractionFingerprint: recipeReviewTransitions.extractionFingerprint,
        to: recipeReviewTransitions.toLifecycle,
        transitionedAt: sql<
          string | null
        >`case when length(cast(${recipeReviewTransitions.transitionedAt} as blob)) <= ${MaximumEncodedImportTimestampBytes} then ${recipeReviewTransitions.transitionedAt} else null end`,
        transitionedAtBytes: sql<number>`length(cast(${recipeReviewTransitions.transitionedAt} as blob))`,
        version: recipeReviewTransitions.version,
      })
      .from(recipeReviewTransitions)
      .innerJoin(
        recipeReviews,
        eq(
          recipeReviews.extractionFingerprint,
          recipeReviewTransitions.extractionFingerprint
        )
      )
      .innerJoin(
        importRecipeExtractions,
        eq(
          importRecipeExtractions.extractionFingerprint,
          recipeReviews.extractionFingerprint
        )
      )
      .innerJoin(
        recipeImports,
        and(
          eq(recipeImports.id, importRecipeExtractions.importId),
          eq(
            recipeImports.acquisitionGeneration,
            importRecipeExtractions.acquisitionGeneration
          )
        )
      )
      .where(
        and(
          selectedAuthorityJoins(selections, householdScopeId),
          latestTransitionPredicate(binding, newerTransition)
        )
      )
      .orderBy(asc(recipeReviewTransitions.extractionFingerprint))
  ).pipe(
    Effect.flatMap((rows) => decodeRows(BatchTransitionSourceRow, rows)),
    Effect.flatMap((rows) =>
      Effect.forEach(
        rows,
        (row) =>
          Effect.gen(function* decodeGuardedTransition() {
            if (
              row.transitionedAtBytes > MaximumEncodedImportTimestampBytes ||
              row.transitionedAt === null
            ) {
              return yield* Effect.fail(importPersistenceCorrupt());
            }
            return BatchTransitionRow.make({
              extractionFingerprint: row.extractionFingerprint,
              to: row.to,
              transitionedAt: yield* Schema.decodeUnknownEffect(
                ImportTimestamp
              )(row.transitionedAt).pipe(
                Effect.mapError(() => importPersistenceCorrupt())
              ),
              version: row.version,
            });
          }),
        { concurrency: 1 }
      )
    )
  );
};

interface ProjectedCorrectionOverlay {
  readonly ingredientLines?: typeof ProjectionTextList.Type;
  readonly instructions?: typeof ProjectionTextList.Type;
  readonly name?: typeof ProjectionText.Type;
}

const decodeProjectedCorrections = (rows: readonly BatchCorrectionRow[]) =>
  Effect.gen(function* decodePlanningCorrections() {
    const byFingerprint = new Map<string, ProjectedCorrectionOverlay>();
    for (const row of rows) {
      const current = byFingerprint.get(row.extractionFingerprint) ?? {};
      switch (row.field) {
        case "ingredient_lines": {
          byFingerprint.set(row.extractionFingerprint, {
            ...current,
            ingredientLines: yield* decodeJson(
              ProjectionTextList,
              row.afterJson
            ),
          });
          break;
        }
        case "instructions": {
          byFingerprint.set(row.extractionFingerprint, {
            ...current,
            instructions: yield* decodeJson(ProjectionTextList, row.afterJson),
          });
          break;
        }
        case "name": {
          byFingerprint.set(row.extractionFingerprint, {
            ...current,
            name: yield* decodeJson(ProjectionText, row.afterJson),
          });
          break;
        }
        default: {
          return yield* Effect.fail(importPersistenceCorrupt());
        }
      }
    }
    return byFingerprint;
  });

const sourceUrl = (draft: RecipeDraft) =>
  draft.extraction.sourceUrl.state === "supported"
    ? draft.extraction.sourceUrl.value
    : null;

const validateBatchPreflight = (
  selections: readonly ApprovedRecipeSelection[],
  sourceRows: readonly (typeof BatchSourcePreflightRow.Type)[],
  correctionRows: readonly (typeof BatchCorrectionPreflightRow.Type)[]
) =>
  Effect.gen(function* validateApprovedProjectionPreflight() {
    if (sourceRows.length !== selections.length) {
      return yield* new ApprovedRecipeAuthorityMismatch(undefined);
    }
    if (
      sourceRows.some(
        ({ draftBytes, tagsBytes }) =>
          draftBytes > MaximumSelectedRecipeJsonBytes ||
          tagsBytes > MaximumCandidateTagsJsonBytes
      ) ||
      correctionRows.some(
        ({ afterBytes }) => afterBytes > MaximumSelectedRecipeJsonBytes
      )
    ) {
      return yield* new ApprovedRecipeProjectionTooLarge(undefined);
    }
    const selectionByImportId = new Map(
      selections.map((selection) => [selection.importId, selection])
    );
    for (const source of sourceRows) {
      const selection = selectionByImportId.get(source.importId);
      if (
        selection === undefined ||
        selection.authorityToken.extractionFingerprint !==
          source.extractionFingerprint ||
        selection.authorityToken.reviewVersion !== source.version
      ) {
        return yield* new ApprovedRecipeAuthorityMismatch(undefined);
      }
    }
  });

const decodeApprovedProjection = (input: {
  readonly correction: ProjectedCorrectionOverlay | undefined;
  readonly selection: ApprovedRecipeSelection | undefined;
  readonly source: ProjectionSourceRow;
  readonly transition: BatchTransitionRow | undefined;
}) =>
  Effect.gen(function* decodeOneApprovedProjection() {
    if (input.selection === undefined) {
      return yield* new ApprovedRecipeAuthorityMismatch(undefined);
    }
    const actualTagsFingerprint = yield* sha256Text(input.source.tagsJson);
    if (
      input.selection.authorityToken.extractionFingerprint !==
        input.source.extractionFingerprint ||
      input.selection.authorityToken.reviewVersion !== input.source.version ||
      input.selection.authorityToken.tagsFingerprint !== actualTagsFingerprint
    ) {
      return yield* new ApprovedRecipeAuthorityMismatch(undefined);
    }

    const draft = yield* decodeJson(RecipeDraft, input.source.draftJson);
    if (
      draft.importId !== input.source.importId ||
      draft.extractionFingerprint !== input.source.extractionFingerprint
    ) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    const tags = yield* decodeJson(PlanningTags, input.source.tagsJson);
    if (
      input.transition === undefined ||
      input.transition.to !== "approved" ||
      input.transition.version !== input.source.version
    ) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    const baseRecipe = applyCorrectionOverlay(draft, []);
    const ingredientLines =
      input.correction?.ingredientLines ?? baseRecipe.ingredientLines;
    const instructions =
      input.correction?.instructions ?? baseRecipe.instructions;
    const name = input.correction?.name ?? baseRecipe.name;
    if (ingredientLines === null || instructions === null || name === null) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    return ApprovedRecipe.make({
      approvedAt: input.transition.transitionedAt,
      extractionFingerprint: input.source.extractionFingerprint,
      importId: input.source.importId,
      recipe: { ingredientLines, instructions, name },
      source: {
        evidenceFingerprint: draft.evidenceFingerprint,
        sourceUrl: sourceUrl(draft),
      },
      tags,
      version: input.source.version,
    });
  });

/**
 * Hydrate a bounded selected set using five D1 queries regardless of slots.
 *
 * Two numeric-only preflight queries reject pathological persisted fields
 * before their JSON crosses the seam. The three guarded payload queries are
 * authority constrained and return at most 31 drafts, 93 correction values,
 * and 31 transition rows. Their encoded text is bounded to approximately
 * 8.3 MiB as persisted UTF-8 (about 16.6 MiB as UTF-16 strings) before decode,
 * safely below the 128 MiB Worker memory ceiling; the caller separately
 * enforces its one-MiB retained/RPC aggregate. Payload row counts and authority
 * hashes are checked before any JSON is decoded.
 */
export const findCurrentApprovedRecipeProjections = (
  binding: AnyD1Database,
  input: {
    readonly householdScopeId: RecipeImportHouseholdScopeId;
    readonly selections: readonly ApprovedRecipeSelection[];
  }
): Effect.Effect<
  readonly (typeof ApprovedRecipe.Type)[],
  | ApprovedRecipeAuthorityMismatch
  | ApprovedRecipeProjectionTooLarge
  | RecipeReviewPersistenceError
> =>
  Effect.gen(function* findApprovedProjections() {
    const selections = yield* distinctSelections(input.selections);
    if (selections.length === 0) {
      return [];
    }
    if (selections.length > MaximumApprovedRecipeSelections) {
      return yield* new ApprovedRecipeProjectionTooLarge(undefined);
    }

    const [sourcePreflight, correctionPreflight] = yield* Effect.all([
      readBatchSourcePreflight(binding, input.householdScopeId, selections),
      readBatchCorrectionPreflight(binding, input.householdScopeId, selections),
    ]);
    yield* validateBatchPreflight(
      selections,
      sourcePreflight,
      correctionPreflight
    );
    const selectionByImportId = new Map(
      selections.map((selection) => [selection.importId, selection])
    );

    const [sources, correctionRows, transitions] = yield* Effect.all([
      readBatchSources(binding, input.householdScopeId, selections),
      readBatchCorrections(binding, input.householdScopeId, selections),
      readBatchTransitions(binding, input.householdScopeId, selections),
    ]);
    if (
      sources.length !== selections.length ||
      correctionRows.length !== correctionPreflight.length ||
      transitions.length !== selections.length
    ) {
      return yield* new ApprovedRecipeAuthorityMismatch(undefined);
    }

    const transitionByFingerprint = new Map(
      transitions.map((transition) => [
        transition.extractionFingerprint,
        transition,
      ])
    );
    const correctionsByFingerprint =
      yield* decodeProjectedCorrections(correctionRows);
    const approved = yield* Effect.all(
      sources.map((source) =>
        decodeApprovedProjection({
          correction: correctionsByFingerprint.get(
            source.extractionFingerprint
          ),
          selection: selectionByImportId.get(source.importId),
          source,
          transition: transitionByFingerprint.get(source.extractionFingerprint),
        })
      )
    );
    const approvedByImportId = new Map(
      approved.map((recipe) => [recipe.importId, recipe])
    );
    return yield* Effect.all(
      selections.map(({ importId }) => {
        const recipe = approvedByImportId.get(importId);
        return recipe === undefined
          ? Effect.fail(new ApprovedRecipeAuthorityMismatch(undefined))
          : Effect.succeed(recipe);
      })
    );
  });

const readCurrentApprovedRecipeSelection = (
  binding: AnyD1Database,
  input: {
    readonly householdScopeId: RecipeImportHouseholdScopeId;
    readonly importId: ImportIdType;
  }
) =>
  Effect.gen(function* readExactApprovedSelection() {
    const rawRows = yield* persistenceEffect(() =>
      drizzle(binding)
        .select({
          extractionFingerprint: importRecipeExtractions.extractionFingerprint,
          tagsBytes: sql<number>`length(cast(${recipeReviews.tagsJson} as blob))`,
          tagsJson: sql<string | null>`case
            when length(cast(${recipeReviews.tagsJson} as blob)) <= ${MaximumCandidateTagsJsonBytes}
            then ${recipeReviews.tagsJson}
            else null
          end`,
          version: recipeReviews.version,
        })
        .from(recipeImports)
        .innerJoin(
          importRecipeExtractions,
          and(
            eq(importRecipeExtractions.importId, recipeImports.id),
            eq(
              importRecipeExtractions.acquisitionGeneration,
              recipeImports.acquisitionGeneration
            ),
            eq(importRecipeExtractions.isCurrent, 1),
            eq(importRecipeExtractions.state, "needs_review"),
            isNotNull(importRecipeExtractions.draftJson)
          )
        )
        .innerJoin(
          recipeReviews,
          and(
            eq(
              recipeReviews.extractionFingerprint,
              importRecipeExtractions.extractionFingerprint
            ),
            eq(recipeReviews.lifecycle, "approved"),
            isNotNull(recipeReviews.tagsJson)
          )
        )
        .where(
          and(
            eq(recipeImports.householdScopeId, input.householdScopeId),
            eq(recipeImports.id, input.importId)
          )
        )
        .limit(1)
    );
    const rows = yield* decodeRows(ExactCandidateSourceRow, rawRows);
    const [source] = rows;
    if (source === undefined) {
      return Option.none<ApprovedRecipeSelection>();
    }
    if (
      source.tagsBytes > MaximumCandidateTagsJsonBytes ||
      source.tagsJson === null
    ) {
      return yield* new ApprovedRecipeProjectionTooLarge(undefined);
    }
    return Option.some(
      ApprovedRecipeSelection.make({
        authorityToken: {
          extractionFingerprint: source.extractionFingerprint,
          reviewVersion: source.version,
          tagsFingerprint: yield* sha256Text(source.tagsJson),
        },
        importId: input.importId,
      })
    );
  });

/** Resolve one exact recipe through the same guarded authority hydration path. */
export const findCurrentApprovedRecipeProjection = (
  binding: AnyD1Database,
  input: {
    readonly householdScopeId: RecipeImportHouseholdScopeId;
    readonly importId: ImportIdType;
  }
): Effect.Effect<
  Option.Option<typeof ApprovedRecipe.Type>,
  | ApprovedRecipeAuthorityMismatch
  | ApprovedRecipeProjectionTooLarge
  | RecipeReviewPersistenceError
> =>
  Effect.gen(function* findApprovedProjection() {
    const selection = yield* readCurrentApprovedRecipeSelection(binding, input);
    if (Option.isNone(selection)) {
      return Option.none();
    }
    const approved = yield* findCurrentApprovedRecipeProjections(binding, {
      householdScopeId: input.householdScopeId,
      selections: [selection.value],
    });
    const [recipe] = approved;
    return recipe === undefined
      ? yield* new ApprovedRecipeAuthorityMismatch(undefined)
      : Option.some(recipe);
  });
