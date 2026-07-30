import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowSource = () =>
  readFile(
    new URL("import-recipe-recovery.workflow.ts", import.meta.url),
    "utf-8"
  );

describe("recipe-only recovery workflow composition", () => {
  it("uses the installed native recipe task without acquisition, speech, visual or URL inputs", async () => {
    const source = await workflowSource();

    expect(source).toContain('"extract-recipe-recovery-v1"');
    expect(source).toContain("runProviderTask(");
    expect(source).toContain("makeInstalledRecipeExtractor");
    expect(source).toContain("recovery.recoveryDispatchId");
    expect(source).toContain("recovery.recoveryExtractionFingerprint");
    expect(source).toContain("Cloudflare.D1.QueryDatabase");
    expect(source).toContain("Cloudflare.R2.ReadWriteBucket");
    expect(source).toContain("Cloudflare.AI.QueryGateway");
    expect(source).not.toMatch(
      /ImportMediaAcquisitionObject|makeInstalledSpeechTranscriber|makeInstalledVisualEvidenceExtractor|sourceUrl|sourceResolver/iu
    );
  });
});
