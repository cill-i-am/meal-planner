import { readFile, readdir } from "node:fs/promises";
// eslint-disable-next-line unicorn/import-style -- This package does not enable synthetic default imports for Node built-ins.
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const householdRoot = import.meta.dirname;
const apiFeaturesRoot = path.dirname(householdRoot);

const read = (filePath: string) => readFile(filePath, "utf-8");

const readProductionHouseholdSources = async () => {
  const paths = await readdir(householdRoot, { recursive: true });
  return Promise.all(
    paths
      .filter(
        (relativePath) =>
          relativePath.endsWith(".ts") &&
          !relativePath.endsWith(".test.ts") &&
          !relativePath.endsWith(".test-fixture.ts") &&
          relativePath !== "shared-kernel/authority-services.live.ts"
      )
      .map(async (relativePath) => ({
        path: relativePath,
        source: await read(path.join(householdRoot, relativePath)),
      }))
  );
};

describe("household foundation structural boundaries", () => {
  it("confines ambient authority generation to the Effect live adapter", async () => {
    const sources = await readProductionHouseholdSources();
    const forbidden = [
      "Date.now(",
      "crypto.randomUUID(",
      "crypto.subtle.digest(",
      "createHash(",
    ];

    for (const { path: sourcePath, source } of sources) {
      for (const token of forbidden) {
        expect(source, `${sourcePath} contains ${token}`).not.toContain(token);
      }
    }

    const live = await read(
      path.join(householdRoot, "shared-kernel/authority-services.live.ts")
    );
    expect(live).toContain("crypto.randomUUID()");
    expect(live).toContain("crypto.subtle.digest(");
  });

  it("keeps Better Auth proof at the API boundary", async () => {
    const [privateWorker, objectRuntime] = await Promise.all([
      read(path.join(householdRoot, "household-domain-worker.ts")),
      read(path.join(householdRoot, "household-object-runtime.ts")),
    ]);
    for (const source of [privateWorker, objectRuntime]) {
      expect(source).not.toMatch(/better-auth|makeMealPlannerAuth|auth\.api/u);
      expect(source).toContain("Schema.decodeUnknownEffect");
    }
  });

  it("routes household objects only through the versioned locator", async () => {
    const sources = await readProductionHouseholdSources();
    const routeSites = sources.filter(({ source }) =>
      source.includes(".getByName(")
    );
    expect(routeSites.map(({ path: sourcePath }) => sourcePath)).toEqual([
      "household-domain-worker.ts",
    ]);
    expect(routeSites[0]?.source).toContain("HouseholdObjectLocator");

    const locator = await read(
      path.join(householdRoot, "household-object-locator.ts")
    );
    expect(locator).toContain("household:v1:");
    expect(locator).toContain("HouseholdDigest");
    expect(locator).not.toMatch(/household:v1:\$\{organizationId\}/u);
  });

  it("keeps external I/O outside the atomic admission/outbox repository", async () => {
    const repository = await read(
      path.join(
        householdRoot,
        "foundation/import-workflow-admission.repository.ts"
      )
    );
    expect(repository).toContain("database.transaction(");
    expect(repository).toContain(".insert(householdImportWorkflowAdmissions)");
    expect(repository).toContain(".insert(householdOutbox)");
    expect(repository).not.toMatch(
      /\bfetch\s*\(|\.getByName\(|\.send\s*\(|\.put\s*\(|cloudflare:workers|alchemy\/Cloudflare/u
    );

    const operation = await read(
      path.join(householdRoot, "foundation/admit-import-workflow.ts")
    );
    expect(operation.indexOf("repository.persist(")).toBeLessThan(
      operation.indexOf("alarm\n      .schedule(")
    );
  });

  it("keeps the Alchemy host thin and SQLite evolution migration-owned", async () => {
    const host = await read(path.join(householdRoot, "household-object.ts"));
    expect(host.split("\n").length).toBeLessThanOrEqual(14);
    expect(host).toContain("Stable Alchemy class host");
    expect(host).toContain("SQLite evolution belongs to Drizzle migrations");
    expect(host).not.toContain("Drizzle.DurableObject");

    const runtime = await read(
      path.join(householdRoot, "household-object-runtime.ts")
    );
    expect(runtime).toContain("Drizzle.DurableObject({ migrations })");
  });

  it("fences the noncanonical acquisition coordinator by import generation", async () => {
    const [containerRuntime, coordinator, model, workflow] = await Promise.all([
      read(
        path.join(apiFeaturesRoot, "imports/import-media-container.runtime.ts")
      ),
      read(
        path.join(apiFeaturesRoot, "imports/import-media-acquisition-object.ts")
      ),
      read(path.join(apiFeaturesRoot, "imports/import-media.model.ts")),
      read(path.join(apiFeaturesRoot, "imports/import.workflow.ts")),
    ]);
    expect(coordinator).toContain(
      "Noncanonical execution/transport coordinator only"
    );
    expect(coordinator).toContain("decodeAcquisitionArtifact");
    expect(coordinator).toContain("durableObjectState.id.name");
    expect(coordinator).toContain("requireMatchingCoordinator");
    expect(model).toContain(":acquisition-generation:");
    expect(workflow).toContain("mediaObjects.getByName(");
    expect(workflow).toContain("acquisitionCoordinatorId(");
    expect(containerRuntime).toContain("acquisitionArtifactId(");
  });
});
