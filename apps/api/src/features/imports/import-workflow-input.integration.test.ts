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
  return Schema.is(Schema.String)(content)
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
    kvNamespaces: ["CURRENT_WORKFLOW_STATE"],
    modules: [
      {
        contents: fixtureScript,
        path: "current-input-workflow-fixture.js",
        type: "ESModule",
      },
    ],
    workflows: {
      CurrentInputWorkflow: {
        className: "CurrentInputWorkflow",
        name: "current-input-workflow",
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

describe("native current workflow input", () => {
  it("persists the supplied opaque correlation at the provider boundary and reuses it on restart", async () => {
    const id = "current-input-restart";
    const importId = "00000000-0000-4000-8000-000000000188";
    const correlationId = "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2188";
    const input = {
      executionGeneration: 1,
      importId,
      trace: { correlationId },
    };

    await expect(
      commandWorkflow({
        action: "run",
        expectedStatus: "complete",
        id,
        input,
      })
    ).resolves.toMatchObject({
      output: input,
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
      readonly providerBoundaryRuns: number;
      readonly workflowRuns: number;
    };
    expect(evidence.workflowRuns).toBe(2);
    expect(evidence.providerBoundaryRuns).toBe(2);
    expect(Schema.is(ImportCorrelationId)(correlationId)).toBe(true);
    expect(evidence.correlations).toEqual([correlationId, correlationId]);
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

  it("rejects missing execution generation before the provider boundary", async () => {
    const id = "current-input-missing-generation";
    const importId = "00000000-0000-4000-8000-000000000189";
    const correlationId = "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2188";

    await expect(
      commandWorkflow({
        action: "run",
        expectedStatus: "errored",
        id,
        input: { importId, trace: { correlationId } },
      })
    ).resolves.toMatchObject({
      status: "errored",
    });
    await expect(
      commandWorkflow({ action: "read", id })
    ).resolves.toMatchObject({
      correlations: [null, null],
      events: [null, null],
      providerBoundaryRuns: 0,
      workflowRuns: 1,
    });
  });

  it("rejects missing trace before the provider boundary", async () => {
    const id = "current-input-missing-trace";
    const importId = "00000000-0000-4000-8000-000000000190";

    await expect(
      commandWorkflow({
        action: "run",
        expectedStatus: "errored",
        id,
        input: { executionGeneration: 1, importId },
      })
    ).resolves.toMatchObject({
      status: "errored",
    });
    await expect(
      commandWorkflow({ action: "read", id })
    ).resolves.toMatchObject({
      correlations: [null, null],
      events: [null, null],
      providerBoundaryRuns: 0,
      workflowRuns: 1,
    });
  });
});
