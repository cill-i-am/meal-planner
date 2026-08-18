import { Context, Effect, Exit, Schema } from "effect";

import { ImportTimestamp } from "../imports/import.contracts.js";

const Identifier = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(128))
);

export const PilotBudgetRunId = Identifier.pipe(
  Schema.brand("PilotBudgetRunId")
);
export type PilotBudgetRunId = typeof PilotBudgetRunId.Type;

export const PilotBudgetProviderStageId = Identifier.pipe(
  Schema.brand("PilotBudgetProviderStageId")
);
export type PilotBudgetProviderStageId = typeof PilotBudgetProviderStageId.Type;

export const PilotBudgetDispatchId = Identifier.pipe(
  Schema.brand("PilotBudgetDispatchId")
);
export type PilotBudgetDispatchId = typeof PilotBudgetDispatchId.Type;

export const PilotBudgetTimestamp = ImportTimestamp;
export type PilotBudgetTimestamp = typeof PilotBudgetTimestamp.Type;

export const PilotProviderBudgetStage = "pilot-gaia-118" as const;
export const PilotProviderBudgetCapMicroUsd = 10_000_000 as const;

export type PilotProviderBudgetErrorCode =
  | "budget_exceeded"
  | "cost_exceeds_reservation"
  | "dispatch_conflict"
  | "outcome_unknown"
  | "persistence_corrupt"
  | "persistence_unavailable"
  | "stage_busy"
  | "stage_not_allowed"
  | "stage_poisoned"
  | "transition_rejected";

export interface PilotProviderBudgetError {
  readonly _tag: "PilotProviderBudgetError";
  readonly code: PilotProviderBudgetErrorCode;
}

export const pilotProviderBudgetError = (
  code: PilotProviderBudgetErrorCode
): PilotProviderBudgetError => ({
  _tag: "PilotProviderBudgetError",
  code,
});

export interface PilotBudgetReservation {
  readonly dispatchId: PilotBudgetDispatchId;
  readonly maximumCostMicroUsd: number;
  readonly providerStageId: PilotBudgetProviderStageId;
  readonly runId: PilotBudgetRunId;
  readonly timestamp: PilotBudgetTimestamp;
}

export interface PilotBudgetKnownSettlement extends PilotBudgetReservation {
  readonly actualCostMicroUsd: number;
}

export interface PilotBudgetConservativeSettlement extends PilotBudgetReservation {
  readonly conservativeChargeMicroUsd: number;
  readonly replay: PilotProviderConservativeReplayValue;
}

export interface PilotProviderConservativeReplayValue {
  readonly evidenceFingerprint: string;
  readonly generation: number;
  readonly importId: string;
  readonly valueJson: string;
  readonly valueSha256: string;
}

export type PilotBudgetDispatchState =
  | "invoking"
  | "released"
  | "reserved"
  | "settled_conservative"
  | "settled_known"
  | "settled_unknown";

export interface PilotBudgetDispatch {
  readonly actualCostMicroUsd: number | null;
  readonly conservativeChargeMicroUsd?: number;
  readonly conservativeReplay?: PilotProviderConservativeReplayValue;
  readonly dispatchId: PilotBudgetDispatchId;
  readonly maximumCostMicroUsd: number;
  readonly providerStageId: PilotBudgetProviderStageId;
  readonly runId: PilotBudgetRunId;
  readonly state: PilotBudgetDispatchState;
}

export type PilotBudgetInvocationClaim =
  | {
      readonly _tag: "Claimed";
      readonly dispatch: PilotBudgetDispatch;
    }
  | {
      readonly _tag: "NotClaimed";
      readonly dispatch: PilotBudgetDispatch;
    };

export interface PilotProviderStageBudget {
  readonly budgetCapMicroUsd: number;
  readonly invokingDispatchId?: PilotBudgetDispatchId;
  readonly poisonDispatchId?: PilotBudgetDispatchId;
  readonly reservedMicroUsd: number;
  readonly settledMicroUsd: number;
  readonly state: "invoking" | "open" | "poisoned";
}

