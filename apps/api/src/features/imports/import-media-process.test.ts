import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
// eslint-disable-next-line unicorn/import-style -- The root Alchemy TypeScript config disables synthetic default imports.
import { join } from "node:path";

import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeMediaProcessRunner,
  makeTemporaryArtifactStore,
  NodeCommandExecutor,
  validateTemporaryWorkspaceEntries,
} from "./import-media-process.js";
import {
  MaximumMetadataStdoutBytes,
  MaximumRetainedStderrBytes,
  MaximumTemporaryBytes,
  MaximumTemporaryFileBytes,
  MaximumTemporaryFiles,
} from "./import-media.model.js";

const expectSafeFailure = async (effect: Effect.Effect<unknown, unknown>) => {
  const exit = await Effect.runPromiseExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected process failure");
  }
  const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
  expect(JSON.stringify(error)).not.toContain("provider-secret-fragment");
  return error;
};

const workspaceFiles = (count: number, size: number) =>
  Array.from({ length: count }, (_, index) => ({
    kind: "file" as const,
    path: `/work/${index}`,
    size,
  }));

const delayedMarker = (marker: string) => [
  "-e",
  `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "launched"), 200)`,
];

const ignoreProcessOutput = () => null;

const completeScanOnAbort = (
  signal: AbortSignal,
  onAbort: () => void = ignoreProcessOutput
) =>
  Effect.promise(
    () =>
      // eslint-disable-next-line promise/avoid-new -- The fake scanner models cooperative ownership by the runner signal.
      new Promise<void>((resolve) => {
        const complete = () => {
          onAbort();
          resolve();
        };
        if (signal.aborted) {
          complete();
          return;
        }
        signal.addEventListener("abort", complete, { once: true });
      })
  );

