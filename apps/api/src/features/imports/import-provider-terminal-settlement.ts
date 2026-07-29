import type { AnyD1Database } from "drizzle-orm/d1";
import { Context, DateTime, Effect, Schema } from "effect";

import {
  PilotBudgetDispatchId,
  PilotProviderBudgetStage,
} from "../pilots/pilot-provider-budget.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { makeD1ProviderTerminalRecoveryRepository } from "./import-provider-terminal.js";
import { ImportId } from "./import.contracts.js";
import type { ImportTimestamp } from "./import.contracts.js";

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

const RecipeTerminalUnknownSettlementRequest = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  operation: Schema.Literal("settle_recipe_unknown"),
});
type RecipeTerminalUnknownSettlementRequest =
  typeof RecipeTerminalUnknownSettlementRequest.Type;

const ExpiredRecipeReplaySweepRequest = Schema.Struct({
  operation: Schema.Literal("sweep_expired_recipe_replays"),
});

export const ProviderTerminalSettlementRequest = Schema.Union([
  TerminalUnknownSettlementRequest,
  VisualRecoveryPreparationRequest,
  RecipeTerminalUnknownSettlementRequest,
  ExpiredRecipeReplaySweepRequest,
]);
export type ProviderTerminalSettlementRequest =
  typeof ProviderTerminalSettlementRequest.Type;

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

const RecipeTerminalUnknownSettlementResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  conservativeChargeMicroUsd: Schema.Literal(100_000),
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("recipe_terminal_unknown_cost_settled"),
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});

const ExpiredRecipeReplaySweepResponse = Schema.Struct({
  deletedCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  outcome: Schema.Literal("expired_recipe_replays_swept"),
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});

export const ProviderTerminalSettlementResponse = Schema.Union([
  TerminalUnknownSettlementResponse,
  VisualRecoveryPreparationResponse,
  RecipeTerminalUnknownSettlementResponse,
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

export const makeD1ProviderTerminalSettlementService = (input: {
  readonly database: AnyD1Database;
  readonly now: () => ImportTimestamp;
  readonly runtimeStage: unknown;
}): ProviderTerminalSettlementServiceShape => ({
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
      if (
        "operation" in request &&
        request.operation === "settle_recipe_unknown"
      ) {
        yield* settleRecipeBatch(input.database, request, input.now());
        return yield* readRecipeSettled(input.database, request);
      }
      yield* settleBatch(input.database, request, input.now());
      return yield* readSettled(input.database, request);
    }),
});
