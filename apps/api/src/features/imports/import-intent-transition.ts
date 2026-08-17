import {
  CanonicalTikTokUrl,
  Instant,
  RecoveryGuidance,
  RecipeImportActionId,
  RecipeImportIntentId,
  RecipeImportIntentVersion,
  StablePublicErrorCode,
  StepProgress,
} from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

import { SourceCanonicalId } from "./import.contracts.js";

const SafeInteger = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const PositiveSafeInteger = SafeInteger.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1))
);
const SafePublicFailureMessage = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(4096)
  )
);
const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

export const ImportIntentExecutionGeneration = SafeInteger.pipe(
  Schema.brand("ImportIntentExecutionGeneration")
);
export type ImportIntentExecutionGeneration =
  typeof ImportIntentExecutionGeneration.Type;

export const ImportIntentTransitionMutationId = Sha256Hex.pipe(
  Schema.brand("ImportIntentTransitionMutationId")
);
export type ImportIntentTransitionMutationId =
  typeof ImportIntentTransitionMutationId.Type;

export const ImportIntentTransitionCommandDigest = Sha256Hex.pipe(
  Schema.brand("ImportIntentTransitionCommandDigest")
);
export type ImportIntentTransitionCommandDigest =
  typeof ImportIntentTransitionCommandDigest.Type;

export interface ImportIntentTransitionMutationConflict {
  readonly _tag: "ImportIntentTransitionMutationConflict";
}
export const ImportIntentTransitionMutationConflict =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<ImportIntentTransitionMutationConflict>()(
    "ImportIntentTransitionMutationConflict",
    {}
  );

export const ImportIntentProcessingStageName = Schema.Literals([
  "resolving_source",
  "acquiring_media",
  "analyzing_evidence",
  "extracting_recipe",
  "grounding_recipe",
  "preparing_review",
  "finalizing_recipe",
]);
export type ImportIntentProcessingStageName =
  typeof ImportIntentProcessingStageName.Type;

export const ImportIntentWorkflowBoundary = Schema.Literals([
  "acquisition",
  "speech",
  "visual",
  "recipe",
  "executor",
]);
export type ImportIntentWorkflowBoundary =
  typeof ImportIntentWorkflowBoundary.Type;

const TransitionMetadata = {
  commandDigest: ImportIntentTransitionCommandDigest,
  executionGeneration: ImportIntentExecutionGeneration,
  intentId: RecipeImportIntentId,
  mutationId: ImportIntentTransitionMutationId,
  occurredAt: Instant,
} as const;

export const ImportIntentTransitionCommand = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("ResolveSource"),
    ...TransitionMetadata,
    canonicalSourceId: SourceCanonicalId,
    canonicalUrl: CanonicalTikTokUrl,
    sourceKind: Schema.Literals(["video", "carousel"]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Redirect"),
    ...TransitionMetadata,
    canonicalSourceId: SourceCanonicalId,
    canonicalUrl: CanonicalTikTokUrl,
    redirectedToIntentId: RecipeImportIntentId,
    sourceKind: Schema.Literals(["video", "carousel"]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("AdvanceStage"),
    ...TransitionMetadata,
    stage: ImportIntentProcessingStageName,
  }),
  Schema.Struct({
    _tag: Schema.Literal("AdvanceComponent"),
    ...TransitionMetadata,
    component: Schema.Literals(["speech", "visuals"]),
    progress: StepProgress,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RequireAction"),
    ...TransitionMetadata,
    actionId: RecipeImportActionId,
  }),
  Schema.Union([
    Schema.Struct({
      _tag: Schema.Literal("SetActivity"),
      ...TransitionMetadata,
      activity: Schema.Literal("working"),
      attempt: PositiveSafeInteger,
      boundary: ImportIntentWorkflowBoundary,
    }),
    Schema.Struct({
      _tag: Schema.Literal("SetActivity"),
      ...TransitionMetadata,
      activity: Schema.Literal("retrying"),
      attempt: PositiveSafeInteger,
      boundary: ImportIntentWorkflowBoundary,
      nextAttemptAt: Schema.optionalKey(Instant),
    }),
  ]),
  Schema.Struct({
    _tag: Schema.Literal("Fail"),
    ...TransitionMetadata,
    boundary: ImportIntentWorkflowBoundary,
    code: StablePublicErrorCode,
    message: SafePublicFailureMessage,
    recovery: RecoveryGuidance,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Cancel"),
    ...TransitionMetadata,
    expectedIntentVersion: RecipeImportIntentVersion,
  }),
]);
export type ImportIntentTransitionCommand =
  typeof ImportIntentTransitionCommand.Type;

