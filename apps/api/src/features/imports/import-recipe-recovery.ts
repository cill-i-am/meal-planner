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

export const RecipeRecoveryIdentity = Schema.Literals([
  "recovery:1",
  "recovery:2",
  "recovery:3",
  "recovery:4",
  "recovery:5",
]);
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
  recovery_ordinal: Schema.Literals([1, 2, 3, 4, 5]),
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
  readonly recoveryOrdinal: 1 | 2 | 3 | 4 | 5;
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
  originalExtractionFingerprint: string,
  recoveryIdentity: RecipeRecoveryIdentity = "recovery:1"
) =>
  sha256Text(
    JSON.stringify({
      originalExtractionFingerprint,
      recoveryIdentity,
    })
  );

const readRecipeRecovery = (
  database: AnyD1Database,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration,
  recoveryOrdinal: 1 | 2 | 3 | 4 | 5 = 1
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
            AND recovery_ordinal = ?
          UNION ALL
         SELECT runtime_stage, import_id, acquisition_generation,
                2 AS recovery_ordinal, 'recovery:2' AS recovery_identity,
                first_recovery_dispatch_id AS original_dispatch_id,
                recovery_dispatch_id, evidence_fingerprint,
                first_recovery_extraction_fingerprint
                  AS original_extraction_fingerprint,
                recovery_extraction_fingerprint, transcript_sha256,
                visual_manifest_sha256, evidence_references_json
           FROM pilot_provider_recipe_second_recoveries
          WHERE runtime_stage = ?
            AND import_id = ?
            AND acquisition_generation = ?
            AND ? = 2
          UNION ALL
         SELECT runtime_stage, import_id, acquisition_generation,
                3 AS recovery_ordinal, 'recovery:3' AS recovery_identity,
                second_recovery_dispatch_id AS original_dispatch_id,
                recovery_dispatch_id, evidence_fingerprint,
                second_recovery_extraction_fingerprint
                  AS original_extraction_fingerprint,
                recovery_extraction_fingerprint, transcript_sha256,
                visual_manifest_sha256, evidence_references_json
           FROM pilot_provider_recipe_third_recoveries
          WHERE runtime_stage = ?
            AND import_id = ?
            AND acquisition_generation = ?
            AND ? = 3
          UNION ALL
         SELECT runtime_stage, import_id, acquisition_generation,
                4 AS recovery_ordinal, 'recovery:4' AS recovery_identity,
                third_recovery_dispatch_id AS original_dispatch_id,
                recovery_dispatch_id, evidence_fingerprint,
                third_recovery_extraction_fingerprint
                  AS original_extraction_fingerprint,
                recovery_extraction_fingerprint, transcript_sha256,
                visual_manifest_sha256, evidence_references_json
           FROM pilot_provider_recipe_fourth_recoveries
          WHERE runtime_stage = ?
            AND import_id = ?
            AND acquisition_generation = ?
            AND ? = 4
          UNION ALL
         SELECT runtime_stage, import_id, acquisition_generation,
                5 AS recovery_ordinal, 'recovery:5' AS recovery_identity,
                fourth_recovery_dispatch_id AS original_dispatch_id,
                recovery_dispatch_id, evidence_fingerprint,
                fourth_recovery_extraction_fingerprint
                  AS original_extraction_fingerprint,
                recovery_extraction_fingerprint, transcript_sha256,
                visual_manifest_sha256, evidence_references_json
           FROM pilot_provider_recipe_fifth_recoveries
          WHERE runtime_stage = ?
            AND import_id = ?
            AND acquisition_generation = ?
            AND ? = 5`
      )
      .bind(
        PilotProviderBudgetStage,
        importId,
        acquisitionGeneration,
        recoveryOrdinal,
        PilotProviderBudgetStage,
        importId,
        acquisitionGeneration,
        recoveryOrdinal,
        PilotProviderBudgetStage,
        importId,
        acquisitionGeneration,
        recoveryOrdinal,
        PilotProviderBudgetStage,
        importId,
        acquisitionGeneration,
        recoveryOrdinal,
        PilotProviderBudgetStage,
        importId,
        acquisitionGeneration,
        recoveryOrdinal
      )
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

const readRecipeRecoveryForResume = (
  database: AnyD1Database,
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) =>
  persistenceEffect(() =>
    database
      .prepare(
        `SELECT recovery.runtime_stage, recovery.import_id,
                recovery.acquisition_generation, recovery.recovery_ordinal,
                recovery.recovery_identity, recovery.original_dispatch_id,
                recovery.recovery_dispatch_id, recovery.evidence_fingerprint,
                recovery.original_extraction_fingerprint,
                recovery.recovery_extraction_fingerprint,
                recovery.transcript_sha256,
                recovery.visual_manifest_sha256,
                recovery.evidence_references_json
           FROM pilot_provider_recipe_recoveries AS recovery
           JOIN recipe_imports AS parent
             ON parent.id = recovery.import_id
            AND parent.acquisition_generation =
                  recovery.acquisition_generation
           JOIN import_transcriptions AS transcript
             ON transcript.import_id = parent.id
            AND transcript.acquisition_generation =
                  parent.acquisition_generation
            AND transcript.state = 'transcribed'
            AND transcript.transcript_sha256 =
                  recovery.transcript_sha256
           JOIN import_visual_evidence AS visual
             ON visual.import_id = parent.id
            AND visual.acquisition_generation =
                  parent.acquisition_generation
            AND visual.state = 'completed'
            AND visual.manifest_sha256 =
                  recovery.visual_manifest_sha256
            AND visual.source_media_sha256 =
                  transcript.source_media_sha256
           JOIN pilot_provider_stage_budget AS stage
             ON stage.runtime_stage = recovery.runtime_stage
            AND stage.state = 'open'
            AND stage.reserved_micro_usd = 0
            AND stage.invoking_dispatch_id IS NULL
            AND stage.poison_dispatch_id IS NULL
            AND stage.settled_micro_usd + 100000 <=
                  stage.budget_cap_micro_usd
          WHERE recovery.runtime_stage = ?
            AND recovery.import_id = ?
            AND recovery.acquisition_generation = ?
            AND recovery.recovery_ordinal = 1
            AND recovery.recovery_identity = 'recovery:1'
            AND parent.status = 'transcribed'
            AND parent.status_code IS NULL
            AND parent.recovery_action IS NULL
            AND parent.evidence_references_json =
                  recovery.evidence_references_json
            AND NOT EXISTS (
              SELECT 1
                FROM import_recipe_extractions AS extraction
               WHERE extraction.extraction_fingerprint =
                     recovery.recovery_extraction_fingerprint
            )
            AND NOT EXISTS (
              SELECT 1
                FROM pilot_provider_budget_dispatches AS dispatch
               WHERE dispatch.runtime_stage = recovery.runtime_stage
                 AND dispatch.dispatch_id =
                       recovery.recovery_dispatch_id
            )`
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

const requireSecondRecoveryCandidate = (
  database: AnyD1Database,
  input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly firstRecoveryDispatchId: PilotBudgetDispatchId;
    readonly importId: ImportId;
  }
) =>
  persistenceEffect(() =>
    database
      .prepare(
        `SELECT 1 AS allowed
           FROM pilot_provider_recipe_recoveries AS recovery
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = recovery.runtime_stage
            AND dispatch.dispatch_id = recovery.recovery_dispatch_id
           JOIN pilot_provider_budget_reconciliations AS audit
             ON audit.runtime_stage = dispatch.runtime_stage
            AND audit.dispatch_id = dispatch.dispatch_id
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
             ON recovery_extraction.extraction_fingerprint =
                  recovery.recovery_extraction_fingerprint
            AND recovery_extraction.import_id = recovery.import_id
            AND recovery_extraction.acquisition_generation =
                  recovery.acquisition_generation
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
             ON parent.id = recovery.import_id
            AND parent.acquisition_generation =
                  recovery.acquisition_generation
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
            AND visual.manifest_sha256 =
                  recovery.visual_manifest_sha256
            AND visual.source_media_sha256 =
                  transcript.source_media_sha256
          WHERE recovery.runtime_stage = ?
            AND recovery.import_id = ?
            AND recovery.acquisition_generation = ?
            AND recovery.recovery_ordinal = 1
            AND recovery.recovery_identity = 'recovery:1'
            AND recovery.recovery_dispatch_id = ?
            AND dispatch.run_id =
                  'gaia-118:recipe-recovery:' || recovery.import_id
            AND dispatch.provider_stage_id = 'recipe-extraction'
            AND dispatch.state = 'settled_unknown'
            AND dispatch.actual_cost_micro_usd IS NULL
            AND dispatch.maximum_cost_micro_usd = 100000
            AND audit.actual_cost_was_unknown = 1
            AND audit.authority = 'authenticated_operator'
            AND audit.conservative_charge_micro_usd = 100000
            AND stage.state = 'open'
            AND stage.reserved_micro_usd = 0
            AND stage.invoking_dispatch_id IS NULL
            AND stage.poison_dispatch_id IS NULL
            AND stage.settled_micro_usd + 100000 <=
                  stage.budget_cap_micro_usd
            AND NOT EXISTS (
              SELECT 1
                FROM pilot_provider_recipe_replay_values AS replay
               WHERE replay.runtime_stage = recovery.runtime_stage
                 AND replay.dispatch_id = recovery.recovery_dispatch_id
            )`
      )
      .bind(
        PilotProviderBudgetStage,
        input.importId,
        input.acquisitionGeneration,
        input.firstRecoveryDispatchId
      )
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(persistenceError("recovery_not_allowed"))
        : Effect.void
    )
  );

const requireThirdRecoveryCandidate = (
  database: AnyD1Database,
  input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly secondRecoveryDispatchId: PilotBudgetDispatchId;
  }
) =>
  persistenceEffect(() =>
    database
      .prepare(
        `SELECT 1 AS allowed
           FROM pilot_provider_recipe_second_recoveries AS second_recovery
           JOIN pilot_provider_recipe_recoveries AS first_recovery
             ON first_recovery.runtime_stage =
                  second_recovery.runtime_stage
            AND first_recovery.import_id = second_recovery.import_id
            AND first_recovery.acquisition_generation =
                  second_recovery.acquisition_generation
            AND first_recovery.original_dispatch_id =
                  second_recovery.original_dispatch_id
            AND first_recovery.recovery_dispatch_id =
                  second_recovery.first_recovery_dispatch_id
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = second_recovery.runtime_stage
            AND dispatch.dispatch_id =
                  second_recovery.recovery_dispatch_id
           JOIN pilot_provider_budget_reconciliations AS audit
             ON audit.runtime_stage = dispatch.runtime_stage
            AND audit.dispatch_id = dispatch.dispatch_id
           JOIN pilot_provider_stage_budget AS stage
             ON stage.runtime_stage = dispatch.runtime_stage
           JOIN import_provider_terminal_checkpoints AS checkpoint
             ON checkpoint.import_id = second_recovery.import_id
            AND checkpoint.acquisition_generation =
                  second_recovery.acquisition_generation
            AND checkpoint.provider_stage = 'recipe'
            AND checkpoint.ownership_id =
                  first_recovery.original_extraction_fingerprint
            AND checkpoint.failure_code = 'outcome_unknown'
           JOIN import_recipe_extractions AS original_extraction
             ON original_extraction.extraction_fingerprint =
                  checkpoint.ownership_id
            AND original_extraction.import_id = checkpoint.import_id
            AND original_extraction.acquisition_generation =
                  checkpoint.acquisition_generation
            AND original_extraction.evidence_fingerprint =
                  second_recovery.evidence_fingerprint
            AND original_extraction.state = 'failed'
            AND original_extraction.failure_code = 'provider_error'
            AND original_extraction.completed_at = checkpoint.completed_at
           JOIN import_recipe_extractions AS second_extraction
             ON second_extraction.extraction_fingerprint =
                  second_recovery.recovery_extraction_fingerprint
            AND second_extraction.import_id = checkpoint.import_id
            AND second_extraction.acquisition_generation =
                  checkpoint.acquisition_generation
            AND second_extraction.evidence_fingerprint =
                  second_recovery.evidence_fingerprint
            AND second_extraction.state = 'failed'
            AND second_extraction.failure_code = 'provider_error'
            AND second_extraction.is_current = 0
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
                  second_recovery.evidence_references_json
            AND projection.evidence_references_json =
                  parent.evidence_references_json
           JOIN import_transcriptions AS transcript
             ON transcript.import_id = parent.id
            AND transcript.acquisition_generation =
                  parent.acquisition_generation
            AND transcript.state = 'transcribed'
            AND transcript.transcript_sha256 =
                  second_recovery.transcript_sha256
           JOIN import_visual_evidence AS visual
             ON visual.import_id = parent.id
            AND visual.acquisition_generation =
                  parent.acquisition_generation
            AND visual.state = 'completed'
            AND visual.manifest_sha256 =
                  second_recovery.visual_manifest_sha256
            AND visual.source_media_sha256 =
                  transcript.source_media_sha256
          WHERE second_recovery.runtime_stage = ?
            AND second_recovery.import_id = ?
            AND second_recovery.acquisition_generation = ?
            AND second_recovery.recovery_dispatch_id = ?
            AND dispatch.run_id =
                  'gaia-118:recipe-recovery:' ||
                  second_recovery.import_id
            AND dispatch.provider_stage_id = 'recipe-extraction'
            AND dispatch.state = 'settled_unknown'
            AND dispatch.actual_cost_micro_usd IS NULL
            AND dispatch.maximum_cost_micro_usd = 100000
            AND audit.actual_cost_was_unknown = 1
            AND audit.authority = 'authenticated_operator'
            AND audit.conservative_charge_micro_usd = 100000
            AND stage.state = 'open'
            AND stage.reserved_micro_usd = 0
            AND stage.invoking_dispatch_id IS NULL
            AND stage.poison_dispatch_id IS NULL
            AND stage.settled_micro_usd + 100000 <=
                  stage.budget_cap_micro_usd
            AND NOT EXISTS (
              SELECT 1
                FROM pilot_provider_recipe_replay_values AS replay
               WHERE replay.runtime_stage =
                     second_recovery.runtime_stage
                 AND replay.dispatch_id =
                     second_recovery.recovery_dispatch_id
            )`
      )
      .bind(
        PilotProviderBudgetStage,
        input.importId,
        input.acquisitionGeneration,
        input.secondRecoveryDispatchId
      )
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(persistenceError("recovery_not_allowed"))
        : Effect.void
    )
  );

const requireFourthRecoveryCandidate = (
  database: AnyD1Database,
  input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly thirdRecoveryDispatchId: PilotBudgetDispatchId;
  }
) =>
  persistenceEffect(() =>
    database
      .prepare(
        `SELECT 1 AS allowed
           FROM pilot_provider_recipe_third_recoveries AS third_recovery
           JOIN pilot_provider_recipe_second_recoveries AS second_recovery
             ON second_recovery.runtime_stage = third_recovery.runtime_stage
            AND second_recovery.import_id = third_recovery.import_id
            AND second_recovery.acquisition_generation =
                  third_recovery.acquisition_generation
            AND second_recovery.recovery_dispatch_id =
                  third_recovery.second_recovery_dispatch_id
           JOIN pilot_provider_recipe_recoveries AS first_recovery
             ON first_recovery.runtime_stage = third_recovery.runtime_stage
            AND first_recovery.import_id = third_recovery.import_id
            AND first_recovery.acquisition_generation =
                  third_recovery.acquisition_generation
            AND first_recovery.recovery_dispatch_id =
                  third_recovery.first_recovery_dispatch_id
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = third_recovery.runtime_stage
            AND dispatch.dispatch_id = third_recovery.recovery_dispatch_id
           JOIN pilot_provider_budget_reconciliations AS audit
             ON audit.runtime_stage = dispatch.runtime_stage
            AND audit.dispatch_id = dispatch.dispatch_id
           JOIN pilot_provider_stage_budget AS stage
             ON stage.runtime_stage = dispatch.runtime_stage
           JOIN import_provider_terminal_checkpoints AS checkpoint
             ON checkpoint.import_id = third_recovery.import_id
            AND checkpoint.acquisition_generation =
                  third_recovery.acquisition_generation
            AND checkpoint.provider_stage = 'recipe'
            AND checkpoint.ownership_id =
                  first_recovery.original_extraction_fingerprint
            AND checkpoint.failure_code = 'outcome_unknown'
           JOIN import_recipe_extractions AS original_extraction
             ON original_extraction.extraction_fingerprint =
                  checkpoint.ownership_id
            AND original_extraction.import_id = checkpoint.import_id
            AND original_extraction.acquisition_generation =
                  checkpoint.acquisition_generation
            AND original_extraction.evidence_fingerprint =
                  third_recovery.evidence_fingerprint
            AND original_extraction.state = 'failed'
            AND original_extraction.failure_code = 'provider_error'
            AND original_extraction.completed_at = checkpoint.completed_at
           JOIN import_recipe_extractions AS third_extraction
             ON third_extraction.extraction_fingerprint =
                  third_recovery.recovery_extraction_fingerprint
            AND third_extraction.import_id = checkpoint.import_id
            AND third_extraction.acquisition_generation =
                  checkpoint.acquisition_generation
            AND third_extraction.evidence_fingerprint =
                  third_recovery.evidence_fingerprint
            AND third_extraction.state = 'failed'
            AND third_extraction.failure_code = 'provider_error'
            AND third_extraction.is_current = 0
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
                  third_recovery.evidence_references_json
            AND projection.evidence_references_json =
                  parent.evidence_references_json
           JOIN import_transcriptions AS transcript
             ON transcript.import_id = parent.id
            AND transcript.acquisition_generation =
                  parent.acquisition_generation
            AND transcript.state = 'transcribed'
            AND transcript.transcript_sha256 =
                  third_recovery.transcript_sha256
           JOIN import_visual_evidence AS visual
             ON visual.import_id = parent.id
            AND visual.acquisition_generation =
                  parent.acquisition_generation
            AND visual.state = 'completed'
            AND visual.manifest_sha256 =
                  third_recovery.visual_manifest_sha256
            AND visual.source_media_sha256 =
                  transcript.source_media_sha256
          WHERE third_recovery.runtime_stage = ?
            AND third_recovery.import_id = ?
            AND third_recovery.acquisition_generation = ?
            AND third_recovery.recovery_dispatch_id = ?
            AND third_recovery.original_dispatch_id =
                  second_recovery.original_dispatch_id
            AND third_recovery.first_recovery_dispatch_id =
                  second_recovery.first_recovery_dispatch_id
            AND dispatch.run_id =
                  'gaia-118:recipe-recovery:' || third_recovery.import_id
            AND dispatch.provider_stage_id = 'recipe-extraction'
            AND dispatch.state = 'settled_unknown'
            AND dispatch.actual_cost_micro_usd IS NULL
            AND dispatch.maximum_cost_micro_usd = 100000
            AND audit.actual_cost_was_unknown = 1
            AND audit.authority = 'authenticated_operator'
            AND audit.conservative_charge_micro_usd = 100000
            AND stage.state = 'open'
            AND stage.reserved_micro_usd = 0
            AND stage.invoking_dispatch_id IS NULL
            AND stage.poison_dispatch_id IS NULL
            AND stage.settled_micro_usd + 100000 <=
                  stage.budget_cap_micro_usd
            AND NOT EXISTS (
              SELECT 1
                FROM pilot_provider_recipe_replay_values AS replay
               WHERE replay.runtime_stage = third_recovery.runtime_stage
                 AND replay.dispatch_id =
                     third_recovery.recovery_dispatch_id
            )`
      )
      .bind(
        PilotProviderBudgetStage,
        input.importId,
        input.acquisitionGeneration,
        input.thirdRecoveryDispatchId
      )
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(persistenceError("recovery_not_allowed"))
        : Effect.void
    )
  );

const requireFifthRecoveryCandidate = (
  database: AnyD1Database,
  input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly fourthRecoveryDispatchId: PilotBudgetDispatchId;
  }
) =>
  persistenceEffect(() =>
    database
      .prepare(
        `SELECT 1 AS allowed
           FROM pilot_provider_recipe_fourth_recoveries AS fourth_recovery
           JOIN pilot_provider_recipe_third_recoveries AS third_recovery
             ON third_recovery.runtime_stage = fourth_recovery.runtime_stage
            AND third_recovery.import_id = fourth_recovery.import_id
            AND third_recovery.acquisition_generation =
                  fourth_recovery.acquisition_generation
            AND third_recovery.recovery_dispatch_id =
                  fourth_recovery.third_recovery_dispatch_id
           JOIN pilot_provider_recipe_second_recoveries AS second_recovery
             ON second_recovery.runtime_stage = fourth_recovery.runtime_stage
            AND second_recovery.import_id = fourth_recovery.import_id
            AND second_recovery.acquisition_generation =
                  fourth_recovery.acquisition_generation
            AND second_recovery.recovery_dispatch_id =
                  fourth_recovery.second_recovery_dispatch_id
           JOIN pilot_provider_recipe_recoveries AS first_recovery
             ON first_recovery.runtime_stage = fourth_recovery.runtime_stage
            AND first_recovery.import_id = fourth_recovery.import_id
            AND first_recovery.acquisition_generation =
                  fourth_recovery.acquisition_generation
            AND first_recovery.recovery_dispatch_id =
                  fourth_recovery.first_recovery_dispatch_id
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = fourth_recovery.runtime_stage
            AND dispatch.dispatch_id = fourth_recovery.recovery_dispatch_id
           JOIN pilot_provider_budget_reconciliations AS audit
             ON audit.runtime_stage = dispatch.runtime_stage
            AND audit.dispatch_id = dispatch.dispatch_id
           JOIN pilot_provider_stage_budget AS stage
             ON stage.runtime_stage = dispatch.runtime_stage
           JOIN import_provider_terminal_checkpoints AS checkpoint
             ON checkpoint.import_id = fourth_recovery.import_id
            AND checkpoint.acquisition_generation =
                  fourth_recovery.acquisition_generation
            AND checkpoint.provider_stage = 'recipe'
            AND checkpoint.ownership_id =
                  first_recovery.original_extraction_fingerprint
            AND checkpoint.failure_code = 'outcome_unknown'
           JOIN import_recipe_extractions AS original_extraction
             ON original_extraction.extraction_fingerprint =
                  checkpoint.ownership_id
            AND original_extraction.import_id = checkpoint.import_id
            AND original_extraction.acquisition_generation =
                  checkpoint.acquisition_generation
            AND original_extraction.evidence_fingerprint =
                  fourth_recovery.evidence_fingerprint
            AND original_extraction.state = 'failed'
            AND original_extraction.failure_code = 'provider_error'
            AND original_extraction.completed_at = checkpoint.completed_at
           JOIN import_recipe_extractions AS fourth_extraction
             ON fourth_extraction.extraction_fingerprint =
                  fourth_recovery.recovery_extraction_fingerprint
            AND fourth_extraction.import_id = checkpoint.import_id
            AND fourth_extraction.acquisition_generation =
                  checkpoint.acquisition_generation
            AND fourth_extraction.evidence_fingerprint =
                  fourth_recovery.evidence_fingerprint
            AND fourth_extraction.state = 'failed'
            AND fourth_extraction.failure_code = 'provider_error'
            AND fourth_extraction.is_current = 0
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
                  fourth_recovery.evidence_references_json
            AND projection.evidence_references_json =
                  parent.evidence_references_json
           JOIN import_transcriptions AS transcript
             ON transcript.import_id = parent.id
            AND transcript.acquisition_generation =
                  parent.acquisition_generation
            AND transcript.state = 'transcribed'
            AND transcript.transcript_sha256 =
                  fourth_recovery.transcript_sha256
           JOIN import_visual_evidence AS visual
             ON visual.import_id = parent.id
            AND visual.acquisition_generation =
                  parent.acquisition_generation
            AND visual.state = 'completed'
            AND visual.manifest_sha256 =
                  fourth_recovery.visual_manifest_sha256
            AND visual.source_media_sha256 =
                  transcript.source_media_sha256
          WHERE fourth_recovery.runtime_stage = ?
            AND fourth_recovery.import_id = ?
            AND fourth_recovery.acquisition_generation = ?
            AND fourth_recovery.recovery_dispatch_id = ?
            AND fourth_recovery.original_dispatch_id =
                  second_recovery.original_dispatch_id
            AND fourth_recovery.first_recovery_dispatch_id =
                  second_recovery.first_recovery_dispatch_id
            AND fourth_recovery.original_dispatch_id =
                  third_recovery.original_dispatch_id
            AND fourth_recovery.first_recovery_dispatch_id =
                  third_recovery.first_recovery_dispatch_id
            AND third_recovery.original_dispatch_id =
                  second_recovery.original_dispatch_id
            AND third_recovery.first_recovery_dispatch_id =
                  second_recovery.first_recovery_dispatch_id
            AND dispatch.run_id =
                  'gaia-118:recipe-recovery:' || fourth_recovery.import_id
            AND dispatch.provider_stage_id = 'recipe-extraction'
            AND dispatch.state = 'settled_unknown'
            AND dispatch.actual_cost_micro_usd IS NULL
            AND dispatch.maximum_cost_micro_usd = 100000
            AND audit.actual_cost_was_unknown = 1
            AND audit.authority = 'authenticated_operator'
            AND audit.conservative_charge_micro_usd = 100000
            AND stage.state = 'open'
            AND stage.reserved_micro_usd = 0
            AND stage.invoking_dispatch_id IS NULL
            AND stage.poison_dispatch_id IS NULL
            AND stage.settled_micro_usd + 100000 <=
                  stage.budget_cap_micro_usd
            AND NOT EXISTS (
              SELECT 1
                FROM pilot_provider_recipe_replay_values AS replay
               WHERE replay.runtime_stage = fourth_recovery.runtime_stage
                 AND replay.dispatch_id =
                     fourth_recovery.recovery_dispatch_id
            )`
      )
      .bind(
        PilotProviderBudgetStage,
        input.importId,
        input.acquisitionGeneration,
        input.fourthRecoveryDispatchId
      )
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(persistenceError("recovery_not_allowed"))
        : Effect.void
    )
  );

export interface RecipeRecoveryRepositoryShape {
  readonly prepare: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly createdAt: ImportTimestamp;
    readonly importId: ImportId;
    readonly originalDispatchId: PilotBudgetDispatchId;
  }) => Effect.Effect<RecipeRecovery, RecipeRecoveryPersistenceError>;
  readonly prepareSecond: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly createdAt: ImportTimestamp;
    readonly firstRecoveryDispatchId: PilotBudgetDispatchId;
    readonly importId: ImportId;
  }) => Effect.Effect<RecipeRecovery, RecipeRecoveryPersistenceError>;
  readonly prepareThird: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly createdAt: ImportTimestamp;
    readonly importId: ImportId;
    readonly secondRecoveryDispatchId: PilotBudgetDispatchId;
  }) => Effect.Effect<RecipeRecovery, RecipeRecoveryPersistenceError>;
  readonly prepareFourth: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly createdAt: ImportTimestamp;
    readonly importId: ImportId;
    readonly thirdRecoveryDispatchId: PilotBudgetDispatchId;
  }) => Effect.Effect<RecipeRecovery, RecipeRecoveryPersistenceError>;
  readonly prepareFifth: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly createdAt: ImportTimestamp;
    readonly fourthRecoveryDispatchId: PilotBudgetDispatchId;
    readonly importId: ImportId;
  }) => Effect.Effect<RecipeRecovery, RecipeRecoveryPersistenceError>;
  readonly read: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly recoveryOrdinal?: 1 | 2 | 3 | 4 | 5;
  }) => Effect.Effect<RecipeRecovery, RecipeRecoveryPersistenceError>;
  readonly readResume: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
  }) => Effect.Effect<RecipeRecovery, RecipeRecoveryPersistenceError>;
}

export const makeD1RecipeRecoveryRepository = (
  database: AnyD1Database,
  runtimeStage: unknown
  // Recovery ordinals intentionally read in numeric order at this boundary.
  // oxlint-disable-next-line sort-keys
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
  prepareFourth: (input) =>
    Effect.gen(function* prepareFourthRecipeRecovery() {
      if (runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(persistenceError("stage_not_allowed"));
      }
      const third = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration,
        3
      );
      if (third.recoveryDispatchId !== input.thirdRecoveryDispatchId) {
        return yield* Effect.fail(persistenceError("recovery_not_allowed"));
      }
      const existing = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration,
        4
      ).pipe(
        Effect.map((recovery): RecipeRecovery | null => recovery),
        Effect.catchTag("RecipeRecoveryPersistenceError", (error) =>
          error.code === "recovery_not_allowed"
            ? Effect.succeed(null)
            : Effect.fail(error)
        )
      );
      if (existing !== null) {
        return existing.originalDispatchId === input.thirdRecoveryDispatchId
          ? existing
          : yield* Effect.fail(persistenceError("recovery_not_allowed"));
      }
      yield* requireFourthRecoveryCandidate(database, input);
      const thirdRecoverySuffix = ":recovery:3";
      const originalDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(
        third.recoveryDispatchId.endsWith(thirdRecoverySuffix)
          ? third.recoveryDispatchId.slice(0, -thirdRecoverySuffix.length)
          : null
      ).pipe(Effect.mapError(() => persistenceError("persistence_corrupt")));
      const firstRecoveryDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(`${originalDispatchId}:recovery:1`).pipe(
        Effect.mapError(() => persistenceError("persistence_corrupt"))
      );
      const secondRecoveryDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(`${originalDispatchId}:recovery:2`).pipe(
        Effect.mapError(() => persistenceError("persistence_corrupt"))
      );
      const recoveryDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(`${originalDispatchId}:recovery:4`).pipe(
        Effect.mapError(() => persistenceError("persistence_corrupt"))
      );
      const recoveryExtractionFingerprint =
        yield* recipeRecoveryExtractionFingerprint(
          third.recoveryExtractionFingerprint,
          "recovery:4"
        );
      yield* persistenceEffect(() =>
        database
          .prepare(
            `INSERT INTO pilot_provider_recipe_fourth_recoveries (
               runtime_stage, import_id, acquisition_generation,
               original_dispatch_id, first_recovery_dispatch_id,
               second_recovery_dispatch_id, third_recovery_dispatch_id,
               recovery_dispatch_id, evidence_fingerprint,
               third_recovery_extraction_fingerprint,
               recovery_extraction_fingerprint, transcript_sha256,
               visual_manifest_sha256, evidence_references_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(
               runtime_stage, import_id, acquisition_generation
             ) DO NOTHING`
          )
          .bind(
            PilotProviderBudgetStage,
            input.importId,
            input.acquisitionGeneration,
            originalDispatchId,
            firstRecoveryDispatchId,
            secondRecoveryDispatchId,
            third.recoveryDispatchId,
            recoveryDispatchId,
            third.evidenceFingerprint,
            third.recoveryExtractionFingerprint,
            recoveryExtractionFingerprint,
            third.transcriptSha256,
            third.visualManifestSha256,
            third.evidenceReferencesJson,
            DateTime.formatIso(input.createdAt)
          )
          .run()
      );
      const recovery = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration,
        4
      );
      return recovery.originalDispatchId === input.thirdRecoveryDispatchId
        ? recovery
        : yield* Effect.fail(persistenceError("persistence_corrupt"));
    }),
  prepareFifth: (input) =>
    Effect.gen(function* prepareFifthRecipeRecovery() {
      if (runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(persistenceError("stage_not_allowed"));
      }
      const fourth = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration,
        4
      );
      if (fourth.recoveryDispatchId !== input.fourthRecoveryDispatchId) {
        return yield* Effect.fail(persistenceError("recovery_not_allowed"));
      }
      const existing = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration,
        5
      ).pipe(
        Effect.map((recovery): RecipeRecovery | null => recovery),
        Effect.catchTag("RecipeRecoveryPersistenceError", (error) =>
          error.code === "recovery_not_allowed"
            ? Effect.succeed(null)
            : Effect.fail(error)
        )
      );
      if (existing !== null) {
        return existing.originalDispatchId === input.fourthRecoveryDispatchId
          ? existing
          : yield* Effect.fail(persistenceError("recovery_not_allowed"));
      }
      yield* requireFifthRecoveryCandidate(database, input);
      const fourthRecoverySuffix = ":recovery:4";
      const originalDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(
        fourth.recoveryDispatchId.endsWith(fourthRecoverySuffix)
          ? fourth.recoveryDispatchId.slice(0, -fourthRecoverySuffix.length)
          : null
      ).pipe(Effect.mapError(() => persistenceError("persistence_corrupt")));
      const firstRecoveryDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(`${originalDispatchId}:recovery:1`).pipe(
        Effect.mapError(() => persistenceError("persistence_corrupt"))
      );
      const secondRecoveryDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(`${originalDispatchId}:recovery:2`).pipe(
        Effect.mapError(() => persistenceError("persistence_corrupt"))
      );
      const thirdRecoveryDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(`${originalDispatchId}:recovery:3`).pipe(
        Effect.mapError(() => persistenceError("persistence_corrupt"))
      );
      const recoveryDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(`${originalDispatchId}:recovery:5`).pipe(
        Effect.mapError(() => persistenceError("persistence_corrupt"))
      );
      const recoveryExtractionFingerprint =
        yield* recipeRecoveryExtractionFingerprint(
          fourth.recoveryExtractionFingerprint,
          "recovery:5"
        );
      yield* persistenceEffect(() =>
        database
          .prepare(
            `INSERT INTO pilot_provider_recipe_fifth_recoveries (
               runtime_stage, import_id, acquisition_generation,
               original_dispatch_id, first_recovery_dispatch_id,
               second_recovery_dispatch_id, third_recovery_dispatch_id,
               fourth_recovery_dispatch_id,
               recovery_dispatch_id, evidence_fingerprint,
               fourth_recovery_extraction_fingerprint,
               recovery_extraction_fingerprint, transcript_sha256,
               visual_manifest_sha256, evidence_references_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(
               runtime_stage, import_id, acquisition_generation
             ) DO NOTHING`
          )
          .bind(
            PilotProviderBudgetStage,
            input.importId,
            input.acquisitionGeneration,
            originalDispatchId,
            firstRecoveryDispatchId,
            secondRecoveryDispatchId,
            thirdRecoveryDispatchId,
            fourth.recoveryDispatchId,
            recoveryDispatchId,
            fourth.evidenceFingerprint,
            fourth.recoveryExtractionFingerprint,
            recoveryExtractionFingerprint,
            fourth.transcriptSha256,
            fourth.visualManifestSha256,
            fourth.evidenceReferencesJson,
            DateTime.formatIso(input.createdAt)
          )
          .run()
      );
      const recovery = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration,
        5
      );
      return recovery.originalDispatchId === input.fourthRecoveryDispatchId
        ? recovery
        : yield* Effect.fail(persistenceError("persistence_corrupt"));
    }),
  prepareSecond: (input) =>
    Effect.gen(function* prepareSecondRecipeRecovery() {
      if (runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(persistenceError("stage_not_allowed"));
      }
      const first = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration,
        1
      );
      if (first.recoveryDispatchId !== input.firstRecoveryDispatchId) {
        return yield* Effect.fail(persistenceError("recovery_not_allowed"));
      }
      const existing = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration,
        2
      ).pipe(
        Effect.map((recovery): RecipeRecovery | null => recovery),
        Effect.catchTag("RecipeRecoveryPersistenceError", (error) =>
          error.code === "recovery_not_allowed"
            ? Effect.succeed(null)
            : Effect.fail(error)
        )
      );
      if (existing !== null) {
        return existing.originalDispatchId === input.firstRecoveryDispatchId
          ? existing
          : yield* Effect.fail(persistenceError("recovery_not_allowed"));
      }
      yield* requireSecondRecoveryCandidate(database, input);
      const recoveryDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(`${first.originalDispatchId}:recovery:2`).pipe(
        Effect.mapError(() => persistenceError("persistence_corrupt"))
      );
      const recoveryExtractionFingerprint =
        yield* recipeRecoveryExtractionFingerprint(
          first.recoveryExtractionFingerprint,
          "recovery:2"
        );
      yield* persistenceEffect(() =>
        database
          .prepare(
            `INSERT INTO pilot_provider_recipe_second_recoveries (
               runtime_stage, import_id, acquisition_generation,
               original_dispatch_id, first_recovery_dispatch_id,
               recovery_dispatch_id, evidence_fingerprint,
               first_recovery_extraction_fingerprint,
               recovery_extraction_fingerprint, transcript_sha256,
               visual_manifest_sha256, evidence_references_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(
               runtime_stage, import_id, acquisition_generation
             ) DO NOTHING`
          )
          .bind(
            PilotProviderBudgetStage,
            input.importId,
            input.acquisitionGeneration,
            first.originalDispatchId,
            first.recoveryDispatchId,
            recoveryDispatchId,
            first.evidenceFingerprint,
            first.recoveryExtractionFingerprint,
            recoveryExtractionFingerprint,
            first.transcriptSha256,
            first.visualManifestSha256,
            first.evidenceReferencesJson,
            DateTime.formatIso(input.createdAt)
          )
          .run()
      );
      const recovery = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration,
        2
      );
      if (recovery.originalDispatchId === input.firstRecoveryDispatchId) {
        return recovery;
      }
      return yield* Effect.fail(persistenceError("persistence_corrupt"));
    }),
  prepareThird: (input) =>
    Effect.gen(function* prepareThirdRecipeRecovery() {
      if (runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(persistenceError("stage_not_allowed"));
      }
      const second = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration,
        2
      );
      if (second.recoveryDispatchId !== input.secondRecoveryDispatchId) {
        return yield* Effect.fail(persistenceError("recovery_not_allowed"));
      }
      const existing = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration,
        3
      ).pipe(
        Effect.map((recovery): RecipeRecovery | null => recovery),
        Effect.catchTag("RecipeRecoveryPersistenceError", (error) =>
          error.code === "recovery_not_allowed"
            ? Effect.succeed(null)
            : Effect.fail(error)
        )
      );
      if (existing !== null) {
        return existing.originalDispatchId === input.secondRecoveryDispatchId
          ? existing
          : yield* Effect.fail(persistenceError("recovery_not_allowed"));
      }
      yield* requireThirdRecoveryCandidate(database, input);
      const secondRecoverySuffix = ":recovery:2";
      const originalDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(
        second.recoveryDispatchId.endsWith(secondRecoverySuffix)
          ? second.recoveryDispatchId.slice(0, -secondRecoverySuffix.length)
          : null
      ).pipe(Effect.mapError(() => persistenceError("persistence_corrupt")));
      const firstRecoveryDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(`${originalDispatchId}:recovery:1`).pipe(
        Effect.mapError(() => persistenceError("persistence_corrupt"))
      );
      const recoveryDispatchId = yield* Schema.decodeUnknownEffect(
        PilotBudgetDispatchId
      )(`${originalDispatchId}:recovery:3`).pipe(
        Effect.mapError(() => persistenceError("persistence_corrupt"))
      );
      const recoveryExtractionFingerprint =
        yield* recipeRecoveryExtractionFingerprint(
          second.recoveryExtractionFingerprint,
          "recovery:3"
        );
      yield* persistenceEffect(() =>
        database
          .prepare(
            `INSERT INTO pilot_provider_recipe_third_recoveries (
               runtime_stage, import_id, acquisition_generation,
               original_dispatch_id, first_recovery_dispatch_id,
               second_recovery_dispatch_id, recovery_dispatch_id,
               evidence_fingerprint,
               second_recovery_extraction_fingerprint,
               recovery_extraction_fingerprint, transcript_sha256,
               visual_manifest_sha256, evidence_references_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(
               runtime_stage, import_id, acquisition_generation
             ) DO NOTHING`
          )
          .bind(
            PilotProviderBudgetStage,
            input.importId,
            input.acquisitionGeneration,
            originalDispatchId,
            firstRecoveryDispatchId,
            second.recoveryDispatchId,
            recoveryDispatchId,
            second.evidenceFingerprint,
            second.recoveryExtractionFingerprint,
            recoveryExtractionFingerprint,
            second.transcriptSha256,
            second.visualManifestSha256,
            second.evidenceReferencesJson,
            DateTime.formatIso(input.createdAt)
          )
          .run()
      );
      const recovery = yield* readRecipeRecovery(
        database,
        input.importId,
        input.acquisitionGeneration,
        3
      );
      return recovery.originalDispatchId === input.secondRecoveryDispatchId
        ? recovery
        : yield* Effect.fail(persistenceError("persistence_corrupt"));
    }),
  read: (input) =>
    runtimeStage === PilotProviderBudgetStage
      ? readRecipeRecovery(
          database,
          input.importId,
          input.acquisitionGeneration,
          input.recoveryOrdinal
        )
      : Effect.fail(persistenceError("stage_not_allowed")),
  readResume: (input) =>
    runtimeStage === PilotProviderBudgetStage
      ? readRecipeRecoveryForResume(
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
  recoveryOrdinal: Schema.Literals([1, 2, 3, 4, 5]),
  resumeOrdinal: Schema.optionalKey(Schema.Literal(1)),
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
  readonly resume: (
    recovery: RecipeRecovery
  ) => Effect.Effect<void, WorkflowStartUnavailable>;
  readonly start: (
    recovery: RecipeRecovery
  ) => Effect.Effect<void, WorkflowStartUnavailable>;
}

export const recipeRecoveryWorkflowInstanceId = (
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration,
  recoveryOrdinal: 1 | 2 | 3 | 4 | 5 = 1
) =>
  `import-recipe-recovery-${importId}-${acquisitionGeneration}-${recoveryOrdinal}`;

export const recipeRecoveryResumeWorkflowInstanceId = (
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration,
  recoveryOrdinal: 1 | 2 | 3 | 4 | 5 = 1
) =>
  `${recipeRecoveryWorkflowInstanceId(importId, acquisitionGeneration, recoveryOrdinal)}-resume-1`;

export const makeRecipeRecoveryWorkflowStarter = (
  workflow: WorkflowHandleLike,
  newCorrelationId: () => ImportCorrelationId = makeImportCorrelationId
): RecipeRecoveryWorkflowStarterShape => {
  const start = (
    recovery: RecipeRecovery,
    resume: boolean
  ): Effect.Effect<void, WorkflowStartUnavailable> => {
    const id = resume
      ? recipeRecoveryResumeWorkflowInstanceId(
          recovery.importId,
          recovery.acquisitionGeneration,
          recovery.recoveryOrdinal
        )
      : recipeRecoveryWorkflowInstanceId(
          recovery.importId,
          recovery.acquisitionGeneration,
          recovery.recoveryOrdinal
        );
    const params = Schema.decodeUnknownSync(RecipeRecoveryWorkflowInput)({
      acquisitionGeneration: recovery.acquisitionGeneration,
      correlationId: newCorrelationId(),
      importId: recovery.importId,
      recoveryOrdinal: recovery.recoveryOrdinal,
      ...(resume ? { resumeOrdinal: 1 as const } : {}),
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
  };
  return {
    resume: (recovery) => start(recovery, true),
    start: (recovery) => start(recovery, false),
  };
};
