import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Schema } from "effect";

import { PilotProviderBudgetStage } from "../pilots/pilot-provider-budget.js";
import type { AcquisitionGeneration } from "./import-media.model.js";
import type { ProviderTaskStage } from "./import-provider-workflow-task.js";
import type { ImportId, ImportTimestamp } from "./import.contracts.js";

export type ProviderTerminalPersistenceErrorCode =
  | "persistence_corrupt"
  | "persistence_unavailable"
  | "recovery_not_allowed"
  | "stage_not_allowed";

export interface ProviderTerminalPersistenceError {
  readonly _tag: "ProviderTerminalPersistenceError";
  readonly code: ProviderTerminalPersistenceErrorCode;
}

const providerTerminalPersistenceError = (
  code: ProviderTerminalPersistenceErrorCode
): ProviderTerminalPersistenceError => ({
  _tag: "ProviderTerminalPersistenceError",
  code,
});

const CheckpointRow = Schema.Struct({
  acquisition_generation: Schema.Number,
  completed_at: Schema.String,
  failure_code: Schema.String,
  import_id: Schema.String,
  ownership_id: Schema.String,
  provider_stage: Schema.Literals(["recipe", "speech", "visual"]),
});

const RecoveryRow = Schema.Struct({
  acquisition_generation: Schema.Number,
  import_id: Schema.String,
  original_dispatch_id: Schema.String,
  recovery_dispatch_id: Schema.String,
});

const SpeechRecoveryActivationRow = Schema.Struct({
  parent_status: Schema.String,
  recovery_dispatch_id: Schema.NullOr(Schema.String),
  transcription_state: Schema.NullOr(Schema.String),
});

export interface ProviderTerminalCheckpoint {
  readonly acquisitionGeneration: number;
  readonly completedAt: string;
  readonly failureCode: string;
  readonly importId: string;
  readonly ownershipId: string;
  readonly providerStage: ProviderTaskStage;
}

export interface SpeechProviderRecovery {
  readonly acquisitionGeneration: number;
  readonly importId: string;
  readonly originalDispatchId: string;
  readonly recoveryDispatchId: string;
}

export type SpeechProviderRecoveryActivation =
  | {
      readonly _tag: "Completed";
      readonly recovery: SpeechProviderRecovery;
    }
  | {
      readonly _tag: "Prepared";
      readonly recovery: SpeechProviderRecovery;
    };

export type VisualProviderRecovery = SpeechProviderRecovery;

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: () => providerTerminalPersistenceError("persistence_unavailable"),
    try: () => Promise.resolve(operation()),
  });

const decodeCheckpoint = (value: unknown) =>
  Schema.decodeUnknownEffect(CheckpointRow, {
    onExcessProperty: "ignore",
  })(value).pipe(
    Effect.mapError(() =>
      providerTerminalPersistenceError("persistence_corrupt")
    ),
    Effect.map(
      (row): ProviderTerminalCheckpoint => ({
        acquisitionGeneration: row.acquisition_generation,
        completedAt: row.completed_at,
        failureCode: row.failure_code,
        importId: row.import_id,
        ownershipId: row.ownership_id,
        providerStage: row.provider_stage,
      })
    )
  );

const decodeRecovery = (value: unknown) =>
  Schema.decodeUnknownEffect(RecoveryRow, {
    onExcessProperty: "ignore",
  })(value).pipe(
    Effect.mapError(() =>
      providerTerminalPersistenceError("persistence_corrupt")
    ),
    Effect.map(
      (row): SpeechProviderRecovery => ({
        acquisitionGeneration: row.acquisition_generation,
        importId: row.import_id,
        originalDispatchId: row.original_dispatch_id,
        recoveryDispatchId: row.recovery_dispatch_id,
      })
    )
  );

const readActiveOwnership = (
  database: AnyD1Database,
  input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly providerStage: ProviderTaskStage;
  }
) =>
  persistenceEffect<{
    readonly results: readonly { readonly ownership_id: string }[];
  }>(
    () =>
      database
        .prepare(
          `SELECT ownership_id
           FROM (
             SELECT dispatch_id AS ownership_id
               FROM import_transcriptions
              WHERE ? = 'speech'
                AND import_id = ?
                AND acquisition_generation = ?
                AND state IN ('dispatching', 'failed')
             UNION ALL
             SELECT dispatch_id AS ownership_id
               FROM import_visual_evidence
              WHERE ? = 'visual'
                AND import_id = ?
                AND acquisition_generation = ?
                AND state IN ('dispatching', 'failed')
             UNION ALL
             SELECT extraction_fingerprint AS ownership_id
               FROM import_recipe_extractions
              WHERE ? = 'recipe'
                AND import_id = ?
                AND acquisition_generation = ?
                AND state IN ('dispatching', 'failed')
           )
          LIMIT 2`
        )
        .bind(
          input.providerStage,
          input.importId,
          input.acquisitionGeneration,
          input.providerStage,
          input.importId,
          input.acquisitionGeneration,
          input.providerStage,
          input.importId,
          input.acquisitionGeneration
        )
        .all<{ readonly ownership_id: string }>() as PromiseLike<{
        readonly results: readonly { readonly ownership_id: string }[];
      }>
  ).pipe(
    Effect.flatMap(({ results }) =>
      results.length === 1 &&
      typeof results[0]?.ownership_id === "string" &&
      results[0].ownership_id.length > 0
        ? Effect.succeed(results[0].ownership_id)
        : Effect.fail(providerTerminalPersistenceError("persistence_corrupt"))
    )
  );

