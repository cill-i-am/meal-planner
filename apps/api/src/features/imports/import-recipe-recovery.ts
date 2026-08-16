/* eslint-disable max-classes-per-file -- This module owns one closed, Schema-backed recovery failure family. */
import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, Data, DateTime, Effect, Option, Schema } from "effect";

import {
  PilotBudgetDispatchId,
  PilotProviderBudgetStage,
} from "../pilots/pilot-provider-budget.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import {
  ImportCorrelationId,
  ImportTraceContext,
} from "./import-observability.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import { workflowStartUnavailable } from "./import.errors.js";
import type { WorkflowStartUnavailable } from "./import.errors.js";

export const RecipeRecoveryOrdinal = Schema.Literals([1, 2, 3, 4, 5, 6, 7, 8]);
export type RecipeRecoveryOrdinal = typeof RecipeRecoveryOrdinal.Type;

export const recipeRecoveryDurableTaskNames = (
  ordinal: RecipeRecoveryOrdinal
) =>
  ({
    extraction: `extract-recipe-recovery-v${ordinal}`,
    terminal: `persist-recipe-recovery-terminal-v${ordinal}`,
  }) as const;

const EvidenceReferencesJson = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => {
        try {
          const decoded: unknown = JSON.parse(value);
          return Array.isArray(decoded) && decoded.length === 3;
        } catch {
          return false;
        }
      },
      { expected: "a three-entry evidence reference JSON array" }
    )
  )
);

const RecipeRecoveryAttemptRow = Schema.Struct({
  acquisition_generation: AcquisitionGeneration,
  created_at: ImportTimestamp,
  current_dispatch_id: PilotBudgetDispatchId,
  current_extraction_fingerprint: Sha256Hex,
  evidence_fingerprint: Sha256Hex,
  evidence_references_json: EvidenceReferencesJson,
  import_id: ImportId,
  predecessor_dispatch_id: PilotBudgetDispatchId,
  predecessor_extraction_fingerprint: Sha256Hex,
  predecessor_outcome: Schema.Literal("outcome_unknown"),
  predecessor_reconciliation_created_at: ImportTimestamp,
  recovery_ordinal: RecipeRecoveryOrdinal,
  root_dispatch_id: PilotBudgetDispatchId,
  root_extraction_fingerprint: Sha256Hex,
  runtime_stage: Schema.Literal(PilotProviderBudgetStage),
  source_media_sha256: Sha256Hex,
  terminal_checkpoint_completed_at: ImportTimestamp,
  transcript_sha256: Sha256Hex,
  visual_manifest_sha256: Sha256Hex,
});

export interface RecipeRecoveryAttempt {
  readonly acquisitionGeneration: AcquisitionGeneration;
  readonly createdAt: ImportTimestamp;
  readonly currentDispatchId: PilotBudgetDispatchId;
  readonly currentExtractionFingerprint: Sha256Hex;
  readonly evidenceFingerprint: Sha256Hex;
  readonly evidenceReferencesJson: string;
  readonly importId: ImportId;
  readonly ordinal: RecipeRecoveryOrdinal;
  readonly predecessorDispatchId: PilotBudgetDispatchId;
  readonly predecessorExtractionFingerprint: Sha256Hex;
  readonly predecessorOutcome: "outcome_unknown";
  readonly predecessorReconciliationCreatedAt: ImportTimestamp;
  readonly rootDispatchId: PilotBudgetDispatchId;
  readonly rootExtractionFingerprint: Sha256Hex;
  readonly runtimeStage: typeof PilotProviderBudgetStage;
  readonly sourceMediaSha256: Sha256Hex;
  readonly terminalCheckpointCompletedAt: ImportTimestamp;
  readonly transcriptSha256: Sha256Hex;
  readonly visualManifestSha256: Sha256Hex;
}

const RecoveryFailureFields = {
  acquisitionGeneration: AcquisitionGeneration,
  importId: ImportId,
};

/* eslint-disable unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression. */
export class RecipeRecoveryMissingPredecessor extends Schema.TaggedError<RecipeRecoveryMissingPredecessor>()(
  "RecipeRecovery.MissingPredecessor",
  RecoveryFailureFields
) {}

export class RecipeRecoveryStaleGeneration extends Schema.TaggedError<RecipeRecoveryStaleGeneration>()(
  "RecipeRecovery.StaleGeneration",
  {
    ...RecoveryFailureFields,
    currentGeneration: AcquisitionGeneration,
  }
) {}

export class RecipeRecoveryEvidenceMismatch extends Schema.TaggedError<RecipeRecoveryEvidenceMismatch>()(
  "RecipeRecovery.EvidenceMismatch",
  RecoveryFailureFields
) {}

export class RecipeRecoveryDispatchConflict extends Schema.TaggedError<RecipeRecoveryDispatchConflict>()(
  "RecipeRecovery.DispatchConflict",
  {
    ...RecoveryFailureFields,
    dispatchId: PilotBudgetDispatchId,
  }
) {}

export class RecipeRecoveryExtractionConflict extends Schema.TaggedError<RecipeRecoveryExtractionConflict>()(
  "RecipeRecovery.ExtractionConflict",
  {
    ...RecoveryFailureFields,
    extractionFingerprint: Sha256Hex,
  }
) {}

export class RecipeRecoveryReconciliationRequired extends Schema.TaggedError<RecipeRecoveryReconciliationRequired>()(
  "RecipeRecovery.ReconciliationRequired",
  {
    ...RecoveryFailureFields,
    dispatchId: PilotBudgetDispatchId,
  }
) {}

export class RecipeRecoveryBudgetExhausted extends Schema.TaggedError<RecipeRecoveryBudgetExhausted>()(
  "RecipeRecovery.BudgetExhausted",
  RecoveryFailureFields
) {}

