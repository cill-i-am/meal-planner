import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";

import { workerObservability } from "../../infrastructure/worker-observability.js";
import { bundleWorkerFixture } from "../../test/native-worker.test-fixture.js";

let runtime: Miniflare;
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(`${tmpdir()}/meal-planner-terminal-checkpoint-`);
  const manifest = await bundleWorkerFixture(
    fileURLToPath(
      new URL(
        "import-provider-terminal-authority.test-fixture.ts",
        import.meta.url
      )
    ),
    directory
  );
  runtime = new Miniflare({
    cf: false,
    workers: [
      {
        config: {
          compatibilityDate: workerObservability.compatibility.date,
          compatibilityFlags: workerObservability.compatibility.flags,
          env: {
            RESULTS: { id: "terminal-results", type: "kv" },
            TerminalWorkflow: {
              exportName: "TerminalWorkflow",
              name: "terminal-workflow",
              type: "workflow",
              worker: "terminal-checkpoint",
            },
          },
          manifest,
          name: "terminal-checkpoint",
        },
      },
    ],
  });
}, 30_000);
afterAll(async () => {
  await runtime?.dispose();
  await rm(directory, { force: true, recursive: true });
});

it("persists and replays terminal ownership through native Workflow serialization", async () => {
  const start = await runtime.dispatchFetch("http://localhost/start");
  expect(start.status).toBe(200);
  const read = async () => {
    const response = await runtime.dispatchFetch("http://localhost/status");
    return Schema.decodeUnknownSync(
      Schema.Struct({
        completions: Schema.Number,
        reads: Schema.Number,
        workflow: Schema.Struct({
          error: Schema.optionalKey(Schema.Unknown),
          output: Schema.optionalKey(Schema.Unknown),
          status: Schema.String,
        }),
      })
    )(await response.json());
  };
  const expected = {
    completions: 1,
    reads: 1,
    workflow: { output: { owner: "a".repeat(64) }, status: "complete" },
  };
  await expect
    .poll(
      async () => {
        const result = await read();
        return ["complete", "errored"].includes(result.workflow.status);
      },
      { timeout: 10_000 }
    )
    .toBe(true);
  const initial = await read();
  expect(initial, JSON.stringify(initial)).toMatchObject(expected);
  const replay = await runtime.dispatchFetch("http://localhost/replay");
  expect(replay.status).toBe(200);
  await expect
    .poll(read, { timeout: 10_000 })
    .toMatchObject({ ...expected, completions: 2 });
}, 30_000);