export const ImportIntentTransitionSnapshot = Schema.Struct({
  activeActionId: Schema.NullOr(RecipeImportActionId),
  activity: Schema.NullOr(Schema.Literals(["working", "retrying"])),
  executionGeneration: ImportIntentExecutionGeneration,
  failedAt: Schema.NullOr(Instant),
  failureCode: Schema.NullOr(StablePublicErrorCode),
  failureMessage: Schema.NullOr(SafePublicFailureMessage),
  failureRecovery: Schema.NullOr(RecoveryGuidance),
  intentVersion: RecipeImportIntentVersion,
  nextAttemptAt: Schema.NullOr(Instant),
  redirectedAt: Schema.NullOr(Instant),
  redirectedToIntentId: Schema.NullOr(RecipeImportIntentId),
  resolvedCanonicalSourceId: Schema.NullOr(SourceCanonicalId),
  sourceKind: Schema.NullOr(Schema.Literals(["video", "carousel"])),
  sourceUrl: Schema.NullOr(CanonicalTikTokUrl),
  speech: Schema.NullOr(StepProgress),
  stage: Schema.NullOr(ImportIntentProcessingStageName),
  stageStartedAt: Schema.NullOr(Instant),
  status: Schema.Literals([
    "processing",
    "requires_action",
    "succeeded",
    "failed",
    "cancelled",
    "redirected",
  ]),
  updatedAt: Instant,
  visuals: Schema.NullOr(StepProgress),
});
export type ImportIntentTransitionSnapshot =
  typeof ImportIntentTransitionSnapshot.Type;

export type ImportIntentTransitionOutcome =
  | {
      readonly _tag: "Applied";
      readonly snapshot: ImportIntentTransitionSnapshot;
    }
  | {
      readonly _tag: "NoOp";
      readonly reason:
        | "stale_generation"
        | "state_not_processing"
        | "replayed_mutation"
        | "superseded_milestone"
        | "terminal_state"
        | "unchanged_activity";
      readonly snapshot: ImportIntentTransitionSnapshot;
    }
  | {
      readonly _tag: "Rejected";
      readonly reason:
        | "analysis_incomplete"
        | "component_not_active"
        | "future_generation"
        | "intent_version_conflict"
        | "invalid_action_transition"
        | "invalid_cancel_transition"
        | "illegal_component_transition"
        | "non_sequential_stage"
        | "source_already_resolved"
        | "source_resolution_not_active";
      readonly snapshot: ImportIntentTransitionSnapshot;
    };

const stageOrdinal = (stage: ImportIntentProcessingStageName) => {
  switch (stage) {
    case "resolving_source": {
      return 0;
    }
    case "acquiring_media": {
      return 1;
    }
    case "analyzing_evidence": {
      return 2;
    }
    case "extracting_recipe": {
      return 3;
    }
    case "grounding_recipe": {
      return 4;
    }
    case "preparing_review": {
      return 5;
    }
    case "finalizing_recipe": {
      return 6;
    }
    default: {
      return stage satisfies never;
    }
  }
};

const terminalComponent = (progress: StepProgress | null) =>
  progress === "completed" || progress === "skipped";

const applied = (
  snapshot: ImportIntentTransitionSnapshot,
  occurredAt: Instant,
  changes: Partial<ImportIntentTransitionSnapshot>
): ImportIntentTransitionOutcome => ({
  _tag: "Applied",
  snapshot: Schema.decodeUnknownSync(
    Schema.toType(ImportIntentTransitionSnapshot)
  )({
    ...snapshot,
    ...changes,
    intentVersion: snapshot.intentVersion + 1,
    updatedAt: occurredAt,
  }),
});

const noOp = (
  snapshot: ImportIntentTransitionSnapshot,
  reason: Extract<ImportIntentTransitionOutcome, { _tag: "NoOp" }>["reason"]
): ImportIntentTransitionOutcome => ({ _tag: "NoOp", reason, snapshot });

const rejected = (
  snapshot: ImportIntentTransitionSnapshot,
  reason: Extract<ImportIntentTransitionOutcome, { _tag: "Rejected" }>["reason"]
): ImportIntentTransitionOutcome => ({ _tag: "Rejected", reason, snapshot });

