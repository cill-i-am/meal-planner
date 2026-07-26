import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  RecipeQualityPilotBudgetCapMicroUsd,
  RecipeQualityPilotStage,
} from "./recipe-quality-pilot.js";

const runbookUrl = new URL(
  "../../../../../docs/real-source-pilot-runbook.md",
  import.meta.url
);
const inputPackageUrl = new URL(
  "../../../../../docs/real-source-pilot-input-package.md",
  import.meta.url
);

const formatMicroUsd = (value: number) =>
  new Intl.NumberFormat("en-US").format(value).replaceAll(",", "_");

describe("real-source pilot operator documentation", () => {
  it("stays aligned with the executable stage and budget contract", async () => {
    const [runbook, inputPackage] = await Promise.all([
      readFile(runbookUrl, "utf-8"),
      readFile(inputPackageUrl, "utf-8"),
    ]);
    const exactBudget = formatMicroUsd(RecipeQualityPilotBudgetCapMicroUsd);

    for (const document of [runbook, inputPackage]) {
      expect(document).toContain(`\`${RecipeQualityPilotStage}\``);
      expect(document).toContain(`\`${exactBudget}\``);
    }

    expect(runbook).not.toContain("pilot-gaia-117");
    expect(runbook).not.toContain("positive whole-number budget cap");
  });

  it("keeps the six-source preparation package privacy-safe", async () => {
    const inputPackage = await readFile(inputPackageUrl, "utf-8");

    for (const sourceClass of [
      "normal_video",
      "sparse_description",
      "dense_on_screen_text",
      "speech_heavy",
      "carousel",
      "expected_failure",
    ]) {
      expect(inputPackage).toContain(`\`${sourceClass}\``);
    }

    expect(inputPackage).not.toMatch(/https?:\/\//u);
    expect(inputPackage).not.toContain("vm.tiktok.com");
  });
});
