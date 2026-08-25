import { access, readFile } from "node:fs/promises";

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
  });

  it("propagates household failure codes and keeps execution generations separate", async () => {
    const [contract, repository, schema, speech, visual] = await Promise.all([
      source("../households/evidence/household-evidence.contract.ts"),
      source("../households/evidence/household-evidence.repository.ts"),
      source("../households/household.database-schema.ts"),
      source("import-speech-transcription.ts"),
      source("import-visual-evidence.ts"),
    ]);

    expect(speech).toContain("pipelineFailure(claim.code)");
    expect(visual).toContain("pipelineFailure(claim.code)");
    expect(contract).toContain("acquisitionAttemptGeneration");
    expect(schema).toContain('"acquisition_attempt_generation"');
    expect(repository).toContain("input.acquisitionAttemptGeneration");
  });

  it("has no shared-D1 household authority or lifecycle-event routing", async () => {
    const removed = [
      "import.database-schema.ts",
      "import-evidence-event.ts",
      "import-evidence-route.repository.d1.ts",
      "import-execution.repository.d1.ts",
      "import-observability.d1.ts",
    ];
    await Promise.all(
      removed.map((relativePath) =>
        expect(access(new URL(relativePath, import.meta.url))).rejects.toThrow()
      )
    );

    const [worker, workflow] = await Promise.all([
      source("../../worker.ts"),
      source("import.workflow.ts"),
    ]);
    expect(worker).not.toMatch(/MealPlannerDatabase|registerEvidenceRoute/u);
    expect(workflow).not.toMatch(
      /makeD1ImportExecutionRepository|makeD1ImportObservabilityTraceStore/u
    );
  });

  it("drives native batch Queue and DLQ proof through production handlers", async () => {
    const [consumerFixture, deadLetterFixture, worker] = await Promise.all([
      source("household-import-batch-queue.test-fixture.ts"),
      source("household-import-batch-dlq.test-fixture.ts"),
      source("../../worker.ts"),
    ]);

    expect(worker).toContain("handleHouseholdImportBatchQueueMessage");
    expect(worker).toContain("handleHouseholdImportBatchDeadLetterMessage");
    expect(consumerFixture).toContain("handleHouseholdImportBatchQueueMessage");
    expect(deadLetterFixture).toContain(
      "handleHouseholdImportBatchDeadLetterMessage"
    );
  });

  it("uses admitted workflow identity and household-owned recovery authority", async () => {
    const [contract, recovery, workflow] = await Promise.all([
      source("../households/recipe-import/household-recipe-import.contract.ts"),
      source("import-provider-recovery.ts"),
      source("import.workflow.ts"),
    ]);

    expect(workflow).not.toContain("importWorkflowInstanceId");
    expect(workflow).toContain(
      "cloudflareWorkflowInstanceId(workflowIdentity)"
    );
    expect(contract).toContain("originalTrace: ImportTraceContext");
    expect(recovery).toContain("authority.originalTrace");
    expect(workflow).toContain('"RestartAmbiguous",');
  });
});
