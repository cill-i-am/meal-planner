import { and, eq, exists, gte, isNull, lte, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Schema } from "effect";

import { ImportId, ImportTimestamp } from "../imports/import.contracts.js";
import {
  providerAccountingBudgets,
  providerAccountingDispatches,
  providerAccountingRecipeReplayValues,
  providerAccountingReconciliations,
} from "./provider-accounting.database-schema.js";
import type { ProviderAccountingDatabase } from "./provider-accounting.database.js";
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
  database: ProviderAccountingDatabase,
  input: GlobalSettlementInput,
  identity: GlobalSettlementIdentity
) =>
  persistenceEffect(() =>
    database
      .select({
        accounting_scope: providerAccountingReconciliations.accountingScope,
        authority: providerAccountingReconciliations.authority,
        conservative_charge_micro_usd:
          providerAccountingReconciliations.conservativeChargeMicroUsd,
        created_at: providerAccountingReconciliations.createdAt,
        dispatch_id: providerAccountingReconciliations.dispatchId,
      })
      .from(providerAccountingReconciliations)
      .innerJoin(
        providerAccountingDispatches,
        and(
          eq(
            providerAccountingDispatches.accountingScope,
            providerAccountingReconciliations.accountingScope
          ),
          eq(
            providerAccountingDispatches.dispatchId,
            providerAccountingReconciliations.dispatchId
          )
        )
      )
      .where(
        and(
          eq(
            providerAccountingReconciliations.accountingScope,
            ProviderAccountingScope
          ),
          eq(providerAccountingReconciliations.dispatchId, input.dispatchId),
          eq(providerAccountingReconciliations.actualCostWasUnknown, 1),
          eq(
            providerAccountingReconciliations.authority,
            "authenticated_operator"
          ),
          eq(providerAccountingDispatches.state, "settled_unknown"),
          eq(
            providerAccountingDispatches.providerStageId,
            identity.providerStageId
          ),
          eq(providerAccountingDispatches.runId, identity.runId),
          isNull(providerAccountingDispatches.actualCostMicroUsd),
          eq(
            providerAccountingDispatches.maximumCostMicroUsd,
            providerAccountingReconciliations.conservativeChargeMicroUsd
          ),
          identity.chargeMicroUsd === undefined
            ? undefined
            : eq(
                providerAccountingReconciliations.conservativeChargeMicroUsd,
                identity.chargeMicroUsd
              )
        )
      )
      .limit(1)
  ).pipe(
    Effect.flatMap(([row]) =>
      row === undefined
        ? Effect.fail(failure("not_allowed"))
        : Schema.decodeUnknownEffect(GlobalSettlementRow, {
            onExcessProperty: "ignore",
          })(row).pipe(Effect.mapError(() => failure("persistence_corrupt")))
    )
  );

