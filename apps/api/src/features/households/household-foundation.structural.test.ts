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

const readHouseholdAuthoritySources = async () => [
  ...(await readProductionHouseholdSources()),
  {
    path: "../meal-planning/meal-plan.ts",
    source: await read(
      path.join(apiFeaturesRoot, "meal-planning/meal-plan.ts")
    ),
  },
];

describe("household foundation structural boundaries", () => {
  it("confines ambient authority generation to the Effect live adapter", async () => {
    const sources = await readHouseholdAuthoritySources();
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

  it("assigns mutation audit authority only after object admission", async () => {
    const [contract, http, objectRuntime, admission] = await Promise.all([
      read(path.join(householdRoot, "household-meal-plan.contract.ts")),
      read(path.join(householdRoot, "household.http.ts")),
      read(path.join(householdRoot, "household-object-runtime.ts")),
      read(path.join(householdRoot, "household-meal-plan-admission.ts")),
    ]);
    expect(http).not.toContain("Clock.currentTimeMillis");
    expect(contract).not.toMatch(/actorId|decidedAt|swappedAt/u);
    expect(objectRuntime).toContain("ensureHouseholdProvenance(");
    expect(objectRuntime).toContain("admitMealPlanDecision(");
    expect(objectRuntime).toContain("admitManualMealSwap(");
    expect(admission).toContain("Clock.currentTimeMillis");
    expect(admission).toContain("actorId: admission.actor.actorId");
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
    const sources = await readHouseholdAuthoritySources();
    const transactionOwners = sources.filter(({ source }) =>
      source.includes(".transaction(")
    );
    expect(
      transactionOwners.map(({ path: sourcePath }) => sourcePath).toSorted()
    ).toEqual(
      [
        "evidence/household-evidence.repository.ts",
        "foundation/import-workflow-admission.repository.ts",
        "household-meal-plan.repository.ts",
        "recipe-import/household-recipe-import.repository.ts",
      ].toSorted()
    );
    for (const { path: sourcePath, source } of transactionOwners) {
      expect(source, `${sourcePath} performs external I/O`).not.toMatch(
        /\bfetch\s*\(|\.getByName\(|\.send\s*\(|\.put\s*\(|cloudflare:workers|alchemy\/Cloudflare/u
      );
    }

    const repository =
      transactionOwners.find(
        ({ path: sourcePath }) =>
          sourcePath === "foundation/import-workflow-admission.repository.ts"
      )?.source ?? "";
    expect(repository).toContain("database.transaction(");
    expect(repository).toContain(".update(householdOutbox)");

    const recipeImportRepository =
      transactionOwners.find(
        ({ path: sourcePath }) =>
          sourcePath === "recipe-import/household-recipe-import.repository.ts"
      )?.source ?? "";
    expect(recipeImportRepository).toContain("confirmRecipeImportAction");
    expect(recipeImportRepository).toContain(
      ".insert(householdImportWorkflowAdmissions)"
    );
    expect(recipeImportRepository).toContain(".insert(householdRecipes)");
    expect(recipeImportRepository).toContain(".insert(householdOutbox)");
  });

  it("keeps acquisition R2 work outside the household commit and removes its D1 write seam", async () => {
    const [evidenceRepository, executionRepository, workflow] =
      await Promise.all([
        read(
          path.join(householdRoot, "evidence/household-evidence.repository.ts")
        ),
        read(
          path.join(
            apiFeaturesRoot,
            "imports/import-execution.repository.d1.ts"
          )
        ),
        read(path.join(apiFeaturesRoot, "imports/import.workflow.ts")),
      ]);
    expect(evidenceRepository).toMatch(/database\s*\.\s*transaction\s*\(/u);
    expect(evidenceRepository).not.toMatch(
      /cloudflare:workers|alchemy\/Cloudflare|ImportEvidenceBucket|\.getByName\(|\bfetch\s*\(|\.head\s*\(|\.put\s*\(|\.send\s*\(/u
    );

    const recordStep = workflow
      .split('"record-acquisition-v2"')[1]
      ?.split("AcquisitionTaskStepConfig")[0];
    expect(recordStep).toBeDefined();
    expect(recordStep).toContain("commitAcquisitionEvidence(");
    expect(recordStep).not.toContain("recordAcquired(");
    expect(recordStep).not.toMatch(
      /makeD1(?:CarouselEvidence|RecipeDraft|SpeechTranscription|VisualEvidence)Repository/u
    );
    expect(executionRepository).not.toContain("recordAcquired:");
    expect(executionRepository).not.toMatch(
      /\.(?:delete|insert|update)\(\s*import(?:CarouselEvidence|RecipeExtractions|Transcriptions|VisualEvidence)/u
    );

    const recoveryReadStep = workflow
      .split("readHouseholdAcquisitionEvidence")[1]
      ?.split("runAcquisitionTask(")[0];
    expect(recoveryReadStep).toBeDefined();
    expect(recoveryReadStep).toContain("inspectHouseholdEvidenceReferences(");
    expect(recoveryReadStep).toContain("observeEvidenceReference(");
    expect(
      recoveryReadStep?.indexOf("inspectHouseholdEvidenceReferences(")
    ).toBeLessThan(
      recoveryReadStep?.indexOf("observeEvidenceReference(") ?? -1
    );
  });

  it("wires R2 lifecycle notifications to household evidence observation", async () => {
    const [consumer, reconciler] = await Promise.all([
      read(
        path.join(
          apiFeaturesRoot,
          "../infrastructure/import-evidence-event-queue.ts"
        )
      ),
      read(path.join(apiFeaturesRoot, "imports/import-evidence-event.ts")),
    ]);
    expect(consumer).toContain("reconcileImportEvidenceQueueMessage(");
    expect(consumer).toContain("householdDomain.observeEvidenceReference(");
    expect(consumer).toContain("householdDomain.readEvidenceReferences(");
    expect(consumer).toContain("ImportEvidenceEventRoutes");
    expect(reconciler).toContain("ports.bucket.head(event.objectKey)");
    expect(reconciler).toContain("ports.household.observeEvidenceReference({");
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
