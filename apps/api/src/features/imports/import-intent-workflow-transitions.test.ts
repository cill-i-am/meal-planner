import {
  RecipeImportActionId,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { WorkflowStepContext } from "alchemy/Cloudflare/Workflows";
import { Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  runImportCarouselVisualAndRecipeWorkflow,
  runImportVisualAndRecipeWorkflow,
} from "./import-application-workflows.js";
import {
  ImportIntentExecutionGeneration,
  ImportIntentTransitionSnapshot,
  applyImportIntentTransition,
} from "./import-intent-transition.js";
import type { ImportIntentTransitionCommand } from "./import-intent-transition.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import {
  makeImportIntentWorkflowTransitions,
  publicIntentFailureForAcquisitionOutcome,
  publicIntentFailureForProviderStage,
} from "./import-intent-workflow-transitions.js";
import {
  ProviderTaskStepConfig,
  runProviderTaskAttempt,
} from "./import-provider-workflow-task.js";

const decodeIntentId = Schema.decodeUnknownSync(RecipeImportIntentId);
const decodeActionId = Schema.decodeUnknownSync(RecipeImportActionId);
const decodeGeneration = Schema.decodeUnknownSync(
  ImportIntentExecutionGeneration
);
const decodeSnapshot = Schema.decodeUnknownSync(ImportIntentTransitionSnapshot);

