import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, DateTime, Effect, Schema } from "effect";

import {
  PilotBudgetDispatchId,
  PilotProviderBudgetStage,
} from "../pilots/pilot-provider-budget.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import {
  ImportCorrelationId,
  makeImportCorrelationId,
} from "./import-observability.js";
import { ImportId } from "./import.contracts.js";
import type { ImportTimestamp } from "./import.contracts.js";
import { workflowStartUnavailable } from "./import.errors.js";
import type { WorkflowStartUnavailable } from "./import.errors.js";

const Sha256 = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

export const RecipeRecoveryIdentity = Schema.Literal("recovery:1");
export type RecipeRecoveryIdentity = typeof RecipeRecoveryIdentity.Type;

const RecipeRecoveryRow = Schema.Struct({
  acquisition_generation: AcquisitionGeneration,
  evidence_fingerprint: Sha256,
  evidence_references_json: Schema.String,
  import_id: ImportId,
  original_dispatch_id: PilotBudgetDispatchId,
  original_extraction_fingerprint: Sha256,
  recovery_dispatch_id: PilotBudgetDispatchId,
  recovery_extraction_fingerprint: Sha256,
  recovery_identity: RecipeRecoveryIdentity,
  recovery_ordinal: Schema.Literal(1),
  runtime_stage: Schema.Literal(PilotProviderBudgetStage),
  transcript_sha256: Sha256,
  visual_manifest_sha256: Sha256,
});

export interface RecipeRecovery {
  readonly acquisitionGeneration: AcquisitionGeneration;
  readonly evidenceFingerprint: string;
  readonly evidenceReferencesJson: string;
  readonly importId: ImportId;
  readonly originalDispatchId: PilotBudgetDispatchId;
  readonly originalExtractionFingerprint: string;
  readonly recoveryDispatchId: PilotBudgetDispatchId;
  readonly recoveryExtractionFingerprint: string;
  readonly recoveryIdentity: RecipeRecoveryIdentity;
  readonly recoveryOrdinal: 1;
  readonly runtimeStage: typeof PilotProviderBudgetStage;
  readonly transcriptSha256: string;
  readonly visualManifestSha256: string;
}

export type RecipeRecoveryPersistenceErrorCode =
  | "persistence_corrupt"
  | "persistence_unavailable"
  | "recovery_not_allowed"
  | "stage_not_allowed";

export interface RecipeRecoveryPersistenceError {
  readonly _tag: "RecipeRecoveryPersistenceError";
  readonly code: RecipeRecoveryPersistenceErrorCode;
}

const persistenceError = (
  code: RecipeRecoveryPersistenceErrorCode
): RecipeRecoveryPersistenceError => ({
  _tag: "RecipeRecoveryPersistenceError",
  code,
});

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: () => persistenceError("persistence_unavailable"),
    try: () => Promise.resolve(operation()),
  });

const sha256Text = (value: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    )
  );

export const recipeRecoveryExtractionFingerprint = (
  originalExtractionFingerprint: string
) =>
  sha256Text(
    JSON.stringify({
      originalExtractionFingerprint,
      recoveryIdentity: "recovery:1",
    })
  );

const readRecipeRecovery = (
  database: AnyD1Database,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) =>
  persistenceEffect(() =>
    database
      .prepare(
        `SELECT runtime_stage, import_id, acquisition_generation,
                recovery_ordinal, recovery_identity, original_dispatch_id,
                recovery_dispatch_id, evidence_fingerprint,
                original_extraction_fingerprint,
                recovery_extraction_fingerprint, transcript_sha256,
                visual_manifest_sha256, evidence_references_json
           FROM pilot_provider_recipe_recoveries
          WHERE runtime_stage = ?
            AND import_id = ?
            AND acquisition_generation = ?
            AND recovery_ordinal = 1`
      )
      .bind(PilotProviderBudgetStage, importId, acquisitionGeneration)
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(persistenceError("recovery_not_allowed"))
        : Schema.decodeUnknownEffect(RecipeRecoveryRow, {
            onExcessProperty: "ignore",
          })(row).pipe(
            Effect.mapError(() => persistenceError("persistence_corrupt"))
          )
    ),
    Effect.map(
      (row): RecipeRecovery => ({
        acquisitionGeneration: row.acquisition_generation,
        evidenceFingerprint: row.evidence_fingerprint,
        evidenceReferencesJson: row.evidence_references_json,
        importId: row.import_id,
        originalDispatchId: row.original_dispatch_id,
        originalExtractionFingerprint: row.original_extraction_fingerprint,
        recoveryDispatchId: row.recovery_dispatch_id,
        recoveryExtractionFingerprint: row.recovery_extraction_fingerprint,
        recoveryIdentity: row.recovery_identity,
        recoveryOrdinal: row.recovery_ordinal,
        runtimeStage: row.runtime_stage,
        transcriptSha256: row.transcript_sha256,
        visualManifestSha256: row.visual_manifest_sha256,
      })
    )
  );

