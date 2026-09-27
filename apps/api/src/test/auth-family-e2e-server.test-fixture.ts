import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

import {
  privateOutputRuntimeWorker,
  privateOutputTestBindings,
} from "../features/private-output/private-output-runtime.test-fixture.js";
import { bundleWorkerFixture } from "./native-worker.test-fixture.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const port = Number(process.env["AUTH_FAMILY_E2E_PORT"] ?? "4398");
const baseURL = `http://127.0.0.1:${port}`;
const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const [website, api, domain, output] = await Promise.all([
  bundleWorkerFixture(path.join(root, "apps/web/e2e/website.test-fixture.js")),
  bundleWorkerFixture(
    path.join(root, "apps/api/src/test/auth-family-api.test-fixture.ts")
  ),
  bundleWorkerFixture(
    path.join(
      root,
      "apps/api/src/features/households/household-domain-service.test-fixture.js"
    )
  ),
  bundleWorkerFixture(
    path.join(
      root,
      "apps/api/src/features/private-output/private-output-worker.ts"
    )
  ),
]);
const directory = await mkdtemp(path.join(tmpdir(), "auth-family-e2e-"));
const runtime = new Miniflare({
  cf: false,
  host: "127.0.0.1",
  port,
  resourcePersistencePath: directory,
  workers: [
    {
      config: {
        assets: {
          directory: path.join(root, "apps/web/.output/public"),
          hasUserWorker: true,
        },
        compatibilityDate,
        compatibilityFlags,
        env: { MEAL_PLANNER_API: { type: "worker", worker: "api" } },
        manifest: website,
        name: "website",
        type: "worker",
      },
    },
    {
      config: {
        compatibilityDate,
        compatibilityFlags,
        env: {
          ...privateOutputTestBindings,
          BASE_URL: { type: "text", value: baseURL },
          BETTER_AUTH_SECRET: {
            type: "text",
            value: randomBytes(32).toString("hex"),
          },
          HouseholdDomainWorker: { type: "worker", worker: "household-domain" },
          MealPlannerAuthDatabase: { id: "auth-family-e2e", type: "d1" },
          TEST_MAIL: { id: "auth-family-e2e-mail", type: "kv" },
        },
        manifest: api,
        name: "api",
        type: "worker",
      },
    },
    {
      config: {
        compatibilityDate,
        compatibilityFlags,
        env: {
          ...privateOutputTestBindings,
          HouseholdObject: {
            exportName: "HouseholdObject",
            type: "durable-object",
            worker: "household-domain",
          },
        },
        exports: {
          HouseholdObject: { storage: "sqlite", type: "durable-object" },
        },
        manifest: domain,
        name: "household-domain",
        type: "worker",
      },
    },
    privateOutputRuntimeWorker(output),
  ],
});
const stopped = Promise.withResolvers<null>();
const stop = () => stopped.resolve(null);
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const database = await runtime.getD1Database(
    "MealPlannerAuthDatabase",
    "api"
  );
  const migrations = path.join(root, "apps/api/auth-migrations");
  const entries = await readdir(migrations);
  const scripts = await Promise.all(
    entries
      .toSorted()
      .map((entry) =>
        readFile(path.join(migrations, entry, "migration.sql"), "utf-8")
      )
  );
  // D1 executes the ordered migration statements sequentially in one batch.
  const statements = scripts.flatMap((sql) =>
    sql
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  await database.batch(
    statements.map((statement) => database.prepare(statement))
  );
  await runtime.ready;
  const mail = await runtime.getKVNamespace("TEST_MAIL", "api");
  await mail.put("__ready", "ready");
  console.info(`Auth/family local Worker runtime ready at ${baseURL}`);
  await stopped.promise;
} finally {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  await runtime.dispose();
  await rm(directory, { force: true, recursive: true });
}
