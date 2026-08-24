import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  HouseholdAdmitRecipeImportResult,
  HouseholdRecipeImportFailure,
  HouseholdRecordRecipeImportDispatchResult,
} from "../households/recipe-import/household-recipe-import.contract.js";
import { HouseholdMemberAdmission } from "../households/rpc/command-envelope.js";
import { makeRecipeImportWorkflowDispatcher } from "./import-worker-request-layer.js";
import { workflowStartUnavailable } from "./import.errors.js";
import { TestImportTrace } from "./import.test-fixtures.js";

const intentId = "018f47ad-91aa-7c35-b6fe-000000000001";
const createdAt = "2026-08-22T08:00:00.000Z";
const workflowIdentity = `import-acquisition:v1:${"a".repeat(64)}`;

describe("recipe import Workflow outbox dispatch", () => {
  it("retries the same committed Workflow identity and records each delivery outcome", async () => {
    const outcomes: ("prepared" | "started" | "unavailable")[] = [];
    const dispatchedIdentities: string[] = [];
    const executionOrder: string[] = [];
    let attempts = 0;
    const committed = Schema.decodeUnknownSync(
      HouseholdAdmitRecipeImportResult
    )({
      dispatchId: "dispatch-retry-proof",
      intent: {
        activity: { type: "working" },
        createdAt,
        id: intentId,
        intentVersion: 1,
        links: {
          self: `/v1/recipe-import-intents/${intentId}`,
          timeline: `/v1/recipe-import-intents/${intentId}/timeline`,
        },
        object: "recipe_import_intent",
        processing: { startedAt: createdAt, type: "resolving_source" },
        source: { kind: "tiktok", resolution: "pending" },
        status: "processing",
        updatedAt: createdAt,
      },
      workflowIdentity,
    });
    const dispatcher = makeRecipeImportWorkflowDispatcher({
      householdDomain: {
        recordRecipeImportDispatch: (input) =>
          Effect.sync(() => {
            outcomes.push(input.outcome);
            return Schema.encodeSync(HouseholdRecordRecipeImportDispatchResult)(
              {
                admission: {
                  committedAtEpochMs: 1,
                  dispatchId: input.dispatchId,
                  workflowIdentity: input.workflowIdentity,
                },
                attempts: outcomes.length,
                exhaustedAtEpochMs: null,
                state: input.outcome === "started" ? "dispatched" : "pending",
              }
            );
          }),
      },
      importWorkflowStarter: {
        dispatchAdmission: (input) =>
          Effect.suspend(() => {
            attempts += 1;
            dispatchedIdentities.push(input.workflowIdentity);
            executionOrder.push(`workflow:${attempts}`);
            return attempts < 3
              ? Effect.fail(workflowStartUnavailable())
              : Effect.succeed("already_active" as const);
          }),
      },
      retryDelaysMilliseconds: [0, 0, 0, 0],
      scheduleRetry: (effect) => effect,
      trace: TestImportTrace,
    });

    await Effect.runPromise(
      dispatcher.dispatch({
        admission: Schema.decodeUnknownSync(HouseholdMemberAdmission)({
          actor: { _tag: "Member", actorId: "b".repeat(64) },
          organizationId: "organization-retry-proof",
        }),
        committed,
      })
    );

    expect(outcomes).toEqual([
      "prepared",
      "unavailable",
      "prepared",
      "unavailable",
      "prepared",
      "started",
    ]);
    expect(dispatchedIdentities).toEqual([
      workflowIdentity,
      workflowIdentity,
      workflowIdentity,
    ]);
    expect(executionOrder).toEqual(["workflow:1", "workflow:2", "workflow:3"]);
  });

  it("persists the original trace before starting the Workflow", async () => {
    const events: string[] = [];
    let recordAttempts = 0;
    let workflowStarts = 0;
    const committed = Schema.decodeUnknownSync(
      HouseholdAdmitRecipeImportResult
    )({
      dispatchId: "dispatch-trace-durability-proof",
      intent: {
        activity: { type: "working" },
        createdAt,
        id: intentId,
        intentVersion: 1,
        links: {
          self: `/v1/recipe-import-intents/${intentId}`,
          timeline: `/v1/recipe-import-intents/${intentId}/timeline`,
        },
        object: "recipe_import_intent",
        processing: { startedAt: createdAt, type: "resolving_source" },
        source: { kind: "tiktok", resolution: "pending" },
        status: "processing",
        updatedAt: createdAt,
      },
      workflowIdentity,
    });
    const dispatcher = makeRecipeImportWorkflowDispatcher({
      householdDomain: {
        recordRecipeImportDispatch: (input) =>
          Effect.suspend(() => {
            recordAttempts += 1;
            events.push(`record:${input.outcome}`);
            if (recordAttempts === 1) {
              return Effect.fail(
                HouseholdRecipeImportFailure.make({
                  reason: "persistence_unavailable",
                })
              );
            }
            return Effect.succeed(
              Schema.encodeSync(HouseholdRecordRecipeImportDispatchResult)({
                admission: {
                  committedAtEpochMs: 1,
                  dispatchId: input.dispatchId,
                  workflowIdentity: input.workflowIdentity,
                },
                attempts: 1,
                exhaustedAtEpochMs: null,
                state: input.outcome === "started" ? "dispatched" : "pending",
              })
            );
          }),
      },
      importWorkflowStarter: {
        dispatchAdmission: () =>
          Effect.sync(() => {
            workflowStarts += 1;
            events.push("workflow");
            return "created" as const;
          }),
      },
      retryDelaysMilliseconds: [0],
      scheduleRetry: (effect) => effect,
      trace: TestImportTrace,
    });

    await Effect.runPromise(
      dispatcher.dispatch({
        admission: Schema.decodeUnknownSync(HouseholdMemberAdmission)({
          actor: { _tag: "Member", actorId: "b".repeat(64) },
          organizationId: "organization-trace-durability-proof",
        }),
        committed,
      })
    );

    expect(events).toEqual([
      "record:prepared",
      "record:prepared",
      "workflow",
      "record:started",
    ]);
    expect(workflowStarts).toBe(1);
  });
});