const RecipeRecoveryCandidateRow = Schema.Struct({
  evidence_fingerprint: Sha256,
  evidence_references_json: Schema.String,
  original_extraction_fingerprint: Sha256,
  transcript_sha256: Sha256,
  visual_manifest_sha256: Sha256,
});

const readCandidate = (
  database: AnyD1Database,
  input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly originalDispatchId: PilotBudgetDispatchId;
  }
) =>
  persistenceEffect(() =>
    database
      .prepare(
        `SELECT extraction.evidence_fingerprint,
                parent.evidence_references_json,
                extraction.extraction_fingerprint
                  AS original_extraction_fingerprint,
                transcript.transcript_sha256,
                visual.manifest_sha256 AS visual_manifest_sha256
           FROM recipe_imports AS parent
           JOIN import_recipe_extractions AS extraction
             ON extraction.import_id = parent.id
            AND extraction.acquisition_generation =
                  parent.acquisition_generation
           JOIN import_transcriptions AS transcript
             ON transcript.import_id = parent.id
            AND transcript.acquisition_generation =
                  parent.acquisition_generation
           JOIN import_visual_evidence AS visual
             ON visual.import_id = parent.id
            AND visual.acquisition_generation =
                  parent.acquisition_generation
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = ?
            AND dispatch.dispatch_id = ?
            AND dispatch.dispatch_id =
                  'recipe:' || parent.id || ':' ||
                  parent.acquisition_generation || ':' ||
                  extraction.evidence_fingerprint
          WHERE parent.id = ?
            AND parent.acquisition_generation = ?
            AND extraction.state = 'failed'
            AND extraction.failure_code = 'provider_error'
            AND transcript.state = 'transcribed'
            AND visual.state = 'completed'`
      )
      .bind(
        PilotProviderBudgetStage,
        input.originalDispatchId,
        input.importId,
        input.acquisitionGeneration
      )
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(persistenceError("recovery_not_allowed"))
        : Schema.decodeUnknownEffect(RecipeRecoveryCandidateRow, {
            onExcessProperty: "ignore",
          })(row).pipe(
            Effect.mapError(() => persistenceError("persistence_corrupt"))
          )
    )
  );

export interface RecipeRecoveryRepositoryShape {
  readonly prepare: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly createdAt: ImportTimestamp;
    readonly importId: ImportId;
    readonly originalDispatchId: PilotBudgetDispatchId;
  }) => Effect.Effect<RecipeRecovery, RecipeRecoveryPersistenceError>;
  readonly read: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
  }) => Effect.Effect<RecipeRecovery, RecipeRecoveryPersistenceError>;
}

