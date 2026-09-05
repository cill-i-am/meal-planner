import { Effect, Exit, Schema } from "effect";

import { ImportTimestamp } from "../imports/import.contracts.js";

const Identifier = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(128))
);

export const ProviderAccountingRunId = Identifier.pipe(
  Schema.brand("ProviderAccountingRunId")
);
export type ProviderAccountingRunId = typeof ProviderAccountingRunId.Type;

export const ProviderAccountingProviderStageId = Identifier.pipe(
  Schema.brand("ProviderAccountingProviderStageId")
);
export type ProviderAccountingProviderStageId =
  typeof ProviderAccountingProviderStageId.Type;

export const ProviderAccountingDispatchId = Identifier.pipe(
  Schema.brand("ProviderAccountingDispatchId")
);
export type ProviderAccountingDispatchId =
  typeof ProviderAccountingDispatchId.Type;

export const ProviderAccountingTimestamp = ImportTimestamp;
export type ProviderAccountingTimestamp =
  typeof ProviderAccountingTimestamp.Type;

/** One cross-household accounting scope per isolated deployment database. */
export const ProviderAccountingScope = "recipe-import" as const;
export const ProviderAccountingCapMicroUsd = 10_000_000 as const;

export type ProviderAccountingErrorCode =
  | "budget_exceeded"
  | "cost_exceeds_reservation"
  | "dispatch_conflict"
  | "outcome_unknown"
  | "persistence_corrupt"
  | "persistence_unavailable"
  | "stage_busy"
  | "stage_poisoned"
  | "transition_rejected";

export interface ProviderAccountingError {
  readonly _tag: "ProviderAccountingError";
  readonly code: ProviderAccountingErrorCode;
}

export const providerAccountingError = (
  code: ProviderAccountingErrorCode
): ProviderAccountingError => ({
  _tag: "ProviderAccountingError",
  code,
});

export interface ProviderAccountingReservation {
  readonly dispatchId: ProviderAccountingDispatchId;
  readonly maximumCostMicroUsd: number;
  readonly providerStageId: ProviderAccountingProviderStageId;
  readonly runId: ProviderAccountingRunId;
  readonly timestamp: ProviderAccountingTimestamp;
}

export interface ProviderAccountingInvocationSettlement extends ProviderAccountingReservation {
  readonly invocationGeneration: number;
}

export interface ProviderAccountingKnownSettlement extends ProviderAccountingInvocationSettlement {
  readonly actualCostMicroUsd: number;
}

export interface ProviderAccountingConservativeSettlement extends ProviderAccountingInvocationSettlement {
  readonly conservativeChargeMicroUsd: number;
  readonly replay: ProviderAccountingConservativeReplayValue;
}

export interface ProviderAccountingConservativeReplayValue {
  readonly evidenceFingerprint: string;
  readonly generation: number;
  readonly importId: string;
  readonly valueJson: string;
  readonly valueSha256: string;
}

export const ProviderAccountingDispatchState = Schema.Literals([
  "invoking",
  "released",
  "reserved",
  "settled_conservative",
  "settled_known",
  "settled_unknown",
]);
export type ProviderAccountingDispatchState =
  typeof ProviderAccountingDispatchState.Type;

export interface ProviderAccountingDispatch {
  readonly actualCostMicroUsd: number | null;
  readonly conservativeChargeMicroUsd?: number;
  readonly conservativeReplay?: ProviderAccountingConservativeReplayValue;
  readonly dispatchId: ProviderAccountingDispatchId;
  readonly invocationExpiresAt?: ProviderAccountingTimestamp;
  readonly invocationGeneration: number;
  readonly maximumCostMicroUsd: number;
  readonly providerStageId: ProviderAccountingProviderStageId;
  readonly runId: ProviderAccountingRunId;
  readonly state: ProviderAccountingDispatchState;
}

export type ProviderAccountingInvocationClaim =
  | {
      readonly _tag: "Claimed";
      readonly dispatch: ProviderAccountingDispatch;
    }
  | {
      readonly _tag: "NotClaimed";
      readonly dispatch: ProviderAccountingDispatch;
    };

export interface ProviderAccountingBudget {
  readonly budgetCapMicroUsd: number;
  readonly invokingDispatchId?: ProviderAccountingDispatchId;
  readonly poisonDispatchId?: ProviderAccountingDispatchId;
  readonly reservedMicroUsd: number;
  readonly settledMicroUsd: number;
  readonly state: "invoking" | "open" | "poisoned";
}

