import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeHouseholdBatchWorkflowLauncher } from "./household-import-batch-queue.handlers.js";

describe("household batch Workflow reconciliation", () => {
  it.each(["paused", "queued", "running", "waiting", "waitingForPause"])(
    "keeps %s Workflows active without restarting",
    async (status) => {
      let restarts = 0;
      const launcher = makeHouseholdBatchWorkflowLauncher({
        create: () => Effect.void,
        get: () =>
          Effect.succeed({
            restart: () =>
              Effect.sync(() => {
                restarts += 1;
              }),
            status: () => Effect.succeed({ status }),
          }),
      });

      await expect(
        Effect.runPromise(launcher.reconcile("stable-workflow-id"))
      ).resolves.toEqual({ _tag: "Active" });
      expect(restarts).toBe(0);
    }
  );

  it.each(["errored", "terminated"])(
    "redrives %s Workflows through the same instance",
    async (status) => {
      let restarts = 0;
      const launcher = makeHouseholdBatchWorkflowLauncher({
        create: () => Effect.void,
        get: () =>
          Effect.succeed({
            restart: () =>
              Effect.sync(() => {
                restarts += 1;
              }),
            status: () => Effect.succeed({ status }),
          }),
      });

      await expect(
        Effect.runPromise(launcher.reconcile("stable-workflow-id"))
      ).resolves.toEqual({ _tag: "Redriven" });
      expect(restarts).toBe(1);
    }
  );

  it("keeps completed Workflows settled without restarting", async () => {
    let restarts = 0;
    const launcher = makeHouseholdBatchWorkflowLauncher({
      create: () => Effect.void,
      get: () =>
        Effect.succeed({
          restart: () =>
            Effect.sync(() => {
              restarts += 1;
            }),
          status: () => Effect.succeed({ status: "complete" }),
        }),
    });

    await expect(
      Effect.runPromise(launcher.reconcile("stable-workflow-id"))
    ).resolves.toEqual({ _tag: "Complete" });
    expect(restarts).toBe(0);
  });

  it("keeps unknown status retryable without restarting", async () => {
    let restarts = 0;
    const launcher = makeHouseholdBatchWorkflowLauncher({
      create: () => Effect.void,
      get: () =>
        Effect.succeed({
          restart: () =>
            Effect.sync(() => {
              restarts += 1;
            }),
          status: () => Effect.succeed({ status: "unknown" }),
        }),
    });

    await expect(
      Effect.runPromise(launcher.reconcile("stable-workflow-id"))
    ).rejects.toThrow("batch workflow status is unavailable: unknown");
    expect(restarts).toBe(0);
  });

  it("proves a native missing instance was not started", async () => {
    const launcher = makeHouseholdBatchWorkflowLauncher({
      create: () => Effect.void,
      get: () => Effect.die(new Error("instance.not_found")),
    });

    await expect(
      Effect.runPromise(launcher.reconcile("stable-workflow-id"))
    ).resolves.toEqual({ _tag: "NotStarted" });
  });

  it("preserves other native status failures as ambiguous", async () => {
    const launcher = makeHouseholdBatchWorkflowLauncher({
      create: () => Effect.void,
      get: () => Effect.die(new Error("instance.status_unavailable")),
    });

    await expect(
      Effect.runPromise(launcher.reconcile("stable-workflow-id"))
    ).rejects.toThrow("instance.status_unavailable");
  });
});
