import type { AnyD1Database } from "drizzle-orm/d1";
import { Context, DateTime, Effect, Schema } from "effect";

import {
  PilotBudgetDispatchId,
  PilotProviderBudgetStage,
} from "../pilots/pilot-provider-budget.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { makeD1ProviderTerminalRecoveryRepository } from "./import-provider-terminal.js";
import { makeD1RecipeRecoveryRepository } from "./import-recipe-recovery.js";
import type { RecipeRecoveryWorkflowStarterShape } from "./import-recipe-recovery.js";
import { ImportId } from "./import.contracts.js";
import type { ImportTimestamp } from "./import.contracts.js";
import type { ImportWorkflowStarterShape } from "./import.workflow.js";

const TerminalUnknownSettlementRequest = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
});
type TerminalUnknownSettlementRequest =
  typeof TerminalUnknownSettlementRequest.Type;

const VisualRecoveryPreparationRequest = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  operation: Schema.Literal("prepare_visual_recovery"),
});

const SpeechRecoveryActivationRequest = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  operation: Schema.Literal("prepare_speech_recovery"),
});

const RecipeTerminalUnknownSettlementRequest = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  operation: Schema.Literal("settle_recipe_unknown"),
});
type RecipeTerminalUnknownSettlementRequest =
  typeof RecipeTerminalUnknownSettlementRequest.Type;

const RecipeRecoveryUnknownSettlementRequest = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  operation: Schema.Literal("settle_recipe_recovery_unknown"),
});
type RecipeRecoveryUnknownSettlementRequest =
  typeof RecipeRecoveryUnknownSettlementRequest.Type;

const RecipeRecoveryPreparationRequest = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  operation: Schema.Literal("prepare_recipe_recovery"),
});

const RecipeSecondRecoveryPreparationRequest = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  operation: Schema.Literal("prepare_recipe_second_recovery"),
});

const RecipeRecoveryResumeRequest = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  operation: Schema.Literal("resume_recipe_recovery"),
});

const ExpiredRecipeReplaySweepRequest = Schema.Struct({
  operation: Schema.Literal("sweep_expired_recipe_replays"),
});

export const ProviderTerminalSettlementRequest = Schema.Union([
  TerminalUnknownSettlementRequest,
  SpeechRecoveryActivationRequest,
  VisualRecoveryPreparationRequest,
  RecipeTerminalUnknownSettlementRequest,
  RecipeRecoveryUnknownSettlementRequest,
  RecipeRecoveryPreparationRequest,
  RecipeSecondRecoveryPreparationRequest,
  RecipeRecoveryResumeRequest,
  ExpiredRecipeReplaySweepRequest,
]);
export type ProviderTerminalSettlementRequest =
  typeof ProviderTerminalSettlementRequest.Type;

const isOperation = <
  Operation extends Extract<
    ProviderTerminalSettlementRequest,
    { readonly operation: string }
  >["operation"],
>(
  request: ProviderTerminalSettlementRequest,
  operation: Operation
): request is Extract<
  ProviderTerminalSettlementRequest,
  { readonly operation: Operation }
> => "operation" in request && request.operation === operation;

const ConservativeChargeMicroUsd = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(10_000_000)
  )
);

const TerminalUnknownSettlementResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  conservativeChargeMicroUsd: ConservativeChargeMicroUsd,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("terminal_unknown_cost_settled"),
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});

const VisualRecoveryPreparationResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("visual_recovery_prepared"),
  recoveryDispatchId: PilotBudgetDispatchId,
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});

const SpeechRecoveryActivationResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("speech_recovery_activated"),
  recoveryDispatchId: PilotBudgetDispatchId,
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});

const RecipeTerminalUnknownSettlementResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  conservativeChargeMicroUsd: Schema.Literal(100_000),
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("recipe_terminal_unknown_cost_settled"),
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});

const RecipeRecoveryUnknownSettlementResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  conservativeChargeMicroUsd: Schema.Literal(100_000),
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("recipe_recovery_unknown_cost_settled"),
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});

const RecipeRecoveryPreparationResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("recipe_recovery_prepared"),
  recoveryDispatchId: PilotBudgetDispatchId,
  recoveryExtractionFingerprint: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
  ),
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});

const RecipeSecondRecoveryPreparationResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("recipe_second_recovery_prepared"),
  recoveryDispatchId: PilotBudgetDispatchId,
  recoveryExtractionFingerprint: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
  ),
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});

const RecipeRecoveryResumeResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("recipe_recovery_resumed"),
  recoveryDispatchId: PilotBudgetDispatchId,
  recoveryExtractionFingerprint: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
  ),
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});

const ExpiredRecipeReplaySweepResponse = Schema.Struct({
  deletedCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  outcome: Schema.Literal("expired_recipe_replays_swept"),
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});

export const ProviderTerminalSettlementResponse = Schema.Union([
  TerminalUnknownSettlementResponse,
  SpeechRecoveryActivationResponse,
  VisualRecoveryPreparationResponse,
  RecipeTerminalUnknownSettlementResponse,
  RecipeRecoveryUnknownSettlementResponse,
  RecipeRecoveryPreparationResponse,
  RecipeSecondRecoveryPreparationResponse,
  RecipeRecoveryResumeResponse,
  ExpiredRecipeReplaySweepResponse,
]);
export type ProviderTerminalSettlementResponse =
  typeof ProviderTerminalSettlementResponse.Type;

export type ProviderTerminalSettlementErrorCode =
  | "not_allowed"
  | "persistence_corrupt"
  | "persistence_unavailable"
  | "stage_not_allowed";

export interface ProviderTerminalSettlementError {
  readonly _tag: "ProviderTerminalSettlementError";
  readonly code: ProviderTerminalSettlementErrorCode;
}

const providerTerminalSettlementError = (
  code: ProviderTerminalSettlementErrorCode
): ProviderTerminalSettlementError => ({
  _tag: "ProviderTerminalSettlementError",
  code,
});

const mapRecoveryErrorCode = (
  code: string
): ProviderTerminalSettlementErrorCode => {
  switch (code) {
    case "stage_not_allowed": {
      return "stage_not_allowed";
    }
    case "persistence_unavailable": {
      return "persistence_unavailable";
    }
    case "persistence_corrupt": {
      return "persistence_corrupt";
    }
    default: {
      return "not_allowed";
    }
  }
};

const mapRecoveryPersistenceError = (error: { readonly code: string }) =>
  providerTerminalSettlementError(mapRecoveryErrorCode(error.code));

const SettledRow = Schema.Struct({
  acquisition_generation: AcquisitionGeneration,
  authority: Schema.Literal("authenticated_operator"),
  conservative_charge_micro_usd: ConservativeChargeMicroUsd,
  dispatch_id: PilotBudgetDispatchId,
  import_id: ImportId,
  runtime_stage: Schema.Literal(PilotProviderBudgetStage),
});

const RecipeSettledRow = Schema.Struct({
  acquisition_generation: AcquisitionGeneration,
  authority: Schema.Literal("authenticated_operator"),
  conservative_charge_micro_usd: Schema.Literal(100_000),
  dispatch_id: PilotBudgetDispatchId,
  import_id: ImportId,
  runtime_stage: Schema.Literal(PilotProviderBudgetStage),
});

