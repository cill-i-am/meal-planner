import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  HouseholdAdmitRecipeImportResult,
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
    const outcomes: ("started" | "unavailable")[] = [];
    const dispatchedIdentities: string[] = [];
    const registeredRoutes: string[] = [];
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
        recordRecipeImportDispatch: (input) => {
          outcomes.push(input.outcome);
          return Effect.succeed(
            Schema.encodeSync(HouseholdRecordRecipeImportDispatchResult)({
              admission: {
                committedAtEpochMs: 1,
                dispatchId: input.dispatchId,
                workflowIdentity: input.workflowIdentity,
              },
              attempts: outcomes.length,
              exhaustedAtEpochMs: null,
              state: input.outcome === "started" ? "dispatched" : "pending",
            })
          );
        },
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
      registerEvidenceRoute: (message) =>
        Effect.sync(() => {
          executionOrder.push(`route:${attempts + 1}`);
          registeredRoutes.push(
            `${message.organizationId}:${message.importId}:${message.routeVersion}`
          );
        }),
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

    expect(outcomes).toEqual(["unavailable", "unavailable", "started"]);
    expect(dispatchedIdentities).toEqual([
      workflowIdentity,
      workflowIdentity,
      workflowIdentity,
    ]);
    expect(registeredRoutes).toEqual([
      `organization-retry-proof:${intentId}:1`,
      `organization-retry-proof:${intentId}:1`,
      `organization-retry-proof:${intentId}:1`,
    ]);
    expect(executionOrder).toEqual([
      "route:1",
      "workflow:1",
      "route:2",
      "workflow:2",
      "route:3",
      "workflow:3",
    ]);
  });
});
