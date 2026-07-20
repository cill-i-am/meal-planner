import { access, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { Cause, Effect, Exit, Fiber, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import {
  AcquisitionGeneration,
  AcquisitionTaskOutcome,
  MaximumAcquisitionAttemptSeconds,
  MaximumLocalCleanupMilliseconds,
  acquisitionArtifactId,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import { ImportId } from "./import.contracts.js";
import {
  ensureImportWorkflowStarted,
  importWorkflowInstanceId,
  makeImportWorkflowStarter,
  AcquisitionTaskStepConfig,
  MaximumAbsoluteWorkflowSeconds,
  MaximumNestedAcquisitionAttempts,
  MaximumScheduledWorkflowSeconds,
  runAcquisitionTask,
} from "./import.workflow.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "018f47ad-91aa-7c35-b6fe-000000000001"
);

const require = createRequire(import.meta.url);
const nodePath = require("node:path") as {
  readonly join: (...paths: readonly string[]) => string;
};
const MiniflareOperationTimeoutMilliseconds = 5000;

const runWithin = async <Value>(
  operation: Promise<Value>,
  timeoutMilliseconds: number,
  label: string
) => {
  const timeoutController = new AbortController();
  try {
    return await Promise.race([
      operation,
      sleep(timeoutMilliseconds, undefined, {
        signal: timeoutController.signal,
      }).then(() => {
        throw new Error(`${label} timed out`);
      }),
    ]);
  } finally {
    timeoutController.abort();
  }
};

const deriveRetryCeiling = (totalPlatformExecutions: number) => {
  const nestedExecutionsPerPlatformExecution = 3;
  const innerBackoffSeconds = 1 + 2;
  const platformBackoffSeconds = Array.from(
    { length: totalPlatformExecutions - 1 },
    (_, index) => 2 * 2 ** index
  ).reduce((total, delay) => total + delay, 0);

  return {
    absoluteSeconds: totalPlatformExecutions * 17 * 60 + platformBackoffSeconds,
    nestedExecutions:
      totalPlatformExecutions * nestedExecutionsPerPlatformExecution,
    platformExecutions: totalPlatformExecutions,
    scheduledSeconds:
      totalPlatformExecutions *
        (nestedExecutionsPerPlatformExecution *
          MaximumAcquisitionAttemptSeconds +
          innerBackoffSeconds) +
      platformBackoffSeconds,
  };
};

const withRetryCharacterizationMiniflare = async <Value>(
  use: (miniflare: Miniflare) => Promise<Value>,
  options?: {
    readonly onPersistenceRoot?: (path: string) => void;
    readonly operationTimeoutMilliseconds?: number;
  }
) => {
  const persistenceRoot = await mkdtemp(
    nodePath.join(tmpdir(), "gaia109-miniflare-retry-")
  );
  options?.onPersistenceRoot?.(persistenceRoot);
  const miniflare = new Miniflare({
    cachePersist: nodePath.join(persistenceRoot, "cache"),
    compatibilityDate: "2026-07-14",
    kvNamespaces: ["ATTEMPTS"],
    kvPersist: nodePath.join(persistenceRoot, "kv"),
    modules: true,
    script: `
      import { WorkflowEntrypoint } from "cloudflare:workers";

      export class RetryCharacterizationWorkflow extends WorkflowEntrypoint {
        async run(_event, step) {
          await step.do(
            "always-fails",
            {
              retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
              timeout: "17 minutes"
            },
            async () => {
              const attempts = Number((await this.env.ATTEMPTS.get("count")) ?? "0") + 1;
              await this.env.ATTEMPTS.put("count", String(attempts));
              throw new Error("expected-characterization-failure");
            }
          );
        }
      }

      export default {
        async fetch(_request, env) {
          const workflow = env.RETRY_WORKFLOW;
          const sessionId = await workflow.unsafeStartIntrospection();
          try {
            await workflow.unsafeSetIntrospectionOperations(sessionId, [
              {
                type: "disableRetryDelays",
                steps: [{ name: "always-fails" }]
              }
            ]);
            const id = "miniflare-limit-3-characterization";
            await workflow.create({ id });
            await workflow.unsafeWaitForStatus(id, "errored");
            return Response.json({
              attempts: Number(await env.ATTEMPTS.get("count"))
            });
          } finally {
            await workflow.unsafeStopIntrospection(sessionId);
          }
        }
      };
    `,
    workflows: {
      RETRY_WORKFLOW: {
        className: "RetryCharacterizationWorkflow",
        name: "retry-characterization",
      },
    },
    workflowsPersist: nodePath.join(persistenceRoot, "workflows"),
  });

  try {
    return await runWithin(
      use(miniflare),
      options?.operationTimeoutMilliseconds ??
        MiniflareOperationTimeoutMilliseconds,
      "Miniflare retry characterization"
    );
  } finally {
    try {
      await runWithin(
        miniflare.dispose(),
        MiniflareOperationTimeoutMilliseconds,
        "Miniflare retry characterization teardown"
      );
    } finally {
      await rm(persistenceRoot, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 25,
      });
    }
  }
};

const readInstalledMiniflareRetryExecutions = (miniflare: Miniflare) =>
  miniflare
    .dispatchFetch("http://localhost/")
    .then((response) => response.json()) as Promise<{
    readonly attempts: number;
  }>;

const expectRemoved = async (path: string) => {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
};

describe("acquisition generation contracts", () => {
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe generation %s",
    (generation) => {
      expect(() =>
        Schema.decodeUnknownSync(AcquisitionGeneration)(generation)
      ).toThrow();
    }
  );

  it("builds only immutable generation-scoped object keys", () => {
    const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(7);

    expect(mediaObjectKey(importId, generation)).toBe(
      `imports/${importId}/acquisition/v1/generations/7/original.mp4`
    );
    expect(manifestObjectKey(importId, generation)).toBe(
      `imports/${importId}/acquisition/v1/generations/7/manifest.json`
    );
    expect(acquisitionArtifactId(importId, generation)).toBe(
      `${importId}:acquisition-generation:7`
    );
  });

  it.each([
    {
      _tag: "Unavailable",
      code: "private_or_unavailable",
      generation: 1,
    },
    {
      _tag: "UnsupportedCarousel",
      code: "unsupported_carousel",
      generation: 2,
    },
    {
      _tag: "TerminalMedia",
      code: "invalid_media",
      generation: 3,
      stage: "validation",
    },
    {
      _tag: "RetryExhausted",
      attempts: 3,
      generation: 4,
      stage: "store",
    },
  ])("requires a generation on $._tag outcomes", (outcome) => {
    expect(
      Schema.decodeUnknownSync(AcquisitionTaskOutcome, {
        onExcessProperty: "error",
      })(outcome)
    ).toEqual(outcome);
    expect(() =>
      Schema.decodeUnknownSync(AcquisitionTaskOutcome, {
        onExcessProperty: "error",
      })({ ...outcome, generation: undefined })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AcquisitionTaskOutcome, {
        onExcessProperty: "error",
      })({ ...outcome, mediaLocator: "provider-secret-fragment" })
    ).toThrow();
  });
});