const D1MutationResult = Schema.Struct({
  meta: Schema.Struct({
    changes: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
});

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: () => providerTerminalSettlementError("persistence_unavailable"),
    try: () => Promise.resolve(operation()),
  });

const readSettled = (
  database: AnyD1Database,
  input: TerminalUnknownSettlementRequest
) =>
  persistenceEffect<unknown | null>(
    () =>
      database
        .prepare(
          `SELECT
             audit.runtime_stage,
             audit.dispatch_id,
             audit.conservative_charge_micro_usd,
             audit.authority,
             checkpoint.import_id,
             checkpoint.acquisition_generation
           FROM pilot_provider_budget_reconciliations AS audit
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = audit.runtime_stage
            AND dispatch.dispatch_id = audit.dispatch_id
           JOIN import_provider_terminal_checkpoints AS checkpoint
             ON checkpoint.import_id = ?
            AND checkpoint.acquisition_generation = ?
            AND checkpoint.provider_stage = 'speech'
            AND checkpoint.ownership_id = audit.dispatch_id
            AND checkpoint.failure_code = 'outcome_unknown'
           JOIN import_transcriptions AS transcription
             ON transcription.import_id = checkpoint.import_id
            AND transcription.acquisition_generation =
                  checkpoint.acquisition_generation
            AND transcription.dispatch_id = checkpoint.ownership_id
            AND transcription.state = 'failed'
            AND transcription.failure_code = 'outcome_unknown'
            AND transcription.completed_at = checkpoint.completed_at
           JOIN recipe_imports AS parent
             ON parent.id = checkpoint.import_id
            AND parent.acquisition_generation =
                  checkpoint.acquisition_generation
            AND parent.status = 'failed'
            AND parent.status_code = 'transcription_failed'
            AND parent.recovery_action = 'retry_later'
           JOIN pilot_provider_stage_budget AS stage
             ON stage.runtime_stage = audit.runtime_stage
           WHERE audit.runtime_stage = ?
             AND audit.dispatch_id = ?
             AND audit.actual_cost_was_unknown = 1
             AND audit.authority = 'authenticated_operator'
             AND dispatch.state = 'settled_unknown'
             AND dispatch.provider_stage_id = 'speech-transcription'
             AND dispatch.actual_cost_micro_usd IS NULL
             AND dispatch.maximum_cost_micro_usd =
                   audit.conservative_charge_micro_usd
             AND (
               stage.poison_dispatch_id IS NULL
               OR stage.poison_dispatch_id <> audit.dispatch_id
             )
             AND (
               stage.invoking_dispatch_id IS NULL
               OR stage.invoking_dispatch_id <> audit.dispatch_id
             )
             AND NOT EXISTS (
               SELECT 1
                 FROM pilot_provider_speech_recoveries AS recovery
                WHERE recovery.runtime_stage = audit.runtime_stage
                  AND recovery.original_dispatch_id = audit.dispatch_id
             )`
        )
        .bind(
          input.importId,
          input.acquisitionGeneration,
          PilotProviderBudgetStage,
          input.dispatchId
        )
        .first() as PromiseLike<unknown | null>
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(providerTerminalSettlementError("not_allowed"))
        : Schema.decodeUnknownEffect(SettledRow, {
            onExcessProperty: "ignore",
          })(row).pipe(
            Effect.mapError(() =>
              providerTerminalSettlementError("persistence_corrupt")
            )
          )
    ),
    Effect.map(
      (row): ProviderTerminalSettlementResponse => ({
        acquisitionGeneration: row.acquisition_generation,
        conservativeChargeMicroUsd: row.conservative_charge_micro_usd,
        dispatchId: row.dispatch_id,
        importId: row.import_id,
        outcome: "terminal_unknown_cost_settled",
        runtimeStage: row.runtime_stage,
      })
    )
  );

const settleBatch = (
  database: AnyD1Database,
  input: TerminalUnknownSettlementRequest,
  settledAt: ImportTimestamp
) => {
  const timestamp = DateTime.formatIso(settledAt);
  return persistenceEffect(() =>
    database.batch([
      database
        .prepare(
          `INSERT INTO pilot_provider_budget_reconciliations (
             runtime_stage,
             dispatch_id,
             conservative_charge_micro_usd,
             actual_cost_was_unknown,
             authority,
             created_at
           )
           SELECT
             stage.runtime_stage,
             dispatch.dispatch_id,
             dispatch.maximum_cost_micro_usd,
             1,
             'authenticated_operator',
             ?
           FROM pilot_provider_stage_budget AS stage
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = stage.runtime_stage
            AND dispatch.dispatch_id = stage.poison_dispatch_id
           JOIN import_provider_terminal_checkpoints AS checkpoint
             ON checkpoint.import_id = ?
            AND checkpoint.acquisition_generation = ?
            AND checkpoint.provider_stage = 'speech'
            AND checkpoint.ownership_id = dispatch.dispatch_id
            AND checkpoint.failure_code = 'outcome_unknown'
           JOIN import_transcriptions AS transcription
             ON transcription.import_id = checkpoint.import_id
            AND transcription.acquisition_generation =
                  checkpoint.acquisition_generation
            AND transcription.dispatch_id = checkpoint.ownership_id
            AND transcription.state = 'failed'
            AND transcription.failure_code = 'outcome_unknown'
            AND transcription.completed_at = checkpoint.completed_at
           JOIN recipe_imports AS parent
             ON parent.id = checkpoint.import_id
            AND parent.acquisition_generation =
                  checkpoint.acquisition_generation
            AND parent.status = 'failed'
            AND parent.status_code = 'transcription_failed'
            AND parent.recovery_action = 'retry_later'
           WHERE stage.runtime_stage = ?
             AND stage.state = 'poisoned'
             AND stage.poison_dispatch_id = ?
             AND stage.invoking_dispatch_id IS NULL
             AND dispatch.state = 'settled_unknown'
             AND dispatch.provider_stage_id = 'speech-transcription'
             AND dispatch.actual_cost_micro_usd IS NULL
             AND dispatch.maximum_cost_micro_usd <= stage.reserved_micro_usd
             AND stage.settled_micro_usd + stage.reserved_micro_usd
                   <= stage.budget_cap_micro_usd
             AND stage.settled_micro_usd +
                   dispatch.maximum_cost_micro_usd
                   <= stage.budget_cap_micro_usd
             AND NOT EXISTS (
               SELECT 1
                 FROM pilot_provider_speech_recoveries AS recovery
                WHERE recovery.runtime_stage = stage.runtime_stage
                  AND recovery.original_dispatch_id = dispatch.dispatch_id
             )
           ON CONFLICT(runtime_stage, dispatch_id) DO NOTHING`
        )
        .bind(
          timestamp,
          input.importId,
          input.acquisitionGeneration,
          PilotProviderBudgetStage,
          input.dispatchId
        ),
      database
        .prepare(
          `UPDATE pilot_provider_stage_budget
              SET settled_micro_usd = settled_micro_usd + (
                    SELECT dispatch.maximum_cost_micro_usd
                      FROM pilot_provider_budget_dispatches AS dispatch
                     WHERE dispatch.runtime_stage = ?
                       AND dispatch.dispatch_id = ?
                  ),
                  reserved_micro_usd = reserved_micro_usd - (
                    SELECT dispatch.maximum_cost_micro_usd
                      FROM pilot_provider_budget_dispatches AS dispatch
                     WHERE dispatch.runtime_stage = ?
                       AND dispatch.dispatch_id = ?
                  ),
                  state = 'open',
                  invoking_dispatch_id = NULL,
                  poison_dispatch_id = NULL,
                  updated_at = ?
            WHERE runtime_stage = ?
              AND state = 'poisoned'
              AND poison_dispatch_id = ?
              AND invoking_dispatch_id IS NULL
              AND EXISTS (
                SELECT 1
                  FROM pilot_provider_budget_dispatches AS dispatch
                  JOIN pilot_provider_budget_reconciliations AS audit
                    ON audit.runtime_stage = dispatch.runtime_stage
                   AND audit.dispatch_id = dispatch.dispatch_id
                  JOIN import_provider_terminal_checkpoints AS checkpoint
                    ON checkpoint.import_id = ?
                   AND checkpoint.acquisition_generation = ?
                   AND checkpoint.provider_stage = 'speech'
                   AND checkpoint.ownership_id = dispatch.dispatch_id
                   AND checkpoint.failure_code = 'outcome_unknown'
                  JOIN import_transcriptions AS transcription
                    ON transcription.import_id = checkpoint.import_id
                   AND transcription.acquisition_generation =
                         checkpoint.acquisition_generation
                   AND transcription.dispatch_id = checkpoint.ownership_id
                   AND transcription.state = 'failed'
                   AND transcription.failure_code = 'outcome_unknown'
                   AND transcription.completed_at = checkpoint.completed_at
                  JOIN recipe_imports AS parent
                    ON parent.id = checkpoint.import_id
                   AND parent.acquisition_generation =
                         checkpoint.acquisition_generation
                   AND parent.status = 'failed'
                   AND parent.status_code = 'transcription_failed'
                   AND parent.recovery_action = 'retry_later'
                 WHERE dispatch.runtime_stage = ?
                   AND dispatch.dispatch_id = ?
                   AND dispatch.state = 'settled_unknown'
                   AND dispatch.provider_stage_id =
                         'speech-transcription'
                   AND dispatch.actual_cost_micro_usd IS NULL
                   AND dispatch.maximum_cost_micro_usd =
                         audit.conservative_charge_micro_usd
                   AND audit.actual_cost_was_unknown = 1
                   AND audit.authority = 'authenticated_operator'
                   AND dispatch.maximum_cost_micro_usd <=
                         pilot_provider_stage_budget.reserved_micro_usd
                   AND pilot_provider_stage_budget.settled_micro_usd +
                         dispatch.maximum_cost_micro_usd <=
                         pilot_provider_stage_budget.budget_cap_micro_usd
                   AND NOT EXISTS (
                     SELECT 1
                       FROM pilot_provider_speech_recoveries AS recovery
                      WHERE recovery.runtime_stage =
                            dispatch.runtime_stage
                        AND recovery.original_dispatch_id =
                            dispatch.dispatch_id
                   )
              )`
        )
        .bind(
          PilotProviderBudgetStage,
          input.dispatchId,
          PilotProviderBudgetStage,
          input.dispatchId,
          timestamp,
          PilotProviderBudgetStage,
          input.dispatchId,
          input.importId,
          input.acquisitionGeneration,
          PilotProviderBudgetStage,
          input.dispatchId
        ),
    ])
  );
};

