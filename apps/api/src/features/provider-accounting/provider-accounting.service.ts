import type { AnyD1Database } from "drizzle-orm/d1";
import { Context, DateTime, Effect, Schema } from "effect";

import { ImportId, ImportTimestamp } from "../imports/import.contracts.js";
import {
  ProviderAccountingDispatchId,
  ProviderAccountingScope,
} from "./provider-accounting.js";

const settlementRequest = {
  dispatchId: ProviderAccountingDispatchId,
  importId: ImportId,
};

export const ProviderAccountingRequest = Schema.Union([
  Schema.Struct({
    ...settlementRequest,
    operation: Schema.Literal("settle_speech_unknown"),
  }),
  Schema.Struct({
    ...settlementRequest,
    operation: Schema.Literal("settle_visual_unknown"),
  }),
  Schema.Struct({
    ...settlementRequest,
    operation: Schema.Literal("settle_recipe_unknown"),
  }),
  Schema.Struct({
    ...settlementRequest,
    operation: Schema.Literal("settle_recipe_recovery_unknown"),
  }),
  Schema.Struct({ operation: Schema.Literal("sweep_expired_recipe_replays") }),
]);
export type ProviderAccountingRequest = typeof ProviderAccountingRequest.Type;

const ConservativeChargeMicroUsd = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(10_000_000)
  )
);
const settlementResponse = {
  accountingScope: Schema.Literal(ProviderAccountingScope),
  conservativeChargeMicroUsd: ConservativeChargeMicroUsd,
  dispatchId: ProviderAccountingDispatchId,
  importId: ImportId,
};
export const ProviderAccountingResponse = Schema.Union([
  Schema.Struct({
    ...settlementResponse,
    outcome: Schema.Literals([
      "recipe_recovery_unknown_cost_accounted",
      "recipe_unknown_cost_accounted",
      "speech_unknown_cost_accounted",
      "visual_unknown_cost_accounted",
    ]),
  }),
  Schema.Struct({
    accountingScope: Schema.Literal(ProviderAccountingScope),
    deletedCount: Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0))
    ),
    outcome: Schema.Literal("expired_recipe_replays_swept"),
  }),
]);
export type ProviderAccountingResponse = typeof ProviderAccountingResponse.Type;

export type ProviderAccountingServiceErrorCode =
  | "not_allowed"
  | "persistence_corrupt"
  | "persistence_unavailable";
export interface ProviderAccountingServiceError {
  readonly _tag: "ProviderAccountingServiceError";
  readonly code: ProviderAccountingServiceErrorCode;
}
const failure = (
  code: ProviderAccountingServiceErrorCode
): ProviderAccountingServiceError => ({
  _tag: "ProviderAccountingServiceError",
  code,
});
const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: () => failure("persistence_unavailable"),
    try: () => Promise.resolve(operation()),
  });

const GlobalSettlementRow = Schema.Struct({
  accounting_scope: Schema.Literal(ProviderAccountingScope),
  authority: Schema.Literal("authenticated_operator"),
  conservative_charge_micro_usd: ConservativeChargeMicroUsd,
  created_at: ImportTimestamp,
  dispatch_id: ProviderAccountingDispatchId,
});
interface GlobalSettlementInput {
  readonly dispatchId: typeof ProviderAccountingDispatchId.Type;
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
        `SELECT audit.accounting_scope, audit.dispatch_id,
                audit.conservative_charge_micro_usd, audit.authority,
                audit.created_at
           FROM provider_accounting_reconciliations AS audit
           JOIN provider_accounting_dispatches AS dispatch
             ON dispatch.accounting_scope = audit.accounting_scope
            AND dispatch.dispatch_id = audit.dispatch_id
           JOIN provider_accounting_budgets AS budget
             ON budget.accounting_scope = audit.accounting_scope
          WHERE audit.accounting_scope = ? AND audit.dispatch_id = ?
            AND audit.actual_cost_was_unknown = 1
            AND audit.authority = 'authenticated_operator'
            AND dispatch.state = 'settled_unknown'
            AND dispatch.provider_stage_id = ? AND dispatch.run_id = ?
            AND dispatch.actual_cost_micro_usd IS NULL
            AND dispatch.maximum_cost_micro_usd = audit.conservative_charge_micro_usd
            AND (? IS NULL OR audit.conservative_charge_micro_usd = ?)
            AND budget.state = 'open' AND budget.reserved_micro_usd = 0
            AND budget.invoking_dispatch_id IS NULL
            AND budget.poison_dispatch_id IS NULL`
      )
      .bind(
        ProviderAccountingScope,
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
          `INSERT INTO provider_accounting_reconciliations (
             accounting_scope, dispatch_id, conservative_charge_micro_usd,
             actual_cost_was_unknown, authority, created_at
           )
           SELECT budget.accounting_scope, dispatch.dispatch_id,
                  dispatch.maximum_cost_micro_usd, 1,
                  'authenticated_operator', ?
             FROM provider_accounting_budgets AS budget
             JOIN provider_accounting_dispatches AS dispatch
               ON dispatch.accounting_scope = budget.accounting_scope
              AND dispatch.dispatch_id = budget.poison_dispatch_id
            WHERE budget.accounting_scope = ? AND budget.state = 'poisoned'
              AND budget.poison_dispatch_id = ?
              AND budget.invoking_dispatch_id IS NULL
              AND budget.reserved_micro_usd = dispatch.maximum_cost_micro_usd
              AND budget.settled_micro_usd + budget.reserved_micro_usd <= budget.budget_cap_micro_usd
              AND dispatch.state = 'settled_unknown'
              AND dispatch.provider_stage_id = ? AND dispatch.run_id = ?
              AND dispatch.actual_cost_micro_usd IS NULL
              AND (? IS NULL OR dispatch.maximum_cost_micro_usd = ?)
           ON CONFLICT(accounting_scope, dispatch_id) DO NOTHING`
        )
        .bind(
          timestamp,
          ProviderAccountingScope,
          input.dispatchId,
          identity.providerStageId,
          identity.runId,
          identity.chargeMicroUsd ?? null,
          identity.chargeMicroUsd ?? null
        ),
      database
        .prepare(
          `UPDATE provider_accounting_budgets
              SET settled_micro_usd = settled_micro_usd + (
                    SELECT conservative_charge_micro_usd
                      FROM provider_accounting_reconciliations
                     WHERE accounting_scope = ? AND dispatch_id = ?
                  ),
                  reserved_micro_usd = reserved_micro_usd - (
                    SELECT conservative_charge_micro_usd
                      FROM provider_accounting_reconciliations
                     WHERE accounting_scope = ? AND dispatch_id = ?
                  ),
                  state = 'open', invoking_dispatch_id = NULL,
                  poison_dispatch_id = NULL, updated_at = ?
            WHERE accounting_scope = ? AND state = 'poisoned'
              AND poison_dispatch_id = ? AND invoking_dispatch_id IS NULL
              AND EXISTS (
                SELECT 1
                  FROM provider_accounting_dispatches AS dispatch
                  JOIN provider_accounting_reconciliations AS audit
                    ON audit.accounting_scope = dispatch.accounting_scope
                   AND audit.dispatch_id = dispatch.dispatch_id
                 WHERE dispatch.accounting_scope = ? AND dispatch.dispatch_id = ?
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
          ProviderAccountingScope,
          input.dispatchId,
          ProviderAccountingScope,
          input.dispatchId,
          timestamp,
          ProviderAccountingScope,
          input.dispatchId,
          ProviderAccountingScope,
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
        `DELETE FROM provider_accounting_recipe_replay_values
          WHERE accounting_scope = ?
            AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
      )
      .bind(ProviderAccountingScope)
      .run()
  ).pipe(
    Effect.flatMap((result) =>
      Schema.decodeUnknownEffect(D1MutationResult, {
        onExcessProperty: "ignore",
      })(result).pipe(Effect.mapError(() => failure("persistence_corrupt")))
    ),
    Effect.map(
      (result): ProviderAccountingResponse => ({
        accountingScope: ProviderAccountingScope,
        deletedCount: result.meta.changes,
        outcome: "expired_recipe_replays_swept",
      })
    )
  );

