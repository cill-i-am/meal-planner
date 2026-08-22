import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import {
  CreateMealPlanPayload,
  HouseholdMealPlanResponse,
} from "@meal-planner/household-api";
import {
  Recipe,
  RecipeImportAction,
  RecipeImportIntent,
  RecipeImportTimeline,
} from "@meal-planner/recipe-import-api";
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
let runtime: Miniflare | undefined;

const getRuntime = (): Miniflare => {
  if (runtime === undefined) {
    throw new Error("Expected the household boundary runtime to be ready.");
  }
  return runtime;
};

const HouseholdStatusResponse = Schema.Struct({
  ...HouseholdMetadata.fields,
  status: Schema.Literal("ready"),
});
const SessionResponse = Schema.Struct({
  session: Schema.Struct({ id: Schema.String }),
  user: Schema.Struct({ id: Schema.String }),
});
const OrganizationResponse = Schema.Struct({ id: Schema.String });
const createPayload = Schema.decodeUnknownSync(CreateMealPlanPayload)({
  policy: {
    allowedDietaryFit: ["household_match"],
    allowedDifficulties: ["easy"],
    allowedTotalTimeBands: ["under_30_minutes"],
    maxRecipeUses: 1,
    preferredCuisines: ["Irish"],
    version: "boundary-policy-v1",
  },
  request: {
    requestKey: "boundary-week",
    slots: [
      {
        date: "2026-08-24",
        mealType: "dinner",
        servings: 2,
        slotId: "boundary-dinner",
      },
    ],
  },
});

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
  const migrationDirectories = await readdir(migrationsRoot);
  const directories = migrationDirectories.toSorted();
  const migrations = await Promise.all(
    directories.map(async (directory) => {
      const migrationPath = `${migrationsRoot}/${directory}/migration.sql`;
      const migrationStats = await stat(migrationPath);
      if (!migrationStats.isFile()) {
        return [];
      }
      const migrationContents = await readFile(migrationPath, "utf-8");
      return migrationContents
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
    bundleFixture(
      "household-website-service.test-fixture.js",
      temporaryDirectory
    ),
    bundleFixture("household-api-service.test-fixture.ts", temporaryDirectory),
    bundleFixture(
      "household-domain-service.test-fixture.js",
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
        bindings: { BETTER_AUTH_SECRET: secret },
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
    await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
  );
}, 30_000);

afterAll(async () => {
  await runtime?.dispose();
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
  return getRuntime().dispatchFetch(
    `https://meal-planner.test/api/auth${path}`,
    { body: JSON.stringify(body), headers, method: "POST" }
  );
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

const systemCommand = (
  operation: "commit-acquisition-evidence" | "commit-draft" | "resolve",
  input: object
) =>
  getRuntime().dispatchFetch(
    "https://meal-planner.test/v1/__test/system-import",
    {
      body: JSON.stringify(input),
      headers: {
        "content-type": "application/json",
        "x-test-household-system-operation": operation,
      },
      method: "POST",
    }
  );

const review = {
  answers: [],
  blockers: { invalidFields: [], unresolvedRequiredFields: [] },
  editableFields: ["name", "ingredient_lines", "instructions", "tags"],
  recipe: {
    author: null,
    category: null,
    cookTimeMinutes: 15,
    cuisine: "Irish",
    description: "Provider-free public boundary tracer.",
    ingredientLines: ["1 local ingredient"],
    ingredientQuantities: null,
    ingredientUnits: null,
    instructions: ["Cook locally."],
    name: "Public household tracer stew",
    nutrition: null,
    prepTimeMinutes: 10,
    temperatureCelsius: null,
    tools: ["Pot"],
    totalTimeMinutes: 25,
    yield: "2 servings",
  },
  tags: {
    cuisines: ["Irish"],
    dietaryFit: "household_match",
    difficulty: "easy",
    leftovers: "one_meal",
    mealTypes: ["dinner"],
    totalTimeBand: "under_30_minutes",
  },
} as const;

describe("household public API to private Durable Object boundary", () => {
  it("re-decodes and rejects a malformed clone at the private Worker boundary", async () => {
    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household",
      { headers: { "x-test-private-household-malformed": "1" } }
    );
    const body = await response.text();
    expect(response.status, body).toBe(400);
    expect(body).not.toContain("organization-private-malformed");
    expect(body).not.toContain("unexpectedAuthority");
  });

  it("admits a Better Auth member before private household routing", async () => {
    const cookie = await signUp("Boundary Member");
    const organization = await createOrganization("Boundary Household", cookie);
    const response = await getRuntime().dispatchFetch(
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

  it("runs public admission through system draft commit, confirmation, Recipe Bank, and planning", async () => {
    const cookie = await signUp("Import Boundary Member");
    const organization = await createOrganization(
      "Import Boundary Household",
      cookie
    );
    const createResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/recipe-import-intents",
      {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@mealplanner/video/7000000000000000099",
          },
        }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "public-provider-free-admission",
        },
        method: "POST",
      }
    );
    expect(createResponse.status).toBe(201);
    const admitted = await Schema.decodeUnknownPromise(RecipeImportIntent)(
      await createResponse.json()
    );
    expect(admitted).toMatchObject({ intentVersion: 1, status: "processing" });

    const systemAdmission = {
      actor: { _tag: "System", purpose: "recipe_import_lifecycle_commit" },
      organizationId: organization.id,
    } as const;
    const resolvedResponse = await systemCommand("resolve", {
      admission: systemAdmission,
      canonicalSourceId: "tiktok:video:7000000000000000099",
      canonicalUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000099",
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "1".repeat(64),
      sourceKind: "video",
    });
    expect(resolvedResponse.status).toBe(200);

    const draftResponse = await systemCommand("commit-draft", {
      admission: systemAdmission,
      evidenceFingerprint: "2".repeat(64),
      expectedGeneration: 1,
      extractionFingerprint: "3".repeat(64),
      intentId: admitted.id,
      mutationId: "4".repeat(64),
      review,
    });
    expect(draftResponse.status).toBe(200);
    const draft = (await draftResponse.json()) as {
      readonly action: { readonly id: string };
      readonly intent: unknown;
    };
    expect(draft).toMatchObject({
      action: { actionVersion: 1, status: "active" },
      intent: { intentVersion: 3, status: "requires_action" },
    });

    const actionResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}/actions/${draft.action.id}`,
      { headers: { cookie } }
    );
    expect(actionResponse.status).toBe(200);
    const action = await Schema.decodeUnknownPromise(RecipeImportAction)(
      await actionResponse.json()
    );

    const confirmResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}/actions/${action.id}/confirm`,
      {
        body: JSON.stringify({ expectedActionVersion: action.actionVersion }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "public-provider-free-confirmation",
        },
        method: "POST",
      }
    );
    expect(confirmResponse.status).toBe(200);
    const confirmed = await Schema.decodeUnknownPromise(RecipeImportIntent)(
      await confirmResponse.json()
    );
    expect(confirmed).toMatchObject({
      intentVersion: 5,
      result: { recipeId: expect.any(String) },
      status: "succeeded",
    });
    if (confirmed.status !== "succeeded") {
      throw new Error("Expected a succeeded import.");
    }

    const recipeResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipes/${confirmed.result.recipeId}`,
      { headers: { cookie } }
    );
    expect(recipeResponse.status).toBe(200);
    const published = await Schema.decodeUnknownPromise(Recipe)(
      await recipeResponse.json()
    );
    expect(published.recipe.name).toBe("Public household tracer stew");

    const timelineResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}/timeline`,
      { headers: { cookie } }
    );
    expect(timelineResponse.status).toBe(200);
    const timeline = await Schema.decodeUnknownPromise(RecipeImportTimeline)(
      await timelineResponse.json()
    );
    expect(timeline.data.map(({ type }) => type)).toEqual([
      "intent_admitted",
      "source_resolved",
      "action_available",
      "processing_stage_changed",
      "intent_succeeded",
    ]);

    const mealPlanResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/meal-plans",
      {
        body: JSON.stringify(
          Schema.encodeSync(CreateMealPlanPayload)(createPayload)
        ),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );
    expect(mealPlanResponse.status).toBe(201);
    const mealPlan = await Schema.decodeUnknownPromise(
      HouseholdMealPlanResponse
    )(await mealPlanResponse.json());
    expect(mealPlan).toMatchObject({
      gaps: [],
      meals: [
        {
          slotId: "boundary-dinner",
          sourceRecipe: { importId: admitted.id },
        },
      ],
    });
  }, 30_000);

  it("commits verified R2 acquisition evidence through the private household authority", async () => {
    const cookie = await signUp("Evidence Boundary Member");
    const organization = await createOrganization(
      "Evidence Boundary Household",
      cookie
    );
    const createResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/recipe-import-intents",
      {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@mealplanner/video/7000000000000000100",
          },
        }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "provider-free-evidence-admission",
        },
        method: "POST",
      }
    );
    expect(createResponse.status).toBe(201);
    const admitted = await Schema.decodeUnknownPromise(RecipeImportIntent)(
      await createResponse.json()
    );
    const admission = {
      actor: { _tag: "System", purpose: "recipe_import_lifecycle_commit" },
      organizationId: organization.id,
    } as const;
    const resolvedResponse = await systemCommand("resolve", {
      admission,
      canonicalSourceId: "tiktok:video:7000000000000000100",
      canonicalUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000100",
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "5".repeat(64),
      sourceKind: "video",
    });
    expect(resolvedResponse.status).toBe(200);

    const mediaKey = `imports/${admitted.id}/acquisition/v1/generations/1/original.mp4`;
    const manifestKey = `imports/${admitted.id}/acquisition/v1/generations/1/manifest.json`;
    const commitResponse = await systemCommand("commit-acquisition-evidence", {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "6".repeat(64),
      result: {
        acquiredAt: "2026-08-22T10:00:00.000Z",
        audioStreams: [{ codec: "aac", index: 0 }],
        durationSeconds: 20,
        references: [
          {
            byteLength: 4096,
            deleteAt: "2026-08-29T10:00:00.000Z",
            key: mediaKey,
            kind: "original_media",
            sha256: "7".repeat(64),
          },
          {
            byteLength: 512,
            deleteAt: "2026-08-29T10:00:00.000Z",
            key: manifestKey,
            kind: "acquisition_manifest",
            sha256: "8".repeat(64),
          },
        ],
        videoStreams: [{ codec: "h264", index: 0 }],
      },
    });
    expect(commitResponse.status, await commitResponse.text()).toBe(200);
  }, 30_000);

  it("rejects a forged cross-organization session before private routing", async () => {
    const cookieA = await signUp("Boundary A");
    const cookieB = await signUp("Boundary B");
    const organizationB = await createOrganization("Boundary B Home", cookieB);
    const sessionResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/api/auth/get-session",
      { headers: { cookie: cookieA } }
    );
    const session = await Schema.decodeUnknownPromise(SessionResponse)(
      await sessionResponse.json()
    );
    const authDatabase = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    await authDatabase
      .update(authSchema.session)
      .set({ activeOrganizationId: organizationB.id })
      .where(eq(authSchema.session.id, session.session.id));

    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/recipe-import-intents",
      {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@forged/video/7000000000000000000",
          },
        }),
        headers: {
          "content-type": "application/json",
          cookie: cookieA,
          "idempotency-key": "forged-household-admission",
        },
        method: "POST",
      }
    );
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain(
      organizationB.id
    );
  });
});
