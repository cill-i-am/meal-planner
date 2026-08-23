import type * as Cloudflare from "alchemy/Cloudflare";
import { Cause, Data, Effect, Schema } from "effect";
import { flow } from "effect/Function";

import { HouseholdDispatchId } from "../households/foundation/import-workflow-admission.contract.js";
import { HouseholdOrganizationId } from "../households/household.contract.js";
import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import { ImportTraceContext } from "./import-observability.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import { workflowStartUnavailable } from "./import.errors.js";
import type { WorkflowStartUnavailable } from "./import.errors.js";

export const RecipeRecoveryOrdinal = Schema.Literals([1, 2, 3, 4, 5, 6, 7, 8]);
export type RecipeRecoveryOrdinal = typeof RecipeRecoveryOrdinal.Type;

export const recipeRecoveryDurableTaskNames = (
  ordinal: RecipeRecoveryOrdinal
) =>
  ({
    extraction: `extract-recipe-recovery-v${ordinal}`,
    terminal: `persist-recipe-recovery-terminal-v${ordinal}`,
  }) as const;

/** Workflow-safe projection of the household-owned recovery attempt. */
export const RecipeRecoveryAttempt = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  createdAt: ImportTimestamp,
  currentDispatchId: HouseholdDispatchId,
  currentExtractionFingerprint: Sha256Hex,
  evidenceFingerprint: Sha256Hex,
  executionGeneration: ImportIntentExecutionGeneration,
  importId: ImportId,
  ordinal: RecipeRecoveryOrdinal,
  predecessorDispatchId: HouseholdDispatchId,
  predecessorExtractionFingerprint: Sha256Hex,
  rootDispatchId: HouseholdDispatchId,
  rootExtractionFingerprint: Sha256Hex,
  sourceMediaSha256: Sha256Hex,
  terminalCheckpointCompletedAt: ImportTimestamp,
  transcriptSha256: Sha256Hex,
  visualManifestSha256: Sha256Hex,
});
export type RecipeRecoveryAttempt = typeof RecipeRecoveryAttempt.Type;

export const RecipeRecoveryWorkflowInput = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  attemptOrdinal: RecipeRecoveryOrdinal,
  executionGeneration: ImportIntentExecutionGeneration,
  importId: ImportId,
  organizationId: HouseholdOrganizationId,
  trace: ImportTraceContext,
});
export type RecipeRecoveryWorkflowInput =
  typeof RecipeRecoveryWorkflowInput.Type;
export type RecipeRecoveryWorkflowInputEncoded =
  typeof RecipeRecoveryWorkflowInput.Encoded;

export class InvalidRecipeRecoveryWorkflowInput extends Data.TaggedError(
  "InvalidRecipeRecoveryWorkflowInput"
) {}

export const resolveRecipeRecoveryWorkflowInput = flow(
  Schema.decodeUnknownEffect(RecipeRecoveryWorkflowInput, {
    onExcessProperty: "error",
  }),
  Effect.mapError(() => new InvalidRecipeRecoveryWorkflowInput())
);

export const RecipeRecoveryAuthorization = Schema.Struct({
  acquisitionGeneration: AcquisitionGeneration,
  attemptOrdinal: RecipeRecoveryOrdinal,
  executionGeneration: ImportIntentExecutionGeneration,
  importId: ImportId,
});
export type RecipeRecoveryAuthorization =
  typeof RecipeRecoveryAuthorization.Type;

interface WorkflowInstanceLike {
  readonly restart: Cloudflare.Workflows.WorkflowInstance["restart"];
  readonly sendEvent: (
    event: Cloudflare.Workflows.WorkflowInstanceEvent<RecipeRecoveryAuthorization>
  ) => Effect.Effect<void>;
  readonly status: Cloudflare.Workflows.WorkflowInstance["status"];
}

