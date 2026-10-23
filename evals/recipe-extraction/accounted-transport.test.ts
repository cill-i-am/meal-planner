import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect, Schema } from "effect";
import { expect, it } from "vitest";

import {
  createAccountedEvaluationTransport,
  evaluationBridgePaths,
  EvaluationInvocation,
} from "./accounted-transport.js";

const request = (dispatchId: string, maximumCostMicroUsd = 100_000) =>
  Schema.decodeUnknownSync(EvaluationInvocation)({
    body: {
      max_tokens: 16,
      messages: [{ content: "Synthetic accounting test", role: "user" }],
    },
    dispatchId,
    inputMicroUsdPerToken: 1,
    maximumCostMicroUsd,
    model: "@cf/meta/llama-3.1-8b-instruct",
    outputMicroUsdPerToken: 2,
  });
const PendingRequest = Schema.Struct({ requestSha256: Schema.String });
const readPending = async (rootDirectory: string, dispatchId: string) => {
  const files = evaluationBridgePaths(rootDirectory, dispatchId);
  await expect
    .poll(() => readFile(files.request, "utf-8"), { timeout: 10_000 })
    .toBeDefined();
  return Schema.decodeUnknownSync(PendingRequest)(
    JSON.parse(await readFile(files.request, "utf-8"))
  );
};
const respond = async (
  rootDirectory: string,
  dispatchId: string,
  body: Schema.Json,
  wrongHash = false
) => {
  const pending = await readPending(rootDirectory, dispatchId);
  const files = evaluationBridgePaths(rootDirectory, dispatchId);
  await writeFile(
    `${files.response}.tmp`,
    JSON.stringify({
      body,
      dispatchId,
      headers: {},
      latencyMs: 12,
      requestSha256: wrongHash ? "0".repeat(64) : pending.requestSha256,
      status: 200,
    })
  );
  await rename(`${files.response}.tmp`, files.response);
};
const measuredBody = {
  result: {
    response: "synthetic",
    usage: { input_tokens: 5, output_tokens: 2 },
  },
  success: true,
};

it("claims before publishing, settles measured cost, persists and never replenishes the evaluation reservation cap", async () => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), "evaluation-transport-")
  );
  const options = { rootDirectory, runId: "accounted-test" };
  let transport = await createAccountedEvaluationTransport(options);
  try {
    const first = Effect.runPromise(
      transport.invoke(request("known-1", 600_000))
    );
    await readPending(rootDirectory, "known-1");
    const pendingLedger = await Effect.runPromise(transport.readLedger());
    expect(pendingLedger.dispatches).toMatchObject([
      { maximum_cost_micro_usd: 600_000, state: "invoking" },
    ]);
    await respond(rootDirectory, "known-1", measuredBody);
    expect(await first).toMatchObject({
      _tag: "Completed",
      actualCostMicroUsd: 9,
      value: { usage: { inputTokens: 5, outputTokens: 2 } },
    });
    await transport.close();
    transport = await createAccountedEvaluationTransport(options);
    expect(
      await Effect.runPromise(transport.invoke(request("known-1", 600_000)))
    ).toEqual({ _tag: "AlreadySettled", actualCostMicroUsd: 9 });
    const second = await Effect.runPromiseExit(
      transport.invoke(request("known-2", 600_000))
    );
    expect(second._tag).toBe("Failure");
    await expect(
      readFile(evaluationBridgePaths(rootDirectory, "known-2").request)
    ).rejects.toMatchObject({ code: "ENOENT" });
    const ledger = await Effect.runPromise(transport.readLedger());
    expect(ledger.dispatches).toHaveLength(1);
    expect(ledger.budget).toMatchObject([
      { reserved_micro_usd: 0, settled_micro_usd: 9, state: "open" },
    ]);
  } finally {
    await transport.close();
    await rm(rootDirectory, { force: true, recursive: true });
  }
});