export class RecipeRecoveryAttemptLimitReached extends Schema.TaggedError<RecipeRecoveryAttemptLimitReached>()(
  "RecipeRecovery.AttemptLimitReached",
  RecoveryFailureFields
) {}

export class RecipeRecoveryTerminal extends Schema.TaggedError<RecipeRecoveryTerminal>()(
  "RecipeRecovery.Terminal",
  {
    ...RecoveryFailureFields,
    reason: Schema.Literals(["non_retryable", "replay_value_available"]),
  }
) {}

export class RecipeRecoveryOutcomeUnknown extends Schema.TaggedError<RecipeRecoveryOutcomeUnknown>()(
  "RecipeRecovery.OutcomeUnknown",
  {
    ...RecoveryFailureFields,
    dispatchId: PilotBudgetDispatchId,
  }
) {}

const RecoveryD1Operation = Schema.Literals([
  "decode",
  "insert",
  "read_attempt",
  "read_authority",
  "read_current",
  "read_evidence",
  "read_extraction",
]);

export class RecipeRecoveryD1Unavailable extends Schema.TaggedError<RecipeRecoveryD1Unavailable>()(
  "RecipeRecovery.D1Unavailable",
  { operation: RecoveryD1Operation }
) {}

export class RecipeRecoveryIntegrityFailure extends Schema.TaggedError<RecipeRecoveryIntegrityFailure>()(
  "RecipeRecovery.IntegrityFailure",
  { operation: RecoveryD1Operation }
) {}
/* eslint-enable unicorn/throw-new-error */

export type RecipeRecoveryFailure =
  | RecipeRecoveryAttemptLimitReached
  | RecipeRecoveryBudgetExhausted
  | RecipeRecoveryD1Unavailable
  | RecipeRecoveryDispatchConflict
  | RecipeRecoveryEvidenceMismatch
  | RecipeRecoveryExtractionConflict
  | RecipeRecoveryIntegrityFailure
  | RecipeRecoveryMissingPredecessor
  | RecipeRecoveryOutcomeUnknown
  | RecipeRecoveryReconciliationRequired
  | RecipeRecoveryStaleGeneration
  | RecipeRecoveryTerminal;

type RecoveryD1Operation = typeof RecoveryD1Operation.Type;

const runD1 = <A>(
  operation: RecoveryD1Operation,
  evaluate: () => PromiseLike<A>
) =>
  Effect.tryPromise({
    catch: () => new RecipeRecoveryD1Unavailable({ operation }),
    try: () => Promise.resolve(evaluate()),
  });

const decodeD1 = <S extends Schema.Top>(
  schema: S,
  operation: RecoveryD1Operation,
  value: unknown
) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "ignore" })(
    value
  ).pipe(
    Effect.mapError(() => new RecipeRecoveryIntegrityFailure({ operation }))
  );

const toAttempt = (
  row: typeof RecipeRecoveryAttemptRow.Type
): RecipeRecoveryAttempt => ({
  acquisitionGeneration: row.acquisition_generation,
  createdAt: row.created_at,
  currentDispatchId: row.current_dispatch_id,
  currentExtractionFingerprint: row.current_extraction_fingerprint,
  evidenceFingerprint: row.evidence_fingerprint,
  evidenceReferencesJson: row.evidence_references_json,
  importId: row.import_id,
  ordinal: row.recovery_ordinal,
  predecessorDispatchId: row.predecessor_dispatch_id,
  predecessorExtractionFingerprint: row.predecessor_extraction_fingerprint,
  predecessorOutcome: row.predecessor_outcome,
  predecessorReconciliationCreatedAt: row.predecessor_reconciliation_created_at,
  rootDispatchId: row.root_dispatch_id,
  rootExtractionFingerprint: row.root_extraction_fingerprint,
  runtimeStage: row.runtime_stage,
  sourceMediaSha256: row.source_media_sha256,
  terminalCheckpointCompletedAt: row.terminal_checkpoint_completed_at,
  transcriptSha256: row.transcript_sha256,
  visualManifestSha256: row.visual_manifest_sha256,
});

const readCurrentAttempt = (
  database: AnyD1Database,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) =>
  runD1("read_current", () =>
    database
      .prepare(
        `SELECT runtime_stage, import_id, acquisition_generation,
                recovery_ordinal, root_dispatch_id, predecessor_dispatch_id,
                current_dispatch_id, root_extraction_fingerprint,
                predecessor_extraction_fingerprint,
                current_extraction_fingerprint, predecessor_outcome,
                terminal_checkpoint_completed_at,
                predecessor_reconciliation_created_at, evidence_fingerprint,
                source_media_sha256, transcript_sha256, visual_manifest_sha256,
                evidence_references_json, created_at
           FROM pilot_provider_recipe_recovery_attempts
          WHERE runtime_stage = ?
            AND import_id = ?
            AND acquisition_generation = ?
          ORDER BY recovery_ordinal DESC
          LIMIT 1`
      )
      .bind(PilotProviderBudgetStage, importId, acquisitionGeneration)
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.succeed(Option.none<RecipeRecoveryAttempt>())
        : decodeD1(RecipeRecoveryAttemptRow, "decode", row).pipe(
            Effect.map((decoded) => Option.some(toAttempt(decoded)))
          )
    )
  );