const readCheckpoint = (
  database: AnyD1Database,
  input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly ownershipId: string;
    readonly providerStage: ProviderTaskStage;
  }
) =>
  persistenceEffect<unknown | null>(
    () =>
      database
        .prepare(
          `SELECT import_id, acquisition_generation, provider_stage,
                ownership_id, failure_code, completed_at
           FROM import_provider_terminal_checkpoints
          WHERE import_id = ?
            AND acquisition_generation = ?
            AND provider_stage = ?
            AND ownership_id = ?`
        )
        .bind(
          input.importId,
          input.acquisitionGeneration,
          input.providerStage,
          input.ownershipId
        )
        .first() as PromiseLike<unknown | null>
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(providerTerminalPersistenceError("persistence_corrupt"))
        : decodeCheckpoint(row)
    )
  );

export interface ProviderTerminalCheckpointRepository {
  readonly persist: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly completedAt: ImportTimestamp;
    readonly failureCode: string;
    readonly importId: ImportId;
    readonly providerStage: ProviderTaskStage;
  }) => Effect.Effect<
    ProviderTerminalCheckpoint,
    ProviderTerminalPersistenceError
  >;
}

export const makeD1ProviderTerminalCheckpointRepository = (
  database: AnyD1Database
): ProviderTerminalCheckpointRepository => ({
  persist: (input) =>
    Effect.gen(function* persistProviderTerminalCheckpoint() {
      const ownershipId = yield* readActiveOwnership(database, input);
      const completedAt = DateTime.formatIso(input.completedAt);
      yield* persistenceEffect(() =>
        database
          .prepare(
            `INSERT INTO import_provider_terminal_checkpoints (
               import_id, acquisition_generation, provider_stage, ownership_id,
               failure_code, completed_at, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(
               import_id, acquisition_generation, provider_stage, ownership_id
             ) DO NOTHING`
          )
          .bind(
            input.importId,
            input.acquisitionGeneration,
            input.providerStage,
            ownershipId,
            input.failureCode,
            completedAt,
            completedAt
          )
          .run()
      );
      const checkpoint = yield* readCheckpoint(database, {
        ...input,
        ownershipId,
      });
      if (checkpoint.failureCode !== input.failureCode) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("persistence_corrupt")
        );
      }
      return checkpoint;
    }),
});

const readLegacyRecovery = (
  database: AnyD1Database,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) =>
  persistenceEffect(() =>
    database
      .prepare(
        `SELECT import_id, acquisition_generation, original_dispatch_id,
                recovery_dispatch_id
           FROM pilot_provider_speech_recoveries
          WHERE runtime_stage = ?
            AND import_id = ?
            AND acquisition_generation = ?`
      )
      .bind(PilotProviderBudgetStage, importId, acquisitionGeneration)
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(providerTerminalPersistenceError("recovery_not_allowed"))
        : decodeRecovery(row)
    )
  );

const readSettledRecovery = (
  database: AnyD1Database,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) =>
  persistenceEffect<{ readonly results: readonly unknown[] }>(() =>
    database
      .prepare(
        `SELECT
           checkpoint.import_id,
           checkpoint.acquisition_generation,
           audit.dispatch_id AS original_dispatch_id,
           audit.dispatch_id || ':recovery:1' AS recovery_dispatch_id
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
         JOIN recipe_imports AS parent
           ON parent.id = checkpoint.import_id
          AND parent.acquisition_generation = checkpoint.acquisition_generation
         JOIN import_transcriptions AS transcription
           ON transcription.import_id = checkpoint.import_id
          AND transcription.acquisition_generation =
                checkpoint.acquisition_generation
          AND transcription.dispatch_id = audit.dispatch_id || ':recovery:1'
         WHERE audit.runtime_stage = ?
           AND audit.actual_cost_was_unknown = 1
           AND audit.authority = 'authenticated_operator'
           AND dispatch.state = 'settled_unknown'
           AND dispatch.provider_stage_id = 'speech-transcription'
           AND dispatch.actual_cost_micro_usd IS NULL
           AND dispatch.maximum_cost_micro_usd =
                 audit.conservative_charge_micro_usd
           AND instr(audit.dispatch_id, ':recovery:1') = 0
           AND NOT EXISTS (
             SELECT 1
               FROM pilot_provider_speech_recoveries AS recovery
              WHERE recovery.runtime_stage = audit.runtime_stage
                AND recovery.original_dispatch_id = audit.dispatch_id
           )
           AND (
             (
               transcription.state = 'dispatching'
               AND parent.status = 'transcribing'
             )
             OR (
               transcription.state = 'transcribed'
               AND parent.status = 'transcribed'
             )
             OR (
               transcription.state = 'failed'
               AND parent.status = 'failed'
               AND parent.status_code = 'transcription_failed'
               AND parent.recovery_action = 'retry_later'
             )
           )
           AND json_array_length(parent.evidence_references_json) >= 2
         LIMIT 2`
      )
      .bind(importId, acquisitionGeneration, PilotProviderBudgetStage)
      .all()
  ).pipe(
    Effect.flatMap(({ results }) =>
      results.length === 1
        ? decodeRecovery(results[0])
        : Effect.fail(
            providerTerminalPersistenceError(
              results.length === 0
                ? "recovery_not_allowed"
                : "persistence_corrupt"
            )
          )
    )
  );

const readRecovery = (
  database: AnyD1Database,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) => {
  const readSettledAfterMissingLegacyRecovery = (
    error: ProviderTerminalPersistenceError
  ) =>
    error.code === "recovery_not_allowed"
      ? readSettledRecovery(database, importId, acquisitionGeneration)
      : Effect.fail(error);

  return readLegacyRecovery(database, importId, acquisitionGeneration).pipe(
    Effect.catchTag(
      "ProviderTerminalPersistenceError",
      readSettledAfterMissingLegacyRecovery
    )
  );
};