interface WorkflowHandleLike {
  readonly createBatch: (
    batch: Cloudflare.Workflows.WorkflowInstanceCreateOptions<RecipeRecoveryWorkflowInputEncoded>[]
  ) => Effect.Effect<readonly WorkflowInstanceLike[]>;
  readonly get: (id: string) => Effect.Effect<WorkflowInstanceLike>;
}

const signalableWorkflowStatuses = new Set([
  "queued",
  "running",
  "waiting",
  "waitingForPause",
]);

export const recipeRecoveryAuthorizationEventType = (
  ordinal: RecipeRecoveryOrdinal
) => `recipe-recovery-authorized-${ordinal}`;

const signalRecoveryAuthorization = (
  instance: WorkflowInstanceLike,
  attempt: RecipeRecoveryAttempt
) =>
  attempt.ordinal === 1
    ? Effect.void
    : instance.sendEvent({
        payload: {
          acquisitionGeneration: attempt.acquisitionGeneration,
          attemptOrdinal: attempt.ordinal,
          executionGeneration: attempt.executionGeneration,
          importId: attempt.importId,
        },
        type: recipeRecoveryAuthorizationEventType(attempt.ordinal),
      });

const reconcileWorkflowInstance = (
  instance: WorkflowInstanceLike,
  attempt: RecipeRecoveryAttempt
) =>
  instance.status().pipe(
    Effect.flatMap(({ status }) => {
      if (status === "complete") {
        return Effect.void;
      }
      if (status === "errored") {
        return instance
          .restart()
          .pipe(Effect.andThen(signalRecoveryAuthorization(instance, attempt)));
      }
      if (!signalableWorkflowStatuses.has(status)) {
        return Effect.fail(workflowStartUnavailable());
      }
      return signalRecoveryAuthorization(instance, attempt);
    })
  );

export interface RecipeRecoveryWorkflowStarter {
  readonly start: (
    attempt: RecipeRecoveryAttempt,
    trace: ImportTraceContext,
    organizationId: HouseholdOrganizationId
  ) => Effect.Effect<void, WorkflowStartUnavailable>;
}

export const recipeRecoveryWorkflowInstanceId = (
  importId: ImportId,
  acquisitionGeneration: AcquisitionGeneration
) => `import-recipe-recovery-${importId}-${acquisitionGeneration}`;

export const makeRecipeRecoveryWorkflowStarter = (
  workflow: WorkflowHandleLike
): RecipeRecoveryWorkflowStarter => ({
  start: Effect.fn("RecipeRecoveryWorkflowStarter.start")(
    function* startRecipeRecoveryWorkflow(attempt, trace, organizationId) {
      const id = recipeRecoveryWorkflowInstanceId(
        attempt.importId,
        attempt.acquisitionGeneration
      );
      const params = yield* Schema.decodeUnknownEffect(
        RecipeRecoveryWorkflowInput,
        { onExcessProperty: "error" }
      )({
        acquisitionGeneration: attempt.acquisitionGeneration,
        attemptOrdinal: attempt.ordinal,
        executionGeneration: attempt.executionGeneration,
        importId: attempt.importId,
        organizationId,
        trace,
      }).pipe(Effect.mapError(() => workflowStartUnavailable()));
      return yield* workflow.createBatch([{ id, params }]).pipe(
        Effect.flatMap((created) => {
          if (created.length === 1) {
            return Effect.void;
          }
          if (created.length === 0) {
            return workflow
              .get(id)
              .pipe(
                Effect.flatMap((instance) =>
                  reconcileWorkflowInstance(instance, attempt)
                )
              );
          }
          return Effect.fail(workflowStartUnavailable());
        }),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          () =>
            workflow
              .get(id)
              .pipe(
                Effect.flatMap((instance) =>
                  reconcileWorkflowInstance(instance, attempt)
                )
              )
        ),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          () => Effect.fail(workflowStartUnavailable())
        )
      );
    }
  ),
});
