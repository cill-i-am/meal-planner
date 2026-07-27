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

const readRecovery = (
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

export interface ProviderTerminalRecoveryRepository {
  readonly prepareSpeechUnknownRecovery: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly createdAt: ImportTimestamp;
    readonly importId: ImportId;
  }) => Effect.Effect<SpeechProviderRecovery, ProviderTerminalPersistenceError>;
  readonly speechDispatchId: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
  }) => Effect.Effect<string, ProviderTerminalPersistenceError>;
}

export const makeD1ProviderTerminalRecoveryRepository = (
  database: AnyD1Database,
  runtimeStage: unknown
): ProviderTerminalRecoveryRepository => ({
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
        Effect.catchTag("ProviderTerminalPersistenceError", (error) =>
          error.code === "recovery_not_allowed"
            ? Effect.succeed(null)
            : Effect.fail(error)
        )
      );
      if (existing !== null) {
        return existing;
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
        poison.poison_dispatch_id.length === 0
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
  speechDispatchId: (input) =>
    Effect.gen(function* readSpeechDispatchId() {
      if (runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(
          providerTerminalPersistenceError("stage_not_allowed")
        );
      }
      return yield* readRecovery(
        database,
        input.importId,
        input.acquisitionGeneration
      ).pipe(
        Effect.map(({ recoveryDispatchId }) => recoveryDispatchId),
        Effect.catchTag("ProviderTerminalPersistenceError", (error) =>
          error.code === "recovery_not_allowed"
            ? Effect.succeed(
                `speech:${input.importId}:${input.acquisitionGeneration}`
              )
            : Effect.fail(error)
        )
      );
    }),
});
