import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const householdRoot = dirname(fileURLToPath(import.meta.url));
const apiFeaturesRoot = dirname(householdRoot);

const read = (path: string) => readFile(path, "utf8");

const readProductionHouseholdSources = async () => {
  const paths = await readdir(householdRoot, { recursive: true });
  return Promise.all(
    paths
      .filter(
        (path) =>
          path.endsWith(".ts") &&
          !path.endsWith(".test.ts") &&
          !path.endsWith(".test-fixture.ts") &&
          path !== "shared-kernel/authority-services.live.ts"
      )
      .map(async (path) => ({
        path,
        source: await read(join(householdRoot, path)),
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

    for (const { path, source } of sources) {
      for (const token of forbidden) {
        expect(source, `${path} contains ${token}`).not.toContain(token);
      }
    }

    const live = await read(
      join(householdRoot, "shared-kernel/authority-services.live.ts")
    );
    expect(live).toContain("crypto.randomUUID()");
    expect(live).toContain("crypto.subtle.digest(");
  });

  it("keeps Better Auth proof at the API boundary", async () => {
    const [privateWorker, objectRuntime] = await Promise.all([
      read(join(householdRoot, "household-domain-worker.ts")),
      read(join(householdRoot, "household-object-runtime.ts")),
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
    expect(routeSites.map(({ path }) => path)).toEqual([
      "household-domain-worker.ts",
    ]);
    expect(routeSites[0]?.source).toContain("HouseholdObjectLocator");

    const locator = await read(
      join(householdRoot, "household-object-locator.ts")
    );
    expect(locator).toContain("household:v1:");
    expect(locator).toContain("HouseholdDigest");
    expect(locator).not.toContain("`household:v1:${organizationId}`");
  });

  it("keeps external I/O outside the atomic admission/outbox repository", async () => {
    const repository = await read(
      join(householdRoot, "foundation/import-workflow-admission.repository.ts")
    );
    expect(repository).toContain("database.transaction(");
    expect(repository).toContain(".insert(householdImportWorkflowAdmissions)");
    expect(repository).toContain(".insert(householdOutbox)");
    expect(repository).not.toMatch(
      /\bfetch\s*\(|\.getByName\(|\.send\s*\(|\.put\s*\(|cloudflare:workers|alchemy\/Cloudflare/u
    );

    const operation = await read(
      join(householdRoot, "foundation/admit-import-workflow.ts")
    );
    expect(operation.indexOf("repository.persist(")).toBeLessThan(
      operation.indexOf("alarm\n      .schedule(")
    );
  });

  it("keeps the Alchemy host thin and SQLite evolution migration-owned", async () => {
    const host = await read(join(householdRoot, "household-object.ts"));
    expect(host.split("\n").length).toBeLessThanOrEqual(14);
    expect(host).toContain("Stable Alchemy class host");
    expect(host).toContain("SQLite evolution belongs to Drizzle migrations");
    expect(host).not.toContain("Drizzle.DurableObject");

    const runtime = await read(
      join(householdRoot, "household-object-runtime.ts")
    );
    expect(runtime).toContain("Drizzle.DurableObject({ migrations })");
  });

  it("fences the noncanonical acquisition coordinator by import generation", async () => {
    const [containerRuntime, coordinator, model, workflow] = await Promise.all([
      read(join(apiFeaturesRoot, "imports/import-media-container.runtime.ts")),
      read(join(apiFeaturesRoot, "imports/import-media-acquisition-object.ts")),
      read(join(apiFeaturesRoot, "imports/import-media.model.ts")),
      read(join(apiFeaturesRoot, "imports/import.workflow.ts")),
    ]);
    expect(coordinator).toContain(
      "Noncanonical execution/transport coordinator only"
    );
    expect(coordinator).toContain("decodeAcquisitionArtifact");
    expect(model).toContain(":acquisition-generation:");
    expect(workflow).toContain("mediaObjects.getByName(importId)");
    expect(containerRuntime).toContain("acquisitionArtifactId(");
  });
});
