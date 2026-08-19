import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import * as Bundle from "alchemy/Bundle";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";
import type { ModuleDefinition } from "miniflare";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as authSchema from "../auth/auth.database-schema.js";
import { HouseholdMetadata } from "./household.contract.js";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const secret = "local-boundary-test-secret-at-least-32-characters";
const temporaryDirectories: string[] = [];
let runtime: Miniflare;

const HouseholdStatusResponse = Schema.Struct({
  ...HouseholdMetadata.fields,
  status: Schema.Literal("ready"),
});
const SessionResponse = Schema.Struct({
  session: Schema.Struct({ id: Schema.String }),
});
const OrganizationResponse = Schema.Struct({ id: Schema.String });

const bundleText = (content: string | Uint8Array<ArrayBufferLike>): string =>
  Schema.is(Schema.String)(content)
    ? content
    : new TextDecoder().decode(content);

const bundleFixture = async (
  fileName: string,
  outputDirectory: string
): Promise<readonly [ModuleDefinition, ...ModuleDefinition[]]> => {
  const output = await Effect.runPromise(
    Bundle.build(
      {
        checks: {
          ineffectiveDynamicImport: false,
          unresolvedImport: false,
        },
        external: ["cloudflare:workers"],
        input: fileURLToPath(new URL(fileName, import.meta.url)),
        plugins: [
          cloudflareRolldown({ compatibilityDate, compatibilityFlags }),
        ],
      },
      {
        codeSplitting: false,
        dir: outputDirectory,
        format: "esm",
        minify: true,
        sourcemap: false,
      }
    )
  );
  const [entry, ...assets] = output.files;
  return [
    {
      contents: bundleText(entry.content),
      path: entry.path,
      type: "ESModule",
    },
    ...assets.map(
      (asset): ModuleDefinition => ({
        contents: bundleText(asset.content),
        path: asset.path,
        type: "Text",
      })
    ),
  ];
};

type MiniflareD1Database = Awaited<ReturnType<Miniflare["getD1Database"]>>;

const applyAuthMigrations = async (database: MiniflareD1Database) => {
  const migrationsRoot = fileURLToPath(
    new URL("../../../auth-migrations", import.meta.url)
  );
  const migrationDirectoryEntries = await readdir(migrationsRoot);
  const directories = migrationDirectoryEntries.toSorted();
  const migrations = await Promise.all(
    directories.map(async (directory) => {
      const migrationPath = `${migrationsRoot}/${directory}/migration.sql`;
      const migrationStat = await stat(migrationPath);
      if (!migrationStat.isFile()) {
        return [];
      }
      const migration = await readFile(migrationPath, "utf-8");
      return migration
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
    })
  );
  await database.batch(
    migrations.flat().map((statement) => database.prepare(statement))
  );
};

beforeAll(async () => {
  const temporaryDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-household-boundary-`
  );
  temporaryDirectories.push(temporaryDirectory);
  const [websiteModules, apiModules, domainModules] = await Promise.all([
    bundleFixture("household-website.test-worker.ts", temporaryDirectory),
    bundleFixture("household-api-service.test-worker.ts", temporaryDirectory),
    bundleFixture(
      "household-domain-service.test-worker.ts",
      temporaryDirectory
    ),
  ]);
  runtime = new Miniflare({
    compatibilityDate,
    compatibilityFlags,
    workers: [
      {
        compatibilityDate,
        compatibilityFlags,
        modules: [...websiteModules],
        name: "website",
        serviceBindings: { MEAL_PLANNER_API: "api" },
      },
      {
        bindings: { AUTH_SECRET: secret },
        compatibilityDate,
        compatibilityFlags,
        d1Databases: { MealPlannerAuthDatabase: "household-auth-test" },
        modules: [...apiModules],
        name: "api",
        serviceBindings: { HouseholdDomainWorker: "household-domain" },
      },
      {
        compatibilityDate,
        compatibilityFlags,
        durableObjects: {
          HouseholdObject: { className: "HouseholdObject", useSQLite: true },
        },
        modules: [...domainModules],
        name: "household-domain",
      },
    ],
  });
  await applyAuthMigrations(
    await runtime.getD1Database("MealPlannerAuthDatabase", "api")
  );
}, 30_000);

afterAll(async () => {
  await runtime.dispose();
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

const cookieHeader = (response: {
  readonly headers: { readonly get: (name: string) => string | null };
}): string => {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) {
    throw new Error("Expected Better Auth to set a session cookie.");
  }
  return setCookie.split(";", 1)[0] ?? "";
};

const authRequest = (
  path: string,
  body: Record<string, unknown>,
  cookie?: string
) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: "https://meal-planner.test",
  };
  if (cookie !== undefined) {
    headers["cookie"] = cookie;
  }
  return runtime.dispatchFetch(`https://meal-planner.test/api/auth${path}`, {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  });
};

const signUp = async (label: string) => {
  const response = await authRequest("/sign-up/email", {
    email: `${label.toLowerCase().replaceAll(" ", "-")}@example.test`,
    name: label,
    password: "correct horse battery staple",
  });
  expect(response.status).toBe(200);
  return cookieHeader(response);
};

const createOrganization = async (label: string, cookie: string) => {
  const response = await authRequest(
    "/organization/create",
    { name: label, slug: label.toLowerCase().replaceAll(" ", "-") },
    cookie
  );
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(OrganizationResponse)(
    await response.json()
  );
};

describe("household Website-to-Durable-Object boundary", () => {
  it("admits a member before the private worker initializes its household", async () => {
    const cookie = await signUp("Boundary Member");
    const organization = await createOrganization("Boundary Household", cookie);

    const response = await runtime.dispatchFetch(
      "https://meal-planner.test/v1/household",
      { headers: { cookie } }
    );

    expect(response.status).toBe(200);
    const household = await Schema.decodeUnknownPromise(
      HouseholdStatusResponse
    )(await response.json());
    expect(household).toEqual({
      createdAtEpochMs: expect.any(Number),
      organizationId: organization.id,
      status: "ready",
    });
  });

  it("rejects a forged cross-organization session before private routing", async () => {
    const cookieA = await signUp("Boundary A");
    const cookieB = await signUp("Boundary B");
    const organizationB = await createOrganization("Boundary B Home", cookieB);
    const sessionResponse = await runtime.dispatchFetch(
      "https://meal-planner.test/api/auth/get-session",
      { headers: { cookie: cookieA } }
    );
    const session = await Schema.decodeUnknownPromise(SessionResponse)(
      await sessionResponse.json()
    );
    const authDatabase = drizzle(
      await runtime.getD1Database("MealPlannerAuthDatabase", "api")
    );
    await authDatabase
      .update(authSchema.session)
      .set({ activeOrganizationId: organizationB.id })
      .where(eq(authSchema.session.id, session.session.id));

    const response = await runtime.dispatchFetch(
      "https://meal-planner.test/v1/household",
      { headers: { cookie: cookieA } }
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ code: "unauthorized" });
  });
});