it("poisons missing usage and refuses every later invocation", async () => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), "evaluation-transport-")
  );
  const transport = await createAccountedEvaluationTransport({
    rootDirectory,
    runId: "unknown-test",
  });
  try {
    const pending = Effect.runPromise(transport.invoke(request("unknown-1")));
    await respond(rootDirectory, "unknown-1", {
      result: { response: "no authoritative usage" },
      success: true,
    });
    expect(await pending).toMatchObject({
      _tag: "CompletedUnknownCost",
      value: { cost: { _tag: "Unknown" } },
    });
    const rejected = await Effect.runPromiseExit(
      transport.invoke(request("unknown-2"))
    );
    expect(rejected._tag).toBe("Failure");
    const ledger = await Effect.runPromise(transport.readLedger());
    expect(ledger.budget).toMatchObject([{ state: "poisoned" }]);
    expect(ledger.dispatches).toMatchObject([
      { actual_cost_micro_usd: null, state: "settled_unknown" },
    ]);
    await expect(
      readFile(evaluationBridgePaths(rootDirectory, "unknown-2").request)
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await transport.close();
    await rm(rootDirectory, { force: true, recursive: true });
  }
});

it("settles a missing bridge response as unknown after its bounded deadline", async () => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), "evaluation-transport-")
  );
  const transport = await createAccountedEvaluationTransport({
    bridgeTimeoutMs: 50,
    rootDirectory,
    runId: "timeout-test",
  });
  try {
    const result = await Effect.runPromiseExit(
      transport.invoke(request("timeout-1"))
    );
    expect(result._tag).toBe("Failure");
    const ledger = await Effect.runPromise(transport.readLedger());
    expect(ledger.dispatches).toMatchObject([
      { invocation_generation: 1, state: "settled_unknown" },
    ]);
    expect(ledger.budget).toMatchObject([{ state: "poisoned" }]);
  } finally {
    await transport.close();
    await rm(rootDirectory, { force: true, recursive: true });
  }
});

it("rejects mismatched response identity and retains unknown cost", async () => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), "evaluation-transport-")
  );
  const transport = await createAccountedEvaluationTransport({
    rootDirectory,
    runId: "identity-test",
  });
  try {
    const pending = Effect.runPromiseExit(
      transport.invoke(request("identity-1"))
    );
    await respond(rootDirectory, "identity-1", measuredBody, true);
    const rejected = await pending;
    expect(rejected._tag).toBe("Failure");
    const ledger = await Effect.runPromise(transport.readLedger());
    expect(ledger.dispatches).toMatchObject([
      { actual_cost_micro_usd: null, state: "settled_unknown" },
    ]);
  } finally {
    await transport.close();
    await rm(rootDirectory, { force: true, recursive: true });
  }
});

it("persists the invocation-count limit and rejects a looser restart configuration", async () => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), "evaluation-transport-")
  );
  const transport = await createAccountedEvaluationTransport({
    maximumInvocations: 1,
    rootDirectory,
    runId: "count-test",
  });
  try {
    const first = Effect.runPromise(transport.invoke(request("count-1")));
    await respond(rootDirectory, "count-1", measuredBody);
    await first;
    const rejected = await Effect.runPromiseExit(
      transport.invoke(request("count-2"))
    );
    expect(rejected._tag).toBe("Failure");
    const ledger = await Effect.runPromise(transport.readLedger());
    expect(ledger.dispatches).toHaveLength(1);
  } finally {
    await transport.close();
  }
  try {
    await expect(
      createAccountedEvaluationTransport({
        maximumInvocations: 2,
        rootDirectory,
        runId: "count-test",
      })
    ).rejects.toMatchObject({ code: "persisted_limits_mismatch" });
  } finally {
    await rm(rootDirectory, { force: true, recursive: true });
  }
});

it("interruption settles the dispatched request as unknown before closing the ledger", async () => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), "evaluation-transport-")
  );
  const transport = await createAccountedEvaluationTransport({
    rootDirectory,
    runId: "interrupt-test",
  });
  const controller = new AbortController();
  try {
    const pending = Effect.runPromiseExit(
      transport.invoke(request("interrupt-1")),
      { signal: controller.signal }
    );
    await readPending(rootDirectory, "interrupt-1");
    controller.abort();
    const result = await pending;
    expect(result._tag).toBe("Failure");
    const ledger = await Effect.runPromise(transport.readLedger());
    expect(ledger.dispatches).toMatchObject([
      { invocation_generation: 1, state: "settled_unknown" },
    ]);
    expect(ledger.budget).toMatchObject([{ state: "poisoned" }]);
  } finally {
    await transport.close();
    await rm(rootDirectory, { force: true, recursive: true });
  }
});

