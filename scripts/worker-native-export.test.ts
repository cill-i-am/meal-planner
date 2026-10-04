import { NodeServices } from "@effect/platform-node";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { WorkerBundle } from "../node_modules/alchemy/lib/Cloudflare/Workers/Sources/Rolldown.js";

describe("API Worker bundle", () => {
  it("exports the native Agent beside Effect Durable Objects", async () => {
    const bundler = await Effect.runPromise(
      WorkerBundle.pipe(Effect.provide(NodeServices.layer))
    );
    const bundle = await Effect.runPromise(
      bundler
        .build({
          compatibility: { date: "2026-07-14", flags: ["nodejs_compat"] },
          entry: {
            // Only the export kind is used by the bundle's virtual entry.
            exports: {
              ImportMediaAcquisitionObject: {
                constructor: Effect.succeed(Effect.succeed({})),
                kind: "durableObject",
                services: Context.empty(),
              },
            },
            kind: "effect",
          },
          extraOptions: { nativeExports: ["AgentConversation"] },
          id: "MealPlannerApiNativeExportCheck",
          main: new URL("../apps/api/src/worker-entry.ts", import.meta.url)
            .href,
          stack: { name: "MealPlanner", stage: "e2e" },
        })
        .pipe(Effect.provide(NodeServices.layer))
    );
    const source = String(bundle.files[0].content);
    const module = ts.createSourceFile(
      bundle.files[0].path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    const exports = module.statements
      .filter(ts.isExportDeclaration)
      .flatMap((declaration) =>
        declaration.exportClause && ts.isNamedExports(declaration.exportClause)
          ? declaration.exportClause.elements.map(
              (element) => element.name.text
            )
          : []
      );

    expect(exports).toContain("AgentConversation");
    expect(exports).toContain("ImportMediaAcquisitionObject");
    expect(exports).toContain("default");
  });
});
