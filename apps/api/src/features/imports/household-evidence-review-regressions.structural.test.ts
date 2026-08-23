import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFile(new URL(relativePath, import.meta.url), "utf-8");

describe("household evidence exact-head review regressions", () => {
  it("persists and projects one canonical timestamp per provider dispatch", async () => {
    const [contract, databaseSchema, repository] = await Promise.all([
      source("../households/evidence/household-evidence.contract.ts"),
      source("../households/household.database-schema.ts"),
      source("import-evidence.repository.household.ts"),
    ]);

    expect(databaseSchema).toContain('startedAt: text("started_at").notNull()');
    expect(contract).toContain("startedAt: ImportTimestamp");
    expect(repository).not.toMatch(/claim\.startedAt\}`/u);
    expect(repository).not.toMatch(/failure\.completedAt\}`/u);
  });

  it("replays R2 evidence but otherwise keeps ResumeDispatch on the provider path", async () => {
    const visual = await source("import-visual-evidence.ts");

    expect(visual).toContain("const dispatchStartedAt = claim.startedAt");
    expect(visual).toContain(
      'claim._tag === "Completed" || claim._tag === "ResumeDispatch"'
    );
    expect(visual).toContain('if (claim._tag === "Completed")');
    expect(visual.indexOf('if (claim._tag === "Completed")')).toBeLessThan(
      visual.indexOf("const dispatchStartedAt = claim.startedAt")
    );
  });

  it("propagates the household-owned failure code on speech and visual replay", async () => {
    const [speech, visual] = await Promise.all([
      source("import-speech-transcription.ts"),
      source("import-visual-evidence.ts"),
    ]);

    expect(speech).toContain("pipelineFailure(claim.code)");
    expect(visual).toContain("pipelineFailure(claim.code)");
  });

  it("uses the admitted workflow identity for every provider recovery operation", async () => {
    const workflow = await source("import.workflow.ts");

    expect(workflow).not.toContain("importWorkflowInstanceId");
    expect(workflow).toContain(".get(workflowIdentity)");
  });

  it("carries execution and acquisition-attempt generations independently", async () => {
    const contract = await source(
      "../households/evidence/household-evidence.contract.ts"
    );

    expect(contract).toContain("acquisitionAttemptGeneration");
  });

  it("provisions an R2-event DLQ and keeps the evidence consumer read-only", async () => {
    const [stack, consumer] = await Promise.all([
      source("../../../../../alchemy.run.ts"),
      source("../../infrastructure/import-evidence-event-queue.ts"),
    ]);

    expect(stack).toContain("ImportEvidenceEventDeadLetterQueue");
    expect(consumer).not.toContain("ReadWriteBucket");
  });

  it("has no legacy ImportRepository or StoredImport production projection", async () => {
    const [
      checkpoint,
      execution,
      legacyContract,
      recovery,
      repository,
      schema,
    ] = await Promise.all([
      source("import-acquisition-checkpoint.ts"),
      source("import-execution.repository.d1.ts"),
      source("import.repository.ts"),
      source("import-recipe-recovery.household.ts"),
      source("import-evidence.repository.household.ts"),
      source("import.database-schema.ts"),
    ]);

    expect(recovery).not.toContain("makeHouseholdImportEvidenceViewRepository");
    for (const productionSource of [
      checkpoint,
      execution,
      legacyContract,
      repository,
    ]) {
      expect(productionSource).not.toContain("StoredImport");
      expect(productionSource).not.toContain("ImportRepository");
    }
    expect(schema).not.toContain("evidenceReferencesJson");
    expect(schema).not.toMatch(/"(?:acquired|transcribed|transcribing)"/u);
  });

  it("persists the admitted trace and exposes only an ambiguous restart until household progress", async () => {
    const [contract, settlement, workflow] = await Promise.all([
      source("../households/recipe-import/household-recipe-import.contract.ts"),
      source("import-provider-terminal-settlement.ts"),
      source("import.workflow.ts"),
    ]);

    expect(contract).toContain("originalTrace: ImportTraceContext");
    expect(settlement).toContain("authority.originalTrace");
    expect(workflow).toContain('"RestartAmbiguous",');
  });
});
