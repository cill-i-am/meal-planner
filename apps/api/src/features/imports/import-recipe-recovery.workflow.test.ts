import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowSource = () =>
  readFile(
    new URL("import-recipe-recovery.workflow.ts", import.meta.url),
    "utf-8"
  );

describe("recipe-only recovery workflow composition", () => {
  it("uses one ordinal-versioned installed recipe task without acquisition, speech, visual or URL inputs", async () => {
    const source = await workflowSource();

    expect(source).toMatch(
      /const recoveryTaskVersion = `v\$\{recovery\.recoveryOrdinal\}`/u
    );
    expect(source).toMatch(
      /`extract-recipe-recovery-\$\{recoveryTaskVersion\}`/u
    );
    expect(source).toMatch(
      /`persist-recipe-recovery-terminal-\$\{recoveryTaskVersion\}`/u
    );
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
