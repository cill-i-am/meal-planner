import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Option, Schema } from "effect";

import {
  ProviderAccountingDispatchId,
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

const DispatchQueryRows = Schema.Struct({
  results: Schema.Array(DispatchRow),
});

const ReservationBatchRows = Schema.Tuple([
  Schema.Struct({ results: Schema.optionalKey(Schema.Array(Schema.Json)) }),
  Schema.Struct({ results: Schema.Array(StageRow) }),
]);

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

const hasValidReplayFields = (row: DispatchRow) => {
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
    (row.state === "settled_unknown" &&
      row.conservative_charge_micro_usd !== undefined &&
      row.conservative_charge_micro_usd !== null &&
      replayFromRow(row) !== undefined)
  );
};

const isValidDispatchRow = (row: DispatchRow) => {
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
    (row.state !== "settled_unknown" ||
      row.actual_cost_micro_usd !== null ||
      row.conservative_charge_micro_usd !== row.maximum_cost_micro_usd)
  ) {
    return false;
  }
  if (!hasValidReplayFields(row)) {
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
  if (!isValidDispatchRow(row)) {
    return Effect.fail(providerAccountingError("persistence_corrupt"));
  }
  let dispatch: ProviderAccountingDispatch = {
    actualCostMicroUsd: row.actual_cost_micro_usd,
    dispatchId: row.dispatch_id,
    invocationGeneration: row.invocation_generation,
    maximumCostMicroUsd: row.maximum_cost_micro_usd,
    providerStageId: row.provider_stage_id,
    runId: row.run_id,
    state:
      row.state === "settled_unknown" &&
      row.conservative_charge_micro_usd !== null &&
      row.conservative_charge_micro_usd !== undefined
        ? "settled_conservative"
        : row.state,
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
  binding: AnyD1Database,
  input: ProviderAccountingReservation
) =>
  persistenceEffect(() =>
    binding
      .prepare(
        `SELECT dispatch.actual_cost_micro_usd,
                audit.conservative_charge_micro_usd,
                dispatch.dispatch_id, dispatch.maximum_cost_micro_usd,
                dispatch.invocation_expires_at,
                dispatch.invocation_generation,
                dispatch.provider_stage_id,
                  replay.evidence_fingerprint AS replay_evidence_fingerprint,
                  replay.expires_at AS replay_expires_at,
                  replay.generation AS replay_generation,
                replay.import_id AS replay_import_id,
                replay.value_json AS replay_value_json,
                replay.value_sha256 AS replay_value_sha256,
                dispatch.run_id, dispatch.state
           FROM provider_accounting_dispatches AS dispatch
           LEFT JOIN provider_accounting_conservative_settlements AS audit
             ON audit.accounting_scope = dispatch.accounting_scope
            AND audit.dispatch_id = dispatch.dispatch_id
           LEFT JOIN provider_accounting_recipe_replay_values AS replay
             ON replay.accounting_scope = dispatch.accounting_scope
            AND replay.dispatch_id = dispatch.dispatch_id
            AND replay.expires_at >
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE dispatch.accounting_scope = ? AND dispatch.dispatch_id = ?`
      )
      .bind(ProviderAccountingScope, input.dispatchId)
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
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

const readStageRow = (binding: AnyD1Database) =>
  persistenceEffect(() =>
    binding
      .prepare(
        `SELECT budget_cap_micro_usd, invoking_dispatch_id,
                poison_dispatch_id, reserved_micro_usd,
                settled_micro_usd, state
           FROM provider_accounting_budgets
          WHERE accounting_scope = ?`
      )
      .bind(ProviderAccountingScope)
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
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
  binding: AnyD1Database,
  input: ProviderAccountingConservativeSettlement
) =>
  persistenceEffect(() =>
    binding
      .prepare(
        `SELECT actual_cost_was_unknown, authority,
                conservative_charge_micro_usd, dispatch_id, accounting_scope
           FROM provider_accounting_conservative_settlements
          WHERE accounting_scope = ? AND dispatch_id = ?`
      )
      .bind(ProviderAccountingScope, input.dispatchId)
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
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

const transition = (
  binding: AnyD1Database,
  input: ProviderAccountingReservation,
  sql: string,
  parameters: readonly (number | string | null)[]
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

/** Build the global D1 provider accounting authority around the existing database. */
export const makeD1ProviderAccountingRepository = (
  binding: AnyD1Database
): ProviderAccountingRepository => ({
  beginInvocation: (input) =>
    Effect.gen(function* beginInvocation() {
      const current = yield* readDispatch(binding, input).pipe(
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
          binding
            .prepare(
              `UPDATE provider_accounting_dispatches
                  SET state = 'settled_unknown', completed_at = ?,
                      invocation_expires_at = NULL, updated_at = ?
                WHERE accounting_scope = ? AND dispatch_id = ?
                  AND state = 'invoking'
                  AND invocation_generation = ?
                  AND invocation_expires_at <= ?`
            )
            .bind(
              timestamp,
              timestamp,
              ProviderAccountingScope,
              input.dispatchId,
              current.invocationGeneration,
              timestamp
            )
            .run()
        );
        const dispatch = yield* readDispatch(binding, input).pipe(
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
      const rawClaim = yield* persistenceEffect(() =>
        binding
          .prepare(
            `UPDATE provider_accounting_dispatches
                SET state = 'invoking', invocation_started_at = ?,
                    invocation_expires_at = ?,
                    invocation_generation = invocation_generation + 1,
                    updated_at = ?
              WHERE accounting_scope = ? AND dispatch_id = ? AND state = 'reserved'
              RETURNING actual_cost_micro_usd, dispatch_id,
                        invocation_expires_at, invocation_generation,
                        maximum_cost_micro_usd, provider_stage_id, run_id, state`
          )
          .bind(
            timestamp,
            invocationExpiresAt,
            timestamp,
            ProviderAccountingScope,
            input.dispatchId
          )
          .all()
      );
      const claimRows = yield* Schema.decodeUnknownEffect(DispatchQueryRows, {
        onExcessProperty: "ignore",
      })(rawClaim).pipe(
        Effect.mapError(() => providerAccountingError("persistence_corrupt"))
      );
      if (claimRows.results.length > 1) {
        return yield* Effect.fail(
          providerAccountingError("persistence_corrupt")
        );
      }
      const [claimedRow] = claimRows.results;
      if (claimedRow !== undefined) {
        const dispatch = yield* dispatchFromRow(claimedRow).pipe(
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
    readDispatch(binding, input).pipe(
      Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
    ),
  readStage: () => readStageRow(binding),
  releaseBeforeInvocation: (input) =>
    Effect.gen(function* releaseBeforeInvocation() {
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
        `UPDATE provider_accounting_dispatches
            SET state = 'released', completed_at = ?, updated_at = ?
          WHERE accounting_scope = ? AND dispatch_id = ? AND state = 'reserved'`,
        [timestamp, timestamp, ProviderAccountingScope, input.dispatchId]
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
      const stageBefore = yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `INSERT INTO provider_accounting_dispatches (
                 accounting_scope, dispatch_id, run_id, provider_stage_id,
                 maximum_cost_micro_usd, state, created_at, updated_at
               )
               SELECT accounting_scope, ?, ?, ?, ?, 'reserved', ?, ?
                 FROM provider_accounting_budgets
                WHERE accounting_scope = ?
                  AND state = 'open'
                  AND settled_micro_usd + reserved_micro_usd + ?
                    <= budget_cap_micro_usd
               ON CONFLICT(accounting_scope, dispatch_id) DO NOTHING`
            )
            .bind(
              input.dispatchId,
              input.runId,
              input.providerStageId,
              input.maximumCostMicroUsd,
              timestamp,
              timestamp,
              ProviderAccountingScope,
              input.maximumCostMicroUsd
            ),
          binding
            .prepare(
              `SELECT budget_cap_micro_usd, invoking_dispatch_id,
                      poison_dispatch_id, reserved_micro_usd,
                      settled_micro_usd, state
                 FROM provider_accounting_budgets
                WHERE accounting_scope = ?`
            )
            .bind(ProviderAccountingScope),
        ])
      );
      const [, stageResult] = yield* Schema.decodeUnknownEffect(
        ReservationBatchRows,
        { onExcessProperty: "ignore" }
      )(stageBefore).pipe(
        Effect.mapError(() => providerAccountingError("persistence_corrupt"))
      );
      const [stageRow] = stageResult.results;
      if (stageRow === undefined) {
        return yield* Effect.fail(
          providerAccountingError("persistence_corrupt")
        );
      }
      const stage = yield* stageFromRow(stageRow);
      const dispatch = yield* readDispatch(binding, input).pipe(
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
      if (
        input.providerStageId !== "recipe-extraction" ||
        input.maximumCostMicroUsd !== 100_000 ||
        input.conservativeChargeMicroUsd !== input.maximumCostMicroUsd ||
        !Sha256Pattern.test(input.replay.evidenceFingerprint) ||
        !Number.isSafeInteger(input.replay.generation) ||
        input.replay.generation < 1 ||
        input.replay.importId.length === 0 ||
        !validReplayValueJson(input.replay.valueJson) ||
        !Sha256Pattern.test(input.replay.valueSha256) ||
        !isRecipeReplayDispatchId(input.dispatchId, input.replay)
      ) {
        return yield* Effect.fail(
          providerAccountingError("cost_exceeds_reservation")
        );
      }
      const current = yield* readDispatch(binding, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      if (current.state === "settled_conservative") {
        if (current.invocationGeneration !== input.invocationGeneration) {
          return yield* Effect.fail(
            providerAccountingError("dispatch_conflict")
          );
        }
        yield* readConservativeSettlement(binding, input);
        const stage = yield* readStageRow(binding);
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
      yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `UPDATE provider_accounting_dispatches
                  SET state = 'settled_unknown', completed_at = ?,
                      invocation_expires_at = NULL, updated_at = ?
                WHERE accounting_scope = ?
                  AND dispatch_id = ?
                  AND run_id = ?
                  AND provider_stage_id = 'recipe-extraction'
                  AND maximum_cost_micro_usd = 100000
                  AND actual_cost_micro_usd IS NULL
                  AND state = 'invoking'
                  AND invocation_generation = ?`
            )
            .bind(
              timestamp,
              timestamp,
              ProviderAccountingScope,
              input.dispatchId,
              input.runId,
              input.invocationGeneration
            ),
          binding
            .prepare(
              `INSERT INTO provider_accounting_conservative_settlements (
                 actual_cost_was_unknown, authority,
                 conservative_charge_micro_usd, created_at,
                 dispatch_id, accounting_scope
               )
               SELECT 1, 'schema_valid_provider_response', 100000, ?,
                      dispatch.dispatch_id, dispatch.accounting_scope
                 FROM provider_accounting_dispatches AS dispatch
                 JOIN provider_accounting_budgets AS stage
                   ON stage.accounting_scope = dispatch.accounting_scope
                WHERE dispatch.accounting_scope = ?
                  AND dispatch.dispatch_id = ?
                  AND dispatch.run_id = ?
                  AND dispatch.provider_stage_id = 'recipe-extraction'
                  AND dispatch.maximum_cost_micro_usd = 100000
                  AND dispatch.actual_cost_micro_usd IS NULL
                  AND dispatch.state = 'settled_unknown'
                  AND dispatch.invocation_generation = ?
                  AND dispatch.completed_at = ?
                  AND stage.state = 'poisoned'
                  AND stage.poison_dispatch_id = dispatch.dispatch_id
                  AND stage.invoking_dispatch_id IS NULL
                  AND stage.reserved_micro_usd >= 100000
                  AND stage.settled_micro_usd
                      + stage.reserved_micro_usd
                      <= stage.budget_cap_micro_usd
               ON CONFLICT(accounting_scope, dispatch_id) DO NOTHING`
            )
            .bind(
              timestamp,
              ProviderAccountingScope,
              input.dispatchId,
              input.runId,
              input.invocationGeneration,
              timestamp
            ),
          binding
            .prepare(
              `INSERT INTO provider_accounting_recipe_replay_values (
                 created_at, dispatch_id, evidence_fingerprint, expires_at,
                 generation, import_id, accounting_scope, value_json,
                 value_sha256
               )
               SELECT ?, dispatch.dispatch_id, ?,
                      strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+7 days'),
                      ?, ?,
                      dispatch.accounting_scope, ?, ?
                 FROM provider_accounting_dispatches AS dispatch
                 JOIN provider_accounting_conservative_settlements AS audit
                   ON audit.accounting_scope = dispatch.accounting_scope
                  AND audit.dispatch_id = dispatch.dispatch_id
                WHERE dispatch.accounting_scope = ?
                  AND dispatch.dispatch_id = ?
                  AND dispatch.run_id = ?
                  AND dispatch.provider_stage_id = 'recipe-extraction'
                  AND dispatch.maximum_cost_micro_usd = 100000
                  AND dispatch.actual_cost_micro_usd IS NULL
                  AND dispatch.state = 'settled_unknown'
                  AND dispatch.invocation_generation = ?
                  AND dispatch.completed_at = ?
                  AND dispatch.dispatch_id IN (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  AND audit.actual_cost_was_unknown = 1
                  AND audit.authority =
                      'schema_valid_provider_response'
                  AND audit.conservative_charge_micro_usd = 100000
               ON CONFLICT(accounting_scope, dispatch_id) DO NOTHING`
            )
            .bind(
              timestamp,
              input.replay.evidenceFingerprint,
              timestamp,
              input.replay.generation,
              input.replay.importId,
              input.replay.valueJson,
              input.replay.valueSha256,
              ProviderAccountingScope,
              input.dispatchId,
              input.runId,
              input.invocationGeneration,
              timestamp,
              ...recipeReplayDispatchIds(input.replay)
            ),
          binding
            .prepare(
              `UPDATE provider_accounting_budgets
                  SET settled_micro_usd = settled_micro_usd + 100000,
                      reserved_micro_usd = reserved_micro_usd - 100000,
                      state = 'open',
                      poison_dispatch_id = NULL,
                      updated_at = ?
                WHERE accounting_scope = ?
                  AND state = 'poisoned'
                  AND invoking_dispatch_id IS NULL
                  AND poison_dispatch_id = ?
                  AND reserved_micro_usd >= 100000
                  AND settled_micro_usd + reserved_micro_usd
                      <= budget_cap_micro_usd
                  AND EXISTS (
                    SELECT 1
                      FROM provider_accounting_dispatches AS dispatch
                      JOIN provider_accounting_conservative_settlements
                           AS audit
                        ON audit.accounting_scope = dispatch.accounting_scope
                       AND audit.dispatch_id = dispatch.dispatch_id
                     WHERE dispatch.accounting_scope =
                           provider_accounting_budgets.accounting_scope
                       AND dispatch.dispatch_id = ?
                       AND dispatch.run_id = ?
                       AND dispatch.provider_stage_id =
                           'recipe-extraction'
                       AND dispatch.maximum_cost_micro_usd = 100000
                       AND dispatch.actual_cost_micro_usd IS NULL
                       AND dispatch.state = 'settled_unknown'
                       AND dispatch.invocation_generation = ?
                       AND dispatch.completed_at = ?
                       AND audit.actual_cost_was_unknown = 1
                       AND audit.authority =
                           'schema_valid_provider_response'
                       AND audit.conservative_charge_micro_usd = 100000
                       AND EXISTS (
                         SELECT 1
                           FROM provider_accounting_recipe_replay_values AS replay
                          WHERE replay.accounting_scope =
                                dispatch.accounting_scope
                            AND replay.dispatch_id = dispatch.dispatch_id
                            AND replay.import_id = ?
                            AND replay.generation = ?
                            AND replay.evidence_fingerprint = ?
                            AND replay.value_json = ?
                            AND replay.value_sha256 = ?
                       )
                  )`
            )
            .bind(
              timestamp,
              ProviderAccountingScope,
              input.dispatchId,
              input.dispatchId,
              input.runId,
              input.invocationGeneration,
              timestamp,
              input.replay.importId,
              input.replay.generation,
              input.replay.evidenceFingerprint,
              input.replay.valueJson,
              input.replay.valueSha256
            ),
        ])
      );
      const settled = yield* readDispatch(binding, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      yield* readConservativeSettlement(binding, input);
      const stage = yield* readStageRow(binding);
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
      const current = yield* readDispatch(binding, input).pipe(
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
      const settled = yield* transition(
        binding,
        input,
        `UPDATE provider_accounting_dispatches
            SET state = 'settled_known', actual_cost_micro_usd = ?,
                completed_at = ?, invocation_expires_at = NULL, updated_at = ?
          WHERE accounting_scope = ? AND dispatch_id = ? AND state = 'invoking'
            AND invocation_generation = ?`,
        [
          input.actualCostMicroUsd,
          timestamp,
          timestamp,
          ProviderAccountingScope,
          input.dispatchId,
          input.invocationGeneration,
        ]
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
      const current = yield* readDispatch(binding, input).pipe(
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
      const settled = yield* transition(
        binding,
        input,
        `UPDATE provider_accounting_dispatches
            SET state = 'settled_unknown', completed_at = ?,
                invocation_expires_at = NULL, updated_at = ?
          WHERE accounting_scope = ? AND dispatch_id = ? AND state = 'invoking'
            AND invocation_generation = ?`,
        [
          timestamp,
          timestamp,
          ProviderAccountingScope,
          input.dispatchId,
          input.invocationGeneration,
        ]
      );
      return settled.state === "settled_unknown"
        ? settled
        : yield* Effect.fail(providerAccountingError("transition_rejected"));
    }),
});