it.each(["write", "rename"] as const)(
  "cancellation during request %s joins publication before settling unknown and closing D1",
  async (phase) => {
    const rootDirectory = await mkdtemp(
      path.join(tmpdir(), "evaluation-transport-publication-")
    );
    const options = { rootDirectory, runId: "publication-test" };
    const staged = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    const controller = new AbortController();
    let publicationSignal: AbortSignal | undefined;
    const transport = await createAccountedEvaluationTransport(options, {
      rename: async (...args) => {
        if (phase === "rename") {
          staged.resolve(null);
          await release.promise;
        }
        await rename(...args);
      },
      writeFile: async (file, data, writeOptions) => {
        publicationSignal = Schema.decodeUnknownSync(
          Schema.Struct({ signal: Schema.instanceOf(AbortSignal) })
        )(writeOptions).signal;
        await writeFile(file, data, writeOptions);
        if (phase === "write") {
          staged.resolve(null);
          await release.promise;
        }
      },
    });
    const files = evaluationBridgePaths(rootDirectory, "cancel-publication");
    try {
      const pending = Effect.runPromiseExit(
        transport.invoke(request("cancel-publication")),
        { signal: controller.signal }
      );
      // The real file is staged, but the bridge cannot observe a request yet.
      await staged.promise;
      await expect(readFile(files.request)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(publicationSignal).toBeDefined();
      controller.abort();
      const closing = transport.close();
      await expect.poll(() => publicationSignal?.aborted).toBe(true);
      const beforeRelease = await Effect.runPromise(transport.readLedger());
      expect(beforeRelease.dispatches).toMatchObject([
        { invocation_generation: 1, state: "invoking" },
      ]);
      expect(beforeRelease.budget).toMatchObject([
        { reserved_micro_usd: 100_000, state: "invoking" },
      ]);
      await expect(
        readFile(path.join(rootDirectory, "transport.lock"))
      ).resolves.toBeDefined();
      release.resolve(null);
      const interrupted = await pending;
      expect(interrupted._tag).toBe("Failure");
      await closing;
      await expect(
        readFile(path.join(rootDirectory, "transport.lock"))
      ).rejects.toMatchObject({ code: "ENOENT" });
      // A cancelled staged write must never publish. An already-submitted
      // rename must finish before shutdown, while invocation is still owned.
      await (phase === "write"
        ? expect(readFile(files.request)).rejects.toMatchObject({
            code: "ENOENT",
          })
        : expect(readFile(files.request)).resolves.toBeDefined());
      const reopened = await createAccountedEvaluationTransport(options);
      try {
        const ledger = await Effect.runPromise(reopened.readLedger());
        expect(ledger.dispatches).toMatchObject([
          {
            actual_cost_micro_usd: null,
            invocation_generation: 1,
            state: "settled_unknown",
          },
        ]);
        expect(ledger.budget).toMatchObject([
          {
            reserved_micro_usd: 100_000,
            settled_micro_usd: 0,
            state: "poisoned",
          },
        ]);
      } finally {
        await reopened.close();
      }
    } finally {
      release.resolve(null);
      controller.abort();
      await transport.close();
      await rm(rootDirectory, { force: true, recursive: true });
    }
  },
  15_000
);

it("the CLI exits nonzero and records stopped_unknown when a provider response has no usage", async () => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), "evaluation-transport-cli-")
  );
  const requestFile = path.join(rootDirectory, "input.json");
  await writeFile(requestFile, JSON.stringify(request("cli-unknown")));
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "evals/recipe-extraction/accounted-transport.ts",
      "bridge",
      rootDirectory,
      "cli-test",
      requestFile,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let output = "";
  child.stdout.on("data", (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.resume();
  const closed = once(child, "close");
  try {
    await respond(rootDirectory, "cli-unknown", {
      result: { response: "synthetic unmetered response" },
    });
    const [exitCode] = await closed;
    expect(exitCode).toBe(1);
    expect(output).toContain('"status":"stopped_unknown"');
  } finally {
    child.kill("SIGTERM");
    await closed;
    await rm(rootDirectory, { force: true, recursive: true });
  }
}, 15_000);

it("rejects changed payload or pricing on replay without changing the original settlement", async () => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), "evaluation-transport-")
  );
  const transport = await createAccountedEvaluationTransport({
    rootDirectory,
    runId: "replay-test",
  });
  try {
    const original = request("replay-1");
    const first = Effect.runPromiseExit(transport.invoke(original));
    await respond(rootDirectory, "replay-1", measuredBody);
    const completed = await first;
    expect(completed._tag).toBe("Success");
    const changed = await Effect.runPromiseExit(
      transport.invoke({
        ...original,
        body: { changed: true },
        outputMicroUsdPerToken: 3,
      })
    );
    expect(changed._tag).toBe("Failure");
    const ledger = await Effect.runPromise(transport.readLedger());
    expect(ledger.dispatches).toMatchObject([
      { actual_cost_micro_usd: 9, state: "settled_known" },
    ]);
  } finally {
    await transport.close();
    await rm(rootDirectory, { force: true, recursive: true });
  }
});