const assertSpeechRecoveryActivatable = (
  database: AnyD1Database,
  input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly recovery: SpeechProviderRecovery;
  }
) =>
  persistenceEffect<unknown | null>(() =>
    database
      .prepare(
        `SELECT
           parent.status AS parent_status,
           transcription.dispatch_id AS recovery_dispatch_id,
           transcription.state AS transcription_state
         FROM recipe_imports AS parent
         LEFT JOIN import_transcriptions AS transcription
           ON transcription.import_id = parent.id
          AND transcription.acquisition_generation =
                parent.acquisition_generation
          AND transcription.dispatch_id = ?
        WHERE parent.id = ?
          AND parent.acquisition_generation = ?
        LIMIT 1`
      )
      .bind(
        input.recovery.recoveryDispatchId,
        input.importId,
        input.acquisitionGeneration
      )
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(providerTerminalPersistenceError("recovery_not_allowed"))
        : Schema.decodeUnknownEffect(SpeechRecoveryActivationRow, {
            onExcessProperty: "ignore",
          })(row).pipe(
            Effect.mapError(() =>
              providerTerminalPersistenceError("persistence_corrupt")
            )
          )
    ),
    Effect.flatMap((row) => {
      const legacyPrepared =
        row.parent_status === "acquired" &&
        row.recovery_dispatch_id === null &&
        row.transcription_state === null;
      const settledPrepared =
        row.parent_status === "transcribing" &&
        row.recovery_dispatch_id === input.recovery.recoveryDispatchId &&
        row.transcription_state === "dispatching";
      const completed =
        row.parent_status === "transcribed" &&
        row.recovery_dispatch_id === input.recovery.recoveryDispatchId &&
        row.transcription_state === "transcribed";
      if (legacyPrepared || settledPrepared) {
        return Effect.succeed<SpeechProviderRecoveryActivation>({
          _tag: "Prepared",
          recovery: input.recovery,
        });
      }
      if (completed) {
        return Effect.succeed<SpeechProviderRecoveryActivation>({
          _tag: "Completed",
          recovery: input.recovery,
        });
      }
      return Effect.fail(
        providerTerminalPersistenceError("recovery_not_allowed")
      );
    })
  );

const allowMissingRecovery = (error: ProviderTerminalPersistenceError) =>
  error.code === "recovery_not_allowed"
    ? Effect.succeed(null)
    : Effect.fail(error);

const readSettledRecoveryCandidate = (
  database: AnyD1Database,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) =>
  persistenceEffect<{
    readonly original_dispatch_id: string;
    readonly source_media_sha256: string;
  } | null>(() =>
    database
      .prepare(
        `SELECT audit.dispatch_id AS original_dispatch_id,
                  transcription.source_media_sha256
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
              AND json_array_length(parent.evidence_references_json) = 2
             JOIN pilot_provider_stage_budget AS stage
               ON stage.runtime_stage = audit.runtime_stage
            WHERE audit.runtime_stage = ?
              AND audit.actual_cost_was_unknown = 1
              AND audit.authority = 'authenticated_operator'
              AND dispatch.state = 'settled_unknown'
              AND dispatch.provider_stage_id = 'speech-transcription'
              AND dispatch.actual_cost_micro_usd IS NULL
              AND dispatch.maximum_cost_micro_usd =
                    audit.conservative_charge_micro_usd
              AND instr(audit.dispatch_id, ':recovery:1') = 0
              AND stage.state = 'open'
              AND stage.reserved_micro_usd = 0
              AND stage.invoking_dispatch_id IS NULL
              AND stage.poison_dispatch_id IS NULL
              AND stage.settled_micro_usd < stage.budget_cap_micro_usd
              AND NOT EXISTS (
                SELECT 1
                  FROM pilot_provider_speech_recoveries AS recovery
                 WHERE recovery.runtime_stage = audit.runtime_stage
                   AND recovery.original_dispatch_id = audit.dispatch_id
              )
            LIMIT 2`
      )
      .bind(importId, acquisitionGeneration, PilotProviderBudgetStage)
      .first<{
        readonly original_dispatch_id: string;
        readonly source_media_sha256: string;
      }>()
  ).pipe(
    Effect.flatMap((candidate) =>
      candidate !== null &&
      typeof candidate.original_dispatch_id === "string" &&
      candidate.original_dispatch_id.length > 0 &&
      typeof candidate.source_media_sha256 === "string" &&
      /^[\da-f]{64}$/u.test(candidate.source_media_sha256)
        ? Effect.succeed(candidate)
        : Effect.fail(providerTerminalPersistenceError("recovery_not_allowed"))
    )
  );