export interface ProviderAccountingRepository {
  readonly beginInvocation: (
    input: ProviderAccountingReservation
  ) => Effect.Effect<
    ProviderAccountingInvocationClaim,
    ProviderAccountingError
  >;
  readonly readStage: () => Effect.Effect<
    ProviderAccountingBudget,
    ProviderAccountingError
  >;
  readonly readDispatch: (
    input: ProviderAccountingReservation
  ) => Effect.Effect<ProviderAccountingDispatch, ProviderAccountingError>;
  readonly releaseBeforeInvocation: (
    input: ProviderAccountingReservation
  ) => Effect.Effect<ProviderAccountingDispatch, ProviderAccountingError>;
  readonly reserve: (
    input: ProviderAccountingReservation
  ) => Effect.Effect<ProviderAccountingDispatch, ProviderAccountingError>;
  readonly settleKnown: (
    input: ProviderAccountingKnownSettlement
  ) => Effect.Effect<ProviderAccountingDispatch, ProviderAccountingError>;
  readonly settleConservative: (
    input: ProviderAccountingConservativeSettlement
  ) => Effect.Effect<ProviderAccountingDispatch, ProviderAccountingError>;
  readonly settleUnknown: (
    input: ProviderAccountingInvocationSettlement
  ) => Effect.Effect<ProviderAccountingDispatch, ProviderAccountingError>;
}

export type ProviderCost =
  | {
      readonly _tag: "Known";
      readonly actualCostMicroUsd: number;
    }
  | {
      readonly _tag: "Conservative";
      readonly conservativeChargeMicroUsd: number;
    }
  | { readonly _tag: "Unknown" };

export interface ProviderInvocationResult<A> {
  readonly cost: ProviderCost;
  readonly value: A;
}

const canBeginProviderInvocation = (state: ProviderAccountingDispatchState) =>
  state === "reserved" || state === "invoking";

/**
 * The provider boundary may use this marker only when it has authoritative
 * evidence that a failed dispatch incurred exactly zero cost.
 */
const ProviderKnownZeroCostFailureBrand = Symbol(
  "ProviderKnownZeroCostFailure"
);

export class ProviderKnownZeroCostFailure<E> {
  readonly [ProviderKnownZeroCostFailureBrand] = true;
  readonly _tag = "ProviderKnownZeroCostFailure";
  readonly error: E;

  constructor(error: E) {
    this.error = error;
  }
}

export const providerKnownZeroCostFailure = <E>(
  error: E
): ProviderKnownZeroCostFailure<E> => new ProviderKnownZeroCostFailure(error);

export const isProviderKnownZeroCostFailure = <Error>(
  error: Error | ProviderKnownZeroCostFailure<Error>
): error is ProviderKnownZeroCostFailure<Error> =>
  error instanceof ProviderKnownZeroCostFailure;

export type AccountedProviderDispatchResult<A> =
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
  repository: ProviderAccountingRepository,
  reservation: ProviderAccountingReservation,
  invocationGeneration: number,
  observe: Effect.Effect<void>
) =>
  repository
    .settleUnknown({ ...reservation, invocationGeneration })
    .pipe(Effect.andThen(observe), Effect.asVoid);

const settleKnownZero = (
  repository: ProviderAccountingRepository,
  reservation: ProviderAccountingReservation,
  invocationGeneration: number,
  observe: Effect.Effect<void>
) =>
  repository
    .settleKnown({
      ...reservation,
      actualCostMicroUsd: 0,
      invocationGeneration,
    })
    .pipe(Effect.andThen(observe), Effect.asVoid);

const previousAttemptMatches = (
  previous: ProviderAccountingReservation,
  current: ProviderAccountingReservation
) =>
  previous.dispatchId !== current.dispatchId &&
  previous.maximumCostMicroUsd === current.maximumCostMicroUsd &&
  previous.providerStageId === current.providerStageId &&
  previous.runId === current.runId;

const reconcilePreviousAttempt = (
  repository: ProviderAccountingRepository,
  previousAttempt: ProviderAccountingReservation | undefined,
  reservation: ProviderAccountingReservation,
  observeUnknownSettlement: Effect.Effect<void>
) =>
  Effect.gen(function* reconcilePreviousProviderAttempt() {
    if (previousAttempt === undefined) {
      return;
    }
    if (!previousAttemptMatches(previousAttempt, reservation)) {
      return yield* Effect.fail(providerAccountingError("dispatch_conflict"));
    }
    const previous = yield* repository.readDispatch(previousAttempt);
    if (
      previous.state === "settled_known" &&
      previous.actualCostMicroUsd === 0
    ) {
      return;
    }
    if (previous.state === "invoking") {
      yield* settleUnknown(
        repository,
        previousAttempt,
        previous.invocationGeneration,
        observeUnknownSettlement
      );
    }
    return yield* Effect.fail(providerAccountingError("outcome_unknown"));
  });

