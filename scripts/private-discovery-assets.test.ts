import { ok } from "node:assert/strict";

import { describe, expect, it } from "vitest";

import {
  privateDiscoveryAssets,
  validatePrivateDiscoveryAssets,
} from "../evals/private-discovery/validate-assets.js";

const validAssets = () => structuredClone(privateDiscoveryAssets);

describe("private-discovery offline asset validation", () => {
  it("accepts the canonical eight-family pack without a repository docs dependency", () => {
    expect(() => validatePrivateDiscoveryAssets(validAssets())).not.toThrow();
  });

  it.each([
    "docs/decisions/pdr-0006-ai-evaluation-and-release-evidence.md",
    "https://github.com/cill-i-am/meal-planner/blob/main/docs/decisions/pdr-0006-ai-evaluation-and-release-evidence.md",
    "https://github.com/other/project/blob/a28a527759d2d5d5580f4d6d9a673f08b6d80de9/docs/decisions/pdr-0006-ai-evaluation-and-release-evidence.md",
  ])("rejects altered historical provenance: %s", (invalidAuthority) => {
    const assets = validAssets();
    assets.rubric.authority = invalidAuthority;
    expect(() => validatePrivateDiscoveryAssets(assets)).toThrow(
      "immutable historical provenance"
    );
  });

  it("rejects a discovery that references no fixture fact", () => {
    const assets = validAssets();
    const [scenario] = assets.suite.scenarios;
    ok(scenario);
    scenario.evaluatorOnly.requiredDiscoveries.push("missing_fact");
    expect(() => validatePrivateDiscoveryAssets(assets)).toThrow(
      "unknown discovery"
    );
  });

  it("rejects a profile card outside the production contract", () => {
    const assets = validAssets();
    const [scenario] = assets.suite.scenarios;
    ok(scenario);
    const [card] = scenario.evaluatorOnly.expectedCards;
    ok(card);
    Object.assign(card.change, { _tag: "FabricatedProfileChange" });
    expect(() => validatePrivateDiscoveryAssets(assets)).toThrow();
  });

  it("rejects stale template versions", () => {
    const assets = validAssets();
    assets.evidence.versions.rubric.version = "obsolete-rubric";
    expect(() => validatePrivateDiscoveryAssets(assets)).toThrow();
  });

  it("rejects a calibration template that omits a scenario", () => {
    const assets = validAssets();
    assets.calibration.productOwnerReview.pop();
    expect(() => validatePrivateDiscoveryAssets(assets)).toThrow();
  });
});
