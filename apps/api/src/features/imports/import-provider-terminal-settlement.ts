import type { AnyD1Database } from "drizzle-orm/d1";
import { Context, DateTime, Effect, Schema } from "effect";

import {
  PilotBudgetDispatchId,
  PilotProviderBudgetStage,
} from "../pilots/pilot-provider-budget.js";
import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import type { ImportTraceContext } from "./import-observability.js";
import {
  hasHouseholdProviderRecoveryProgress,
  prepareHouseholdProviderRecovery,
  prepareHouseholdRecipeRecovery,
  readHouseholdRecipeRecovery,
  readHouseholdTerminalAuthority,
  resolveHouseholdRecoveryAuthority,
} from "./import-recipe-recovery.household.js";
import type { RecipeRecoveryPreparationHouseholdAuthority } from "./import-recipe-recovery.household.js";
import { RecipeRecoveryOrdinal } from "./import-recipe-recovery.js";
import type { RecipeRecoveryWorkflowStarter } from "./import-recipe-recovery.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import type { ImportWorkflowStarter } from "./import.workflow.js";

const terminalRequest = {
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  executionGeneration: ImportIntentExecutionGeneration,
  importId: ImportId,
};
const TerminalUnknownSettlementRequest = Schema.Struct(terminalRequest);
const SpeechRecoveryActivationRequest = Schema.Struct({
  ...terminalRequest,
  operation: Schema.Literal("prepare_speech_recovery"),
});
const VisualRecoveryPreparationRequest = Schema.Struct({
  ...terminalRequest,
  operation: Schema.Literal("prepare_visual_recovery"),
});
const VisualTerminalUnknownSettlementRequest = Schema.Struct({
  ...terminalRequest,
  operation: Schema.Literal("settle_visual_unknown"),
});
const RecipeTerminalUnknownSettlementRequest = Schema.Struct({
  ...terminalRequest,
  operation: Schema.Literal("settle_recipe_unknown"),
});
const RecipeRecoveryUnknownSettlementRequest = Schema.Struct({
  ...terminalRequest,
  operation: Schema.Literal("settle_recipe_recovery_unknown"),
});
const RecipeRecoveryPreparationRequest = Schema.Struct({
  ...terminalRequest,
  operation: Schema.Literal("prepare_recipe_recovery"),
});
const RecipeRecoveryResumeRequest = Schema.Struct({
  ...terminalRequest,
  operation: Schema.Literal("resume_recipe_recovery"),
});
const ExpiredRecipeReplaySweepRequest = Schema.Struct({
  operation: Schema.Literal("sweep_expired_recipe_replays"),
});

export const ProviderTerminalSettlementRequest = Schema.Union([
  TerminalUnknownSettlementRequest,
  SpeechRecoveryActivationRequest,
  VisualRecoveryPreparationRequest,
  VisualTerminalUnknownSettlementRequest,
  RecipeTerminalUnknownSettlementRequest,
  RecipeRecoveryUnknownSettlementRequest,
  RecipeRecoveryPreparationRequest,
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
const baseSettlementResponse = {
  acquisitionGeneration: AcquisitionGeneration,
  conservativeChargeMicroUsd: ConservativeChargeMicroUsd,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
};
const TerminalUnknownSettlementResponse = Schema.Struct({
  ...baseSettlementResponse,
  outcome: Schema.Literal("terminal_unknown_cost_settled"),
});
const VisualTerminalUnknownSettlementResponse = Schema.Struct({
  ...baseSettlementResponse,
  outcome: Schema.Literal("visual_terminal_unknown_cost_settled"),
});
const RecipeTerminalUnknownSettlementResponse = Schema.Struct({
  ...baseSettlementResponse,
  conservativeChargeMicroUsd: Schema.Literal(100_000),
  outcome: Schema.Literal("recipe_terminal_unknown_cost_settled"),
});
const RecipeRecoveryUnknownSettlementResponse = Schema.Struct({
  ...baseSettlementResponse,
  conservativeChargeMicroUsd: Schema.Literal(100_000),
  outcome: Schema.Literal("recipe_recovery_unknown_cost_settled"),
});
const SpeechRecoveryActivationResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("speech_recovery_activated"),
  recoveryDispatchId: PilotBudgetDispatchId,
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});
const VisualRecoveryActivationResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("visual_recovery_activated"),
  recoveryDispatchId: PilotBudgetDispatchId,
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});
const RecipeRecoveryPreparationResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("recipe_recovery_prepared"),
  recoveryDispatchId: PilotBudgetDispatchId,
  recoveryExtractionFingerprint: Sha256Hex,
  recoveryOrdinal: RecipeRecoveryOrdinal,
  runtimeStage: Schema.Literal(PilotProviderBudgetStage),
});
const RecipeRecoveryResumeResponse = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: PilotBudgetDispatchId,
  importId: ImportId,
  outcome: Schema.Literal("recipe_recovery_resumed"),
  recoveryDispatchId: PilotBudgetDispatchId,
  recoveryExtractionFingerprint: Sha256Hex,
  recoveryOrdinal: RecipeRecoveryOrdinal,
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
  VisualRecoveryActivationResponse,
  VisualTerminalUnknownSettlementResponse,
  RecipeTerminalUnknownSettlementResponse,
  RecipeRecoveryUnknownSettlementResponse,
  RecipeRecoveryPreparationResponse,
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
const failure = (
  code: ProviderTerminalSettlementErrorCode
): ProviderTerminalSettlementError => ({
  _tag: "ProviderTerminalSettlementError",
  code,
});
const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: () => failure("persistence_unavailable"),
    try: () => Promise.resolve(operation()),
  });