export interface PilotProviderBudgetRepository {
  readonly beginInvocation: (
    input: PilotBudgetReservation
  ) => Effect.Effect<PilotBudgetInvocationClaim, PilotProviderBudgetError>;
  readonly readStage: () => Effect.Effect<
    PilotProviderStageBudget,
    PilotProviderBudgetError
  >;
  readonly readDispatch: (
    input: PilotBudgetReservation
  ) => Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError>;
  readonly releaseBeforeInvocation: (
    input: PilotBudgetReservation
  ) => Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError>;
  readonly reserve: (
    input: PilotBudgetReservation
  ) => Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError>;
  readonly settleKnown: (
    input: PilotBudgetKnownSettlement
  ) => Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError>;
  readonly settleConservative: (
    input: PilotBudgetConservativeSettlement
  ) => Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError>;
  readonly settleUnknown: (
    input: PilotBudgetReservation
  ) => Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError>;
}

export interface PilotProviderBudgetRuntime {
  readonly runtimeStage: unknown;
}

export const PilotProviderBudgetRuntime =
  Context.Service<PilotProviderBudgetRuntime>(
    "meal-planner/PilotProviderBudgetRuntime"
  );

export const makePilotProviderBudgetRuntime = (
  runtimeStage: unknown
): PilotProviderBudgetRuntime => ({ runtimeStage });

export type PilotProviderCost =
  | {
      readonly _tag: "Known";
      readonly actualCostMicroUsd: number;
    }
  | {
      readonly _tag: "Conservative";
      readonly conservativeChargeMicroUsd: number;
    }
  | { readonly _tag: "Unknown" };

export interface PilotProviderInvocationResult<A> {
  readonly cost: PilotProviderCost;
  readonly value: A;
}

/**
 * The provider boundary may use this marker only when it has authoritative
 * evidence that a failed dispatch incurred exactly zero cost.
 */
const PilotProviderKnownZeroCostFailureBrand = Symbol(
  "PilotProviderKnownZeroCostFailure"
);

export interface PilotProviderKnownZeroCostFailure<E> {
  readonly [PilotProviderKnownZeroCostFailureBrand]: true;
  readonly _tag: "PilotProviderKnownZeroCostFailure";
  readonly error: E;
}

export const pilotProviderKnownZeroCostFailure = <E>(
  error: E
): PilotProviderKnownZeroCostFailure<E> => ({
  [PilotProviderKnownZeroCostFailureBrand]: true,
  _tag: "PilotProviderKnownZeroCostFailure",
  error,
});

export const isPilotProviderKnownZeroCostFailure = (
  error: unknown
): error is PilotProviderKnownZeroCostFailure<unknown> =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "PilotProviderKnownZeroCostFailure" &&
  "error" in error &&
  PilotProviderKnownZeroCostFailureBrand in error &&
  error[PilotProviderKnownZeroCostFailureBrand] === true;

export type PilotProviderDispatchResult<A> =
  | {
      readonly _tag: "AlreadySettled";
      readonly actualCostMicroUsd: number;
    }
  | {
      readonly _tag: "AlreadyConservativelySettled";
      readonly conservativeChargeMicroUsd: number;
      readonly value: A;
    }
  | {
      readonly _tag: "Completed";
      readonly actualCostMicroUsd: number;
      readonly value: A;
    }
  | {
      readonly _tag: "CompletedUnknownCost";
      readonly value: A;
    }
  | {
      readonly _tag: "CompletedConservativeCost";
      readonly conservativeChargeMicroUsd: number;
      readonly value: A;
    };

interface KnownZeroFailureResult<E> {
  readonly _tag: "KnownZeroFailure";
  readonly error: E;
}

const settleUnknown = (
  repository: PilotProviderBudgetRepository,
  reservation: PilotBudgetReservation,
  observe: Effect.Effect<void>
) =>
  repository
    .settleUnknown(reservation)
    .pipe(Effect.andThen(observe), Effect.asVoid);

const settleKnownZero = (
  repository: PilotProviderBudgetRepository,
  reservation: PilotBudgetReservation,
  observe: Effect.Effect<void>
) =>
  repository
    .settleKnown({ ...reservation, actualCostMicroUsd: 0 })
    .pipe(Effect.andThen(observe), Effect.asVoid);

const previousAttemptMatches = (
  previous: PilotBudgetReservation,
  current: PilotBudgetReservation
) =>
  previous.dispatchId !== current.dispatchId &&
  previous.maximumCostMicroUsd === current.maximumCostMicroUsd &&
  previous.providerStageId === current.providerStageId &&
  previous.runId === current.runId;

