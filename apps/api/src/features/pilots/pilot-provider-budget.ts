import { Context, Effect, Schema } from "effect";

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

export type PilotBudgetDispatchState =
  | "invoking"
  | "released"
  | "reserved"
  | "settled_known"
  | "settled_unknown";

export interface PilotBudgetDispatch {
  readonly actualCostMicroUsd: number | null;
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
  readonly releaseBeforeInvocation: (
    input: PilotBudgetReservation
  ) => Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError>;
  readonly reserve: (
    input: PilotBudgetReservation
  ) => Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError>;
  readonly settleKnown: (
    input: PilotBudgetKnownSettlement
  ) => Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError>;
  readonly settleUnknown: (
    input: PilotBudgetReservation
  ) => Effect.Effect<PilotBudgetDispatch, PilotProviderBudgetError>;
}

export interface PilotProviderBudgetRuntimeShape {
  readonly runtimeStage: unknown;
}

export class PilotProviderBudgetRuntime extends Context.Service<
  PilotProviderBudgetRuntime,
  PilotProviderBudgetRuntimeShape
>()("meal-planner/PilotProviderBudgetRuntime") {}

export const makePilotProviderBudgetRuntime = (
  runtimeStage: unknown
): PilotProviderBudgetRuntimeShape => ({ runtimeStage });

export type PilotProviderCost =
  | {
      readonly _tag: "Known";
      readonly actualCostMicroUsd: number;
    }
  | { readonly _tag: "Unknown" };

export interface PilotProviderInvocationResult<A> {
  readonly cost: PilotProviderCost;
  readonly value: A;
}

export type PilotProviderDispatchResult<A> =
  | {
      readonly _tag: "AlreadySettled";
      readonly actualCostMicroUsd: number;
    }
  | {
      readonly _tag: "Completed";
      readonly actualCostMicroUsd: number;
      readonly value: A;
    }
  | {
      readonly _tag: "CompletedUnknownCost";
      readonly value: A;
    };

export const runPilotProviderDispatch = <A, E>(input: {
  readonly invoke: Effect.Effect<PilotProviderInvocationResult<A>, E>;
  readonly prepare?: Effect.Effect<void, E>;
  readonly repository: PilotProviderBudgetRepository;
  readonly reservation: PilotBudgetReservation;
}): Effect.Effect<
  PilotProviderDispatchResult<A>,
  E | PilotProviderBudgetError,
  PilotProviderBudgetRuntime
> =>
  Effect.gen(function* runBudgetedProviderDispatch() {
    const { runtimeStage } = yield* PilotProviderBudgetRuntime;
    if (runtimeStage !== PilotProviderBudgetStage) {
      return yield* Effect.fail(pilotProviderBudgetError("stage_not_allowed"));
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
      return yield* Effect.fail(pilotProviderBudgetError("outcome_unknown"));
    }
    if (invocationClaim.dispatch.state !== "invoking") {
      return yield* Effect.fail(
        pilotProviderBudgetError("transition_rejected")
      );
    }

    const result = yield* input.invoke.pipe(
      Effect.tapError(() => input.repository.settleUnknown(input.reservation))
    );
    if (result.cost._tag === "Unknown") {
      yield* input.repository.settleUnknown(input.reservation);
      return { _tag: "CompletedUnknownCost", value: result.value };
    }
    if (
      !Number.isSafeInteger(result.cost.actualCostMicroUsd) ||
      result.cost.actualCostMicroUsd < 0 ||
      result.cost.actualCostMicroUsd > input.reservation.maximumCostMicroUsd
    ) {
      yield* input.repository.settleUnknown(input.reservation);
      return yield* Effect.fail(
        pilotProviderBudgetError("cost_exceeds_reservation")
      );
    }
    yield* input.repository.settleKnown({
      ...input.reservation,
      actualCostMicroUsd: result.cost.actualCostMicroUsd,
    });
    return {
      _tag: "Completed",
      actualCostMicroUsd: result.cost.actualCostMicroUsd,
      value: result.value,
    };
  });