const readRecipeSettled = (
  database: AnyD1Database,
  input: RecipeTerminalUnknownSettlementRequest
) =>
  persistenceEffect<unknown | null>(
    () =>
      database
        .prepare(
          `SELECT
             audit.runtime_stage,
             audit.dispatch_id,
             audit.conservative_charge_micro_usd,
             audit.authority,
             checkpoint.import_id,
             checkpoint.acquisition_generation
           FROM pilot_provider_budget_reconciliations AS audit
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = audit.runtime_stage
            AND dispatch.dispatch_id = audit.dispatch_id
           JOIN import_provider_terminal_checkpoints AS checkpoint
             ON checkpoint.import_id = ?
            AND checkpoint.acquisition_generation = ?
            AND checkpoint.provider_stage = 'recipe'
            AND checkpoint.failure_code = 'outcome_unknown'
           JOIN import_recipe_extractions AS extraction
             ON extraction.import_id = checkpoint.import_id
            AND extraction.acquisition_generation =
                  checkpoint.acquisition_generation
            AND extraction.extraction_fingerprint = checkpoint.ownership_id
            AND extraction.state = 'failed'
            AND extraction.failure_code = 'provider_error'
            AND extraction.completed_at = checkpoint.completed_at
           JOIN import_recipe_terminal_projections AS projection
             ON projection.import_id = checkpoint.import_id
            AND projection.acquisition_generation =
                  checkpoint.acquisition_generation
            AND projection.ownership_id = checkpoint.ownership_id
            AND projection.projected_at = checkpoint.completed_at
           JOIN recipe_imports AS parent
             ON parent.id = checkpoint.import_id
            AND parent.acquisition_generation =
                  checkpoint.acquisition_generation
            AND projection.evidence_references_json =
                  parent.evidence_references_json
           JOIN pilot_provider_stage_budget AS stage
             ON stage.runtime_stage = audit.runtime_stage
           WHERE audit.runtime_stage = ?
             AND audit.dispatch_id = ?
             AND audit.actual_cost_was_unknown = 1
             AND audit.authority = 'authenticated_operator'
             AND audit.conservative_charge_micro_usd = 100000
             AND dispatch.state = 'settled_unknown'
             AND dispatch.provider_stage_id = 'recipe-extraction'
             AND dispatch.run_id = 'gaia-118:' || checkpoint.import_id
             AND dispatch.dispatch_id =
                   'recipe:' || checkpoint.import_id || ':' ||
                   checkpoint.acquisition_generation || ':' ||
                   extraction.evidence_fingerprint
             AND dispatch.actual_cost_micro_usd IS NULL
             AND dispatch.maximum_cost_micro_usd = 100000
             AND projection.status = 'failed'
             AND projection.status_code = 'recipe_extraction_failed'
             AND projection.recovery_action = 'operator_reconcile'
             AND (
               (
                 parent.status = 'queued'
                 AND json_array_length(parent.evidence_references_json) = 0
               ) OR (
                 parent.status = 'transcribed'
                 AND json_array_length(parent.evidence_references_json) = 3
               )
             )
             AND stage.state = 'open'
             AND stage.reserved_micro_usd = 0
             AND stage.invoking_dispatch_id IS NULL
             AND stage.poison_dispatch_id IS NULL
             AND stage.settled_micro_usd <= stage.budget_cap_micro_usd
             AND (
               SELECT COUNT(*)
                FROM pilot_provider_budget_dispatches AS sibling
                WHERE sibling.runtime_stage = dispatch.runtime_stage
                  AND sibling.run_id = dispatch.run_id
                  AND sibling.provider_stage_id = 'recipe-extraction'
             ) = 1`
        )
        .bind(
          input.importId,
          input.acquisitionGeneration,
          PilotProviderBudgetStage,
          input.dispatchId
        )
        .first() as PromiseLike<unknown | null>
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(providerTerminalSettlementError("not_allowed"))
        : Schema.decodeUnknownEffect(RecipeSettledRow, {
            onExcessProperty: "ignore",
          })(row).pipe(
            Effect.mapError(() =>
              providerTerminalSettlementError("persistence_corrupt")
            )
          )
    ),
    Effect.map(
      (row): ProviderTerminalSettlementResponse => ({
        acquisitionGeneration: row.acquisition_generation,
        conservativeChargeMicroUsd: 100_000,
        dispatchId: row.dispatch_id,
        importId: row.import_id,
        outcome: "recipe_terminal_unknown_cost_settled",
        runtimeStage: row.runtime_stage,
      })
    )
  );

