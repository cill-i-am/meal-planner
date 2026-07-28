import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Schema } from "effect";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotBudgetRunId,
  PilotProviderBudgetCapMicroUsd,
  PilotProviderBudgetStage,
  pilotProviderBudgetError,
} from "./pilot-provider-budget.js";
import type {
  PilotBudgetDispatch,
  PilotBudgetKnownSettlement,
  PilotBudgetReservation,
  PilotProviderBudgetError,
  PilotProviderBudgetRepository,
  PilotProviderStageBudget,
} from "./pilot-provider-budget.js";

const NullableNumber = Schema.NullOr(Schema.Number);
const DispatchRow = Schema.Struct({
  actual_cost_micro_usd: NullableNumber,
  dispatch_id: PilotBudgetDispatchId,
  maximum_cost_micro_usd: Schema.Number,
  provider_stage_id: PilotBudgetProviderStageId,
  run_id: PilotBudgetRunId,
  state: Schema.Literals([
    "invoking",
    "released",
    "reserved",
    "settled_known",
    "settled_unknown",
  ]),
});
type DispatchRow = typeof DispatchRow.Type;
const StageRow = Schema.Struct({
  budget_cap_micro_usd: Schema.Number,
  invoking_dispatch_id: Schema.NullOr(PilotBudgetDispatchId),
  poison_dispatch_id: Schema.NullOr(PilotBudgetDispatchId),
  reserved_micro_usd: Schema.Number,
  settled_micro_usd: Schema.Number,
  state: Schema.Literals(["invoking", "open", "poisoned"]),
});
type StageRow = typeof StageRow.Type;
const QueryRows = Schema.Struct({ results: Schema.Array(Schema.Unknown) });

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: () => pilotProviderBudgetError("persistence_unavailable"),
    try: () => Promise.resolve(operation()),
  });

const decodeDispatchRow = (value: unknown) =>
  Schema.decodeUnknownEffect(DispatchRow, {
    onExcessProperty: "ignore",
  })(value).pipe(
    Effect.mapError(() => pilotProviderBudgetError("persistence_corrupt"))
  );

const decodeStageRow = (value: unknown) =>
  Schema.decodeUnknownEffect(StageRow, {
    onExcessProperty: "ignore",
  })(value).pipe(
    Effect.mapError(() => pilotProviderBudgetError("persistence_corrupt"))
  );

const decodeQueryRows = (value: unknown) =>
  Schema.decodeUnknownEffect(QueryRows, {
    onExcessProperty: "ignore",
  })(value).pipe(
    Effect.mapError(() => pilotProviderBudgetError("persistence_corrupt"))
  );

const validMoney = (value: number) => Number.isSafeInteger(value) && value >= 0;

const validDispatchShape = (row: DispatchRow) => {
  if (
    !validMoney(row.maximum_cost_micro_usd) ||
    row.maximum_cost_micro_usd === 0 ||
    row.maximum_cost_micro_usd > PilotProviderBudgetCapMicroUsd
  ) {
    return false;
  }
  return row.state === "settled_known"
    ? row.actual_cost_micro_usd !== null &&
        validMoney(row.actual_cost_micro_usd) &&
        row.actual_cost_micro_usd <= row.maximum_cost_micro_usd
    : row.actual_cost_micro_usd === null;
};

const dispatchFromRow = (
  row: DispatchRow
): Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError> =>
  validDispatchShape(row)
    ? Effect.succeed({
        actualCostMicroUsd: row.actual_cost_micro_usd,
        dispatchId: row.dispatch_id,
        maximumCostMicroUsd: row.maximum_cost_micro_usd,
        providerStageId: row.provider_stage_id,
        runId: row.run_id,
        state: row.state,
      })
    : Effect.fail(pilotProviderBudgetError("persistence_corrupt"));

