import { spawn } from "node:child_process";
import type { Stats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
// eslint-disable-next-line unicorn/import-style -- The root Alchemy TypeScript config disables synthetic default imports.
import { join, resolve as resolvePath, sep } from "node:path";

import { Context, Effect, Exit } from "effect";

import type {
  RetryableAcquisitionFailure,
  TerminalMediaFailure,
} from "./import-media.model.js";
import {
  MaximumMetadataStdoutBytes,
  MaximumRetainedStderrBytes,
  MaximumTemporaryBytes,
  MaximumTemporaryFileBytes,
  MaximumTemporaryFiles,
} from "./import-media.model.js";

interface CommandExecution {
  readonly signal: AbortSignal;
  readonly stderr: (chunk: Uint8Array) => void;
  readonly stdout: (chunk: Uint8Array) => void;
}

export type CommandExecutor = (
  execution: CommandExecution & {
    readonly args: readonly string[];
    readonly command: string;
  }
) => Promise<{ readonly exitCode: number }>;

export interface MediaProcessOptions {
  readonly deadlineMilliseconds: number;
  readonly failure: "retryable" | "terminal";
  readonly workspaceRoot?: string;
}

export interface MediaProcessResult {
  readonly stderrBytes: number;
  readonly stdout: Uint8Array;
}

export interface MediaProcessRunnerShape {
  readonly run: (
    command: string,
    args: readonly string[],
    options: MediaProcessOptions
  ) => Effect.Effect<
    MediaProcessResult,
    RetryableAcquisitionFailure | TerminalMediaFailure
  >;
}

export class MediaProcessRunner extends Context.Service<
  MediaProcessRunner,
  MediaProcessRunnerShape
>()("meal-planner/MediaProcessRunner") {}

interface TemporaryArtifact {
  readonly path: string | null;
  readonly root: string;
}

export const makeTemporaryArtifactStore = (
  removeRoot: (root: string) => Promise<void>
) => {
  const artifacts = new Map<string, TemporaryArtifact>();
  const cleanup = async (artifactId: string) => {
    const artifact = artifacts.get(artifactId);
    if (artifact === undefined) {
      return;
    }
    await removeRoot(artifact.root);
    if (artifacts.get(artifactId) === artifact) {
      artifacts.delete(artifactId);
    }
  };
  const register = (artifactId: string, root: string) => {
    artifacts.set(artifactId, { path: null, root });
  };
  return {
    cleanup,
    get: (artifactId: string) => artifacts.get(artifactId),
    register,
    setPath: (artifactId: string, path: string) => {
      const artifact = artifacts.get(artifactId);
      if (artifact === undefined) {
        throw new Error("Temporary artifact is not registered");
      }
      artifacts.set(artifactId, { path, root: artifact.root });
    },
    use: <A, E, R, E2, R2>(
      artifactId: string,
      acquireRoot: Effect.Effect<string, E, R>,
      useRoot: (root: string) => Effect.Effect<A, E2, R2>
    ) =>
      Effect.acquireUseRelease(
        acquireRoot.pipe(
          Effect.tap((root) =>
            Effect.sync(() => {
              register(artifactId, root);
            })
          )
        ),
        useRoot,
        (_root, exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : Effect.promise(() => cleanup(artifactId))
      ),
  };
};

const retryableProcess = (): RetryableAcquisitionFailure => ({
  _tag: "RetryableAcquisitionFailure",
  stage: "process",
});
const terminalProcess = (): TerminalMediaFailure => ({
  _tag: "TerminalMedia",
  code: "invalid_media",
  stage: "process",
});
const limitExceeded = (): TerminalMediaFailure => ({
  _tag: "TerminalMedia",
  code: "limit_exceeded",
  stage: "process",
});

const OutputLimitExceeded = Symbol("OutputLimitExceeded");

const processFailure = (
  error: unknown,
  failure: MediaProcessOptions["failure"]
) => {
  if (error === OutputLimitExceeded) {
    return limitExceeded();
  }
  return failure === "retryable" ? retryableProcess() : terminalProcess();
};

export interface TemporaryWorkspaceEntry {
  readonly kind: "directory" | "file" | "other" | "symlink";
  readonly path: string;
  readonly size: number;
}

const temporaryWorkspaceEntryKind = (
  stats: Stats
): TemporaryWorkspaceEntry["kind"] => {
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  if (stats.isDirectory()) {
    return "directory";
  }
  if (stats.isFile()) {
    return "file";
  }
  return "other";
};

export const validateTemporaryWorkspaceEntries = (
  entries: readonly TemporaryWorkspaceEntry[],
  root: string
) =>
  Effect.gen(function* validateWorkspace() {
    const resolvedRoot = resolvePath(root);
    let bytes = 0;
    let files = 0;
    for (const entry of entries) {
      const resolvedPath = resolvePath(entry.path);
      if (
        (resolvedPath !== resolvedRoot &&
          !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) ||
        (entry.kind !== "file" && entry.kind !== "directory") ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0
      ) {
        return yield* Effect.fail(limitExceeded());
      }
      if (entry.kind === "file") {
        files += 1;
        bytes += entry.size;
        if (
          files > MaximumTemporaryFiles ||
          entry.size > MaximumTemporaryFileBytes ||
          bytes > MaximumTemporaryBytes
        ) {
          return yield* Effect.fail(limitExceeded());
        }
      }
    }
  });

export const scanTemporaryWorkspace = (root: string) =>
  Effect.tryPromise({
    catch: limitExceeded,
    try: async () => {
      const entries: TemporaryWorkspaceEntry[] = [];
      const walk = async (directory: string): Promise<void> => {
        const names = await readdir(directory);
        const children = await Promise.all(
          names.map(async (name) => {
            const entryPath = join(directory, name);
            const stats = await lstat(entryPath);
            return {
              kind: temporaryWorkspaceEntryKind(stats),
              path: entryPath,
              size: stats.size,
            } satisfies TemporaryWorkspaceEntry;
          })
        );
        entries.push(...children);
        await Promise.all(
          children
            .filter((entry) => entry.kind === "directory")
            .map((entry) => walk(entry.path))
        );
      };
      await walk(root);
      return entries;
    },
  }).pipe(
    Effect.flatMap((entries) =>
      validateTemporaryWorkspaceEntries(entries, root)
    )
  );

type TemporaryWorkspaceScanner = (
  root: string
) => Effect.Effect<void, TerminalMediaFailure>;

export const makeMediaProcessRunner = (
  execute: CommandExecutor,
  scanWorkspace: TemporaryWorkspaceScanner = scanTemporaryWorkspace
): MediaProcessRunnerShape => ({
  run: (command, args, options) =>
    Effect.tryPromise({
      catch: (error) => processFailure(error, options.failure),
      try: async (signal) => {
        if (
          !Number.isFinite(options.deadlineMilliseconds) ||
          options.deadlineMilliseconds <= 0
        ) {
          throw OutputLimitExceeded;
        }
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
          controller.abort();
        }
        const timeout = setTimeout(abort, options.deadlineMilliseconds);
        const stdoutChunks: Uint8Array[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let outputLimitExceeded = false;
        const checkWorkspace = async () => {
          if (options.workspaceRoot === undefined) {
            return;
          }
          try {
            await Effect.runPromise(scanWorkspace(options.workspaceRoot), {
              signal: controller.signal,
            });
          } catch {
            if (controller.signal.aborted) {
              return;
            }
            outputLimitExceeded = true;
            controller.abort();
          }
        };
        try {
          await checkWorkspace();
          if (outputLimitExceeded) {
            throw OutputLimitExceeded;
          }
          if (controller.signal.aborted) {
            throw new Error("media process interrupted");
          }
          const workspacePoll = setInterval(() => {
            void checkWorkspace();
          }, 25);
          let result: { readonly exitCode: number };
          try {
            result = await execute({
              args,
              command,
              signal: controller.signal,
              stderr: (chunk) => {
                stderrBytes += chunk.byteLength;
                if (stderrBytes > MaximumRetainedStderrBytes) {
                  outputLimitExceeded = true;
                  controller.abort();
                }
              },
              stdout: (chunk) => {
                stdoutBytes += chunk.byteLength;
                if (stdoutBytes > MaximumMetadataStdoutBytes) {
                  outputLimitExceeded = true;
                  controller.abort();
                  return;
                }
                stdoutChunks.push(Uint8Array.from(chunk));
              },
            });
          } finally {
            clearInterval(workspacePoll);
          }
          await checkWorkspace();
          if (outputLimitExceeded) {
            throw OutputLimitExceeded;
          }
          if (controller.signal.aborted || result.exitCode !== 0) {
            throw new Error("media process failed");
          }
          const stdout = new Uint8Array(stdoutBytes);
          let offset = 0;
          for (const chunk of stdoutChunks) {
            stdout.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return { stderrBytes, stdout };
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener("abort", abort);
        }
      },
    }),
});

export const NodeCommandExecutor: CommandExecutor = ({
  args,
  command,
  signal,
  stderr,
  stdout,
}) =>
  // eslint-disable-next-line promise/avoid-new -- Child processes expose callback events, not a promise API.
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve({ exitCode: 1 });
      return;
    }
    const child = spawn(command, args, {
      detached: true,
      env: {
        HOME: "/nonexistent",
        LANG: "C.UTF-8",
        PATH: "/usr/local/bin:/usr/bin:/bin",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const terminate = () => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    child.stdout.on("data", (chunk: Buffer) => stdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr(chunk));
    child.once("error", (error) => {
      signal.removeEventListener("abort", terminate);
      reject(error);
    });
    child.once("close", (exitCode) => {
      signal.removeEventListener("abort", terminate);
      resolve({ exitCode: exitCode ?? 1 });
    });
    signal.addEventListener("abort", terminate, { once: true });
    if (signal.aborted) {
      terminate();
    }
  });
