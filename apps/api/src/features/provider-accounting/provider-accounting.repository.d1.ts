import {
  and,
  eq,
  exists,
  gte,
  gt,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";

import {
  providerAccountingBudgets,
  providerAccountingConservativeSettlements,
  providerAccountingDispatches,
  providerAccountingRecipeReplayValues,
} from "./provider-accounting.database-schema.js";
import type { ProviderAccountingDatabase } from "./provider-accounting.database.js";
import {
  ProviderAccountingDispatchId,
  ProviderAccountingDispatchState,
  ProviderAccountingProviderStageId,
  ProviderAccountingRunId,
  ProviderAccountingCapMicroUsd,
  ProviderAccountingScope,
  ProviderAccountingTimestamp,
  providerAccountingError,
} from "./provider-accounting.js";
import type {
  ProviderAccountingConservativeSettlement,
  ProviderAccountingDispatch,
  ProviderAccountingKnownSettlement,
  ProviderAccountingReservation,
  ProviderAccountingError,
  ProviderAccountingRepository,
  ProviderAccountingBudget,
} from "./provider-accounting.js";

const NullableNumber = Schema.NullOr(Schema.Number);
const DispatchRow = Schema.Struct({
  actual_cost_micro_usd: NullableNumber,
  conservative_charge_micro_usd: Schema.optionalKey(NullableNumber),
  dispatch_id: ProviderAccountingDispatchId,
  invocation_expires_at: Schema.NullOr(ProviderAccountingTimestamp),
  invocation_generation: Schema.Number,
  maximum_cost_micro_usd: Schema.Number,
  provider_stage_id: ProviderAccountingProviderStageId,
  replay_evidence_fingerprint: Schema.optionalKey(Schema.NullOr(Schema.String)),
  replay_expires_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  replay_generation: Schema.optionalKey(NullableNumber),
  replay_import_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  replay_value_json: Schema.optionalKey(Schema.NullOr(Schema.String)),
  replay_value_sha256: Schema.optionalKey(Schema.NullOr(Schema.String)),
  run_id: ProviderAccountingRunId,
  state: ProviderAccountingDispatchState,
});
type DispatchRow = typeof DispatchRow.Type;
const StageRow = Schema.Struct({
  budget_cap_micro_usd: Schema.Number,
  invoking_dispatch_id: Schema.NullOr(ProviderAccountingDispatchId),
  poison_dispatch_id: Schema.NullOr(ProviderAccountingDispatchId),
  reserved_micro_usd: Schema.Number,
  settled_micro_usd: Schema.Number,
  state: Schema.Literals(["invoking", "open", "poisoned"]),
});
type StageRow = typeof StageRow.Type;
const ConservativeSettlementRow = Schema.Struct({
  accounting_scope: Schema.Literal(ProviderAccountingScope),
  actual_cost_was_unknown: Schema.Literal(1),
  authority: Schema.Literal("schema_valid_provider_response"),
  conservative_charge_micro_usd: Schema.Literal(100_000),
  dispatch_id: ProviderAccountingDispatchId,
});

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: () => providerAccountingError("persistence_unavailable"),
    try: () => Promise.resolve(operation()),
  });

const validMoney = (value: number) => Number.isSafeInteger(value) && value >= 0;

const validReplayValueJson = (value: string) => {
  const { byteLength } = new TextEncoder().encode(value);
  if (byteLength === 0 || byteLength > 262_144) {
    return false;
  }
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};

const Sha256Pattern = /^[a-f\d]{64}$/u;
const ReplaySha256 = Schema.String.pipe(
  Schema.check(Schema.isPattern(Sha256Pattern))
);
const ReplayGeneration = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const ReplayValueJson = Schema.String.pipe(
  Schema.check(Schema.makeFilter(validReplayValueJson))
);
const ReplayRow = Schema.Struct({
  dispatch_id: ProviderAccountingDispatchId,
  replay_evidence_fingerprint: ReplaySha256,
  replay_expires_at: Schema.String,
  replay_generation: ReplayGeneration,
  replay_import_id: Schema.NonEmptyString,
  replay_value_json: ReplayValueJson,
  replay_value_sha256: ReplaySha256,
});
const decodeReplayRow = Schema.decodeUnknownOption(ReplayRow, {
  onExcessProperty: "ignore",
});
const RecipeReplayRecoveryOrdinals = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const recipeReplayDispatchIds = (replay: {
  readonly evidenceFingerprint: string;
  readonly generation: number;
  readonly importId: string;
}) => {
  const root = `recipe:${replay.importId}:${replay.generation}:${replay.evidenceFingerprint}`;
  return [
    root,
    ...RecipeReplayRecoveryOrdinals.map(
      (recoveryOrdinal) => `${root}:recovery:${recoveryOrdinal}`
    ),
  ];
};