const prepareSettledRecovery = (
  database: AnyD1Database,
  input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly createdAt: ImportTimestamp;
    readonly importId: ImportId;
  },
  candidate: {
    readonly original_dispatch_id: string;
    readonly source_media_sha256: string;
  }
) => {
  const updatedAt = DateTime.formatIso(input.createdAt);
  const recoveryDispatchId = `${candidate.original_dispatch_id}:recovery:1`;
  return persistenceEffect(() =>
    database.batch([
      database
        .prepare(
          `UPDATE recipe_imports AS parent
              SET status = 'acquired',
                  status_code = NULL,
                  recovery_action = NULL,
                  updated_at = ?
            WHERE parent.id = ?
              AND parent.acquisition_generation = ?
              AND parent.status = 'failed'
              AND parent.status_code = 'transcription_failed'
              AND parent.recovery_action = 'retry_later'
              AND json_array_length(parent.evidence_references_json) = 2
              AND EXISTS (
                SELECT 1
                  FROM import_transcriptions AS transcription
                  JOIN import_provider_terminal_checkpoints AS checkpoint
                    ON checkpoint.import_id = transcription.import_id
                   AND checkpoint.acquisition_generation =
                         transcription.acquisition_generation
                   AND checkpoint.provider_stage = 'speech'
                   AND checkpoint.ownership_id = transcription.dispatch_id
                   AND checkpoint.failure_code = 'outcome_unknown'
                   AND checkpoint.completed_at = transcription.completed_at
                  JOIN pilot_provider_budget_reconciliations AS audit
                    ON audit.runtime_stage = ?
                   AND audit.dispatch_id = checkpoint.ownership_id
                   AND audit.actual_cost_was_unknown = 1
                   AND audit.authority = 'authenticated_operator'
                  JOIN pilot_provider_budget_dispatches AS dispatch
                    ON dispatch.runtime_stage = audit.runtime_stage
                   AND dispatch.dispatch_id = audit.dispatch_id
                   AND dispatch.state = 'settled_unknown'
                   AND dispatch.provider_stage_id = 'speech-transcription'
                   AND dispatch.actual_cost_micro_usd IS NULL
                   AND dispatch.maximum_cost_micro_usd =
                         audit.conservative_charge_micro_usd
                  JOIN pilot_provider_stage_budget AS stage
                    ON stage.runtime_stage = audit.runtime_stage
                   AND stage.state = 'open'
                   AND stage.reserved_micro_usd = 0
                   AND stage.invoking_dispatch_id IS NULL
                   AND stage.poison_dispatch_id IS NULL
                   AND stage.settled_micro_usd <
                         stage.budget_cap_micro_usd
                 WHERE transcription.import_id = parent.id
                   AND transcription.acquisition_generation =
                         parent.acquisition_generation
                   AND transcription.dispatch_id = ?
                   AND transcription.state = 'failed'
                   AND transcription.failure_code = 'outcome_unknown'
                   AND NOT EXISTS (
                     SELECT 1
                       FROM pilot_provider_speech_recoveries AS recovery
                      WHERE recovery.runtime_stage = audit.runtime_stage
                        AND recovery.original_dispatch_id = audit.dispatch_id
                   )
              )`
        )
        .bind(
          updatedAt,
          input.importId,
          input.acquisitionGeneration,
          PilotProviderBudgetStage,
          candidate.original_dispatch_id
        ),
      database
        .prepare(
          `DELETE FROM import_transcriptions
            WHERE import_id = ?
              AND acquisition_generation = ?
              AND dispatch_id = ?
              AND state = 'failed'
              AND failure_code = 'outcome_unknown'
              AND EXISTS (
                SELECT 1
                  FROM recipe_imports AS parent
                  JOIN import_provider_terminal_checkpoints AS checkpoint
                    ON checkpoint.import_id = parent.id
                   AND checkpoint.acquisition_generation =
                         parent.acquisition_generation
                   AND checkpoint.provider_stage = 'speech'
                   AND checkpoint.ownership_id = ?
                   AND checkpoint.failure_code = 'outcome_unknown'
                  JOIN pilot_provider_budget_reconciliations AS audit
                    ON audit.runtime_stage = ?
                   AND audit.dispatch_id = checkpoint.ownership_id
                   AND audit.actual_cost_was_unknown = 1
                   AND audit.authority = 'authenticated_operator'
                  JOIN pilot_provider_budget_dispatches AS dispatch
                    ON dispatch.runtime_stage = audit.runtime_stage
                   AND dispatch.dispatch_id = audit.dispatch_id
                   AND dispatch.state = 'settled_unknown'
                   AND dispatch.provider_stage_id = 'speech-transcription'
                   AND dispatch.actual_cost_micro_usd IS NULL
                   AND dispatch.maximum_cost_micro_usd =
                         audit.conservative_charge_micro_usd
                  JOIN pilot_provider_stage_budget AS stage
                    ON stage.runtime_stage = audit.runtime_stage
                   AND stage.state = 'open'
                   AND stage.reserved_micro_usd = 0
                   AND stage.invoking_dispatch_id IS NULL
                   AND stage.poison_dispatch_id IS NULL
                   AND stage.settled_micro_usd <
                         stage.budget_cap_micro_usd
                 WHERE parent.id = import_transcriptions.import_id
                   AND parent.acquisition_generation =
                         import_transcriptions.acquisition_generation
                   AND parent.status = 'acquired'
                   AND parent.status_code IS NULL
                   AND parent.recovery_action IS NULL
                   AND json_array_length(parent.evidence_references_json) = 2
                   AND NOT EXISTS (
                     SELECT 1
                       FROM pilot_provider_speech_recoveries AS recovery
                      WHERE recovery.runtime_stage = audit.runtime_stage
                        AND recovery.original_dispatch_id = audit.dispatch_id
                   )
              )`
        )
        .bind(
          input.importId,
          input.acquisitionGeneration,
          candidate.original_dispatch_id,
          candidate.original_dispatch_id,
          PilotProviderBudgetStage
        ),
      database
        .prepare(
          `INSERT INTO import_transcriptions (
             import_id, acquisition_generation, dispatch_id,
             source_media_sha256, state, created_at, updated_at
           )
           SELECT parent.id, parent.acquisition_generation, ?, ?,
                  'dispatching', ?, ?
             FROM recipe_imports AS parent
             JOIN import_provider_terminal_checkpoints AS checkpoint
               ON checkpoint.import_id = parent.id
              AND checkpoint.acquisition_generation =
                    parent.acquisition_generation
              AND checkpoint.provider_stage = 'speech'
              AND checkpoint.ownership_id = ?
              AND checkpoint.failure_code = 'outcome_unknown'
             JOIN pilot_provider_budget_reconciliations AS audit
               ON audit.runtime_stage = ?
              AND audit.dispatch_id = checkpoint.ownership_id
              AND audit.actual_cost_was_unknown = 1
              AND audit.authority = 'authenticated_operator'
             JOIN pilot_provider_budget_dispatches AS dispatch
               ON dispatch.runtime_stage = audit.runtime_stage
              AND dispatch.dispatch_id = audit.dispatch_id
              AND dispatch.state = 'settled_unknown'
              AND dispatch.provider_stage_id = 'speech-transcription'
              AND dispatch.actual_cost_micro_usd IS NULL
              AND dispatch.maximum_cost_micro_usd =
                    audit.conservative_charge_micro_usd
             JOIN pilot_provider_stage_budget AS stage
               ON stage.runtime_stage = audit.runtime_stage
              AND stage.state = 'open'
              AND stage.reserved_micro_usd = 0
              AND stage.invoking_dispatch_id IS NULL
              AND stage.poison_dispatch_id IS NULL
              AND stage.settled_micro_usd < stage.budget_cap_micro_usd
            WHERE parent.id = ?
              AND parent.acquisition_generation = ?
              AND parent.status = 'acquired'
              AND parent.status_code IS NULL
              AND parent.recovery_action IS NULL
              AND json_array_length(parent.evidence_references_json) = 2
              AND instr(audit.dispatch_id, ':recovery:1') = 0
              AND NOT EXISTS (
                SELECT 1
                  FROM import_transcriptions AS transcription
                 WHERE transcription.import_id = parent.id
                   AND transcription.acquisition_generation =
                         parent.acquisition_generation
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM pilot_provider_speech_recoveries AS recovery
                 WHERE recovery.runtime_stage = audit.runtime_stage
                   AND recovery.original_dispatch_id = audit.dispatch_id
              )
           ON CONFLICT(import_id, acquisition_generation) DO NOTHING`
        )
        .bind(
          recoveryDispatchId,
          candidate.source_media_sha256,
          updatedAt,
          updatedAt,
          candidate.original_dispatch_id,
          PilotProviderBudgetStage,
          input.importId,
          input.acquisitionGeneration
        ),
    ])
  );
};

