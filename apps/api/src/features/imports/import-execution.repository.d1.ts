import { and, eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Option, Schema } from "effect";

import type {
  AcquisitionGeneration,
  ClassifiedAcquisitionFailure,
} from "./import-media.model.js";
import { AcquisitionGeneration as AcquisitionGenerationSchema } from "./import-media.model.js";
import { ImportCorrelationId } from "./import-observability.js";
import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import {
  EvidenceReference,
  ImportView,
  SourceCanonicalId,
} from "./import.contracts.js";
import type {
  ImportId,
  ImportStatus,
  ImportTimestamp,
} from "./import.contracts.js";
import {
  importCarouselEvidence,
  importExecutionRuns,
  importRecipeExtractions,
  importTranscriptions,
  importVisualEvidence,
} from "./import.database-schema.js";
import {
  importNotFound,
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  importTransitionRejected,
} from "./import.errors.js";
import type {
  ClaimAcquisitionResult,
  ImportRepository,
  ImportTransitionError,
  StoredImport,
} from "./import.repository.js";

export interface EnsureImportExecutionRunInput {
  readonly canonicalSourceId: SourceCanonicalId;
  readonly correlationId: string;
  readonly importId: ImportId;
  readonly sourceType: "carousel" | "video";
  readonly startedAt: ImportTimestamp;
}

export interface D1ImportExecutionRepository extends ImportRepository {
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
  readonly ensureRun: (
    input: EnsureImportExecutionRunInput
  ) => Effect.Effect<void, ImportTransitionError>;
  readonly recordAcquisitionFailure: (
    id: ImportId,
    generation: AcquisitionGeneration,
    failure: ClassifiedAcquisitionFailure,
    failedAt: ImportTimestamp
  ) => Effect.Effect<"Recorded" | "Superseded", ImportTransitionError>;
}

const persistence = <A>(promise: () => PromiseLike<A>) =>
  Effect.tryPromise({ catch: importPersistenceUnavailable, try: promise });

type AcquisitionFailureStatus =
  | {
      readonly code: "acquisition_temporarily_unavailable";
      readonly kind: "failed";
      readonly recovery: "retry_later";
    }
  | {
      readonly code: "private_or_unavailable";
      readonly kind: "failed";
      readonly recovery: "check_source_visibility";
    }
  | {
      readonly code: "invalid_or_unsupported_media";
      readonly kind: "failed";
      readonly recovery: "submit_supported_public_video";
    }
  | {
      readonly code: "unsupported_post_type";
      readonly kind: "unsupported";
      readonly recovery: "submit_supported_public_video";
    };

const failureStatus = (
  failure: ClassifiedAcquisitionFailure
): AcquisitionFailureStatus => {
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
      return failure satisfies never;
    }
  }
};

const statusColumns = (status: AcquisitionFailureStatus) => ({
  recoveryAction: status.recovery,
  statusCode: status.code,
});

const persistedStatus = (row: typeof importExecutionRuns.$inferSelect) => {
  if (row.statusCode === null && row.recoveryAction === null) {
    return { kind: row.status } as ImportStatus;
  }
  if (row.status === "failed") {
    if (
      row.statusCode === "private_or_unavailable" &&
      row.recoveryAction === "check_source_visibility"
    ) {
      return {
        code: row.statusCode,
        kind: row.status,
        recovery: row.recoveryAction,
      } as const;
    }
    if (
      (row.statusCode === "acquisition_temporarily_unavailable" ||
        row.statusCode === "transcription_failed") &&
      row.recoveryAction === "retry_later"
    ) {
      return {
        code: row.statusCode,
        kind: row.status,
        recovery: row.recoveryAction,
      } as const;
    }
    if (
      row.statusCode === "invalid_or_unsupported_media" &&
      row.recoveryAction === "submit_supported_public_video"
    ) {
      return {
        code: row.statusCode,
        kind: row.status,
        recovery: row.recoveryAction,
      } as const;
    }
  }
  if (
    row.status === "unsupported" &&
    row.statusCode === "unsupported_post_type" &&
    row.recoveryAction === "submit_supported_public_video"
  ) {
    return {
      code: row.statusCode,
      kind: row.status,
      recovery: row.recoveryAction,
    } as const;
  }
  throw new Error("Invalid import execution status");
};