const readAttemptAtOrdinal = (
  database: AnyD1Database,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration,
  ordinal: RecipeRecoveryOrdinal
) =>
  runD1("read_attempt", () =>
    database
      .prepare(
        `SELECT runtime_stage, import_id, acquisition_generation,
                recovery_ordinal, root_dispatch_id, predecessor_dispatch_id,
                current_dispatch_id, root_extraction_fingerprint,
                predecessor_extraction_fingerprint,
                current_extraction_fingerprint, predecessor_outcome,
                terminal_checkpoint_completed_at,
                predecessor_reconciliation_created_at, evidence_fingerprint,
                source_media_sha256, transcript_sha256, visual_manifest_sha256,
                evidence_references_json, created_at
           FROM pilot_provider_recipe_recovery_attempts
          WHERE runtime_stage = ?
            AND import_id = ?
            AND acquisition_generation = ?
            AND recovery_ordinal = ?
          LIMIT 1`
      )
      .bind(PilotProviderBudgetStage, importId, acquisitionGeneration, ordinal)
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.succeed(Option.none<RecipeRecoveryAttempt>())
        : decodeD1(RecipeRecoveryAttemptRow, "decode", row).pipe(
            Effect.map((decoded) => Option.some(toAttempt(decoded)))
          )
    )
  );

const ImportEvidenceRow = Schema.Struct({
  acquisition_generation: AcquisitionGeneration,
  evidence_references_json: Schema.String,
  recovery_action: Schema.NullOr(Schema.String),
  status: Schema.String,
  status_code: Schema.NullOr(Schema.String),
  transcript_sha256: Schema.NullOr(Sha256Hex),
  transcript_source_sha256: Schema.NullOr(Sha256Hex),
  transcript_state: Schema.NullOr(Schema.String),
  visual_manifest_sha256: Schema.NullOr(Sha256Hex),
  visual_source_sha256: Schema.NullOr(Sha256Hex),
  visual_state: Schema.NullOr(Schema.String),
});

type ImportEvidence = typeof ImportEvidenceRow.Type;

const readImportEvidence = (database: AnyD1Database, importId: ImportId) =>
  runD1("read_evidence", () =>
    database
      .prepare(
        `SELECT parent.acquisition_generation,
                parent.evidence_references_json,
                parent.status, parent.status_code, parent.recovery_action,
                transcript.state AS transcript_state,
                transcript.transcript_sha256,
                transcript.source_media_sha256 AS transcript_source_sha256,
                visual.state AS visual_state,
                visual.manifest_sha256 AS visual_manifest_sha256,
                visual.source_media_sha256 AS visual_source_sha256
           FROM recipe_imports AS parent
           LEFT JOIN import_transcriptions AS transcript
             ON transcript.import_id = parent.id
            AND transcript.acquisition_generation =
                  parent.acquisition_generation
           LEFT JOIN import_visual_evidence AS visual
             ON visual.import_id = parent.id
            AND visual.acquisition_generation = parent.acquisition_generation
          WHERE parent.id = ?
          LIMIT 1`
      )
      .bind(importId)
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.succeed(Option.none<ImportEvidence>())
        : decodeD1(ImportEvidenceRow, "decode", row).pipe(
            Effect.map(Option.some)
          )
    )
  );

const RootExtractionRow = Schema.Struct({
  completed_at: Schema.NullOr(ImportTimestamp),
  evidence_fingerprint: Sha256Hex,
  extraction_fingerprint: Sha256Hex,
  failure_code: Schema.NullOr(Schema.String),
  state: Schema.String,
});

const readRootExtraction = (
  database: AnyD1Database,
  input: PrepareNextRecipeRecoveryAttempt
) =>
  runD1("read_extraction", () =>
    database
      .prepare(
        `SELECT extraction.extraction_fingerprint,
                extraction.evidence_fingerprint, extraction.state,
                extraction.failure_code, extraction.completed_at
           FROM import_recipe_extractions AS extraction
          WHERE extraction.import_id = ?
            AND extraction.acquisition_generation = ?
            AND ? = 'recipe:' || extraction.import_id || ':' ||
                    extraction.acquisition_generation || ':' ||
                    extraction.evidence_fingerprint
          LIMIT 1`
      )
      .bind(
        input.importId,
        input.acquisitionGeneration,
        input.predecessorDispatchId
      )
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.succeed(Option.none<typeof RootExtractionRow.Type>())
        : decodeD1(RootExtractionRow, "decode", row).pipe(
            Effect.map(Option.some)
          )
    )
  );

const AuthorityRow = Schema.Struct({
  audit_actual_cost_was_unknown: Schema.NullOr(Schema.Number),
  audit_authority: Schema.NullOr(Schema.String),
  audit_conservative_charge_micro_usd: Schema.NullOr(Schema.Number),
  audit_created_at: Schema.NullOr(ImportTimestamp),
  checkpoint_completed_at: Schema.NullOr(ImportTimestamp),
  checkpoint_failure_code: Schema.NullOr(Schema.String),
  checkpoint_ownership_id: Schema.NullOr(Sha256Hex),
  current_dispatch_count: Schema.Number,
  current_extraction_count: Schema.Number,
  predecessor_actual_cost_micro_usd: Schema.NullOr(Schema.Number),
  predecessor_dispatch_state: Schema.NullOr(Schema.String),
  predecessor_failure_code: Schema.NullOr(Schema.String),
  predecessor_is_current: Schema.NullOr(Schema.Number),
  predecessor_maximum_cost_micro_usd: Schema.NullOr(Schema.Number),
  predecessor_run_id: Schema.NullOr(Schema.String),
  predecessor_state: Schema.NullOr(Schema.String),
  projection_evidence_references_json: Schema.NullOr(Schema.String),
  projection_recovery_action: Schema.NullOr(Schema.String),
  projection_status: Schema.NullOr(Schema.String),
  projection_status_code: Schema.NullOr(Schema.String),
  replay_count: Schema.Number,
  root_completed_at: Schema.NullOr(ImportTimestamp),
  root_failure_code: Schema.NullOr(Schema.String),
  root_state: Schema.NullOr(Schema.String),
  stage_budget_cap_micro_usd: Schema.NullOr(Schema.Number),
  stage_invoking_dispatch_id: Schema.NullOr(Schema.String),
  stage_poison_dispatch_id: Schema.NullOr(Schema.String),
  stage_reserved_micro_usd: Schema.NullOr(Schema.Number),
  stage_settled_micro_usd: Schema.NullOr(Schema.Number),
  stage_state: Schema.NullOr(Schema.String),
});