const isRecipeReplayDispatchId = (
  dispatchId: string,
  replay: {
    readonly evidenceFingerprint: string;
    readonly generation: number;
    readonly importId: string;
  }
) => {
  const allowed = recipeReplayDispatchIds(replay);
  return allowed.includes(dispatchId);
};

const isValidConservativeSettlement = (
  input: ProviderAccountingConservativeSettlement
) =>
  input.providerStageId === "recipe-extraction" &&
  input.maximumCostMicroUsd === 100_000 &&
  input.conservativeChargeMicroUsd === input.maximumCostMicroUsd &&
  Sha256Pattern.test(input.replay.evidenceFingerprint) &&
  Number.isSafeInteger(input.replay.generation) &&
  input.replay.generation >= 1 &&
  input.replay.importId.length > 0 &&
  validReplayValueJson(input.replay.valueJson) &&
  Sha256Pattern.test(input.replay.valueSha256) &&
  isRecipeReplayDispatchId(input.dispatchId, input.replay);

const replayFromRow = (
  row: DispatchRow
): ProviderAccountingDispatch["conservativeReplay"] | undefined => {
  const replay = Option.getOrUndefined(decodeReplayRow(row));
  if (
    replay === undefined ||
    !isRecipeReplayDispatchId(replay.dispatch_id, {
      evidenceFingerprint: replay.replay_evidence_fingerprint,
      generation: replay.replay_generation,
      importId: replay.replay_import_id,
    })
  ) {
    return undefined;
  }
  return {
    evidenceFingerprint: replay.replay_evidence_fingerprint,
    generation: replay.replay_generation,
    importId: replay.replay_import_id,
    valueJson: replay.replay_value_json,
    valueSha256: replay.replay_value_sha256,
  };
};

const hasValidInvocationFence = (row: DispatchRow) =>
  row.state === "reserved" || row.state === "released"
    ? row.invocation_generation === 0 && row.invocation_expires_at === null
    : Number.isSafeInteger(row.invocation_generation) &&
      row.invocation_generation >= 1 &&
      (row.state === "invoking"
        ? row.invocation_expires_at !== null
        : row.invocation_expires_at === null);

const hasValidReplayFields = (
  row: DispatchRow,
  replay: ReturnType<typeof replayFromRow>
) => {
  const replayFields = [
    row.replay_evidence_fingerprint,
    row.replay_expires_at,
    row.replay_generation,
    row.replay_import_id,
    row.replay_value_json,
    row.replay_value_sha256,
  ];
  return (
    replayFields.every((value) => value === null || value === undefined) ||
    (row.state === "settled_conservative" &&
      row.conservative_charge_micro_usd !== undefined &&
      row.conservative_charge_micro_usd !== null &&
      replay !== undefined)
  );
};

const isValidDispatchRow = (
  row: DispatchRow,
  replay: ReturnType<typeof replayFromRow>
) => {
  if (
    !validMoney(row.maximum_cost_micro_usd) ||
    row.maximum_cost_micro_usd === 0 ||
    row.maximum_cost_micro_usd > ProviderAccountingCapMicroUsd
  ) {
    return false;
  }
  if (!hasValidInvocationFence(row)) {
    return false;
  }
  if (
    row.conservative_charge_micro_usd !== undefined &&
    row.conservative_charge_micro_usd !== null &&
    (row.state !== "settled_conservative" ||
      row.actual_cost_micro_usd !== null ||
      row.conservative_charge_micro_usd !== row.maximum_cost_micro_usd)
  ) {
    return false;
  }
  if (
    row.state === "settled_conservative" &&
    row.conservative_charge_micro_usd !== row.maximum_cost_micro_usd
  ) {
    return false;
  }
  if (!hasValidReplayFields(row, replay)) {
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
): Effect.Effect<ProviderAccountingDispatch, ProviderAccountingError> => {
  const replay = replayFromRow(row);
  if (!isValidDispatchRow(row, replay)) {
    return Effect.fail(providerAccountingError("persistence_corrupt"));
  }
  let dispatch: ProviderAccountingDispatch = {
    actualCostMicroUsd: row.actual_cost_micro_usd,
    dispatchId: row.dispatch_id,
    invocationGeneration: row.invocation_generation,
    maximumCostMicroUsd: row.maximum_cost_micro_usd,
    providerStageId: row.provider_stage_id,
    runId: row.run_id,
    state: row.state,
  };
  if (row.invocation_expires_at !== null) {
    dispatch = {
      ...dispatch,
      invocationExpiresAt: row.invocation_expires_at,
    };
  }
  if (
    row.conservative_charge_micro_usd !== null &&
    row.conservative_charge_micro_usd !== undefined
  ) {
    dispatch = {
      ...dispatch,
      conservativeChargeMicroUsd: row.conservative_charge_micro_usd,
    };
  }
  if (replay !== undefined) {
    dispatch = { ...dispatch, conservativeReplay: replay };
  }
  return Effect.succeed(dispatch);
};

const stageFromRow = (
  row: StageRow
): Effect.Effect<ProviderAccountingBudget, ProviderAccountingError> => {
  const hasValidStageState =
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
    row.budget_cap_micro_usd !== ProviderAccountingCapMicroUsd ||
    !validMoney(row.reserved_micro_usd) ||
    !validMoney(row.settled_micro_usd) ||
    row.reserved_micro_usd + row.settled_micro_usd >
      ProviderAccountingCapMicroUsd ||
    !hasValidStageState
  ) {
    return Effect.fail(providerAccountingError("persistence_corrupt"));
  }
  let stage: ProviderAccountingBudget = {
    budgetCapMicroUsd: row.budget_cap_micro_usd,
    reservedMicroUsd: row.reserved_micro_usd,
    settledMicroUsd: row.settled_micro_usd,
    state: row.state,
  };
  if (row.invoking_dispatch_id !== null) {
    stage = { ...stage, invokingDispatchId: row.invoking_dispatch_id };
  }
  if (row.poison_dispatch_id !== null) {
    stage = { ...stage, poisonDispatchId: row.poison_dispatch_id };
  }
  return Effect.succeed(stage);
};