const mapHouseholdError = (error: {
  readonly _tag: "ImportPersistenceUnavailable" | "ImportTransitionRejected";
}) =>
  failure(
    error._tag === "ImportPersistenceUnavailable"
      ? "persistence_unavailable"
      : "not_allowed"
  );

const GlobalSettlementRow = Schema.Struct({
  acquisition_generation: AcquisitionGeneration,
  authority: Schema.Literal("authenticated_operator"),
  conservative_charge_micro_usd: ConservativeChargeMicroUsd,
  created_at: ImportTimestamp,
  dispatch_id: PilotBudgetDispatchId,
  import_id: ImportId,
  runtime_stage: Schema.Literal(PilotProviderBudgetStage),
});
interface GlobalSettlementInput {
  readonly acquisitionGeneration: typeof AcquisitionGeneration.Type;
  readonly dispatchId: typeof PilotBudgetDispatchId.Type;
  readonly executionGeneration: typeof ImportIntentExecutionGeneration.Type;
  readonly importId: typeof ImportId.Type;
}
interface GlobalSettlementIdentity {
  readonly chargeMicroUsd?: 100_000;
  readonly providerStageId:
    | "recipe-extraction"
    | "speech-transcription"
    | "visual-evidence";
  readonly runId: string;
}

const readGlobalSettlement = (
  database: AnyD1Database,
  input: GlobalSettlementInput,
  identity: GlobalSettlementIdentity
) =>
  persistenceEffect<unknown | null>(() =>
    database
      .prepare(
        `SELECT audit.runtime_stage, audit.dispatch_id,
                audit.conservative_charge_micro_usd, audit.authority,
                audit.created_at,
                ? AS import_id, ? AS acquisition_generation
           FROM pilot_provider_budget_reconciliations AS audit
           JOIN pilot_provider_budget_dispatches AS dispatch
             ON dispatch.runtime_stage = audit.runtime_stage
            AND dispatch.dispatch_id = audit.dispatch_id
           JOIN pilot_provider_stage_budget AS stage
             ON stage.runtime_stage = audit.runtime_stage
          WHERE audit.runtime_stage = ? AND audit.dispatch_id = ?
            AND audit.actual_cost_was_unknown = 1
            AND audit.authority = 'authenticated_operator'
            AND dispatch.state = 'settled_unknown'
            AND dispatch.provider_stage_id = ? AND dispatch.run_id = ?
            AND dispatch.actual_cost_micro_usd IS NULL
            AND dispatch.maximum_cost_micro_usd = audit.conservative_charge_micro_usd
            AND (? IS NULL OR audit.conservative_charge_micro_usd = ?)
            AND stage.state = 'open' AND stage.reserved_micro_usd = 0
            AND stage.invoking_dispatch_id IS NULL
            AND stage.poison_dispatch_id IS NULL`
      )
      .bind(
        input.importId,
        input.acquisitionGeneration,
        PilotProviderBudgetStage,
        input.dispatchId,
        identity.providerStageId,
        identity.runId,
        identity.chargeMicroUsd ?? null,
        identity.chargeMicroUsd ?? null
      )
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(failure("not_allowed"))
        : Schema.decodeUnknownEffect(GlobalSettlementRow, {
            onExcessProperty: "ignore",
          })(row).pipe(Effect.mapError(() => failure("persistence_corrupt")))
    )
  );

