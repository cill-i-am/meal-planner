import {
  CanonicalTikTokUrl,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import { Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  makeSyntheticMealPlanTracer,
  syntheticMealPlanRequest,
  syntheticPlanningPolicy,
  syntheticRecipeReviews,
} from "../meal-planning/meal-plan.fake.js";
import { MealPlanDecisionRequest } from "../meal-planning/meal-plan.js";
import { ImportBatchItemId } from "./import-batch.contracts.js";
import type {
  AdmitResolvedRecipeImportIntentCommand,
  AdmitResolvedRecipeImportIntentError,
  AdmitResolvedRecipeImportIntentResult,
  RecipeImportIntentAdmission,
} from "./import-intent-admission.js";
import { EvidenceRetentionSeconds } from "./import-media.model.js";
import { makeProviderFreeOperationalTracer } from "./import-operations.fake.js";
import type { ProviderFreeDeadLetter } from "./import-operations.fake.js";
import {
  ExpirableImportArtifact,
  InspectDeadLetterRequest,
  OperationalCorrelation,
  OperationalEvent,
  OperationalPrincipal,
  OperationalScope,
  ReplayDeadLetterRequest,
} from "./import-operations.js";
import { projectApprovedRecipe } from "./import-recipe-review.js";
import type { RecipeReviewView } from "./import-recipe-review.js";
import { SourceCanonicalId } from "./import.contracts.js";

const BaseTime = Date.parse("2026-07-22T12:00:00.000Z");
const importId = "018f47ad-91aa-7c35-b6fe-000000000401";
const batchId = "018f47ad-91aa-7c35-b6fe-000000000501";
const itemId = "018f47ad-91aa-7c35-b6fe-000000000601";
const CallerControlledSentinel = "CALLER_CONTROLLED_SENTINEL";
const operator = Schema.decodeUnknownSync(OperationalPrincipal)({
  actorId: "synthetic_operator",
  role: "operator",
});
const viewer = Schema.decodeUnknownSync(OperationalPrincipal)({
  actorId: "synthetic_viewer",
  role: "viewer",
});

type IntentAdmissionAttempt =
  | {
      readonly _tag: "Failure";
      readonly error: AdmitResolvedRecipeImportIntentError;
    }
  | {
      readonly _tag: "Success";
      readonly result: AdmitResolvedRecipeImportIntentResult;
    };

const makeRecordingIntentAdmission = (
  attempts: readonly IntentAdmissionAttempt[]
) => {
  const remaining = [...attempts];
  const calls: AdmitResolvedRecipeImportIntentCommand[] = [];
  const service: RecipeImportIntentAdmission = {
    admitResolved: (command) =>
      Effect.suspend(() => {
        calls.push(command);
        const attempt = remaining.shift();
        if (attempt === undefined) {
          return Effect.die("Synthetic intent admission exhausted");
        }
        return attempt._tag === "Failure"
          ? Effect.fail(attempt.error)
          : Effect.succeed(attempt.result);
      }),
  };
  return { calls, service };
};

const firstSyntheticReview = (): RecipeReviewView => {
  const [review] = syntheticRecipeReviews;
  if (review === undefined) {
    throw new Error("Synthetic recipe review fixture is missing");
  }
  return review;
};

const makeApprovedMealPlan = async () => {
  const tracer = makeSyntheticMealPlanTracer();
  const draft = await Effect.runPromise(
    tracer.service.create(syntheticMealPlanRequest, syntheticPlanningPolicy)
  );
  return Effect.runPromise(
    tracer.service.approve(
      Schema.decodeUnknownSync(MealPlanDecisionRequest)({
        actorId: "synthetic_operator",
        decidedAt: "2026-07-22T12:01:00.000Z",
        draftId: draft.draftId,
        expectedRevision: 0,
        mutationId: "approve-operational-tracer-plan",
        reason: "Preserve the approved plan through artifact expiry.",
      })
    )
  );
};

const makeDeadLetterScenario = async () => {
  const canonicalUrl = Schema.decodeUnknownSync(CanonicalTikTokUrl)(
    "https://www.tiktok.com/@synthetic/video/751001"
  );
  const request = Schema.decodeUnknownSync(CreateRecipeImportIntentRequest)({
    source: {
      kind: "tiktok",
      url: canonicalUrl,
    },
  });
  const stableKey = Schema.decodeUnknownSync(IdempotencyKey)(
    "dlq:synthetic:751001"
  );
  const replayedIntent = Schema.decodeUnknownSync(RecipeImportIntent)({
    activity: { type: "working" },
    createdAt: "2026-07-22T12:00:00.000Z",
    id: importId,
    intentVersion: 2,
    links: {
      self: `/v1/recipe-import-intents/${importId}`,
      timeline: `/v1/recipe-import-intents/${importId}/timeline`,
    },
    object: "recipe_import_intent",
    processing: {
      sourceKind: "video",
      startedAt: "2026-07-22T12:00:00.000Z",
      type: "acquiring_media",
    },
    source: { canonicalUrl, kind: "tiktok", resolution: "resolved" },
    status: "processing",
    updatedAt: "2026-07-22T12:00:00.000Z",
  });
  const command: AdmitResolvedRecipeImportIntentCommand = {
    idempotencyKey: stableKey,
    request,
    source: {
      canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)("751001"),
      canonicalUrl,
      sourceKind: "video",
    },
  };
  const intents = makeRecordingIntentAdmission([
    {
      _tag: "Success",
      result: { disposition: "created", intent: replayedIntent },
    },
  ]);
  const approvedMealPlan = await makeApprovedMealPlan();
  const review = firstSyntheticReview();
  const correlation = Schema.decodeUnknownSync(OperationalCorrelation)({
    batchId,
    evidence: {
      kind: "visual_evidence_manifest",
      referenceId: "evidence:synthetic:751001",
    },
    importId: replayedIntent.id,
    mealPlanId: approvedMealPlan.draftId,
    recipeId: projectApprovedRecipe(review).importId,
  });
  const deadLetter: ProviderFreeDeadLetter = {
    code: "workflow_start_unavailable",
    command,
    correlation,
    diagnostics: {
      localPath: "/private/tmp/provider-media.mp4",
      media: new Uint8Array([115, 101, 99, 114, 101, 116]),
      providerPayload: { privateCaption: "provider secret" },
      token: "provider-token-secret",
    },
    itemId: Schema.decodeUnknownSync(ImportBatchItemId)(itemId),
  };
  return {
    command,
    correlation,
    deadLetter,
    intents,
    replayedIntent,
  };
};