const readSettledVisualRecovery = (
  database: AnyD1Database,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) =>
  persistenceEffect<{ readonly results: readonly unknown[] }>(() =>
    database
      .prepare(
        `SELECT
           first_recovery.import_id,
           first_recovery.acquisition_generation,
           COALESCE(
             second_recovery.first_recovery_dispatch_id,
             first_recovery.original_dispatch_id
           ) AS original_dispatch_id,
           COALESCE(
             second_recovery.recovery_dispatch_id,
             first_recovery.recovery_dispatch_id
           ) AS recovery_dispatch_id
         FROM pilot_provider_visual_recoveries AS first_recovery
         LEFT JOIN pilot_provider_visual_second_recoveries AS second_recovery
           ON second_recovery.runtime_stage =
                first_recovery.runtime_stage
          AND second_recovery.original_dispatch_id =
                first_recovery.original_dispatch_id
         WHERE first_recovery.runtime_stage = ?
           AND first_recovery.import_id = ?
           AND first_recovery.acquisition_generation = ?
         LIMIT 2`
      )
      .bind(PilotProviderBudgetStage, importId, acquisitionGeneration)
      .all()
  ).pipe(
    Effect.flatMap(({ results }) =>
      results.length === 1
        ? decodeRecovery(results[0])
        : Effect.fail(
            providerTerminalPersistenceError(
              results.length === 0
                ? "recovery_not_allowed"
                : "persistence_corrupt"
            )
          )
    )
  );

const readSettledVisualSecondRecoveryCandidate = (
  database: AnyD1Database,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration,
  firstRecoveryDispatchId: string
) =>
  persistenceEffect<{
    readonly first_recovery_dispatch_id: string;
    readonly original_dispatch_id: string;
  } | null>(() =>
    database
      .prepare(
        `SELECT
           first_recovery.original_dispatch_id,
           first_recovery.recovery_dispatch_id
             AS first_recovery_dispatch_id
         FROM pilot_provider_visual_recoveries AS first_recovery
         JOIN pilot_provider_budget_reconciliations AS audit
           ON audit.runtime_stage = first_recovery.runtime_stage
          AND audit.dispatch_id =
                first_recovery.recovery_dispatch_id
         JOIN pilot_provider_budget_dispatches AS dispatch
           ON dispatch.runtime_stage = audit.runtime_stage
          AND dispatch.dispatch_id = audit.dispatch_id
         JOIN import_provider_terminal_checkpoints AS checkpoint
           ON checkpoint.import_id = first_recovery.import_id
          AND checkpoint.acquisition_generation =
                first_recovery.acquisition_generation
          AND checkpoint.provider_stage = 'visual'
          AND checkpoint.ownership_id =
                first_recovery.recovery_dispatch_id
          AND checkpoint.failure_code IN (
                'visual_extraction_failed',
                'outcome_unknown'
              )
         JOIN import_visual_evidence AS visual
           ON visual.import_id = checkpoint.import_id
          AND visual.acquisition_generation =
                checkpoint.acquisition_generation
          AND visual.dispatch_id = checkpoint.ownership_id
          AND visual.state = 'failed'
          AND visual.failure_code = checkpoint.failure_code
          AND visual.completed_at = checkpoint.completed_at
         JOIN recipe_imports AS parent
           ON parent.id = checkpoint.import_id
          AND parent.acquisition_generation =
                checkpoint.acquisition_generation
          AND parent.status = 'transcribed'
          AND parent.status_code IS NULL
          AND parent.recovery_action IS NULL
          AND json_array_length(parent.evidence_references_json) = 3
         JOIN import_transcriptions AS transcription
           ON transcription.import_id = parent.id
          AND transcription.acquisition_generation =
                parent.acquisition_generation
          AND transcription.state = 'transcribed'
          AND transcription.source_media_sha256 =
                visual.source_media_sha256
         JOIN pilot_provider_stage_budget AS stage
           ON stage.runtime_stage = audit.runtime_stage
        WHERE first_recovery.runtime_stage = ?
          AND first_recovery.import_id = ?
          AND first_recovery.acquisition_generation = ?
          AND first_recovery.recovery_dispatch_id = ?
          AND first_recovery.recovery_dispatch_id =
                first_recovery.original_dispatch_id || ':recovery:1'
          AND instr(first_recovery.original_dispatch_id, ':recovery:') = 0
          AND audit.actual_cost_was_unknown = 1
          AND audit.authority = 'authenticated_operator'
          AND dispatch.state = 'settled_unknown'
          AND dispatch.provider_stage_id = 'visual-evidence'
          AND dispatch.actual_cost_micro_usd IS NULL
          AND dispatch.maximum_cost_micro_usd =
                audit.conservative_charge_micro_usd
          AND stage.state = 'open'
          AND stage.reserved_micro_usd = 0
          AND stage.invoking_dispatch_id IS NULL
          AND stage.poison_dispatch_id IS NULL
          AND stage.settled_micro_usd < stage.budget_cap_micro_usd
          AND NOT EXISTS (
            SELECT 1
              FROM import_recipe_extractions AS recipe
             WHERE recipe.import_id = parent.id
               AND recipe.acquisition_generation =
                     parent.acquisition_generation
          )
          AND NOT EXISTS (
            SELECT 1
              FROM pilot_provider_visual_second_recoveries AS recovery
             WHERE recovery.runtime_stage =
                     first_recovery.runtime_stage
               AND recovery.original_dispatch_id =
                     first_recovery.original_dispatch_id
          )
        LIMIT 2`
      )
      .bind(
        PilotProviderBudgetStage,
        importId,
        acquisitionGeneration,
        firstRecoveryDispatchId
      )
      .first<{
        readonly first_recovery_dispatch_id: string;
        readonly original_dispatch_id: string;
      }>()
  ).pipe(
    Effect.flatMap((candidate) =>
      candidate !== null &&
      typeof candidate.original_dispatch_id === "string" &&
      candidate.original_dispatch_id.length > 0 &&
      !candidate.original_dispatch_id.includes(":recovery:") &&
      candidate.first_recovery_dispatch_id ===
        `${candidate.original_dispatch_id}:recovery:1`
        ? Effect.succeed(candidate)
        : Effect.fail(providerTerminalPersistenceError("recovery_not_allowed"))
    )
  );