const makeWorkflow = (
  status:
    | "complete"
    | "errored"
    | "paused"
    | "queued"
    | "running"
    | "terminated"
    | "unknown"
    | "waiting"
    | "waitingForPause",
  created = false
) => {
  const calls = {
    createBatch: [] as unknown[],
    get: [] as string[],
    restart: 0,
  };
  const instance = {
    id: importWorkflowInstanceId(importId),
    restart: () =>
      Effect.sync(() => {
        calls.restart += 1;
      }),
    status: () => Effect.succeed({ status }),
  };
  const workflow = {
    createBatch: (input: readonly unknown[]) =>
      Effect.sync(() => {
        calls.createBatch.push(input);
        return created ? [instance] : [];
      }),
    get: (id: string) =>
      Effect.sync(() => {
        calls.get.push(id);
        return instance;
      }),
  };
  return { calls, starter: makeImportWorkflowStarter(workflow) };
};

describe("import Workflow start reconciliation", () => {
  it("uses one deterministic, privacy-safe Workflow input", async () => {
    const { calls, starter } = makeWorkflow("queued", true);

    await expect(
      Effect.runPromise(starter.ensureStarted(importId))
    ).resolves.toBe("created");
    expect(importWorkflowInstanceId(importId)).toBe(
      `import-acquisition-${importId}`
    );
    expect(calls.createBatch).toEqual([
      [
        {
          id: `import-acquisition-${importId}`,
          params: { importId },
        },
      ],
    ]);
    expect(JSON.stringify(calls.createBatch)).not.toMatch(
      /url|locator|caption/iu
    );
  });

  it.each(["queued", "running", "waiting", "waitingForPause"] as const)(
    "treats native %s as active without restart",
    async (status) => {
      const { calls, starter } = makeWorkflow(status);

      await expect(
        Effect.runPromise(starter.ensureStarted(importId))
      ).resolves.toBe("already_active");
      expect(calls.restart).toBe(0);
    }
  );

  it("preserves an explicit operator pause", async () => {
    const { calls, starter } = makeWorkflow("paused");

    await expect(
      Effect.runPromise(starter.ensureStarted(importId))
    ).resolves.toBe("paused");
    expect(calls.restart).toBe(0);
  });

  it.each(["errored", "terminated", "complete"] as const)(
    "restarts a retained %s instance",
    async (status) => {
      const { calls, starter } = makeWorkflow(status);

      await expect(
        Effect.runPromise(starter.ensureStarted(importId))
      ).resolves.toBe("restarted");
      expect(calls.restart).toBe(1);
    }
  );

  it("maps unknown status, binding defects, and impossible batches to a safe typed failure", async () => {
    const unknown = makeWorkflow("unknown").starter.ensureStarted(importId);
    const defect = makeImportWorkflowStarter({
      createBatch: () => Effect.die("provider-secret-fragment"),
      get: () => Effect.die("unreachable"),
    }).ensureStarted(importId);
    const impossibleInstance = {
      restart: () => Effect.void,
      status: () => Effect.succeed({ status: "queued" }),
    };
    const impossible = makeImportWorkflowStarter({
      createBatch: () =>
        Effect.succeed([impossibleInstance, impossibleInstance]),
      get: () => Effect.die("unreachable"),
    }).ensureStarted(importId);

    await Promise.all(
      [unknown, defect, impossible].map(async (effect) => {
        const exit = await Effect.runPromiseExit(effect);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) {
          throw new Error("Expected Workflow start failure");
        }
        const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
        expect(error).toEqual({ _tag: "WorkflowStartUnavailable" });
        expect(JSON.stringify(error)).not.toContain("provider-secret-fragment");
      })
    );
  });

  it("reconciles create-response loss without creating a second instance", async () => {
    let created = false;
    const instance = {
      id: importWorkflowInstanceId(importId),
      restart: () => Effect.void,
      status: () => Effect.succeed({ status: "running" as const }),
    };
    const workflow = {
      createBatch: () =>
        Effect.suspend(() => {
          if (!created) {
            created = true;
            return Effect.die("response lost after create");
          }
          return Effect.succeed([]);
        }),
      get: () => Effect.succeed(instance),
    };
    const starter = makeImportWorkflowStarter(workflow);

    await expect(
      Effect.runPromise(starter.ensureStarted(importId))
    ).rejects.toMatchObject({ _tag: "WorkflowStartUnavailable" });
    await expect(
      Effect.runPromise(starter.ensureStarted(importId))
    ).resolves.toBe("already_active");
  });

  it("fails a missing starter method instead of silently stranding a queued import", async () => {
    await expect(
      Effect.runPromise(ensureImportWorkflowStarted({}, importId))
    ).rejects.toMatchObject({ _tag: "WorkflowStartUnavailable" });
  });
});