interface RecoveryAuthorityIdentity {
  readonly currentDispatchId: PilotBudgetDispatchId;
  readonly currentExtractionFingerprint: Sha256Hex;
  readonly predecessorDispatchId: PilotBudgetDispatchId;
  readonly predecessorExtractionFingerprint: Sha256Hex;
  readonly rootDispatchId: PilotBudgetDispatchId;
  readonly rootExtractionFingerprint: Sha256Hex;
}

const readAuthority = (
  database: AnyD1Database,
  input: PrepareNextRecipeRecoveryAttempt,
  identity: RecoveryAuthorityIdentity
) =>
  runD1("read_authority", () =>
    database
      .prepare(
        `SELECT root.state AS root_state,
                root.failure_code AS root_failure_code,
                root.completed_at AS root_completed_at,
                predecessor.state AS predecessor_state,
                predecessor.failure_code AS predecessor_failure_code,
                predecessor.is_current AS predecessor_is_current,
                checkpoint.ownership_id AS checkpoint_ownership_id,
                checkpoint.failure_code AS checkpoint_failure_code,
                checkpoint.completed_at AS checkpoint_completed_at,
                projection.status AS projection_status,
                projection.status_code AS projection_status_code,
                projection.recovery_action AS projection_recovery_action,
                projection.evidence_references_json
                  AS projection_evidence_references_json,
                dispatch.run_id AS predecessor_run_id,
                dispatch.state AS predecessor_dispatch_state,
                dispatch.actual_cost_micro_usd
                  AS predecessor_actual_cost_micro_usd,
                dispatch.maximum_cost_micro_usd
                  AS predecessor_maximum_cost_micro_usd,
                audit.actual_cost_was_unknown
                  AS audit_actual_cost_was_unknown,
                audit.authority AS audit_authority,
                audit.conservative_charge_micro_usd
                  AS audit_conservative_charge_micro_usd,
                audit.created_at AS audit_created_at,
                stage.state AS stage_state,
                stage.reserved_micro_usd AS stage_reserved_micro_usd,
                stage.settled_micro_usd AS stage_settled_micro_usd,
                stage.budget_cap_micro_usd AS stage_budget_cap_micro_usd,
                stage.invoking_dispatch_id AS stage_invoking_dispatch_id,
                stage.poison_dispatch_id AS stage_poison_dispatch_id,
                (SELECT count(*)
                   FROM pilot_provider_recipe_replay_values AS replay
                  WHERE replay.runtime_stage = ?
                    AND replay.dispatch_id = ?) AS replay_count,
                (SELECT count(*)
                   FROM pilot_provider_budget_dispatches AS current_dispatch
                  WHERE current_dispatch.runtime_stage = ?
                    AND current_dispatch.dispatch_id = ?)
                  AS current_dispatch_count,
                (SELECT count(*)
                   FROM import_recipe_extractions AS current_extraction
                  WHERE current_extraction.extraction_fingerprint = ?)
                  AS current_extraction_count
           FROM (SELECT 1 AS singleton) AS one
           LEFT JOIN import_recipe_extractions AS root
             ON root.extraction_fingerprint = ?
            AND root.import_id = ?
            AND root.acquisition_generation = ?
           LEFT JOIN import_recipe_extractions AS predecessor
             ON predecessor.extraction_fingerprint = ?
            AND predecessor.import_id = ?
            AND predecessor.acquisition_generation = ?
           LEFT JOIN import_provider_terminal_checkpoints AS checkpoint
             ON checkpoint.import_id = ?
            AND checkpoint.acquisition_generation = ?
            AND checkpoint.provider_stage = 'recipe'
            AND checkpoint.ownership_id = ?
           LEFT JOIN import_recipe_terminal_projections AS projection
             ON projection.import_id = checkpoint.import_id
            AND projection.acquisition_generation =
                  checkpoint.acquisition_generation
            AND projection.ownership_id = checkpoint.ownership_id
            AND projection.projected_at = checkpoint.completed_at
           LEFT JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = ?
            AND dispatch.dispatch_id = ?
           LEFT JOIN pilot_provider_budget_reconciliations AS audit
             ON audit.runtime_stage = dispatch.runtime_stage
            AND audit.dispatch_id = dispatch.dispatch_id
           LEFT JOIN pilot_provider_stage_budget AS stage
             ON stage.runtime_stage = ?`
      )
      .bind(
        PilotProviderBudgetStage,
        identity.predecessorDispatchId,
        PilotProviderBudgetStage,
        identity.currentDispatchId,
        identity.currentExtractionFingerprint,
        identity.rootExtractionFingerprint,
        input.importId,
        input.acquisitionGeneration,
        identity.predecessorExtractionFingerprint,
        input.importId,
        input.acquisitionGeneration,
        input.importId,
        input.acquisitionGeneration,
        identity.rootExtractionFingerprint,
        PilotProviderBudgetStage,
        identity.predecessorDispatchId,
        PilotProviderBudgetStage
      )
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(
            new RecipeRecoveryIntegrityFailure({
              operation: "read_authority",
            })
          )
        : decodeD1(AuthorityRow, "decode", row)
    )
  );

const baseFailure = (input: PrepareNextRecipeRecoveryAttempt) => ({
  acquisitionGeneration: input.acquisitionGeneration,
  importId: input.importId,
});