export const runAccountedProviderDispatch = <A, E>(input: {
  readonly conservativeReplay?: {
    readonly decode: (
      replay: ProviderAccountingConservativeReplayValue
    ) => Effect.Effect<A, E>;
    readonly encode: (
      value: A
    ) => Effect.Effect<ProviderAccountingConservativeReplayValue, E>;
  };
  readonly invoke: Effect.Effect<
    ProviderInvocationResult<A>,
    E | ProviderKnownZeroCostFailure<E>
  >;
  readonly onDispatch?: Effect.Effect<void>;
  readonly onPoison?: Effect.Effect<void>;
  readonly onReservation?: Effect.Effect<void>;
  readonly onSettlement?: (
    outcome: "conservative" | "known" | "unknown"
  ) => Effect.Effect<void>;
  readonly prepare?: Effect.Effect<void, E>;
  readonly previousAttempt?: ProviderAccountingReservation;
  readonly repository: ProviderAccountingRepository;
  readonly reservation: ProviderAccountingReservation;
}): Effect.Effect<
  AccountedProviderDispatchResult<A>,
  E | ProviderAccountingError
> =>
  Effect.gen(function* runBudgetedProviderDispatch() {
    const replayConservative = (
      conservativeChargeMicroUsd: number,
      replay: ProviderAccountingConservativeReplayValue | undefined
    ) =>
      replay === undefined || input.conservativeReplay === undefined
        ? Effect.fail(providerAccountingError("persistence_corrupt"))
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
    yield* reconcilePreviousAttempt(
      input.repository,
      input.previousAttempt,
      input.reservation,
      observeUnknownSettlement
    );

    const reserved = yield* input.repository.reserve(input.reservation);
    if (reserved.state === "settled_known") {
      if (reserved.actualCostMicroUsd === null) {
        return yield* Effect.fail(
          providerAccountingError("persistence_corrupt")
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
          providerAccountingError("persistence_corrupt")
        );
      }
      return yield* replayConservative(
        reserved.conservativeChargeMicroUsd,
        reserved.conservativeReplay
      );
    }
    if (reserved.state === "settled_unknown") {
      return yield* Effect.fail(providerAccountingError("outcome_unknown"));
    }
    if (!canBeginProviderInvocation(reserved.state)) {
      return yield* Effect.fail(providerAccountingError("transition_rejected"));
    }
    if (reserved.state === "reserved") {
      yield* input.onReservation ?? Effect.void;

      if (input.prepare !== undefined) {
        yield* input.prepare.pipe(
          Effect.tapError(() =>
            input.repository.releaseBeforeInvocation(input.reservation)
          )
        );
      }
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
      return yield* Effect.fail(providerAccountingError("outcome_unknown"));
    }
    if (invocationClaim.dispatch.state !== "invoking") {
      return yield* Effect.fail(providerAccountingError("transition_rejected"));
    }
    const { invocationGeneration } = invocationClaim.dispatch;

    const claimedResult = yield* Effect.gen(
      function* finalizeClaimedInvocation() {
        yield* input.onDispatch ?? Effect.void;
        const result = yield* input.invoke;
        if (result.cost._tag === "Unknown") {
          yield* settleUnknown(
            input.repository,
            input.reservation,
            invocationGeneration,
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
              invocationGeneration,
              observeUnknownSettlement
            );
            return yield* Effect.fail(
              providerAccountingError("cost_exceeds_reservation")
            );
          }
          if (input.conservativeReplay === undefined) {
            yield* settleUnknown(
              input.repository,
              input.reservation,
              invocationGeneration,
              observeUnknownSettlement
            );
            return yield* Effect.fail(
              providerAccountingError("persistence_corrupt")
            );
          }
          const replay = yield* input.conservativeReplay.encode(result.value);
          yield* input.repository.settleConservative({
            ...input.reservation,
            conservativeChargeMicroUsd: result.cost.conservativeChargeMicroUsd,
            invocationGeneration,
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
            invocationGeneration,
            observeUnknownSettlement
          );
          return yield* Effect.fail(
            providerAccountingError("cost_exceeds_reservation")
          );
        }
        yield* input.repository.settleKnown({
          ...input.reservation,
          actualCostMicroUsd: result.cost.actualCostMicroUsd,
          invocationGeneration,
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
        isProviderKnownZeroCostFailure(error)
          ? settleKnownZero(
              input.repository,
              input.reservation,
              invocationGeneration,
              observeSettlement("known")
            ).pipe(
              Effect.as<KnownZeroFailureResult<E>>({
                _tag: "KnownZeroFailure",
                error: error.error,
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
          invocationGeneration,
          observeUnknownSettlement
        );
      })
    );
    if (claimedResult._tag === "KnownZeroFailure") {
      return yield* Effect.fail(claimedResult.error);
    }
    return claimedResult;
  });