describe("recipe import intent Workflow lifecycle", () => {
  it.each([
    [
      {
        _tag: "Unavailable",
        code: "private_or_unavailable",
        generation: 1,
      },
      "source_unavailable",
    ],
    [
      {
        _tag: "UnsupportedCarousel",
        code: "unsupported_carousel",
        generation: 1,
      },
      "unsupported_source",
    ],
    [
      {
        _tag: "TerminalMedia",
        code: "invalid_media",
        generation: 1,
        stage: "validation",
      },
      "invalid_media",
    ],
    [
      {
        _tag: "RetryExhausted",
        attempts: 3,
        generation: 1,
        reason: "download_http_response",
        stage: "verify",
      },
      "source_unavailable",
    ],
  ] as const)(
    "maps acquisition %s to provider-neutral %s",
    (rawOutcome, expectedCode) => {
      const outcome = {
        ...rawOutcome,
        generation: Schema.decodeUnknownSync(AcquisitionGeneration)(1),
      };
      const failure = publicIntentFailureForAcquisitionOutcome(outcome);
      expect(failure.code).toBe(expectedCode);
      expect(JSON.stringify(failure)).not.toMatch(
        /provider|download|tiktok|r2|https?:|manifest|transcript|evidence/iu
      );
    }
  );

  it.each([
    ["speech", "analysis_failed"],
    ["visual", "analysis_failed"],
    ["recipe", "recipe_extraction_failed"],
  ] as const)("maps provider stage %s to safe %s", (stage, expectedCode) => {
    const failure = publicIntentFailureForProviderStage(stage);
    expect(failure.code).toBe(expectedCode);
    expect(JSON.stringify(failure)).not.toMatch(
      /provider|tiktok|r2|https?:|manifest|transcript|evidence/iu
    );
  });

  it("uses deterministic attempt identities for retry recovery and failure", async () => {
    const commands: ImportIntentTransitionCommand[] = [];
    const recorded = new Map<string, string>();
    let snapshot = decodeSnapshot({
      activeActionId: null,
      activity: "working",
      executionGeneration: 4,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
      failureRecovery: null,
      intentVersion: 5,
      nextAttemptAt: null,
      sourceKind: "video",
      speech: "processing",
      stage: "analyzing_evidence",
      stageStartedAt: "2026-08-16T16:20:00.000Z",
      status: "processing",
      updatedAt: "2026-08-16T16:20:00.000Z",
      visuals: "not_started",
    });
    const transitions = makeImportIntentWorkflowTransitions({
      executionGeneration: decodeGeneration(4),
      intentId: decodeIntentId("00000000-0000-4000-8000-000000000403"),
      repository: {
        transitionIntent: (command) =>
          Effect.sync(() => {
            commands.push(command);
            const digest = recorded.get(command.mutationId);
            if (digest !== undefined) {
              return {
                _tag: "NoOp" as const,
                reason: "replayed_mutation" as const,
                snapshot,
              };
            }
            const outcome = applyImportIntentTransition(snapshot, command);
            if (outcome._tag === "Applied") {
              snapshot = outcome.snapshot;
              recorded.set(command.mutationId, command.commandDigest);
            }
            return outcome;
          }),
      },
    });

    await Effect.runPromise(
      Effect.gen(function* retryFailureTracer() {
        yield* transitions.setActivity("speech", 1, "retrying");
        yield* transitions.setActivity("speech", 1, "retrying");
        yield* transitions.setActivity("speech", 2, "working");
        yield* transitions.fail(
          "speech",
          publicIntentFailureForProviderStage("speech")
        );
      })
    );

    expect(commands[0]?.mutationId).toBe(commands[1]?.mutationId);
    expect(commands[0]?.commandDigest).toBe(commands[1]?.commandDigest);
    expect(snapshot).toMatchObject({
      failureCode: "analysis_failed",
      intentVersion: 8,
      status: "failed",
    });
  });

  it("drives replay-safe retry and recovery transitions at the native provider attempt boundary", async () => {
    const commands: ImportIntentTransitionCommand[] = [];
    const recorded = new Map<string, string>();
    let snapshot = decodeSnapshot({
      activeActionId: null,
      activity: "working",
      executionGeneration: 4,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
      failureRecovery: null,
      intentVersion: 5,
      nextAttemptAt: null,
      sourceKind: "video",
      speech: "processing",
      stage: "analyzing_evidence",
      stageStartedAt: "2026-08-16T16:20:00.000Z",
      status: "processing",
      updatedAt: "2026-08-16T16:20:00.000Z",
      visuals: "not_started",
    });
    const transitions = makeImportIntentWorkflowTransitions({
      executionGeneration: decodeGeneration(4),
      intentId: decodeIntentId("00000000-0000-4000-8000-000000000404"),
      repository: {
        transitionIntent: (command) =>
          Effect.sync(() => {
            commands.push(command);
            const digest = recorded.get(command.mutationId);
            if (digest !== undefined) {
              return {
                _tag: "NoOp" as const,
                reason: "replayed_mutation" as const,
                snapshot,
              };
            }
            const outcome = applyImportIntentTransition(snapshot, command);
            if (outcome._tag === "Applied") {
              snapshot = outcome.snapshot;
              recorded.set(command.mutationId, command.commandDigest);
            }
            return outcome;
          }),
      },
    });
    const lifecycle = {
      retrying: (attempt: number) =>
        transitions.setActivity("speech", attempt, "retrying").pipe(
          Effect.orDie,
          Effect.asVoid
        ),
      working: (attempt: number) =>
        transitions.setActivity("speech", attempt, "working").pipe(
          Effect.orDie,
          Effect.asVoid
        ),
    };
    const context = (attempt: number) =>
      Effect.provideService(WorkflowStepContext, {
        attempt,
        config: ProviderTaskStepConfig,
        step: { count: 1, name: "transcribe-video-v1" },
      });
    const retry = runProviderTaskAttempt(
      "speech",
      Effect.fail({ code: "timeout" }),
      () => "unused",
      undefined,
      lifecycle
    ).pipe(context(1));

    await Effect.runPromiseExit(retry);
    await Effect.runPromiseExit(retry);
    await Effect.runPromise(
      runProviderTaskAttempt(
        "speech",
        Effect.succeed("private-result"),
        () => "checkpointed",
        undefined,
        lifecycle
      ).pipe(context(2))
    );

    expect(commands).toHaveLength(3);
    expect(commands[0]).toMatchObject({
      _tag: "SetActivity",
      activity: "retrying",
    });
    expect(commands[1]).toMatchObject({
      commandDigest: commands[0]?.commandDigest,
      mutationId: commands[0]?.mutationId,
    });
    expect(commands[2]).toMatchObject({
      _tag: "SetActivity",
      activity: "working",
    });
    expect(snapshot).toMatchObject({ activity: "working", intentVersion: 7 });
  });

  it("publishes a safe terminal failure only after its private checkpoint and replays exactly", async () => {
    const commands: ImportIntentTransitionCommand[] = [];
    const order: string[] = [];
    const recorded = new Map<string, string>();
    let snapshot = decodeSnapshot({
      activeActionId: null,
      activity: "working",
      executionGeneration: 4,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
      failureRecovery: null,
      intentVersion: 5,
      nextAttemptAt: null,
      sourceKind: "video",
      speech: "completed",
      stage: "analyzing_evidence",
      stageStartedAt: "2026-08-16T16:20:00.000Z",
      status: "processing",
      updatedAt: "2026-08-16T16:20:00.000Z",
      visuals: "processing",
    });
    const transitions = makeImportIntentWorkflowTransitions({
      executionGeneration: decodeGeneration(4),
      intentId: decodeIntentId("00000000-0000-4000-8000-000000000405"),
      repository: {
        transitionIntent: (command) =>
          Effect.sync(() => {
            commands.push(command);
            const digest = recorded.get(command.mutationId);
            if (digest !== undefined) {
              return {
                _tag: "NoOp" as const,
                reason: "replayed_mutation" as const,
                snapshot,
              };
            }
            const outcome = applyImportIntentTransition(snapshot, command);
            if (outcome._tag === "Applied") {
              snapshot = outcome.snapshot;
              recorded.set(command.mutationId, command.commandDigest);
            }
            return outcome;
          }),
      },
    });
    const workflow = runImportVisualAndRecipeWorkflow({
      lifecycle: {
        beforeRecipe: Effect.void,
        beforeVisual: Effect.void,
        failurePersisted: (failure) =>
          Effect.sync(() => {
            order.push("public-failure");
          }).pipe(
            Effect.andThen(
              transitions
                .fail(
                  failure.stage,
                  publicIntentFailureForProviderStage(failure.stage)
                )
                .pipe(Effect.orDie, Effect.asVoid)
            )
          ),
        visualCompleted: Effect.void,
      },
      persistTerminal: () =>
        Effect.sync(() => {
          order.push("private-checkpoint");
        }),
      recipe: Effect.succeed({
        _tag: "Succeeded" as const,
        stage: "recipe" as const,
      }),
      visual: Effect.succeed({
        _tag: "Failed" as const,
        code: "provider_private_detail",
        stage: "visual" as const,
      }),
    });

    await Effect.runPromise(workflow);
    const firstVersion = snapshot.intentVersion;
    const firstTimestamp = snapshot.failedAt;
    await Effect.runPromise(workflow);

    expect(order).toEqual([
      "private-checkpoint",
      "public-failure",
      "private-checkpoint",
      "public-failure",
    ]);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toMatchObject({
      commandDigest: commands[0]?.commandDigest,
      mutationId: commands[0]?.mutationId,
    });
    expect(snapshot).toMatchObject({
      failedAt: firstTimestamp,
      failureCode: "analysis_failed",
      intentVersion: firstVersion,
      status: "failed",
    });
    expect(JSON.stringify(commands)).not.toContain("provider_private_detail");
  });

  it("records the exact provider-free video order once and replays stable identities", async () => {
    const commands: ImportIntentTransitionCommand[] = [];
    const recorded = new Map<string, string>();
    let snapshot = decodeSnapshot({
      activeActionId: null,
      activity: "working",
      executionGeneration: 1,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
      failureRecovery: null,
      intentVersion: 2,
      nextAttemptAt: null,
      sourceKind: "video",
      speech: null,
      stage: "acquiring_media",
      stageStartedAt: "2026-08-16T16:00:00.000Z",
      status: "processing",
      updatedAt: "2026-08-16T16:00:00.000Z",
      visuals: null,
    });
    const repository = {
      transitionIntent: (command: ImportIntentTransitionCommand) =>
        Effect.sync(() => {
          commands.push(command);
          const digest = recorded.get(command.mutationId);
          if (digest !== undefined) {
            if (digest !== command.commandDigest) {
              throw new Error("test fixture received a changed digest");
            }
            return {
              _tag: "NoOp" as const,
              reason: "replayed_mutation" as const,
              snapshot,
            };
          }
          const outcome = applyImportIntentTransition(snapshot, command);
          if (outcome._tag === "Applied") {
            snapshot = outcome.snapshot;
            recorded.set(command.mutationId, command.commandDigest);
          }
          return outcome;
        }),
    };
    const transitions = makeImportIntentWorkflowTransitions({
      executionGeneration: decodeGeneration(1),
      intentId: decodeIntentId("00000000-0000-4000-8000-000000000401"),
      repository,
    });
    const actionId = decodeActionId("4".repeat(64));

    const runVideo = Effect.gen(function* videoLifecycleTracer() {
      yield* transitions.advanceStage("analyzing_evidence");
      yield* transitions.advanceComponent("speech", "processing");
      yield* transitions.advanceComponent("speech", "completed");
      yield* runImportVisualAndRecipeWorkflow({
        lifecycle: {
          beforeRecipe: transitions
            .advanceStage("extracting_recipe")
            .pipe(Effect.orDie),
          beforeVisual: transitions
            .advanceComponent("visuals", "processing")
            .pipe(Effect.orDie),
          visualCompleted: transitions.advanceComponent(
            "visuals",
            "completed"
          ).pipe(Effect.orDie),
        },
        persistTerminal: () => Effect.void,
        recipe: Effect.gen(function* recipeLifecycleTracer() {
          yield* transitions.advanceStage("grounding_recipe");
          yield* transitions.advanceStage("preparing_review");
          yield* transitions.requireAction(actionId);
          return { _tag: "Succeeded" as const, stage: "recipe" as const };
        }).pipe(Effect.orDie),
        visual: Effect.succeed({
          _tag: "Succeeded" as const,
          stage: "visual" as const,
        }),
      });
    });

    await Effect.runPromise(
      Effect.gen(function* runAndReplay() {
        yield* TestClock.setTime(Date.parse("2026-08-16T16:01:00.000Z"));
        yield* runVideo;
        yield* runVideo;
      }).pipe(Effect.provide(TestClock.layer()))
    );

    const semanticOrder = commands.slice(0, 9).map((command) => {
      switch (command._tag) {
        case "AdvanceStage":
          return `stage:${command.stage}`;
        case "AdvanceComponent":
          return `component:${command.component}:${command.progress}`;
        case "RequireAction":
          return `action:${command.actionId}`;
        case "SetActivity":
          return `activity:${command.activity}`;
        case "Fail":
          return `failure:${command.code}`;
        case "Cancel":
          return "cancelled";
      }
    });
    expect(semanticOrder).toEqual([
      "stage:analyzing_evidence",
      "component:speech:processing",
      "component:speech:completed",
      "component:visuals:processing",
      "component:visuals:completed",
      "stage:extracting_recipe",
      "stage:grounding_recipe",
      "stage:preparing_review",
      `action:${actionId}`,
    ]);
    expect(commands).toHaveLength(18);
    expect(
      commands.slice(9).map(({ commandDigest, mutationId }) => ({
        commandDigest,
        mutationId,
      }))
    ).toEqual(
      commands.slice(0, 9).map(({ commandDigest, mutationId }) => ({
        commandDigest,
        mutationId,
      }))
    );
    expect(snapshot).toMatchObject({
      activeActionId: actionId,
      intentVersion: 11,
      status: "requires_action",
    });
  });

  it("records the carousel speech skip and visual sequence before recipe work", async () => {
    const commands: ImportIntentTransitionCommand[] = [];
    const recorded = new Map<string, string>();
    let snapshot = decodeSnapshot({
      activeActionId: null,
      activity: "working",
      executionGeneration: 2,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
      failureRecovery: null,
      intentVersion: 2,
      nextAttemptAt: null,
      sourceKind: "carousel",
      speech: null,
      stage: "acquiring_media",
      stageStartedAt: "2026-08-16T16:10:00.000Z",
      status: "processing",
      updatedAt: "2026-08-16T16:10:00.000Z",
      visuals: null,
    });
    const transitions = makeImportIntentWorkflowTransitions({
      executionGeneration: decodeGeneration(2),
      intentId: decodeIntentId("00000000-0000-4000-8000-000000000402"),
      repository: {
        transitionIntent: (command) =>
          Effect.sync(() => {
            commands.push(command);
            const digest = recorded.get(command.mutationId);
            if (digest !== undefined) {
              if (digest !== command.commandDigest) {
                throw new Error("test fixture received a changed digest");
              }
              return {
                _tag: "NoOp" as const,
                reason: "replayed_mutation" as const,
                snapshot,
              };
            }
            const outcome = applyImportIntentTransition(snapshot, command);
            if (outcome._tag === "Applied") {
              snapshot = outcome.snapshot;
              recorded.set(command.mutationId, command.commandDigest);
            }
            return outcome;
          }),
      },
    });
    const actionId = decodeActionId("5".repeat(64));

    const runCarousel = runImportCarouselVisualAndRecipeWorkflow({
        lifecycle: {
          beforeRecipe: transitions
            .advanceStage("extracting_recipe")
            .pipe(Effect.orDie),
          beforeVisual: Effect.gen(function* beginCarouselAnalysis() {
            yield* transitions.advanceStage("analyzing_evidence");
            yield* transitions.advanceComponent("speech", "skipped");
            yield* transitions.advanceComponent("visuals", "processing");
          }).pipe(Effect.orDie),
          visualCompleted: transitions.advanceComponent(
            "visuals",
            "completed"
          ).pipe(Effect.orDie),
        },
        recipe: () =>
          Effect.gen(function* carouselRecipeLifecycleTracer() {
            yield* transitions.advanceStage("grounding_recipe");
            yield* transitions.advanceStage("preparing_review");
            yield* transitions.requireAction(actionId);
            return { _tag: "RecipeReady" as const };
          }).pipe(Effect.orDie),
        visual: Effect.succeed({
          _tag: "Succeeded" as const,
          evidence: { imageCount: 4 },
        }),
      });
    await Effect.runPromise(runCarousel.pipe(Effect.andThen(runCarousel)));

    expect(
      commands.slice(0, 8).map((command) => {
        switch (command._tag) {
          case "AdvanceStage":
            return `stage:${command.stage}`;
          case "AdvanceComponent":
            return `component:${command.component}:${command.progress}`;
          case "RequireAction":
            return `action:${command.actionId}`;
          case "SetActivity":
            return `activity:${command.activity}`;
          case "Fail":
            return `failure:${command.code}`;
          case "Cancel":
            return "cancelled";
        }
      })
    ).toEqual([
      "stage:analyzing_evidence",
      "component:speech:skipped",
      "component:visuals:processing",
      "component:visuals:completed",
      "stage:extracting_recipe",
      "stage:grounding_recipe",
      "stage:preparing_review",
      `action:${actionId}`,
    ]);
    expect(snapshot).toMatchObject({
      activeActionId: actionId,
      intentVersion: 10,
      status: "requires_action",
    });
    expect(commands).toHaveLength(16);
    expect(
      commands.slice(8).map(({ commandDigest, mutationId }) => ({
        commandDigest,
        mutationId,
      }))
    ).toEqual(
      commands.slice(0, 8).map(({ commandDigest, mutationId }) => ({
        commandDigest,
        mutationId,
      }))
    );
  });
});