const stageFromRow = (
  row: StageRow
): Effect.Effect<PilotProviderStageBudget, PilotProviderBudgetError> => {
  const validStateShape =
    (row.state === "open" &&
      row.invoking_dispatch_id === null &&
      row.poison_dispatch_id === null) ||
    (row.state === "invoking" &&
      row.invoking_dispatch_id !== null &&
      row.poison_dispatch_id === null) ||
    (row.state === "poisoned" &&
      row.invoking_dispatch_id === null &&
      row.poison_dispatch_id !== null);
  if (
    row.budget_cap_micro_usd !== PilotProviderBudgetCapMicroUsd ||
    !validMoney(row.reserved_micro_usd) ||
    !validMoney(row.settled_micro_usd) ||
    row.reserved_micro_usd + row.settled_micro_usd >
      PilotProviderBudgetCapMicroUsd ||
    !validStateShape
  ) {
    return Effect.fail(pilotProviderBudgetError("persistence_corrupt"));
  }
  return Effect.succeed({
    budgetCapMicroUsd: row.budget_cap_micro_usd,
    ...(row.invoking_dispatch_id === null
      ? {}
      : { invokingDispatchId: row.invoking_dispatch_id }),
    ...(row.poison_dispatch_id === null
      ? {}
      : { poisonDispatchId: row.poison_dispatch_id }),
    reservedMicroUsd: row.reserved_micro_usd,
    settledMicroUsd: row.settled_micro_usd,
    state: row.state,
  });
};

const ensureAllowedStage = (
  runtimeStage: unknown
): Effect.Effect<void, PilotProviderBudgetError> =>
  runtimeStage === PilotProviderBudgetStage
    ? Effect.void
    : Effect.fail(pilotProviderBudgetError("stage_not_allowed"));

const readDispatch = (binding: AnyD1Database, input: PilotBudgetReservation) =>
  persistenceEffect(() =>
    binding
      .prepare(
        `SELECT actual_cost_micro_usd, dispatch_id, maximum_cost_micro_usd,
                provider_stage_id, run_id, state
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = ? AND dispatch_id = ?`
      )
      .bind(PilotProviderBudgetStage, input.dispatchId)
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(pilotProviderBudgetError("transition_rejected"))
        : decodeDispatchRow(row)
    ),
    Effect.flatMap(dispatchFromRow)
  );

const identityMatches = (
  dispatch: PilotBudgetDispatch,
  input: PilotBudgetReservation
) =>
  dispatch.dispatchId === input.dispatchId &&
  dispatch.runId === input.runId &&
  dispatch.providerStageId === input.providerStageId &&
  dispatch.maximumCostMicroUsd === input.maximumCostMicroUsd;

const requireIdentity = (
  dispatch: PilotBudgetDispatch,
  input: PilotBudgetReservation
): Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError> =>
  identityMatches(dispatch, input)
    ? Effect.succeed(dispatch)
    : Effect.fail(pilotProviderBudgetError("dispatch_conflict"));

const rejectedReservationCode = (
  stage: PilotProviderStageBudget
): PilotProviderBudgetError["code"] => {
  if (stage.state === "poisoned") {
    return "stage_poisoned";
  }
  if (stage.state === "invoking") {
    return "stage_busy";
  }
  return "budget_exceeded";
};

const readStageRow = (binding: AnyD1Database) =>
  persistenceEffect(() =>
    binding
      .prepare(
        `SELECT budget_cap_micro_usd, invoking_dispatch_id,
                poison_dispatch_id, reserved_micro_usd,
                settled_micro_usd, state
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = ?`
      )
      .bind(PilotProviderBudgetStage)
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(pilotProviderBudgetError("persistence_corrupt"))
        : decodeStageRow(row)
    ),
    Effect.flatMap(stageFromRow)
  );

const transition = (
  binding: AnyD1Database,
  input: PilotBudgetReservation,
  sql: string,
  parameters: readonly unknown[]
) =>
  Effect.gen(function* transitionDispatch() {
    yield* persistenceEffect(() =>
      binding
        .prepare(sql)
        .bind(...parameters)
        .run()
    );
    return yield* readDispatch(binding, input).pipe(
      Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
    );
  });