export const runPilotProviderDispatch = <A, E>(input: {
  readonly conservativeReplay?: {
    readonly decode: (
      replay: PilotProviderConservativeReplayValue
    ) => Effect.Effect<A, E>;
    readonly encode: (
      value: A
    ) => Effect.Effect<PilotProviderConservativeReplayValue, E>;
  };
  readonly invoke: Effect.Effect<
    PilotProviderInvocationResult<A>,
    E | PilotProviderKnownZeroCostFailure<E>
  >;
  readonly onDispatch?: Effect.Effect<void>;
  readonly onPoison?: Effect.Effect<void>;
  readonly onReservation?: Effect.Effect<void>;
  readonly onSettlement?: (
    outcome: "conservative" | "known" | "unknown"
  ) => Effect.Effect<void>;
  readonly prepare?: Effect.Effect<void, E>;
  readonly previousAttempt?: PilotBudgetReservation;
  readonly repository: PilotProviderBudgetRepository;
  readonly reservation: PilotBudgetReservation;
}): Effect.Effect<
  PilotProviderDispatchResult<A>,
  E | PilotProviderBudgetError,
  PilotProviderBudgetRuntime
> =>
  // eslint-disable-next-line complexity -- The durable dispatch state machine keeps every settlement branch explicit.
  Effect.gen(function* runBudgetedProviderDispatch() {
    const replayConservative = (
      conservativeChargeMicroUsd: number,
      replay: PilotProviderConservativeReplayValue | undefined
    ) =>
      replay === undefined || input.conservativeReplay === undefined
        ? Effect.fail(pilotProviderBudgetError("persistence_corrupt"))
        : input.conservativeReplay.decode(replay).pipe(
            Effect.map((value) => ({
              _tag: "AlreadyConservativelySettled" as const,
              conservativeChargeMicroUsd,
              value,
            }))
          );
    const observeSettlement = (outcome: "conservative" | "known" | "unknown") =>
      input.onSettlement?.(outcome) ?? Effect.void;
    const observeUnknownSettlement = observeSettlement("unknown").pipe(
      Effect.andThen(input.onPoison ?? Effect.void)
    );
    const { runtimeStage } = yield* PilotProviderBudgetRuntime;
    if (runtimeStage !== PilotProviderBudgetStage) {
      return yield* Effect.fail(pilotProviderBudgetError("stage_not_allowed"));
    }

    if (input.previousAttempt !== undefined) {
      if (!previousAttemptMatches(input.previousAttempt, input.reservation)) {
        return yield* Effect.fail(
          pilotProviderBudgetError("dispatch_conflict")
        );
      }
      const previous = yield* input.repository.readDispatch(
        input.previousAttempt
      );
      if (
        previous.state === "settled_known" &&
        previous.actualCostMicroUsd === 0
      ) {
        // Exact durable zero-cost proof is the only safe retry authority.
      } else if (previous.state === "invoking") {
        yield* settleUnknown(
          input.repository,
          input.previousAttempt,
          observeUnknownSettlement
        );
        return yield* Effect.fail(pilotProviderBudgetError("outcome_unknown"));
      } else {
        return yield* Effect.fail(pilotProviderBudgetError("outcome_unknown"));
      }
    }

    const reserved = yield* input.repository.reserve(input.reservation);
    if (reserved.state === "settled_known") {
      if (reserved.actualCostMicroUsd === null) {
        return yield* Effect.fail(
          pilotProviderBudgetError("persistence_corrupt")
        );
      }
      return {
        _tag: "AlreadySettled",
        actualCostMicroUsd: reserved.actualCostMicroUsd,
      };
    }
    if (reserved.state === "settled_conservative") {
      if (
        reserved.conservativeChargeMicroUsd === undefined ||
        reserved.conservativeReplay === undefined
      ) {
        return yield* Effect.fail(
          pilotProviderBudgetError("persistence_corrupt")
        );
      }
      return yield* replayConservative(
        reserved.conservativeChargeMicroUsd,
        reserved.conservativeReplay
      );
    }
    if (reserved.state === "settled_unknown") {
      return yield* Effect.fail(pilotProviderBudgetError("outcome_unknown"));
    }
    if (reserved.state === "invoking") {
      return yield* Effect.fail(pilotProviderBudgetError("outcome_unknown"));
    }
    if (reserved.state !== "reserved") {
      return yield* Effect.fail(
        pilotProviderBudgetError("transition_rejected")
      );
    }
    yield* input.onReservation ?? Effect.void;

    if (input.prepare !== undefined) {
      yield* input.prepare.pipe(
        Effect.tapError(() =>
          input.repository.releaseBeforeInvocation(input.reservation)
        )
      );
    }

    const invocationClaim = yield* input.repository.beginInvocation(
      input.reservation
    );
    if (invocationClaim._tag === "NotClaimed") {
      const { dispatch } = invocationClaim;
      if (
        dispatch.state === "settled_known" &&
        dispatch.actualCostMicroUsd !== null
      ) {
        return {
          _tag: "AlreadySettled",
          actualCostMicroUsd: dispatch.actualCostMicroUsd,
        };
      }
      if (
        dispatch.state === "settled_conservative" &&
        dispatch.conservativeChargeMicroUsd !== undefined &&
        dispatch.conservativeReplay !== undefined
      ) {
        return yield* replayConservative(
          dispatch.conservativeChargeMicroUsd,
          dispatch.conservativeReplay
        );
      }
      return yield* Effect.fail(pilotProviderBudgetError("outcome_unknown"));
    }
    if (invocationClaim.dispatch.state !== "invoking") {
      return yield* Effect.fail(
        pilotProviderBudgetError("transition_rejected")
      );
    }

    const claimedResult = yield* Effect.gen(
      function* finalizeClaimedInvocation() {
        yield* input.onDispatch ?? Effect.void;
        const result = yield* input.invoke;
        if (result.cost._tag === "Unknown") {
          yield* settleUnknown(
            input.repository,
            input.reservation,
            observeUnknownSettlement
          );
          return { _tag: "CompletedUnknownCost" as const, value: result.value };
        }
        if (result.cost._tag === "Conservative") {
          if (
            !Number.isSafeInteger(result.cost.conservativeChargeMicroUsd) ||
            result.cost.conservativeChargeMicroUsd !==
              input.reservation.maximumCostMicroUsd
          ) {
            yield* settleUnknown(
              input.repository,
              input.reservation,
              observeUnknownSettlement
            );
            return yield* Effect.fail(
              pilotProviderBudgetError("cost_exceeds_reservation")
            );
          }
          if (input.conservativeReplay === undefined) {
            yield* settleUnknown(
              input.repository,
              input.reservation,
              observeUnknownSettlement
            );
            return yield* Effect.fail(
              pilotProviderBudgetError("persistence_corrupt")
            );
          }
          const replay = yield* input.conservativeReplay.encode(result.value);
          yield* input.repository.settleConservative({
            ...input.reservation,
            conservativeChargeMicroUsd: result.cost.conservativeChargeMicroUsd,
            replay,
          });
          yield* observeSettlement("conservative");
          return {
            _tag: "CompletedConservativeCost" as const,
            conservativeChargeMicroUsd: result.cost.conservativeChargeMicroUsd,
            value: result.value,
          };
        }
        if (
          !Number.isSafeInteger(result.cost.actualCostMicroUsd) ||
          result.cost.actualCostMicroUsd < 0 ||
          result.cost.actualCostMicroUsd > input.reservation.maximumCostMicroUsd
        ) {
          yield* settleUnknown(
            input.repository,
            input.reservation,
            observeUnknownSettlement
          );
          return yield* Effect.fail(
            pilotProviderBudgetError("cost_exceeds_reservation")
          );
        }
        yield* input.repository.settleKnown({
          ...input.reservation,
          actualCostMicroUsd: result.cost.actualCostMicroUsd,
        });
        yield* observeSettlement("known");
        return {
          _tag: "Completed" as const,
          actualCostMicroUsd: result.cost.actualCostMicroUsd,
          value: result.value,
        };
      }
    ).pipe(
      Effect.catch((error) =>
        isPilotProviderKnownZeroCostFailure(error)
          ? settleKnownZero(
              input.repository,
              input.reservation,
              observeSettlement("known")
            ).pipe(
              Effect.as<KnownZeroFailureResult<E>>({
                _tag: "KnownZeroFailure",
                error: error.error as E,
              })
            )
          : Effect.fail(error)
      ),
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) {
          return Effect.void;
        }
        return settleUnknown(
          input.repository,
          input.reservation,
          observeUnknownSettlement
        );
      })
    );
    if (claimedResult._tag === "KnownZeroFailure") {
      return yield* Effect.fail(claimedResult.error);
    }
    return claimedResult;
  });
