import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bundleWorkerFixture } from "../../test/native-worker.test-fixture.js";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const fixturePath = fileURLToPath(
  new URL("import-acquisition-restart.test-fixture.ts", import.meta.url)
);
const householdDomainFixturePath = fileURLToPath(
  new URL(
    "../households/household-domain-service.test-fixture.js",
    import.meta.url
  )
);
let runtime: Miniflare;
let temporaryDirectory: string;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-acquisition-restart-`
  );
  const [fixtureModules, householdModules] = await Promise.all([
    bundleWorkerFixture(fixturePath, `${temporaryDirectory}/workflow`),
    bundleWorkerFixture(
      householdDomainFixturePath,
      `${temporaryDirectory}/household`
    ),
  ]);
  runtime = new Miniflare({
    compatibilityDate,
    compatibilityFlags,
    workers: [
      {
        compatibilityDate,
        compatibilityFlags,
        kvNamespaces: ["ACQUISITION_RESTART_STATE"],
        modules: [...fixtureModules],
        name: "acquisition-restart",
        r2Buckets: ["ImportEvidenceBucket"],
        serviceBindings: { HouseholdDomainWorker: "household-domain" },
        workflows: {
          AcquisitionRestartWorkflow: {
            className: "AcquisitionRestartWorkflow",
            name: "acquisition-restart-workflow",
          },
        },
      },
      {
        compatibilityDate,
        compatibilityFlags,
        durableObjects: {
          HouseholdObject: { className: "HouseholdObject", useSQLite: true },
        },
        modules: [...householdModules],
        name: "household-domain",
      },
    ],
  });
}, 30_000);

afterAll(async () => {
  await runtime.dispose();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("native acquisition restart recovery", () => {
  it("recovers create-only R2 evidence after repeated pre-checkpoint restarts", async () => {
    const response = await runtime.dispatchFetch("http://localhost/", {
      body: JSON.stringify({
        commandId: "018f47ad91aa7c35b6fe000000000192",
        organizationId: "organization-acquisition-restart",
        videoId: "7520000000000000192",
      }),
      method: "POST",
    });
    const body = await response.text();
    expect(response.status, body).toBe(200);
    const result = JSON.parse(body) as {
      readonly attempts: readonly {
        readonly acquisitionAttemptGeneration: number;
        readonly attemptIdentity: string;
        readonly attemptOrdinal: number;
      }[];
      readonly objects: readonly string[];
      readonly outcome: { readonly _tag: string; readonly generation: number };
      readonly references: null | { readonly references: readonly object[] };
      readonly status: {
        readonly output?: {
          readonly outcome: string;
          readonly replayOutcome: string;
        };
        readonly status: string;
      };
    };
    expect(result.status).toMatchObject({ status: "complete" });
    expect(result.status.output).toEqual({
      outcome: "Recorded",
      replayOutcome: "Recorded",
    });
    expect(result.outcome).toMatchObject({
      _tag: "VerifiedAcquisition",
      generation: 1,
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      acquisitionAttemptGeneration: 1,
      attemptOrdinal: 1,
    });
    expect(result.attempts[0]?.attemptIdentity).toMatch(/^[a-f\d]{64}$/u);
    expect(result.references?.references).toHaveLength(2);
    expect(result.objects).toHaveLength(2);
    expect(result.objects.every((key) => key.includes("/generations/1/"))).toBe(
      true
    );
  }, 90_000);
});