const settleGlobalUnknown = (
  database: AnyD1Database,
  input: GlobalSettlementInput,
  identity: GlobalSettlementIdentity,
  settledAt: typeof ImportTimestamp.Type
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
            WHERE stage.runtime_stage = ? AND stage.state = 'poisoned'
              AND stage.poison_dispatch_id = ?
              AND stage.invoking_dispatch_id IS NULL
              AND stage.reserved_micro_usd = dispatch.maximum_cost_micro_usd
              AND stage.settled_micro_usd + stage.reserved_micro_usd <= stage.budget_cap_micro_usd
              AND dispatch.state = 'settled_unknown'
              AND dispatch.provider_stage_id = ? AND dispatch.run_id = ?
              AND dispatch.actual_cost_micro_usd IS NULL
              AND (? IS NULL OR dispatch.maximum_cost_micro_usd = ?)
           ON CONFLICT(runtime_stage, dispatch_id) DO NOTHING`
        )
        .bind(
          timestamp,
          PilotProviderBudgetStage,
          input.dispatchId,
          identity.providerStageId,
          identity.runId,
          identity.chargeMicroUsd ?? null,
          identity.chargeMicroUsd ?? null
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
            WHERE runtime_stage = ? AND state = 'poisoned'
              AND poison_dispatch_id = ? AND invoking_dispatch_id IS NULL
              AND EXISTS (
                SELECT 1
                  FROM pilot_provider_budget_dispatches AS dispatch
                  JOIN pilot_provider_budget_reconciliations AS audit
                    ON audit.runtime_stage = dispatch.runtime_stage
                   AND audit.dispatch_id = dispatch.dispatch_id
                 WHERE dispatch.runtime_stage = ? AND dispatch.dispatch_id = ?
                   AND dispatch.state = 'settled_unknown'
                   AND dispatch.provider_stage_id = ? AND dispatch.run_id = ?
                   AND dispatch.actual_cost_micro_usd IS NULL
                   AND dispatch.maximum_cost_micro_usd = audit.conservative_charge_micro_usd
                   AND audit.actual_cost_was_unknown = 1
                   AND audit.authority = 'authenticated_operator'
                   AND (? IS NULL OR audit.conservative_charge_micro_usd = ?)
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
          identity.providerStageId,
          identity.runId,
          identity.chargeMicroUsd ?? null,
          identity.chargeMicroUsd ?? null
        ),
    ])
  ).pipe(Effect.flatMap(() => readGlobalSettlement(database, input, identity)));
};

const D1MutationResult = Schema.Struct({
  meta: Schema.Struct({
    changes: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
});
const sweepExpiredRecipeReplays = (database: AnyD1Database) =>
  persistenceEffect<unknown>(() =>
    database
      .prepare(
        `DELETE FROM pilot_provider_recipe_replay_values
          WHERE runtime_stage = ?
            AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
      )
      .bind(PilotProviderBudgetStage)
      .run()
  ).pipe(
    Effect.flatMap((result) =>
      Schema.decodeUnknownEffect(D1MutationResult, {
        onExcessProperty: "ignore",
      })(result).pipe(Effect.mapError(() => failure("persistence_corrupt")))
    ),
    Effect.map(
      (result): ProviderTerminalSettlementResponse => ({
        deletedCount: result.meta.changes,
        outcome: "expired_recipe_replays_swept",
        runtimeStage: PilotProviderBudgetStage,
      })
    )
  );