const untrustedCorrelation = (stored: OperationalCorrelation) => ({
  ...stored,
  evidence: {
    kind: "visual_evidence_manifest" as const,
    referenceId: CallerControlledSentinel,
  },
});

const decodeReplayRequest = (input: {
  readonly correlation: OperationalCorrelation;
  readonly deadLetter: ProviderFreeDeadLetter;
  readonly principal?: OperationalPrincipal;
  readonly quotaUnits?: number;
}) =>
  Schema.decodeUnknownSync(ReplayDeadLetterRequest)({
    correlation: untrustedCorrelation(input.correlation),
    itemId: input.deadLetter.itemId,
    principal: input.principal ?? operator,
    quotaUnits: input.quotaUnits ?? 10,
  });

describe("provider-free import operations tracer", () => {
  it("expires due raw artifacts while preserving approved durable records", async () => {
    const review = firstSyntheticReview();
    const durableRecords = {
      approvedMealPlan: await makeApprovedMealPlan(),
      approvedRecipe: projectApprovedRecipe(review),
      recipeAudit: review.transitions,
      recipeProvenance: review.draft,
    };
    const durableSnapshot = JSON.stringify(durableRecords);
    const decodeArtifact = Schema.decodeUnknownSync(ExpirableImportArtifact);
    const tracer = makeProviderFreeOperationalTracer({
      artifacts: [
        decodeArtifact({
          evidence: {
            kind: "original_media",
            referenceId: "media:synthetic:001",
          },
          expiresAtEpochMilliseconds:
            BaseTime + EvidenceRetentionSeconds * 1000,
          importId,
        }),
        decodeArtifact({
          evidence: {
            kind: "visual_evidence_manifest",
            referenceId: "evidence:synthetic:002",
          },
          expiresAtEpochMilliseconds:
            BaseTime + EvidenceRetentionSeconds * 2000,
          importId,
        }),
      ],
      deadLetters: [],
      intents: {
        admitResolved: () =>
          Effect.die("Retention must not admit a recipe import intent"),
      },
      replayQuotaLimit: 10,
    });
    const scope = Schema.decodeUnknownSync(OperationalScope)({
      batchId,
      mealPlanId: durableRecords.approvedMealPlan.draftId,
      recipeId: durableRecords.approvedRecipe.importId,
    });

    await Effect.runPromise(
      Effect.gen(function* retentionBoundary() {
        yield* TestClock.setTime(BaseTime);
        yield* TestClock.adjust(EvidenceRetentionSeconds * 1000 - 1);
        const beforeBoundary = yield* tracer.service.expireArtifacts(scope);
        expect(beforeBoundary.expired).toEqual([]);

        yield* TestClock.adjust(1);
        const atBoundary = yield* tracer.service.expireArtifacts(scope);
        expect(atBoundary.expired).toHaveLength(1);
        expect(atBoundary.expired[0]?.evidence).toEqual({
          kind: "original_media",
          referenceId: "media:synthetic:001",
        });
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(tracer.artifacts).toHaveLength(1);
    expect(tracer.artifacts[0]?.evidence.kind).toBe("visual_evidence_manifest");
    expect(JSON.stringify(durableRecords)).toBe(durableSnapshot);
    expect(tracer.events).toEqual([
      expect.objectContaining({
        _tag: "ArtifactsExpired",
        correlation: expect.objectContaining({
          batchId,
          evidence: {
            kind: "original_media",
            referenceId: "media:synthetic:001",
          },
          importId,
          mealPlanId: durableRecords.approvedMealPlan.draftId,
          recipeId: durableRecords.approvedRecipe.importId,
        }),
      }),
    ]);
  });

  it("replays one dead letter through canonical intent admission exactly once", async () => {
    const { correlation, deadLetter, command, intents, replayedIntent } =
      await makeDeadLetterScenario();
    const tracer = makeProviderFreeOperationalTracer({
      artifacts: [],
      deadLetters: [deadLetter],
      intents: intents.service,
      replayQuotaLimit: 10,
    });
    const operation = decodeReplayRequest({ correlation, deadLetter });

    expect(operation).not.toHaveProperty("correlation");

    const first = await Effect.runPromise(
      tracer.service.replayDeadLetter(operation)
    );
    const second = await Effect.runPromise(
      tracer.service.replayDeadLetter(operation)
    );

    expect(first).toEqual({
      disposition: "replayed",
      intentId: replayedIntent.id,
    });
    expect(second).toEqual({
      disposition: "already_replayed",
      intentId: replayedIntent.id,
    });
    expect(intents.calls).toEqual([command]);
    expect(tracer.deadLetterStats.releaseCount).toBe(0);
    expect(tracer.events).toContainEqual(
      expect.objectContaining({
        _tag: "DeadLetterReplayed",
        correlation,
        itemId: deadLetter.itemId,
      })
    );
    expect(JSON.stringify(tracer.events)).not.toContain(
      CallerControlledSentinel
    );
  });

  it("releases a typed failure claim so replay can recover", async () => {
    const { correlation, deadLetter, replayedIntent } =
      await makeDeadLetterScenario();
    const intents = makeRecordingIntentAdmission([
      {
        _tag: "Failure",
        error: { _tag: "WorkflowStartUnavailable" },
      },
      {
        _tag: "Success",
        result: { disposition: "idempotency_replay", intent: replayedIntent },
      },
    ]);
    const tracer = makeProviderFreeOperationalTracer({
      artifacts: [],
      deadLetters: [deadLetter],
      intents: intents.service,
      replayQuotaLimit: 10,
    });
    const operation = decodeReplayRequest({ correlation, deadLetter });

    const first = await Effect.runPromise(
      Effect.flip(tracer.service.replayDeadLetter(operation))
    );
    const recovered = await Effect.runPromise(
      tracer.service.replayDeadLetter(operation)
    );

    expect(first).toEqual({ _tag: "WorkflowStartUnavailable" });
    expect(recovered).toEqual({
      disposition: "replayed",
      intentId: replayedIntent.id,
    });
    expect(intents.calls).toEqual([deadLetter.command, deadLetter.command]);
    expect(tracer.deadLetterStats).toMatchObject({
      claimCount: 2,
      completedReplayCount: 1,
      releaseCount: 1,
    });
  });

  it("releases a defected claim so replay can recover", async () => {
    const { correlation, deadLetter, intents, replayedIntent } =
      await makeDeadLetterScenario();
    let attempts = 0;
    const tracer = makeProviderFreeOperationalTracer({
      artifacts: [],
      deadLetters: [deadLetter],
      intents: {
        admitResolved: (command) => {
          attempts += 1;
          return attempts === 1
            ? Effect.die("synthetic intent admission defect")
            : intents.service.admitResolved(command);
        },
      },
      replayQuotaLimit: 10,
    });
    const operation = decodeReplayRequest({ correlation, deadLetter });

    const defect = await Effect.runPromiseExit(
      tracer.service.replayDeadLetter(operation)
    );
    const recovered = await Effect.runPromiseExit(
      tracer.service.replayDeadLetter(operation)
    );

    expect(Exit.hasDies(defect)).toBe(true);
    expect(recovered).toEqual(
      expect.objectContaining({
        _tag: "Success",
        value: { disposition: "replayed", intentId: replayedIntent.id },
      })
    );
    expect(tracer.deadLetterStats).toMatchObject({
      claimCount: 2,
      completedReplayCount: 1,
      releaseCount: 1,
    });
  });

  it("releases an interrupted claim so replay can recover", async () => {
    const { correlation, deadLetter, intents, replayedIntent } =
      await makeDeadLetterScenario();
    const started = await Effect.runPromise(Deferred.make<"started">());
    let attempts = 0;
    const tracer = makeProviderFreeOperationalTracer({
      artifacts: [],
      deadLetters: [deadLetter],
      intents: {
        admitResolved: (command) => {
          attempts += 1;
          return attempts === 1
            ? Deferred.succeed(started, "started").pipe(
                Effect.andThen(Effect.never)
              )
            : intents.service.admitResolved(command);
        },
      },
      replayQuotaLimit: 10,
    });
    const operation = decodeReplayRequest({ correlation, deadLetter });

    const interrupted = await Effect.runPromise(
      Effect.gen(function* interruptReplay() {
        const fiber = yield* Effect.forkChild(
          tracer.service.replayDeadLetter(operation)
        );
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      })
    );
    const recovered = await Effect.runPromiseExit(
      tracer.service.replayDeadLetter(operation)
    );

    expect(Exit.hasInterrupts(interrupted)).toBe(true);
    expect(recovered).toEqual(
      expect.objectContaining({
        _tag: "Success",
        value: { disposition: "replayed", intentId: replayedIntent.id },
      })
    );
    expect(tracer.deadLetterStats).toMatchObject({
      claimCount: 2,
      completedReplayCount: 1,
      releaseCount: 1,
    });
  });

  it("does not release a completed replay after event emission defects", async () => {
    const { correlation, deadLetter, intents, replayedIntent } =
      await makeDeadLetterScenario();
    const tracer = makeProviderFreeOperationalTracer({
      artifacts: [],
      deadLetters: [deadLetter],
      eventFailureTag: "DeadLetterReplayed",
      intents: intents.service,
      replayQuotaLimit: 10,
    });
    const operation = decodeReplayRequest({ correlation, deadLetter });

    const defect = await Effect.runPromiseExit(
      tracer.service.replayDeadLetter(operation)
    );
    const replay = await Effect.runPromise(
      tracer.service.replayDeadLetter(operation)
    );

    expect(Exit.hasDies(defect)).toBe(true);
    expect(replay).toEqual({
      disposition: "already_replayed",
      intentId: replayedIntent.id,
    });
    expect(intents.calls).toHaveLength(1);
    expect(tracer.deadLetterStats).toMatchObject({
      claimCount: 2,
      completedReplayCount: 1,
      releaseCount: 0,
    });
  });

  it("audits denied replay authorization without business side effects", async () => {
    const { correlation, deadLetter, intents } = await makeDeadLetterScenario();
    const tracer = makeProviderFreeOperationalTracer({
      artifacts: [],
      deadLetters: [deadLetter],
      intents: intents.service,
      replayQuotaLimit: 10,
    });

    const deniedRequest = decodeReplayRequest({
      correlation,
      deadLetter,
      principal: viewer,
    });
    const deniedInspectionRequest = Schema.decodeUnknownSync(
      InspectDeadLetterRequest
    )({
      correlation: untrustedCorrelation(correlation),
      itemId: deadLetter.itemId,
      principal: viewer,
    });
    expect(deniedRequest).not.toHaveProperty("correlation");
    expect(deniedInspectionRequest).not.toHaveProperty("correlation");

    const denied = await Effect.runPromise(
      Effect.flip(tracer.service.replayDeadLetter(deniedRequest))
    );
    const deniedInspection = await Effect.runPromise(
      Effect.flip(tracer.service.inspectDeadLetter(deniedInspectionRequest))
    );

    expect(denied).toEqual({
      _tag: "DeadLetterAccessDenied",
      itemId: deadLetter.itemId,
    });
    expect(deniedInspection).toEqual(denied);
    expect(intents.calls).toEqual([]);
    expect(tracer.deadLetterStats).toMatchObject({
      claimCount: 0,
      completedReplayCount: 0,
      inspectionCount: 0,
    });
    expect(tracer.events).toEqual([
      expect.objectContaining({
        _tag: "DeadLetterReplayDenied",
        actorId: "synthetic_viewer",
        itemId: deadLetter.itemId,
        operation: "replay",
        reason: "insufficient_role",
      }),
      expect.objectContaining({
        _tag: "DeadLetterReplayDenied",
        actorId: "synthetic_viewer",
        itemId: deadLetter.itemId,
        operation: "inspect",
        reason: "insufficient_role",
      }),
    ]);
    expect(tracer.events.every((event) => !("correlation" in event))).toBe(
      true
    );
    expect(JSON.stringify(tracer.events)).not.toContain(
      CallerControlledSentinel
    );
  });

  it("enforces the exact replay quota before effects and exposes only safe projections", async () => {
    const allowed = await makeDeadLetterScenario();
    const allowedTracer = makeProviderFreeOperationalTracer({
      artifacts: [],
      deadLetters: [allowed.deadLetter],
      intents: allowed.intents.service,
      replayQuotaLimit: 10,
    });
    const inspectionRequest = Schema.decodeUnknownSync(
      InspectDeadLetterRequest
    )({
      correlation: untrustedCorrelation(allowed.correlation),
      itemId: allowed.deadLetter.itemId,
      principal: operator,
    });
    expect(inspectionRequest).not.toHaveProperty("correlation");
    const inspection = await Effect.runPromise(
      allowedTracer.service.inspectDeadLetter(inspectionRequest)
    );
    const replayRequest = decodeReplayRequest({
      correlation: allowed.correlation,
      deadLetter: allowed.deadLetter,
    });
    expect(replayRequest).not.toHaveProperty("correlation");
    const atBoundary = await Effect.runPromise(
      allowedTracer.service.replayDeadLetter(replayRequest)
    );

    expect(atBoundary.disposition).toBe("replayed");
    expect(allowed.intents.calls).toHaveLength(1);
    expect(inspection).toEqual({
      code: allowed.deadLetter.code,
      correlation: allowed.correlation,
      itemId: allowed.deadLetter.itemId,
    });
    expect(allowedTracer.events).toContainEqual(
      expect.objectContaining({
        _tag: "DeadLetterInspected",
        correlation: allowed.correlation,
        itemId: allowed.deadLetter.itemId,
      })
    );
    expect(allowedTracer.events).toContainEqual(
      expect.objectContaining({
        _tag: "DeadLetterReplayed",
        correlation: allowed.correlation,
        itemId: allowed.deadLetter.itemId,
      })
    );
    expect(
      allowedTracer.events.every((event) => Schema.is(OperationalEvent)(event))
    ).toBe(true);

    const rejected = await makeDeadLetterScenario();
    const rejectedTracer = makeProviderFreeOperationalTracer({
      artifacts: [],
      deadLetters: [rejected.deadLetter],
      intents: rejected.intents.service,
      replayQuotaLimit: 10,
    });
    const rejectedRequest = decodeReplayRequest({
      correlation: rejected.correlation,
      deadLetter: rejected.deadLetter,
      quotaUnits: 11,
    });
    expect(rejectedRequest).not.toHaveProperty("correlation");
    const aboveBoundary = await Effect.runPromise(
      Effect.flip(rejectedTracer.service.replayDeadLetter(rejectedRequest))
    );

    expect(aboveBoundary).toEqual({
      _tag: "DeadLetterReplayQuotaExceeded",
      itemId: rejected.deadLetter.itemId,
      limit: 10,
      requested: 11,
    });
    expect(rejected.intents.calls).toEqual([]);
    expect(rejectedTracer.deadLetterStats).toMatchObject({
      claimCount: 0,
      completedReplayCount: 0,
      inspectionCount: 0,
    });
    expect(rejectedTracer.events).toEqual([
      expect.objectContaining({
        _tag: "DeadLetterReplayQuotaRejected",
        limit: 10,
        requested: 11,
      }),
    ]);
    expect(rejectedTracer.events[0]).not.toHaveProperty("correlation");

    const privacySurface = JSON.stringify({
      aboveBoundary,
      atBoundary,
      events: [...allowedTracer.events, ...rejectedTracer.events],
      inspection,
    });
    for (const sensitiveValue of [
      "/private/tmp/provider-media.mp4",
      "provider secret",
      "provider-token-secret",
      "privateCaption",
      "https://www.tiktok.com/@synthetic/video/751001",
      "[115,101,99,114,101,116]",
      CallerControlledSentinel,
    ]) {
      expect(privacySurface).not.toContain(sensitiveValue);
    }
  });
});