const requireLiveEvidence = (
  input: PrepareNextRecipeRecoveryAttempt,
  live: ImportEvidence,
  previous: Option.Option<RecipeRecoveryAttempt>
) => {
  if (live.acquisition_generation !== input.acquisitionGeneration) {
    return Effect.fail(
      new RecipeRecoveryStaleGeneration({
        ...baseFailure(input),
        currentGeneration: live.acquisition_generation,
      })
    );
  }
  if (
    live.status !== "transcribed" ||
    live.status_code !== null ||
    live.recovery_action !== null ||
    live.transcript_state !== "transcribed" ||
    live.visual_state !== "completed" ||
    live.transcript_sha256 === null ||
    live.transcript_source_sha256 === null ||
    live.visual_manifest_sha256 === null ||
    live.visual_source_sha256 === null ||
    live.transcript_source_sha256 !== live.visual_source_sha256
  ) {
    return Effect.fail(
      new RecipeRecoveryTerminal({
        ...baseFailure(input),
        reason: "non_retryable",
      })
    );
  }
  if (
    Option.isSome(previous) &&
    (previous.value.evidenceReferencesJson !== live.evidence_references_json ||
      previous.value.sourceMediaSha256 !== live.transcript_source_sha256 ||
      previous.value.transcriptSha256 !== live.transcript_sha256 ||
      previous.value.visualManifestSha256 !== live.visual_manifest_sha256)
  ) {
    return Effect.fail(new RecipeRecoveryEvidenceMismatch(baseFailure(input)));
  }
  return Effect.succeed({
    evidenceReferencesJson: live.evidence_references_json,
    sourceMediaSha256: live.transcript_source_sha256,
    transcriptSha256: live.transcript_sha256,
    visualManifestSha256: live.visual_manifest_sha256,
  });
};

const requireRootAuthority = (
  input: PrepareNextRecipeRecoveryAttempt,
  identity: RecoveryAuthorityIdentity,
  authority: typeof AuthorityRow.Type,
  evidenceReferencesJson: string
) => {
  if (
    authority.root_state === "failed" &&
    authority.root_failure_code !== "provider_error"
  ) {
    return Effect.fail(
      new RecipeRecoveryTerminal({
        ...baseFailure(input),
        reason: "non_retryable",
      })
    );
  }
  if (
    authority.root_completed_at === null ||
    authority.checkpoint_ownership_id !== identity.rootExtractionFingerprint ||
    authority.checkpoint_failure_code !== "outcome_unknown" ||
    authority.checkpoint_completed_at === null ||
    !DateTime.Equivalence(
      authority.checkpoint_completed_at,
      authority.root_completed_at
    ) ||
    authority.projection_status !== "failed" ||
    authority.projection_status_code !== "recipe_extraction_failed" ||
    authority.projection_recovery_action !== "operator_reconcile"
  ) {
    return Effect.fail(
      new RecipeRecoveryOutcomeUnknown({
        ...baseFailure(input),
        dispatchId: identity.rootDispatchId,
      })
    );
  }
  if (
    authority.projection_evidence_references_json !== evidenceReferencesJson
  ) {
    return Effect.fail(new RecipeRecoveryEvidenceMismatch(baseFailure(input)));
  }
  return Effect.succeed(authority.checkpoint_completed_at);
};

const requirePredecessorAuthority = (
  input: PrepareNextRecipeRecoveryAttempt,
  identity: RecoveryAuthorityIdentity,
  authority: typeof AuthorityRow.Type,
  isFirstAttempt: boolean
) => {
  if (
    authority.predecessor_state === null ||
    authority.predecessor_dispatch_state === null
  ) {
    return Effect.fail(
      new RecipeRecoveryMissingPredecessor(baseFailure(input))
    );
  }
  if (
    authority.predecessor_state !== "failed" ||
    authority.predecessor_failure_code !== "provider_error" ||
    (!isFirstAttempt && authority.predecessor_is_current !== 0)
  ) {
    return Effect.fail(
      new RecipeRecoveryTerminal({
        ...baseFailure(input),
        reason: "non_retryable",
      })
    );
  }
  if (authority.replay_count > 0) {
    return Effect.fail(
      new RecipeRecoveryTerminal({
        ...baseFailure(input),
        reason: "replay_value_available",
      })
    );
  }
  if (
    authority.predecessor_dispatch_state !== "settled_unknown" ||
    authority.predecessor_actual_cost_micro_usd !== null ||
    authority.predecessor_maximum_cost_micro_usd !== 100_000
  ) {
    return Effect.fail(
      new RecipeRecoveryOutcomeUnknown({
        ...baseFailure(input),
        dispatchId: identity.predecessorDispatchId,
      })
    );
  }
  if (
    authority.audit_actual_cost_was_unknown !== 1 ||
    authority.audit_authority !== "authenticated_operator" ||
    authority.audit_conservative_charge_micro_usd !== 100_000 ||
    authority.audit_created_at === null
  ) {
    return Effect.fail(
      new RecipeRecoveryReconciliationRequired({
        ...baseFailure(input),
        dispatchId: identity.predecessorDispatchId,
      })
    );
  }
  const expectedRunId = isFirstAttempt
    ? `gaia-118:${input.importId}`
    : `gaia-118:recipe-recovery:${input.importId}`;
  if (authority.predecessor_run_id !== expectedRunId) {
    return Effect.fail(
      new RecipeRecoveryDispatchConflict({
        ...baseFailure(input),
        dispatchId: identity.predecessorDispatchId,
      })
    );
  }
  return Effect.succeed(authority.audit_created_at);
};

