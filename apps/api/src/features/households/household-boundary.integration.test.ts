import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
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
import {
  HouseholdCommitAcquisitionEvidenceResult,
  HouseholdMutateEvidenceStageResult,
  HouseholdObserveEvidenceReferenceResult,
  HouseholdReadEvidenceReferencesResult,
  HouseholdReadEvidenceStageResult,
} from "./evidence/household-evidence.contract.js";
import { HouseholdMetadata } from "./household.contract.js";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const secret = "local-boundary-test-secret-at-least-32-characters";
const temporaryDirectories: string[] = [];
let runtime: Miniflare | undefined;
let persistenceDirectory = "";
let websiteModules: readonly [ModuleDefinition, ...ModuleDefinition[]];
let apiModules: readonly [ModuleDefinition, ...ModuleDefinition[]];
let domainModules: readonly [ModuleDefinition, ...ModuleDefinition[]];
let evidenceEventModules: readonly [ModuleDefinition, ...ModuleDefinition[]];

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

const makeRuntime = () =>
  new Miniflare({
    compatibilityDate,
    compatibilityFlags,
    d1Persist: persistenceDirectory,
    durableObjectsPersist: persistenceDirectory,
    kvPersist: persistenceDirectory,
    r2Persist: persistenceDirectory,
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
      {
        compatibilityDate,
        compatibilityFlags,
        kvNamespaces: ["EVIDENCE_EVENT_RESULTS", "ImportEvidenceEventRoutes"],
        modules: [...evidenceEventModules],
        name: "evidence-consumer",
        queueConsumers: ["evidence-events"],
        queueProducers: {
          EVENTS: { queueName: "evidence-events" },
        },
        r2Buckets: ["ImportEvidenceBucket"],
        serviceBindings: { HouseholdDomainWorker: "household-domain" },
      },
    ],
  });

const restartRuntime = async () => {
  await runtime?.dispose();
  runtime = makeRuntime();
};