const settleGlobalUnknown = (
  database: ProviderAccountingDatabase,
  input: GlobalSettlementInput,
  identity: GlobalSettlementIdentity,
  settledAt: typeof ImportTimestamp.Type
) => {
  const timestamp = DateTime.formatIso(settledAt);
  const recoverMissingSettlement = (error: ProviderAccountingServiceError) =>
    error.code === "not_allowed"
      ? Effect.gen(function* settleNewGlobalUnknown() {
          const [dispatch] = yield* persistenceEffect(() =>
            database
              .select({
                maximumCostMicroUsd:
                  providerAccountingDispatches.maximumCostMicroUsd,
                providerStageId: providerAccountingDispatches.providerStageId,
                runId: providerAccountingDispatches.runId,
                state: providerAccountingDispatches.state,
              })
              .from(providerAccountingDispatches)
              .where(
                and(
                  eq(
                    providerAccountingDispatches.accountingScope,
                    ProviderAccountingScope
                  ),
                  eq(providerAccountingDispatches.dispatchId, input.dispatchId)
                )
              )
              .limit(1)
          );
          const [budget] = yield* persistenceEffect(() =>
            database
              .select()
              .from(providerAccountingBudgets)
              .where(
                eq(
                  providerAccountingBudgets.accountingScope,
                  ProviderAccountingScope
                )
              )
              .limit(1)
          );
          if (
            dispatch === undefined ||
            budget === undefined ||
            dispatch.state !== "settled_unknown" ||
            dispatch.providerStageId !== identity.providerStageId ||
            dispatch.runId !== identity.runId ||
            (identity.chargeMicroUsd !== undefined &&
              dispatch.maximumCostMicroUsd !== identity.chargeMicroUsd) ||
            budget.state !== "poisoned" ||
            budget.poisonDispatchId !== input.dispatchId ||
            budget.invokingDispatchId !== null ||
            budget.reservedMicroUsd < dispatch.maximumCostMicroUsd
          ) {
            return yield* Effect.fail(failure("not_allowed"));
          }
          const authorizedReconciliation = database
            .select({
              accountingScope: providerAccountingBudgets.accountingScope,
              actualCostWasUnknown: sql<number>`${1}`.as(
                "actual_cost_was_unknown"
              ),
              authority: sql<string>`${"authenticated_operator"}`.as(
                "authority"
              ),
              conservativeChargeMicroUsd:
                providerAccountingDispatches.maximumCostMicroUsd,
              createdAt: sql<string>`${timestamp}`.as("created_at"),
              dispatchId: providerAccountingDispatches.dispatchId,
            })
            .from(providerAccountingBudgets)
            .innerJoin(
              providerAccountingDispatches,
              and(
                eq(
                  providerAccountingDispatches.accountingScope,
                  providerAccountingBudgets.accountingScope
                ),
                eq(
                  providerAccountingDispatches.dispatchId,
                  providerAccountingBudgets.poisonDispatchId
                )
              )
            )
            .where(
              and(
                eq(
                  providerAccountingBudgets.accountingScope,
                  ProviderAccountingScope
                ),
                eq(providerAccountingBudgets.state, "poisoned"),
                isNull(providerAccountingBudgets.invokingDispatchId),
                eq(
                  providerAccountingBudgets.poisonDispatchId,
                  input.dispatchId
                ),
                gte(
                  providerAccountingBudgets.reservedMicroUsd,
                  providerAccountingDispatches.maximumCostMicroUsd
                ),
                eq(
                  providerAccountingDispatches.accountingScope,
                  ProviderAccountingScope
                ),
                eq(providerAccountingDispatches.dispatchId, input.dispatchId),
                eq(providerAccountingDispatches.state, "settled_unknown"),
                eq(
                  providerAccountingDispatches.providerStageId,
                  identity.providerStageId
                ),
                eq(providerAccountingDispatches.runId, identity.runId),
                isNull(providerAccountingDispatches.actualCostMicroUsd),
                identity.chargeMicroUsd === undefined
                  ? undefined
                  : eq(
                      providerAccountingDispatches.maximumCostMicroUsd,
                      identity.chargeMicroUsd
                    )
              )
            );
          const persistedAuthorization = database
            .select({ authorized: sql<number>`${1}`.as("authorized") })
            .from(providerAccountingDispatches)
            .innerJoin(
              providerAccountingReconciliations,
              and(
                eq(
                  providerAccountingReconciliations.accountingScope,
                  providerAccountingDispatches.accountingScope
                ),
                eq(
                  providerAccountingReconciliations.dispatchId,
                  providerAccountingDispatches.dispatchId
                )
              )
            )
            .where(
              and(
                eq(
                  providerAccountingDispatches.accountingScope,
                  ProviderAccountingScope
                ),
                eq(providerAccountingDispatches.dispatchId, input.dispatchId),
                eq(providerAccountingDispatches.state, "settled_unknown"),
                eq(
                  providerAccountingDispatches.providerStageId,
                  identity.providerStageId
                ),
                eq(providerAccountingDispatches.runId, identity.runId),
                isNull(providerAccountingDispatches.actualCostMicroUsd),
                eq(
                  providerAccountingDispatches.maximumCostMicroUsd,
                  providerAccountingReconciliations.conservativeChargeMicroUsd
                ),
                eq(providerAccountingReconciliations.actualCostWasUnknown, 1),
                eq(
                  providerAccountingReconciliations.authority,
                  "authenticated_operator"
                ),
                identity.chargeMicroUsd === undefined
                  ? undefined
                  : eq(
                      providerAccountingReconciliations.conservativeChargeMicroUsd,
                      identity.chargeMicroUsd
                    )
              )
            );
          yield* persistenceEffect(() =>
            database.batch([
              database
                .insert(providerAccountingReconciliations)
                .select(authorizedReconciliation)
                .onConflictDoNothing(),
              database
                .update(providerAccountingBudgets)
                .set({
                  invokingDispatchId: null,
                  poisonDispatchId: null,
                  reservedMicroUsd:
                    budget.reservedMicroUsd - dispatch.maximumCostMicroUsd,
                  settledMicroUsd:
                    budget.settledMicroUsd + dispatch.maximumCostMicroUsd,
                  state: "open",
                  updatedAt: timestamp,
                })
                .where(
                  and(
                    eq(
                      providerAccountingBudgets.accountingScope,
                      ProviderAccountingScope
                    ),
                    eq(providerAccountingBudgets.state, "poisoned"),
                    isNull(providerAccountingBudgets.invokingDispatchId),
                    eq(
                      providerAccountingBudgets.poisonDispatchId,
                      input.dispatchId
                    ),
                    eq(
                      providerAccountingBudgets.reservedMicroUsd,
                      budget.reservedMicroUsd
                    ),
                    eq(
                      providerAccountingBudgets.settledMicroUsd,
                      budget.settledMicroUsd
                    ),
                    exists(persistedAuthorization)
                  )
                ),
            ])
          );
          return yield* readGlobalSettlement(database, input, identity);
        })
      : Effect.fail(error);
  return readGlobalSettlement(database, input, identity).pipe(
    Effect.catchTag("ProviderAccountingServiceError", recoverMissingSettlement)
  );
};

const sweepExpiredRecipeReplays = (database: ProviderAccountingDatabase) =>
  persistenceEffect(() =>
    database
      .delete(providerAccountingRecipeReplayValues)
      .where(
        and(
          eq(
            providerAccountingRecipeReplayValues.accountingScope,
            ProviderAccountingScope
          ),
          lte(
            providerAccountingRecipeReplayValues.expiresAt,
            new Date().toISOString()
          )
        )
      )
      .returning({
        dispatchId: providerAccountingRecipeReplayValues.dispatchId,
      })
  ).pipe(
    Effect.map(
      (deleted): ProviderAccountingResponse => ({
        accountingScope: ProviderAccountingScope,
        deletedCount: deleted.length,
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
  readonly database: ProviderAccountingDatabase;
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