const settleRecipeBatch = (
  database: AnyD1Database,
  input: RecipeTerminalUnknownSettlementRequest,
  settledAt: ImportTimestamp
) => {
  const timestamp = DateTime.formatIso(settledAt);
  return persistenceEffect(() =>
    database.batch([
      database
        .prepare(
          `INSERT INTO pilot_provider_budget_reconciliations (
             runtime_stage,
             dispatch_id,
             conservative_charge_micro_usd,
             actual_cost_was_unknown,
             authority,
             created_at
           )
           SELECT
             stage.runtime_stage,
             dispatch.dispatch_id,
             100000,
             1,
             'authenticated_operator',
             ?
           FROM pilot_provider_stage_budget AS stage
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = stage.runtime_stage
            AND dispatch.dispatch_id = stage.poison_dispatch_id
           JOIN import_provider_terminal_checkpoints AS checkpoint
             ON checkpoint.import_id = ?
            AND checkpoint.acquisition_generation = ?
            AND checkpoint.provider_stage = 'recipe'
            AND checkpoint.failure_code = 'outcome_unknown'
           JOIN import_recipe_extractions AS extraction
             ON extraction.import_id = checkpoint.import_id
            AND extraction.acquisition_generation =
                  checkpoint.acquisition_generation
            AND extraction.extraction_fingerprint = checkpoint.ownership_id
            AND extraction.state = 'failed'
            AND extraction.failure_code = 'provider_error'
            AND extraction.completed_at = checkpoint.completed_at
           JOIN import_recipe_terminal_projections AS projection
             ON projection.import_id = checkpoint.import_id
            AND projection.acquisition_generation =
                  checkpoint.acquisition_generation
            AND projection.ownership_id = checkpoint.ownership_id
            AND projection.projected_at = checkpoint.completed_at
           JOIN recipe_imports AS parent
             ON parent.id = checkpoint.import_id
            AND parent.acquisition_generation =
                  checkpoint.acquisition_generation
            AND projection.evidence_references_json =
                  parent.evidence_references_json
           WHERE stage.runtime_stage = ?
             AND stage.state = 'poisoned'
             AND stage.poison_dispatch_id = ?
             AND stage.invoking_dispatch_id IS NULL
             AND stage.reserved_micro_usd = 100000
             AND stage.settled_micro_usd + stage.reserved_micro_usd
                   <= stage.budget_cap_micro_usd
             AND dispatch.state = 'settled_unknown'
             AND dispatch.provider_stage_id = 'recipe-extraction'
             AND dispatch.run_id = 'gaia-118:' || checkpoint.import_id
             AND dispatch.dispatch_id =
                   'recipe:' || checkpoint.import_id || ':' ||
                   checkpoint.acquisition_generation || ':' ||
                   extraction.evidence_fingerprint
             AND dispatch.actual_cost_micro_usd IS NULL
             AND dispatch.maximum_cost_micro_usd = 100000
             AND projection.status = 'failed'
             AND projection.status_code = 'recipe_extraction_failed'
             AND projection.recovery_action = 'operator_reconcile'
             AND (
               (
                 parent.status = 'queued'
                 AND json_array_length(parent.evidence_references_json) = 0
               ) OR (
                 parent.status = 'transcribed'
                 AND json_array_length(parent.evidence_references_json) = 3
               )
             )
             AND (
               SELECT COUNT(*)
                FROM pilot_provider_budget_dispatches AS sibling
                WHERE sibling.runtime_stage = dispatch.runtime_stage
                  AND sibling.run_id = dispatch.run_id
                  AND sibling.provider_stage_id = 'recipe-extraction'
             ) = 1
           ON CONFLICT(runtime_stage, dispatch_id) DO NOTHING`
        )
        .bind(
          timestamp,
          input.importId,
          input.acquisitionGeneration,
          PilotProviderBudgetStage,
          input.dispatchId
        ),
      database
        .prepare(
          `UPDATE pilot_provider_stage_budget
              SET settled_micro_usd = settled_micro_usd + 100000,
                  reserved_micro_usd = reserved_micro_usd - 100000,
                  state = 'open',
                  invoking_dispatch_id = NULL,
                  poison_dispatch_id = NULL,
                  updated_at = ?
            WHERE runtime_stage = ?
              AND state = 'poisoned'
              AND poison_dispatch_id = ?
              AND invoking_dispatch_id IS NULL
              AND reserved_micro_usd = 100000
              AND settled_micro_usd + reserved_micro_usd
                    <= budget_cap_micro_usd
              AND EXISTS (
                SELECT 1
                  FROM pilot_provider_budget_dispatches AS dispatch
                  JOIN pilot_provider_budget_reconciliations AS audit
                    ON audit.runtime_stage = dispatch.runtime_stage
                   AND audit.dispatch_id = dispatch.dispatch_id
                  JOIN import_provider_terminal_checkpoints AS checkpoint
                    ON checkpoint.import_id = ?
                   AND checkpoint.acquisition_generation = ?
                   AND checkpoint.provider_stage = 'recipe'
                   AND checkpoint.failure_code = 'outcome_unknown'
                  JOIN import_recipe_extractions AS extraction
                    ON extraction.import_id = checkpoint.import_id
                   AND extraction.acquisition_generation =
                         checkpoint.acquisition_generation
                   AND extraction.extraction_fingerprint =
                         checkpoint.ownership_id
                   AND extraction.state = 'failed'
                   AND extraction.failure_code = 'provider_error'
                   AND extraction.completed_at = checkpoint.completed_at
                  JOIN import_recipe_terminal_projections AS projection
                    ON projection.import_id = checkpoint.import_id
                   AND projection.acquisition_generation =
                         checkpoint.acquisition_generation
                   AND projection.ownership_id = checkpoint.ownership_id
                   AND projection.projected_at = checkpoint.completed_at
                  JOIN recipe_imports AS parent
                    ON parent.id = checkpoint.import_id
                   AND parent.acquisition_generation =
                         checkpoint.acquisition_generation
                   AND projection.evidence_references_json =
                         parent.evidence_references_json
                 WHERE dispatch.runtime_stage = ?
                   AND dispatch.dispatch_id = ?
                   AND dispatch.state = 'settled_unknown'
                   AND dispatch.provider_stage_id = 'recipe-extraction'
                   AND dispatch.run_id = 'gaia-118:' || checkpoint.import_id
                   AND dispatch.dispatch_id =
                         'recipe:' || checkpoint.import_id || ':' ||
                         checkpoint.acquisition_generation || ':' ||
                         extraction.evidence_fingerprint
                   AND dispatch.actual_cost_micro_usd IS NULL
                   AND dispatch.maximum_cost_micro_usd = 100000
                   AND audit.actual_cost_was_unknown = 1
                   AND audit.authority = 'authenticated_operator'
                   AND audit.conservative_charge_micro_usd = 100000
                   AND projection.status = 'failed'
                   AND projection.status_code =
                         'recipe_extraction_failed'
                   AND projection.recovery_action = 'operator_reconcile'
                   AND (
                     (
                       parent.status = 'queued'
                       AND json_array_length(
                             parent.evidence_references_json
                           ) = 0
                     ) OR (
                       parent.status = 'transcribed'
                       AND json_array_length(
                             parent.evidence_references_json
                           ) = 3
                     )
                   )
                   AND (
                     SELECT COUNT(*)
                      FROM pilot_provider_budget_dispatches AS sibling
                      WHERE sibling.runtime_stage = dispatch.runtime_stage
                        AND sibling.run_id = dispatch.run_id
                        AND sibling.provider_stage_id = 'recipe-extraction'
                   ) = 1
              )`
        )
        .bind(
          timestamp,
          PilotProviderBudgetStage,
          input.dispatchId,
          input.importId,
          input.acquisitionGeneration,
          PilotProviderBudgetStage,
          input.dispatchId
        ),
    ])
  );
};