export const makeD1ImportExecutionRepository = (
  binding: AnyD1Database,
  currentTimeMillis: () => number = Date.now
): D1ImportExecutionRepository => {
  const database = drizzle(binding);

  const findById: D1ImportExecutionRepository["findById"] = (id) =>
    Effect.gen(function* findImportExecution() {
      const [rows, visualRows, extractionRows, carouselRows] =
        yield* Effect.all([
          persistence(() =>
            database
              .select()
              .from(importExecutionRuns)
              .where(eq(importExecutionRuns.id, id))
              .limit(1)
          ),
          persistence(() =>
            database
              .select()
              .from(importVisualEvidence)
              .where(eq(importVisualEvidence.importId, id))
              .limit(1)
          ),
          persistence(() =>
            database
              .select()
              .from(importRecipeExtractions)
              .where(
                and(
                  eq(importRecipeExtractions.importId, id),
                  eq(importRecipeExtractions.isCurrent, 1)
                )
              )
              .limit(1)
          ),
          persistence(() =>
            database
              .select()
              .from(importCarouselEvidence)
              .where(eq(importCarouselEvidence.importId, id))
              .limit(1)
          ),
        ]);
      const [row] = rows;
      if (row === undefined) {
        return Option.none<StoredImport>();
      }
      return yield* Effect.try({
        catch: importPersistenceCorrupt,
        try: () => {
          const canonicalSourceId = Schema.decodeUnknownSync(SourceCanonicalId)(
            row.canonicalSourceId
          );
          let evidence = Schema.decodeUnknownSync(
            Schema.Array(EvidenceReference)
          )(JSON.parse(row.evidenceReferencesJson));
          let status: ImportStatus = persistedStatus(row);
          let { updatedAt } = row;
          const visual = visualRows.find(
            (candidate) =>
              candidate.acquisitionGeneration === row.acquisitionGeneration
          );
          if (visual?.state === "dispatching") {
            const { updatedAt: visualUpdatedAt } = visual;
            status = { kind: "extracting_visual" };
            updatedAt = visualUpdatedAt;
          } else if (
            visual?.state === "completed" &&
            visual.manifestKey !== null &&
            visual.outcome !== null
          ) {
            const { updatedAt: visualUpdatedAt } = visual;
            evidence = [
              ...evidence,
              {
                kind: "visual_evidence_manifest" as const,
                referenceId: visual.manifestKey,
              },
            ];
            status = {
              kind: `visual_evidence_${visual.outcome}`,
            } as ImportStatus;
            updatedAt = visualUpdatedAt;
          } else if (visual?.state === "failed") {
            const { updatedAt: visualUpdatedAt } = visual;
            status = {
              code: "visual_evidence_failed",
              kind: "failed",
              recovery: "operator_reconcile",
            };
            updatedAt = visualUpdatedAt;
          }
          const extraction = extractionRows.find(
            (candidate) =>
              candidate.acquisitionGeneration === row.acquisitionGeneration
          );
          if (
            extraction?.state === "needs_review" &&
            extraction.draftJson !== null
          ) {
            const { updatedAt: extractionUpdatedAt } = extraction;
            const draft = Schema.decodeUnknownSync(RecipeDraft)(
              JSON.parse(extraction.draftJson)
            );
            if (
              draft.importId !== id ||
              draft.generation !== row.acquisitionGeneration
            ) {
              throw new Error("Recipe draft execution identity mismatch");
            }
            const carousel = carouselRows.find(
              (candidate) =>
                candidate.acquisitionGeneration === row.acquisitionGeneration
            );
            const carouselManifestKey = carousel?.manifestKey;
            evidence =
              draft.schemaVersion === 2 &&
              carouselManifestKey !== null &&
              carouselManifestKey !== undefined
                ? [
                    {
                      kind: "carousel_evidence_manifest" as const,
                      referenceId: carouselManifestKey,
                    },
                    {
                      kind: "recipe_draft" as const,
                      referenceId: `recipe-drafts/${draft.extractionFingerprint}`,
                    },
                  ]
                : [
                    ...evidence,
                    {
                      kind: "recipe_draft" as const,
                      referenceId: `recipe-drafts/${draft.extractionFingerprint}`,
                    },
                  ];
            status = { kind: "needs_review" };
            updatedAt = extractionUpdatedAt;
          }
          const view = Schema.decodeUnknownSync(ImportView)({
            createdAt: row.createdAt,
            evidence,
            id,
            source: { canonicalId: canonicalSourceId, kind: "tiktok" },
            status,
            updatedAt,
          });
          return Option.some<StoredImport>({
            acquisitionGeneration: Schema.decodeUnknownSync(
              AcquisitionGenerationSchema
            )(row.acquisitionGeneration),
            canonicalSourceId,
            sourceKind: "tiktok",
            trace: {
              correlationId: Schema.decodeUnknownSync(ImportCorrelationId)(
                row.correlationId
              ),
            },
            view,
          });
        },
      });
    });

  const requireRun = (id: ImportId) =>
    findById(id).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(importNotFound(id)),
          onSome: Effect.succeed,
        })
      )
    );

  return {
    beginAcquisitionAttempt: (id) =>
      Effect.gen(function* beginAcquisitionAttempt() {
        const rows = yield* persistence(() =>
          database
            .update(importExecutionRuns)
            .set({
              acquisitionGeneration: sql`${importExecutionRuns.acquisitionGeneration} + 1`,
            })
            .where(
              and(
                eq(importExecutionRuns.id, id),
                eq(importExecutionRuns.status, "acquiring")
              )
            )
            .returning({
              canonicalSourceId: importExecutionRuns.canonicalSourceId,
              generation: importExecutionRuns.acquisitionGeneration,
            })
        );
        const [allocated] = rows;
        if (allocated === undefined) {
          yield* requireRun(id);
          return yield* Effect.fail(importTransitionRejected());
        }
        return {
          canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
            allocated.canonicalSourceId
          ),
          generation: Schema.decodeUnknownSync(AcquisitionGenerationSchema)(
            allocated.generation
          ),
        };
      }),
    claimAcquisition: (id) =>
      Effect.gen(function* claimAcquisition() {
        const claimedAt = new Date(currentTimeMillis()).toISOString();
        yield* persistence(() =>
          database
            .update(importExecutionRuns)
            .set({
              evidenceReferencesJson: "[]",
              recoveryAction: null,
              status: "acquiring",
              statusCode: null,
              updatedAt: claimedAt,
            })
            .where(
              and(
                eq(importExecutionRuns.id, id),
                or(
                  eq(importExecutionRuns.status, "queued"),
                  and(
                    eq(importExecutionRuns.status, "failed"),
                    eq(
                      importExecutionRuns.statusCode,
                      "acquisition_temporarily_unavailable"
                    )
                  )
                )
              )
            )
        );
        const stored = yield* requireRun(id);
        return stored.view.status.kind === "acquiring"
          ? { _tag: "Acquiring", import: stored }
          : { _tag: "Finished", import: stored };
      }),
    ensureRun: (input) =>
      Effect.gen(function* ensureExecutionRun() {
        yield* persistence(() =>
          database
            .insert(importExecutionRuns)
            .values({
              canonicalSourceId: input.canonicalSourceId,
              correlationId: Schema.decodeUnknownSync(ImportCorrelationId)(
                input.correlationId
              ),
              createdAt: DateTime.formatIso(input.startedAt),
              evidenceReferencesJson: "[]",
              id: input.importId,
              recoveryAction: null,
              sourceKind: "tiktok",
              sourceType: input.sourceType,
              status: "queued",
              statusCode: null,
              updatedAt: DateTime.formatIso(input.startedAt),
            })
            .onConflictDoNothing()
        );
        const rows = yield* persistence(() =>
          database
            .select({
              canonicalSourceId: importExecutionRuns.canonicalSourceId,
              correlationId: importExecutionRuns.correlationId,
              sourceType: importExecutionRuns.sourceType,
            })
            .from(importExecutionRuns)
            .where(eq(importExecutionRuns.id, input.importId))
            .limit(1)
        );
        const [row] = rows;
        if (
          row === undefined ||
          row.canonicalSourceId !== input.canonicalSourceId ||
          row.correlationId !== input.correlationId ||
          row.sourceType !== input.sourceType
        ) {
          return yield* Effect.fail(importTransitionRejected());
        }
      }),
    findById,
    isAudioExtractionRecoveryEligible: (id) =>
      persistence(() =>
        database
          .select({ id: importExecutionRuns.id })
          .from(importExecutionRuns)
          .innerJoin(
            importTranscriptions,
            and(
              eq(importTranscriptions.importId, importExecutionRuns.id),
              eq(
                importTranscriptions.acquisitionGeneration,
                importExecutionRuns.acquisitionGeneration
              )
            )
          )
          .where(
            and(
              eq(importExecutionRuns.id, id),
              eq(importExecutionRuns.status, "failed"),
              eq(importExecutionRuns.statusCode, "transcription_failed"),
              eq(importTranscriptions.state, "failed"),
              eq(importTranscriptions.failureCode, "audio_extraction_failed")
            )
          )
          .limit(1)
      ).pipe(Effect.map((rows) => rows.length === 1)),
    recordAcquisitionFailure: (id, generation, failure, failedAt) =>
      Effect.gen(function* recordAcquisitionFailure() {
        if (failure.generation !== generation) {
          return yield* Effect.fail(importTransitionRejected());
        }
        const status = failureStatus(failure);
        const columns = statusColumns(status);
        yield* persistence(() =>
          database
            .update(importExecutionRuns)
            .set({
              evidenceReferencesJson: "[]",
              recoveryAction: columns.recoveryAction,
              status: status.kind === "unsupported" ? "unsupported" : "failed",
              statusCode: columns.statusCode,
              updatedAt: DateTime.formatIso(failedAt),
            })
            .where(
              and(
                eq(importExecutionRuns.id, id),
                eq(importExecutionRuns.status, "acquiring"),
                eq(importExecutionRuns.acquisitionGeneration, generation)
              )
            )
        );
        const stored = yield* requireRun(id);
        if (stored.acquisitionGeneration > generation) {
          return "Superseded";
        }
        return stored.acquisitionGeneration === generation &&
          JSON.stringify(stored.view.status) === JSON.stringify(status)
          ? "Recorded"
          : yield* Effect.fail(importTransitionRejected());
      }),
  };
};