const requireBudgetAuthority = (
  input: PrepareNextRecipeRecoveryAttempt,
  identity: RecoveryAuthorityIdentity,
  authority: typeof AuthorityRow.Type
) => {
  if (
    authority.stage_state !== "open" ||
    authority.stage_reserved_micro_usd !== 0 ||
    authority.stage_invoking_dispatch_id !== null ||
    authority.stage_poison_dispatch_id !== null ||
    authority.stage_settled_micro_usd === null ||
    authority.stage_budget_cap_micro_usd === null ||
    authority.stage_settled_micro_usd + 100_000 >
      authority.stage_budget_cap_micro_usd
  ) {
    return Effect.fail(new RecipeRecoveryBudgetExhausted(baseFailure(input)));
  }
  if (authority.current_dispatch_count > 0) {
    return Effect.fail(
      new RecipeRecoveryDispatchConflict({
        ...baseFailure(input),
        dispatchId: identity.currentDispatchId,
      })
    );
  }
  if (authority.current_extraction_count > 0) {
    return Effect.fail(
      new RecipeRecoveryExtractionConflict({
        ...baseFailure(input),
        extractionFingerprint: identity.currentExtractionFingerprint,
      })
    );
  }
  return Effect.void;
};

const requireAuthority = (
  input: PrepareNextRecipeRecoveryAttempt,
  identity: RecoveryAuthorityIdentity,
  authority: typeof AuthorityRow.Type,
  isFirstAttempt: boolean,
  evidenceReferencesJson: string
) =>
  Effect.gen(function* requireRecoveryAuthority() {
    const terminalCheckpointCompletedAt = yield* requireRootAuthority(
      input,
      identity,
      authority,
      evidenceReferencesJson
    );
    const predecessorReconciliationCreatedAt =
      yield* requirePredecessorAuthority(
        input,
        identity,
        authority,
        isFirstAttempt
      );
    yield* requireBudgetAuthority(input, identity, authority);
    return {
      predecessorReconciliationCreatedAt,
      terminalCheckpointCompletedAt,
    };
  });

export const recipeRecoveryExtractionFingerprint = Effect.fn(
  "RecipeRecovery.extractionFingerprint"
)(function* recipeRecoveryExtractionFingerprintEffect(
  predecessorExtractionFingerprint: Sha256Hex,
  ordinal: RecipeRecoveryOrdinal
) {
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({
          originalExtractionFingerprint: predecessorExtractionFingerprint,
          recoveryIdentity: `recovery:${ordinal}`,
        })
      )
    )
  );
  const value = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return yield* decodeD1(Sha256Hex, "decode", value);
});

const nextOrdinal = (
  current: Option.Option<RecipeRecoveryAttempt>,
  input: PrepareNextRecipeRecoveryAttempt
) => {
  if (Option.isNone(current)) {
    return Effect.succeed(1 as const);
  }
  if (current.value.ordinal === 8) {
    return Effect.fail(
      new RecipeRecoveryAttemptLimitReached(baseFailure(input))
    );
  }
  return decodeD1(RecipeRecoveryOrdinal, "decode", current.value.ordinal + 1);
};

export const PrepareNextRecipeRecoveryAttempt = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  createdAt: Schema.toType(ImportTimestamp),
  importId: ImportId,
  predecessorDispatchId: PilotBudgetDispatchId,
});
export type PrepareNextRecipeRecoveryAttempt =
  typeof PrepareNextRecipeRecoveryAttempt.Type;

export interface RecipeRecoveryRepositoryShape {
  readonly prepareNextAttempt: (
    input: PrepareNextRecipeRecoveryAttempt
  ) => Effect.Effect<RecipeRecoveryAttempt, RecipeRecoveryFailure>;
  readonly readAttempt: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly ordinal: RecipeRecoveryOrdinal;
  }) => Effect.Effect<
    Option.Option<RecipeRecoveryAttempt>,
    RecipeRecoveryD1Unavailable | RecipeRecoveryIntegrityFailure
  >;
  readonly readCurrent: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
  }) => Effect.Effect<
    Option.Option<RecipeRecoveryAttempt>,
    RecipeRecoveryD1Unavailable | RecipeRecoveryIntegrityFailure
  >;
  readonly readResumable: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly rootDispatchId: PilotBudgetDispatchId;
  }) => Effect.Effect<RecipeRecoveryAttempt, RecipeRecoveryFailure>;
}