it("close drains unknown settlement before disposing D1 and permits safe inspection after reopening", async () => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), "evaluation-transport-")
  );
  const options = { rootDirectory, runId: "close-test" };
  const transport = await createAccountedEvaluationTransport(options);
  const pending = Effect.runPromiseExit(transport.invoke(request("close-1")));
  await readPending(rootDirectory, "close-1");
  await transport.close();
  const interrupted = await pending;
  expect(interrupted._tag).toBe("Failure");
  const reopened = await createAccountedEvaluationTransport(options);
  try {
    const ledger = await Effect.runPromise(reopened.readLedger());
    expect(ledger.dispatches).toMatchObject([{ state: "settled_unknown" }]);
    expect(ledger.budget).toMatchObject([{ state: "poisoned" }]);
  } finally {
    await reopened.close();
    await rm(rootDirectory, { force: true, recursive: true });
  }
});

it.each(["node", "pnpm-tsx", "parent-killed"] as const)(
  "the %s CLI preserves unknown settlement and closes its lock after interruption",
  async (launcher) => {
    const rootDirectory = await mkdtemp(
      path.join(tmpdir(), "evaluation-transport-signal-")
    );
    const dispatchId = "cli-interrupted";
    const requestFile = path.join(rootDirectory, "input.json");
    await writeFile(requestFile, JSON.stringify(request(dispatchId)));
    const args = [
      "evals/recipe-extraction/accounted-transport.ts",
      "bridge",
      rootDirectory,
      "signal-test",
      requestFile,
    ];
    const child =
      launcher === "pnpm-tsx"
        ? spawn("pnpm", ["exec", "tsx", ...args], {
            stdio: ["ignore", "pipe", "pipe"],
          })
        : spawn(process.execPath, ["--import", "tsx", ...args], {
            stdio: ["ignore", "pipe", "pipe"],
          });
    child.stdout.resume();
    child.stderr.resume();
    const closed = once(child, "close");
    const resultFile = evaluationBridgePaths(rootDirectory, dispatchId)
      .request.replace(`${path.sep}bridge${path.sep}`, path.sep)
      .replace(".request.json", ".result.json");
    try {
      await readPending(rootDirectory, dispatchId);
      child.kill(launcher === "parent-killed" ? "SIGKILL" : "SIGINT");
      const [exitCode, signal] = await closed;
      if (launcher === "parent-killed") {
        expect(signal).toBe("SIGKILL");
      } else {
        expect(exitCode).toBe(1);
      }
      await expect
        .poll(async () => JSON.parse(await readFile(resultFile, "utf-8")), {
          timeout: 10_000,
        })
        .toMatchObject({
          ledger: {
            budget: [
              {
                reserved_micro_usd: 100_000,
                settled_micro_usd: 0,
                state: "poisoned",
              },
            ],
            dispatches: [
              {
                actual_cost_micro_usd: null,
                dispatch_id: dispatchId,
                invocation_generation: 1,
                state: "settled_unknown",
              },
            ],
          },
          status: "stopped_unknown",
        });
      await expect
        .poll(
          () =>
            readFile(path.join(rootDirectory, "transport.lock")).catch(
              (error: NodeJS.ErrnoException) => error.code
            ),
          { timeout: 10_000 }
        )
        .toBe("ENOENT");
      const transport = await createAccountedEvaluationTransport({
        rootDirectory,
        runId: "signal-test",
      });
      try {
        const retry = await Effect.runPromiseExit(
          transport.invoke(request("forbidden-next-dispatch"))
        );
        expect(retry._tag).toBe("Failure");
        const ledger = await Effect.runPromise(transport.readLedger());
        expect(ledger.dispatches).toHaveLength(1);
        await expect(
          readFile(
            evaluationBridgePaths(rootDirectory, "forbidden-next-dispatch")
              .request
          )
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await transport.close();
      }
    } finally {
      child.kill("SIGTERM");
      await closed;
      await rm(rootDirectory, { force: true, recursive: true });
    }
  },
  30_000
);