const readDispatch = (
  database: ProviderAccountingDatabase,
  input: ProviderAccountingReservation
) =>
  persistenceEffect(() =>
    database
      .select({
        actual_cost_micro_usd: providerAccountingDispatches.actualCostMicroUsd,
        conservative_charge_micro_usd:
          providerAccountingConservativeSettlements.conservativeChargeMicroUsd,
        dispatch_id: providerAccountingDispatches.dispatchId,
        invocation_expires_at: providerAccountingDispatches.invocationExpiresAt,
        invocation_generation:
          providerAccountingDispatches.invocationGeneration,
        maximum_cost_micro_usd:
          providerAccountingDispatches.maximumCostMicroUsd,
        provider_stage_id: providerAccountingDispatches.providerStageId,
        replay_evidence_fingerprint:
          providerAccountingRecipeReplayValues.evidenceFingerprint,
        replay_expires_at: providerAccountingRecipeReplayValues.expiresAt,
        replay_generation: providerAccountingRecipeReplayValues.generation,
        replay_import_id: providerAccountingRecipeReplayValues.importId,
        replay_value_json: providerAccountingRecipeReplayValues.valueJson,
        replay_value_sha256: providerAccountingRecipeReplayValues.valueSha256,
        run_id: providerAccountingDispatches.runId,
        state: providerAccountingDispatches.state,
      })
      .from(providerAccountingDispatches)
      .leftJoin(
        providerAccountingConservativeSettlements,
        and(
          eq(
            providerAccountingConservativeSettlements.accountingScope,
            providerAccountingDispatches.accountingScope
          ),
          eq(
            providerAccountingConservativeSettlements.dispatchId,
            providerAccountingDispatches.dispatchId
          )
        )
      )
      .leftJoin(
        providerAccountingRecipeReplayValues,
        and(
          eq(
            providerAccountingRecipeReplayValues.accountingScope,
            providerAccountingDispatches.accountingScope
          ),
          eq(
            providerAccountingRecipeReplayValues.dispatchId,
            providerAccountingDispatches.dispatchId
          ),
          gt(
            providerAccountingRecipeReplayValues.expiresAt,
            sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
          )
        )
      )
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
  ).pipe(
    Effect.flatMap(([row]) =>
      row === undefined
        ? Effect.fail(providerAccountingError("transition_rejected"))
        : Schema.decodeUnknownEffect(DispatchRow, {
            onExcessProperty: "ignore",
          })(row).pipe(
            Effect.mapError(() =>
              providerAccountingError("persistence_corrupt")
            )
          )
    ),
    Effect.flatMap(dispatchFromRow)
  );

const identityMatches = (
  dispatch: ProviderAccountingDispatch,
  input: ProviderAccountingReservation
) =>
  dispatch.dispatchId === input.dispatchId &&
  dispatch.runId === input.runId &&
  dispatch.providerStageId === input.providerStageId &&
  dispatch.maximumCostMicroUsd === input.maximumCostMicroUsd;

