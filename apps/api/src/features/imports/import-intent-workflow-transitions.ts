import {
  Instant,
  RecoveryGuidance,
  RecipeImportActionId,
  RecipeImportIntentId,
  StablePublicErrorCode,
  StepProgress,
} from "@meal-planner/recipe-import-api";
import { Clock, Effect, Schema } from "effect";

import {
  ImportIntentExecutionGeneration,
  ImportIntentProcessingStageName,
  ImportIntentTransitionCommand,
  ImportIntentTransitionCommandDigest,
  ImportIntentTransitionMutationId,
  ImportIntentWorkflowBoundary,
} from "./import-intent-transition.js";
import type { AcquisitionTaskOutcome } from "./import-media.model.js";
import type { ProviderTaskStage } from "./import-provider-workflow-task.js";
import type { ImportIntentRepositoryShape } from "./import.repository.js";

export const PublicIntentFailure = Schema.Struct({
  code: StablePublicErrorCode,
  message: Schema.String.pipe(
    Schema.check(
      Schema.isTrimmed(),
      Schema.isNonEmpty(),
      Schema.isMaxLength(4096)
    )
  ),
  recovery: RecoveryGuidance,
});
export type PublicIntentFailure = typeof PublicIntentFailure.Type;

const sourceUnavailable = (message: string): PublicIntentFailure => ({
  code: "source_unavailable",
  message,
  recovery: "create_new_intent",
});

export const publicIntentFailureForAcquisitionOutcome = (
  outcome: Exclude<
    AcquisitionTaskOutcome,
    { readonly _tag: "VerifiedAcquisition" }
  >
): PublicIntentFailure => {
  switch (outcome._tag) {
    case "Unavailable":
      return sourceUnavailable("The source is unavailable.");
    case "UnsupportedCarousel":
      return {
        code: "unsupported_source",
        message: "This source type is not supported.",
        recovery: "create_new_intent",
      };
    case "TerminalMedia":
      return {
        code: "invalid_media",
        message: "The source does not contain supported media.",
        recovery: "create_new_intent",
      };
    case "RetryExhausted":
      return sourceUnavailable("The source is temporarily unavailable.");
  }
};

export const publicIntentFailureForProviderStage = (
  stage: ProviderTaskStage
): PublicIntentFailure =>
  stage === "recipe"
    ? {
        code: "recipe_extraction_failed",
        message: "A recipe could not be extracted from this source.",
        recovery: "create_new_intent",
      }
    : {
        code: "analysis_failed",
        message: "The source could not be analyzed.",
        recovery: "create_new_intent",
      };

export const unexpectedExecutorFailure: PublicIntentFailure = {
  code: "internal_error",
  message: "The import could not be completed.",
  recovery: "contact_support",
};

const WorkflowTransitionPayload = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("AdvanceStage"),
    stage: ImportIntentProcessingStageName,
  }),
  Schema.Struct({
    _tag: Schema.Literal("AdvanceComponent"),
    component: Schema.Literals(["speech", "visuals"]),
    progress: StepProgress,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RequireAction"),
    actionId: RecipeImportActionId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetActivity"),
    activity: Schema.Literals(["working", "retrying"]),
    attempt: Schema.Number.pipe(
      Schema.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(1),
        Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
      )
    ),
    boundary: ImportIntentWorkflowBoundary,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Fail"),
    boundary: ImportIntentWorkflowBoundary,
    ...PublicIntentFailure.fields,
  }),
]);
type WorkflowTransitionPayload = typeof WorkflowTransitionPayload.Type;

const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

const sha256 = (value: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  ).pipe(Effect.map(bytesToHex));

const semanticKeyFor = (payload: WorkflowTransitionPayload) => {
  switch (payload._tag) {
    case "AdvanceStage":
      return `stage:${payload.stage}`;
    case "AdvanceComponent":
      return `component:${payload.component}:${payload.progress}`;
    case "RequireAction":
      return `action:${payload.actionId}`;
    case "SetActivity":
      return `activity:${payload.boundary}:${payload.attempt}:${payload.activity}`;
    case "Fail":
      return `failure:${payload.boundary}:${payload.code}`;
  }
};