const recipeRecoveryUnknownAuthority = `
  FROM pilot_provider_recipe_recoveries AS recovery
  JOIN pilot_provider_budget_dispatches AS dispatch
    ON dispatch.runtime_stage = recovery.runtime_stage
   AND dispatch.dispatch_id = recovery.recovery_dispatch_id
  JOIN pilot_provider_stage_budget AS stage
    ON stage.runtime_stage = recovery.runtime_stage
  JOIN import_provider_terminal_checkpoints AS checkpoint
    ON checkpoint.import_id = recovery.import_id
   AND checkpoint.acquisition_generation =
         recovery.acquisition_generation
   AND checkpoint.provider_stage = 'recipe'
   AND checkpoint.ownership_id =
         recovery.original_extraction_fingerprint
   AND checkpoint.failure_code = 'outcome_unknown'
  JOIN import_recipe_extractions AS original_extraction
    ON original_extraction.import_id = checkpoint.import_id
   AND original_extraction.acquisition_generation =
         checkpoint.acquisition_generation
   AND original_extraction.extraction_fingerprint = checkpoint.ownership_id
   AND original_extraction.evidence_fingerprint =
         recovery.evidence_fingerprint
   AND original_extraction.state = 'failed'
   AND original_extraction.failure_code = 'provider_error'
   AND original_extraction.completed_at = checkpoint.completed_at
  JOIN import_recipe_extractions AS recovery_extraction
    ON recovery_extraction.import_id = checkpoint.import_id
   AND recovery_extraction.acquisition_generation =
         checkpoint.acquisition_generation
   AND recovery_extraction.extraction_fingerprint =
         recovery.recovery_extraction_fingerprint
   AND recovery_extraction.evidence_fingerprint =
         recovery.evidence_fingerprint
   AND recovery_extraction.state = 'failed'
   AND recovery_extraction.failure_code = 'provider_error'
   AND recovery_extraction.is_current = 0
  JOIN import_recipe_terminal_projections AS projection
    ON projection.import_id = checkpoint.import_id
   AND projection.acquisition_generation =
         checkpoint.acquisition_generation
   AND projection.ownership_id = checkpoint.ownership_id
   AND projection.projected_at = checkpoint.completed_at
   AND projection.status = 'failed'
   AND projection.status_code = 'recipe_extraction_failed'
   AND projection.recovery_action = 'operator_reconcile'
  JOIN recipe_imports AS parent
    ON parent.id = checkpoint.import_id
   AND parent.acquisition_generation =
         checkpoint.acquisition_generation
   AND parent.status = 'transcribed'
   AND parent.status_code IS NULL
   AND parent.recovery_action IS NULL
   AND parent.evidence_references_json =
         recovery.evidence_references_json
   AND projection.evidence_references_json =
         parent.evidence_references_json
  JOIN import_transcriptions AS transcript
    ON transcript.import_id = parent.id
   AND transcript.acquisition_generation =
         parent.acquisition_generation
   AND transcript.state = 'transcribed'
   AND transcript.transcript_sha256 = recovery.transcript_sha256
  JOIN import_visual_evidence AS visual
    ON visual.import_id = parent.id
   AND visual.acquisition_generation =
         parent.acquisition_generation
   AND visual.state = 'completed'
   AND visual.manifest_sha256 = recovery.visual_manifest_sha256
   AND visual.source_media_sha256 = transcript.source_media_sha256
  WHERE recovery.runtime_stage = ?
    AND recovery.import_id = ?
    AND recovery.acquisition_generation = ?
    AND recovery.recovery_ordinal = 1
    AND recovery.recovery_identity = 'recovery:1'
    AND recovery.recovery_dispatch_id = ?
    AND dispatch.run_id = 'gaia-118:recipe-recovery:' || recovery.import_id
    AND dispatch.provider_stage_id = 'recipe-extraction'
    AND dispatch.state = 'settled_unknown'
    AND dispatch.actual_cost_micro_usd IS NULL
    AND dispatch.maximum_cost_micro_usd = 100000
    AND stage.state = 'poisoned'
    AND stage.poison_dispatch_id = recovery.recovery_dispatch_id
    AND stage.invoking_dispatch_id IS NULL
    AND stage.reserved_micro_usd = 100000
    AND stage.settled_micro_usd + stage.reserved_micro_usd
          <= stage.budget_cap_micro_usd
    AND NOT EXISTS (
      SELECT 1
        FROM pilot_provider_recipe_replay_values AS replay
       WHERE replay.runtime_stage = recovery.runtime_stage
         AND replay.dispatch_id = recovery.recovery_dispatch_id
    )
`;

