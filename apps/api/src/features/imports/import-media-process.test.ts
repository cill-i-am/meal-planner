import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
// eslint-disable-next-line unicorn/import-style -- The root Alchemy TypeScript config disables synthetic default imports.
import { join } from "node:path";

import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeMediaProcessRunner,
  makeTemporaryArtifactStore,
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
