import { and, eq, exists, gte, isNull, lte, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Schema } from "effect";

import { ImportId, ImportTimestamp } from "../imports/import.contracts.js";
import {
  providerAccountingBudgets as budgets,
  providerAccountingDispatches as dispatches,
  providerAccountingReconciliations as reconciliations,
  providerAccountingRecipeReplayValues as replays,
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
        accounting_scope: reconciliations.accountingScope,
        authority: reconciliations.authority,
        conservative_charge_micro_usd:
          reconciliations.conservativeChargeMicroUsd,
        created_at: reconciliations.createdAt,
        dispatch_id: reconciliations.dispatchId,
      })
      .from(reconciliations)
      .innerJoin(
        dispatches,
        and(
          eq(dispatches.accountingScope, reconciliations.accountingScope),
          eq(dispatches.dispatchId, reconciliations.dispatchId)
        )
      )
      .where(
        and(
          eq(reconciliations.accountingScope, ProviderAccountingScope),
          eq(reconciliations.dispatchId, input.dispatchId),
          eq(reconciliations.actualCostWasUnknown, 1),
          eq(reconciliations.authority, "authenticated_operator"),
          eq(dispatches.state, "settled_unknown"),
          eq(dispatches.providerStageId, identity.providerStageId),
          eq(dispatches.runId, identity.runId),
          isNull(dispatches.actualCostMicroUsd),
          eq(
            dispatches.maximumCostMicroUsd,
            reconciliations.conservativeChargeMicroUsd
          ),
          identity.chargeMicroUsd === undefined
            ? undefined
            : eq(
                reconciliations.conservativeChargeMicroUsd,
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
  const authorizedReconciliation = database
    .select({
      accountingScope: budgets.accountingScope,
      actualCostWasUnknown: sql<number>`${1}`.as("actual_cost_was_unknown"),
      authority: sql`'authenticated_operator'`.as("authority"),
      conservativeChargeMicroUsd: dispatches.maximumCostMicroUsd,
      createdAt: sql<string>`${timestamp}`.as("created_at"),
      dispatchId: dispatches.dispatchId,
    })
    .from(budgets)
    .innerJoin(
      dispatches,
      and(
        eq(dispatches.accountingScope, budgets.accountingScope),
        eq(dispatches.dispatchId, budgets.poisonDispatchId)
      )
    )
    .where(
      and(
        eq(budgets.accountingScope, ProviderAccountingScope),
        eq(budgets.state, "poisoned"),
        eq(budgets.poisonDispatchId, input.dispatchId),
        isNull(budgets.invokingDispatchId),
        gte(budgets.reservedMicroUsd, dispatches.maximumCostMicroUsd),
        lte(
          sql<number>`${budgets.settledMicroUsd} + ${budgets.reservedMicroUsd}`,
          budgets.budgetCapMicroUsd
        ),
        eq(dispatches.state, "settled_unknown"),
        eq(dispatches.providerStageId, identity.providerStageId),
        eq(dispatches.runId, identity.runId),
        isNull(dispatches.actualCostMicroUsd),
        identity.chargeMicroUsd === undefined
          ? undefined
          : eq(dispatches.maximumCostMicroUsd, identity.chargeMicroUsd)
      )
    );
  const charge = database
    .select({ value: reconciliations.conservativeChargeMicroUsd })
    .from(reconciliations)
    .where(
      and(
        eq(reconciliations.accountingScope, ProviderAccountingScope),
        eq(reconciliations.dispatchId, input.dispatchId)
      )
    );
  const persistedAuthorization = database
    .select({ dispatchId: dispatches.dispatchId })
    .from(dispatches)
    .innerJoin(
      reconciliations,
      and(
        eq(reconciliations.accountingScope, dispatches.accountingScope),
        eq(reconciliations.dispatchId, dispatches.dispatchId)
      )
    )
    .where(
      and(
        eq(dispatches.accountingScope, ProviderAccountingScope),
        eq(dispatches.dispatchId, input.dispatchId),
        eq(dispatches.state, "settled_unknown"),
        eq(dispatches.providerStageId, identity.providerStageId),
        eq(dispatches.runId, identity.runId),
        isNull(dispatches.actualCostMicroUsd),
        eq(
          dispatches.maximumCostMicroUsd,
          reconciliations.conservativeChargeMicroUsd
        ),
        eq(reconciliations.actualCostWasUnknown, 1),
        eq(reconciliations.authority, "authenticated_operator"),
        identity.chargeMicroUsd === undefined
          ? undefined
          : eq(
              reconciliations.conservativeChargeMicroUsd,
              identity.chargeMicroUsd
            )
      )
    );
  return persistenceEffect(() =>
    database.batch([
      database
        .insert(reconciliations)
        .select(authorizedReconciliation)
        .onConflictDoNothing({
          target: [reconciliations.accountingScope, reconciliations.dispatchId],
        }),
      database
        .update(budgets)
        .set({
          invokingDispatchId: null,
          poisonDispatchId: null,
          reservedMicroUsd: sql<number>`${budgets.reservedMicroUsd} - (${charge})`,
          settledMicroUsd: sql<number>`${budgets.settledMicroUsd} + (${charge})`,
          state: "open",
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(budgets.accountingScope, ProviderAccountingScope),
            eq(budgets.state, "poisoned"),
            eq(budgets.poisonDispatchId, input.dispatchId),
            isNull(budgets.invokingDispatchId),
            gte(budgets.reservedMicroUsd, charge),
            exists(persistedAuthorization)
          )
        ),
    ])
  ).pipe(Effect.flatMap(() => readGlobalSettlement(database, input, identity)));
};

const D1MutationResult = Schema.Struct({
  meta: Schema.Struct({
    changes: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
});
const sweepExpiredRecipeReplays = (database: ProviderAccountingDatabase) =>
  persistenceEffect<unknown>(() =>
    database
      .delete(replays)
      .where(
        and(
          eq(replays.accountingScope, ProviderAccountingScope),
          lte(
            replays.expiresAt,
            sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
          )
        )
      )
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