export const makeD1RecipeRecoveryRepository = (
  database: AnyD1Database,
  runtimeStage: unknown
): RecipeRecoveryRepositoryShape => {
  const readAttempt: RecipeRecoveryRepositoryShape["readAttempt"] = Effect.fn(
    "RecipeRecoveryRepository.readAttempt"
  )((input) => {
    if (runtimeStage !== PilotProviderBudgetStage) {
      return Effect.fail(
        new RecipeRecoveryD1Unavailable({ operation: "read_attempt" })
      );
    }
    return readAttemptAtOrdinal(
      database,
      input.importId,
      input.acquisitionGeneration,
      input.ordinal
    );
  });

  const readCurrent: RecipeRecoveryRepositoryShape["readCurrent"] = Effect.fn(
    "RecipeRecoveryRepository.readCurrent"
  )((input) => {
    if (runtimeStage !== PilotProviderBudgetStage) {
      return Effect.fail(
        new RecipeRecoveryD1Unavailable({ operation: "read_current" })
      );
    }
    return readCurrentAttempt(
      database,
      input.importId,
      input.acquisitionGeneration
    );
  });

  const readResumable: RecipeRecoveryRepositoryShape["readResumable"] =
    Effect.fn("RecipeRecoveryRepository.readResumable")(
      function* readResumableEffect(input) {
        const current = yield* readCurrent(input);
        if (Option.isNone(current)) {
          return yield* Effect.fail(
            new RecipeRecoveryMissingPredecessor({
              acquisitionGeneration: input.acquisitionGeneration,
              importId: input.importId,
            })
          );
        }
        if (current.value.rootDispatchId !== input.rootDispatchId) {
          return yield* Effect.fail(
            new RecipeRecoveryDispatchConflict({
              acquisitionGeneration: input.acquisitionGeneration,
              dispatchId: input.rootDispatchId,
              importId: input.importId,
            })
          );
        }
        return current.value;
      }
    );

  const prepareNextAttempt: RecipeRecoveryRepositoryShape["prepareNextAttempt"] =
    Effect.fn("RecipeRecoveryRepository.prepareNextAttempt")(
      function* prepareNextAttemptEffect(rawInput) {
        const input = yield* decodeD1(
          PrepareNextRecipeRecoveryAttempt,
          "decode",
          rawInput
        );
        if (runtimeStage !== PilotProviderBudgetStage) {
          return yield* Effect.fail(
            new RecipeRecoveryD1Unavailable({ operation: "insert" })
          );
        }
        const current = yield* readCurrent(input);
        if (
          Option.isSome(current) &&
          current.value.predecessorDispatchId === input.predecessorDispatchId
        ) {
          return current.value;
        }
        if (
          Option.isSome(current) &&
          current.value.currentDispatchId !== input.predecessorDispatchId
        ) {
          return yield* Effect.fail(
            new RecipeRecoveryDispatchConflict({
              ...baseFailure(input),
              dispatchId: input.predecessorDispatchId,
            })
          );
        }

        const evidenceOption = yield* readImportEvidence(
          database,
          input.importId
        );
        if (Option.isNone(evidenceOption)) {
          return yield* Effect.fail(
            new RecipeRecoveryMissingPredecessor(baseFailure(input))
          );
        }
        const evidence = yield* requireLiveEvidence(
          input,
          evidenceOption.value,
          current
        );
        const ordinal = yield* nextOrdinal(current, input);

        let rootDispatchId: PilotBudgetDispatchId;
        let rootExtractionFingerprint: Sha256Hex;
        let predecessorExtractionFingerprint: Sha256Hex;
        let evidenceFingerprint: Sha256Hex;
        if (Option.isSome(current)) {
          const {
            currentExtractionFingerprint: existingExtractionFingerprint,
            evidenceFingerprint: existingEvidenceFingerprint,
            rootDispatchId: existingRootDispatchId,
            rootExtractionFingerprint: existingRootExtractionFingerprint,
          } = current.value;
          rootDispatchId = existingRootDispatchId;
          rootExtractionFingerprint = existingRootExtractionFingerprint;
          predecessorExtractionFingerprint = existingExtractionFingerprint;
          evidenceFingerprint = existingEvidenceFingerprint;
        } else {
          const root = yield* readRootExtraction(database, input);
          if (Option.isNone(root)) {
            return yield* Effect.fail(
              new RecipeRecoveryDispatchConflict({
                ...baseFailure(input),
                dispatchId: input.predecessorDispatchId,
              })
            );
          }
          rootDispatchId = input.predecessorDispatchId;
          rootExtractionFingerprint = root.value.extraction_fingerprint;
          predecessorExtractionFingerprint = root.value.extraction_fingerprint;
          evidenceFingerprint = root.value.evidence_fingerprint;
        }

        const currentDispatchId = yield* decodeD1(
          PilotBudgetDispatchId,
          "decode",
          `${rootDispatchId}:recovery:${ordinal}`
        );
        const currentExtractionFingerprint =
          yield* recipeRecoveryExtractionFingerprint(
            predecessorExtractionFingerprint,
            ordinal
          );
        const identity = {
          currentDispatchId,
          currentExtractionFingerprint,
          predecessorDispatchId: input.predecessorDispatchId,
          predecessorExtractionFingerprint,
          rootDispatchId,
          rootExtractionFingerprint,
        } satisfies RecoveryAuthorityIdentity;
        const authority = yield* readAuthority(database, input, identity);
        const admitted = yield* requireAuthority(
          input,
          identity,
          authority,
          Option.isNone(current),
          evidence.evidenceReferencesJson
        );

        const insert = () =>
          database
            .prepare(
              `INSERT INTO pilot_provider_recipe_recovery_attempts (
               runtime_stage, import_id, acquisition_generation,
               recovery_ordinal, root_dispatch_id, predecessor_dispatch_id,
               current_dispatch_id, root_extraction_fingerprint,
               predecessor_extraction_fingerprint,
               current_extraction_fingerprint, predecessor_outcome,
               terminal_checkpoint_completed_at,
               predecessor_reconciliation_created_at, evidence_fingerprint,
               source_media_sha256, transcript_sha256, visual_manifest_sha256,
               evidence_references_json, created_at
             ) VALUES (
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'outcome_unknown', ?, ?, ?,
               ?, ?, ?, ?, ?
             )
             ON CONFLICT(
               runtime_stage, import_id, acquisition_generation,
               recovery_ordinal
             ) DO NOTHING`
            )
            .bind(
              PilotProviderBudgetStage,
              input.importId,
              input.acquisitionGeneration,
              ordinal,
              rootDispatchId,
              input.predecessorDispatchId,
              currentDispatchId,
              rootExtractionFingerprint,
              predecessorExtractionFingerprint,
              currentExtractionFingerprint,
              DateTime.formatIso(admitted.terminalCheckpointCompletedAt),
              DateTime.formatIso(admitted.predecessorReconciliationCreatedAt),
              evidenceFingerprint,
              evidence.sourceMediaSha256,
              evidence.transcriptSha256,
              evidence.visualManifestSha256,
              evidence.evidenceReferencesJson,
              DateTime.formatIso(input.createdAt)
            )
            .run();

        yield* runD1("insert", insert);
        const settled = yield* readCurrent(input);
        if (
          Option.isSome(settled) &&
          settled.value.ordinal === ordinal &&
          settled.value.predecessorDispatchId === input.predecessorDispatchId &&
          settled.value.currentDispatchId === currentDispatchId &&
          settled.value.currentExtractionFingerprint ===
            currentExtractionFingerprint
        ) {
          return settled.value;
        }
        return yield* Effect.fail(
          new RecipeRecoveryDispatchConflict({
            ...baseFailure(input),
            dispatchId: currentDispatchId,
          })
        );
      }
    );

  return { prepareNextAttempt, readAttempt, readCurrent, readResumable };
};

