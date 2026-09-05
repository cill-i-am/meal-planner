import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import * as Bundle from "alchemy/Bundle";
import { Effect, Schema } from "effect";
import type { ModuleDefinition } from "miniflare";

/** Bundle a native Worker fixture and its text assets for Miniflare. */
export const bundleWorkerFixture = async (
  inputPath: string,
  outputDirectory?: string
): Promise<readonly [ModuleDefinition, ...ModuleDefinition[]]> => {
  const outputOptions: NonNullable<Parameters<typeof Bundle.build>[1]> = {
    codeSplitting: false,
    format: "esm",
    minify: true,
    sourcemap: false,
  };
  if (outputDirectory !== undefined) {
    outputOptions.dir = outputDirectory;
  }
  const output = await Effect.runPromise(
    Bundle.build(
      {
        checks: { ineffectiveDynamicImport: false, unresolvedImport: false },
        external: ["cloudflare:workers"],
        input: inputPath,
        plugins: [
          cloudflareRolldown({
            compatibilityDate: "2026-07-14",
            compatibilityFlags: ["nodejs_compat"],
          }),
        ],
      },
      outputOptions
    )
  );
  const [entry, ...assets] = output.files;
  return [
    {
      contents: Schema.is(Schema.String)(entry.content)
        ? entry.content
        : new TextDecoder().decode(entry.content),
      path: entry.path,
      type: "ESModule",
    },
    ...assets.map(
      (asset): ModuleDefinition => ({
        contents: Schema.is(Schema.String)(asset.content)
          ? asset.content
          : new TextDecoder().decode(asset.content),
        path: asset.path,
        type: "Text",
      })
    ),
  ];
};