const readSettledVisualRecoveryCandidate = (
  database: AnyD1Database,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration,
  originalDispatchId: string
) =>
  persistenceEffect<{
    readonly original_dispatch_id: string;
    readonly source_media_sha256: string;
  } | null>(() =>
    database
      .prepare(
        `SELECT audit.dispatch_id AS original_dispatch_id,
                visual.source_media_sha256
           FROM pilot_provider_budget_reconciliations AS audit
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = audit.runtime_stage
            AND dispatch.dispatch_id = audit.dispatch_id
           JOIN import_provider_terminal_checkpoints AS checkpoint
             ON checkpoint.import_id = ?
            AND checkpoint.acquisition_generation = ?
            AND checkpoint.provider_stage = 'visual'
            AND checkpoint.ownership_id = audit.dispatch_id
            AND checkpoint.failure_code = 'visual_extraction_failed'
           JOIN import_visual_evidence AS visual
             ON visual.import_id = checkpoint.import_id
            AND visual.acquisition_generation =
                  checkpoint.acquisition_generation
            AND visual.dispatch_id = checkpoint.ownership_id
            AND visual.state = 'failed'
            AND visual.failure_code = 'visual_extraction_failed'
           JOIN recipe_imports AS parent
             ON parent.id = checkpoint.import_id
            AND parent.acquisition_generation =
                  checkpoint.acquisition_generation
            AND parent.status = 'transcribed'
            AND parent.status_code IS NULL
            AND parent.recovery_action IS NULL
            AND json_array_length(parent.evidence_references_json) = 3
           JOIN import_transcriptions AS transcription
             ON transcription.import_id = parent.id
            AND transcription.acquisition_generation =
                  parent.acquisition_generation
            AND transcription.state = 'transcribed'
           JOIN pilot_provider_stage_budget AS stage
             ON stage.runtime_stage = audit.runtime_stage
          WHERE audit.runtime_stage = ?
            AND audit.dispatch_id = ?
            AND audit.actual_cost_was_unknown = 1
            AND audit.authority = 'authenticated_operator'
            AND dispatch.state = 'settled_unknown'
            AND dispatch.provider_stage_id = 'visual-evidence'
            AND dispatch.actual_cost_micro_usd IS NULL
            AND dispatch.maximum_cost_micro_usd =
                  audit.conservative_charge_micro_usd
            AND instr(audit.dispatch_id, ':recovery:1') = 0
            AND stage.state = 'open'
            AND stage.reserved_micro_usd = 0
            AND stage.invoking_dispatch_id IS NULL
            AND stage.poison_dispatch_id IS NULL
            AND stage.settled_micro_usd < stage.budget_cap_micro_usd
            AND NOT EXISTS (
              SELECT 1
                FROM import_recipe_extractions AS recipe
               WHERE recipe.import_id = parent.id
                 AND recipe.acquisition_generation =
                       parent.acquisition_generation
            )
          LIMIT 2`
      )
      .bind(
        importId,
        acquisitionGeneration,
        PilotProviderBudgetStage,
        originalDispatchId
      )
      .first<{
        readonly original_dispatch_id: string;
        readonly source_media_sha256: string;
      }>()
  ).pipe(
    Effect.flatMap((candidate) =>
      candidate !== null &&
      typeof candidate.original_dispatch_id === "string" &&
      candidate.original_dispatch_id.length > 0 &&
      !candidate.original_dispatch_id.includes(":recovery:1") &&
      typeof candidate.source_media_sha256 === "string" &&
      /^[\da-f]{64}$/u.test(candidate.source_media_sha256)
        ? Effect.succeed(candidate)
        : Effect.fail(providerTerminalPersistenceError("recovery_not_allowed"))
    )
  );

