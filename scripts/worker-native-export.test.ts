import { WorkerBundle } from "@alchemy.run/cloudflare/Workers/Sources/Rolldown";
import { NodeServices } from "@effect/platform-node";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { parseSync } from "oxc-parser";
import { beforeAll, describe, expect, it } from "vitest";

describe("API Worker bundle", () => {
  let bundle: Awaited<ReturnType<typeof buildBundle>>;

  const buildBundle = async () => {
    const bundler = await Effect.runPromise(
      WorkerBundle.pipe(Effect.provide(NodeServices.layer))
    );
    return Effect.runPromise(
      bundler
        .build({
          compatibility: { date: "2026-07-14", flags: ["nodejs_compat"] },
          entry: {
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
  };
  beforeAll(async () => {
    bundle = await buildBundle();
  });
  it("exports the native Agent beside Effect Durable Objects", () => {
    const source = String(bundle.files[0].content);
    const { program, errors } = parseSync(bundle.files[0].path, source);
    expect(errors).toEqual([]);
    const exports = program.body.flatMap((statement) => {
      if (statement.type === "ExportDefaultDeclaration") {
        return ["default"];
      }
      if (statement.type !== "ExportNamedDeclaration") {
        return [];
      }
      return statement.specifiers.map(({ exported }) =>
        exported.type === "Identifier" ? exported.name : exported.value
      );
    });

    expect(exports).toContain("AgentConversation");
    expect(exports).toContain("ImportMediaAcquisitionObject");
    expect(exports).toContain("default");
  });
});
