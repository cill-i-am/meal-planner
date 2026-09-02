import {
  HouseholdAssociationVersion,
  HouseholdMemberDepartureOperationId,
  HouseholdOrganizationId,
} from "@meal-planner/household-api";
import type * as Cloudflare from "alchemy/Cloudflare";
import { Cause, Data, Effect, Schema } from "effect";

export const MemberDepartureWorkflowInput = Schema.Struct({
  claimedOperationVersion: HouseholdAssociationVersion,
  executionGeneration: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1))
  ),
  operationId: HouseholdMemberDepartureOperationId,
  organizationId: HouseholdOrganizationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type MemberDepartureWorkflowInput =
  typeof MemberDepartureWorkflowInput.Type;
export type MemberDepartureWorkflowInputEncoded =
  typeof MemberDepartureWorkflowInput.Encoded;

export const MemberDepartureRemovalOutcome = Schema.Struct({
  attemptId: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/u))
  ),
  outcome: Schema.Literals([
    "returned_rejected",
    "returned_success",
    "unknown",
  ]),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type MemberDepartureRemovalOutcome =
  typeof MemberDepartureRemovalOutcome.Type;

export class MemberDepartureWorkflowUnavailable extends Data.TaggedError(
  "MemberDepartureWorkflowUnavailable"
) {}

interface MemberDepartureWorkflowInstance {
  readonly sendEvent: (
    event: Cloudflare.Workflows.WorkflowInstanceEvent<MemberDepartureRemovalOutcome>
  ) => Effect.Effect<void>;
  readonly status: Cloudflare.Workflows.WorkflowInstance["status"];
}

interface MemberDepartureWorkflowHandle {
  readonly createBatch: (
    batch: Cloudflare.Workflows.WorkflowInstanceCreateOptions<MemberDepartureWorkflowInputEncoded>[]
  ) => Effect.Effect<readonly MemberDepartureWorkflowInstance[]>;
  readonly get: (id: string) => Effect.Effect<MemberDepartureWorkflowInstance>;
}

export interface MemberDepartureWorkflowStarter {
  readonly ensureStarted: (
    input: MemberDepartureWorkflowInput
  ) => Effect.Effect<void, MemberDepartureWorkflowUnavailable>;
  readonly signalRemovalOutcome: (
    input: MemberDepartureWorkflowInput,
    outcome: (typeof MemberDepartureRemovalOutcome.Type)["outcome"]
  ) => Effect.Effect<void, MemberDepartureWorkflowUnavailable>;
  readonly confirmTerminal: (
    input: MemberDepartureWorkflowInput
  ) => Effect.Effect<void, MemberDepartureWorkflowUnavailable>;
}

const sha256 = (value: string) =>
  Effect.tryPromise({
    catch: () => new MemberDepartureWorkflowUnavailable(),
    try: async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value)
      );
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
    },
  });

export const memberDepartureWorkflowInstanceId = (
  input: MemberDepartureWorkflowInput
) =>
  sha256(
    JSON.stringify([
      "meal-planner/member-departure-workflow",
      "v1",
      input.organizationId,
      input.operationId,
      input.executionGeneration,
    ])
  );

export const memberDepartureAttemptId = (input: MemberDepartureWorkflowInput) =>
  sha256(
    JSON.stringify([
      "meal-planner/member-departure-attempt",
      "v1",
      input.operationId,
      input.executionGeneration,
      input.claimedOperationVersion,
    ])
  );

const reconcileInstance = (instance: MemberDepartureWorkflowInstance) =>
  instance.status().pipe(
    Effect.filterOrFail(
      ({ status }) =>
        status === "queued" ||
        status === "running" ||
        status === "waiting" ||
        status === "waitingForPause" ||
        status === "complete",
      () => new MemberDepartureWorkflowUnavailable()
    ),
    Effect.asVoid
  );

const confirmTerminalInstance = (instance: MemberDepartureWorkflowInstance) =>
  instance.status().pipe(
    Effect.filterOrFail(
      ({ status }) =>
        status === "complete" ||
        status === "errored" ||
        status === "terminated",
      () => new MemberDepartureWorkflowUnavailable()
    ),
    Effect.asVoid
  );

/** Deterministically create or reconcile the one native departure Workflow. */
export const makeMemberDepartureWorkflowStarter = (
  workflow: MemberDepartureWorkflowHandle
): MemberDepartureWorkflowStarter => ({
  confirmTerminal: (input) =>
    memberDepartureWorkflowInstanceId(input).pipe(
      Effect.flatMap(workflow.get),
      Effect.flatMap(confirmTerminalInstance),
      Effect.mapError(() => new MemberDepartureWorkflowUnavailable())
    ),
  ensureStarted: (input) =>
    Effect.gen(function* ensureMemberDepartureStarted() {
      const [id, params] = yield* Effect.all([
        memberDepartureWorkflowInstanceId(input),
        Schema.encodeEffect(MemberDepartureWorkflowInput)(input),
      ]);
      return yield* workflow.createBatch([{ id, params }]).pipe(
        Effect.flatMap((created) => {
          const [instance] = created;
          return created.length === 1 && instance !== undefined
            ? reconcileInstance(instance)
            : workflow.get(id).pipe(Effect.flatMap(reconcileInstance));
        }),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          () => workflow.get(id).pipe(Effect.flatMap(reconcileInstance))
        )
      );
    }).pipe(Effect.mapError(() => new MemberDepartureWorkflowUnavailable())),
  signalRemovalOutcome: (input, outcome) =>
    Effect.gen(function* signalMemberDepartureOutcome() {
      const [attemptId, instanceId] = yield* Effect.all([
        memberDepartureAttemptId(input),
        memberDepartureWorkflowInstanceId(input),
      ]);
      const instance = yield* workflow.get(instanceId);
      yield* instance.sendEvent({
        payload: { attemptId, outcome },
        type: "membership-removal-outcome",
      });
    }).pipe(Effect.mapError(() => new MemberDepartureWorkflowUnavailable())),
});