const advanceStage = (
  snapshot: ImportIntentTransitionSnapshot,
  command: Extract<ImportIntentTransitionCommand, { _tag: "AdvanceStage" }>
): ImportIntentTransitionOutcome => {
  if (snapshot.stage === null) {
    return rejected(snapshot, "non_sequential_stage");
  }
  const currentOrdinal = stageOrdinal(snapshot.stage);
  const requestedOrdinal = stageOrdinal(command.stage);
  if (requestedOrdinal <= currentOrdinal) {
    return noOp(snapshot, "superseded_milestone");
  }
  if (requestedOrdinal !== currentOrdinal + 1) {
    return rejected(snapshot, "non_sequential_stage");
  }
  if (
    command.stage === "extracting_recipe" &&
    (!terminalComponent(snapshot.speech) ||
      !terminalComponent(snapshot.visuals))
  ) {
    return rejected(snapshot, "analysis_incomplete");
  }
  return applied(snapshot, command.occurredAt, {
    speech: command.stage === "analyzing_evidence" ? "not_started" : null,
    stage: command.stage,
    stageStartedAt: command.occurredAt,
    visuals: command.stage === "analyzing_evidence" ? "not_started" : null,
  });
};

const resolveSource = (
  snapshot: ImportIntentTransitionSnapshot,
  command: Extract<ImportIntentTransitionCommand, { _tag: "ResolveSource" }>
): ImportIntentTransitionOutcome => {
  if (snapshot.stage !== "resolving_source") {
    return rejected(snapshot, "source_resolution_not_active");
  }
  if (snapshot.resolvedCanonicalSourceId !== null) {
    return rejected(snapshot, "source_already_resolved");
  }
  return applied(snapshot, command.occurredAt, {
    activity: "working",
    redirectedAt: null,
    redirectedToIntentId: null,
    resolvedCanonicalSourceId: command.canonicalSourceId,
    sourceKind: command.sourceKind,
    sourceUrl: command.canonicalUrl,
    stage: "acquiring_media",
    stageStartedAt: command.occurredAt,
  });
};

const redirect = (
  snapshot: ImportIntentTransitionSnapshot,
  command: Extract<ImportIntentTransitionCommand, { _tag: "Redirect" }>
): ImportIntentTransitionOutcome => {
  if (snapshot.stage !== "resolving_source") {
    return rejected(snapshot, "source_resolution_not_active");
  }
  if (snapshot.resolvedCanonicalSourceId !== null) {
    return rejected(snapshot, "source_already_resolved");
  }
  return applied(snapshot, command.occurredAt, {
    activeActionId: null,
    activity: null,
    nextAttemptAt: null,
    redirectedAt: command.occurredAt,
    redirectedToIntentId: command.redirectedToIntentId,
    resolvedCanonicalSourceId: command.canonicalSourceId,
    sourceKind: command.sourceKind,
    sourceUrl: command.canonicalUrl,
    speech: null,
    stage: null,
    stageStartedAt: null,
    status: "redirected",
    visuals: null,
  });
};

const progressOrdinal = (progress: StepProgress) => {
  switch (progress) {
    case "not_started": {
      return 0;
    }
    case "processing": {
      return 1;
    }
    case "completed":
    case "skipped": {
      return 2;
    }
    default: {
      return progress satisfies never;
    }
  }
};

const advanceComponent = (
  snapshot: ImportIntentTransitionSnapshot,
  command: Extract<ImportIntentTransitionCommand, { _tag: "AdvanceComponent" }>
): ImportIntentTransitionOutcome => {
  if (snapshot.stage !== "analyzing_evidence") {
    if (
      snapshot.stage !== null &&
      stageOrdinal(snapshot.stage) > stageOrdinal("analyzing_evidence")
    ) {
      return noOp(snapshot, "superseded_milestone");
    }
    return rejected(snapshot, "component_not_active");
  }
  const current = snapshot[command.component];
  if (current === null) {
    return rejected(snapshot, "component_not_active");
  }
  if (
    current === command.progress ||
    progressOrdinal(command.progress) < progressOrdinal(current)
  ) {
    return noOp(snapshot, "superseded_milestone");
  }
  if (
    terminalComponent(current) ||
    (command.progress === "skipped" && snapshot.sourceKind !== "carousel")
  ) {
    return rejected(snapshot, "illegal_component_transition");
  }
  return applied(snapshot, command.occurredAt, {
    [command.component]: command.progress,
  });
};

