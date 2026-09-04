import { HouseholdMemberDepartureOperation } from "@meal-planner/household-api";
import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Exit, Schema } from "effect";

import { MealPlannerAuthDatabase } from "../../../infrastructure/meal-planner-auth-database.js";
import * as authSchema from "../../auth/auth.database-schema.js";
import { HouseholdDomainWorker } from "../household-domain-worker.js";
import type { HouseholdDomainWorkerMethods } from "../household-domain-worker.js";
import {
  HouseholdConfirmMemberAccessRevokedInput,
  HouseholdFinalizeMemberDepartureInput,
  HouseholdMemberDepartureSystemState,
  HouseholdMarkMemberDepartureRepairRequiredInput,
  HouseholdReadMemberDepartureSystemInput,
} from "./household-people.contract.js";
import { deriveHouseholdPersonLinkageSubject } from "./household-people.identity.js";
import type { MemberDepartureRemovalOutcome } from "./member-departure.js";
import {
  memberDepartureAttemptId,
  MemberDepartureWorkflowInput,
} from "./member-departure.js";

const StepOptions = {
  retries: { backoff: "exponential", delay: "2 seconds", limit: 5 },
  timeout: "30 seconds",
} as const;

const MembershipObservation = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Observed"), present: Schema.Boolean }),
  Schema.Struct({ _tag: Schema.Literal("Unavailable") }),
]);

const makeSystemAdmission = (organizationId: HouseholdOrganizationId) => ({
  actor: {
    _tag: "System" as const,
    purpose: "member_departure_finalize" as const,
  },
  organizationId,
});

const decodeOperation = Schema.decodeUnknownEffect(
  HouseholdMemberDepartureOperation,
  { onExcessProperty: "error" }
);
const decodeSystemState = Schema.decodeUnknownEffect(
  HouseholdMemberDepartureSystemState,
  { onExcessProperty: "error" }
);

export interface MemberDepartureWorkflowPorts {
  readonly confirmAccessRevoked: (
    state: typeof HouseholdMemberDepartureSystemState.Type
  ) => Effect.Effect<
    typeof HouseholdMemberDepartureOperation.Type,
    never,
    RuntimeContext
  >;
  readonly finalize: (
    operation: typeof HouseholdMemberDepartureOperation.Type
  ) => Effect.Effect<
    typeof HouseholdMemberDepartureOperation.Type,
    never,
    RuntimeContext
  >;
  readonly markRepairRequired: (
    state: typeof HouseholdMemberDepartureSystemState.Type,
    phase: "finalization" | "revocation"
  ) => Effect.Effect<
    typeof HouseholdMemberDepartureOperation.Type,
    never,
    RuntimeContext
  >;
  readonly observeMembership: (
    state: typeof HouseholdMemberDepartureSystemState.Type
  ) => Effect.Effect<typeof MembershipObservation.Type, never, RuntimeContext>;
  readonly readState: () => Effect.Effect<
    typeof HouseholdMemberDepartureSystemState.Type,
    never,
    RuntimeContext
  >;
}

export type MemberDepartureHouseholdPort = Pick<
  HouseholdDomainWorkerMethods,
  | "confirmMemberAccessRevoked"
  | "finalizeMemberDeparture"
  | "getMemberDeparture"
  | "markMemberDepartureRepairRequired"
>;

/** Production coordination core, exercised under a native Workflow in tests. */
export const coordinateMemberDeparture = Effect.fn(
  function* coordinateMemberDeparture(
    input: typeof MemberDepartureWorkflowInput.Type,
    ports: MemberDepartureWorkflowPorts,
    stepOptions = StepOptions,
    outcomeTimeout: string | number = "1 minute"
  ) {
    const initial = yield* Cloudflare.Workflows.task(
      "read-member-departure-v1",
      ports.readState(),
      stepOptions
    );
    if (
      initial.operation.state === "completed" ||
      initial.operation.state === "cancelled"
    ) {
      return initial.operation;
    }

    if (initial.operation.state === "revoking_access") {
      const expectedAttemptId = yield* memberDepartureAttemptId(input).pipe(
        Effect.orDie
      );
      const outcome =
        yield* Cloudflare.Workflows.waitForEvent<MemberDepartureRemovalOutcome>(
          "wait-membership-removal-outcome-v1",
          { timeout: outcomeTimeout, type: "membership-removal-outcome" }
        ).pipe(Effect.exit);
      if (
        Exit.isSuccess(outcome) &&
        outcome.value.payload.attemptId !== expectedAttemptId
      ) {
        return yield* Cloudflare.Workflows.task(
          "mark-member-revocation-event-collision-v1",
          ports.markRepairRequired(initial, "revocation"),
          stepOptions
        );
      }
    }

    const current = yield* Cloudflare.Workflows.task(
      "read-member-departure-after-wait-v1",
      ports.readState(),
      stepOptions
    );
    const membership = yield* Cloudflare.Workflows.task(
      "reconcile-member-presence-v1",
      ports.observeMembership(current),
      stepOptions
    );
    if (membership._tag === "Unavailable" || membership.present) {
      return yield* Cloudflare.Workflows.task(
        "mark-member-revocation-repair-v1",
        ports.markRepairRequired(current, "revocation"),
        stepOptions
      );
    }

    const revoked =
      current.operation.state === "access_revoked" ||
      current.operation.state === "finalization_repair_required"
        ? current.operation
        : yield* Cloudflare.Workflows.task(
            "confirm-member-access-revoked-v1",
            ports.confirmAccessRevoked(current),
            stepOptions
          );
    const finalState = yield* Cloudflare.Workflows.task(
      "read-member-departure-before-finalize-v1",
      ports.readState(),
      stepOptions
    );
    const finalMembership = yield* Cloudflare.Workflows.task(
      "final-member-absence-read-v1",
      ports.observeMembership(finalState),
      stepOptions
    );
    return yield* Cloudflare.Workflows.task(
      "finalize-member-departure-v1",
      finalMembership._tag === "Observed" && !finalMembership.present
        ? ports.finalize(revoked)
        : ports.markRepairRequired(
            { ...finalState, operation: revoked },
            "finalization"
          ),
      stepOptions
    );
  }
);