export interface ProviderTerminalSettlementService {
  readonly settle: (
    input: ProviderTerminalSettlementRequest
  ) => Effect.Effect<
    ProviderTerminalSettlementResponse,
    ProviderTerminalSettlementError
  >;
}
export const ProviderTerminalSettlementService =
  Context.Service<ProviderTerminalSettlementService>(
    "meal-planner/ProviderTerminalSettlementService"
  );
interface ProviderTerminalSettlementServiceInput {
  readonly database: AnyD1Database;
  readonly householdDomain?: RecipeRecoveryPreparationHouseholdAuthority;
  readonly now: () => typeof ImportTimestamp.Type;
  readonly runtimeStage: string;
  readonly recipeRecoveryStarter?: RecipeRecoveryWorkflowStarter;
  readonly workflowStarter?: Pick<
    ImportWorkflowStarter,
    "restartFromSpeech" | "restartFromVisual"
  >;
  readonly trace: ImportTraceContext;
}

const standardRunId = (importId: typeof ImportId.Type) =>
  `gaia-118:${importId}`;
const recoveryRunId = (importId: typeof ImportId.Type) =>
  `gaia-118:recipe-recovery:${importId}`;
const validateHouseholdTerminal = (
  service: ProviderTerminalSettlementServiceInput,
  request: GlobalSettlementInput,
  stage: "extraction" | "speech" | "visual"
) =>
  service.householdDomain === undefined
    ? Effect.fail(failure("persistence_unavailable"))
    : readHouseholdTerminalAuthority({
        acquisitionGeneration: request.acquisitionGeneration,
        database: service.database,
        executionGeneration: request.executionGeneration,
        householdDomain: service.householdDomain,
        importId: request.importId,
        providerDispatchId: request.dispatchId,
        stage,
      }).pipe(Effect.mapError(mapHouseholdError));

const settleAndProject = (
  service: ProviderTerminalSettlementServiceInput,
  request: GlobalSettlementInput,
  stage: "extraction" | "speech" | "visual",
  identity: GlobalSettlementIdentity,
  outcome:
    | "recipe_recovery_unknown_cost_settled"
    | "recipe_terminal_unknown_cost_settled"
    | "terminal_unknown_cost_settled"
    | "visual_terminal_unknown_cost_settled"
) =>
  Effect.gen(function* settleHouseholdAuthorizedGlobalCost() {
    yield* validateHouseholdTerminal(service, request, stage);
    const row = yield* settleGlobalUnknown(
      service.database,
      request,
      identity,
      service.now()
    );
    const response = {
      acquisitionGeneration: row.acquisition_generation,
      conservativeChargeMicroUsd: row.conservative_charge_micro_usd,
      dispatchId: row.dispatch_id,
      importId: row.import_id,
      outcome,
      runtimeStage: row.runtime_stage,
    };
    return yield* Schema.decodeUnknownEffect(
      ProviderTerminalSettlementResponse
    )(response).pipe(Effect.mapError(() => failure("persistence_corrupt")));
  });

