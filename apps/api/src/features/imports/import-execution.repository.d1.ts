import { and, eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Schema } from "effect";

import type {
  AcquisitionGeneration,
  ClassifiedAcquisitionFailure,
} from "./import-media.model.js";
import { AcquisitionGeneration as AcquisitionGenerationSchema } from "./import-media.model.js";
import { ImportCorrelationId } from "./import-observability.js";
import { SourceCanonicalId } from "./import.contracts.js";
import type { ImportId, ImportTimestamp } from "./import.contracts.js";
import { importExecutionRuns } from "./import.database-schema.js";
import {
  importNotFound,
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  importTransitionRejected,
} from "./import.errors.js";
import type { ImportTransitionError } from "./import.repository.js";

export interface EnsureImportExecutionRunInput {
  readonly canonicalSourceId: SourceCanonicalId;
  readonly correlationId: string;
  readonly importId: ImportId;
  readonly sourceType: "carousel" | "video";
  readonly startedAt: ImportTimestamp;
}

export interface D1ImportExecutionRepository {
  readonly beginAcquisitionAttempt: (id: ImportId) => Effect.Effect<
    {
      readonly canonicalSourceId: SourceCanonicalId;
      readonly generation: AcquisitionGeneration;
    },
    ImportTransitionError
  >;
  readonly claimAcquisition: (id: ImportId) => Effect.Effect<
    | {
        readonly _tag: "Acquiring";
        readonly canonicalSourceId: SourceCanonicalId;
      }
    | { readonly _tag: "Finished" },
    ImportTransitionError
  >;
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

const persistedStatus = (row: {
  readonly recoveryAction: string | null;
  readonly status: string;
  readonly statusCode: string | null;
}) => {
  if (row.statusCode === null && row.recoveryAction === null) {
    if (row.status === "queued" || row.status === "acquiring") {
      return { kind: row.status } as const;
    }
    throw new Error("Invalid import execution status");
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
      row.statusCode === "acquisition_temporarily_unavailable" &&
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

  const requireRun = (id: ImportId) =>
    Effect.gen(function* findImportExecution() {
      const rows = yield* persistence(() =>
        database
          .select({
            acquisitionGeneration: importExecutionRuns.acquisitionGeneration,
            canonicalSourceId: importExecutionRuns.canonicalSourceId,
            recoveryAction: importExecutionRuns.recoveryAction,
            status: importExecutionRuns.status,
            statusCode: importExecutionRuns.statusCode,
          })
          .from(importExecutionRuns)
          .where(eq(importExecutionRuns.id, id))
          .limit(1)
      );
      const [row] = rows;
      if (row === undefined) {
        return yield* Effect.fail(importNotFound(id));
      }
      return yield* Effect.try({
        catch: importPersistenceCorrupt,
        try: () => ({
          acquisitionGeneration: Schema.decodeUnknownSync(
            AcquisitionGenerationSchema
          )(row.acquisitionGeneration),
          canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
            row.canonicalSourceId
          ),
          status: persistedStatus(row),
        }),
      });
    });

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
        return stored.status.kind === "acquiring"
          ? {
              _tag: "Acquiring" as const,
              canonicalSourceId: stored.canonicalSourceId,
            }
          : { _tag: "Finished" as const };
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
          JSON.stringify(stored.status) === JSON.stringify(status)
          ? "Recorded"
          : yield* Effect.fail(importTransitionRejected());
      }),
  };
};