const readRecipeRecoverySettled = (
  database: AnyD1Database,
  input: RecipeRecoveryUnknownSettlementRequest
) =>
  persistenceEffect<unknown | null>(() =>
    database
      .prepare(
        `SELECT audit.runtime_stage, audit.dispatch_id,
                audit.conservative_charge_micro_usd, audit.authority,
                recovery.import_id,
                recovery.acquisition_generation
           FROM pilot_provider_budget_reconciliations AS audit
           JOIN pilot_provider_stage_budget AS stage
             ON stage.runtime_stage = audit.runtime_stage
           JOIN pilot_provider_recipe_recoveries AS recovery
             ON recovery.runtime_stage = audit.runtime_stage
            AND recovery.recovery_dispatch_id = audit.dispatch_id
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = audit.runtime_stage
            AND dispatch.dispatch_id = audit.dispatch_id
           JOIN import_provider_terminal_checkpoints AS checkpoint
             ON checkpoint.import_id = recovery.import_id
            AND checkpoint.acquisition_generation =
                  recovery.acquisition_generation
            AND checkpoint.provider_stage = 'recipe'
            AND checkpoint.ownership_id =
                  recovery.original_extraction_fingerprint
            AND checkpoint.failure_code = 'outcome_unknown'
           JOIN import_recipe_extractions AS original_extraction
             ON original_extraction.extraction_fingerprint =
                  checkpoint.ownership_id
            AND original_extraction.import_id = checkpoint.import_id
            AND original_extraction.acquisition_generation =
                  checkpoint.acquisition_generation
            AND original_extraction.evidence_fingerprint =
                  recovery.evidence_fingerprint
            AND original_extraction.state = 'failed'
            AND original_extraction.failure_code = 'provider_error'
            AND original_extraction.completed_at = checkpoint.completed_at
           JOIN import_recipe_extractions AS recovery_extraction
             ON recovery_extraction.import_id = checkpoint.import_id
            AND recovery_extraction.acquisition_generation =
                  checkpoint.acquisition_generation
            AND recovery_extraction.extraction_fingerprint =
                  recovery.recovery_extraction_fingerprint
            AND recovery_extraction.evidence_fingerprint =
                  recovery.evidence_fingerprint
            AND recovery_extraction.state = 'failed'
            AND recovery_extraction.failure_code = 'provider_error'
            AND recovery_extraction.is_current = 0
           JOIN import_recipe_terminal_projections AS projection
             ON projection.import_id = checkpoint.import_id
            AND projection.acquisition_generation =
                  checkpoint.acquisition_generation
            AND projection.ownership_id = checkpoint.ownership_id
            AND projection.projected_at = checkpoint.completed_at
            AND projection.status = 'failed'
            AND projection.status_code = 'recipe_extraction_failed'
            AND projection.recovery_action = 'operator_reconcile'
           JOIN recipe_imports AS parent
             ON parent.id = checkpoint.import_id
            AND parent.acquisition_generation =
                  checkpoint.acquisition_generation
            AND parent.status = 'transcribed'
            AND parent.status_code IS NULL
            AND parent.recovery_action IS NULL
            AND parent.evidence_references_json =
                  recovery.evidence_references_json
            AND projection.evidence_references_json =
                  parent.evidence_references_json
           WHERE audit.runtime_stage = ?
             AND audit.dispatch_id = ?
             AND recovery.import_id = ?
             AND recovery.acquisition_generation = ?
             AND recovery.recovery_ordinal = 1
             AND recovery.recovery_identity = 'recovery:1'
             AND audit.actual_cost_was_unknown = 1
             AND audit.authority = 'authenticated_operator'
             AND audit.conservative_charge_micro_usd = 100000
             AND dispatch.state = 'settled_unknown'
             AND dispatch.run_id =
                   'gaia-118:recipe-recovery:' || recovery.import_id
             AND dispatch.provider_stage_id = 'recipe-extraction'
             AND dispatch.actual_cost_micro_usd IS NULL
             AND dispatch.maximum_cost_micro_usd = 100000
             AND stage.state = 'open'
             AND stage.reserved_micro_usd = 0
             AND stage.invoking_dispatch_id IS NULL
             AND stage.poison_dispatch_id IS NULL
             AND stage.settled_micro_usd <= stage.budget_cap_micro_usd
             AND NOT EXISTS (
               SELECT 1
                 FROM pilot_provider_recipe_replay_values AS replay
                WHERE replay.runtime_stage = recovery.runtime_stage
                  AND replay.dispatch_id = recovery.recovery_dispatch_id
             )
             AND NOT EXISTS (
               SELECT 1
                 FROM pilot_provider_budget_dispatches AS sibling
                WHERE sibling.runtime_stage = dispatch.runtime_stage
                  AND sibling.run_id = dispatch.run_id
                  AND sibling.provider_stage_id = 'recipe-extraction'
                  AND sibling.state = 'settled_unknown'
                  AND NOT EXISTS (
                    SELECT 1
                      FROM pilot_provider_budget_reconciliations AS sibling_audit
                     WHERE sibling_audit.runtime_stage =
                           sibling.runtime_stage
                       AND sibling_audit.dispatch_id = sibling.dispatch_id
                  )
             )`
      )
      .bind(
        PilotProviderBudgetStage,
        input.dispatchId,
        input.importId,
        input.acquisitionGeneration
      )
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(providerTerminalSettlementError("not_allowed"))
        : Schema.decodeUnknownEffect(RecipeSettledRow, {
            onExcessProperty: "ignore",
          })(row).pipe(
            Effect.mapError(() =>
              providerTerminalSettlementError("persistence_corrupt")
            )
          )
    ),
    Effect.map(
      (row): ProviderTerminalSettlementResponse => ({
        acquisitionGeneration: row.acquisition_generation,
        conservativeChargeMicroUsd: 100_000,
        dispatchId: row.dispatch_id,
        importId: row.import_id,
        outcome: "recipe_recovery_unknown_cost_settled",
        runtimeStage: row.runtime_stage,
      })
    )
  );