const prepareProviderRecovery = (
  service: ProviderTerminalSettlementServiceInput,
  request:
    | typeof SpeechRecoveryActivationRequest.Type
    | typeof VisualRecoveryPreparationRequest.Type,
  stage: "speech" | "visual"
) =>
  Effect.gen(function* prepareHouseholdOwnedProviderRecovery() {
    const { householdDomain } = service;
    if (householdDomain === undefined) {
      return yield* Effect.fail(failure("persistence_unavailable"));
    }
    const identity: GlobalSettlementIdentity = {
      providerStageId:
        stage === "speech" ? "speech-transcription" : "visual-evidence",
      runId: standardRunId(request.importId),
    };
    const settlement = yield* readGlobalSettlement(
      service.database,
      request,
      identity
    );
    const recovery = yield* prepareHouseholdProviderRecovery({
      acquisitionGeneration: request.acquisitionGeneration,
      database: service.database,
      executionGeneration: request.executionGeneration,
      householdDomain,
      importId: request.importId,
      originalDispatchId: request.dispatchId,
      settlement: {
        completedAt: settlement.created_at,
        dispatchId: settlement.dispatch_id,
        outcome: "settled_unknown",
      },
      stage,
    }).pipe(Effect.mapError(mapHouseholdError));
    if (recovery.requiresWorkflowActivation) {
      const restart =
        stage === "speech"
          ? service.workflowStarter?.restartFromSpeech
          : service.workflowStarter?.restartFromVisual;
      if (restart === undefined) {
        return yield* Effect.fail(failure("persistence_unavailable"));
      }
      const restartOutcome = yield* restart(recovery.workflowIdentity).pipe(
        Effect.catchCause(() =>
          hasHouseholdProviderRecoveryProgress({
            acquisitionGeneration: request.acquisitionGeneration,
            database: service.database,
            executionGeneration: request.executionGeneration,
            householdDomain,
            importId: request.importId,
            inputFingerprint: recovery.inputFingerprint,
            recoveryDispatchId: recovery.recoveryDispatchId,
            stage,
          }).pipe(
            Effect.mapError(mapHouseholdError),
            Effect.flatMap((hasProgress) =>
              hasProgress
                ? Effect.succeed("RestartAmbiguous" as const)
                : Effect.fail(failure("persistence_unavailable"))
            )
          )
        )
      );
      if (restartOutcome === "RestartAmbiguous") {
        const hasProgress = yield* hasHouseholdProviderRecoveryProgress({
          acquisitionGeneration: request.acquisitionGeneration,
          database: service.database,
          executionGeneration: request.executionGeneration,
          householdDomain,
          importId: request.importId,
          inputFingerprint: recovery.inputFingerprint,
          recoveryDispatchId: recovery.recoveryDispatchId,
          stage,
        }).pipe(Effect.mapError(mapHouseholdError));
        if (!hasProgress) {
          return yield* Effect.fail(failure("persistence_unavailable"));
        }
      }
    }
    return yield* Schema.decodeUnknownEffect(
      ProviderTerminalSettlementResponse
    )({
      acquisitionGeneration: recovery.acquisitionGeneration,
      dispatchId: recovery.originalDispatchId,
      importId: recovery.importId,
      outcome:
        stage === "speech"
          ? "speech_recovery_activated"
          : "visual_recovery_activated",
      recoveryDispatchId: recovery.recoveryDispatchId,
      runtimeStage: PilotProviderBudgetStage,
    }).pipe(Effect.mapError(() => failure("persistence_corrupt")));
  });

