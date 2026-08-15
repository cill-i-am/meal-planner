import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import * as Bundle from "alchemy/Bundle";
import { Effect, Schema } from "effect";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ImportCorrelationId } from "./import-observability.js";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const fixturePath = fileURLToPath(
  new URL("import-workflow-input.test-fixture.ts", import.meta.url)
);
const temporaryDirectories: string[] = [];
let runtime: Miniflare;

const buildFixture = async (outputDirectory: string) => {
  const output = await Effect.runPromise(
    Bundle.build(
      {
        checks: {
          ineffectiveDynamicImport: false,
          unresolvedImport: false,
        },
        external: ["cloudflare:workers"],
        input: fixturePath,
        plugins: [
          cloudflareRolldown({
            compatibilityDate,
            compatibilityFlags,
          }),
        ],
      },
      {
        codeSplitting: false,
        dir: outputDirectory,
        format: "esm",
        minify: true,
        sourcemap: false,
      }
    )
  );
  const {
    files: [{ content }],
  } = output;
  return typeof content === "string"
    ? content
    : new TextDecoder().decode(content);
};

beforeAll(async () => {
  const temporaryDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-gaia-191-native-`
  );
  temporaryDirectories.push(temporaryDirectory);
  const fixtureScript = await buildFixture(temporaryDirectory);
  runtime = new Miniflare({
    compatibilityDate,
    compatibilityFlags,
    kvNamespaces: ["LEGACY_WORKFLOW_STATE"],
    modules: [
      {
        contents: fixtureScript,
        path: "legacy-input-workflow-fixture.js",
        type: "ESModule",
      },
    ],
    workflows: {
      LegacyInputWorkflow: {
        className: "LegacyInputWorkflow",
        name: "legacy-input-workflow",
      },
    },
  });
}, 30_000);

afterAll(async () => {
  await runtime.dispose();
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

const commandWorkflow = async (
  command:
    | {
        readonly action: "read";
        readonly id: string;
      }
    | {
        readonly action: "restart";
        readonly id: string;
      }
    | {
        readonly action: "run";
        readonly expectedStatus: "complete" | "errored";
        readonly id: string;
        readonly input: unknown;
      }
) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify(command),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return response.json();
};

describe("native workflow legacy correlation input", () => {
  it("persists one opaque correlation before the requested boundary and reuses it on restart", async () => {
    const id = "gaia-191-native-legacy-input";
    const importId = "00000000-0000-4000-8000-000000000188";
    const expectedCorrelationId = "b44d09c6-67ca-527c-a2c7-86628ffc08a6";

    await expect(
      commandWorkflow({
        action: "run",
        expectedStatus: "complete",
        id,
        input: { importId },
      })
    ).resolves.toMatchObject({
      output: { importId },
      status: "complete",
    });
    await expect(
      commandWorkflow({ action: "restart", id })
    ).resolves.toMatchObject({
      output: { importId },
      status: "complete",
    });

    const evidence = (await commandWorkflow({
      action: "read",
      id,
    })) as {
      readonly correlations: readonly [string, string];
      readonly events: readonly [string, string];
      readonly workflowRuns: number;
    };
    expect(evidence.workflowRuns).toBe(2);
    expect(Schema.is(ImportCorrelationId)(expectedCorrelationId)).toBe(true);
    expect(evidence.correlations).toEqual([
      expectedCorrelationId,
      expectedCorrelationId,
    ]);
    expect(
      evidence.events.map((event) => JSON.parse(event) as unknown)
    ).toEqual([
      {
        correlationId: evidence.correlations[0],
        event: "workflow.started",
        outcome: "started",
      },
      {
        correlationId: evidence.correlations[0],
        event: "workflow.started",
        outcome: "started",
      },
    ]);
    expect(JSON.stringify(evidence)).not.toMatch(
      /https?:|prompt|transcript|cookie|authorization|credential|media|payload/iu
    );
  });

  it("preserves a supplied current correlation ID", async () => {
    const id = "gaia-191-native-current-input";
    const importId = "00000000-0000-4000-8000-000000000189";
    const correlationId = "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2188";

    await expect(
      commandWorkflow({
        action: "run",
        expectedStatus: "complete",
        id,
        input: { correlationId, importId },
      })
    ).resolves.toMatchObject({
      output: { correlationId, importId },
      status: "complete",
    });
  });
});