export const makeD1RecipeRecoveryRepository = (
  database: AnyD1Database,
  runtimeStage: unknown
): RecipeRecoveryRepositoryShape => ({
  prepare: (input) =>
    Effect.gen(function* prepareRecipeRecovery() {
      if (runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(persistenceError("stage_not_allowed"));
      }
      const existing = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration
      ).pipe(
        Effect.map((recovery): RecipeRecovery | null => recovery),
        Effect.catchTag("RecipeRecoveryPersistenceError", (error) =>
          error.code === "recovery_not_allowed"
            ? Effect.succeed(null)
            : Effect.fail(error)
        )
      );
      if (existing !== null) {
        return existing.originalDispatchId === input.originalDispatchId
          ? existing
          : yield* Effect.fail(persistenceError("recovery_not_allowed"));
      }
      const candidate = yield* readCandidate(database, input);
      const recoveryDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(`${input.originalDispatchId}:recovery:1`).pipe(
        Effect.mapError(() => persistenceError("persistence_corrupt"))
      );
      const recoveryExtractionFingerprint =
        yield* recipeRecoveryExtractionFingerprint(
          candidate.original_extraction_fingerprint
        );
      yield* persistenceEffect(() =>
        database
          .prepare(
            `INSERT INTO pilot_provider_recipe_recoveries (
               runtime_stage, import_id, acquisition_generation,
               recovery_ordinal, recovery_identity, original_dispatch_id,
               recovery_dispatch_id, evidence_fingerprint,
               original_extraction_fingerprint,
               recovery_extraction_fingerprint, transcript_sha256,
               visual_manifest_sha256, evidence_references_json, created_at
             ) VALUES (?, ?, ?, 1, 'recovery:1', ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(
               runtime_stage, import_id, acquisition_generation,
               recovery_ordinal
             ) DO NOTHING`
          )
          .bind(
            PilotProviderBudgetStage,
            input.importId,
            input.acquisitionGeneration,
            input.originalDispatchId,
            recoveryDispatchId,
            candidate.evidence_fingerprint,
            candidate.original_extraction_fingerprint,
            recoveryExtractionFingerprint,
            candidate.transcript_sha256,
            candidate.visual_manifest_sha256,
            candidate.evidence_references_json,
            DateTime.formatIso(input.createdAt)
          )
          .run()
      );
      const recovery = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration
      );
      if (recovery.originalDispatchId === input.originalDispatchId) {
        return recovery;
      }
      return yield* Effect.fail(persistenceError("persistence_corrupt"));
    }),
  read: (input) =>
    runtimeStage === PilotProviderBudgetStage
      ? readRecipeRecovery(
          database,
          input.importId,
          input.acquisitionGeneration
        )
      : Effect.fail(persistenceError("stage_not_allowed")),
});

export const RecipeRecoveryWorkflowInput = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  correlationId: ImportCorrelationId,
  importId: ImportId,
  recoveryOrdinal: Schema.Literal(1),
});
export type RecipeRecoveryWorkflowInput =
  typeof RecipeRecoveryWorkflowInput.Type;

interface WorkflowInstanceLike {
  readonly status: () => Effect.Effect<{ readonly status: string }>;
}

interface WorkflowHandleLike {
  readonly createBatch: (
    batch: {
      readonly id?: string;
      readonly params?: unknown;
    }[]
  ) => Effect.Effect<readonly WorkflowInstanceLike[]>;
  readonly get: (id: string) => Effect.Effect<WorkflowInstanceLike>;
}

const recoverableWorkflowStatuses = new Set([
  "complete",
  "queued",
  "running",
  "waiting",
  "waitingForPause",
]);

const reconcileWorkflowInstance = (instance: WorkflowInstanceLike) =>
  instance
    .status()
    .pipe(
      Effect.flatMap(({ status }) =>
        recoverableWorkflowStatuses.has(status)
          ? Effect.void
          : Effect.fail(workflowStartUnavailable())
      )
    );

export interface RecipeRecoveryWorkflowStarterShape {
  readonly start: (
    recovery: RecipeRecovery
  ) => Effect.Effect<void, WorkflowStartUnavailable>;
}

export const recipeRecoveryWorkflowInstanceId = (
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) => `import-recipe-recovery-${importId}-${acquisitionGeneration}-1`;

export const makeRecipeRecoveryWorkflowStarter = (
  workflow: WorkflowHandleLike,
  newCorrelationId: () => ImportCorrelationId = makeImportCorrelationId
): RecipeRecoveryWorkflowStarterShape => ({
  start: (recovery) => {
    const id = recipeRecoveryWorkflowInstanceId(
      recovery.importId,
      recovery.acquisitionGeneration
    );
    const params = Schema.decodeUnknownSync(RecipeRecoveryWorkflowInput)({
      acquisitionGeneration: recovery.acquisitionGeneration,
      correlationId: newCorrelationId(),
      importId: recovery.importId,
      recoveryOrdinal: 1,
    });
    return workflow.createBatch([{ id, params }]).pipe(
      Effect.flatMap((created) => {
        if (created.length === 1) {
          return Effect.void;
        }
        if (created.length === 0) {
          return workflow
            .get(id)
            .pipe(Effect.flatMap(reconcileWorkflowInstance));
        }
        return Effect.fail(workflowStartUnavailable());
      }),
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        () => workflow.get(id).pipe(Effect.flatMap(reconcileWorkflowInstance))
      ),
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        () => Effect.fail(workflowStartUnavailable())
      )
    );
  },
});