/** Build the stage-global D1 budget authority around the existing database. */
export const makeD1PilotProviderBudgetRepository = (
  binding: AnyD1Database,
  runtimeStage: unknown
): PilotProviderBudgetRepository => ({
  beginInvocation: (input) =>
    Effect.gen(function* beginInvocation() {
      yield* ensureAllowedStage(runtimeStage);
      const current = yield* readDispatch(binding, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      if (current.state !== "reserved") {
        return { _tag: "NotClaimed", dispatch: current };
      }
      const timestamp = DateTime.formatIso(input.timestamp);
      const rawClaim = yield* persistenceEffect(() =>
        binding
          .prepare(
            `UPDATE pilot_provider_budget_dispatches
                SET state = 'invoking', invocation_started_at = ?, updated_at = ?
              WHERE runtime_stage = ? AND dispatch_id = ? AND state = 'reserved'
              RETURNING actual_cost_micro_usd, dispatch_id,
                        maximum_cost_micro_usd, provider_stage_id, run_id, state`
          )
          .bind(
            timestamp,
            timestamp,
            PilotProviderBudgetStage,
            input.dispatchId
          )
          .all()
      );
      const claimRows = yield* decodeQueryRows(rawClaim);
      if (claimRows.results.length > 1) {
        return yield* Effect.fail(
          pilotProviderBudgetError("persistence_corrupt")
        );
      }
      const [claimedRow] = claimRows.results;
      if (claimedRow !== undefined) {
        const dispatch = yield* decodeDispatchRow(claimedRow).pipe(
          Effect.flatMap(dispatchFromRow),
          Effect.flatMap((row) => requireIdentity(row, input))
        );
        return { _tag: "Claimed", dispatch };
      }
      const dispatch = yield* readDispatch(binding, input).pipe(
        Effect.flatMap((row) => requireIdentity(row, input))
      );
      return { _tag: "NotClaimed", dispatch };
    }),
  readDispatch: (input) =>
    ensureAllowedStage(runtimeStage).pipe(
      Effect.flatMap(() => readDispatch(binding, input)),
      Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
    ),
  readStage: () =>
    ensureAllowedStage(runtimeStage).pipe(
      Effect.flatMap(() => readStageRow(binding))
    ),
  releaseBeforeInvocation: (input) =>
    Effect.gen(function* releaseBeforeInvocation() {
      yield* ensureAllowedStage(runtimeStage);
      const current = yield* readDispatch(binding, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      if (current.state !== "reserved") {
        return current;
      }
      const timestamp = DateTime.formatIso(input.timestamp);
      const released = yield* transition(
        binding,
        input,
        `UPDATE pilot_provider_budget_dispatches
            SET state = 'released', completed_at = ?, updated_at = ?
          WHERE runtime_stage = ? AND dispatch_id = ? AND state = 'reserved'`,
        [timestamp, timestamp, PilotProviderBudgetStage, input.dispatchId]
      );
      return released.state === "released"
        ? released
        : yield* Effect.fail(pilotProviderBudgetError("transition_rejected"));
    }),
  reserve: (input) =>
    Effect.gen(function* reserveDispatch() {
      yield* ensureAllowedStage(runtimeStage);
      if (
        !Number.isSafeInteger(input.maximumCostMicroUsd) ||
        input.maximumCostMicroUsd <= 0 ||
        input.maximumCostMicroUsd > PilotProviderBudgetCapMicroUsd
      ) {
        return yield* Effect.fail(pilotProviderBudgetError("budget_exceeded"));
      }
      const timestamp = DateTime.formatIso(input.timestamp);
      const stageBefore = yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `INSERT INTO pilot_provider_budget_dispatches (
                 runtime_stage, dispatch_id, run_id, provider_stage_id,
                 maximum_cost_micro_usd, state, created_at, updated_at
               )
               SELECT runtime_stage, ?, ?, ?, ?, 'reserved', ?, ?
                 FROM pilot_provider_stage_budget
                WHERE runtime_stage = ?
                  AND state = 'open'
                  AND settled_micro_usd + reserved_micro_usd + ?
                    <= budget_cap_micro_usd
               ON CONFLICT(runtime_stage, dispatch_id) DO NOTHING`
            )
            .bind(
              input.dispatchId,
              input.runId,
              input.providerStageId,
              input.maximumCostMicroUsd,
              timestamp,
              timestamp,
              PilotProviderBudgetStage,
              input.maximumCostMicroUsd
            ),
          binding
            .prepare(
              `SELECT budget_cap_micro_usd, invoking_dispatch_id,
                      poison_dispatch_id, reserved_micro_usd,
                      settled_micro_usd, state
                 FROM pilot_provider_stage_budget
                WHERE runtime_stage = ?`
            )
            .bind(PilotProviderBudgetStage),
        ])
      );
      const batch = stageBefore as readonly {
        readonly results?: readonly unknown[];
      }[];
      const stageRow = batch[1]?.results?.[0];
      if (stageRow === undefined) {
        return yield* Effect.fail(
          pilotProviderBudgetError("persistence_corrupt")
        );
      }
      const stage = yield* decodeStageRow(stageRow).pipe(
        Effect.flatMap(stageFromRow)
      );
      const dispatch = yield* readDispatch(binding, input).pipe(
        Effect.catchTag("PilotProviderBudgetError", (error) =>
          error.code === "transition_rejected"
            ? Effect.fail(
                pilotProviderBudgetError(rejectedReservationCode(stage))
              )
            : Effect.fail(error)
        ),
        Effect.flatMap((row) => requireIdentity(row, input))
      );
      return dispatch;
    }),
  settleKnown: (input: PilotBudgetKnownSettlement) =>
    Effect.gen(function* settleKnown() {
      yield* ensureAllowedStage(runtimeStage);
      if (
        !validMoney(input.actualCostMicroUsd) ||
        input.actualCostMicroUsd > input.maximumCostMicroUsd
      ) {
        return yield* Effect.fail(
          pilotProviderBudgetError("cost_exceeds_reservation")
        );
      }
      const current = yield* readDispatch(binding, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      if (current.state === "settled_known") {
        return current.actualCostMicroUsd === input.actualCostMicroUsd
          ? current
          : yield* Effect.fail(pilotProviderBudgetError("dispatch_conflict"));
      }
      if (current.state !== "invoking") {
        return yield* Effect.fail(
          pilotProviderBudgetError("transition_rejected")
        );
      }
      const timestamp = DateTime.formatIso(input.timestamp);
      const settled = yield* transition(
        binding,
        input,
        `UPDATE pilot_provider_budget_dispatches
            SET state = 'settled_known', actual_cost_micro_usd = ?,
                completed_at = ?, updated_at = ?
          WHERE runtime_stage = ? AND dispatch_id = ? AND state = 'invoking'`,
        [
          input.actualCostMicroUsd,
          timestamp,
          timestamp,
          PilotProviderBudgetStage,
          input.dispatchId,
        ]
      );
      if (settled.state === "settled_unknown") {
        return yield* Effect.fail(pilotProviderBudgetError("outcome_unknown"));
      }
      return settled.state === "settled_known" &&
        settled.actualCostMicroUsd === input.actualCostMicroUsd
        ? settled
        : yield* Effect.fail(pilotProviderBudgetError("dispatch_conflict"));
    }),
  settleUnknown: (input) =>
    Effect.gen(function* settleUnknown() {
      yield* ensureAllowedStage(runtimeStage);
      const current = yield* readDispatch(binding, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      if (current.state === "settled_unknown") {
        return current;
      }
      if (current.state !== "invoking") {
        return yield* Effect.fail(
          pilotProviderBudgetError("transition_rejected")
        );
      }
      const timestamp = DateTime.formatIso(input.timestamp);
      const settled = yield* transition(
        binding,
        input,
        `UPDATE pilot_provider_budget_dispatches
            SET state = 'settled_unknown', completed_at = ?, updated_at = ?
          WHERE runtime_stage = ? AND dispatch_id = ? AND state = 'invoking'`,
        [timestamp, timestamp, PilotProviderBudgetStage, input.dispatchId]
      );
      return settled.state === "settled_unknown"
        ? settled
        : yield* Effect.fail(pilotProviderBudgetError("transition_rejected"));
    }),
});
