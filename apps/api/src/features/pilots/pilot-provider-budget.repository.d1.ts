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
  PilotBudgetConservativeSettlement,
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
  conservative_charge_micro_usd: Schema.optionalKey(NullableNumber),
  dispatch_id: PilotBudgetDispatchId,
  maximum_cost_micro_usd: Schema.Number,
  provider_stage_id: PilotBudgetProviderStageId,
  replay_evidence_fingerprint: Schema.optionalKey(Schema.NullOr(Schema.String)),
  replay_expires_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  replay_generation: Schema.optionalKey(NullableNumber),
  replay_import_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  replay_value_json: Schema.optionalKey(Schema.NullOr(Schema.String)),
  replay_value_sha256: Schema.optionalKey(Schema.NullOr(Schema.String)),
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
const ConservativeSettlementRow = Schema.Struct({
  actual_cost_was_unknown: Schema.Literal(1),
  authority: Schema.Literal("schema_valid_provider_response"),
  conservative_charge_micro_usd: Schema.Literal(100_000),
  dispatch_id: PilotBudgetDispatchId,
  runtime_stage: Schema.Literal(PilotProviderBudgetStage),
});

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

const decodeConservativeSettlementRow = (value: unknown) =>
  Schema.decodeUnknownEffect(ConservativeSettlementRow, {
    onExcessProperty: "ignore",
  })(value).pipe(
    Effect.mapError(() => pilotProviderBudgetError("persistence_corrupt"))
  );

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
): PilotBudgetDispatch["conservativeReplay"] | undefined => {
  const fields = [
    row.replay_evidence_fingerprint,
    row.replay_expires_at,
    row.replay_generation,
    row.replay_import_id,
    row.replay_value_json,
    row.replay_value_sha256,
  ];
  if (fields.every((value) => value === null || value === undefined)) {
    return undefined;
  }
  if (
    typeof row.replay_evidence_fingerprint !== "string" ||
    !Sha256Pattern.test(row.replay_evidence_fingerprint) ||
    typeof row.replay_expires_at !== "string" ||
    typeof row.replay_generation !== "number" ||
    !Number.isSafeInteger(row.replay_generation) ||
    row.replay_generation < 1 ||
    typeof row.replay_import_id !== "string" ||
    row.replay_import_id.length === 0 ||
    typeof row.replay_value_json !== "string" ||
    !validReplayValueJson(row.replay_value_json) ||
    typeof row.replay_value_sha256 !== "string" ||
    !Sha256Pattern.test(row.replay_value_sha256) ||
    !isRecipeReplayDispatchId(row.dispatch_id, {
      evidenceFingerprint: row.replay_evidence_fingerprint,
      generation: row.replay_generation,
      importId: row.replay_import_id,
    })
  ) {
    return undefined;
  }
  return {
    evidenceFingerprint: row.replay_evidence_fingerprint,
    generation: row.replay_generation,
    importId: row.replay_import_id,
    valueJson: row.replay_value_json,
    valueSha256: row.replay_value_sha256,
  };
};