const prepareSettledVisualRecovery = (
  database: AnyD1Database,
  input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly createdAt: ImportTimestamp;
    readonly importId: ImportId;
  },
  candidate: {
    readonly original_dispatch_id: string;
    readonly source_media_sha256: string;
  }
) => {
  const recoveryDispatchId = `${candidate.original_dispatch_id}:recovery:1`;
  return persistenceEffect(() =>
    database
      .prepare(
        `INSERT INTO pilot_provider_visual_recoveries (
           runtime_stage, import_id, acquisition_generation,
           original_dispatch_id, recovery_dispatch_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(runtime_stage, original_dispatch_id) DO NOTHING`
      )
      .bind(
        PilotProviderBudgetStage,
        input.importId,
        input.acquisitionGeneration,
        candidate.original_dispatch_id,
        recoveryDispatchId,
        DateTime.formatIso(input.createdAt)
      )
      .run()
  );
};

const prepareSettledVisualSecondRecovery = (
  database: AnyD1Database,
  input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly createdAt: ImportTimestamp;
    readonly importId: ImportId;
  },
  candidate: {
    readonly first_recovery_dispatch_id: string;
    readonly original_dispatch_id: string;
  }
) => {
  const recoveryDispatchId = `${candidate.original_dispatch_id}:recovery:2`;
  return persistenceEffect(() =>
    database
      .prepare(
        `INSERT INTO pilot_provider_visual_second_recoveries (
           runtime_stage, import_id, acquisition_generation,
           original_dispatch_id, first_recovery_dispatch_id,
           recovery_dispatch_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(runtime_stage, original_dispatch_id) DO NOTHING`
      )
      .bind(
        PilotProviderBudgetStage,
        input.importId,
        input.acquisitionGeneration,
        candidate.original_dispatch_id,
        candidate.first_recovery_dispatch_id,
        recoveryDispatchId,
        DateTime.formatIso(input.createdAt)
      )
      .run()
  );
};

export interface ProviderTerminalRecoveryRepository {
  readonly inspectSpeechUnknownRecoveryActivation: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly originalDispatchId: string;
    readonly recoveryDispatchId: string;
  }) => Effect.Effect<
    SpeechProviderRecoveryActivation,
    ProviderTerminalPersistenceError
  >;
  readonly prepareSpeechUnknownRecovery: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly createdAt: ImportTimestamp;
    readonly importId: ImportId;
    readonly originalDispatchId?: string;
  }) => Effect.Effect<SpeechProviderRecovery, ProviderTerminalPersistenceError>;
  readonly speechDispatchId: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
  }) => Effect.Effect<string, ProviderTerminalPersistenceError>;
  readonly prepareVisualUnknownRecovery: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly createdAt: ImportTimestamp;
    readonly importId: ImportId;
    readonly originalDispatchId: string;
  }) => Effect.Effect<VisualProviderRecovery, ProviderTerminalPersistenceError>;
  readonly visualDispatchId: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
  }) => Effect.Effect<string, ProviderTerminalPersistenceError>;
}