describe("bounded media process execution", () => {
  it("freezes stdout, stderr, temp-byte, file-count, and per-file caps", () => {
    expect({
      MaximumMetadataStdoutBytes,
      MaximumRetainedStderrBytes,
      MaximumTemporaryBytes,
      MaximumTemporaryFileBytes,
      MaximumTemporaryFiles,
    }).toEqual({
      MaximumMetadataStdoutBytes: 1_048_576,
      MaximumRetainedStderrBytes: 65_536,
      MaximumTemporaryBytes: 805_306_368,
      MaximumTemporaryFileBytes: 268_435_456,
      MaximumTemporaryFiles: 16,
    });
  });

  it("bounds output and maps timeout/exit without preserving process text", async () => {
    const outputRunner = makeMediaProcessRunner(({ stderr, stdout }) => {
      stdout(new Uint8Array(MaximumMetadataStdoutBytes + 1));
      stderr(new TextEncoder().encode("provider-secret-fragment"));
      return Promise.resolve({ exitCode: 0 });
    });
    const exitRunner = makeMediaProcessRunner(({ stderr }) => {
      stderr(new TextEncoder().encode("provider-secret-fragment"));
      return Promise.resolve({ exitCode: 2 });
    });

    await expectSafeFailure(
      outputRunner.run("yt-dlp", ["--dump-single-json"], {
        deadlineMilliseconds: 100,
        failure: "terminal",
      })
    );
    await expectSafeFailure(
      exitRunner.run("ffmpeg", ["-c", "copy"], {
        deadlineMilliseconds: 100,
        failure: "retryable",
      })
    );

    const asynchronousOverflow = makeMediaProcessRunner(
      ({ stdout }) =>
        // eslint-disable-next-line promise/avoid-new -- The test exercises asynchronous process output callbacks.
        new Promise((resolve) => {
          queueMicrotask(() => {
            stdout(new Uint8Array(MaximumMetadataStdoutBytes + 1));
            resolve({ exitCode: 0 });
          });
        })
    );
    await expectSafeFailure(
      asynchronousOverflow.run("ffprobe", ["-of", "json"], {
        deadlineMilliseconds: 100,
        failure: "terminal",
      })
    );
  });

  it("settles without invoking an executor when the deadline expires during initial workspace preflight", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "meal-planner-process-preflight-")
    );
    try {
      let executions = 0;
      const runner = makeMediaProcessRunner(
        () => {
          executions += 1;
          return Promise.resolve({ exitCode: 0 });
        },
        (_root, signal) => completeScanOnAbort(signal)
      );

      const deadlineMissed = Promise.withResolvers<{
        readonly _tag: "DeadlineMissed";
      }>();
      const timeout = setTimeout(
        () => deadlineMissed.resolve({ _tag: "DeadlineMissed" }),
        100
      );
      const completion = expectSafeFailure(
        runner.run("yt-dlp", ["synthetic-only"], {
          deadlineMilliseconds: 10,
          failure: "retryable",
          workspaceRoot: root,
        })
      ).then((failure) => ({ _tag: "Settled" as const, failure }));
      const result = await Promise.race([completion, deadlineMissed.promise]);
      clearTimeout(timeout);

      expect(result).toEqual({
        _tag: "Settled",
        failure: {
          _tag: "RetryableAcquisitionFailure",
          stage: "process",
        },
      });
      expect(executions).toBe(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each(["resolves", "rejects"] as const)(
    "joins an active periodic workspace scan before the final check and settlement when the executor %s",
    async (executorSettlement) => {
      let executions = 0;
      let finalizers = 0;
      let finalizersWhenFinalScan: number | undefined;
      let rawScanSettled = false;
      let scans = 0;
      const periodicScanStarted = Promise.withResolvers<null>();
      const runner = makeMediaProcessRunner(
        async () => {
          executions += 1;
          await periodicScanStarted.promise;
          // eslint-disable-next-line promise/avoid-new -- Real time lets multiple poll ticks challenge the single-flight owner.
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 60);
          });
          if (executorSettlement === "rejects") {
            throw new Error("provider-secret-fragment");
          }
          return { exitCode: 0 };
        },
        (_root, signal) => {
          scans += 1;
          if (scans === 3) {
            finalizersWhenFinalScan = finalizers;
          }
          if (scans !== 2) {
            return Effect.void;
          }
          periodicScanStarted.resolve(null);
          return completeScanOnAbort(signal, () => {
            rawScanSettled = true;
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                finalizers += 1;
              })
            )
          );
        }
      );
      const hardBoundMissed = Promise.withResolvers<{
        readonly _tag: "HardBoundMissed";
      }>();
      const hardBound = setTimeout(
        () => hardBoundMissed.resolve({ _tag: "HardBoundMissed" }),
        500
      );

      try {
        const completion = Effect.runPromiseExit(
          runner.run("yt-dlp", ["synthetic-only"], {
            deadlineMilliseconds: 125,
            failure: "retryable",
            workspaceRoot: "/tmp/meal-planner-periodic-scan",
          })
        ).then((exit) => ({
          _tag: "Settled" as const,
          exit,
          finalizersAtSettlement: finalizers,
          rawScanSettledAtSettlement: rawScanSettled,
          scansAtSettlement: scans,
        }));
        const result = await Promise.race([
          completion,
          hardBoundMissed.promise,
        ]);

        expect(result._tag).toBe("Settled");
        if (result._tag !== "Settled") {
          throw new Error("Media process runner exceeded its hard test bound");
        }
        expect(Exit.isFailure(result.exit)).toBe(true);
        if (Exit.isSuccess(result.exit)) {
          throw new Error("Expected deadline interruption while joining scan");
        }
        expect(
          Option.getOrThrow(Cause.findErrorOption(result.exit.cause))
        ).toEqual({
          _tag: "RetryableAcquisitionFailure",
          stage: "process",
        });
        expect(result.finalizersAtSettlement).toBe(1);
        expect(result.rawScanSettledAtSettlement).toBe(true);
        expect(finalizersWhenFinalScan).toBe(1);
        expect(result.scansAtSettlement).toBe(3);
        expect(executions).toBe(1);

        const settledScanCount = scans;
        // eslint-disable-next-line promise/avoid-new -- The observation window proves no poll survives settlement.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 50);
        });
        expect(scans).toBe(settledScanCount);
        expect(finalizers).toBe(1);
      } finally {
        clearTimeout(hardBound);
      }
    }
  );

  it("joins the active workspace scan before upstream interruption settles", async () => {
    let finalizers = 0;
    let finalizersWhenFinalScan: number | undefined;
    let rawScanSettled = false;
    let scans = 0;
    const executorSettled = Promise.withResolvers<null>();
    const periodicScanStarted = Promise.withResolvers<null>();
    const runner = makeMediaProcessRunner(
      async () => {
        await periodicScanStarted.promise;
        executorSettled.resolve(null);
        return { exitCode: 0 };
      },
      (_root, signal) => {
        scans += 1;
        if (scans === 3) {
          finalizersWhenFinalScan = finalizers;
        }
        if (scans !== 2) {
          return Effect.void;
        }
        periodicScanStarted.resolve(null);
        return completeScanOnAbort(signal, () => {
          rawScanSettled = true;
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              finalizers += 1;
            })
          )
        );
      }
    );
    const upstream = new AbortController();
    const completion = Effect.runPromiseExit(
      runner.run("yt-dlp", ["synthetic-only"], {
        deadlineMilliseconds: 1000,
        failure: "retryable",
        workspaceRoot: "/tmp/meal-planner-upstream-scan",
      }),
      { signal: upstream.signal }
    ).then((exit) => ({
      exit,
      finalizersAtSettlement: finalizers,
      rawScanSettledAtSettlement: rawScanSettled,
      scansAtSettlement: scans,
    }));
    const hardBoundMissed = Promise.withResolvers<{
      readonly _tag: "HardBoundMissed";
    }>();
    const hardBound = setTimeout(
      () => hardBoundMissed.resolve({ _tag: "HardBoundMissed" }),
      500
    );

    try {
      await executorSettled.promise;
      upstream.abort();
      const result = await Promise.race([completion, hardBoundMissed.promise]);

      expect(result).not.toEqual({ _tag: "HardBoundMissed" });
      if ("_tag" in result) {
        throw new Error("Upstream interruption exceeded its hard test bound");
      }
      expect(Exit.hasInterrupts(result.exit)).toBe(true);
      expect(result.finalizersAtSettlement).toBe(1);
      expect(result.rawScanSettledAtSettlement).toBe(true);
      expect(finalizersWhenFinalScan).toBe(1);
      expect(result.scansAtSettlement).toBe(3);

      const settledScanCount = scans;
      // eslint-disable-next-line promise/avoid-new -- The observation window proves no poll survives interruption.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
      expect(scans).toBe(settledScanCount);
      expect(finalizers).toBe(1);
    } finally {
      clearTimeout(hardBound);
      upstream.abort();
    }
  });

  it("never launches a child for a pre-aborted execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "meal-planner-process-aborted-"));
    const marker = join(root, "launched");
    try {
      const controller = new AbortController();
      controller.abort();
      const result = await NodeCommandExecutor({
        args: [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "launched")`,
        ],
        command: process.execPath,
        signal: controller.signal,
        stderr: ignoreProcessOutput,
        stdout: ignoreProcessOutput,
      });

      expect(result.exitCode).not.toBe(0);
      await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("closes the spawn-listener race and interrupts an in-flight child", async () => {
    const root = await mkdtemp(join(tmpdir(), "meal-planner-process-race-"));
    const raceMarker = join(root, "race-launched");
    const interruptionMarker = join(root, "interruption-launched");
    try {
      let abortedReads = 0;
      const racingSignal = {
        get aborted() {
          abortedReads += 1;
          return abortedReads > 1;
        },
        addEventListener: () => null,
        removeEventListener: () => null,
      } as unknown as AbortSignal;
      const raceResult = await NodeCommandExecutor({
        args: delayedMarker(raceMarker),
        command: process.execPath,
        signal: racingSignal,
        stderr: ignoreProcessOutput,
        stdout: ignoreProcessOutput,
      });

      expect(raceResult.exitCode).not.toBe(0);
      await expect(access(raceMarker)).rejects.toMatchObject({
        code: "ENOENT",
      });

      const controller = new AbortController();
      const interrupted = NodeCommandExecutor({
        args: delayedMarker(interruptionMarker),
        command: process.execPath,
        signal: controller.signal,
        stderr: ignoreProcessOutput,
        stdout: ignoreProcessOutput,
      });
      setTimeout(() => controller.abort(), 25);
      const interruptedResult = await interrupted;

      expect(interruptedResult.exitCode).not.toBe(0);
      await expect(access(interruptionMarker)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("enforces the total, individual, file-count, and forbidden-entry workspace boundaries", async () => {
    await expect(
      Effect.runPromise(
        validateTemporaryWorkspaceEntries(
          workspaceFiles(3, MaximumTemporaryFileBytes),
          "/work"
        )
      )
    ).resolves.toBeUndefined();
    await expectSafeFailure(
      validateTemporaryWorkspaceEntries(
        [
          ...workspaceFiles(3, MaximumTemporaryFileBytes),
          { kind: "file", path: "/work/4", size: 1 },
        ],
        "/work"
      )
    );
    await expectSafeFailure(
      validateTemporaryWorkspaceEntries(
        [
          {
            kind: "file",
            path: "/work/large",
            size: MaximumTemporaryFileBytes + 1,
          },
        ],
        "/work"
      )
    );
    await expectSafeFailure(
      validateTemporaryWorkspaceEntries(workspaceFiles(17, 0), "/work")
    );
    await expectSafeFailure(
      validateTemporaryWorkspaceEntries(
        [{ kind: "symlink", path: "/work/link", size: 0 }],
        "/work"
      )
    );
    await expectSafeFailure(
      validateTemporaryWorkspaceEntries(
        [{ kind: "file", path: "/outside/escape", size: 1 }],
        "/work"
      )
    );
  });

  it("interrupts a running process when its workspace crosses the file cap", async () => {
    const root = await mkdtemp(join(tmpdir(), "meal-planner-process-cap-"));
    try {
      const runner = makeMediaProcessRunner(async ({ signal }) => {
        await Promise.all(
          Array.from({ length: MaximumTemporaryFiles + 1 }, (_, index) =>
            writeFile(join(root, `partial-${index}`), "")
          )
        );
        // eslint-disable-next-line promise/avoid-new -- The fake process waits for its AbortSignal callback.
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return { exitCode: 1 };
      });

      const failure = await expectSafeFailure(
        runner.run("yt-dlp", ["synthetic-only"], {
          deadlineMilliseconds: 1000,
          failure: "retryable",
          workspaceRoot: root,
        })
      );
      expect(failure).toEqual({
        _tag: "TerminalMedia",
        code: "limit_exceeded",
        stage: "process",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("retains temporary ownership after failed removal and retries cleanup", async () => {
    const removed: string[] = [];
    let attempts = 0;
    const artifacts = makeTemporaryArtifactStore((root) => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new Error("synthetic removal failure"));
      }
      removed.push(root);
      return Promise.resolve();
    });
    artifacts.register("artifact", "/tmp/task-owned-artifact");

    await expect(artifacts.cleanup("artifact")).rejects.toThrow(
      "synthetic removal failure"
    );
    expect(artifacts.get("artifact")).toEqual({
      path: null,
      root: "/tmp/task-owned-artifact",
    });
    await expect(artifacts.cleanup("artifact")).resolves.toBeUndefined();

    expect(removed).toEqual(["/tmp/task-owned-artifact"]);
    expect(artifacts.get("artifact")).toBeUndefined();
  });

  it("does not release a replacement registered while an older cleanup settles", async () => {
    const oldRemoval = Promise.withResolvers<null>();
    const artifacts = makeTemporaryArtifactStore(async (root) => {
      if (root === "/tmp/old-generation") {
        await oldRemoval.promise;
      }
    });
    artifacts.register("artifact", "/tmp/old-generation");

    const cleanup = artifacts.cleanup("artifact");
    artifacts.register("artifact", "/tmp/new-generation");
    oldRemoval.resolve(null);
    await cleanup;

    expect(artifacts.get("artifact")).toEqual({
      path: null,
      root: "/tmp/new-generation",
    });
  });

  it("owns and removes a temporary root created after interruption begins", async () => {
    const removed: string[] = [];
    const artifacts = makeTemporaryArtifactStore((root) => {
      removed.push(root);
      return Promise.resolve();
    });
    const creationStarted = Promise.withResolvers<null>();
    const rootCreated = Promise.withResolvers<string>();
    const exit = await Effect.runPromise(
      Effect.gen(function* interruptPreparation() {
        const fiber = yield* Effect.forkChild(
          artifacts.use(
            "artifact",
            Effect.promise(() => {
              creationStarted.resolve(null);
              return rootCreated.promise;
            }),
            () => Effect.never
          )
        );
        yield* Effect.promise(() => creationStarted.promise);
        const interrupter = yield* Effect.forkChild(Fiber.interrupt(fiber));
        yield* Effect.yieldNow;
        rootCreated.resolve("/tmp/task-owned-artifact");
        yield* Fiber.await(interrupter);
        return yield* Fiber.await(fiber);
      })
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(removed).toEqual(["/tmp/task-owned-artifact"]);
    expect(artifacts.get("artifact")).toBeUndefined();
  });
});