export const makeMemberDepartureWorkflowPorts = (options: {
  readonly authDatabase: Effect.Effect<AnyD1Database, never, RuntimeContext>;
  readonly household: MemberDepartureHouseholdPort;
  readonly input: typeof MemberDepartureWorkflowInput.Type;
}): MemberDepartureWorkflowPorts => {
  const admission = makeSystemAdmission(options.input.organizationId);
  const readState = () =>
    Schema.decodeUnknownEffect(HouseholdReadMemberDepartureSystemInput)({
      admission,
      operationId: options.input.operationId,
    }).pipe(
      Effect.flatMap((command) =>
        options.household.getMemberDeparture(command)
      ),
      Effect.flatMap(decodeSystemState)
    );
  return {
    confirmAccessRevoked: (state) =>
      Schema.decodeUnknownEffect(HouseholdConfirmMemberAccessRevokedInput)({
        admission,
        expectedOperationVersion: state.operation.version,
        operationId: options.input.operationId,
      }).pipe(
        Effect.flatMap((command) =>
          options.household.confirmMemberAccessRevoked(command)
        ),
        Effect.flatMap(decodeOperation),
        Effect.orDie
      ),
    finalize: (operation) =>
      Schema.decodeUnknownEffect(HouseholdFinalizeMemberDepartureInput)({
        admission,
        expectedOperationVersion: operation.version,
        operationId: options.input.operationId,
      }).pipe(
        Effect.flatMap((command) =>
          options.household.finalizeMemberDeparture(command)
        ),
        Effect.flatMap(decodeOperation),
        Effect.orDie
      ),
    markRepairRequired: (state, phase) =>
      Schema.decodeUnknownEffect(
        HouseholdMarkMemberDepartureRepairRequiredInput
      )({
        admission,
        expectedOperationVersion: state.operation.version,
        operationId: options.input.operationId,
        phase,
      }).pipe(
        Effect.flatMap((command) =>
          options.household.markMemberDepartureRepairRequired(command)
        ),
        Effect.flatMap(decodeOperation),
        Effect.orDie
      ),
    observeMembership: (state) =>
      Effect.gen(function* inspectMembership() {
        const database = drizzle(yield* options.authDatabase);
        const members = yield* Effect.promise(() =>
          database
            .select({ userId: authSchema.member.userId })
            .from(authSchema.member)
            .where(
              eq(authSchema.member.organizationId, options.input.organizationId)
            )
        );
        const linkageSubjects = yield* Effect.all(
          members.map(({ userId }) =>
            deriveHouseholdPersonLinkageSubject(
              options.input.organizationId,
              userId
            )
          )
        );
        return {
          _tag: "Observed" as const,
          present: linkageSubjects.some(
            (subject) => subject === state.targetLinkageSubject
          ),
        };
      }).pipe(
        Effect.matchEffect({
          onFailure: () => Effect.succeed({ _tag: "Unavailable" as const }),
          onSuccess: Effect.succeed,
        })
      ),
    readState: () => readState().pipe(Effect.orDie),
  };
};

/** Native Workflow host for one membership revocation and Household finalization. */
export default class MemberDepartureWorkflow extends Cloudflare.Workflow<MemberDepartureWorkflow>()(
  "MemberDepartureWorkflow",
  Effect.gen(function* makeMemberDepartureWorkflow() {
    const authQueryDatabase = yield* Cloudflare.D1.QueryDatabase(
      MealPlannerAuthDatabase
    );
    const household: HouseholdDomainWorkerMethods =
      yield* Cloudflare.Workers.bindWorker(HouseholdDomainWorker);

    return (rawInput: typeof MemberDepartureWorkflowInput.Encoded) =>
      Effect.gen(function* runMemberDepartureWorkflow() {
        const input = yield* Schema.decodeUnknownEffect(
          MemberDepartureWorkflowInput,
          { onExcessProperty: "error" }
        )(rawInput).pipe(Effect.orDie);
        const ports = makeMemberDepartureWorkflowPorts({
          authDatabase: authQueryDatabase.raw,
          household,
          input,
        });
        return yield* coordinateMemberDeparture(input, ports);
      });
  }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseBinding))
) {}
