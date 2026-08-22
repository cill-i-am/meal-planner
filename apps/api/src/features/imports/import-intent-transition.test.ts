import { Instant, RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ImportIntentExecutionGeneration,
  ImportIntentTransitionCommand,
  ImportIntentTransitionSnapshot,
  applyImportIntentTransition,
} from "./import-intent-transition.js";
import { decodeImportWorkflowInput } from "./import-workflow-input.js";

const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "00000000-0000-4000-8000-000000000201"
);
const at = "2026-08-16T14:00:00.000Z";
const atInstant = Schema.decodeUnknownSync(Instant)(at);
const generation = Schema.decodeUnknownSync(ImportIntentExecutionGeneration)(3);
const resolvingGeneration = Schema.decodeUnknownSync(
  ImportIntentExecutionGeneration
)(1);
const decodeSnapshot = Schema.decodeUnknownSync(ImportIntentTransitionSnapshot);
const decodeSnapshotType = Schema.decodeUnknownSync(
  Schema.toType(ImportIntentTransitionSnapshot)
);
const decodeCommand = Schema.decodeUnknownSync(ImportIntentTransitionCommand, {
  onExcessProperty: "error",
});

const metadata = (ordinal: number) => ({
  commandDigest: ordinal.toString(16).padStart(64, "0"),
  executionGeneration: generation,
  intentId,
  mutationId: (ordinal + 100).toString(16).padStart(64, "0"),
  occurredAt: at,
});

const acquiring = (
  executionGeneration: typeof ImportIntentExecutionGeneration.Type = generation
) =>
  decodeSnapshot({
    activeActionId: null,
    activity: "working",
    executionGeneration,
    failedAt: null,
    failureCode: null,
    failureMessage: null,
    failureRecovery: null,
    intentVersion: 2,
    nextAttemptAt: null,
    redirectedAt: null,
    redirectedToIntentId: null,
    resolvedCanonicalSourceId: "7462850912345678901",
    sourceKind: "video",
    sourceUrl: "https://www.tiktok.com/@cook/video/7462850912345678901",
    speech: null,
    stage: "acquiring_media",
    stageStartedAt: "2026-08-16T13:59:00.000Z",
    status: "processing",
    updatedAt: "2026-08-16T13:59:00.000Z",
    visuals: null,
  });

const resolving = () =>
  decodeSnapshot({
    activeActionId: null,
    activity: "working",
    executionGeneration: resolvingGeneration,
    failedAt: null,
    failureCode: null,
    failureMessage: null,
    failureRecovery: null,
    intentVersion: 1,
    nextAttemptAt: null,
    redirectedAt: null,
    redirectedToIntentId: null,
    resolvedCanonicalSourceId: null,
    sourceKind: null,
    sourceUrl: null,
    speech: null,
    stage: "resolving_source",
    stageStartedAt: "2026-08-16T13:58:00.000Z",
    status: "processing",
    updatedAt: "2026-08-16T13:58:00.000Z",
    visuals: null,
  });

const apply = (
  snapshot: typeof ImportIntentTransitionSnapshot.Type,
  input: Schema.Json
) => applyImportIntentTransition(snapshot, decodeCommand(input));

const advanceAnalyzing = (snapshot: ReturnType<typeof acquiring>) =>
  apply(snapshot, {
    _tag: "AdvanceStage",
    ...metadata(1),
    stage: "analyzing_evidence",
  });