describe("import acquisition retry contract", () => {
  it("derives production bounds from Cloudflare's documented total-attempt contract", () => {
    expect(AcquisitionTaskStepConfig).toEqual({
      // eslint-disable-next-line sort-keys -- The assertion freezes the reviewer-approved literal order.
      retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
      timeout: "17 minutes",
    });
    expect(deriveRetryCeiling(AcquisitionTaskStepConfig.retries.limit)).toEqual(
      {
        absoluteSeconds: 3066,
        nestedExecutions: 9,
        platformExecutions: 3,
        scheduledSeconds: 2985,
      }
    );
    expect(MaximumNestedAcquisitionAttempts).toBe(9);
    expect(MaximumScheduledWorkflowSeconds).toBe(2985);
    expect(MaximumAbsoluteWorkflowSeconds).toBe(3066);
  });

  it("characterizes installed Miniflare limit 3 as four executions with an emulator-only ceiling", async () => {
    const miniflarePackage = require("miniflare/package.json") as {
      readonly version: string;
    };
    let persistenceRoot = "";

    expect(miniflarePackage.version).toBe("4.20260714.0");
    await expect(
      withRetryCharacterizationMiniflare(
        readInstalledMiniflareRetryExecutions,
        {
          onPersistenceRoot: (path) => {
            persistenceRoot = path;
          },
        }
      )
    ).resolves.toEqual({ attempts: 4 });
    await expectRemoved(persistenceRoot);
    expect(deriveRetryCeiling(4)).toEqual({
      absoluteSeconds: 4094,
      nestedExecutions: 12,
      platformExecutions: 4,
      scheduledSeconds: 3986,
    });
  }, 10_000);

  it("bounds and removes the exact Miniflare runtime after assertion and timeout failures", async () => {
    let assertionFailureRoot = "";
    await expect(
      withRetryCharacterizationMiniflare(
        async (miniflare) => {
          expect(
            await readInstalledMiniflareRetryExecutions(miniflare)
          ).toEqual({ attempts: 3 });
        },
        {
          onPersistenceRoot: (path) => {
            assertionFailureRoot = path;
          },
        }
      )
    ).rejects.toThrow();
    await expectRemoved(assertionFailureRoot);

    let timeoutFailureRoot = "";
    await expect(
      withRetryCharacterizationMiniflare(
        async (miniflare) => {
          await readInstalledMiniflareRetryExecutions(miniflare);
          return await Effect.runPromise(Effect.never);
        },
        {
          onPersistenceRoot: (path) => {
            timeoutFailureRoot = path;
          },
          operationTimeoutMilliseconds: 25,
        }
      )
    ).rejects.toThrow("Miniflare retry characterization timed out");
    await expectRemoved(timeoutFailureRoot);
  }, 15_000);

  it("runs typed retryable failures three total times after exact 1s and 2s delays", async () => {
    const generations: number[] = [];
    let attempts = 0;
    const effect = runAcquisitionTask(
      () => {
        const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(
          generations.length + 1
        );
        generations.push(generation);
        return Effect.succeed({ generation });
      },
      ({ generation }) => {
        attempts += 1;
        return attempts < 3
          ? Effect.fail({
              _tag: "RetryableAcquisitionFailure" as const,
              stage: "store" as const,
            })
          : Effect.succeed({
              _tag: "Unavailable" as const,
              code: "private_or_unavailable" as const,
              generation,
            });
      }
    );
    const result = await Effect.runPromise(
      Effect.gen(function* retryWithClock() {
        const fiber = yield* Effect.forkChild(effect);
        yield* Effect.yieldNow;
        expect(attempts).toBe(1);
        yield* TestClock.adjust("999 millis");
        expect(attempts).toBe(1);
        yield* TestClock.adjust("1 millis");
        expect(attempts).toBe(2);
        yield* TestClock.adjust("2 seconds");
        expect(attempts).toBe(3);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer({ warningDelay: "10 seconds" })))
    );

    expect(result).toEqual({
      _tag: "Unavailable",
      code: "private_or_unavailable",
      generation: 3,
    });
    expect(generations).toEqual([1, 2, 3]);
  });

  it("encodes third typed failure once while semantic outcomes execute once", async () => {
    let allocations = 0;
    let retries = 0;
    const exhausted = runAcquisitionTask(
      () =>
        Effect.sync(() => ({
          generation: Schema.decodeUnknownSync(AcquisitionGeneration)(
            (allocations += 1)
          ),
        })),
      () => {
        retries += 1;
        return Effect.fail({
          _tag: "RetryableAcquisitionFailure" as const,
          stage: "verify" as const,
        });
      }
    );
    const exhaustion = await Effect.runPromise(
      Effect.gen(function* exhaustWithClock() {
        const fiber = yield* Effect.forkChild(exhausted);
        yield* Effect.yieldNow;
        yield* TestClock.adjust("3 seconds");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer({ warningDelay: "10 seconds" })))
    );
    let semanticAttempts = 0;
    const semantic = await Effect.runPromise(
      runAcquisitionTask(
        () =>
          Effect.succeed({
            generation: Schema.decodeUnknownSync(AcquisitionGeneration)(4),
          }),
        ({ generation }) => {
          semanticAttempts += 1;
          return Effect.succeed({
            _tag: "UnsupportedCarousel" as const,
            code: "unsupported_carousel" as const,
            generation,
          });
        }
      )
    );

    expect(exhaustion).toEqual({
      _tag: "RetryExhausted",
      attempts: 3,
      generation: 3,
      stage: "verify",
    });
    expect(allocations).toBe(3);
    expect(retries).toBe(3);
    expect(semantic).toEqual({
      _tag: "UnsupportedCarousel",
      code: "unsupported_carousel",
      generation: 4,
    });
    expect(semanticAttempts).toBe(1);
  });

  it("retries allocation response loss without a provider call or fabricated outcome", async () => {
    let allocations = 0;
    let providerCalls = 0;
    const effect = runAcquisitionTask(
      () => {
        allocations += 1;
        return allocations === 1
          ? Effect.fail({ _tag: "ImportPersistenceUnavailable" as const })
          : Effect.succeed({
              generation: Schema.decodeUnknownSync(AcquisitionGeneration)(2),
            });
      },
      ({ generation }) => {
        providerCalls += 1;
        return Effect.succeed({
          _tag: "UnsupportedCarousel" as const,
          code: "unsupported_carousel" as const,
          generation,
        });
      }
    );
    const result = await Effect.runPromise(
      Effect.gen(function* retryWithClock() {
        const fiber = yield* Effect.forkChild(effect);
        yield* Effect.yieldNow;
        yield* TestClock.adjust("1 second");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer({ warningDelay: "10 seconds" })))
    );

    expect(result.generation).toBe(2);
    expect(allocations).toBe(2);
    expect(providerCalls).toBe(1);
  });

  it("reserves bounded cleanup inside three total 330-second attempt budgets", async () => {
    let allocations = 0;
    let cleanups = 0;
    const result = await Effect.runPromise(
      Effect.gen(function* timeoutWithClock() {
        const fiber = yield* Effect.forkChild(
          runAcquisitionTask(
            () =>
              Effect.sync(() => ({
                generation: Schema.decodeUnknownSync(AcquisitionGeneration)(
                  (allocations += 1)
                ),
              })),
            () =>
              Effect.never.pipe(
                Effect.ensuring(
                  Effect.sleep(
                    `${MaximumLocalCleanupMilliseconds} millis`
                  ).pipe(
                    Effect.andThen(
                      Effect.sync(() => {
                        cleanups += 1;
                      })
                    )
                  )
                )
              )
          )
        );
        yield* Effect.yieldNow;
        yield* TestClock.adjust("325 seconds");
        yield* TestClock.adjust("5 seconds");
        yield* TestClock.adjust("1 second");
        yield* TestClock.adjust("325 seconds");
        yield* TestClock.adjust("5 seconds");
        yield* TestClock.adjust("2 seconds");
        yield* TestClock.adjust("325 seconds");
        yield* TestClock.adjust("5 seconds");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer({ warningDelay: "10 seconds" })))
    );

    expect(result).toEqual({
      _tag: "RetryExhausted",
      attempts: 3,
      generation: 3,
      stage: "process",
    });
    expect(allocations).toBe(3);
    expect(cleanups).toBe(3);
  });

  it("fails the task after unconfirmed allocation exhaustion and allocates fresh on platform replay", async () => {
    let allocations = 0;
    let providerCalls = 0;
    let allowAllocation = false;
    const execute = () =>
      runAcquisitionTask(
        () => {
          allocations += 1;
          return allowAllocation
            ? Effect.succeed({
                generation: Schema.decodeUnknownSync(AcquisitionGeneration)(
                  allocations
                ),
              })
            : Effect.fail({ _tag: "ImportPersistenceUnavailable" as const });
        },
        ({ generation }) => {
          providerCalls += 1;
          return Effect.succeed({
            _tag: "UnsupportedCarousel" as const,
            code: "unsupported_carousel" as const,
            generation,
          });
        }
      );
    const first = await Effect.runPromise(
      Effect.gen(function* failWithClock() {
        const fiber = yield* Effect.forkChild(Effect.exit(execute()));
        yield* Effect.yieldNow;
        yield* TestClock.adjust("3 seconds");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer({ warningDelay: "10 seconds" })))
    );
    expect(Exit.isFailure(first)).toBe(true);
    expect(allocations).toBe(3);
    expect(providerCalls).toBe(0);

    allowAllocation = true;
    const replayed = await Effect.runPromise(execute());
    expect(replayed.generation).toBe(4);
    expect(providerCalls).toBe(1);
  });
});