const replayMatches = (
  dispatch: ProviderAccountingDispatch,
  input: ProviderAccountingConservativeSettlement
) =>
  dispatch.conservativeReplay?.evidenceFingerprint ===
    input.replay.evidenceFingerprint &&
  dispatch.conservativeReplay?.generation === input.replay.generation &&
  dispatch.conservativeReplay?.importId === input.replay.importId &&
  dispatch.conservativeReplay?.valueJson === input.replay.valueJson &&
  dispatch.conservativeReplay?.valueSha256 === input.replay.valueSha256;

const requireIdentity = (
  dispatch: ProviderAccountingDispatch,
  input: ProviderAccountingReservation
): Effect.Effect<ProviderAccountingDispatch, ProviderAccountingError> =>
  identityMatches(dispatch, input)
    ? Effect.succeed(dispatch)
    : Effect.fail(providerAccountingError("dispatch_conflict"));

const rejectedReservationCode = (
  stage: ProviderAccountingBudget
): ProviderAccountingError["code"] => {
  if (stage.state === "poisoned") {
    return "stage_poisoned";
  }
  if (stage.state === "invoking") {
    return "stage_busy";
  }
  return "budget_exceeded";
};

const readStageRow = (database: ProviderAccountingDatabase) =>
  persistenceEffect(() =>
    database
      .select({
        budget_cap_micro_usd: providerAccountingBudgets.budgetCapMicroUsd,
        invoking_dispatch_id: providerAccountingBudgets.invokingDispatchId,
        poison_dispatch_id: providerAccountingBudgets.poisonDispatchId,
        reserved_micro_usd: providerAccountingBudgets.reservedMicroUsd,
        settled_micro_usd: providerAccountingBudgets.settledMicroUsd,
        state: providerAccountingBudgets.state,
      })
      .from(providerAccountingBudgets)
      .where(
        eq(providerAccountingBudgets.accountingScope, ProviderAccountingScope)
      )
      .limit(1)
  ).pipe(
    Effect.flatMap(([row]) =>
      row === undefined
        ? Effect.fail(providerAccountingError("persistence_corrupt"))
        : Schema.decodeUnknownEffect(StageRow, {
            onExcessProperty: "ignore",
          })(row).pipe(
            Effect.mapError(() =>
              providerAccountingError("persistence_corrupt")
            )
          )
    ),
    Effect.flatMap(stageFromRow)
  );

const readConservativeSettlement = (
  database: ProviderAccountingDatabase,
  input: ProviderAccountingConservativeSettlement
) =>
  persistenceEffect(() =>
    database
      .select({
        accounting_scope:
          providerAccountingConservativeSettlements.accountingScope,
        actual_cost_was_unknown:
          providerAccountingConservativeSettlements.actualCostWasUnknown,
        authority: providerAccountingConservativeSettlements.authority,
        conservative_charge_micro_usd:
          providerAccountingConservativeSettlements.conservativeChargeMicroUsd,
        dispatch_id: providerAccountingConservativeSettlements.dispatchId,
      })
      .from(providerAccountingConservativeSettlements)
      .where(
        and(
          eq(
            providerAccountingConservativeSettlements.accountingScope,
            ProviderAccountingScope
          ),
          eq(
            providerAccountingConservativeSettlements.dispatchId,
            input.dispatchId
          )
        )
      )
      .limit(1)
  ).pipe(
    Effect.flatMap(([row]) =>
      row === undefined
        ? Effect.fail(providerAccountingError("transition_rejected"))
        : Schema.decodeUnknownEffect(ConservativeSettlementRow, {
            onExcessProperty: "ignore",
          })(row).pipe(
            Effect.mapError(() =>
              providerAccountingError("persistence_corrupt")
            )
          )
    )
  );

const readTransition = (
  database: ProviderAccountingDatabase,
  input: ProviderAccountingReservation,
  operation: () => PromiseLike<unknown>
) =>
  Effect.gen(function* transitionDispatch() {
    yield* persistenceEffect(operation);
    return yield* readDispatch(database, input).pipe(
      Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
    );
  });

