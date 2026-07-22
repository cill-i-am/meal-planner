import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Option, Schema } from "effect";

import type {
  AcquisitionGeneration,
  ClassifiedAcquisitionFailure,
  VerifiedAcquisitionEvidence,
} from "./import-media.model.js";
import {
  AcquisitionGeneration as AcquisitionGenerationSchema,
  EvidenceRetentionSeconds,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import {
  EvidenceReference,
  ImportView,
  SourceCanonicalId,
} from "./import.contracts.js";
import type {
  ImportDisposition,
  ImportId,
  ImportStatus,
  ImportTimestamp,
} from "./import.contracts.js";
import {
  importCarouselEvidence,
  importRequests,
  importRecipeExtractions,
  importVisualEvidence,
  recipeImports,
} from "./import.database-schema.js";
import {
  idempotencyConflict,
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  incompatibleDuplicate,
  importNotFound,
  importTransitionRejected,
} from "./import.errors.js";
import type {
  AcceptImportCommand,
  ClaimAcquisitionResult,
  ImportRepositoryShape,
  ImportTransitionError,
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
  acquisitionGeneration: AcquisitionGenerationSchema,
  canonicalSourceId: Schema.String,
  carouselManifestKey: NullableString,
  carouselUpdatedAt: NullableString,
  compatibilityFingerprint: CompatibilityFingerprint,
  createdAt: Schema.String,
  evidenceReferencesJson: Schema.String,
  id: Schema.String,
  recipeDraftFingerprint: NullableString,
  recipeDraftJson: NullableString,
  recipeDraftState: NullableString,
  recipeDraftUpdatedAt: NullableString,
  recoveryAction: NullableString,
  sourceKind: Schema.Literal("tiktok"),
  status: Schema.Literals([
    "acquired",
    "acquiring",
    "failed",
    "queued",
    "transcribed",
    "transcribing",
    "unsupported",
  ]),
  statusCode: NullableString,
  updatedAt: Schema.String,
  visualFailureCode: NullableString,
  visualManifestKey: NullableString,
  visualOutcome: NullableString,
  visualState: NullableString,
  visualUpdatedAt: NullableString,
});

const DatabaseRequestFingerprints = Schema.Struct({
  requestFingerprint: RequestFingerprint,
  sourceLocatorHash: SourceLocatorHash,
});

const importSelection = {
  acquisitionGeneration: recipeImports.acquisitionGeneration,
  canonicalSourceId: recipeImports.canonicalSourceId,
  carouselManifestKey: sql<string | null>`(
    SELECT ${importCarouselEvidence.manifestKey}
      FROM ${importCarouselEvidence}
     WHERE ${importCarouselEvidence.importId} = ${recipeImports.id}
       AND ${importCarouselEvidence.acquisitionGeneration} = ${recipeImports.acquisitionGeneration}
       AND ${importCarouselEvidence.state} = 'completed'
  )`.as("carousel_manifest_key"),
  carouselUpdatedAt: sql<string | null>`(
    SELECT ${importCarouselEvidence.updatedAt}
      FROM ${importCarouselEvidence}
     WHERE ${importCarouselEvidence.importId} = ${recipeImports.id}
       AND ${importCarouselEvidence.acquisitionGeneration} = ${recipeImports.acquisitionGeneration}
       AND ${importCarouselEvidence.state} = 'completed'
  )`.as("carousel_updated_at"),
  compatibilityFingerprint: recipeImports.compatibilityFingerprint,
  createdAt: recipeImports.createdAt,
  evidenceReferencesJson: recipeImports.evidenceReferencesJson,
  id: recipeImports.id,
  recipeDraftFingerprint: sql<
    string | null
  >`${importRecipeExtractions.extractionFingerprint}`.as(
    "recipe_draft_fingerprint"
  ),
  recipeDraftJson: sql<string | null>`${importRecipeExtractions.draftJson}`.as(
    "recipe_draft_json"
  ),
  recipeDraftState: sql<string | null>`${importRecipeExtractions.state}`.as(
    "recipe_draft_state"
  ),
  recipeDraftUpdatedAt: sql<
    string | null
  >`${importRecipeExtractions.updatedAt}`.as("recipe_draft_updated_at"),
  recoveryAction: recipeImports.recoveryAction,
  sourceKind: recipeImports.sourceKind,
  status: recipeImports.status,
  statusCode: recipeImports.statusCode,
  updatedAt: recipeImports.updatedAt,
  visualFailureCode: importVisualEvidence.failureCode,
  visualManifestKey: importVisualEvidence.manifestKey,
  visualOutcome: importVisualEvidence.outcome,
  visualState: importVisualEvidence.state,
  visualUpdatedAt: sql<string | null>`${importVisualEvidence.updatedAt}`.as(
    "visual_updated_at"
  ),
} as const;