const requireAction = (
  snapshot: ImportIntentTransitionSnapshot,
  command: Extract<ImportIntentTransitionCommand, { _tag: "RequireAction" }>
): ImportIntentTransitionOutcome => {
  if (snapshot.stage !== "preparing_review") {
    return rejected(snapshot, "invalid_action_transition");
  }
  return applied(snapshot, command.occurredAt, {
    activeActionId: command.actionId,
    activity: null,
    nextAttemptAt: null,
    speech: null,
    stage: null,
    stageStartedAt: null,
    status: "requires_action",
    visuals: null,
  });
};

const setActivity = (
  snapshot: ImportIntentTransitionSnapshot,
  command: Extract<ImportIntentTransitionCommand, { _tag: "SetActivity" }>
): ImportIntentTransitionOutcome => {
  const nextAttemptAt =
    command.activity === "retrying" && command.nextAttemptAt !== undefined
      ? command.nextAttemptAt
      : null;
  if (
    snapshot.activity === command.activity &&
    snapshot.nextAttemptAt === nextAttemptAt
  ) {
    return noOp(snapshot, "unchanged_activity");
  }
  return applied(snapshot, command.occurredAt, {
    activity: command.activity,
    nextAttemptAt,
  });
};

const fail = (
  snapshot: ImportIntentTransitionSnapshot,
  command: Extract<ImportIntentTransitionCommand, { _tag: "Fail" }>
): ImportIntentTransitionOutcome =>
  applied(snapshot, command.occurredAt, {
    activeActionId: null,
    activity: null,
    failedAt: command.occurredAt,
    failureCode: command.code,
    failureMessage: command.message,
    failureRecovery: command.recovery,
    nextAttemptAt: null,
    speech: null,
    stage: null,
    stageStartedAt: null,
    status: "failed",
    visuals: null,
  });

const cancel = (
  snapshot: ImportIntentTransitionSnapshot,
  command: Extract<ImportIntentTransitionCommand, { _tag: "Cancel" }>
): ImportIntentTransitionOutcome => {
  if (snapshot.intentVersion !== command.expectedIntentVersion) {
    return rejected(snapshot, "intent_version_conflict");
  }
  if (
    snapshot.status !== "processing" &&
    snapshot.status !== "requires_action"
  ) {
    return rejected(snapshot, "invalid_cancel_transition");
  }
  return applied(snapshot, command.occurredAt, {
    activeActionId: null,
    activity: null,
    failureCode: null,
    failureMessage: null,
    failureRecovery: null,
    nextAttemptAt: null,
    speech: null,
    stage: null,
    stageStartedAt: null,
    status: "cancelled",
    visuals: null,
  });
};

/** Pure monotonic policy shared by the application and D1 transition seam. */
export const applyImportIntentTransition = (
  snapshot: ImportIntentTransitionSnapshot,
  command: ImportIntentTransitionCommand
): ImportIntentTransitionOutcome => {
  if (command._tag === "Cancel") {
    if (command.executionGeneration < snapshot.executionGeneration) {
      return noOp(snapshot, "stale_generation");
    }
    if (command.executionGeneration > snapshot.executionGeneration) {
      return rejected(snapshot, "future_generation");
    }
    return cancel(snapshot, command);
  }
  if (
    snapshot.status === "succeeded" ||
    snapshot.status === "failed" ||
    snapshot.status === "cancelled" ||
    snapshot.status === "redirected"
  ) {
    return noOp(snapshot, "terminal_state");
  }
  if (snapshot.status !== "processing") {
    return noOp(snapshot, "state_not_processing");
  }
  if (command.executionGeneration < snapshot.executionGeneration) {
    return noOp(snapshot, "stale_generation");
  }
  if (command.executionGeneration > snapshot.executionGeneration) {
    return rejected(snapshot, "future_generation");
  }
  switch (command._tag) {
    case "ResolveSource": {
      return resolveSource(snapshot, command);
    }
    case "Redirect": {
      return redirect(snapshot, command);
    }
    case "AdvanceStage": {
      return advanceStage(snapshot, command);
    }
    case "AdvanceComponent": {
      return advanceComponent(snapshot, command);
    }
    case "RequireAction": {
      return requireAction(snapshot, command);
    }
    case "SetActivity": {
      return setActivity(snapshot, command);
    }
    case "Fail": {
      return fail(snapshot, command);
    }
    default: {
      return command satisfies never;
    }
  }
};
