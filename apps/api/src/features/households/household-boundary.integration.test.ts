import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import {
  CreateMealPlanPayload,
  DecideMealPlanPayload,
  HouseholdMealPlanResponse,
  SwapMealPlanPayload,
} from "@meal-planner/household-api";
import * as Bundle from "alchemy/Bundle";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";
import type { ModuleDefinition } from "miniflare";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as authSchema from "../auth/auth.database-schema.js";
import { AcquisitionGeneration } from "../imports/import-media.model.js";
import { RecipeDraft } from "../imports/import-recipe-draft.repository.d1.js";
import { ImportId } from "../imports/import.contracts.js";
import {
  importRecipeExtractions,
  recipeImports,
  recipeReviews,
  recipeReviewTransitions,
} from "../imports/import.database-schema.js";
import { HouseholdMetadata } from "./household.contract.js";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const secret = "local-boundary-test-secret-at-least-32-characters";
const recipeAuthorityDriftHeader = "x-test-recipe-authority-drift";
const recipeAuthorityQueryBudgetHeader = "x-test-recipe-authority-query-budget";
const recipeAuthorityQueryStatementsHeader =
  "x-test-recipe-authority-query-statements";
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
    preferredCuisines: ["preferred"],
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
const recipeAuthorityInstant = "2026-08-19T12:00:00.000Z";
const recipeTags = {
  cuisines: ["Irish"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["dinner"],
  totalTimeBand: "under_30_minutes",
} as const;

const recipeCitation = {
  citations: [
    {
      confidence: 1,
      evidenceId: "caption:boundary-authority",
      origin: "creator_provided" as const,
    },
  ],
  origin: "creator_provided" as const,
  state: "supported" as const,
};
const supportedString = (value: string) => ({ ...recipeCitation, value });
const supportedNumber = (value: number) => ({ ...recipeCitation, value });
const supportedList = (values: readonly string[]) => ({
  items: values.map(supportedString),
  state: "supported" as const,
});
const unresolved = (reason: string) => ({
  citations: [] as const,
  origin: "unresolved" as const,
  reason,
  state: "unresolved" as const,
});

const hashOrganizationId = async (organizationId: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(organizationId)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const makeRecipeDraft = (input: {
  readonly extractionFingerprint: string;
  readonly importId: typeof ImportId.Type;
  readonly name: string;
  readonly sourceUrl: string;
}) =>
  Schema.decodeUnknownSync(RecipeDraft)({
    createdAt: recipeAuthorityInstant,
    evidenceFingerprint: input.extractionFingerprint.replaceAll("0", "e"),
    extraction: {
      author: supportedString("Boundary Fixture Cook"),
      category: supportedString("Dinner"),
      cookTimeMinutes: supportedNumber(10),
      cost: {
        certainty: "known",
        currency: "USD",
        estimatedMicroUsd: 0,
      },
      cuisine: supportedString("Irish"),
      description: supportedString("A boundary-owned approved recipe."),
      ingredientLines: supportedList(["1 onion", "2 tomatoes"]),
      instructions: supportedList([
        "Chop the onion.",
        "Simmer for 10 minutes.",
      ]),
      name: supportedString(input.name),
      nutrition: unresolved("Nutrition was not stated."),
      prepTimeMinutes: supportedNumber(5),
      sourceUrl: supportedString(input.sourceUrl),
      supportedClaims: supportedList(["Simmer for 10 minutes."]),
      temperatureCelsius: unresolved("Temperature was not stated."),
      tools: supportedList(["Saucepan"]),
      totalTimeMinutes: supportedNumber(15),
      unresolvedFields: [
        "nutrition",
        "temperature_celsius",
        "ingredient_quantities",
        "ingredient_units",
      ],
      usage: {
        inputEvidenceItems: 1,
        inputTokens: 0,
        latencyMilliseconds: 0,
        modelCalls: 1,
        outputTokens: 0,
      },
      yield: supportedString("2 servings"),
    },
    extractionFingerprint: input.extractionFingerprint,
    extractor: {
      model: "boundary-authority-v1",
      provider: "deterministic_fake",
      version: "schema-1",
    },
    generation: Schema.decodeUnknownSync(AcquisitionGeneration)(1),
    importId: input.importId,
    lifecycle: "needs_review",
    schemaVersion: 1,
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

const applyDomainMigrations = async (database: MiniflareD1Database) => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("../../../migrations", import.meta.url))
  );
  await database
    .prepare(
      `CREATE TABLE d1_migrations (
         id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
         name TEXT NOT NULL UNIQUE,
         applied_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
       )`
    )
    .run();
  await database.batch(
    migrations.flatMap((migration) => [
      ...migration.queries.map((query) => database.prepare(query)),
      database
        .prepare("INSERT INTO d1_migrations (name) VALUES (?)")
        .bind(migration.name),
    ])
  );
};

const seedApprovedRecipeAuthority = async (
  database: MiniflareD1Database,
  organizationId: string,
  seedNumber: number
) => {
  const client = drizzle(database);
  const householdScopeId = await hashOrganizationId(organizationId);
  const approvedRecipes = Array.from({ length: 257 }, (_, index) => {
    const fixtureNumber = seedNumber * 4096 + index;
    const importId = Schema.decodeUnknownSync(ImportId)(
      `30000000-0000-4000-8000-${fixtureNumber.toString(16).padStart(12, "0")}`
    );
    const extractionFingerprint = fixtureNumber.toString(16).padStart(64, "0");
    const sourceUrl = `https://www.tiktok.com/@fixture/video/7530000000000000${fixtureNumber.toString().padStart(5, "0")}`;
    const draft = makeRecipeDraft({
      extractionFingerprint,
      importId,
      name: `Boundary Approved Recipe ${index}`,
      sourceUrl,
    });
    const tags =
      index === 256 ? { ...recipeTags, cuisines: ["preferred"] } : recipeTags;
    const evidence = [
      {
        kind: "original_media",
        referenceId: `imports/${importId}/acquisition/v1/generations/1/original.mp4`,
      },
      {
        kind: "acquisition_manifest",
        referenceId: `imports/${importId}/acquisition/v1/generations/1/manifest.json`,
      },
      {
        kind: "speech_transcript",
        referenceId: `imports/${importId}/transcription/v1/generations/1/transcript.json`,
      },
    ];
    return {
      draft,
      evidence,
      extractionFingerprint,
      importId,
      sourceUrl,
      tags,
    };
  });

  await Promise.all(
    approvedRecipes.map(({ evidence, importId, sourceUrl }) =>
      client.insert(recipeImports).values({
        acquisitionGeneration: 1,
        actorId: "a".repeat(64),
        correlationId: "11111111-1111-4111-8111-111111111111",
        createdAt: recipeAuthorityInstant,
        evidenceReferencesJson: JSON.stringify(evidence),
        executionGeneration: 1,
        householdScopeId,
        id: importId,
        publicActivity: "working",
        publicSourceKind: "video",
        publicSourceUrl: sourceUrl,
        publicStage: "preparing_review",
        publicStageStartedAt: recipeAuthorityInstant,
        publicStatus: "processing",
        resolvedCanonicalSourceId: importId,
        sourceKind: "tiktok",
        status: "transcribed",
        submittedSourceUrl: sourceUrl,
        updatedAt: recipeAuthorityInstant,
      })
    )
  );
  await Promise.all(
    approvedRecipes.map(({ draft, extractionFingerprint, importId }) =>
      client.insert(importRecipeExtractions).values({
        acquisitionGeneration: 1,
        completedAt: recipeAuthorityInstant,
        costCertainty: "known",
        costCurrency: "USD",
        createdAt: recipeAuthorityInstant,
        draftJson: JSON.stringify(Schema.encodeSync(RecipeDraft)(draft)),
        estimatedCostMicroUsd: 0,
        evidenceFingerprint: draft.evidenceFingerprint,
        extractionFingerprint,
        extractorModel: "boundary-authority-v1",
        extractorProvider: "deterministic_fake",
        extractorVersion: "schema-1",
        importId,
        inputEvidenceItems: 1,
        inputTokens: 0,
        isCurrent: 1,
        latencyMilliseconds: 0,
        modelCalls: 1,
        outputTokens: 0,
        state: "needs_review",
        updatedAt: recipeAuthorityInstant,
      })
    )
  );
  await Promise.all(
    approvedRecipes.map(({ extractionFingerprint, tags }) =>
      client.insert(recipeReviews).values({
        createdAt: recipeAuthorityInstant,
        extractionFingerprint,
        lifecycle: "approved",
        tagsJson: JSON.stringify(tags),
        updatedAt: recipeAuthorityInstant,
        version: 1,
      })
    )
  );
  await Promise.all(
    approvedRecipes.map(({ extractionFingerprint }) =>
      client.insert(recipeReviewTransitions).values({
        actorId: "boundary-authority",
        extractionFingerprint,
        fromLifecycle: "needs_review",
        reason: "Approved for production-boundary planning proof.",
        toLifecycle: "approved",
        transitionedAt: recipeAuthorityInstant,
        version: 1,
      })
    )
  );

  return approvedRecipes.map(({ importId }) => importId);
};

const readApprovedRecipeTagsJson = async (
  database: MiniflareD1Database,
  importId: typeof ImportId.Type
) => {
  const [row] = await drizzle(database)
    .select({ tagsJson: recipeReviews.tagsJson })
    .from(recipeReviews)
    .innerJoin(
      importRecipeExtractions,
      eq(
        importRecipeExtractions.extractionFingerprint,
        recipeReviews.extractionFingerprint
      )
    )
    .where(eq(importRecipeExtractions.importId, importId))
    .limit(1);
  return row?.tagsJson;
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
        d1Databases: {
          MealPlannerAuthDatabase: "household-auth-test",
          MealPlannerDatabase: "household-domain-read-test",
        },
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
  await applyDomainMigrations(
    await getRuntime().getD1Database("MealPlannerDatabase", "api")
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
    {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    }
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

describe("household Website-to-Durable-Object boundary", () => {
  it("re-decodes and rejects a malformed clone at the private Worker boundary", async () => {
    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household",
      {
        headers: { "x-test-private-household-malformed": "1" },
      }
    );
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("organization-private-malformed");
    expect(body).not.toContain("unexpectedAuthority");
  });

  it("keeps recipe-authority test controls outside the production API build", async () => {
    const BuildTsconfig = Schema.Struct({
      exclude: Schema.Array(Schema.String),
    });
    const [buildTsconfigText, productionWorker] = await Promise.all([
      readFile(
        fileURLToPath(new URL("../../../tsconfig.build.json", import.meta.url)),
        "utf-8"
      ),
      readFile(
        fileURLToPath(new URL("../../worker.ts", import.meta.url)),
        "utf-8"
      ),
    ]);
    const buildTsconfig = Schema.decodeUnknownSync(
      Schema.fromJsonString(BuildTsconfig)
    )(buildTsconfigText);

    expect(buildTsconfig.exclude).toContain("src/**/*.test-fixture.ts");
    expect(productionWorker).not.toContain(recipeAuthorityDriftHeader);
    expect(productionWorker).not.toContain(recipeAuthorityQueryBudgetHeader);
    expect(productionWorker).not.toContain(
      recipeAuthorityQueryStatementsHeader
    );
    expect(productionWorker).not.toContain(
      "household-api-service.test-fixture"
    );
  });

  it("admits a member before the private worker initializes its household", async () => {
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

  it("creates and reads a household-owned meal plan through the production boundary", async () => {
    const cookie = await signUp("Meal Plan Member");
    await createOrganization("Meal Plan Household", cookie);

    const createResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/meal-plans",
      {
        body: JSON.stringify(
          Schema.encodeSync(CreateMealPlanPayload)(createPayload)
        ),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(createResponse.status).toBe(201);
    const created = await Schema.decodeUnknownPromise(
      HouseholdMealPlanResponse
    )(await createResponse.json());
    expect(created).toMatchObject({
      _tag: "Draft",
      gaps: [{ slotId: "boundary-dinner" }],
      meals: [],
      revision: 0,
    });

    const readResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/meal-plans/${created.draftId}`,
      { headers: { cookie } }
    );
    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toEqual(
      Schema.encodeSync(HouseholdMealPlanResponse)(created)
    );
  });

  it("uses the shared approved-recipe authority across the full create and explicit-swap boundary", async () => {
    const ownerCookie = await signUp("Populated Meal Plan Member");
    const organization = await createOrganization(
      "Populated Meal Plan Household",
      ownerCookie
    );
    const approvedImportIds = await seedApprovedRecipeAuthority(
      await getRuntime().getD1Database("MealPlannerDatabase", "api"),
      organization.id,
      0
    );
    const generatedImportId = approvedImportIds.at(-1);
    const [explicitImportId] = approvedImportIds;
    if (generatedImportId === undefined || explicitImportId === undefined) {
      throw new Error("Expected bounded approved-recipe fixtures.");
    }
    const ownerSessionResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/api/auth/get-session",
      { headers: { cookie: ownerCookie } }
    );
    const ownerSession = await Schema.decodeUnknownPromise(SessionResponse)(
      await ownerSessionResponse.json()
    );

    const createResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/meal-plans",
      {
        body: JSON.stringify(
          Schema.encodeSync(CreateMealPlanPayload)(createPayload)
        ),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
          [recipeAuthorityQueryBudgetHeader]: "observe",
        },
        method: "POST",
      }
    );

    expect(createResponse.status).toBe(201);
    expect(
      createResponse.headers.get(recipeAuthorityQueryStatementsHeader)
    ).toBe("13");
    const created = await Schema.decodeUnknownPromise(
      HouseholdMealPlanResponse
    )(await createResponse.json());
    expect(created).toMatchObject({
      _tag: "Draft",
      gaps: [],
      meals: [
        {
          slotId: "boundary-dinner",
          sourceRecipe: {
            importId: generatedImportId,
            recipe: { name: "Boundary Approved Recipe 256" },
          },
        },
      ],
      revision: 0,
    });

    const swapPayload = Schema.decodeUnknownSync(SwapMealPlanPayload)({
      expectedRevision: 0,
      mutationId: "boundary-explicit-recipe-swap",
      reason: "Use the explicitly selected approved household recipe.",
      replacementImportId: explicitImportId,
      slotId: "boundary-dinner",
    });
    const intruderCookie = await signUp("Populated Meal Plan Intruder");
    const intruderSessionResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/api/auth/get-session",
      { headers: { cookie: intruderCookie } }
    );
    const intruderSession = await Schema.decodeUnknownPromise(SessionResponse)(
      await intruderSessionResponse.json()
    );
    const authDatabase = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    await authDatabase
      .update(authSchema.session)
      .set({ activeOrganizationId: organization.id })
      .where(eq(authSchema.session.id, intruderSession.session.id));

    const forgedSwapResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/meal-plans/${created.draftId}/swaps`,
      {
        body: JSON.stringify(
          Schema.encodeSync(SwapMealPlanPayload)(swapPayload)
        ),
        headers: {
          "content-type": "application/json",
          cookie: intruderCookie,
        },
        method: "POST",
      }
    );
    expect(forgedSwapResponse.status).toBe(401);
    await expect(forgedSwapResponse.json()).resolves.toEqual({
      code: "unauthorized",
      message: "Sign in and select a household to continue.",
      status: 401,
    });

    const unchangedResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/meal-plans/${created.draftId}`,
      { headers: { cookie: ownerCookie } }
    );
    expect(unchangedResponse.status).toBe(200);
    const unchanged = await Schema.decodeUnknownPromise(
      HouseholdMealPlanResponse
    )(await unchangedResponse.json());
    expect(unchanged).toMatchObject({
      _tag: "Draft",
      revision: 0,
    });

    const swapResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/meal-plans/${created.draftId}/swaps`,
      {
        body: JSON.stringify(
          Schema.encodeSync(SwapMealPlanPayload)(swapPayload)
        ),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        method: "POST",
      }
    );
    expect(swapResponse.status).toBe(200);
    const swappedJson = await swapResponse.json();
    expect(swappedJson).not.toHaveProperty("audit.0.actorId");
    expect(JSON.stringify(swappedJson)).not.toContain(ownerSession.user.id);
    const swapped = await Schema.decodeUnknownPromise(
      HouseholdMealPlanResponse
    )(swappedJson);
    expect(swapped).toMatchObject({
      _tag: "Draft",
      audit: [
        {
          fromRecipe: { importId: generatedImportId },
          mutationId: "boundary-explicit-recipe-swap",
          toRecipe: {
            importId: explicitImportId,
            recipe: { name: "Boundary Approved Recipe 0" },
          },
        },
      ],
      gaps: [],
      meals: [
        {
          slotId: "boundary-dinner",
          sourceRecipe: {
            importId: explicitImportId,
            recipe: { name: "Boundary Approved Recipe 0" },
          },
        },
      ],
      revision: 1,
    });

    const decidePayload = Schema.decodeUnknownSync(DecideMealPlanPayload)({
      expectedRevision: 1,
      mutationId: "boundary-approve-plan",
      reason: "The household approved this plan.",
    });
    const approveResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/meal-plans/${created.draftId}/approve`,
      {
        body: JSON.stringify(
          Schema.encodeSync(DecideMealPlanPayload)(decidePayload)
        ),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        method: "POST",
      }
    );
    expect(approveResponse.status).toBe(200);
    const approvedJson = await approveResponse.json();
    expect(approvedJson).not.toHaveProperty("audit.0.actorId");
    expect(approvedJson).not.toHaveProperty("decision.actorId");
    expect(JSON.stringify(approvedJson)).not.toContain(ownerSession.user.id);

    const readResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/meal-plans/${created.draftId}`,
      { headers: { cookie: ownerCookie } }
    );
    expect(readResponse.status).toBe(200);
    const readJson = await readResponse.json();
    expect(readJson).not.toHaveProperty("audit.0.actorId");
    expect(readJson).not.toHaveProperty("decision.actorId");
    expect(JSON.stringify(readJson)).not.toContain(ownerSession.user.id);
  }, 30_000);

  it("uses one coherent catalogue when an older candidate changes after the snapshot", async () => {
    const ownerCookie = await signUp("Snapshot Meal Plan Member");
    const organization = await createOrganization(
      "Snapshot Meal Plan Household",
      ownerCookie
    );
    const database = await getRuntime().getD1Database(
      "MealPlannerDatabase",
      "api"
    );
    const approvedImportIds = await seedApprovedRecipeAuthority(
      database,
      organization.id,
      3
    );
    const [changedOlderImportId] = approvedImportIds;
    const snapshotWinnerImportId = approvedImportIds.at(-1);
    if (
      changedOlderImportId === undefined ||
      snapshotWinnerImportId === undefined
    ) {
      throw new Error("Expected snapshot approved-recipe fixtures.");
    }

    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/meal-plans",
      {
        body: JSON.stringify(
          Schema.encodeSync(CreateMealPlanPayload)(createPayload)
        ),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
          [recipeAuthorityDriftHeader]: "catalogue",
        },
        method: "POST",
      }
    );

    expect(response.status).toBe(201);
    const created = await Schema.decodeUnknownPromise(
      HouseholdMealPlanResponse
    )(await response.json());
    expect(created).toMatchObject({
      _tag: "Draft",
      gaps: [],
      meals: [
        {
          slotId: "boundary-dinner",
          sourceRecipe: { importId: snapshotWinnerImportId },
        },
      ],
    });
    await expect(
      readApprovedRecipeTagsJson(database, changedOlderImportId)
    ).resolves.toContain("preferred");
  }, 30_000);

  it("restarts discovery once after an authority mismatch and uses the refreshed winner", async () => {
    const ownerCookie = await signUp("Retry Meal Plan Member");
    const organization = await createOrganization(
      "Retry Meal Plan Household",
      ownerCookie
    );
    const approvedImportIds = await seedApprovedRecipeAuthority(
      await getRuntime().getD1Database("MealPlannerDatabase", "api"),
      organization.id,
      1
    );
    const [refreshedImportId] = approvedImportIds;
    if (refreshedImportId === undefined) {
      throw new Error("Expected a refreshed approved-recipe winner.");
    }

    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/meal-plans",
      {
        body: JSON.stringify(
          Schema.encodeSync(CreateMealPlanPayload)(createPayload)
        ),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
          [recipeAuthorityDriftHeader]: "once",
          [recipeAuthorityQueryBudgetHeader]: "observe",
        },
        method: "POST",
      }
    );

    expect(response.status).toBe(201);
    expect(response.headers.get(recipeAuthorityQueryStatementsHeader)).toBe(
      "26"
    );
    const created = await Schema.decodeUnknownPromise(
      HouseholdMealPlanResponse
    )(await response.json());
    expect(created).toMatchObject({
      _tag: "Draft",
      gaps: [],
      meals: [
        {
          slotId: "boundary-dinner",
          sourceRecipe: {
            importId: refreshedImportId,
            recipe: { name: "Boundary Approved Recipe 0" },
          },
        },
      ],
    });
  }, 30_000);

  it("fails safely before private-domain creation when authority keeps drifting", async () => {
    const ownerCookie = await signUp("Persistent Drift Meal Plan Member");
    const organization = await createOrganization(
      "Persistent Drift Meal Plan Household",
      ownerCookie
    );
    await seedApprovedRecipeAuthority(
      await getRuntime().getD1Database("MealPlannerDatabase", "api"),
      organization.id,
      2
    );

    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/meal-plans",
      {
        body: JSON.stringify(
          Schema.encodeSync(CreateMealPlanPayload)(createPayload)
        ),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
          [recipeAuthorityDriftHeader]: "always",
          [recipeAuthorityQueryBudgetHeader]: "observe",
        },
        method: "POST",
      }
    );

    expect(response.status).toBe(500);
    expect(response.headers.get(recipeAuthorityQueryStatementsHeader)).toBe(
      "26"
    );
    await expect(response.json()).resolves.toEqual({
      code: "internal_error",
      message: "Household storage is temporarily unavailable.",
      status: 500,
    });
    const readResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/meal-plans/draft-boundary-week",
      { headers: { cookie: ownerCookie } }
    );
    expect(readResponse.status).toBe(404);
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
      "https://meal-planner.test/v1/meal-plans",
      {
        body: JSON.stringify(
          Schema.encodeSync(CreateMealPlanPayload)(createPayload)
        ),
        headers: {
          "content-type": "application/json",
          cookie: cookieA,
        },
        method: "POST",
      }
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized",
      message: "Sign in and select a household to continue.",
      status: 401,
    });

    const readResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/meal-plans/draft-boundary-week",
      { headers: { cookie: cookieB } }
    );
    expect(readResponse.status).toBe(404);
  });
});