const settleRecipeRecoveryBatch = (
  database: AnyD1Database,
  input: RecipeRecoveryUnknownSettlementRequest,
  settledAt: ImportTimestamp
) => {
  const timestamp = DateTime.formatIso(settledAt);
  return persistenceEffect(() =>
    database.batch([
      database
        .prepare(
          `INSERT INTO pilot_provider_budget_reconciliations (
             runtime_stage, dispatch_id, conservative_charge_micro_usd,
             actual_cost_was_unknown, authority, created_at
           )
           SELECT recovery.runtime_stage, recovery.recovery_dispatch_id,
                  100000, 1, 'authenticated_operator', ?
             ${recipeRecoveryUnknownAuthority}
              AND (
                SELECT COUNT(*)
                  FROM pilot_provider_budget_dispatches AS sibling
                 WHERE sibling.runtime_stage = dispatch.runtime_stage
                   AND sibling.run_id = dispatch.run_id
                   AND sibling.provider_stage_id = 'recipe-extraction'
                   AND sibling.state = 'settled_unknown'
                   AND NOT EXISTS (
                     SELECT 1
                       FROM pilot_provider_budget_reconciliations AS sibling_audit
                      WHERE sibling_audit.runtime_stage =
                            sibling.runtime_stage
                        AND sibling_audit.dispatch_id = sibling.dispatch_id
                   )
              ) = 1
           ON CONFLICT(runtime_stage, dispatch_id) DO NOTHING`
        )
        .bind(
          timestamp,
          PilotProviderBudgetStage,
          input.importId,
          input.acquisitionGeneration,
          input.dispatchId
        ),
      database
        .prepare(
          `UPDATE pilot_provider_stage_budget
              SET settled_micro_usd = settled_micro_usd + 100000,
                  reserved_micro_usd = reserved_micro_usd - 100000,
                  state = 'open',
                  invoking_dispatch_id = NULL,
                  poison_dispatch_id = NULL,
                  updated_at = ?
            WHERE runtime_stage = ?
              AND state = 'poisoned'
              AND poison_dispatch_id = ?
              AND invoking_dispatch_id IS NULL
              AND reserved_micro_usd = 100000
              AND settled_micro_usd + reserved_micro_usd
                    <= budget_cap_micro_usd
              AND EXISTS (
                SELECT 1
                  FROM pilot_provider_budget_reconciliations AS audit
                  JOIN pilot_provider_recipe_recoveries AS recovery
                    ON recovery.runtime_stage = audit.runtime_stage
                   AND recovery.recovery_dispatch_id = audit.dispatch_id
                  JOIN pilot_provider_budget_dispatches AS dispatch
                    ON dispatch.runtime_stage = audit.runtime_stage
                   AND dispatch.dispatch_id = audit.dispatch_id
                  JOIN import_provider_terminal_checkpoints AS checkpoint
                    ON checkpoint.import_id = recovery.import_id
                   AND checkpoint.acquisition_generation =
                         recovery.acquisition_generation
                   AND checkpoint.provider_stage = 'recipe'
                   AND checkpoint.ownership_id =
                         recovery.original_extraction_fingerprint
                   AND checkpoint.failure_code = 'outcome_unknown'
                  JOIN import_recipe_extractions AS original_extraction
                    ON original_extraction.extraction_fingerprint =
                         checkpoint.ownership_id
                   AND original_extraction.import_id = checkpoint.import_id
                   AND original_extraction.acquisition_generation =
                         checkpoint.acquisition_generation
                   AND original_extraction.evidence_fingerprint =
                         recovery.evidence_fingerprint
                   AND original_extraction.state = 'failed'
                   AND original_extraction.failure_code = 'provider_error'
                   AND original_extraction.completed_at =
                         checkpoint.completed_at
                  JOIN import_recipe_extractions AS recovery_extraction
                    ON recovery_extraction.import_id = checkpoint.import_id
                   AND recovery_extraction.acquisition_generation =
                         checkpoint.acquisition_generation
                   AND recovery_extraction.extraction_fingerprint =
                         recovery.recovery_extraction_fingerprint
                   AND recovery_extraction.evidence_fingerprint =
                         recovery.evidence_fingerprint
                   AND recovery_extraction.state = 'failed'
                   AND recovery_extraction.failure_code = 'provider_error'
                   AND recovery_extraction.is_current = 0
                  JOIN import_recipe_terminal_projections AS projection
                    ON projection.import_id = checkpoint.import_id
                   AND projection.acquisition_generation =
                         checkpoint.acquisition_generation
                   AND projection.ownership_id = checkpoint.ownership_id
                   AND projection.projected_at = checkpoint.completed_at
                   AND projection.status = 'failed'
                   AND projection.status_code =
                         'recipe_extraction_failed'
                   AND projection.recovery_action = 'operator_reconcile'
                  JOIN recipe_imports AS parent
                    ON parent.id = checkpoint.import_id
                   AND parent.acquisition_generation =
                         checkpoint.acquisition_generation
                   AND parent.status = 'transcribed'
                   AND parent.status_code IS NULL
                   AND parent.recovery_action IS NULL
                   AND parent.evidence_references_json =
                         recovery.evidence_references_json
                   AND projection.evidence_references_json =
                         parent.evidence_references_json
                 WHERE audit.runtime_stage = ?
                   AND audit.dispatch_id = ?
                   AND recovery.import_id = ?
                   AND recovery.acquisition_generation = ?
                   AND recovery.recovery_ordinal = 1
                   AND recovery.recovery_identity = 'recovery:1'
                   AND audit.actual_cost_was_unknown = 1
                   AND audit.authority = 'authenticated_operator'
                   AND audit.conservative_charge_micro_usd = 100000
                   AND dispatch.state = 'settled_unknown'
                   AND dispatch.run_id =
                         'gaia-118:recipe-recovery:' || recovery.import_id
                   AND dispatch.provider_stage_id = 'recipe-extraction'
                   AND dispatch.actual_cost_micro_usd IS NULL
                   AND dispatch.maximum_cost_micro_usd = 100000
                   AND NOT EXISTS (
                     SELECT 1
                       FROM pilot_provider_recipe_replay_values AS replay
                      WHERE replay.runtime_stage = recovery.runtime_stage
                        AND replay.dispatch_id =
                              recovery.recovery_dispatch_id
                   )
              )`
        )
        .bind(
          timestamp,
          PilotProviderBudgetStage,
          input.dispatchId,
          PilotProviderBudgetStage,
          input.dispatchId,
          input.importId,
          input.acquisitionGeneration
        ),
    ])
  );
};