export const makeD1ProviderTerminalSettlementService = (
  input: ProviderTerminalSettlementServiceInput
): ProviderTerminalSettlementService => ({
  settle: Effect.fn("ProviderTerminalSettlementService.settle")(
    function* settleTerminalUnknownProviderCost(request) {
      if (input.runtimeStage !== PilotProviderBudgetStage) {
        return yield* Effect.fail(failure("stage_not_allowed"));
      }
      if (isOperation(request, "sweep_expired_recipe_replays")) {
        return yield* sweepExpiredRecipeReplays(input.database);
      }
      if (isOperation(request, "prepare_speech_recovery")) {
        return yield* prepareProviderRecovery(input, request, "speech");
      }
      if (isOperation(request, "prepare_visual_recovery")) {
        return yield* prepareProviderRecovery(input, request, "visual");
      }
      if (isOperation(request, "settle_visual_unknown")) {
        return yield* settleAndProject(
          input,
          request,
          "visual",
          {
            providerStageId: "visual-evidence",
            runId: standardRunId(request.importId),
          },
          "visual_terminal_unknown_cost_settled"
        );
      }
      if (isOperation(request, "settle_recipe_unknown")) {
        return yield* settleAndProject(
          input,
          request,
          "extraction",
          {
            chargeMicroUsd: 100_000,
            providerStageId: "recipe-extraction",
            runId: standardRunId(request.importId),
          },
          "recipe_terminal_unknown_cost_settled"
        );
      }
      if (isOperation(request, "settle_recipe_recovery_unknown")) {
        return yield* settleAndProject(
          input,
          request,
          "extraction",
          {
            chargeMicroUsd: 100_000,
            providerStageId: "recipe-extraction",
            runId: recoveryRunId(request.importId),
          },
          "recipe_recovery_unknown_cost_settled"
        );
      }
      if (isOperation(request, "prepare_recipe_recovery")) {
        if (input.householdDomain === undefined) {
          return yield* Effect.fail(failure("persistence_unavailable"));
        }
        const settlement = yield* readGlobalSettlement(
          input.database,
          request,
          {
            chargeMicroUsd: 100_000,
            providerStageId: "recipe-extraction",
            runId: request.dispatchId.includes(":recovery:")
              ? recoveryRunId(request.importId)
              : standardRunId(request.importId),
          }
        );
        const recovery = yield* prepareHouseholdRecipeRecovery({
          acquisitionGeneration: request.acquisitionGeneration,
          database: input.database,
          executionGeneration: request.executionGeneration,
          householdDomain: input.householdDomain,
          importId: request.importId,
          predecessorDispatchId: request.dispatchId,
          settlement: {
            completedAt: settlement.created_at,
            dispatchId: settlement.dispatch_id,
            outcome: "settled_unknown",
          },
        }).pipe(Effect.mapError(mapHouseholdError));
        const start = input.recipeRecoveryStarter?.start;
        if (start === undefined) {
          return yield* Effect.fail(failure("persistence_unavailable"));
        }
        const authority = yield* resolveHouseholdRecoveryAuthority({
          acquisitionGeneration: request.acquisitionGeneration,
          database: input.database,
          executionGeneration: request.executionGeneration,
          householdDomain: input.householdDomain,
          importId: request.importId,
        }).pipe(Effect.mapError(mapHouseholdError));
        yield* start(recovery, authority.originalTrace).pipe(
          Effect.mapError(() => failure("persistence_unavailable"))
        );
        return yield* Schema.decodeUnknownEffect(
          ProviderTerminalSettlementResponse
        )({
          acquisitionGeneration: recovery.acquisitionGeneration,
          dispatchId: recovery.predecessorDispatchId,
          importId: recovery.importId,
          outcome: "recipe_recovery_prepared",
          recoveryDispatchId: recovery.currentDispatchId,
          recoveryExtractionFingerprint: recovery.currentExtractionFingerprint,
          recoveryOrdinal: recovery.ordinal,
          runtimeStage: PilotProviderBudgetStage,
        }).pipe(Effect.mapError(() => failure("persistence_corrupt")));
      }
      if (isOperation(request, "resume_recipe_recovery")) {
        if (input.householdDomain === undefined) {
          return yield* Effect.fail(failure("persistence_unavailable"));
        }
        const recovery = yield* readHouseholdRecipeRecovery({
          acquisitionGeneration: request.acquisitionGeneration,
          database: input.database,
          executionGeneration: request.executionGeneration,
          householdDomain: input.householdDomain,
          importId: request.importId,
          selector: { _tag: "Latest", rootDispatchId: request.dispatchId },
        }).pipe(Effect.mapError(mapHouseholdError));
        const start = input.recipeRecoveryStarter?.start;
        if (start === undefined) {
          return yield* Effect.fail(failure("persistence_unavailable"));
        }
        const authority = yield* resolveHouseholdRecoveryAuthority({
          acquisitionGeneration: request.acquisitionGeneration,
          database: input.database,
          executionGeneration: request.executionGeneration,
          householdDomain: input.householdDomain,
          importId: request.importId,
        }).pipe(Effect.mapError(mapHouseholdError));
        yield* start(recovery, authority.originalTrace).pipe(
          Effect.mapError(() => failure("persistence_unavailable"))
        );
        return yield* Schema.decodeUnknownEffect(
          ProviderTerminalSettlementResponse
        )({
          acquisitionGeneration: recovery.acquisitionGeneration,
          dispatchId: recovery.rootDispatchId,
          importId: recovery.importId,
          outcome: "recipe_recovery_resumed",
          recoveryDispatchId: recovery.currentDispatchId,
          recoveryExtractionFingerprint: recovery.currentExtractionFingerprint,
          recoveryOrdinal: recovery.ordinal,
          runtimeStage: PilotProviderBudgetStage,
        }).pipe(Effect.mapError(() => failure("persistence_corrupt")));
      }
      return yield* settleAndProject(
        input,
        request,
        "speech",
        {
          providerStageId: "speech-transcription",
          runId: standardRunId(request.importId),
        },
        "terminal_unknown_cost_settled"
      );
    }
  ),
});
