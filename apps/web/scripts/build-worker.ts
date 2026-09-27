import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serialize } from "node:v8";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Artifacts,
  makeScopedArtifacts,
  createArtifactStore,
} from "alchemy/Artifacts";
import { makeSourceContext, resolveSource } from "alchemy/Cloudflare/Workers";
import { Effect } from "effect";

import { websiteSource } from "../website-source.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* buildWebsite() {
      const props = { vite: { ...websiteSource, rootDir: root } };
      const source = yield* resolveSource(props);
      const build = yield* source.build(
        makeSourceContext({
          compatibility: { date: "2026-07-14", flags: ["nodejs_compat"] },
          id: "MealPlannerWebsite",
          props,
          stack: { name: "MealPlanner", stage: "local-build" },
          workerName: "meal-planner-website-local",
        })
      );
      if (!build.bundle || !build.assets) {
        return yield* Effect.die(
          "Website build must contain SSR and client assets"
        );
      }
      return { bundle: build.bundle, clientDirectory: build.assets.directory };
    })
  ).pipe(
    Effect.provideService(
      Artifacts,
      makeScopedArtifacts(createArtifactStore(), "website")
    ),
    Effect.provide(NodeServices.layer)
  )
);
await mkdir(new URL("../.worker-build/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../.worker-build/output.v8", import.meta.url),
  serialize(output)
);