beforeAll(async () => {
  const temporaryDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-household-boundary-`
  );
  temporaryDirectories.push(temporaryDirectory);
  persistenceDirectory = `${temporaryDirectory}/runtime-storage`;
  [websiteModules, apiModules, domainModules, evidenceEventModules] =
    await Promise.all([
      bundleFixture(
        "household-website-service.test-fixture.js",
        temporaryDirectory
      ),
      bundleFixture(
        "household-api-service.test-fixture.ts",
        temporaryDirectory
      ),
      bundleFixture(
        "household-domain-service.test-fixture.js",
        temporaryDirectory
      ),
      bundleFixture(
        "household-evidence-event.test-fixture.ts",
        temporaryDirectory
      ),
    ]);
  runtime = makeRuntime();
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
  operation:
    | "commit-acquisition-evidence"
    | "commit-draft"
    | "mutate-evidence-stage"
    | "observe-evidence-reference"
    | "read-evidence-references"
    | "read-evidence-stage"
    | "resolve",
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

const evidenceEventResult = async (
  attemptsRemaining = 80
): Promise<unknown> => {
  const results = await getRuntime().getKVNamespace(
    "EVIDENCE_EVENT_RESULTS",
    "evidence-consumer"
  );
  const value = await results.get("last", "json");
  if (value !== null) {
    return value;
  }
  if (attemptsRemaining === 0) {
    throw new Error("Evidence event was not processed.");
  }
  await delay(25);
  return evidenceEventResult(attemptsRemaining - 1);
};

const sendEvidenceEvent = async (message: object) => {
  const results = await getRuntime().getKVNamespace(
    "EVIDENCE_EVENT_RESULTS",
    "evidence-consumer"
  );
  await results.delete("last");
  const queue = await getRuntime().getQueueProducer(
    "EVENTS",
    "evidence-consumer"
  );
  await queue.send(message);
  return evidenceEventResult();
};

const readEvidenceReferences = async (
  admission: object,
  intentId: string,
  expectedGeneration = 1
) => {
  const response = await systemCommand("read-evidence-references", {
    admission,
    expectedGeneration,
    intentId,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return Schema.decodeUnknownPromise(HouseholdReadEvidenceReferencesResult)(
    await response.json()
  );
};

const evidenceRetentionResult = (input: {
  readonly acquiredAt: Date;
  readonly generation: number;
  readonly intentId: string;
}) => {
  const deleteAt = new Date(input.acquiredAt.getTime() + 604_800_000);
  return {
    acquiredAt: input.acquiredAt.toISOString(),
    audioStreams: [{ codec: "aac", index: 0 }],
    durationSeconds: 20,
    references: [
      {
        byteLength: 4096,
        deleteAt: deleteAt.toISOString(),
        key: `imports/${input.intentId}/acquisition/v1/generations/${input.generation}/original.mp4`,
        kind: "original_media",
        sha256: "7".repeat(64),
      },
      {
        byteLength: 512,
        deleteAt: deleteAt.toISOString(),
        key: `imports/${input.intentId}/acquisition/v1/generations/${input.generation}/manifest.json`,
        kind: "acquisition_manifest",
        sha256: "8".repeat(64),
      },
    ],
    videoStreams: [{ codec: "h264", index: 0 }],
  } as const;
};

const admitResolvedEvidenceImport = async (input: {
  readonly label: string;
  readonly mutationId: string;
  readonly sourceKind?: "carousel" | "video";
  readonly videoId: string;
}) => {
  const cookie = await signUp(input.label);
  const organization = await createOrganization(
    `${input.label} Household`,
    cookie
  );
  const createResponse = await getRuntime().dispatchFetch(
    "https://meal-planner.test/v1/recipe-import-intents",
    {
      body: JSON.stringify({
        source: {
          kind: "tiktok",
          url: `https://www.tiktok.com/@mealplanner/video/${input.videoId}`,
        },
      }),
      headers: {
        "content-type": "application/json",
        cookie,
        "idempotency-key": `evidence-${input.videoId}`,
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
    canonicalSourceId: `tiktok:video:${input.videoId}`,
    canonicalUrl: `https://www.tiktok.com/@mealplanner/video/${input.videoId}`,
    expectedGeneration: 1,
    intentId: admitted.id,
    mutationId: input.mutationId,
    sourceKind: input.sourceKind ?? "video",
  });
  expect(resolvedResponse.status, await resolvedResponse.text()).toBe(200);
  return { admission, admitted, cookie, organization } as const;
};

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

  it("rejects stale evidence without mutation and accepts the corrected generation", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Stale Evidence Member",
      mutationId: "9".repeat(64),
      videoId: "7000000000000000104",
    });
    const acquiredAt = new Date(Date.now() + 60_000);
    const mutationId = "a".repeat(64);
    const staleResponse = await systemCommand("commit-acquisition-evidence", {
      admission,
      expectedGeneration: 2,
      intentId: admitted.id,
      mutationId,
      result: evidenceRetentionResult({
        acquiredAt,
        generation: 2,
        intentId: admitted.id,
      }),
    });
    expect(staleResponse.status).toBe(409);

    const correctedResponse = await systemCommand(
      "commit-acquisition-evidence",
      {
        admission,
        expectedGeneration: 1,
        intentId: admitted.id,
        mutationId,
        result: evidenceRetentionResult({
          acquiredAt,
          generation: 1,
          intentId: admitted.id,
        }),
      }
    );
    expect(correctedResponse.status, await correctedResponse.text()).toBe(200);
  }, 30_000);

  it("commits a closed speech result with replay and generation fencing", async () => {
    const { admission, admitted, cookie } = await admitResolvedEvidenceImport({
      label: "Speech Evidence Stage Member",
      mutationId: "1".repeat(64),
      videoId: "7000000000000000130",
    });
    const inputFingerprint = "2".repeat(64);
    const dispatchId = `speech:${admitted.id}:1`;
    const stale = await systemCommand("mutate-evidence-stage", {
      admission,
      expectedGeneration: 2,
      inputFingerprint,
      intentId: admitted.id,
      mutationId: "3".repeat(64),
      operation: {
        _tag: "Claim",
        dispatchId,
        stage: "speech",
        startedAt: new Date().toISOString(),
      },
    });
    expect(stale.status).toBe(409);
    const claim = await systemCommand("mutate-evidence-stage", {
      admission,
      expectedGeneration: 1,
      inputFingerprint,
      intentId: admitted.id,
      mutationId: "4".repeat(64),
      operation: {
        _tag: "Claim",
        dispatchId,
        stage: "speech",
        startedAt: new Date().toISOString(),
      },
    });
    expect(claim.status, await claim.text()).toBe(200);

    const completedAt = new Date();
    const deleteAt = new Date(completedAt.getTime() + 604_800_000);
    const transcriptKey = `imports/${admitted.id}/transcription/v1/generations/1/transcript.json`;
    const command = {
      admission,
      expectedGeneration: 1,
      inputFingerprint,
      intentId: admitted.id,
      mutationId: "5".repeat(64),
      operation: {
        _tag: "Complete",
        dispatchId,
        reference: {
          byteLength: 512,
          deleteAt: deleteAt.toISOString(),
          key: transcriptKey,
          kind: "speech_transcript",
          sha256: "6".repeat(64),
        },
        result: {
          _tag: "Speech",
          completedAt: completedAt.toISOString(),
          cost: {
            certainty: "known",
            currency: "USD",
            estimatedMicroUsd: 12,
          },
          detectedLanguage: "en",
          dispatchId,
          model: "provider-model",
          provider: "workers-ai",
          segmentsCount: 4,
          sourceMediaSha256: inputFingerprint,
          transcriptKey,
          transcriptSha256: "6".repeat(64),
          usage: { audioDurationMilliseconds: 20_000, inputBytes: 1024 },
        },
        stage: "speech",
      },
    } as const;
    const staleDispatchId = `speech:${admitted.id}:stale`;
    const mismatched = await systemCommand("mutate-evidence-stage", {
      ...command,
      mutationId: "7".repeat(64),
      operation: {
        ...command.operation,
        dispatchId: staleDispatchId,
        result: { ...command.operation.result, dispatchId: staleDispatchId },
      },
    });
    expect(mismatched.status).toBe(409);

    const completed = await systemCommand("mutate-evidence-stage", command);
    expect(completed.status, await completed.clone().text()).toBe(200);
    const receipt = await Schema.decodeUnknownPromise(
      HouseholdMutateEvidenceStageResult
    )(await completed.json());
    const retry = await systemCommand("mutate-evidence-stage", command);
    expect(retry.status, await retry.clone().text()).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(HouseholdMutateEvidenceStageResult)(
        await retry.json()
      )
    ).toEqual(receipt);
    expect(receipt).not.toHaveProperty("result");
    expect(receipt).not.toHaveProperty("transcriptKey");

    const read = await systemCommand("read-evidence-stage", {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      stage: "speech",
    });
    expect(read.status, await read.clone().text()).toBe(200);
    const stage = await Schema.decodeUnknownPromise(
      HouseholdReadEvidenceStageResult
    )(await read.json());
    expect(stage).toMatchObject({
      inputFingerprint,
      outcome: "Completed",
      result: { _tag: "Speech", transcriptKey },
      stage: "speech",
    });

    const cancelled = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}/cancel`,
      {
        body: JSON.stringify({ expectedIntentVersion: 2 }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "complete-receipt-terminal-replay",
        },
        method: "POST",
      }
    );
    expect(cancelled.status, await cancelled.text()).toBe(200);
    const terminalReplay = await systemCommand(
      "mutate-evidence-stage",
      command
    );
    expect(terminalReplay.status, await terminalReplay.clone().text()).toBe(
      200
    );
    expect(
      await Schema.decodeUnknownPromise(HouseholdMutateEvidenceStageResult)(
        await terminalReplay.json()
      )
    ).toEqual(receipt);
    const newTerminalCompletion = await systemCommand("mutate-evidence-stage", {
      ...command,
      mutationId: "f".repeat(64),
    });
    expect(newTerminalCompletion.status).toBe(400);
  }, 30_000);

  it("rejects new stage mutations after cancellation while replaying the committed claim receipt", async () => {
    const { admission, admitted, cookie } = await admitResolvedEvidenceImport({
      label: "Cancelled Evidence Stage Member",
      mutationId: "8".repeat(64),
      videoId: "7000000000000000131",
    });
    const dispatchId = `speech:${admitted.id}:1`;
    const claimCommand = {
      admission,
      expectedGeneration: 1,
      inputFingerprint: "9".repeat(64),
      intentId: admitted.id,
      mutationId: "a".repeat(64),
      operation: {
        _tag: "Claim",
        dispatchId,
        stage: "speech",
        startedAt: new Date().toISOString(),
      },
    } as const;
    const claimed = await systemCommand("mutate-evidence-stage", claimCommand);
    expect(claimed.status, await claimed.clone().text()).toBe(200);
    const claimReceipt = await Schema.decodeUnknownPromise(
      HouseholdMutateEvidenceStageResult
    )(await claimed.json());
    const failureCommand = {
      ...claimCommand,
      mutationId: "c".repeat(64),
      operation: {
        _tag: "Fail",
        completedAt: new Date().toISOString(),
        dispatchId,
        failureCode: "transcription_failed",
        recovery: "retry_later",
        stage: "speech",
      },
    } as const;
    const staleDispatchId = `speech:${admitted.id}:stale`;
    const mismatchedFailure = await systemCommand("mutate-evidence-stage", {
      ...failureCommand,
      mutationId: "d".repeat(64),
      operation: { ...failureCommand.operation, dispatchId: staleDispatchId },
    });
    expect(mismatchedFailure.status).toBe(409);
    const committedFailure = await systemCommand(
      "mutate-evidence-stage",
      failureCommand
    );
    expect(committedFailure.status, await committedFailure.clone().text()).toBe(
      200
    );
    const failureReceipt = await Schema.decodeUnknownPromise(
      HouseholdMutateEvidenceStageResult
    )(await committedFailure.json());

    const cancelled = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}/cancel`,
      {
        body: JSON.stringify({ expectedIntentVersion: 2 }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "cancel-stage-race",
        },
        method: "POST",
      }
    );
    expect(cancelled.status, await cancelled.text()).toBe(200);

    const replay = await systemCommand("mutate-evidence-stage", claimCommand);
    expect(replay.status, await replay.clone().text()).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(HouseholdMutateEvidenceStageResult)(
        await replay.json()
      )
    ).toEqual(claimReceipt);

    const newClaim = await systemCommand("mutate-evidence-stage", {
      ...claimCommand,
      mutationId: "b".repeat(64),
    });
    expect(newClaim.status).toBe(400);
    const failureReplay = await systemCommand(
      "mutate-evidence-stage",
      failureCommand
    );
    expect(failureReplay.status, await failureReplay.clone().text()).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(HouseholdMutateEvidenceStageResult)(
        await failureReplay.json()
      )
    ).toEqual(failureReceipt);
    const terminalFailure = await systemCommand("mutate-evidence-stage", {
      ...failureCommand,
      mutationId: "e".repeat(64),
    });
    expect(terminalFailure.status).toBe(400);
  }, 30_000);

  it("physically isolates household evidence routing", async () => {
    const householdA = await admitResolvedEvidenceImport({
      label: "Evidence Isolation A",
      mutationId: "b".repeat(64),
      videoId: "7000000000000000105",
    });
    const cookieB = await signUp("Evidence Isolation B");
    const organizationB = await createOrganization(
      "Evidence Isolation B Household",
      cookieB
    );
    const result = evidenceRetentionResult({
      acquiredAt: new Date(Date.now() + 60_000),
      generation: 1,
      intentId: householdA.admitted.id,
    });
    const mutationId = "c".repeat(64);
    const crossHouseholdResponse = await systemCommand(
      "commit-acquisition-evidence",
      {
        admission: {
          ...householdA.admission,
          organizationId: organizationB.id,
        },
        expectedGeneration: 1,
        intentId: householdA.admitted.id,
        mutationId,
        result,
      }
    );
    expect(crossHouseholdResponse.status).toBe(404);

    const ownerResponse = await systemCommand("commit-acquisition-evidence", {
      admission: householdA.admission,
      expectedGeneration: 1,
      intentId: householdA.admitted.id,
      mutationId,
      result,
    });
    expect(ownerResponse.status, await ownerResponse.text()).toBe(200);
  }, 30_000);

  it("returns the same private receipt on retry and rejects a conflicting replay without mutation", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Evidence Replay Member",
      mutationId: "d".repeat(64),
      videoId: "7000000000000000106",
    });
    const result = evidenceRetentionResult({
      acquiredAt: new Date(Date.now() + 60_000),
      generation: 1,
      intentId: admitted.id,
    });
    const command = {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "e".repeat(64),
      result,
    } as const;
    const firstResponse = await systemCommand(
      "commit-acquisition-evidence",
      command
    );
    expect(firstResponse.status).toBe(200);
    const firstReceipt = await Schema.decodeUnknownPromise(
      HouseholdCommitAcquisitionEvidenceResult
    )(await firstResponse.json());
    expect(JSON.stringify(firstReceipt)).not.toMatch(
      /imports\/|sha256|deleteAt/u
    );

    const retryResponse = await systemCommand(
      "commit-acquisition-evidence",
      command
    );
    expect(retryResponse.status).toBe(200);
    const retryReceipt = await Schema.decodeUnknownPromise(
      HouseholdCommitAcquisitionEvidenceResult
    )(await retryResponse.json());
    expect(retryReceipt).toEqual(firstReceipt);

    const conflictingResponse = await systemCommand(
      "commit-acquisition-evidence",
      {
        ...command,
        result: {
          ...result,
          references: [
            { ...result.references[0], sha256: "f".repeat(64) },
            result.references[1],
          ],
        },
      }
    );
    expect(conflictingResponse.status).toBe(409);

    const afterConflictResponse = await systemCommand(
      "commit-acquisition-evidence",
      command
    );
    expect(afterConflictResponse.status).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(
        HouseholdCommitAcquisitionEvidenceResult
      )(await afterConflictResponse.json())
    ).toEqual(firstReceipt);
  }, 30_000);

  it("persists household evidence receipts across a real runtime restart", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Evidence Restart Member",
      mutationId: "1".repeat(64),
      videoId: "7000000000000000107",
    });
    const command = {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "2".repeat(64),
      result: evidenceRetentionResult({
        acquiredAt: new Date(Date.now() + 60_000),
        generation: 1,
        intentId: admitted.id,
      }),
    } as const;
    const firstResponse = await systemCommand(
      "commit-acquisition-evidence",
      command
    );
    expect(firstResponse.status).toBe(200);
    const receipt = await Schema.decodeUnknownPromise(
      HouseholdCommitAcquisitionEvidenceResult
    )(await firstResponse.json());

    await restartRuntime();

    const replayResponse = await systemCommand(
      "commit-acquisition-evidence",
      command
    );
    expect(replayResponse.status).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(
        HouseholdCommitAcquisitionEvidenceResult
      )(await replayResponse.json())
    ).toEqual(receipt);
  }, 30_000);

  it("rejects invalid retention without mutation and accepts the corrected deadline", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Evidence Retention Member",
      mutationId: "3".repeat(64),
      videoId: "7000000000000000108",
    });
    const acquiredAt = new Date(Date.now() + 60_000);
    const result = evidenceRetentionResult({
      acquiredAt,
      generation: 1,
      intentId: admitted.id,
    });
    const mutationId = "4".repeat(64);
    const invalidDeleteAt = new Date(
      acquiredAt.getTime() + 604_800_001
    ).toISOString();
    const invalidResponse = await systemCommand("commit-acquisition-evidence", {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId,
      result: {
        ...result,
        references: result.references.map((reference) => ({
          ...reference,
          deleteAt: invalidDeleteAt,
        })),
      },
    });
    expect(invalidResponse.status).toBe(400);

    const correctedResponse = await systemCommand(
      "commit-acquisition-evidence",
      {
        admission,
        expectedGeneration: 1,
        intentId: admitted.id,
        mutationId,
        result,
      }
    );
    expect(correctedResponse.status, await correctedResponse.text()).toBe(200);
  }, 30_000);

  it("records a missing R2 observation without weakening committed integrity metadata", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Missing Evidence Member",
      mutationId: "5".repeat(64),
      videoId: "7000000000000000109",
    });
    const evidence = evidenceRetentionResult({
      acquiredAt: new Date(Date.now() + 60_000),
      generation: 1,
      intentId: admitted.id,
    });
    const committed = await systemCommand("commit-acquisition-evidence", {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "6".repeat(64),
      result: evidence,
    });
    expect(committed.status, await committed.text()).toBe(200);

    const [media] = evidence.references;
    const observed = await systemCommand("observe-evidence-reference", {
      admission,
      availability: "missing",
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "7".repeat(64),
      reference: {
        key: media.key,
        kind: media.kind,
        sha256: media.sha256,
      },
    });
    const observedBody = await observed.text();
    expect(observed.status, observedBody).toBe(200);
    const missingReceipt = await Schema.decodeUnknownPromise(
      HouseholdObserveEvidenceReferenceResult
    )(JSON.parse(observedBody));
    expect(missingReceipt).toMatchObject({
      availability: "missing",
      executionGeneration: 1,
      intentId: admitted.id,
      kind: "original_media",
      observationOrdinal: 1,
    });
    expect(JSON.stringify(missingReceipt)).not.toMatch(
      /imports\/|sha256|deleteAt/u
    );

    const retry = await systemCommand("observe-evidence-reference", {
      admission,
      availability: "missing",
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "7".repeat(64),
      reference: {
        key: media.key,
        kind: media.kind,
        sha256: media.sha256,
      },
    });
    expect(retry.status).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(
        HouseholdObserveEvidenceReferenceResult
      )(await retry.json())
    ).toEqual(missingReceipt);

    const forged = await systemCommand("observe-evidence-reference", {
      admission,
      availability: "missing",
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "8".repeat(64),
      reference: {
        key: media.key,
        kind: media.kind,
        sha256: "9".repeat(64),
      },
    });
    expect(forged.status).toBe(400);

    const lateStaleDeletion = await systemCommand(
      "observe-evidence-reference",
      {
        admission,
        availability: "deleted",
        expectedGeneration: 2,
        intentId: admitted.id,
        mutationId: "9".repeat(64),
        reference: {
          key: media.key,
          kind: media.kind,
          sha256: media.sha256,
        },
      }
    );
    expect(lateStaleDeletion.status).toBe(409);

    const deletion = await systemCommand("observe-evidence-reference", {
      admission,
      availability: "deleted",
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "9".repeat(64),
      reference: {
        key: media.key,
        kind: media.kind,
        sha256: media.sha256,
      },
    });
    expect(deletion.status).toBe(200);
    expect(await deletion.json()).toMatchObject({
      availability: "deleted",
      observationOrdinal: 2,
    });
  }, 30_000);

  it("reconciles authorized R2 lifecycle events into household availability across terminal state and restart", async () => {
    const { admission, admitted, cookie, organization } =
      await admitResolvedEvidenceImport({
        label: "Lifecycle Event Member",
        mutationId: "1".repeat(64),
        videoId: "7000000000000000132",
      });
    const manifestBytes = new TextEncoder().encode(
      JSON.stringify({ proof: "household-r2-event" })
    );
    const manifestShaBuffer = await crypto.subtle.digest(
      "SHA-256",
      manifestBytes
    );
    const manifestSha = Array.from(new Uint8Array(manifestShaBuffer), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    const baseline = evidenceRetentionResult({
      acquiredAt: new Date(Date.now() + 60_000),
      generation: 1,
      intentId: admitted.id,
    });
    const evidence = {
      ...baseline,
      references: [
        baseline.references[0],
        {
          ...baseline.references[1],
          byteLength: manifestBytes.byteLength,
          sha256: manifestSha,
        },
      ],
    } as const;
    const committed = await systemCommand("commit-acquisition-evidence", {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "2".repeat(64),
      result: evidence,
    });
    expect(committed.status, await committed.text()).toBe(200);
    const [, manifest] = evidence.references;

    await expect(
      sendEvidenceEvent({
        _tag: "RegisterImportEvidenceRoute",
        importId: admitted.id,
        organizationId: organization.id,
        routeVersion: 1,
      })
    ).resolves.toEqual({
      _tag: "Accepted",
      value: { _tag: "Registered" },
    });

    const otherCookie = await signUp("Lifecycle Event Other Member");
    const otherOrganization = await createOrganization(
      "Lifecycle Event Other Household",
      otherCookie
    );
    await expect(
      sendEvidenceEvent({
        _tag: "RegisterImportEvidenceRoute",
        importId: admitted.id,
        organizationId: otherOrganization.id,
        routeVersion: 1,
      })
    ).resolves.toEqual({
      _tag: "Accepted",
      value: { _tag: "RouteConflictRejected" },
    });

    await expect(
      sendEvidenceEvent({
        account: "must-not-escape",
        action: "LifecycleDeletion",
        bucket: "must-not-escape",
        eventTime: "2026-08-22T12:00:00.000Z",
        object: {
          key: `imports/${admitted.id}/acquisition/v1/generations/2/manifest.json`,
        },
      })
    ).resolves.toEqual({
      _tag: "Rejected",
      reason: "stale_event",
      retryable: false,
    });
    const beforeDeletion = await readEvidenceReferences(admission, admitted.id);
    expect(
      beforeDeletion?.references.find(
        ({ kind }) => kind === "acquisition_manifest"
      )
    ).toMatchObject({ availability: "available", observationOrdinal: 0 });

    const cancelled = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}/cancel`,
      {
        body: JSON.stringify({ expectedIntentVersion: 2 }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "lifecycle-event-terminal-proof",
        },
        method: "POST",
      }
    );
    expect(cancelled.status, await cancelled.text()).toBe(200);

    const deletionEvent = {
      account: "must-not-escape",
      action: "LifecycleDeletion",
      bucket: "must-not-escape",
      eventTime: "2026-08-22T12:01:00.000Z",
      object: { key: manifest.key },
    } as const;
    await expect(sendEvidenceEvent(deletionEvent)).resolves.toEqual({
      _tag: "Accepted",
      value: { _tag: "Observed", availability: "deleted" },
    });
    let references = await readEvidenceReferences(admission, admitted.id);
    expect(
      references?.references.find(({ kind }) => kind === "acquisition_manifest")
    ).toMatchObject({ availability: "deleted", observationOrdinal: 1 });

    const publicRead = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}`,
      { headers: { cookie } }
    );
    expect(publicRead.status, await publicRead.clone().text()).toBe(200);
    const publicIntent = await Schema.decodeUnknownPromise(RecipeImportIntent)(
      await publicRead.json()
    );
    expect(publicIntent.status).toBe("cancelled");
    expect(JSON.stringify(publicIntent)).not.toMatch(
      /availability|sha256|imports\/|organization/u
    );

    await expect(sendEvidenceEvent(deletionEvent)).resolves.toEqual({
      _tag: "Accepted",
      value: { _tag: "Observed", availability: "deleted" },
    });
    references = await readEvidenceReferences(admission, admitted.id);
    expect(
      references?.references.find(({ kind }) => kind === "acquisition_manifest")
    ).toMatchObject({ availability: "deleted", observationOrdinal: 1 });

    await restartRuntime();
    await expect(sendEvidenceEvent(deletionEvent)).resolves.toEqual({
      _tag: "Accepted",
      value: { _tag: "Observed", availability: "deleted" },
    });
    references = await readEvidenceReferences(admission, admitted.id);
    expect(
      references?.references.find(({ kind }) => kind === "acquisition_manifest")
    ).toMatchObject({ availability: "deleted", observationOrdinal: 1 });

    const bucket = await getRuntime().getR2Bucket(
      "ImportEvidenceBucket",
      "evidence-consumer"
    );
    await bucket.put(manifest.key, manifestBytes, {
      customMetadata: {
        generation: "1",
        importId: admitted.id,
        sha256: "0".repeat(64),
      },
      sha256: manifestShaBuffer,
    });
    await expect(
      sendEvidenceEvent({
        ...deletionEvent,
        action: "PutObject",
        eventTime: "2026-08-22T12:01:30.000Z",
      })
    ).resolves.toEqual({
      _tag: "Rejected",
      reason: "integrity_mismatch",
      retryable: false,
    });
    references = await readEvidenceReferences(admission, admitted.id);
    expect(
      references?.references.find(({ kind }) => kind === "acquisition_manifest")
    ).toMatchObject({ availability: "deleted", observationOrdinal: 1 });

    await bucket.put(manifest.key, manifestBytes, {
      customMetadata: {
        generation: "1",
        importId: admitted.id,
        sha256: manifest.sha256,
      },
      sha256: manifestShaBuffer,
    });
    await expect(
      sendEvidenceEvent({
        ...deletionEvent,
        action: "PutObject",
        eventTime: "2026-08-22T12:02:00.000Z",
      })
    ).resolves.toEqual({
      _tag: "Accepted",
      value: { _tag: "Observed", availability: "available" },
    });
    references = await readEvidenceReferences(admission, admitted.id);
    expect(
      references?.references.find(({ kind }) => kind === "acquisition_manifest")
    ).toMatchObject({ availability: "available", observationOrdinal: 2 });

    await bucket.delete(manifest.key);
    await expect(
      sendEvidenceEvent({
        ...deletionEvent,
        action: "PutObject",
        eventTime: "2026-08-22T12:03:00.000Z",
      })
    ).resolves.toEqual({
      _tag: "Accepted",
      value: { _tag: "Observed", availability: "missing" },
    });
    references = await readEvidenceReferences(admission, admitted.id);
    expect(
      references?.references.find(({ kind }) => kind === "acquisition_manifest")
    ).toMatchObject({ availability: "missing", observationOrdinal: 3 });
  }, 30_000);

  it("reconciles a carousel manifest lifecycle deletion without acquisition evidence", async () => {
    const { admission, admitted, cookie, organization } =
      await admitResolvedEvidenceImport({
        label: "Carousel Lifecycle Event Member",
        mutationId: "a".repeat(64),
        sourceKind: "carousel",
        videoId: "7000000000000000133",
      });
    const inputFingerprint = "b".repeat(64);
    const manifestSha256 = "c".repeat(64);
    const dispatchId = `carousel:${admitted.id}:1`;
    const manifestKey = `imports/${admitted.id}/carousel/v1/generations/1/manifest.json`;
    const startedAt = new Date(Date.now() + 60_000);
    const completedAt = new Date(startedAt.getTime() + 1000);
    const deleteAt = new Date(startedAt.getTime() + 604_800_000);
    const claim = await systemCommand("mutate-evidence-stage", {
      admission,
      expectedGeneration: 1,
      inputFingerprint,
      intentId: admitted.id,
      mutationId: "d".repeat(64),
      operation: {
        _tag: "Claim",
        dispatchId,
        stage: "carousel",
        startedAt: startedAt.toISOString(),
      },
    });
    expect(claim.status, await claim.text()).toBe(200);
    const completion = await systemCommand("mutate-evidence-stage", {
      admission,
      expectedGeneration: 1,
      inputFingerprint,
      intentId: admitted.id,
      mutationId: "e".repeat(64),
      operation: {
        _tag: "Complete",
        dispatchId,
        reference: {
          byteLength: 512,
          deleteAt: deleteAt.toISOString(),
          key: manifestKey,
          kind: "carousel_manifest",
          sha256: manifestSha256,
        },
        result: {
          _tag: "Carousel",
          completedAt: completedAt.toISOString(),
          descriptorFingerprint: inputFingerprint,
          dispatchId,
          imageCount: 3,
          manifestKey,
          manifestSha256,
        },
        stage: "carousel",
      },
    });
    expect(completion.status, await completion.clone().text()).toBe(200);
    const completionReceipt = await Schema.decodeUnknownPromise(
      HouseholdMutateEvidenceStageResult
    )(await completion.json());

    await expect(
      sendEvidenceEvent({
        _tag: "RegisterImportEvidenceRoute",
        importId: admitted.id,
        organizationId: organization.id,
        routeVersion: 1,
      })
    ).resolves.toEqual({
      _tag: "Accepted",
      value: { _tag: "Registered" },
    });
    const cancelled = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}/cancel`,
      {
        body: JSON.stringify({ expectedIntentVersion: 2 }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "carousel-lifecycle-terminal-proof",
        },
        method: "POST",
      }
    );
    expect(cancelled.status, await cancelled.text()).toBe(200);

    const deletionEvent = {
      account: "must-not-escape",
      action: "LifecycleDeletion",
      bucket: "must-not-escape",
      eventTime: "2026-08-22T12:11:00.000Z",
      object: { key: manifestKey },
    } as const;
    await expect(sendEvidenceEvent(deletionEvent)).resolves.toEqual({
      _tag: "Accepted",
      value: { _tag: "Observed", availability: "deleted" },
    });
    const references = await readEvidenceReferences(admission, admitted.id);
    expect(references?.references).toHaveLength(1);
    expect(references).toMatchObject({
      committedAt: completionReceipt.committedAt,
      executionGeneration: 1,
      intentId: admitted.id,
      references: [
        {
          availability: "deleted",
          byteLength: 512,
          key: manifestKey,
          kind: "carousel_manifest",
          observationOrdinal: 1,
          sha256: manifestSha256,
        },
      ],
    });

    await restartRuntime();
    await expect(sendEvidenceEvent(deletionEvent)).resolves.toEqual({
      _tag: "Accepted",
      value: { _tag: "Observed", availability: "deleted" },
    });
    await expect(
      readEvidenceReferences(admission, admitted.id)
    ).resolves.toEqual(references);
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
