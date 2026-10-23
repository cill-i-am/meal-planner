import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { groundRecipeCandidate } from "../../apps/api/src/features/imports/import-recipe-grounding.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const groundingPath =
  "apps/api/src/features/imports/import-recipe-grounding.ts";
const domainPath = "packages/recipe-domain/src/content.ts";
const sha256 = (source: string) =>
  createHash("sha256").update(source).digest("hex");

/** Replay a trusted local Git version without replacing the working source. */
export const withHistoricalGrounding = async <A>(
  revision: string,
  use: (grounding: {
    readonly apply: typeof groundRecipeCandidate;
    readonly sha256: string;
  }) => A
) => {
  if (!/^[a-f0-9]{40}$/u.test(revision)) {
    throw new Error("Historical grounding requires a full Git commit SHA");
  }
  const sourceAt = (file: string) =>
    execFileSync("git", ["show", `${revision}:${file}`], {
      cwd: root,
      encoding: "utf-8",
    });
  // The historical grounder has one runtime domain dependency. Refuse drift.
  if (
    sourceAt(domainPath) !==
      readFileSync(path.join(root, domainPath), "utf-8") ||
    sourceAt("pnpm-lock.yaml") !==
      readFileSync(path.join(root, "pnpm-lock.yaml"), "utf-8")
  ) {
    throw new Error(
      "Historical recipe-domain source or dependency lock differs; use an isolated checkout"
    );
  }
  const source = sourceAt(groundingPath);
  const imports = new Map([
    [
      "@meal-planner/recipe-domain",
      pathToFileURL(path.join(root, domainPath)).href,
    ],
    ["effect", import.meta.resolve("effect")],
    [
      "./import-recipe-extractor.js",
      pathToFileURL(
        path.join(
          root,
          "apps/api/src/features/imports/import-recipe-extractor.ts"
        )
      ).href,
    ],
  ]);
  const executable = source.replaceAll(
    /from "(?<specifier>[^"]+)"/gu,
    (_match, specifier: string) => {
      const resolved = imports.get(specifier);
      if (resolved === undefined) {
        throw new Error(`Unreviewed historical grounding import: ${specifier}`);
      }
      return `from ${JSON.stringify(resolved)}`;
    }
  );
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "recipe-grounder-replay-")
  );
  const modulePath = path.join(directory, "grounder.ts");
  try {
    writeFileSync(modulePath, executable, { flag: "wx", mode: 0o600 });
    const loaded: {
      readonly groundRecipeCandidate: typeof groundRecipeCandidate;
    } = await import(pathToFileURL(modulePath).href);
    return use({ apply: loaded.groundRecipeCandidate, sha256: sha256(source) });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};
