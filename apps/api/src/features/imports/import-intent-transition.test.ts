import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ImportIntentExecutionGeneration,
  ImportIntentTransitionCommand,
  ImportIntentTransitionSnapshot,
  applyImportIntentTransition,
} from "./import-intent-transition.js";

const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "00000000-0000-4000-8000-000000000201"
);
const at = "2026-08-16T14:00:00.000Z";
const generation = Schema.decodeUnknownSync(ImportIntentExecutionGeneration)(3);
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

const acquiring = () =>
  decodeSnapshot({
    activeActionId: null,
    activity: "working",
    executionGeneration: generation,
    failedAt: null,
    failureCode: null,
    failureMessage: null,
    failureRecovery: null,
    intentVersion: 2,
    nextAttemptAt: null,
    sourceKind: "video",
    speech: null,
    stage: "acquiring_media",
    stageStartedAt: "2026-08-16T13:59:00.000Z",
    status: "processing",
    updatedAt: "2026-08-16T13:59:00.000Z",
    visuals: null,
  });

const apply = (
  snapshot: typeof ImportIntentTransitionSnapshot.Type,
  input: unknown
) => applyImportIntentTransition(snapshot, decodeCommand(input));

const advanceAnalyzing = (snapshot: ReturnType<typeof acquiring>) =>
  apply(snapshot, {
    _tag: "AdvanceStage",
    ...metadata(1),
    stage: "analyzing_evidence",
  });

describe("recipe import intent transition policy", () => {
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
      executionGeneration: 2,
      component: "speech",
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