export const RecipeRecoveryWorkflowInput = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  attemptOrdinal: RecipeRecoveryOrdinal,
  importId: ImportId,
  trace: ImportTraceContext,
});
export type RecipeRecoveryWorkflowInput =
  typeof RecipeRecoveryWorkflowInput.Type;

const LegacyRecipeRecoveryWorkflowInput = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  attemptOrdinal: RecipeRecoveryOrdinal,
  correlationId: ImportCorrelationId,
  importId: ImportId,
});

export class InvalidRecipeRecoveryWorkflowInput extends Data.TaggedError(
  "InvalidRecipeRecoveryWorkflowInput"
) {}

export const resolveRecipeRecoveryWorkflowInput = (rawInput: unknown) =>
  Schema.decodeUnknownEffect(
    Schema.Union([
      RecipeRecoveryWorkflowInput,
      LegacyRecipeRecoveryWorkflowInput,
    ]),
    { onExcessProperty: "error" }
  )(rawInput).pipe(
    Effect.mapError(() => new InvalidRecipeRecoveryWorkflowInput()),
    Effect.map((input) =>
      "trace" in input
        ? input
        : {
            acquisitionGeneration: input.acquisitionGeneration,
            attemptOrdinal: input.attemptOrdinal,
            importId: input.importId,
            trace: { correlationId: input.correlationId },
          }
    )
  );

export const RecipeRecoveryAuthorization = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  attemptOrdinal: RecipeRecoveryOrdinal,
  importId: ImportId,
});
export type RecipeRecoveryAuthorization =
  typeof RecipeRecoveryAuthorization.Type;

interface WorkflowInstanceLike {
  readonly restart: () => Effect.Effect<void>;
  readonly sendEvent: (event: {
    readonly payload: RecipeRecoveryAuthorization;
    readonly type: string;
  }) => Effect.Effect<void>;
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

const signalableWorkflowStatuses = new Set([
  "queued",
  "running",
  "waiting",
  "waitingForPause",
]);

export const recipeRecoveryAuthorizationEventType = (
  ordinal: RecipeRecoveryOrdinal
) => `recipe-recovery-authorized-${ordinal}`;

const signalRecoveryAuthorization = (
  instance: WorkflowInstanceLike,
  attempt: RecipeRecoveryAttempt
) =>
  attempt.ordinal === 1
    ? Effect.void
    : instance.sendEvent({
        payload: {
          acquisitionGeneration: attempt.acquisitionGeneration,
          attemptOrdinal: attempt.ordinal,
          importId: attempt.importId,
        },
        type: recipeRecoveryAuthorizationEventType(attempt.ordinal),
      });

const reconcileWorkflowInstance = (
  instance: WorkflowInstanceLike,
  attempt: RecipeRecoveryAttempt
) =>
  instance.status().pipe(
    Effect.flatMap(({ status }) => {
      if (status === "complete") {
        return Effect.void;
      }
      if (status === "errored") {
        return instance
          .restart()
          .pipe(Effect.andThen(signalRecoveryAuthorization(instance, attempt)));
      }
      if (!signalableWorkflowStatuses.has(status)) {
        return Effect.fail(workflowStartUnavailable());
      }
      return signalRecoveryAuthorization(instance, attempt);
    })
  );

export interface RecipeRecoveryWorkflowStarterShape {
  readonly start: (
    attempt: RecipeRecoveryAttempt
  ) => Effect.Effect<void, WorkflowStartUnavailable>;
}

export const recipeRecoveryWorkflowInstanceId = (
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) => `import-recipe-recovery-${importId}-${acquisitionGeneration}`;

export const makeRecipeRecoveryWorkflowStarter = (
  workflow: WorkflowHandleLike,
  trace: ImportTraceContext
): RecipeRecoveryWorkflowStarterShape => ({
  start: Effect.fn("RecipeRecoveryWorkflowStarter.start")(
    function* startRecipeRecoveryWorkflow(attempt) {
      const id = recipeRecoveryWorkflowInstanceId(
        attempt.importId,
        attempt.acquisitionGeneration
      );
      const params = yield* Schema.decodeUnknownEffect(
        RecipeRecoveryWorkflowInput,
        { onExcessProperty: "error" }
      )({
        acquisitionGeneration: attempt.acquisitionGeneration,
        attemptOrdinal: attempt.ordinal,
        importId: attempt.importId,
        trace,
      }).pipe(Effect.mapError(() => workflowStartUnavailable()));
      return yield* workflow.createBatch([{ id, params }]).pipe(
        Effect.flatMap((created) => {
          if (created.length === 1) {
            return Effect.void;
          }
          if (created.length === 0) {
            return workflow
              .get(id)
              .pipe(
                Effect.flatMap((instance) =>
                  reconcileWorkflowInstance(instance, attempt)
                )
              );
          }
          return Effect.fail(workflowStartUnavailable());
        }),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          () =>
            workflow
              .get(id)
              .pipe(
                Effect.flatMap((instance) =>
                  reconcileWorkflowInstance(instance, attempt)
                )
              )
        ),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          () => Effect.fail(workflowStartUnavailable())
        )
      );
    }
  ),
});