describe("recipe import intent transition policy", () => {
  it("claims a resolved source without replacing its execution generation", () => {
    const claimed = apply(resolving(), {
      _tag: "ResolveSource",
      ...metadata(20),
      canonicalSourceId: "7462850912345678901",
      canonicalUrl: "https://www.tiktok.com/@cook/video/7462850912345678901",
      executionGeneration: resolvingGeneration,
      sourceKind: "video",
    });

    expect(claimed).toMatchObject({
      _tag: "Applied",
      snapshot: {
        activity: "working",
        executionGeneration: 1,
        intentVersion: 2,
        redirectedAt: null,
        redirectedToIntentId: null,
        resolvedCanonicalSourceId: "7462850912345678901",
        sourceKind: "video",
        sourceUrl: "https://www.tiktok.com/@cook/video/7462850912345678901",
        stage: "acquiring_media",
        stageStartedAt: atInstant,
        status: "processing",
      },
    });
  });

  it("settles a duplicate source as a terminal redirect without replacing execution", () => {
    const winnerIntentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
      "00000000-0000-4000-8000-000000000202"
    );
    const redirected = apply(resolving(), {
      _tag: "Redirect",
      ...metadata(21),
      canonicalSourceId: "7462850912345678901",
      canonicalUrl: "https://www.tiktok.com/@cook/video/7462850912345678901",
      executionGeneration: resolvingGeneration,
      redirectedToIntentId: winnerIntentId,
      sourceKind: "video",
    });

    expect(redirected).toMatchObject({
      _tag: "Applied",
      snapshot: {
        activity: null,
        executionGeneration: 1,
        intentVersion: 2,
        redirectedAt: atInstant,
        redirectedToIntentId: winnerIntentId,
        resolvedCanonicalSourceId: "7462850912345678901",
        sourceKind: "video",
        sourceUrl: "https://www.tiktok.com/@cook/video/7462850912345678901",
        stage: null,
        status: "redirected",
      },
    });
  });

  it("decodes a closed branded command at the runtime boundary", () => {
    expect(() =>
      decodeCommand({
        _tag: "AdvanceStage",
        ...metadata(1),
        providerPayload: "must-not-cross",
        stage: "analyzing_evidence",
      })
    ).toThrow();
  });

  it("uses the decoded Workflow generation to fence executor transitions", async () => {
    const input = await Effect.runPromise(
      decodeImportWorkflowInput({
        executionGeneration: 1,
        importId: intentId,
        organizationId: "organization-transition-fence",
        trace: {
          correlationId: "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2201",
        },
      })
    );
    const snapshot = acquiring(input.executionGeneration);
    const current = apply(snapshot, {
      _tag: "AdvanceStage",
      commandDigest: "a".repeat(64),
      executionGeneration: input.executionGeneration,
      intentId,
      mutationId: "b".repeat(64),
      occurredAt: at,
      stage: "analyzing_evidence",
    });
    expect(current).toMatchObject({
      _tag: "Applied",
      snapshot: {
        executionGeneration: 1,
        stage: "analyzing_evidence",
      },
    });

    const stale = apply(snapshot, {
      _tag: "AdvanceStage",
      commandDigest: "c".repeat(64),
      executionGeneration: 0,
      intentId,
      mutationId: "d".repeat(64),
      occurredAt: at,
      stage: "analyzing_evidence",
    });
    expect(stale).toEqual({
      _tag: "NoOp",
      reason: "stale_generation",
      snapshot,
    });
  });

  it.each([
    ["speech", "visuals"],
    ["visuals", "speech"],
  ] as const)(
    "converges independent analysis components in %s then %s order",
    (first, second) => {
      const analyzing = advanceAnalyzing(acquiring());
      expect(analyzing._tag).toBe("Applied");
      if (analyzing._tag !== "Applied") {
        return;
      }

      let current = analyzing.snapshot;
      for (const [index, component] of [first, second].entries()) {
        const processing = apply(current, {
          _tag: "AdvanceComponent",
          ...metadata(index * 2 + 2),
          component,
          progress: "processing",
        });
        expect(processing._tag).toBe("Applied");
        if (processing._tag !== "Applied") {
          return;
        }
        const completed = apply(processing.snapshot, {
          _tag: "AdvanceComponent",
          ...metadata(index * 2 + 3),
          component,
          progress: "completed",
        });
        expect(completed._tag).toBe("Applied");
        if (completed._tag !== "Applied") {
          return;
        }
        current = completed.snapshot;
      }

      expect(current).toMatchObject({
        intentVersion: 7,
        speech: "completed",
        stage: "analyzing_evidence",
        visuals: "completed",
      });
    }
  );

  it("preserves the exact snapshot for older milestones, stale generations, and terminal dominance", () => {
    const analyzing = advanceAnalyzing(acquiring());
    expect(analyzing._tag).toBe("Applied");
    if (analyzing._tag !== "Applied") {
      return;
    }
    const older = apply(analyzing.snapshot, {
      _tag: "AdvanceStage",
      ...metadata(2),
      stage: "acquiring_media",
    });
    expect(older).toEqual({
      _tag: "NoOp",
      reason: "superseded_milestone",
      snapshot: analyzing.snapshot,
    });

    const stale = apply(analyzing.snapshot, {
      _tag: "AdvanceComponent",
      ...metadata(3),
      component: "speech",
      executionGeneration: 2,
      progress: "processing",
    });
    expect(stale).toEqual({
      _tag: "NoOp",
      reason: "stale_generation",
      snapshot: analyzing.snapshot,
    });

    const terminal = decodeSnapshotType({
      ...analyzing.snapshot,
      activity: null,
      speech: null,
      stage: null,
      stageStartedAt: null,
      status: "cancelled",
      visuals: null,
    });
    const afterCancel = apply(terminal, {
      _tag: "AdvanceStage",
      ...metadata(4),
      stage: "extracting_recipe",
    });
    expect(afterCancel).toEqual({
      _tag: "NoOp",
      reason: "terminal_state",
      snapshot: terminal,
    });
  });

  it("moves between working and retrying without changing stage or component progress", () => {
    const analyzing = advanceAnalyzing(acquiring());
    expect(analyzing._tag).toBe("Applied");
    if (analyzing._tag !== "Applied") {
      return;
    }
    const speechProcessing = apply(analyzing.snapshot, {
      _tag: "AdvanceComponent",
      ...metadata(2),
      component: "speech",
      progress: "processing",
    });
    expect(speechProcessing._tag).toBe("Applied");
    if (speechProcessing._tag !== "Applied") {
      return;
    }

    const retrying = apply(speechProcessing.snapshot, {
      _tag: "SetActivity",
      ...metadata(3),
      activity: "retrying",
      attempt: 1,
      boundary: "speech",
    });
    expect(retrying).toMatchObject({
      _tag: "Applied",
      snapshot: {
        activity: "retrying",
        intentVersion: speechProcessing.snapshot.intentVersion + 1,
        speech: "processing",
        stage: "analyzing_evidence",
        visuals: "not_started",
      },
    });
    if (retrying._tag !== "Applied") {
      return;
    }

    const recovered = apply(retrying.snapshot, {
      _tag: "SetActivity",
      ...metadata(4),
      activity: "working",
      attempt: 2,
      boundary: "speech",
    });
    expect(recovered).toMatchObject({
      _tag: "Applied",
      snapshot: {
        activity: "working",
        intentVersion: retrying.snapshot.intentVersion + 1,
        speech: "processing",
        stage: "analyzing_evidence",
        visuals: "not_started",
      },
    });
  });

  it("fails terminally with only the frozen safe public error contract", () => {
    const failed = apply(acquiring(), {
      _tag: "Fail",
      ...metadata(5),
      boundary: "acquisition",
      code: "source_unavailable",
      message: "The source is unavailable.",
      recovery: "create_new_intent",
    });
    expect(failed).toMatchObject({
      _tag: "Applied",
      snapshot: {
        activity: null,
        failureCode: "source_unavailable",
        failureMessage: "The source is unavailable.",
        failureRecovery: "create_new_intent",
        stage: null,
        status: "failed",
      },
    });
    if (failed._tag === "Applied") {
      expect(failed.snapshot.failedAt).toEqual(failed.snapshot.updatedAt);
    }
  });

  it("cancels only the expected mutable version and fences a delayed executor transition", () => {
    const cancelled = apply(acquiring(), {
      _tag: "Cancel",
      ...metadata(6),
      expectedIntentVersion: 2,
    });
    expect(cancelled).toMatchObject({
      _tag: "Applied",
      snapshot: {
        activeActionId: null,
        activity: null,
        intentVersion: 3,
        stage: null,
        status: "cancelled",
      },
    });
    if (cancelled._tag !== "Applied") {
      return;
    }
    const delayedExecutor = apply(cancelled.snapshot, {
      _tag: "AdvanceStage",
      ...metadata(7),
      stage: "analyzing_evidence",
    });
    expect(delayedExecutor).toEqual({
      _tag: "NoOp",
      reason: "terminal_state",
      snapshot: cancelled.snapshot,
    });

    const stale = apply(acquiring(), {
      _tag: "Cancel",
      ...metadata(8),
      expectedIntentVersion: 1,
    });
    expect(stale).toMatchObject({
      _tag: "Rejected",
      reason: "intent_version_conflict",
    });
  });
});
