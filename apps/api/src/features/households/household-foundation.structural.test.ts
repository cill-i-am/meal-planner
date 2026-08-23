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

const readProductionFeatureSources = async () => {
  const paths = await readdir(apiFeaturesRoot, { recursive: true });
  return Promise.all(
    paths
      .filter(
        (relativePath) =>
          relativePath.endsWith(".ts") &&
          !relativePath.endsWith(".test.ts") &&
          !relativePath.endsWith(".test-fixture.ts")
      )
      .map(async (relativePath) => ({
        path: relativePath,
        source: await read(path.join(apiFeaturesRoot, relativePath)),
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
      "household-command-router.ts",
    ]);
    const worker = await read(
      path.join(householdRoot, "household-domain-worker.ts")
    );
    expect(worker).toContain("HouseholdObjectLocator");
    expect(worker).toContain(".locate(organizationId)");

    const locator = await read(
      path.join(householdRoot, "household-object-locator.ts")
    );
    expect(locator).toContain("household:v1:");
    expect(locator).toContain("HouseholdDigest");
    expect(locator).not.toMatch(/household:v1:\$\{organizationId\}/u);
  });

  it("authorizes private Worker commands before household routing", async () => {
    const [worker, router] = await Promise.all([
      read(path.join(householdRoot, "household-domain-worker.ts")),
      read(path.join(householdRoot, "household-command-router.ts")),
    ]);
    const routingSites = [
      ...worker.matchAll(/routeAdmittedHouseholdCommand\(\{/gu),
    ];
    const admission = router.indexOf("requireHouseholdCommandAdmission(");
    const locate = router.indexOf("input.locate(");
    const getByName = router.indexOf("input.getByName(");

    expect(routingSites).toHaveLength(5);
    expect(admission).toBeGreaterThan(-1);
    expect(locate).toBeGreaterThan(admission);
    expect(getByName).toBeGreaterThan(locate);
  });

  it("authorizes specialized private Worker commands before re-encoding", async () => {
    const worker = await read(
      path.join(householdRoot, "household-domain-worker.ts")
    );
    const specializedRouters = [
      ["routeAcquisitionEvidence", "routeEvidenceObservation"],
      ["routeEvidenceObservation", "routeEvidenceStage"],
      ["routeEvidenceStage", "routeRecipeRecovery"],
      ["routeRecipeRecovery", "return {"],
    ] as const;

    for (const [start, end] of specializedRouters) {
      const routeSource = worker
        .split(`const ${start}`)[1]
        ?.split(`const ${end}`)[0];
      expect(routeSource, `${start} is present`).toBeDefined();
      const admission = routeSource?.indexOf(
        "requireHouseholdCommandAdmission("
      );
      const encoding = routeSource?.indexOf("Schema.encodeEffect(");
      expect(admission, `${start} admits before encoding`).toBeGreaterThan(-1);
      expect(encoding, `${start} has a closed encoder`).toBeGreaterThan(
        admission ?? Number.MAX_SAFE_INTEGER
      );
    }
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

  it("persists ambiguous provider terminal authority after provider I/O", async () => {
    const [authority, workflow] = await Promise.all([
      read(
        path.join(
          apiFeaturesRoot,
          "imports/import-provider-terminal-authority.ts"
        )
      ),
      read(path.join(apiFeaturesRoot, "imports/import.workflow.ts")),
    ]);
    const terminalTask = workflow
      .split("const persistTerminal")[1]
      ?.split("const completeVisualAndRecipe")[0];

    expect(terminalTask).toBeDefined();
    expect(terminalTask).toContain(
      "persistHouseholdProviderTerminalAuthority({"
    );
    expect(authority).toContain("input.failAmbiguous({");
    expect(authority).toContain('failureCode: "outcome_unknown"');
    expect(authority).toContain("dispatchId: stage.dispatchId");
    expect(authority).toContain("sourceMediaSha256: stage.inputFingerprint");
    expect(authority.indexOf("input.failAmbiguous({")).toBeLessThan(
      authority.indexOf("readImportTerminalCheckpoint({")
    );
  });

  it("reuses household-owned provider dispatch time across native retries", async () => {
    const repository = await read(
      path.join(
        apiFeaturesRoot,
        "imports/import-evidence.repository.household.ts"
      )
    );

    expect(repository).toContain(
      `\`speech:claim:\${claim.dispatchId}:\${claim.sourceMediaSha256}\``
    );
    expect(repository).toContain(
      `\`speech:fail:\${failure.dispatchId}:\${failure.sourceMediaSha256}:\${failure.failureCode}\``
    );
    expect(repository).toContain(
      `\`visual:claim:\${claim.dispatchId}:\${claim.sourceMediaSha256}\``
    );
    expect(repository).toContain(
      `\`visual:fail:\${failure.dispatchId}:\${failure.sourceMediaSha256}:\${failure.failureCode}\``
    );
    expect(repository.match(/\? current\.startedAt/gu)).toHaveLength(2);
    expect(
      repository.match(/completedAt: failure\.completedAt/gu)
    ).toHaveLength(4);
    expect(
      repository.match(/completedAt: current\.completedAt/gu)
    ).toHaveLength(2);
  });

  it("routes production recipe recovery evidence through household authority", async () => {
    const [recoveryComposition, recoveryHousehold] = await Promise.all([
      read(path.join(apiFeaturesRoot, "imports/import-runtime-composition.ts")),
      read(
        path.join(
          apiFeaturesRoot,
          "imports/import-recipe-recovery.household.ts"
        )
      ),
    ]);
    const [, productionRecovery] = recoveryComposition.split(
      "export const makeImportRecipeRecoveryWorkflowHandler"
    );

    expect(productionRecovery).toBeDefined();
    expect(recoveryHousehold).toContain(
      "makeHouseholdImportEvidenceCurrentRepository"
    );
    expect(recoveryHousehold).toContain("makeHouseholdRecipeDraftRepository");
    expect(productionRecovery).toContain(
      "makeRecipeRecoveryHouseholdEvidenceRepositories"
    );
    expect(productionRecovery).toContain("householdDomain");
    expect(productionRecovery).not.toContain("makeD1RecipeDraftRepository");
    expect(productionRecovery).not.toContain("makeD1ImportExecutionRepository");
  });

  it("removes legacy D1 terminal authority and keeps the household evidence transaction I/O-free", async () => {
    const sources = await readProductionFeatureSources();
    const forbiddenLegacyAuthority = [
      "import_recipe_executor_terminal_checkpoints",
      "import_provider_terminal_checkpoints",
      "pilot_provider_terminal_checkpoints",
      "pilot_provider_speech_recoveries",
      "pilot_provider_visual_recoveries",
      "pilot_provider_visual_second_recoveries",
      "pilot_provider_recipe_recovery_attempts",
      "makeD1ProviderTerminalCheckpointRepository",
      "makeD1ProviderTerminalRecoveryRepository",
    ];

    for (const { path: sourcePath, source } of sources) {
      for (const token of forbiddenLegacyAuthority) {
        expect(source, `${sourcePath} retains ${token}`).not.toContain(token);
      }
    }

    expect(sources.map(({ path: sourcePath }) => sourcePath)).not.toContain(
      "imports/import-provider-terminal.ts"
    );

    const [householdSchema, sharedSchema, evidenceRepository] =
      await Promise.all([
        read(path.join(householdRoot, "household.database-schema.ts")),
        read(path.join(apiFeaturesRoot, "imports/import.database-schema.ts")),
        read(
          path.join(householdRoot, "evidence/household-evidence.repository.ts")
        ),
      ]);
    expect(householdSchema).toContain('"import_terminal_checkpoints"');
    expect(householdSchema).not.toContain("pilot");
    for (const token of forbiddenLegacyAuthority) {
      expect(sharedSchema).not.toContain(token);
    }
    expect(evidenceRepository).toMatch(/database\s*\.\s*transaction\s*\(/u);
    expect(evidenceRepository).not.toMatch(
      /cloudflare:workers|alchemy\/Cloudflare|R2Bucket|Workflow|Queue|\.getByName\(|\bfetch\s*\(|\.head\s*\(|\.send\s*\(/u
    );
  });

  it("removes all shared-D1 evidence and extraction authority", async () => {
    const sources = await readProductionFeatureSources();
    const forbidden = [
      "import_transcriptions",
      "import_visual_evidence",
      "import_carousel_evidence",
      "import_recipe_extractions",
      "makeD1SpeechTranscriptionRepository",
      "makeD1VisualEvidenceRepository",
      "makeD1CarouselEvidenceRepository",
      "makeD1RecipeDraftRepository",
    ];
    for (const { path: sourcePath, source } of sources) {
      for (const token of forbidden) {
        expect(source, `${sourcePath} retains ${token}`).not.toContain(token);
      }
    }
    for (const removedRepository of [
      "imports/import-speech-transcription.repository.d1.ts",
      "imports/import-visual-evidence.repository.d1.ts",
      "imports/import-carousel.repository.d1.ts",
      "imports/import-recipe-draft.repository.d1.ts",
    ]) {
      expect(sources.map(({ path: sourcePath }) => sourcePath)).not.toContain(
        removedRepository
      );
    }
  });

  it("keeps retry-varying time out of stable provider mutation identities", async () => {
    const repository = await read(
      path.join(
        apiFeaturesRoot,
        "imports/import-evidence.repository.household.ts"
      )
    );
    expect(repository).not.toMatch(/speech:claim:[^`]*\$\{claim\.startedAt\}/u);
    expect(repository).not.toMatch(/visual:claim:[^`]*\$\{claim\.startedAt\}/u);
    expect(repository).not.toMatch(
      /speech:fail:[^`]*\$\{failure\.completedAt\}/u
    );
    expect(repository).not.toMatch(
      /visual:fail:[^`]*\$\{failure\.completedAt\}/u
    );
  });

  it("activates both speech and visual recovery through the production Workflow seam", async () => {
    const [recovery, workflow] = await Promise.all([
      read(path.join(apiFeaturesRoot, "imports/import-provider-recovery.ts")),
      read(path.join(apiFeaturesRoot, "imports/import.workflow.ts")),
    ]);
    expect(recovery).toContain("restartFromVisual");
    expect(recovery).toMatch(
      /recovery\.requiresWorkflowActivation[\s\S]*restartFromSpeech[\s\S]*restartFromVisual/u
    );
    expect(workflow).toContain("restartFromVisual");
    expect(workflow).toContain('name: "extract-visual-evidence-v1"');
  });

  it("registers the immutable evidence route synchronously before Workflow dispatch", async () => {
    const worker = await read(path.join(apiFeaturesRoot, "../worker.ts"));
    expect(worker).toContain("makeD1ImportEvidenceRouteRepository");
    expect(worker).toMatch(/registerEvidenceRoute:[\s\S]*\.register\(/u);
    expect(worker).not.toContain("Cloudflare.Queues.WriteQueue");
    expect(worker).not.toMatch(
      /registerEvidenceRoute:[\s\S]{0,180}importEvidenceEvents\s*\.send/u
    );
  });

  it("models CopyObject as its closed Cloudflare notification variant", async () => {
    const reconciler = await read(
      path.join(apiFeaturesRoot, "imports/import-evidence-event.ts")
    );
    expect(reconciler).toContain("copySource");
    expect(reconciler).toContain('action: Schema.Literal("CopyObject")');
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
    expect(consumer).toContain("MealPlannerDatabase");
    expect(consumer).toContain("makeD1ImportEvidenceRouteRepository");
    expect(consumer).not.toContain("Cloudflare.KV");
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