const currentInstant = Clock.currentTimeMillis.pipe(
  Effect.map((millis) =>
    Schema.decodeUnknownSync(Instant)(new Date(millis).toISOString())
  )
);

export interface ImportIntentWorkflowTransitionRejected {
  readonly _tag: "ImportIntentWorkflowTransitionRejected";
  readonly reason: string;
}
export const ImportIntentWorkflowTransitionRejected =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<ImportIntentWorkflowTransitionRejected>()(
    "ImportIntentWorkflowTransitionRejected",
    { reason: Schema.String }
  );

export interface ImportIntentWorkflowTransitionsShape {
  readonly advanceComponent: (
    component: "speech" | "visuals",
    progress: "not_started" | "processing" | "completed" | "skipped"
  ) => Effect.Effect<void, unknown>;
  readonly advanceStage: (
    stage: typeof ImportIntentProcessingStageName.Type
  ) => Effect.Effect<void, unknown>;
  readonly requireAction: (
    actionId: typeof RecipeImportActionId.Type
  ) => Effect.Effect<void, unknown>;
  readonly setActivity: (
    boundary: typeof ImportIntentWorkflowBoundary.Type,
    attempt: number,
    activity: "working" | "retrying"
  ) => Effect.Effect<void, unknown>;
  readonly fail: (
    boundary: typeof ImportIntentWorkflowBoundary.Type,
    failure: PublicIntentFailure
  ) => Effect.Effect<void, unknown>;
}

/** Build and apply replay-stable, provider-neutral executor transitions. */
export const makeImportIntentWorkflowTransitions = (input: {
  readonly executionGeneration: typeof ImportIntentExecutionGeneration.Type;
  readonly intentId: typeof RecipeImportIntentId.Type;
  readonly repository: Pick<ImportIntentRepositoryShape, "transitionIntent">;
}): ImportIntentWorkflowTransitionsShape => {
  const apply = Effect.fn("RecipeImportIntent.executorTransition")(
    function* applyWorkflowTransition(rawPayload: WorkflowTransitionPayload) {
      const payload = yield* Schema.decodeUnknownEffect(
        WorkflowTransitionPayload,
        { onExcessProperty: "error" }
      )(rawPayload);
      const encoded = Schema.encodeSync(WorkflowTransitionPayload)(payload);
      const namespace = `recipe-import-intent-transition:v1:${input.intentId}:g:${input.executionGeneration}:${semanticKeyFor(payload)}`;
      const [mutationId, commandDigest, occurredAt] = yield* Effect.all([
        sha256(namespace).pipe(
          Effect.map(Schema.decodeUnknownSync(ImportIntentTransitionMutationId))
        ),
        sha256(JSON.stringify(encoded)).pipe(
          Effect.map(
            Schema.decodeUnknownSync(ImportIntentTransitionCommandDigest)
          )
        ),
        currentInstant,
      ]);
      const command = yield* Schema.decodeUnknownEffect(
        ImportIntentTransitionCommand,
        { onExcessProperty: "error" }
      )({
        ...encoded,
        commandDigest,
        executionGeneration: input.executionGeneration,
        intentId: input.intentId,
        mutationId,
        occurredAt: Schema.encodeSync(Instant)(occurredAt),
      });
      const outcome = yield* input.repository.transitionIntent(command);
      if (outcome._tag === "Rejected") {
        return yield* Effect.fail(
          new ImportIntentWorkflowTransitionRejected({
            reason: outcome.reason,
          })
        );
      }
    }
  );

  return {
    advanceComponent: (component, progress) =>
      apply({ _tag: "AdvanceComponent", component, progress }),
    advanceStage: (stage) => apply({ _tag: "AdvanceStage", stage }),
    requireAction: (actionId) => apply({ _tag: "RequireAction", actionId }),
    setActivity: (boundary, attempt, activity) =>
      apply({ _tag: "SetActivity", activity, attempt, boundary }),
    fail: (boundary, failure) =>
      apply({ _tag: "Fail", boundary, ...failure }),
  };
};