export const makeD1ProviderTerminalRecoveryRepository = (
  database: AnyD1Database,
  runtimeStage: unknown
): ProviderTerminalRecoveryRepository => ({
  inspectSpeechUnknownRecoveryActivation: (input) =>
    Effect.gen(function* inspectSpeechUnknownRecoveryActivation() {
      if (runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("stage_not_allowed")
        );
      }
      const recovery = yield* readRecovery(
        database,
        input.importId,
        input.acquisitionGeneration
      );
      if (
        recovery.originalDispatchId !== input.originalDispatchId ||
        recovery.recoveryDispatchId !== input.recoveryDispatchId
      ) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("recovery_not_allowed")
        );
      }
      return yield* assertSpeechRecoveryActivatable(database, {
        acquisitionGeneration: input.acquisitionGeneration,
        importId: input.importId,
        recovery,
      });
    }),
  prepareSpeechUnknownRecovery: (input) =>
    Effect.gen(function* prepareSpeechUnknownRecovery() {
      if (runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("stage_not_allowed")
        );
      }
      const existing = yield* readRecovery(
        database,
        input.importId,
        input.acquisitionGeneration
      ).pipe(
        Effect.map((recovery): SpeechProviderRecovery | null => recovery),
        Effect.catchTag(
          "ProviderTerminalPersistenceError",
          allowMissingRecovery
        )
      );
      if (existing !== null) {
        return input.originalDispatchId === undefined ||
          existing.originalDispatchId === input.originalDispatchId
          ? existing
          : yield* Effect.fail(
              providerTerminalPersistenceError("recovery_not_allowed")
            );
      }
      const settled = yield* readSettledRecoveryCandidate(
        database,
        input.importId,
        input.acquisitionGeneration
      ).pipe(
        Effect.catchTag(
          "ProviderTerminalPersistenceError",
          allowMissingRecovery
        )
      );
      if (settled !== null) {
        if (
          input.originalDispatchId !== undefined &&
          settled.original_dispatch_id !== input.originalDispatchId
        ) {
          return yield* Effect.fail(
            providerTerminalPersistenceError("recovery_not_allowed")
          );
        }
        const recoveryDispatchId = `${settled.original_dispatch_id}:recovery:1`;
        if (recoveryDispatchId.length > 100) {
          return yield* Effect.fail(
            providerTerminalPersistenceError("persistence_corrupt")
          );
        }
        yield* prepareSettledRecovery(database, input, settled);
        return yield* readRecovery(
          database,
          input.importId,
          input.acquisitionGeneration
        );
      }
      const poison = yield* persistenceEffect<{
        readonly poison_dispatch_id: string;
      } | null>(
        () =>
          database
            .prepare(
              `SELECT poison_dispatch_id
               FROM pilot_provider_stage_budget
              WHERE runtime_stage = ?
                AND state = 'poisoned'
                AND invoking_dispatch_id IS NULL`
            )
            .bind(PilotProviderBudgetStage)
            .first<{ readonly poison_dispatch_id: string }>() as PromiseLike<{
            readonly poison_dispatch_id: string;
          } | null>
      );
      if (
        poison === null ||
        typeof poison.poison_dispatch_id !== "string" ||
        poison.poison_dispatch_id.length === 0 ||
        poison.poison_dispatch_id.includes(":recovery:1")
      ) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("recovery_not_allowed")
        );
      }
      if (
        input.originalDispatchId !== undefined &&
        poison.poison_dispatch_id !== input.originalDispatchId
      ) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("recovery_not_allowed")
        );
      }
      const recoveryDispatchId = `${poison.poison_dispatch_id}:recovery:1`;
      if (recoveryDispatchId.length > 100) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("persistence_corrupt")
        );
      }
      yield* persistenceEffect(() =>
        database
          .prepare(
            `INSERT INTO pilot_provider_speech_recoveries (
               runtime_stage, import_id, acquisition_generation,
               original_dispatch_id, recovery_dispatch_id, created_at
             ) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(runtime_stage, original_dispatch_id) DO NOTHING`
          )
          .bind(
            PilotProviderBudgetStage,
            input.importId,
            input.acquisitionGeneration,
            poison.poison_dispatch_id,
            recoveryDispatchId,
            DateTime.formatIso(input.createdAt)
          )
          .run()
      );
      const recovery = yield* readRecovery(
        database,
        input.importId,
        input.acquisitionGeneration
      );
      if (recovery.originalDispatchId !== poison.poison_dispatch_id) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("persistence_corrupt")
        );
      }
      return recovery;
    }),
  prepareVisualUnknownRecovery: (input) =>
    Effect.gen(function* prepareVisualUnknownRecovery() {
      if (runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("stage_not_allowed")
        );
      }
      const existing = yield* readSettledVisualRecovery(
        database,
        input.importId,
        input.acquisitionGeneration
      ).pipe(
        Effect.map((recovery): VisualProviderRecovery | null => recovery),
        Effect.catchTag(
          "ProviderTerminalPersistenceError",
          allowMissingRecovery
        )
      );
      if (existing !== null) {
        if (existing.originalDispatchId === input.originalDispatchId) {
          return existing;
        }
        if (
          existing.recoveryDispatchId !== input.originalDispatchId ||
          !input.originalDispatchId.endsWith(":recovery:1")
        ) {
          return yield* Effect.fail(
            providerTerminalPersistenceError("recovery_not_allowed")
          );
        }
        const secondCandidate = yield* readSettledVisualSecondRecoveryCandidate(
          database,
          input.importId,
          input.acquisitionGeneration,
          input.originalDispatchId
        ).pipe(
          Effect.map(
            (
              value
            ): {
              readonly first_recovery_dispatch_id: string;
              readonly original_dispatch_id: string;
            } | null => value
          ),
          Effect.catchTag(
            "ProviderTerminalPersistenceError",
            allowMissingRecovery
          )
        );
        if (secondCandidate !== null) {
          const secondRecoveryDispatchId = `${secondCandidate.original_dispatch_id}:recovery:2`;
          if (secondRecoveryDispatchId.length > 100) {
            return yield* Effect.fail(
              providerTerminalPersistenceError("persistence_corrupt")
            );
          }
          yield* prepareSettledVisualSecondRecovery(
            database,
            input,
            secondCandidate
          );
        }
        const prepared = yield* readSettledVisualRecovery(
          database,
          input.importId,
          input.acquisitionGeneration
        );
        return prepared.originalDispatchId === input.originalDispatchId
          ? prepared
          : yield* Effect.fail(
              providerTerminalPersistenceError(
                secondCandidate === null
                  ? "recovery_not_allowed"
                  : "persistence_corrupt"
              )
            );
      }
      const candidate = yield* readSettledVisualRecoveryCandidate(
        database,
        input.importId,
        input.acquisitionGeneration,
        input.originalDispatchId
      ).pipe(
        Effect.map(
          (
            value
          ): {
            readonly original_dispatch_id: string;
            readonly source_media_sha256: string;
          } | null => value
        ),
        Effect.catchTag(
          "ProviderTerminalPersistenceError",
          allowMissingRecovery
        )
      );
      if (candidate === null) {
        return yield* readSettledVisualRecovery(
          database,
          input.importId,
          input.acquisitionGeneration
        );
      }
      const recoveryDispatchId = `${candidate.original_dispatch_id}:recovery:1`;
      if (recoveryDispatchId.length > 100) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("persistence_corrupt")
        );
      }
      yield* prepareSettledVisualRecovery(database, input, candidate);
      return yield* readSettledVisualRecovery(
        database,
        input.importId,
        input.acquisitionGeneration
      );
    }),
  speechDispatchId: (input) =>
    Effect.gen(function* readSpeechDispatchId() {
      if (runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("stage_not_allowed")
        );
      }
      const useOriginalDispatchId = (error: ProviderTerminalPersistenceError) =>
        error.code === "recovery_not_allowed"
          ? Effect.succeed(
              `speech:${input.importId}:${input.acquisitionGeneration}`
            )
          : Effect.fail(error);
      return yield* readRecovery(
        database,
        input.importId,
        input.acquisitionGeneration
      ).pipe(
        Effect.map(({ recoveryDispatchId }) => recoveryDispatchId),
        Effect.catchTag(
          "ProviderTerminalPersistenceError",
          useOriginalDispatchId
        )
      );
    }),
  visualDispatchId: (input) =>
    Effect.gen(function* readVisualDispatchId() {
      if (runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("stage_not_allowed")
        );
      }
      const useOriginalDispatchId = (error: ProviderTerminalPersistenceError) =>
        error.code === "recovery_not_allowed"
          ? Effect.succeed(
              `visual:${input.importId}:${input.acquisitionGeneration}`
            )
          : Effect.fail(error);
      return yield* readSettledVisualRecovery(
        database,
        input.importId,
        input.acquisitionGeneration
      ).pipe(
        Effect.map(({ recoveryDispatchId }) => recoveryDispatchId),
        Effect.catchTag(
          "ProviderTerminalPersistenceError",
          useOriginalDispatchId
        )
      );
    }),
});