const sweepExpiredRecipeReplays = (database: AnyD1Database) =>
  persistenceEffect<unknown>(() =>
    database
      .prepare(
        `DELETE FROM pilot_provider_recipe_replay_values
          WHERE runtime_stage = ?
            AND expires_at <=
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
      )
      .bind(PilotProviderBudgetStage)
      .run()
  ).pipe(
    Effect.flatMap((result) =>
      Schema.decodeUnknownEffect(D1MutationResult, {
        onExcessProperty: "ignore",
      })(result).pipe(
        Effect.mapError(() =>
          providerTerminalSettlementError("persistence_corrupt")
        )
      )
    ),
    Effect.map(
      (result): ProviderTerminalSettlementResponse => ({
        deletedCount: result.meta.changes,
        outcome: "expired_recipe_replays_swept",
        runtimeStage: PilotProviderBudgetStage,
      })
    )
  );

export interface ProviderTerminalSettlementServiceShape {
  readonly settle: (
    input: ProviderTerminalSettlementRequest
  ) => Effect.Effect<
    ProviderTerminalSettlementResponse,
    ProviderTerminalSettlementError
  >;
}

export class ProviderTerminalSettlementService extends Context.Service<
  ProviderTerminalSettlementService,
  ProviderTerminalSettlementServiceShape
>()("meal-planner/ProviderTerminalSettlementService") {}

interface ProviderTerminalSettlementServiceInput {
  readonly database: AnyD1Database;
  readonly now: () => ImportTimestamp;
  readonly runtimeStage: unknown;
  readonly recipeRecoveryStarter?: RecipeRecoveryWorkflowStarterShape;
  readonly workflowStarter?: Pick<
    ImportWorkflowStarterShape,
    "restartFromSpeech"
  >;
}

const prepareSpeechRecovery = (
  input: ProviderTerminalSettlementServiceInput,
  request: typeof SpeechRecoveryActivationRequest.Type
) =>
  Effect.gen(function* prepareSpeechTerminalRecovery() {
    const repository = makeD1ProviderTerminalRecoveryRepository(
      input.database,
      input.runtimeStage
    );
    const recovery = yield* repository
      .prepareSpeechUnknownRecovery({
        acquisitionGeneration: request.acquisitionGeneration,
        createdAt: input.now(),
        importId: request.importId,
        originalDispatchId: request.dispatchId,
      })
      .pipe(Effect.mapError(mapRecoveryPersistenceError));
    const inspectActivation = () =>
      repository
        .inspectSpeechUnknownRecoveryActivation({
          acquisitionGeneration: request.acquisitionGeneration,
          importId: request.importId,
          originalDispatchId: request.dispatchId,
          recoveryDispatchId: recovery.recoveryDispatchId,
        })
        .pipe(Effect.mapError(mapRecoveryPersistenceError));
    const activation = yield* inspectActivation();
    const activationResponse = () =>
      Schema.decodeUnknownEffect(SpeechRecoveryActivationResponse)({
        acquisitionGeneration: request.acquisitionGeneration,
        dispatchId: recovery.originalDispatchId,
        importId: recovery.importId,
        outcome: "speech_recovery_activated",
        recoveryDispatchId: recovery.recoveryDispatchId,
        runtimeStage: PilotProviderBudgetStage,
      }).pipe(
        Effect.mapError(() =>
          providerTerminalSettlementError("persistence_corrupt")
        )
      );
    if (activation._tag === "Completed") {
      return yield* activationResponse();
    }
    const restartFromSpeech = input.workflowStarter?.restartFromSpeech;
    if (restartFromSpeech === undefined) {
      return yield* Effect.fail(
        providerTerminalSettlementError("persistence_unavailable")
      );
    }
    const restarted = yield* restartFromSpeech(request.importId).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false))
    );
    if (!restarted) {
      const reconciled = yield* inspectActivation();
      if (reconciled._tag !== "Completed") {
        return yield* Effect.fail(
          providerTerminalSettlementError("persistence_unavailable")
        );
      }
    }
    return yield* activationResponse();
  });

export const makeD1ProviderTerminalSettlementService = (
  input: ProviderTerminalSettlementServiceInput
): ProviderTerminalSettlementServiceShape => ({
  settle: (request) =>
    Effect.gen(function* settleTerminalUnknownProviderCost() {
      if (input.runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(
          providerTerminalSettlementError("stage_not_allowed")
        );
      }
      if (
        "operation" in request &&
        request.operation === "sweep_expired_recipe_replays"
      ) {
        return yield* sweepExpiredRecipeReplays(input.database);
      }
      if (
        "operation" in request &&
        request.operation === "prepare_speech_recovery"
      ) {
        return yield* prepareSpeechRecovery(input, request);
      }
      if (
        "operation" in request &&
        request.operation === "prepare_visual_recovery"
      ) {
        const recovery = yield* makeD1ProviderTerminalRecoveryRepository(
          input.database,
          input.runtimeStage
        )
          .prepareVisualUnknownRecovery({
            acquisitionGeneration: request.acquisitionGeneration,
            createdAt: input.now(),
            importId: request.importId,
            originalDispatchId: request.dispatchId,
          })
          .pipe(
            Effect.mapError((error) =>
              providerTerminalSettlementError(mapRecoveryErrorCode(error.code))
            )
          );
        return yield* Schema.decodeUnknownEffect(
          VisualRecoveryPreparationResponse
        )({
          acquisitionGeneration: recovery.acquisitionGeneration,
          dispatchId: recovery.originalDispatchId,
          importId: recovery.importId,
          outcome: "visual_recovery_prepared",
          recoveryDispatchId: recovery.recoveryDispatchId,
          runtimeStage: PilotProviderBudgetStage,
        }).pipe(
          Effect.mapError(() =>
            providerTerminalSettlementError("persistence_corrupt")
          )
        );
      }
      if (isOperation(request, "settle_recipe_unknown")) {
        yield* settleRecipeBatch(input.database, request, input.now());
        return yield* readRecipeSettled(input.database, request);
      }
      if (isOperation(request, "settle_recipe_recovery_unknown")) {
        yield* settleRecipeRecoveryBatch(input.database, request, input.now());
        return yield* readRecipeRecoverySettled(input.database, request);
      }
      if (isOperation(request, "prepare_recipe_recovery")) {
        const recovery = yield* makeD1RecipeRecoveryRepository(
          input.database,
          input.runtimeStage
        )
          .prepare({
            acquisitionGeneration: request.acquisitionGeneration,
            createdAt: input.now(),
            importId: request.importId,
            originalDispatchId: request.dispatchId,
          })
          .pipe(
            Effect.mapError((error) =>
              providerTerminalSettlementError(mapRecoveryErrorCode(error.code))
            )
          );
        const start = input.recipeRecoveryStarter?.start;
        if (start === undefined) {
          return yield* Effect.fail(
            providerTerminalSettlementError("persistence_unavailable")
          );
        }
        yield* start(recovery).pipe(
          Effect.mapError(() =>
            providerTerminalSettlementError("persistence_unavailable")
          )
        );
        return yield* Schema.decodeUnknownEffect(
          RecipeRecoveryPreparationResponse
        )({
          acquisitionGeneration: recovery.acquisitionGeneration,
          dispatchId: recovery.originalDispatchId,
          importId: recovery.importId,
          outcome: "recipe_recovery_prepared",
          recoveryDispatchId: recovery.recoveryDispatchId,
          recoveryExtractionFingerprint: recovery.recoveryExtractionFingerprint,
          runtimeStage: PilotProviderBudgetStage,
        }).pipe(
          Effect.mapError(() =>
            providerTerminalSettlementError("persistence_corrupt")
          )
        );
      }
      if (isOperation(request, "resume_recipe_recovery")) {
        const recovery = yield* makeD1RecipeRecoveryRepository(
          input.database,
          input.runtimeStage
        )
          .readResume({
            acquisitionGeneration: request.acquisitionGeneration,
            importId: request.importId,
          })
          .pipe(
            Effect.mapError((error) =>
              providerTerminalSettlementError(mapRecoveryErrorCode(error.code))
            )
          );
        yield* Effect.succeed(recovery.originalDispatchId).pipe(
          Effect.filterOrFail(
            (originalDispatchId) => originalDispatchId === request.dispatchId,
            () => providerTerminalSettlementError("not_allowed")
          )
        );
        const resume = input.recipeRecoveryStarter?.resume;
        if (resume === undefined) {
          return yield* Effect.fail(
            providerTerminalSettlementError("persistence_unavailable")
          );
        }
        yield* resume(recovery).pipe(
          Effect.mapError(() =>
            providerTerminalSettlementError("persistence_unavailable")
          )
        );
        return yield* Schema.decodeUnknownEffect(RecipeRecoveryResumeResponse)({
          acquisitionGeneration: recovery.acquisitionGeneration,
          dispatchId: recovery.originalDispatchId,
          importId: recovery.importId,
          outcome: "recipe_recovery_resumed",
          recoveryDispatchId: recovery.recoveryDispatchId,
          recoveryExtractionFingerprint: recovery.recoveryExtractionFingerprint,
          runtimeStage: PilotProviderBudgetStage,
        }).pipe(
          Effect.mapError(() =>
            providerTerminalSettlementError("persistence_corrupt")
          )
        );
      }
      if (isOperation(request, "prepare_recipe_second_recovery")) {
        const recovery = yield* makeD1RecipeRecoveryRepository(
          input.database,
          input.runtimeStage
        )
          .prepareSecond({
            acquisitionGeneration: request.acquisitionGeneration,
            createdAt: input.now(),
            firstRecoveryDispatchId: request.dispatchId,
            importId: request.importId,
          })
          .pipe(
            Effect.mapError((error) =>
              providerTerminalSettlementError(mapRecoveryErrorCode(error.code))
            )
          );
        const start = input.recipeRecoveryStarter?.start;
        if (start === undefined) {
          return yield* Effect.fail(
            providerTerminalSettlementError("persistence_unavailable")
          );
        }
        yield* start(recovery).pipe(
          Effect.mapError(() =>
            providerTerminalSettlementError("persistence_unavailable")
          )
        );
        return yield* Schema.decodeUnknownEffect(
          RecipeSecondRecoveryPreparationResponse
        )({
          acquisitionGeneration: recovery.acquisitionGeneration,
          dispatchId: recovery.originalDispatchId,
          importId: recovery.importId,
          outcome: "recipe_second_recovery_prepared",
          recoveryDispatchId: recovery.recoveryDispatchId,
          recoveryExtractionFingerprint: recovery.recoveryExtractionFingerprint,
          runtimeStage: PilotProviderBudgetStage,
        }).pipe(
          Effect.mapError(() =>
            providerTerminalSettlementError("persistence_corrupt")
          )
        );
      }
      yield* settleBatch(input.database, request, input.now());
      return yield* readSettled(input.database, request);
    }),
});