export interface ProviderAccountingService {
  readonly reconcile: (
    input: ProviderAccountingRequest
  ) => Effect.Effect<
    ProviderAccountingResponse,
    ProviderAccountingServiceError
  >;
}
export const ProviderAccountingService =
  Context.Service<ProviderAccountingService>(
    "meal-planner/ProviderAccountingService"
  );

const standardRunId = (importId: typeof ImportId.Type) =>
  `recipe-import:${importId}`;
const recoveryRunId = (importId: typeof ImportId.Type) =>
  `recipe-import:recipe-recovery:${importId}`;

type SettlementRequest = Exclude<
  ProviderAccountingRequest,
  { readonly operation: "sweep_expired_recipe_replays" }
>;

const settlementIdentity = (
  request: SettlementRequest
): GlobalSettlementIdentity => {
  switch (request.operation) {
    case "settle_speech_unknown": {
      return {
        providerStageId: "speech-transcription",
        runId: standardRunId(request.importId),
      };
    }
    case "settle_visual_unknown": {
      return {
        providerStageId: "visual-evidence",
        runId: standardRunId(request.importId),
      };
    }
    case "settle_recipe_unknown": {
      return {
        chargeMicroUsd: 100_000,
        providerStageId: "recipe-extraction",
        runId: standardRunId(request.importId),
      };
    }
    case "settle_recipe_recovery_unknown": {
      return {
        chargeMicroUsd: 100_000,
        providerStageId: "recipe-extraction",
        runId: recoveryRunId(request.importId),
      };
    }
    default: {
      return request satisfies never;
    }
  }
};

const accountedOutcome = (operation: SettlementRequest["operation"]) => {
  switch (operation) {
    case "settle_speech_unknown": {
      return "speech_unknown_cost_accounted" as const;
    }
    case "settle_visual_unknown": {
      return "visual_unknown_cost_accounted" as const;
    }
    case "settle_recipe_unknown": {
      return "recipe_unknown_cost_accounted" as const;
    }
    case "settle_recipe_recovery_unknown": {
      return "recipe_recovery_unknown_cost_accounted" as const;
    }
    default: {
      return operation satisfies never;
    }
  }
};

export const makeD1ProviderAccountingService = (input: {
  readonly database: AnyD1Database;
  readonly now: () => typeof ImportTimestamp.Type;
}): ProviderAccountingService => ({
  reconcile: Effect.fn("ProviderAccountingService.reconcile")(
    function* reconcileUnknownCost(request) {
      if (request.operation === "sweep_expired_recipe_replays") {
        return yield* sweepExpiredRecipeReplays(input.database);
      }
      const identity = settlementIdentity(request);
      const row = yield* settleGlobalUnknown(
        input.database,
        request,
        identity,
        input.now()
      );
      const outcome = accountedOutcome(request.operation);
      return yield* Schema.decodeUnknownEffect(ProviderAccountingResponse)({
        accountingScope: row.accounting_scope,
        conservativeChargeMicroUsd: row.conservative_charge_micro_usd,
        dispatchId: row.dispatch_id,
        importId: request.importId,
        outcome,
      }).pipe(Effect.mapError(() => failure("persistence_corrupt")));
    }
  ),
});