const decodeUnclassifiedStatus = (
  row: typeof DatabaseImportRow.Type
): ImportStatus | null => {
  if (row.statusCode !== null || row.recoveryAction !== null) {
    return null;
  }
  switch (row.status) {
    case "acquired":
    case "acquiring":
    case "queued":
    case "transcribed":
    case "transcribing": {
      return { kind: row.status };
    }
    default: {
      return null;
    }
  }
};

const decodeStatus = (row: typeof DatabaseImportRow.Type): ImportStatus => {
  const unclassified = decodeUnclassifiedStatus(row);
  if (unclassified !== null) {
    return unclassified;
  }
  if (
    row.status === "failed" &&
    row.statusCode === "transcription_failed" &&
    row.recoveryAction === "retry_later"
  ) {
    return {
      code: "transcription_failed",
      kind: "failed",
      recovery: "retry_later",
    };
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
    row.status === "failed" &&
    row.statusCode === "acquisition_temporarily_unavailable" &&
    row.recoveryAction === "retry_later"
  ) {
    return {
      code: "acquisition_temporarily_unavailable",
      kind: "failed",
      recovery: "retry_later",
    };
  }
  if (
    row.status === "failed" &&
    row.statusCode === "invalid_or_unsupported_media" &&
    row.recoveryAction === "submit_supported_public_video"
  ) {
    return {
      code: "invalid_or_unsupported_media",
      kind: "failed",
      recovery: "submit_supported_public_video",
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

type DatabaseImportRow = typeof DatabaseImportRow.Type;

const hasNoVisualPayload = (row: DatabaseImportRow) =>
  row.visualOutcome === null &&
  row.visualManifestKey === null &&
  row.visualFailureCode === null;

const completedVisualStatus = (outcome: string | null) => {
  switch (outcome) {
    case "empty": {
      return { kind: "visual_evidence_empty" } as const;
    }
    case "found": {
      return { kind: "visual_evidence_found" } as const;
    }
    case "low_confidence": {
      return { kind: "visual_evidence_low_confidence" } as const;
    }
    default: {
      return null;
    }
  }
};

const decodeVisualProjection = (
  row: DatabaseImportRow,
  evidence: readonly EvidenceReference[]
) => {
  if (
    row.visualState === null &&
    row.visualUpdatedAt === null &&
    hasNoVisualPayload(row)
  ) {
    return { evidence, status: decodeStatus(row), updatedAt: row.updatedAt };
  }
  if (
    row.status !== "transcribed" ||
    row.visualUpdatedAt === null ||
    evidence.length !== 3
  ) {
    throw new Error("Invalid visual evidence parent state");
  }
  if (row.visualState === "dispatching" && hasNoVisualPayload(row)) {
    return {
      evidence,
      status: { kind: "extracting_visual" } as const,
      updatedAt: row.visualUpdatedAt,
    };
  }
  if (
    row.visualState === "failed" &&
    row.visualOutcome === null &&
    row.visualManifestKey === null &&
    row.visualFailureCode !== null
  ) {
    return {
      evidence,
      status: {
        code: "visual_evidence_failed",
        kind: "failed",
        recovery: "operator_reconcile",
      } as const,
      updatedAt: row.visualUpdatedAt,
    };
  }
  if (
    row.visualState === "completed" &&
    row.visualFailureCode === null &&
    row.visualManifestKey !== null
  ) {
    const status = completedVisualStatus(row.visualOutcome);
    if (status === null) {
      throw new Error("Invalid completed visual outcome");
    }
    return {
      evidence: [
        ...evidence,
        {
          kind: "visual_evidence_manifest" as const,
          referenceId: row.visualManifestKey,
        },
      ],
      status,
      updatedAt: row.visualUpdatedAt,
    };
  }
  throw new Error("Invalid persisted visual evidence state");
};

const decodeRecipeProjection = (
  row: DatabaseImportRow,
  visualProjection: ReturnType<typeof decodeVisualProjection>
) => {
  if (
    row.recipeDraftState === null &&
    row.recipeDraftFingerprint === null &&
    row.recipeDraftJson === null &&
    row.recipeDraftUpdatedAt === null
  ) {
    return visualProjection;
  }
  if (
    row.recipeDraftState !== "needs_review" ||
    row.recipeDraftFingerprint === null ||
    row.recipeDraftJson === null ||
    row.recipeDraftUpdatedAt === null
  ) {
    throw new Error("Invalid persisted recipe draft state");
  }
  const draft = Schema.decodeUnknownSync(RecipeDraft, {
    onExcessProperty: "error",
  })(JSON.parse(row.recipeDraftJson));
  if (
    draft.extractionFingerprint !== row.recipeDraftFingerprint ||
    draft.importId !== row.id ||
    draft.generation !== row.acquisitionGeneration
  ) {
    throw new Error("Persisted recipe draft identity mismatch");
  }
  if (draft.schemaVersion === 2) {
    if (
      row.carouselManifestKey === null ||
      row.carouselUpdatedAt === null ||
      visualProjection.evidence.length !== 0 ||
      visualProjection.status.kind !== "queued"
    ) {
      throw new Error("Invalid persisted carousel recipe draft state");
    }
    return {
      evidence: [
        {
          kind: "carousel_evidence_manifest" as const,
          referenceId: row.carouselManifestKey,
        },
        {
          kind: "recipe_draft" as const,
          referenceId: `recipe-drafts/${row.recipeDraftFingerprint}`,
        },
      ],
      status: { kind: "needs_review" as const },
      updatedAt: row.recipeDraftUpdatedAt,
    };
  }
  if (
    visualProjection.evidence.length === 4 &&
    [
      "visual_evidence_empty",
      "visual_evidence_found",
      "visual_evidence_low_confidence",
    ].includes(visualProjection.status.kind)
  ) {
    return {
      evidence: [
        ...visualProjection.evidence,
        {
          kind: "recipe_draft" as const,
          referenceId: `recipe-drafts/${row.recipeDraftFingerprint}`,
        },
      ],
      status: { kind: "needs_review" as const },
      updatedAt: row.recipeDraftUpdatedAt,
    };
  }
  throw new Error("Invalid persisted recipe draft state");
};

const decodeStoredImport = (input: unknown) =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: (): StoredImport => {
      const row = Schema.decodeUnknownSync(DatabaseImportRow)(input);
      const canonicalSourceId = Schema.decodeUnknownSync(SourceCanonicalId)(
        row.canonicalSourceId
      );
      const baseEvidence = Schema.decodeUnknownSync(
        Schema.Array(EvidenceReference)
      )(JSON.parse(row.evidenceReferencesJson));
      const visualProjection = decodeVisualProjection(row, baseEvidence);
      const projection = decodeRecipeProjection(row, visualProjection);
      return {
        acquisitionGeneration: row.acquisitionGeneration,
        canonicalSourceId,
        compatibilityFingerprint: row.compatibilityFingerprint,
        sourceKind: row.sourceKind,
        view: Schema.decodeUnknownSync(ImportView)({
          createdAt: row.createdAt,
          evidence: projection.evidence,
          id: row.id,
          source: { canonicalId: canonicalSourceId, kind: row.sourceKind },
          status: projection.status,
          updatedAt: projection.updatedAt,
        }),
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
    case "acquired":
    case "acquiring":
    case "extracting_visual":
    case "needs_review":
    case "queued":
    case "transcribed":
    case "transcribing": {
      return { recoveryAction: null, statusCode: null };
    }
    case "visual_evidence_empty":
    case "visual_evidence_found":
    case "visual_evidence_low_confidence": {
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

const failureStatus = (
  failure: ClassifiedAcquisitionFailure
): Exclude<
  ImportStatus,
  { readonly kind: "acquired" | "acquiring" | "queued" }
> => {
  switch (failure._tag) {
    case "RetryExhausted": {
      return {
        code: "acquisition_temporarily_unavailable",
        kind: "failed",
        recovery: "retry_later",
      };
    }
    case "Unavailable": {
      return {
        code: "private_or_unavailable",
        kind: "failed",
        recovery: "check_source_visibility",
      };
    }
    case "TerminalMedia": {
      return {
        code: "invalid_or_unsupported_media",
        kind: "failed",
        recovery: "submit_supported_public_video",
      };
    }
    case "UnsupportedCarousel": {
      return {
        code: "unsupported_post_type",
        kind: "unsupported",
        recovery: "submit_supported_public_video",
      };
    }
    default: {
      throw new Error("Unsupported acquisition failure");
    }
  }
};

const isVerifiedEvidenceFor = (
  id: ImportId,
  evidence: VerifiedAcquisitionEvidence,
  acquiredAt: ImportTimestamp
) =>
  evidence.mediaKey === mediaObjectKey(id, evidence.generation) &&
  evidence.manifestKey === manifestObjectKey(id, evidence.generation) &&
  evidence.acquiredAt === acquiredAt &&
  evidence.sha256.length === 64 &&
  evidence.bytes > 0 &&
  evidence.durationSeconds > 0 &&
  evidence.audioStreams.length > 0 &&
  evidence.videoStreams.length > 0 &&
  DateTime.toEpochMillis(evidence.deleteAt) -
    DateTime.toEpochMillis(evidence.acquiredAt) ===
    EvidenceRetentionSeconds * 1000;

interface D1ImportRepositoryShape extends ImportRepositoryShape {
  readonly beginAcquisitionAttempt: (id: ImportId) => Effect.Effect<
    {
      readonly canonicalSourceId: SourceCanonicalId;
      readonly generation: AcquisitionGeneration;
    },
    ImportTransitionError
  >;
  readonly claimAcquisition: (
    id: ImportId
  ) => Effect.Effect<ClaimAcquisitionResult, ImportTransitionError>;
  readonly recordAcquired: (
    id: ImportId,
    generation: AcquisitionGeneration,
    evidence: VerifiedAcquisitionEvidence,
    acquiredAt: ImportTimestamp
  ) => Effect.Effect<"Recorded" | "Superseded", ImportTransitionError>;
  readonly recordAcquisitionFailure: (
    id: ImportId,
    generation: AcquisitionGeneration,
    failure: ClassifiedAcquisitionFailure,
    failedAt: ImportTimestamp
  ) => Effect.Effect<"Recorded" | "Superseded", ImportTransitionError>;
}

export const makeD1ImportRepository = (
  binding: AnyD1Database,
  currentTimeMillis: () => number = Date.now
): D1ImportRepositoryShape => {
  const database = drizzle(binding);

  const findById = (id: ImportId) =>
    Effect.gen(function* findByIdEffect() {
      const rows = yield* persistenceEffect(() =>
        database
          .select(importSelection)
          .from(recipeImports)
          .leftJoin(
            importVisualEvidence,
            and(
              eq(importVisualEvidence.importId, recipeImports.id),
              eq(
                importVisualEvidence.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              )
            )
          )
          .leftJoin(
            importRecipeExtractions,
            and(
              eq(importRecipeExtractions.importId, recipeImports.id),
              eq(
                importRecipeExtractions.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              ),
              eq(importRecipeExtractions.isCurrent, 1)
            )
          )
          .where(eq(recipeImports.id, id))
          .limit(1)
      );
      return rows[0] === undefined
        ? Option.none()
        : Option.some(yield* decodeStoredImport(rows[0]));
    });

  const requireImport = (id: ImportId) =>
    Effect.flatMap(findById(id), (stored) =>
      Option.match(stored, {
        onNone: () => Effect.fail(importNotFound(id)),
        onSome: Effect.succeed,
      })
    );

  // eslint-disable-next-line sort-keys -- Repository methods stay grouped by request, read, and acquisition lifecycle.
  return {
    acceptRequest: (command: AcceptImportCommand) =>
      Effect.gen(function* acceptRequest() {
        const createdAt = DateTime.formatIso(command.candidate.view.createdAt);
        const updatedAt = DateTime.formatIso(command.candidate.view.updatedAt);
        const canInsertCandidate =
          ![
            "extracting_visual",
            "needs_review",
            "visual_evidence_empty",
            "visual_evidence_found",
            "visual_evidence_low_confidence",
          ].includes(command.candidate.view.status.kind) &&
          !(
            command.candidate.view.status.kind === "failed" &&
            command.candidate.view.status.code === "visual_evidence_failed"
          );
        const { recoveryAction, statusCode } = statusColumns(
          command.candidate.view.status
        );

        const insertCandidate = database
          .insert(recipeImports)
          .select(
            sql`SELECT
              ${command.candidate.acquisitionGeneration},
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
            WHERE ${canInsertCandidate ? 1 : 0} = 1
              AND NOT EXISTS (
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
          .leftJoin(
            importVisualEvidence,
            and(
              eq(importVisualEvidence.importId, recipeImports.id),
              eq(
                importVisualEvidence.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              )
            )
          )
          .leftJoin(
            importRecipeExtractions,
            and(
              eq(importRecipeExtractions.importId, recipeImports.id),
              eq(
                importRecipeExtractions.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              ),
              eq(importRecipeExtractions.isCurrent, 1)
            )
          )
          .where(
            eq(importRequests.idempotencyKeyHash, command.idempotencyKeyHash)
          )
          .limit(1);

        const selectCanonical = database
          .select(importSelection)
          .from(recipeImports)
          .leftJoin(
            importVisualEvidence,
            and(
              eq(importVisualEvidence.importId, recipeImports.id),
              eq(
                importVisualEvidence.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              )
            )
          )
          .leftJoin(
            importRecipeExtractions,
            and(
              eq(importRecipeExtractions.importId, recipeImports.id),
              eq(
                importRecipeExtractions.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              ),
              eq(importRecipeExtractions.isCurrent, 1)
            )
          )
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
    beginAcquisitionAttempt: (id) =>
      Effect.gen(function* beginAcquisitionAttempt() {
        const allocated = yield* persistenceEffect(
          () =>
            binding
              .prepare(
                `UPDATE recipe_imports
               SET acquisition_generation = acquisition_generation + 1
               WHERE id = ? AND status = 'acquiring'
                 AND acquisition_generation < 9007199254740991
               RETURNING acquisition_generation, canonical_source_id`
              )
              .bind(id)
              .first() as PromiseLike<{
              readonly acquisition_generation: number;
              readonly canonical_source_id: string;
            } | null>
        );
        if (allocated === null) {
          yield* requireImport(id);
          return yield* Effect.fail(importTransitionRejected());
        }
        return yield* Effect.try({
          catch: importPersistenceCorrupt,
          try: () => ({
            canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
              allocated.canonical_source_id
            ),
            generation: Schema.decodeUnknownSync(AcquisitionGenerationSchema)(
              allocated.acquisition_generation
            ),
          }),
        });
      }),
    findByCanonicalIdentity: (identity) =>
      Effect.gen(function* findByCanonicalIdentity() {
        const rows = yield* persistenceEffect(() =>
          database
            .select(importSelection)
            .from(recipeImports)
            .leftJoin(
              importVisualEvidence,
              and(
                eq(importVisualEvidence.importId, recipeImports.id),
                eq(
                  importVisualEvidence.acquisitionGeneration,
                  recipeImports.acquisitionGeneration
                )
              )
            )
            .leftJoin(
              importRecipeExtractions,
              and(
                eq(importRecipeExtractions.importId, recipeImports.id),
                eq(
                  importRecipeExtractions.acquisitionGeneration,
                  recipeImports.acquisitionGeneration
                ),
                eq(importRecipeExtractions.isCurrent, 1)
              )
            )
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
    findById,
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
            .leftJoin(
              importVisualEvidence,
              and(
                eq(importVisualEvidence.importId, recipeImports.id),
                eq(
                  importVisualEvidence.acquisitionGeneration,
                  recipeImports.acquisitionGeneration
                )
              )
            )
            .leftJoin(
              importRecipeExtractions,
              and(
                eq(importRecipeExtractions.importId, recipeImports.id),
                eq(
                  importRecipeExtractions.acquisitionGeneration,
                  recipeImports.acquisitionGeneration
                ),
                eq(importRecipeExtractions.isCurrent, 1)
              )
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
    claimAcquisition: (id) =>
      Effect.gen(function* claimAcquisition() {
        const claimedAt = new Date(currentTimeMillis()).toISOString();
        yield* persistenceEffect(() =>
          binding
            .prepare(
              `UPDATE recipe_imports
               SET status = 'acquiring', status_code = NULL,
                   recovery_action = NULL, evidence_references_json = '[]',
                   updated_at = ?
               WHERE id = ? AND (
                 status = 'queued' OR (
                   status = 'failed'
                   AND status_code = 'acquisition_temporarily_unavailable'
                   AND recovery_action = 'retry_later'
                 )
               )`
            )
            .bind(claimedAt, id)
            .run()
        );
        const stored = yield* requireImport(id);
        return stored.view.status.kind === "acquiring"
          ? ({ _tag: "Acquiring", import: stored } as const)
          : ({ _tag: "Finished", import: stored } as const);
      }),
    recordAcquired: (id, generation, evidence, acquiredAt) =>
      Effect.gen(function* recordAcquired() {
        if (
          evidence.generation !== generation ||
          !isVerifiedEvidenceFor(id, evidence, acquiredAt) ||
          DateTime.toEpochMillis(evidence.deleteAt) <= currentTimeMillis()
        ) {
          return yield* Effect.fail(importTransitionRejected());
        }
        const references = [
          { kind: "original_media", referenceId: evidence.mediaKey },
          { kind: "acquisition_manifest", referenceId: evidence.manifestKey },
        ];
        yield* persistenceEffect(() =>
          binding
            .prepare(
              `UPDATE recipe_imports
               SET status = 'acquired', status_code = NULL,
                   recovery_action = NULL, evidence_references_json = ?,
                   updated_at = ?
               WHERE id = ? AND status = 'acquiring'
                 AND acquisition_generation = ?`
            )
            .bind(
              JSON.stringify(references),
              DateTime.formatIso(acquiredAt),
              id,
              generation
            )
            .run()
        );
        const stored = yield* requireImport(id);
        if (stored.acquisitionGeneration > generation) {
          return "Superseded" as const;
        }
        if (stored.acquisitionGeneration < generation) {
          return yield* Effect.fail(importTransitionRejected());
        }
        if (
          stored.view.status.kind === "acquired" &&
          JSON.stringify(stored.view.evidence) === JSON.stringify(references) &&
          DateTime.toEpochMillis(stored.view.updatedAt) ===
            DateTime.toEpochMillis(acquiredAt)
        ) {
          return "Recorded" as const;
        }
        return yield* Effect.fail(importTransitionRejected());
      }),
    recordAcquisitionFailure: (id, generation, failure, failedAt) =>
      Effect.gen(function* recordAcquisitionFailure() {
        if (failure.generation !== generation) {
          return yield* Effect.fail(importTransitionRejected());
        }
        const status = failureStatus(failure);
        const { recoveryAction, statusCode } = statusColumns(status);
        yield* persistenceEffect(() =>
          binding
            .prepare(
              `UPDATE recipe_imports
               SET status = ?, status_code = ?, recovery_action = ?,
                   evidence_references_json = '[]', updated_at = ?
               WHERE id = ? AND status = 'acquiring'
                 AND acquisition_generation = ?`
            )
            .bind(
              status.kind,
              statusCode,
              recoveryAction,
              DateTime.formatIso(failedAt),
              id,
              generation
            )
            .run()
        );
        const stored = yield* requireImport(id);
        if (stored.acquisitionGeneration > generation) {
          return "Superseded" as const;
        }
        if (stored.acquisitionGeneration < generation) {
          return yield* Effect.fail(importTransitionRejected());
        }
        if (
          stored.view.status.kind === status.kind &&
          JSON.stringify(stored.view.status) === JSON.stringify(status)
        ) {
          return "Recorded" as const;
        }
        return yield* Effect.fail(importTransitionRejected());
      }),
  };
};
