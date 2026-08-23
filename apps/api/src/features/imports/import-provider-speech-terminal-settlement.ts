import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Schema } from "effect";

import {
  PilotBudgetDispatchId,
  PilotProviderBudgetStage,
} from "../pilots/pilot-provider-budget.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { ImportId } from "./import.contracts.js";
import type { ImportTimestamp } from "./import.contracts.js";

const ConservativeChargeMicroUsd = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(10_000_000)
  )
);

const SpeechTerminalSettlementRow = Schema.Struct({
  acquisition_generation: AcquisitionGeneration,
  authority: Schema.Literal("authenticated_operator"),
  conservative_charge_micro_usd: ConservativeChargeMicroUsd,
  dispatch_id: PilotBudgetDispatchId,
  import_id: ImportId,
  runtime_stage: Schema.Literal(PilotProviderBudgetStage),
});

export interface SpeechTerminalSettlementRequest {
  readonly acquisitionGeneration: typeof AcquisitionGeneration.Type;
  readonly dispatchId: typeof PilotBudgetDispatchId.Type;
  readonly importId: typeof ImportId.Type;
}

export interface SpeechTerminalSettlementResult {
  readonly acquisitionGeneration: typeof AcquisitionGeneration.Type;
  readonly conservativeChargeMicroUsd: number;
  readonly dispatchId: typeof PilotBudgetDispatchId.Type;
  readonly importId: typeof ImportId.Type;
  readonly outcome: "terminal_unknown_cost_settled";
  readonly runtimeStage: typeof PilotProviderBudgetStage;
}

export interface SpeechTerminalSettlementError {
  readonly _tag: "SpeechTerminalSettlementError";
  readonly code:
    | "not_allowed"
    | "persistence_corrupt"
    | "persistence_unavailable";
}

const failure = (
  code: SpeechTerminalSettlementError["code"]
): SpeechTerminalSettlementError => ({
  _tag: "SpeechTerminalSettlementError",
  code,
});

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: () => failure("persistence_unavailable"),
    try: () => Promise.resolve(operation()),
  });

const readSettled = (
  database: AnyD1Database,
  input: SpeechTerminalSettlementRequest
) =>
  persistenceEffect<unknown | null>(() =>
    database
      .prepare(
        `SELECT audit.runtime_stage,
                audit.dispatch_id,
                audit.conservative_charge_micro_usd,
                audit.authority,
                ? AS import_id,
                ? AS acquisition_generation
           FROM pilot_provider_budget_reconciliations AS audit
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = audit.runtime_stage
            AND dispatch.dispatch_id = audit.dispatch_id
           JOIN pilot_provider_stage_budget AS stage
             ON stage.runtime_stage = audit.runtime_stage
          WHERE audit.runtime_stage = ?
            AND audit.dispatch_id = ?
            AND audit.actual_cost_was_unknown = 1
            AND audit.authority = 'authenticated_operator'
            AND dispatch.state = 'settled_unknown'
            AND dispatch.provider_stage_id = 'speech-transcription'
            AND dispatch.run_id = ?
            AND dispatch.actual_cost_micro_usd IS NULL
            AND dispatch.maximum_cost_micro_usd =
                  audit.conservative_charge_micro_usd
            AND (stage.poison_dispatch_id IS NULL OR
                 stage.poison_dispatch_id <> audit.dispatch_id)
            AND (stage.invoking_dispatch_id IS NULL OR
                 stage.invoking_dispatch_id <> audit.dispatch_id)`
      )
      .bind(
        input.importId,
        input.acquisitionGeneration,
        PilotProviderBudgetStage,
        input.dispatchId,
        `gaia-118:${input.importId}`
      )
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(failure("not_allowed"))
        : Schema.decodeUnknownEffect(SpeechTerminalSettlementRow, {
            onExcessProperty: "ignore",
          })(row).pipe(Effect.mapError(() => failure("persistence_corrupt")))
    ),
    Effect.map(
      (row): SpeechTerminalSettlementResult => ({
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
  input: SpeechTerminalSettlementRequest,
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
           SELECT stage.runtime_stage, dispatch.dispatch_id,
                  dispatch.maximum_cost_micro_usd, 1,
                  'authenticated_operator', ?
             FROM pilot_provider_stage_budget AS stage
             JOIN pilot_provider_budget_dispatches AS dispatch
               ON dispatch.runtime_stage = stage.runtime_stage
              AND dispatch.dispatch_id = stage.poison_dispatch_id
            WHERE stage.runtime_stage = ?
              AND stage.state = 'poisoned'
              AND stage.poison_dispatch_id = ?
              AND stage.invoking_dispatch_id IS NULL
              AND dispatch.state = 'settled_unknown'
              AND dispatch.provider_stage_id = 'speech-transcription'
              AND dispatch.run_id = ?
              AND dispatch.actual_cost_micro_usd IS NULL
              AND dispatch.maximum_cost_micro_usd <= stage.reserved_micro_usd
              AND stage.settled_micro_usd + dispatch.maximum_cost_micro_usd
                    <= stage.budget_cap_micro_usd
           ON CONFLICT(runtime_stage, dispatch_id) DO NOTHING`
        )
        .bind(
          timestamp,
          PilotProviderBudgetStage,
          input.dispatchId,
          `gaia-118:${input.importId}`
        ),
      database
        .prepare(
          `UPDATE pilot_provider_stage_budget
              SET settled_micro_usd = settled_micro_usd + (
                    SELECT conservative_charge_micro_usd
                      FROM pilot_provider_budget_reconciliations
                     WHERE runtime_stage = ? AND dispatch_id = ?
                  ),
                  reserved_micro_usd = reserved_micro_usd - (
                    SELECT conservative_charge_micro_usd
                      FROM pilot_provider_budget_reconciliations
                     WHERE runtime_stage = ? AND dispatch_id = ?
                  ),
                  state = 'open', invoking_dispatch_id = NULL,
                  poison_dispatch_id = NULL, updated_at = ?
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
                 WHERE dispatch.runtime_stage = ?
                   AND dispatch.dispatch_id = ?
                   AND dispatch.state = 'settled_unknown'
                   AND dispatch.provider_stage_id = 'speech-transcription'
                   AND dispatch.run_id = ?
                   AND dispatch.actual_cost_micro_usd IS NULL
                   AND dispatch.maximum_cost_micro_usd =
                         audit.conservative_charge_micro_usd
                   AND audit.actual_cost_was_unknown = 1
                   AND audit.authority = 'authenticated_operator'
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
          PilotProviderBudgetStage,
          input.dispatchId,
          `gaia-118:${input.importId}`
        ),
    ])
  );
};

/** Household authority is validated by the caller before global settlement. */
export const settleSpeechTerminalUnknown = (
  database: AnyD1Database,
  input: SpeechTerminalSettlementRequest,
  settledAt: ImportTimestamp
) =>
  settleBatch(database, input, settledAt).pipe(
    Effect.flatMap(() => readSettled(database, input))
  );
