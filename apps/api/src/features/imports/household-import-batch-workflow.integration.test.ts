import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import * as Bundle from "alchemy/Bundle";
import { Effect, Schema } from "effect";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
let persistenceDirectory = "";
let runtime: Miniflare;

describe("household batch native Workflow", () => {
  beforeAll(async () => {
    persistenceDirectory = await mkdtemp(
      `${tmpdir()}/meal-planner-household-batch-workflow-`
    );
    const output = await Effect.runPromise(
      Bundle.build(
        {
          checks: { ineffectiveDynamicImport: false, unresolvedImport: false },
          external: ["cloudflare:workers"],
          input: fileURLToPath(
            new URL(
              "household-import-batch-workflow.test-fixture.ts",
              import.meta.url
            )
          ),
          plugins: [
            cloudflareRolldown({ compatibilityDate, compatibilityFlags }),
          ],
        },
        {
          codeSplitting: false,
          format: "esm",
          minify: true,
          sourcemap: false,
        }
      )
    );
    const {
      files: [{ content }],
    } = output;
    runtime = new Miniflare({
      compatibilityDate,
      compatibilityFlags,
      kvNamespaces: ["BATCH_WORKFLOW_STATE"],
      kvPersist: persistenceDirectory,
      modules: [
        {
          contents: Schema.is(Schema.String)(content)
            ? content
            : new TextDecoder().decode(content),
          path: "household-batch-workflow-fixture.js",
          type: "ESModule",
        },
      ],
      workflows: {
        HouseholdBatchTestWorkflow: {
          className: "HouseholdBatchTestWorkflow",
          name: "household-batch-test-workflow",
        },
      },
    });
  }, 30_000);

  afterAll(async () => {
    await runtime.dispose();
    await rm(persistenceDirectory, { force: true, recursive: true });
  });

  it("coordinates claim, admission, and canonical failure as durable steps", async () => {
    const response = await runtime.dispatchFetch("http://localhost/", {
      body: JSON.stringify({
        id: "household-batch-rejected-item",
        input: {
          batchId: "018f47ad-91aa-7c35-b6fe-000000000211",
          generation: 1,
          itemId: "018f47ad-91aa-7c35-b6fe-000000000212",
          organizationId: "organization-batch-workflow-proof",
        },
      }),
      method: "POST",
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      counts: { admit: 1, claim: 1, complete: 0, dispatch: 0, fail: 1 },
      error: null,
      status: { status: "complete" },
    });
  }, 15_000);

  it("coordinates successful admission, dispatch, and completion as durable steps", async () => {
    const response = await runtime.dispatchFetch("http://localhost/", {
      body: JSON.stringify({
        id: "household-batch-completed-item",
        input: {
          batchId: "018f47ad-91aa-7c35-b6fe-000000000213",
          generation: 2,
          itemId: "018f47ad-91aa-7c35-b6fe-000000000214",
          organizationId: "organization-batch-workflow-success-proof",
        },
      }),
      method: "POST",
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      counts: { admit: 1, claim: 1, complete: 1, dispatch: 1, fail: 0 },
      error: null,
      status: { status: "complete" },
    });
  }, 15_000);
});