/** Build the global D1 provider accounting authority around the existing database. */
export const makeD1ProviderAccountingRepository = (
  database: ProviderAccountingDatabase
): ProviderAccountingRepository => ({
  beginInvocation: (input) =>
    Effect.gen(function* beginInvocation() {
      const current = yield* readDispatch(database, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      const timestamp = DateTime.formatIso(input.timestamp);
      if (current.state === "invoking") {
        if (current.invocationExpiresAt === undefined) {
          return yield* Effect.fail(
            providerAccountingError("persistence_corrupt")
          );
        }
        if (
          DateTime.toEpochMillis(current.invocationExpiresAt) >
          DateTime.toEpochMillis(input.timestamp)
        ) {
          return { _tag: "NotClaimed", dispatch: current };
        }
        yield* persistenceEffect(() =>
          database
            .update(providerAccountingDispatches)
            .set({
              completedAt: timestamp,
              invocationExpiresAt: null,
              state: "settled_unknown",
              updatedAt: timestamp,
            })
            .where(
              and(
                eq(
                  providerAccountingDispatches.accountingScope,
                  ProviderAccountingScope
                ),
                eq(providerAccountingDispatches.dispatchId, input.dispatchId),
                eq(providerAccountingDispatches.state, "invoking"),
                eq(
                  providerAccountingDispatches.invocationGeneration,
                  current.invocationGeneration
                ),
                lte(providerAccountingDispatches.invocationExpiresAt, timestamp)
              )
            )
        );
        const dispatch = yield* readDispatch(database, input).pipe(
          Effect.flatMap((row) => requireIdentity(row, input))
        );
        return { _tag: "NotClaimed", dispatch };
      }
      if (current.state !== "reserved") {
        return { _tag: "NotClaimed", dispatch: current };
      }
      const invocationExpiresAt = new Date(
        DateTime.toEpochMillis(input.timestamp) + 5 * 60 * 1000
      ).toISOString();
      const claimedRows = yield* persistenceEffect(() =>
        database
          .update(providerAccountingDispatches)
          .set({
            invocationExpiresAt,
            invocationGeneration: sql<number>`${providerAccountingDispatches.invocationGeneration} + 1`,
            invocationStartedAt: timestamp,
            state: "invoking",
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(
                providerAccountingDispatches.accountingScope,
                ProviderAccountingScope
              ),
              eq(providerAccountingDispatches.dispatchId, input.dispatchId),
              eq(providerAccountingDispatches.state, "reserved")
            )
          )
          .returning({
            actual_cost_micro_usd:
              providerAccountingDispatches.actualCostMicroUsd,
            dispatch_id: providerAccountingDispatches.dispatchId,
            invocation_expires_at:
              providerAccountingDispatches.invocationExpiresAt,
            invocation_generation:
              providerAccountingDispatches.invocationGeneration,
            maximum_cost_micro_usd:
              providerAccountingDispatches.maximumCostMicroUsd,
            provider_stage_id: providerAccountingDispatches.providerStageId,
            run_id: providerAccountingDispatches.runId,
            state: providerAccountingDispatches.state,
          })
      );
      const [claimedRow] = claimedRows;
      if (claimedRow !== undefined) {
        const dispatch = yield* Schema.decodeUnknownEffect(DispatchRow, {
          onExcessProperty: "ignore",
        })(claimedRow).pipe(
          Effect.mapError(() => providerAccountingError("persistence_corrupt")),
          Effect.flatMap(dispatchFromRow),
          Effect.flatMap((row) => requireIdentity(row, input))
        );
        return { _tag: "Claimed", dispatch };
      }
      const dispatch = yield* readDispatch(database, input).pipe(
        Effect.flatMap((row) => requireIdentity(row, input))
      );
      return { _tag: "NotClaimed", dispatch };
    }),
  readDispatch: (input) =>
    readDispatch(database, input).pipe(
      Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
    ),
  readStage: () => readStageRow(database),
  releaseBeforeInvocation: (input) =>
    Effect.gen(function* releaseBeforeInvocation() {
      const current = yield* readDispatch(database, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      if (current.state !== "reserved") {
        return current;
      }
      const timestamp = DateTime.formatIso(input.timestamp);
      const released = yield* readTransition(database, input, () =>
        database
          .update(providerAccountingDispatches)
          .set({
            completedAt: timestamp,
            state: "released",
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(
                providerAccountingDispatches.accountingScope,
                ProviderAccountingScope
              ),
              eq(providerAccountingDispatches.dispatchId, input.dispatchId),
              eq(providerAccountingDispatches.state, "reserved")
            )
          )
      );
      return released.state === "released"
        ? released
        : yield* Effect.fail(providerAccountingError("transition_rejected"));
    }),
  reserve: (input) =>
    Effect.gen(function* reserveDispatch() {
      if (
        !Number.isSafeInteger(input.maximumCostMicroUsd) ||
        input.maximumCostMicroUsd <= 0 ||
        input.maximumCostMicroUsd > ProviderAccountingCapMicroUsd
      ) {
        return yield* Effect.fail(providerAccountingError("budget_exceeded"));
      }
      const timestamp = DateTime.formatIso(input.timestamp);
      const [, stageRows] = yield* persistenceEffect(() =>
        database.batch([
          database
            .insert(providerAccountingDispatches)
            .select(
              database
                .select({
                  accountingScope: providerAccountingBudgets.accountingScope,
                  createdAt: sql<string>`${timestamp}`.as("created_at"),
                  dispatchId: sql<string>`${input.dispatchId}`.as(
                    "dispatch_id"
                  ),
                  maximumCostMicroUsd:
                    sql<number>`${input.maximumCostMicroUsd}`.as(
                      "maximum_cost_micro_usd"
                    ),
                  providerStageId: sql<string>`${input.providerStageId}`.as(
                    "provider_stage_id"
                  ),
                  runId: sql<string>`${input.runId}`.as("run_id"),
                  state: sql`'reserved'`.as("state"),
                  updatedAt: sql<string>`${timestamp}`.as("updated_at"),
                })
                .from(providerAccountingBudgets)
                .where(
                  and(
                    eq(
                      providerAccountingBudgets.accountingScope,
                      ProviderAccountingScope
                    ),
                    eq(providerAccountingBudgets.state, "open"),
                    lte(
                      sql<number>`${providerAccountingBudgets.settledMicroUsd} + ${providerAccountingBudgets.reservedMicroUsd} + ${input.maximumCostMicroUsd}`,
                      providerAccountingBudgets.budgetCapMicroUsd
                    )
                  )
                )
            )
            .onConflictDoNothing({
              target: [
                providerAccountingDispatches.accountingScope,
                providerAccountingDispatches.dispatchId,
              ],
            }),
          database
            .select({
              budget_cap_micro_usd: providerAccountingBudgets.budgetCapMicroUsd,
              invoking_dispatch_id:
                providerAccountingBudgets.invokingDispatchId,
              poison_dispatch_id: providerAccountingBudgets.poisonDispatchId,
              reserved_micro_usd: providerAccountingBudgets.reservedMicroUsd,
              settled_micro_usd: providerAccountingBudgets.settledMicroUsd,
              state: providerAccountingBudgets.state,
            })
            .from(providerAccountingBudgets)
            .where(
              eq(
                providerAccountingBudgets.accountingScope,
                ProviderAccountingScope
              )
            ),
        ])
      );
      const [stageRow] = yield* Schema.decodeUnknownEffect(
        Schema.Array(StageRow),
        { onExcessProperty: "ignore" }
      )(stageRows).pipe(
        Effect.mapError(() => providerAccountingError("persistence_corrupt"))
      );
      if (stageRow === undefined) {
        return yield* Effect.fail(
          providerAccountingError("persistence_corrupt")
        );
      }
      const stage = yield* stageFromRow(stageRow);
      const dispatch = yield* readDispatch(database, input).pipe(
        Effect.catchTag("ProviderAccountingError", (error) =>
          error.code === "transition_rejected"
            ? Effect.fail(
                providerAccountingError(rejectedReservationCode(stage))
              )
            : Effect.fail(error)
        ),
        Effect.flatMap((row) => requireIdentity(row, input))
      );
      return dispatch;
    }),
  settleConservative: (input: ProviderAccountingConservativeSettlement) =>
    Effect.gen(function* settleConservative() {
      if (!isValidConservativeSettlement(input)) {
        return yield* Effect.fail(
          providerAccountingError("cost_exceeds_reservation")
        );
      }
      const current = yield* readDispatch(database, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      if (current.state === "settled_conservative") {
        if (current.invocationGeneration !== input.invocationGeneration) {
          return yield* Effect.fail(
            providerAccountingError("dispatch_conflict")
          );
        }
        yield* readConservativeSettlement(database, input);
        const stage = yield* readStageRow(database);
        return stage.state === "open" &&
          stage.invokingDispatchId === undefined &&
          stage.poisonDispatchId === undefined &&
          replayMatches(current, input)
          ? current
          : yield* Effect.fail(providerAccountingError("dispatch_conflict"));
      }
      if (current.state !== "invoking") {
        return yield* Effect.fail(
          providerAccountingError("transition_rejected")
        );
      }
      if (current.invocationGeneration !== input.invocationGeneration) {
        return yield* Effect.fail(providerAccountingError("dispatch_conflict"));
      }
      const timestamp = DateTime.formatIso(input.timestamp);
      const authorizedSettlement = database
        .select({
          accountingScope: providerAccountingDispatches.accountingScope,
          actualCostWasUnknown: sql<number>`${1}`.as("actual_cost_was_unknown"),
          authority: sql`'schema_valid_provider_response'`.as("authority"),
          conservativeChargeMicroUsd: sql<number>`${100_000}`.as(
            "conservative_charge_micro_usd"
          ),
          createdAt: sql<string>`${timestamp}`.as("created_at"),
          dispatchId: providerAccountingDispatches.dispatchId,
        })
        .from(providerAccountingDispatches)
        .innerJoin(
          providerAccountingBudgets,
          eq(
            providerAccountingBudgets.accountingScope,
            providerAccountingDispatches.accountingScope
          )
        )
        .where(
          and(
            eq(
              providerAccountingDispatches.accountingScope,
              ProviderAccountingScope
            ),
            eq(providerAccountingDispatches.dispatchId, input.dispatchId),
            eq(providerAccountingDispatches.runId, input.runId),
            eq(
              providerAccountingDispatches.providerStageId,
              "recipe-extraction"
            ),
            eq(providerAccountingDispatches.maximumCostMicroUsd, 100_000),
            isNull(providerAccountingDispatches.actualCostMicroUsd),
            eq(providerAccountingDispatches.state, "invoking"),
            eq(
              providerAccountingDispatches.invocationGeneration,
              input.invocationGeneration
            ),
            eq(providerAccountingBudgets.state, "invoking"),
            eq(
              providerAccountingBudgets.invokingDispatchId,
              providerAccountingDispatches.dispatchId
            ),
            isNull(providerAccountingBudgets.poisonDispatchId),
            gte(providerAccountingBudgets.reservedMicroUsd, 100_000),
            lte(
              sql<number>`${providerAccountingBudgets.settledMicroUsd} + ${providerAccountingBudgets.reservedMicroUsd}`,
              providerAccountingBudgets.budgetCapMicroUsd
            )
          )
        );
      const authorizedReplay = database
        .select({
          accountingScope: providerAccountingDispatches.accountingScope,
          createdAt: sql<string>`${timestamp}`.as("created_at"),
          dispatchId: providerAccountingDispatches.dispatchId,
          evidenceFingerprint:
            sql<string>`${input.replay.evidenceFingerprint}`.as(
              "evidence_fingerprint"
            ),
          expiresAt:
            sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', ${timestamp}, '+7 days')`.as(
              "expires_at"
            ),
          generation: sql<number>`${input.replay.generation}`.as("generation"),
          importId: sql<string>`${input.replay.importId}`.as("import_id"),
          valueJson: sql<string>`${input.replay.valueJson}`.as("value_json"),
          valueSha256: sql<string>`${input.replay.valueSha256}`.as(
            "value_sha256"
          ),
        })
        .from(providerAccountingDispatches)
        .innerJoin(
          providerAccountingConservativeSettlements,
          and(
            eq(
              providerAccountingConservativeSettlements.accountingScope,
              providerAccountingDispatches.accountingScope
            ),
            eq(
              providerAccountingConservativeSettlements.dispatchId,
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
            eq(providerAccountingDispatches.runId, input.runId),
            eq(
              providerAccountingDispatches.providerStageId,
              "recipe-extraction"
            ),
            eq(providerAccountingDispatches.maximumCostMicroUsd, 100_000),
            isNull(providerAccountingDispatches.actualCostMicroUsd),
            eq(providerAccountingDispatches.state, "invoking"),
            eq(
              providerAccountingDispatches.invocationGeneration,
              input.invocationGeneration
            ),
            inArray(
              providerAccountingDispatches.dispatchId,
              recipeReplayDispatchIds(input.replay)
            ),
            eq(
              providerAccountingConservativeSettlements.actualCostWasUnknown,
              1
            ),
            eq(
              providerAccountingConservativeSettlements.authority,
              "schema_valid_provider_response"
            ),
            eq(
              providerAccountingConservativeSettlements.conservativeChargeMicroUsd,
              100_000
            )
          )
        );
      yield* persistenceEffect(() =>
        database.batch([
          database
            .insert(providerAccountingConservativeSettlements)
            .select(authorizedSettlement)
            .onConflictDoNothing({
              target: [
                providerAccountingConservativeSettlements.accountingScope,
                providerAccountingConservativeSettlements.dispatchId,
              ],
            }),
          database
            .insert(providerAccountingRecipeReplayValues)
            .select(authorizedReplay)
            .onConflictDoNothing({
              target: [
                providerAccountingRecipeReplayValues.accountingScope,
                providerAccountingRecipeReplayValues.dispatchId,
              ],
            }),
          database
            .update(providerAccountingDispatches)
            .set({
              completedAt: timestamp,
              invocationExpiresAt: null,
              state: "settled_conservative",
              updatedAt: timestamp,
            })
            .where(
              and(
                eq(
                  providerAccountingDispatches.accountingScope,
                  ProviderAccountingScope
                ),
                eq(providerAccountingDispatches.dispatchId, input.dispatchId),
                eq(providerAccountingDispatches.runId, input.runId),
                eq(providerAccountingDispatches.state, "invoking"),
                eq(
                  providerAccountingDispatches.invocationGeneration,
                  input.invocationGeneration
                ),
                exists(
                  database
                    .select({
                      dispatchId:
                        providerAccountingRecipeReplayValues.dispatchId,
                    })
                    .from(providerAccountingRecipeReplayValues)
                    .where(
                      and(
                        eq(
                          providerAccountingRecipeReplayValues.accountingScope,
                          providerAccountingDispatches.accountingScope
                        ),
                        eq(
                          providerAccountingRecipeReplayValues.dispatchId,
                          providerAccountingDispatches.dispatchId
                        ),
                        eq(
                          providerAccountingRecipeReplayValues.importId,
                          input.replay.importId
                        ),
                        eq(
                          providerAccountingRecipeReplayValues.generation,
                          input.replay.generation
                        ),
                        eq(
                          providerAccountingRecipeReplayValues.evidenceFingerprint,
                          input.replay.evidenceFingerprint
                        ),
                        eq(
                          providerAccountingRecipeReplayValues.valueJson,
                          input.replay.valueJson
                        ),
                        eq(
                          providerAccountingRecipeReplayValues.valueSha256,
                          input.replay.valueSha256
                        )
                      )
                    )
                )
              )
            ),
        ])
      );
      const settled = yield* readDispatch(database, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      yield* readConservativeSettlement(database, input);
      const stage = yield* readStageRow(database);
      return settled.state === "settled_conservative" &&
        settled.actualCostMicroUsd === null &&
        replayMatches(settled, input) &&
        stage.state === "open" &&
        stage.invokingDispatchId === undefined &&
        stage.poisonDispatchId === undefined
        ? settled
        : yield* Effect.fail(providerAccountingError("transition_rejected"));
    }),
  settleKnown: (input: ProviderAccountingKnownSettlement) =>
    Effect.gen(function* settleKnown() {
      if (
        !validMoney(input.actualCostMicroUsd) ||
        input.actualCostMicroUsd > input.maximumCostMicroUsd
      ) {
        return yield* Effect.fail(
          providerAccountingError("cost_exceeds_reservation")
        );
      }
      const current = yield* readDispatch(database, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      if (current.state === "settled_known") {
        return current.invocationGeneration === input.invocationGeneration &&
          current.actualCostMicroUsd === input.actualCostMicroUsd
          ? current
          : yield* Effect.fail(providerAccountingError("dispatch_conflict"));
      }
      if (current.state !== "invoking") {
        return yield* Effect.fail(
          providerAccountingError("transition_rejected")
        );
      }
      if (current.invocationGeneration !== input.invocationGeneration) {
        return yield* Effect.fail(providerAccountingError("dispatch_conflict"));
      }
      const timestamp = DateTime.formatIso(input.timestamp);
      const settled = yield* readTransition(database, input, () =>
        database
          .update(providerAccountingDispatches)
          .set({
            actualCostMicroUsd: input.actualCostMicroUsd,
            completedAt: timestamp,
            invocationExpiresAt: null,
            state: "settled_known",
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(
                providerAccountingDispatches.accountingScope,
                ProviderAccountingScope
              ),
              eq(providerAccountingDispatches.dispatchId, input.dispatchId),
              eq(providerAccountingDispatches.state, "invoking"),
              eq(
                providerAccountingDispatches.invocationGeneration,
                input.invocationGeneration
              )
            )
          )
      );
      if (settled.state === "settled_unknown") {
        return yield* Effect.fail(providerAccountingError("outcome_unknown"));
      }
      return settled.state === "settled_known" &&
        settled.actualCostMicroUsd === input.actualCostMicroUsd
        ? settled
        : yield* Effect.fail(providerAccountingError("dispatch_conflict"));
    }),
  settleUnknown: (input) =>
    Effect.gen(function* settleUnknown() {
      const current = yield* readDispatch(database, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      if (current.state === "settled_unknown") {
        return current.invocationGeneration === input.invocationGeneration
          ? current
          : yield* Effect.fail(providerAccountingError("dispatch_conflict"));
      }
      if (current.state !== "invoking") {
        return yield* Effect.fail(
          providerAccountingError("transition_rejected")
        );
      }
      if (current.invocationGeneration !== input.invocationGeneration) {
        return yield* Effect.fail(providerAccountingError("dispatch_conflict"));
      }
      const timestamp = DateTime.formatIso(input.timestamp);
      const settled = yield* readTransition(database, input, () =>
        database
          .update(providerAccountingDispatches)
          .set({
            completedAt: timestamp,
            invocationExpiresAt: null,
            state: "settled_unknown",
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(
                providerAccountingDispatches.accountingScope,
                ProviderAccountingScope
              ),
              eq(providerAccountingDispatches.dispatchId, input.dispatchId),
              eq(providerAccountingDispatches.state, "invoking"),
              eq(
                providerAccountingDispatches.invocationGeneration,
                input.invocationGeneration
              )
            )
          )
      );
      return settled.state === "settled_unknown"
        ? settled
        : yield* Effect.fail(providerAccountingError("transition_rejected"));
    }),
});
