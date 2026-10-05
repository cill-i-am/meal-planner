import { ok } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  privateDiscoveryAssets,
  validatePrivateDiscoveryAssets,
} from "../evals/private-discovery/validate-assets.js";

const authority =
  "docs/decisions/pdr-0006-ai-evaluation-and-release-evidence.md";

const withAuthority = (run: (root: string) => void) => {
  const root = mkdtempSync(path.join(tmpdir(), "meal-planner-eval-assets-"));
  try {
    mkdirSync(path.join(root, "docs/decisions"), { recursive: true });
    writeFileSync(
      path.join(root, authority),
      "# Accepted evaluation decision\n"
    );
    mkdirSync(path.join(root, "docs/decisions/directory.md"));
    run(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
};

const validAssets = () => {
  const assets = structuredClone(privateDiscoveryAssets);
  assets.rubric.authority = authority;
  return assets;
};

describe("private-discovery offline asset validation", () => {
  it("accepts the canonical eight-family pack with its existing authority", () => {
    withAuthority((root) => {
      expect(() =>
        validatePrivateDiscoveryAssets(validAssets(), root)
      ).not.toThrow();
    });
  });

  it.each([
    "docs/decisions/product/0006-ai-evaluation-and-release-evidence.md",
    "docs/decisions",
    "docs/decisions/directory.md",
    "docs/decisions/../../../outside.md",
    "/outside.md",
  ])("rejects a missing or invalid authority: %s", (invalidAuthority) => {
    withAuthority((root) => {
      const assets = validAssets();
      assets.rubric.authority = invalidAuthority;
      expect(() => validatePrivateDiscoveryAssets(assets, root)).toThrow();
    });
  });

  it("rejects a discovery that references no fixture fact", () => {
    withAuthority((root) => {
      const assets = validAssets();
      const [scenario] = assets.suite.scenarios;
      ok(scenario);
      scenario.evaluatorOnly.requiredDiscoveries.push("missing_fact");
      expect(() => validatePrivateDiscoveryAssets(assets, root)).toThrow(
        "unknown discovery"
      );
    });
  });

  it("rejects a profile card outside the production contract", () => {
    withAuthority((root) => {
      const assets = validAssets();
      const [scenario] = assets.suite.scenarios;
      ok(scenario);
      const [card] = scenario.evaluatorOnly.expectedCards;
      ok(card);
      Object.assign(card.change, { _tag: "FabricatedProfileChange" });
      expect(() => validatePrivateDiscoveryAssets(assets, root)).toThrow();
    });
  });

  it("rejects stale template versions", () => {
    withAuthority((root) => {
      const assets = validAssets();
      assets.evidence.versions.rubric.version = "obsolete-rubric";
      expect(() => validatePrivateDiscoveryAssets(assets, root)).toThrow();
    });
  });
});