const isValidDispatchRow = (row: DispatchRow) => {
  if (
    !validMoney(row.maximum_cost_micro_usd) ||
    row.maximum_cost_micro_usd === 0 ||
    row.maximum_cost_micro_usd > PilotProviderBudgetCapMicroUsd
  ) {
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
  const replayFields = [
    row.replay_evidence_fingerprint,
    row.replay_expires_at,
    row.replay_generation,
    row.replay_import_id,
    row.replay_value_json,
    row.replay_value_sha256,
  ];
  if (
    replayFields.some((value) => value !== null && value !== undefined) &&
    (row.state !== "settled_unknown" ||
      row.conservative_charge_micro_usd === undefined ||
      row.conservative_charge_micro_usd === null ||
      replayFromRow(row) === undefined)
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
): Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError> => {
  const replay = replayFromRow(row);
  return isValidDispatchRow(row)
    ? Effect.succeed({
        actualCostMicroUsd: row.actual_cost_micro_usd,
        ...(row.conservative_charge_micro_usd === null ||
        row.conservative_charge_micro_usd === undefined
          ? {}
          : {
              conservativeChargeMicroUsd: row.conservative_charge_micro_usd,
            }),
        ...(replay === undefined ? {} : { conservativeReplay: replay }),
        dispatchId: row.dispatch_id,
        maximumCostMicroUsd: row.maximum_cost_micro_usd,
        providerStageId: row.provider_stage_id,
        runId: row.run_id,
        state:
          row.state === "settled_unknown" &&
          row.conservative_charge_micro_usd !== null &&
          row.conservative_charge_micro_usd !== undefined
            ? "settled_conservative"
            : row.state,
      })
    : Effect.fail(pilotProviderBudgetError("persistence_corrupt"));
};

const stageFromRow = (
  row: StageRow
): Effect.Effect<PilotProviderStageBudget, PilotProviderBudgetError> => {
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
    row.budget_cap_micro_usd !== PilotProviderBudgetCapMicroUsd ||
    !validMoney(row.reserved_micro_usd) ||
    !validMoney(row.settled_micro_usd) ||
    row.reserved_micro_usd + row.settled_micro_usd >
      PilotProviderBudgetCapMicroUsd ||
    !hasValidStageState
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
        `SELECT dispatch.actual_cost_micro_usd,
                audit.conservative_charge_micro_usd,
                dispatch.dispatch_id, dispatch.maximum_cost_micro_usd,
                dispatch.provider_stage_id,
                  replay.evidence_fingerprint AS replay_evidence_fingerprint,
                  replay.expires_at AS replay_expires_at,
                  replay.generation AS replay_generation,
                replay.import_id AS replay_import_id,
                replay.value_json AS replay_value_json,
                replay.value_sha256 AS replay_value_sha256,
                dispatch.run_id, dispatch.state
           FROM pilot_provider_budget_dispatches AS dispatch
           LEFT JOIN pilot_provider_budget_conservative_settlements AS audit
             ON audit.runtime_stage = dispatch.runtime_stage
            AND audit.dispatch_id = dispatch.dispatch_id
           LEFT JOIN pilot_provider_recipe_replay_values AS replay
             ON replay.runtime_stage = dispatch.runtime_stage
            AND replay.dispatch_id = dispatch.dispatch_id
            AND replay.expires_at >
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE dispatch.runtime_stage = ? AND dispatch.dispatch_id = ?`
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

const replayMatches = (
  dispatch: PilotBudgetDispatch,
  input: PilotBudgetConservativeSettlement
) =>
  dispatch.conservativeReplay?.evidenceFingerprint ===
    input.replay.evidenceFingerprint &&
  dispatch.conservativeReplay?.generation === input.replay.generation &&
  dispatch.conservativeReplay?.importId === input.replay.importId &&
  dispatch.conservativeReplay?.valueJson === input.replay.valueJson &&
  dispatch.conservativeReplay?.valueSha256 === input.replay.valueSha256;

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

const readConservativeSettlement = (
  binding: AnyD1Database,
  input: PilotBudgetConservativeSettlement
) =>
  persistenceEffect(() =>
    binding
      .prepare(
        `SELECT actual_cost_was_unknown, authority,
                conservative_charge_micro_usd, dispatch_id, runtime_stage
           FROM pilot_provider_budget_conservative_settlements
          WHERE runtime_stage = ? AND dispatch_id = ?`
      )
      .bind(PilotProviderBudgetStage, input.dispatchId)
      .first()
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(pilotProviderBudgetError("transition_rejected"))
        : decodeConservativeSettlementRow(row)
    )
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
  settleConservative: (input: PilotBudgetConservativeSettlement) =>
    // eslint-disable-next-line complexity -- This generator validates one atomic multi-table D1 transition.
    Effect.gen(function* settleConservative() {
      yield* ensureAllowedStage(runtimeStage);
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
          pilotProviderBudgetError("cost_exceeds_reservation")
        );
      }
      const current = yield* readDispatch(binding, input).pipe(
        Effect.flatMap((dispatch) => requireIdentity(dispatch, input))
      );
      if (current.state === "settled_conservative") {
        yield* readConservativeSettlement(binding, input);
        const stage = yield* readStageRow(binding);
        return stage.state === "open" &&
          stage.invokingDispatchId === undefined &&
          stage.poisonDispatchId === undefined &&
          replayMatches(current, input)
          ? current
          : yield* Effect.fail(pilotProviderBudgetError("dispatch_conflict"));
      }
      if (current.state !== "invoking") {
        return yield* Effect.fail(
          pilotProviderBudgetError("transition_rejected")
        );
      }
      const timestamp = DateTime.formatIso(input.timestamp);
      yield* persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `UPDATE pilot_provider_budget_dispatches
                  SET state = 'settled_unknown', completed_at = ?,
                      updated_at = ?
                WHERE runtime_stage = ?
                  AND dispatch_id = ?
                  AND run_id = ?
                  AND provider_stage_id = 'recipe-extraction'
                  AND maximum_cost_micro_usd = 100000
                  AND actual_cost_micro_usd IS NULL
                  AND state = 'invoking'`
            )
            .bind(
              timestamp,
              timestamp,
              PilotProviderBudgetStage,
              input.dispatchId,
              input.runId
            ),
          binding
            .prepare(
              `INSERT INTO pilot_provider_budget_conservative_settlements (
                 actual_cost_was_unknown, authority,
                 conservative_charge_micro_usd, created_at,
                 dispatch_id, runtime_stage
               )
               SELECT 1, 'schema_valid_provider_response', 100000, ?,
                      dispatch.dispatch_id, dispatch.runtime_stage
                 FROM pilot_provider_budget_dispatches AS dispatch
                 JOIN pilot_provider_stage_budget AS stage
                   ON stage.runtime_stage = dispatch.runtime_stage
                WHERE dispatch.runtime_stage = ?
                  AND dispatch.dispatch_id = ?
                  AND dispatch.run_id = ?
                  AND dispatch.provider_stage_id = 'recipe-extraction'
                  AND dispatch.maximum_cost_micro_usd = 100000
                  AND dispatch.actual_cost_micro_usd IS NULL
                  AND dispatch.state = 'settled_unknown'
                  AND stage.state = 'poisoned'
                  AND stage.poison_dispatch_id = dispatch.dispatch_id
                  AND stage.invoking_dispatch_id IS NULL
                  AND stage.reserved_micro_usd >= 100000
                  AND stage.settled_micro_usd
                      + stage.reserved_micro_usd
                      <= stage.budget_cap_micro_usd
               ON CONFLICT(runtime_stage, dispatch_id) DO NOTHING`
            )
            .bind(
              timestamp,
              PilotProviderBudgetStage,
              input.dispatchId,
              input.runId
            ),
          binding
            .prepare(
              `INSERT INTO pilot_provider_recipe_replay_values (
                 created_at, dispatch_id, evidence_fingerprint, expires_at,
                 generation, import_id, runtime_stage, value_json,
                 value_sha256
               )
               SELECT ?, dispatch.dispatch_id, ?,
                      strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+7 days'),
                      ?, ?,
                      dispatch.runtime_stage, ?, ?
                 FROM pilot_provider_budget_dispatches AS dispatch
                 JOIN pilot_provider_budget_conservative_settlements AS audit
                   ON audit.runtime_stage = dispatch.runtime_stage
                  AND audit.dispatch_id = dispatch.dispatch_id
                WHERE dispatch.runtime_stage = ?
                  AND dispatch.dispatch_id = ?
                  AND dispatch.run_id = ?
                  AND dispatch.provider_stage_id = 'recipe-extraction'
                  AND dispatch.maximum_cost_micro_usd = 100000
                  AND dispatch.actual_cost_micro_usd IS NULL
                  AND dispatch.state = 'settled_unknown'
                  AND dispatch.dispatch_id IN (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  AND audit.actual_cost_was_unknown = 1
                  AND audit.authority =
                      'schema_valid_provider_response'
                  AND audit.conservative_charge_micro_usd = 100000
               ON CONFLICT(runtime_stage, dispatch_id) DO NOTHING`
            )
            .bind(
              timestamp,
              input.replay.evidenceFingerprint,
              timestamp,
              input.replay.generation,
              input.replay.importId,
              input.replay.valueJson,
              input.replay.valueSha256,
              PilotProviderBudgetStage,
              input.dispatchId,
              input.runId,
              ...recipeReplayDispatchIds(input.replay)
            ),
          binding
            .prepare(
              `UPDATE pilot_provider_stage_budget
                  SET settled_micro_usd = settled_micro_usd + 100000,
                      reserved_micro_usd = reserved_micro_usd - 100000,
                      state = 'open',
                      poison_dispatch_id = NULL,
                      updated_at = ?
                WHERE runtime_stage = ?
                  AND state = 'poisoned'
                  AND invoking_dispatch_id IS NULL
                  AND poison_dispatch_id = ?
                  AND reserved_micro_usd >= 100000
                  AND settled_micro_usd + reserved_micro_usd
                      <= budget_cap_micro_usd
                  AND EXISTS (
                    SELECT 1
                      FROM pilot_provider_budget_dispatches AS dispatch
                      JOIN pilot_provider_budget_conservative_settlements
                           AS audit
                        ON audit.runtime_stage = dispatch.runtime_stage
                       AND audit.dispatch_id = dispatch.dispatch_id
                     WHERE dispatch.runtime_stage =
                           pilot_provider_stage_budget.runtime_stage
                       AND dispatch.dispatch_id = ?
                       AND dispatch.run_id = ?
                       AND dispatch.provider_stage_id =
                           'recipe-extraction'
                       AND dispatch.maximum_cost_micro_usd = 100000
                       AND dispatch.actual_cost_micro_usd IS NULL
                       AND dispatch.state = 'settled_unknown'
                       AND audit.actual_cost_was_unknown = 1
                       AND audit.authority =
                           'schema_valid_provider_response'
                       AND audit.conservative_charge_micro_usd = 100000
                       AND EXISTS (
                         SELECT 1
                           FROM pilot_provider_recipe_replay_values AS replay
                          WHERE replay.runtime_stage =
                                dispatch.runtime_stage
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
              PilotProviderBudgetStage,
              input.dispatchId,
              input.dispatchId,
              input.runId,
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
        : yield* Effect.fail(pilotProviderBudgetError("transition_rejected"));
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
