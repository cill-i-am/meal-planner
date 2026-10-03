import path from "node:path";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Artifacts,
  createArtifactStore,
  makeScopedArtifacts,
} from "alchemy/Artifacts";
import type * as Bundle from "alchemy/Bundle";
import { makeSourceContext, resolveSource } from "alchemy/Cloudflare/Workers";
import { readMigrationRecords } from "alchemy/SQL/Migrations/index";
import { Effect, Schema } from "effect";
import type { MiniflareWorkerConfig } from "miniflare";

/** Bundle a native Worker fixture and its text assets for Miniflare. */
export const bundleWorkerFixture = async (
  inputPath: string,
  outputDirectory?: string
): Promise<NonNullable<MiniflareWorkerConfig["manifest"]>> => {
  const outputOptions: NonNullable<Parameters<typeof Bundle.build>[1]> = {
    codeSplitting: false,
    format: "esm",
    minify: true,
    sourcemap: false,
  };
  if (outputDirectory !== undefined) {
    outputOptions.dir = outputDirectory;
  }
  const { bundle: output } = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* buildNativeWorkerFixture() {
        const dir = "./apps/api/household-migrations";
        const table = "__drizzle_migrations";
        const records = yield* readMigrationRecords(
          fileURLToPath(new URL("../../household-migrations", import.meta.url))
        );
        const sqlMigrations = {
          [`alchemy:sql-migrations:${JSON.stringify([dir, table])}`]: {
            _tag: "Cloudflare.SqlMigrations",
            records,
            table,
          },
        };
        const props = {
          build: {
            input: {
              checks: {
                ineffectiveDynamicImport: false,
                unresolvedImport: false,
              },
              external: ["cloudflare:workers"],
              transform: {
                define: {
                  __MEAL_PLANNER_TEST_SQL_MIGRATIONS__:
                    JSON.stringify(sqlMigrations),
                },
              },
            },
            output: outputOptions,
          },
          isExternal: true,
          main: inputPath,
        };
        const source = yield* resolveSource(props);
        const id = path.basename(inputPath);
        return yield* source.build(
          makeSourceContext({
            compatibility: { date: "2026-07-14", flags: ["nodejs_compat"] },
            fqn: id,
            id,
            props,
            stack: { name: "MealPlanner", stage: "native-test" },
            workerName: id,
          })
        );
      })
    ).pipe(
      Effect.provideService(
        Artifacts,
        makeScopedArtifacts(createArtifactStore(), "native-test")
      ),
      Effect.provide(NodeServices.layer)
    )
  );
  if (output === undefined) {
    throw new Error("Native Worker fixture must contain a server bundle");
  }
  const [entry, ...assets] = output.files;
  const modulesRoot = path.resolve(path.dirname(entry.path));
  return {
    mainModule: path.relative(modulesRoot, entry.path),
    modules: {
      [path.relative(modulesRoot, entry.path)]: {
        contents: Schema.is(Schema.String)(entry.content)
          ? entry.content
          : new TextDecoder().decode(entry.content),
        type: "esm",
      },
      ...Object.fromEntries(
        assets.map((asset) => [
          path.relative(modulesRoot, asset.path),
          {
            contents: Schema.is(Schema.String)(asset.content)
              ? asset.content
              : new TextDecoder().decode(asset.content),
            type: "text",
          },
        ])
      ),
    },
    modulesRoot,
  };
};
