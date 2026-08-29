import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import * as Bundle from "alchemy/Bundle";
import { Effect, Schema } from "effect";
import type { ModuleDefinition } from "miniflare";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ApprovedRecipe,
  projectApprovedRecipe,
} from "../imports/import-recipe-review.js";
import {
  syntheticReplacementRecipeId,
  syntheticMealPlanRequest,
  syntheticPlanningPolicy,
  syntheticRecipeReviews,
} from "../meal-planning/meal-plan.fake.js";
import {
  MealPlan,
  MealPlanPolicy,
  MealPlanRequest,
} from "../meal-planning/meal-plan.js";
import { HouseholdImportWorkflowDispatchView } from "./foundation/import-workflow-admission.contract.js";
import {
  HouseholdManualMealSwapCommand,
  HouseholdMealPlanDecisionCommand,
} from "./household-meal-plan.contract.js";
import { HouseholdObjectLocator } from "./household-object-locator.js";
import {
  HouseholdDomainFailure,
  HouseholdMetadata,
  HouseholdOrganizationId,
} from "./household.contract.js";
import {
  HouseholdAdmitRecipeImportResult,
  HouseholdRecipePage,
} from "./recipe-import/household-recipe-import.contract.js";
import { HouseholdAuthorityServicesLive } from "./shared-kernel/authority-services.live.js";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const recipeImportReview = (
  name: string,
  ingredientLines: readonly string[] = ["1 local ingredient"]
) => ({
  answers: [],
  blockers: { invalidFields: [], unresolvedRequiredFields: [] },
  editableFields: ["name", "ingredient_lines", "instructions", "tags"],
  recipe: {
    author: null,
    category: null,
    cookTimeMinutes: 15,
    cuisine: "Irish",
    description: null,
    ingredientLines,
    ingredientQuantities: null,
    ingredientUnits: null,
    instructions: ["Cook locally."],
    name,
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
});

/* eslint-disable no-use-before-define -- The cumulative tracer is grouped with its person fixture; runtime helpers are initialized before tests execute. */
describe("household person registry on real Durable Object SQLite", () => {
  it("preserves replay, lifecycle, races, restart, and household isolation", async () => {
    const organizationId = "org-person-registry-a";
    const objectName = await objectNameFor(organizationId);
    const actorId = "b".repeat(64);
    const linkageSubject = "c".repeat(64);
    const bootstrapCommand = {
      actorId,
      displayName: "Cillian",
      linkageSubject,
      mutationId: "person-bootstrap-a",
      objectName,
      operation: "bootstrapCreatorPerson",
      organizationId,
    };
    const objectSideDenial = await commandPeople({
      ...bootstrapCommand,
      operation: "bootstrapCreatorPersonAsMember",
    });
    expect(objectSideDenial).toMatchObject({
      error: { _tag: "HouseholdInvalidInput" },
      ok: false,
    });
    const stateAfterDeniedBootstrap = await commandPeople({
      objectName,
      operation: "inspectHouseholdPeopleState",
    });
    expect(stateAfterDeniedBootstrap).toMatchObject({
      ok: true,
      value: { associations: [], audits: [], people: [], receipts: [] },
    });
    const [bootstrap, concurrentReplay] = await Promise.all([
      commandPeople(bootstrapCommand),
      commandPeople(bootstrapCommand),
    ]);
    expect(concurrentReplay).toEqual(bootstrap);
    expect(bootstrap.ok).toBe(true);
    const creator = bootstrap.value as {
      readonly id: string;
      readonly version: number;
    };
    expect(creator).toMatchObject({
      isCurrentAdult: true,
      kind: "adult",
      lifecycle: "active",
      version: 1,
    });

    const collision = await commandPeople({
      ...bootstrapCommand,
      displayName: "Different intent",
    });
    expect(collision).toMatchObject({
      error: { _tag: "HouseholdPersonMutationCollision" },
      ok: false,
    });

    const conflictingBootstrap = await commandPeople({
      ...bootstrapCommand,
      actorId: "d".repeat(64),
      displayName: "Another creator",
      linkageSubject: "e".repeat(64),
      mutationId: "person-bootstrap-b",
    });
    expect(conflictingBootstrap).toMatchObject({
      error: { _tag: "HouseholdCreatorBootstrapConflict" },
      ok: false,
    });

    const dependant = await commandPeople({
      actorId,
      displayName: "Household child",
      kind: "dependant",
      linkageSubject,
      mutationId: "person-create-child",
      objectName,
      operation: "createHouseholdPerson",
      organizationId,
    });
    expect(dependant).toMatchObject({
      ok: true,
      value: { isCurrentAdult: false, kind: "dependant", version: 1 },
    });
    const dependantId = (dependant.value as { readonly id: string }).id;

    const archiveCommand = {
      actorId,
      expectedVersion: 1,
      linkageSubject,
      mutationId: "person-archive-a",
      objectName,
      operation: "archiveHouseholdPerson",
      organizationId,
      personId: dependantId,
    };
    const [archiveFirst, archiveRace] = await Promise.all([
      commandPeople(archiveCommand),
      commandPeople({ ...archiveCommand, mutationId: "person-archive-race" }),
    ]);
    const outcomes = [archiveFirst, archiveRace];
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.ok)).toMatchObject({
      error: { _tag: "HouseholdPersonStaleVersion" },
    });
    const archived = outcomes.find((outcome) => outcome.ok);
    if (archived === undefined) {
      throw new Error("Expected one archive winner.");
    }
    expect(archived.value).toMatchObject({ lifecycle: "archived", version: 2 });
    const successfulArchiveMutation = archiveFirst.ok
      ? "person-archive-a"
      : "person-archive-race";
    const archiveReplay = await commandPeople({
      ...archiveCommand,
      mutationId: successfulArchiveMutation,
    });
    expect(archiveReplay).toEqual(archived);

    const restore = await commandPeople({
      ...archiveCommand,
      expectedVersion: 2,
      mutationId: "person-restore-a",
      operation: "restoreHouseholdPerson",
    });
    expect(restore).toMatchObject({
      ok: true,
      value: { id: dependantId, lifecycle: "active", version: 3 },
    });

    await runtime.dispose();
    runtime = makeRuntime();
    const rosterAfterRestart = await commandPeople({
      actorId,
      includeArchived: true,
      linkageSubject,
      objectName,
      operation: "listHouseholdPeople",
      organizationId,
    });
    expect(rosterAfterRestart).toMatchObject({
      ok: true,
      value: {
        currentPersonId: creator.id,
        people: [
          { id: creator.id, version: 1 },
          { id: dependantId, lifecycle: "active", version: 3 },
        ],
      },
    });
    const persistedPeopleState = await commandPeople({
      objectName,
      operation: "inspectHouseholdPeopleState",
    });
    expect(persistedPeopleState).toMatchObject({
      ok: true,
      value: {
        associations: [
          {
            linkageSubject,
            personId: creator.id,
            singletonKey: "creator",
          },
        ],
        audits: [
          {
            command: "bootstrap_creator",
            nextVersion: 1,
            personId: creator.id,
            sequence: 1,
          },
          {
            command: "create",
            nextVersion: 1,
            personId: dependantId,
            sequence: 2,
          },
          {
            command: "archive",
            nextVersion: 2,
            personId: dependantId,
            sequence: 3,
          },
          {
            command: "restore",
            nextVersion: 3,
            personId: dependantId,
            sequence: 4,
          },
        ],
        people: expect.arrayContaining([
          expect.objectContaining({ personId: creator.id, version: 1 }),
          expect.objectContaining({
            lifecycle: "active",
            personId: dependantId,
            version: 3,
          }),
        ]),
        receipts: expect.arrayContaining([
          { mutationId: "person-bootstrap-a" },
          { mutationId: "person-create-child" },
          { mutationId: successfulArchiveMutation },
          { mutationId: "person-restore-a" },
        ]),
      },
    });
    expect(
      (persistedPeopleState.value as { readonly receipts: readonly unknown[] })
        .receipts
    ).toHaveLength(4);

    const otherOrganizationId = "org-person-registry-b";
    const otherObjectName = await objectNameFor(otherOrganizationId);
    const isolatedRead = await commandPeople({
      actorId,
      linkageSubject,
      objectName: otherObjectName,
      operation: "getHouseholdPerson",
      organizationId: otherOrganizationId,
      personId: dependantId,
    });
    expect(isolatedRead).toMatchObject({
      error: { _tag: "HouseholdPersonNotFound" },
      ok: false,
    });
    const isolatedMutationId = await commandPeople({
      ...bootstrapCommand,
      objectName: otherObjectName,
      organizationId: otherOrganizationId,
    });
    expect(isolatedMutationId).toMatchObject({
      ok: true,
      value: { displayName: "Cillian" },
    });
  }, 30_000);

  it("physically rejects a second creator association in one household database", async () => {
    const organizationId = "org-person-creator-singleton-constraint";
    const objectName = await objectNameFor(organizationId);
    const result = await commandPeople({
      objectName,
      operation: "proveCreatorAssociationSingletonConstraint",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        associations: [
          {
            linkageSubject: "a".repeat(64),
            personId: "person_00000000-0000-4000-8000-000000000001",
            singletonKey: "creator",
          },
        ],
        rejectedSecond: true,
      },
    });
  });
});
/* eslint-enable no-use-before-define */
const MealPlanWire = Schema.toEncoded(MealPlan);
const ApprovedRecipeWire = Schema.toEncoded(ApprovedRecipe);
const ManualMealSwapRequestWire = Schema.toEncoded(
  HouseholdManualMealSwapCommand
);
const MealPlanDecisionRequestWire = Schema.toEncoded(
  HouseholdMealPlanDecisionCommand
);
const fixturePath = fileURLToPath(
  new URL("household-object-host.test-fixture.ts", import.meta.url)
);
const temporaryDirectories: string[] = [];
let runtime: Miniflare;
let fixtureModules: readonly [ModuleDefinition, ...ModuleDefinition[]];
let persistenceDirectory: string;

const HouseholdEnsureResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: HouseholdMetadata,
  }),
  Schema.Struct({
    error: HouseholdDomainFailure,
    ok: Schema.Literal(false),
  }),
]);

const RecipeImportAdmissionResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: HouseholdAdmitRecipeImportResult,
  }),
  Schema.Struct({ error: Schema.Unknown, ok: Schema.Literal(false) }),
]);

const ImportWorkflowDispatchResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.NullOr(HouseholdImportWorkflowDispatchView),
  }),
  Schema.Struct({ error: Schema.Unknown, ok: Schema.Literal(false) }),
]);

const RecipePageResponse = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: HouseholdRecipePage }),
  Schema.Struct({ error: Schema.Unknown, ok: Schema.Literal(false) }),
]);

const MealPlanResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: MealPlanWire,
  }),
  Schema.Struct({
    error: Schema.Unknown,
    ok: Schema.Literal(false),
  }),
]);
type SuccessfulMealPlanResponse = Extract<
  typeof MealPlanResponse.Type,
  { readonly ok: true }
>;
type FailedMealPlanResponse = Extract<
  typeof MealPlanResponse.Type,
  { readonly ok: false }
>;

const MaybeMealPlanResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.NullOr(MealPlanWire),
  }),
  Schema.Struct({
    error: Schema.Unknown,
    ok: Schema.Literal(false),
  }),
]);

const MealPlanStorageResponse = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.NullOr(
    Schema.Struct({
      planJsonBytes: Schema.Number,
      replayKeyBytes: Schema.Number,
    })
  ),
});

const bundleText = (content: string | Uint8Array<ArrayBufferLike>): string =>
  Schema.is(Schema.String)(content)
    ? content
    : new TextDecoder().decode(content);

const buildFixture = async (
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
        input: fixturePath,
        plugins: [
          cloudflareRolldown({
            compatibilityDate,
            compatibilityFlags,
          }),
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

const makeRuntime = () =>
  new Miniflare({
    compatibilityDate,
    compatibilityFlags,
    durableObjects: {
      BrokenMigrationObject: {
        className: "BrokenMigrationObject",
        useSQLite: true,
      },
      HouseholdObject: {
        className: "HouseholdObject",
        useSQLite: true,
      },
    },
    durableObjectsPersist: persistenceDirectory,
    modules: [...fixtureModules],
  });

beforeAll(async () => {
  const temporaryDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-household-object-`
  );
  temporaryDirectories.push(temporaryDirectory);
  persistenceDirectory = `${temporaryDirectory}/durable-object-storage`;
  fixtureModules = await buildFixture(temporaryDirectory);
  runtime = makeRuntime();
}, 30_000);

afterAll(async () => {
  await runtime.dispose();
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

const objectNameFor = (organizationId: string) =>
  Effect.runPromise(
    Effect.gen(function* locateTestHousehold() {
      const locator = yield* HouseholdObjectLocator;
      return yield* locator.locate(
        Schema.decodeUnknownSync(HouseholdOrganizationId)(organizationId)
      );
    }).pipe(
      Effect.provide(HouseholdObjectLocator.layer),
      Effect.provide(HouseholdAuthorityServicesLive)
    )
  );

const admitRecipeImport = async (input: {
  readonly idempotencyKey: string;
  readonly objectName: string;
  readonly organizationId: string;
  readonly sourceUrl: string;
}) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      idempotencyKey: input.idempotencyKey,
      objectName: input.objectName,
      operation: "admitRecipeImport",
      organizationId: input.organizationId,
      source: { kind: "tiktok", url: input.sourceUrl },
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(RecipeImportAdmissionResponse)(
    await response.json()
  );
};

const inspectImportWorkflowDispatch = async (
  objectName: string,
  dispatchId: string
) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      dispatchId,
      objectName,
      operation: "inspectImportWorkflowDispatch",
    }),
    method: "POST",
  });
  return Schema.decodeUnknownPromise(ImportWorkflowDispatchResponse)(
    await response.json()
  );
};

const corruptImportWorkflowDispatchState = async (input: {
  readonly dispatchId: string;
  readonly objectName: string;
  readonly state: string;
}) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      ...input,
      operation: "corruptImportWorkflowDispatchState",
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return response.json();
};

const corruptHouseholdProvenanceCreatedAt = async (input: {
  readonly createdAtEpochMs: number;
  readonly objectName: string;
}) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      ...input,
      operation: "corruptHouseholdProvenanceCreatedAt",
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return response.json();
};

const recordRecipeImportDispatch = async (input: {
  readonly dispatchId: string;
  readonly objectName: string;
  readonly organizationId: string;
  readonly outcome: "prepared" | "started" | "unavailable";
  readonly workflowIdentity: string;
}) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      ...input,
      operation: "recordRecipeImportDispatch",
      originalTrace: {
        correlationId: "00000000-0000-4000-8000-000000000188",
      },
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(ImportWorkflowDispatchResponse)(
    await response.json()
  );
};

const commandHousehold = async (objectName: string, organizationId: string) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      objectName,
      operation: "ensure",
      organizationId,
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(HouseholdEnsureResponse)(
    await response.json()
  );
};

const ensureHousehold = (objectName: string, organizationId: string) =>
  commandHousehold(objectName, organizationId);

const commandPeople = async (command: Record<string, unknown>) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify(command),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    readonly error?: { readonly _tag?: string };
    readonly ok: boolean;
    readonly value?: unknown;
  };
};

const approvedRecipes = syntheticRecipeReviews
  .filter(({ lifecycle }) => lifecycle === "approved")
  .map(projectApprovedRecipe)
  .map((recipe) => Schema.encodeSync(ApprovedRecipe)(recipe));

const makeLargeApprovedRecipe = (input: {
  readonly character: string;
  readonly importId: string;
  readonly ingredientLineCount: number;
  readonly recipeNameLength?: number;
}) => {
  const base = approvedRecipes.at(0);
  if (base === undefined) {
    throw new Error("Expected an approved recipe fixture.");
  }
  return Schema.decodeUnknownSync(ApprovedRecipeWire)({
    ...base,
    extractionFingerprint: input.character.repeat(64),
    importId: input.importId,
    recipe: {
      ...base.recipe,
      ingredientLines: Array.from({ length: input.ingredientLineCount }, () =>
        input.character.repeat(4096)
      ),
      name:
        input.recipeNameLength === undefined
          ? base.recipe.name
          : input.character.repeat(input.recipeNameLength),
    },
    source: {
      ...base.source,
      evidenceFingerprint: input.character.repeat(64),
    },
  });
};

const makeMaximumSlotRequest = (requestKey: string) =>
  Schema.decodeUnknownSync(MealPlanRequest)({
    requestKey,
    slots: Array.from({ length: 31 }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      mealType: "dinner",
      servings: 2,
      slotId: `large-dinner-${index + 1}`,
    })),
  });

const makeSingleDinnerRequest = (requestKey: string) =>
  Schema.decodeUnknownSync(MealPlanRequest)({
    requestKey,
    slots: [
      {
        date: "2026-08-01",
        mealType: "dinner",
        servings: 2,
        slotId: "large-audit-dinner",
      },
    ],
  });

const makeRepeatedRecipePolicy = () =>
  Schema.decodeUnknownSync(MealPlanPolicy)({
    ...syntheticPlanningPolicy,
    maxRecipeUses: 31,
  });

const makeFingerprintHeavyPolicy = (version: string) =>
  Schema.decodeUnknownSync(MealPlanPolicy)({
    ...syntheticPlanningPolicy,
    preferredCuisines: ["f".repeat(1_037_000)],
    version,
  });

const jsonByteLength = (value: object): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const createMealPlan = async (
  objectName: string,
  organizationId: string,
  input: {
    readonly approvedRecipes?: typeof approvedRecipes;
    readonly policy?: typeof syntheticPlanningPolicy;
    readonly request?: typeof syntheticMealPlanRequest;
  } = {}
) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      approvedRecipes: input.approvedRecipes ?? approvedRecipes,
      objectName,
      operation: "createMealPlan",
      organizationId,
      policy: Schema.encodeSync(MealPlanPolicy)(
        input.policy ?? syntheticPlanningPolicy
      ),
      request: Schema.encodeSync(MealPlanRequest)(
        input.request ?? syntheticMealPlanRequest
      ),
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(MealPlanResponse)(await response.json());
};

const mutateMealPlan = async (input: {
  readonly approvedRecipes?: typeof approvedRecipes;
  readonly objectName: string;
  readonly operation: "approveMealPlan" | "rejectMealPlan" | "swapMealPlan";
  readonly organizationId: string;
  readonly request:
    | typeof ManualMealSwapRequestWire.Type
    | typeof MealPlanDecisionRequestWire.Type;
}) => {
  const command = {
    objectName: input.objectName,
    operation: input.operation,
    organizationId: input.organizationId,
    request: input.request,
  };
  const body =
    input.operation === "swapMealPlan"
      ? {
          ...command,
          approvedRecipes: input.approvedRecipes ?? approvedRecipes,
        }
      : command;
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify(body),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(MealPlanResponse)(await response.json());
};

const failureTag = (response: typeof MealPlanResponse.Type): string => {
  if (response.ok) {
    throw new Error("Expected meal-plan command to fail.");
  }
  return Schema.decodeUnknownSync(Schema.Struct({ _tag: Schema.String }))(
    response.error
  )._tag;
};

const readMealPlan = async (
  objectName: string,
  organizationId: string,
  draftId: string
) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      draftId,
      objectName,
      operation: "readMealPlan",
      organizationId,
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(MealPlanResponse)(await response.json());
};

const readMaybeMealPlan = async (
  objectName: string,
  organizationId: string,
  draftId: string
) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      draftId,
      objectName,
      operation: "readMealPlan",
      organizationId,
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(MaybeMealPlanResponse)(
    await response.json()
  );
};

const inspectMealPlanStorage = async (objectName: string, draftId: string) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      draftId,
      objectName,
      operation: "inspectMealPlanStorage",
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(MealPlanStorageResponse)(
    await response.json()
  );
};

describe("household Durable Object", () => {
  it("owns the provider-free admission-to-confirmation-to-planning tracer", async () => {
    const organizationId = "organization-recipe-import-tracer";
    const objectName = await objectNameFor(organizationId);
    const dispatch = async (command: object) => {
      const response = await runtime.dispatchFetch("http://localhost/", {
        body: JSON.stringify({ objectName, organizationId, ...command }),
        method: "POST",
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<{
        readonly error?: { readonly _tag?: string; readonly reason?: string };
        readonly ok: boolean;
        readonly value?: unknown;
      }>;
    };

    const admitted = await dispatch({
      idempotencyKey: "tracer-admission",
      operation: "admitRecipeImport",
      source: {
        kind: "tiktok",
        url: "https://www.tiktok.com/@mealplanner/video/7000000000000000001",
      },
    });
    expect(admitted, JSON.stringify(admitted)).toMatchObject({
      ok: true,
      value: {
        intent: { intentVersion: 1, status: "processing" },
        workflowIdentity: expect.stringMatching(
          /^import-acquisition:v1:[a-f\d]{64}$/u
        ),
      },
    });
    const admission = admitted.value as {
      readonly intent: { readonly id: string };
    };

    const resolved = await dispatch({
      canonicalSourceId: "tiktok:video:7000000000000000001",
      canonicalUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000001",
      expectedGeneration: 1,
      intentId: admission.intent.id,
      mutationId: "1".repeat(64),
      operation: "resolveRecipeImportSource",
      sourceKind: "video",
    });
    expect(resolved).toMatchObject({
      ok: true,
      value: { intentVersion: 2, status: "processing" },
    });

    const draft = await dispatch({
      evidenceFingerprint: "2".repeat(64),
      expectedGeneration: 1,
      extractionFingerprint: "3".repeat(64),
      intentId: admission.intent.id,
      mutationId: "4".repeat(64),
      operation: "commitRecipeImportDraft",
      review: {
        answers: [],
        blockers: { invalidFields: [], unresolvedRequiredFields: [] },
        editableFields: ["name", "ingredient_lines", "instructions", "tags"],
        recipe: {
          author: null,
          category: null,
          cookTimeMinutes: 15,
          cuisine: "Irish",
          description: "Provider-free household tracer.",
          ingredientLines: ["1 local ingredient"],
          ingredientQuantities: null,
          ingredientUnits: null,
          instructions: ["Cook locally."],
          name: "Household tracer stew",
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
      },
    });
    expect(draft).toMatchObject({
      ok: true,
      value: {
        action: { actionVersion: 1, status: "active" },
        intent: { intentVersion: 3, status: "requires_action" },
      },
    });
    const active = draft.value as {
      readonly action: { readonly id: string };
      readonly intent: { readonly intentVersion: number };
    };

    const confirmed = await dispatch({
      actionId: active.action.id,
      expectedActionVersion: 1,
      idempotencyKey: "tracer-confirmation",
      intentId: admission.intent.id,
      operation: "confirmRecipeImportAction",
    });
    expect(confirmed).toMatchObject({
      ok: true,
      value: {
        result: { recipeId: expect.any(String) },
        status: "succeeded",
      },
    });

    const planned = await dispatch({
      operation: "createMealPlanFromRecipeBank",
      policy: Schema.encodeSync(MealPlanPolicy)(syntheticPlanningPolicy),
      request: Schema.encodeSync(MealPlanRequest)(syntheticMealPlanRequest),
    });
    expect(planned).toMatchObject({
      ok: true,
      value: { meals: expect.arrayContaining([expect.any(Object)]) },
    });

    await runtime.dispose();
    runtime = makeRuntime();
    expect(
      await dispatch({
        actionId: active.action.id,
        expectedActionVersion: 1,
        idempotencyKey: "tracer-confirmation",
        intentId: admission.intent.id,
        operation: "confirmRecipeImportAction",
      })
    ).toEqual(confirmed);
  });

  it("persists generation-fenced executor lifecycle transitions and replay across restart", async () => {
    const organizationId = "organization-recipe-import-lifecycle";
    const objectName = await objectNameFor(organizationId);
    const dispatch = async (command: object) => {
      const response = await runtime.dispatchFetch("http://localhost/", {
        body: JSON.stringify({ objectName, organizationId, ...command }),
        method: "POST",
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<{
        readonly error?: { readonly reason?: string };
        readonly ok: boolean;
        readonly value?: unknown;
      }>;
    };
    const admitted = await dispatch({
      idempotencyKey: "lifecycle-admission",
      operation: "admitRecipeImport",
      source: {
        kind: "tiktok",
        url: "https://www.tiktok.com/@mealplanner/video/7000000000000000201",
      },
    });
    const intentId = (
      admitted.value as { readonly intent: { readonly id: string } }
    ).intent.id;
    await dispatch({
      canonicalSourceId: "tiktok:video:7000000000000000201",
      canonicalUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000201",
      expectedGeneration: 1,
      intentId,
      mutationId: "8".repeat(64),
      operation: "resolveRecipeImportSource",
      sourceKind: "carousel",
    });

    const transition = (value: object, expectedGeneration = 1) =>
      dispatch({
        expectedGeneration,
        intentId,
        operation: "transitionRecipeImportLifecycle",
        transition: value,
      });
    expect(
      await transition({ _tag: "AdvanceStage", stage: "analyzing_evidence" })
    ).toMatchObject({
      ok: true,
      value: {
        intentVersion: 3,
        processing: {
          speech: "not_started",
          type: "analyzing_evidence",
          visuals: "not_started",
        },
      },
    });
    await transition({
      _tag: "AdvanceComponent",
      component: "speech",
      progress: "processing",
    });
    await transition({
      _tag: "AdvanceComponent",
      component: "speech",
      progress: "completed",
    });
    await transition({
      _tag: "AdvanceComponent",
      component: "visuals",
      progress: "skipped",
    });
    expect(
      await transition({ _tag: "AdvanceStage", stage: "extracting_recipe" })
    ).toMatchObject({
      ok: true,
      value: {
        intentVersion: 7,
        processing: { type: "extracting_recipe" },
      },
    });
    const retrying = await transition({
      _tag: "SetActivity",
      activity: "retrying",
      attempt: 2,
      boundary: "recipe",
    });
    expect(retrying).toMatchObject({
      ok: true,
      value: { activity: { type: "retrying" }, intentVersion: 8 },
    });
    expect(
      await transition({
        _tag: "SetActivity",
        activity: "retrying",
        attempt: 2,
        boundary: "recipe",
      })
    ).toEqual(retrying);
    expect(
      await transition({ _tag: "AdvanceStage", stage: "grounding_recipe" }, 2)
    ).toMatchObject({ error: { reason: "generation_conflict" }, ok: false });

    await runtime.dispose();
    runtime = makeRuntime();
    expect(
      await dispatch({ intentId, operation: "readRecipeImport" })
    ).toMatchObject({
      ok: true,
      value: { activity: { type: "retrying" }, intentVersion: 8 },
    });
  });

  it("paginates and plans from more than 128 approved household recipes across restart", async () => {
    const organizationId = "organization-recipe-bank-pagination";
    const objectName = await objectNameFor(organizationId);
    await ensureHousehold(objectName, organizationId);
    const seedResponse = await runtime.dispatchFetch("http://localhost/", {
      body: JSON.stringify({
        count: 129,
        objectName,
        operation: "seedApprovedRecipes",
      }),
      method: "POST",
    });
    expect(await seedResponse.json()).toEqual({ ok: true });

    const listPage = async (cursor: string | null) => {
      const response = await runtime.dispatchFetch("http://localhost/", {
        body: JSON.stringify({
          byteLimit: 1_048_576,
          cursor,
          limit: 100,
          objectName,
          operation: "listRecipeBank",
          organizationId,
        }),
        method: "POST",
      });
      expect(response.status).toBe(200);
      return Schema.decodeUnknownPromise(RecipePageResponse)(
        await response.json()
      );
    };

    const first = await listPage(null);
    expect(first).toMatchObject({
      ok: true,
      value: { items: { length: 100 } },
    });
    if (!first.ok || first.value.nextCursor === null) {
      throw new Error("Expected a bounded first Recipe Bank page.");
    }

    await runtime.dispose();
    runtime = makeRuntime();
    const second = await listPage(first.value.nextCursor);
    expect(second).toMatchObject({
      ok: true,
      value: { items: { length: 29 }, nextCursor: null },
    });

    const plannedResponse = await runtime.dispatchFetch("http://localhost/", {
      body: JSON.stringify({
        objectName,
        operation: "createMealPlanFromRecipeBank",
        organizationId,
        policy: Schema.encodeSync(MealPlanPolicy)(syntheticPlanningPolicy),
        request: Schema.encodeSync(MealPlanRequest)(syntheticMealPlanRequest),
      }),
      method: "POST",
    });
    expect(
      await Schema.decodeUnknownPromise(MealPlanResponse)(
        await plannedResponse.json()
      )
    ).toMatchObject({
      ok: true,
      value: { meals: expect.arrayContaining([expect.any(Object)]) },
    });
  });

  it("releases terminal canonical-source ownership across restart", async () => {
    const organizationId = "organization-terminal-source-release";
    const objectName = await objectNameFor(organizationId);
    const dispatch = async (command: object) => {
      const response = await runtime.dispatchFetch("http://localhost/", {
        body: JSON.stringify({ objectName, organizationId, ...command }),
        method: "POST",
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<{
        readonly error?: { readonly reason?: string };
        readonly ok: boolean;
        readonly value?: unknown;
      }>;
    };
    const admit = async (key: string, videoId: string) => {
      const result = await dispatch({
        idempotencyKey: key,
        operation: "admitRecipeImport",
        source: {
          kind: "tiktok",
          url: `https://www.tiktok.com/@mealplanner/video/${videoId}`,
        },
      });
      return (result.value as { readonly intent: { readonly id: string } })
        .intent.id;
    };
    const canonicalSourceId = "tiktok:video:7000000000000000300";
    const canonicalUrl =
      "https://www.tiktok.com/@mealplanner/video/7000000000000000300";
    const firstIntentId = await admit(
      "terminal-source-first",
      "7000000000000000301"
    );
    const redirectedIntentId = await admit(
      "terminal-source-redirected",
      "7000000000000000302"
    );
    const initial = await Promise.all(
      [firstIntentId, redirectedIntentId].map((intentId, index) =>
        dispatch({
          canonicalSourceId,
          canonicalUrl,
          expectedGeneration: 1,
          intentId,
          mutationId: `${index + 1}`.repeat(64),
          operation: "resolveRecipeImportSource",
          sourceKind: "video",
        })
      )
    );
    const liveOwner = initial.find(
      ({ value }) =>
        (value as { readonly status?: string } | undefined)?.status ===
        "processing"
    );
    expect(
      initial.map(
        ({ value }) =>
          (value as { readonly status?: string } | undefined)?.status
      )
    ).toEqual(expect.arrayContaining(["processing", "redirected"]));
    if (liveOwner === undefined) {
      throw new Error("Expected a live canonical-source owner.");
    }
    const liveOwnerIntent = liveOwner.value as {
      readonly id: string;
      readonly intentVersion: number;
    };
    expect(
      await dispatch({
        expectedIntentVersion: liveOwnerIntent.intentVersion,
        idempotencyKey: "terminal-source-cancel",
        intentId: liveOwnerIntent.id,
        operation: "cancelRecipeImport",
      })
    ).toMatchObject({ ok: true, value: { status: "cancelled" } });

    await runtime.dispose();
    runtime = makeRuntime();
    const afterCancellationId = await admit(
      "terminal-source-after-cancel",
      "7000000000000000303"
    );
    expect(
      await dispatch({
        canonicalSourceId,
        canonicalUrl,
        expectedGeneration: 1,
        intentId: afterCancellationId,
        mutationId: "a".repeat(64),
        operation: "resolveRecipeImportSource",
        sourceKind: "video",
      })
    ).toMatchObject({ ok: true, value: { status: "processing" } });
    expect(
      await dispatch({
        expectedGeneration: 1,
        intentId: afterCancellationId,
        operation: "transitionRecipeImportLifecycle",
        transition: {
          _tag: "Fail",
          attemptIdentity: "terminal-source-after-cancel:acquisition:1",
          boundary: "acquisition",
          code: "source_unavailable",
          message: "The source became unavailable.",
          recovery: "create_new_intent",
        },
      })
    ).toMatchObject({ ok: true, value: { status: "failed" } });

    await runtime.dispose();
    runtime = makeRuntime();
    const afterFailureId = await admit(
      "terminal-source-after-failure",
      "7000000000000000304"
    );
    expect(
      await dispatch({
        canonicalSourceId,
        canonicalUrl,
        expectedGeneration: 1,
        intentId: afterFailureId,
        mutationId: "b".repeat(64),
        operation: "resolveRecipeImportSource",
        sourceKind: "video",
      })
    ).toMatchObject({ ok: true, value: { status: "processing" } });
  });

  it("rejects an oversized correction and keeps the largest bounded recipe usable across restart", async () => {
    const organizationId = "organization-recipe-bank-byte-bound";
    const objectName = await objectNameFor(organizationId);
    const dispatch = async (command: object) => {
      const response = await runtime.dispatchFetch("http://localhost/", {
        body: JSON.stringify({ objectName, organizationId, ...command }),
        method: "POST",
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<{
        readonly error?: { readonly reason?: string };
        readonly ok: boolean;
        readonly value?: unknown;
      }>;
    };
    const prepareReview = async (key: string, videoId: string) => {
      const admitted = await dispatch({
        idempotencyKey: `${key}-admit`,
        operation: "admitRecipeImport",
        source: {
          kind: "tiktok",
          url: `https://www.tiktok.com/@mealplanner/video/${videoId}`,
        },
      });
      const intentId = (
        admitted.value as { readonly intent: { readonly id: string } }
      ).intent.id;
      await dispatch({
        canonicalSourceId: `tiktok:video:${videoId}`,
        canonicalUrl: `https://www.tiktok.com/@mealplanner/video/${videoId}`,
        expectedGeneration: 1,
        intentId,
        mutationId: key.at(0)?.repeat(64),
        operation: "resolveRecipeImportSource",
        sourceKind: "video",
      });
      const draft = await dispatch({
        evidenceFingerprint: "c".repeat(64),
        expectedGeneration: 1,
        extractionFingerprint: "d".repeat(64),
        intentId,
        mutationId: key.at(-1)?.repeat(64),
        operation: "commitRecipeImportDraft",
        review: recipeImportReview(`${key} recipe`),
      });
      return {
        actionId: (draft.value as { readonly action: { readonly id: string } })
          .action.id,
        intentId,
      };
    };

    const oversized = await prepareReview("ef", "7000000000000000401");
    const oversizedAnswer = await dispatch({
      actionId: oversized.actionId,
      answers: [
        {
          field: "ingredient_lines",
          value: Array.from({ length: 132 }, () => "x".repeat(4000)),
        },
      ],
      expectedActionVersion: 1,
      idempotencyKey: "oversized-correction",
      intentId: oversized.intentId,
      operation: "answerRecipeImportAction",
    });
    expect(
      oversizedAnswer,
      JSON.stringify(oversizedAnswer.error)
    ).toMatchObject({ ok: true });
    expect(
      await dispatch({
        actionId: oversized.actionId,
        expectedActionVersion: 2,
        idempotencyKey: "oversized-confirmation",
        intentId: oversized.intentId,
        operation: "confirmRecipeImportAction",
      })
    ).toMatchObject({ error: { reason: "invalid_input" }, ok: false });

    const bounded = await prepareReview("ab", "7000000000000000402");
    const boundedIngredientLines = Array.from({ length: 124 }, () =>
      "y".repeat(4000)
    );
    expect(
      await dispatch({
        actionId: bounded.actionId,
        answers: [{ field: "ingredient_lines", value: boundedIngredientLines }],
        expectedActionVersion: 1,
        idempotencyKey: "bounded-correction",
        intentId: bounded.intentId,
        operation: "answerRecipeImportAction",
      })
    ).toMatchObject({ ok: true });
    expect(
      await dispatch({
        actionId: bounded.actionId,
        expectedActionVersion: 2,
        idempotencyKey: "bounded-confirmation",
        intentId: bounded.intentId,
        operation: "confirmRecipeImportAction",
      })
    ).toMatchObject({ ok: true, value: { status: "succeeded" } });

    await runtime.dispose();
    runtime = makeRuntime();
    const listed: unknown[] = [];
    let cursor: string | null = null;
    do {
      // eslint-disable-next-line no-await-in-loop -- Each bounded page depends on the preceding exclusive cursor.
      const page = await dispatch({
        byteLimit: 524_288,
        cursor,
        limit: 100,
        objectName,
        operation: "listRecipeBank",
      });
      expect(page.ok, JSON.stringify(page.error)).toBe(true);
      const value = page.value as {
        readonly items: readonly unknown[];
        readonly nextCursor: string | null;
      };
      listed.push(...value.items);
      cursor = value.nextCursor;
    } while (cursor !== null);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      recipe: { ingredientLines: { length: boundedIngredientLines.length } },
    });
    expect(
      await dispatch({
        operation: "createMealPlanFromRecipeBank",
        policy: Schema.encodeSync(MealPlanPolicy)(syntheticPlanningPolicy),
        request: Schema.encodeSync(MealPlanRequest)(syntheticMealPlanRequest),
      })
    ).toMatchObject({
      ok: true,
      value: { meals: expect.arrayContaining([expect.any(Object)]) },
    });
  });

  it("settles deduplication, stale fences, cancel-confirm races, and mutation collisions across restart", async () => {
    const organizationId = "organization-recipe-import-races";
    const objectName = await objectNameFor(organizationId);
    const dispatch = async (command: object) => {
      const response = await runtime.dispatchFetch("http://localhost/", {
        body: JSON.stringify({ objectName, organizationId, ...command }),
        method: "POST",
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<{
        readonly error?: { readonly reason?: string };
        readonly ok: boolean;
        readonly value?: unknown;
      }>;
    };
    const admit = (key: string, videoId: string) =>
      dispatch({
        idempotencyKey: key,
        operation: "admitRecipeImport",
        source: {
          kind: "tiktok",
          url: `https://www.tiktok.com/@mealplanner/video/${videoId}`,
        },
      });
    const first = await admit("dedup-first", "7000000000000000101");
    const second = await admit("dedup-second", "7000000000000000102");
    const firstIntentId = (
      first.value as { readonly intent: { readonly id: string } }
    ).intent.id;
    const secondIntentId = (
      second.value as { readonly intent: { readonly id: string } }
    ).intent.id;
    expect(
      await dispatch({
        idempotencyKey: "dedup-first",
        operation: "admitRecipeImport",
        source: {
          kind: "tiktok",
          url: "https://www.tiktok.com/@mealplanner/video/7999999999999999999",
        },
      })
    ).toMatchObject({
      error: { reason: "idempotency_conflict" },
      ok: false,
    });

    const canonicalSourceId = "tiktok:video:7000000000000000199";
    const resolutions = await Promise.all(
      [firstIntentId, secondIntentId].map((intentId, index) =>
        dispatch({
          canonicalSourceId,
          canonicalUrl:
            "https://www.tiktok.com/@mealplanner/video/7000000000000000199",
          expectedGeneration: 1,
          intentId,
          mutationId: `${index + 1}`.repeat(64),
          operation: "resolveRecipeImportSource",
          sourceKind: "video",
        })
      )
    );
    expect(
      resolutions.map((result) =>
        result.ok
          ? (result.value as { readonly status: string }).status
          : result.error?.reason
      )
    ).toEqual(expect.arrayContaining(["processing", "redirected"]));
    const winner = resolutions.find(
      (result) =>
        result.ok &&
        (result.value as { readonly status: string }).status === "processing"
    );
    if (winner === undefined) {
      throw new Error("Expected one canonical source winner.");
    }
    const winnerIntentId = (winner.value as { readonly id: string }).id;
    expect(
      await dispatch({
        evidenceFingerprint: "3".repeat(64),
        expectedGeneration: 2,
        extractionFingerprint: "4".repeat(64),
        intentId: winnerIntentId,
        mutationId: "5".repeat(64),
        operation: "commitRecipeImportDraft",
        review: {
          answers: [],
          blockers: { invalidFields: [], unresolvedRequiredFields: [] },
          editableFields: ["name", "ingredient_lines", "instructions", "tags"],
          recipe: {
            author: null,
            category: null,
            cookTimeMinutes: 15,
            cuisine: "Irish",
            description: null,
            ingredientLines: ["1 race-safe ingredient"],
            ingredientQuantities: null,
            ingredientUnits: null,
            instructions: ["Cook safely."],
            name: "Race-safe stew",
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
        },
      })
    ).toMatchObject({ error: { reason: "generation_conflict" }, ok: false });

    const seedCollision = await runtime.dispatchFetch("http://localhost/", {
      body: JSON.stringify({
        count: 1,
        objectName,
        operation: "seedApprovedRecipes",
      }),
      method: "POST",
    });
    expect(await seedCollision.json()).toEqual({ ok: true });
    const rollbackDraft = await dispatch({
      evidenceFingerprint: "a".repeat(64),
      expectedGeneration: 1,
      extractionFingerprint: "b".repeat(64),
      intentId: winnerIntentId,
      mutationId: "c".repeat(64),
      operation: "commitRecipeImportDraft",
      review: {
        answers: [],
        blockers: { invalidFields: [], unresolvedRequiredFields: [] },
        editableFields: ["name", "ingredient_lines", "instructions", "tags"],
        recipe: {
          author: null,
          category: null,
          cookTimeMinutes: 15,
          cuisine: "Irish",
          description: null,
          ingredientLines: ["1 rollback ingredient"],
          ingredientQuantities: null,
          ingredientUnits: null,
          instructions: ["Commit atomically."],
          name: "Rollback stew",
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
      },
    });
    const rollbackActionId = (
      rollbackDraft.value as { readonly action: { readonly id: string } }
    ).action.id;
    expect(
      await dispatch({
        actionId: rollbackActionId,
        expectedActionVersion: 1,
        idempotencyKey: "forced-precommit-failure",
        intentId: winnerIntentId,
        operation: "confirmRecipeImportActionWithRecipeId",
        recipeId: "10000000-0000-4000-8000-000000000001",
      })
    ).toMatchObject({
      error: { reason: "persistence_unavailable" },
      ok: false,
    });
    expect(
      await dispatch({
        intentId: winnerIntentId,
        operation: "readRecipeImport",
      })
    ).toMatchObject({ ok: true, value: { status: "requires_action" } });
    expect(
      await dispatch({
        actionId: rollbackActionId,
        expectedActionVersion: 1,
        idempotencyKey: "post-rollback-confirm",
        intentId: winnerIntentId,
        operation: "confirmRecipeImportAction",
      })
    ).toMatchObject({ ok: true, value: { status: "succeeded" } });

    const raceImport = await admit("terminal-race", "7000000000000000103");
    const raceIntentId = (
      raceImport.value as { readonly intent: { readonly id: string } }
    ).intent.id;
    await dispatch({
      canonicalSourceId: "tiktok:video:7000000000000000103",
      canonicalUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000103",
      expectedGeneration: 1,
      intentId: raceIntentId,
      mutationId: "6".repeat(64),
      operation: "resolveRecipeImportSource",
      sourceKind: "video",
    });
    const draft = await dispatch({
      evidenceFingerprint: "7".repeat(64),
      expectedGeneration: 1,
      extractionFingerprint: "8".repeat(64),
      intentId: raceIntentId,
      mutationId: "9".repeat(64),
      operation: "commitRecipeImportDraft",
      review: {
        answers: [],
        blockers: { invalidFields: [], unresolvedRequiredFields: [] },
        editableFields: ["name", "ingredient_lines", "instructions", "tags"],
        recipe: {
          author: null,
          category: null,
          cookTimeMinutes: 15,
          cuisine: "Irish",
          description: null,
          ingredientLines: ["1 local ingredient"],
          ingredientQuantities: null,
          ingredientUnits: null,
          instructions: ["Cook locally."],
          name: "Terminal race stew",
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
      },
    });
    const actionId = (
      draft.value as { readonly action: { readonly id: string } }
    ).action.id;
    expect(
      await dispatch({
        actionId,
        expectedActionVersion: 2,
        idempotencyKey: "stale-confirm",
        intentId: raceIntentId,
        operation: "confirmRecipeImportAction",
      })
    ).toMatchObject({ error: { reason: "version_conflict" }, ok: false });

    const [cancelled, confirmed] = await Promise.all([
      dispatch({
        expectedIntentVersion: 3,
        idempotencyKey: "race-cancel",
        intentId: raceIntentId,
        operation: "cancelRecipeImport",
      }),
      dispatch({
        actionId,
        expectedActionVersion: 1,
        idempotencyKey: "race-confirm",
        intentId: raceIntentId,
        operation: "confirmRecipeImportAction",
      }),
    ]);
    expect([cancelled, confirmed].filter(({ ok }) => ok)).toHaveLength(1);
    const terminal = cancelled.ok ? cancelled : confirmed;
    const terminalStatus = (terminal.value as { readonly status: string })
      .status;

    await runtime.dispose();
    runtime = makeRuntime();
    const persisted = await dispatch({
      intentId: raceIntentId,
      operation: "readRecipeImport",
    });
    expect(persisted).toMatchObject({
      ok: true,
      value: { status: terminalStatus },
    });
    const collision = cancelled.ok
      ? await dispatch({
          expectedIntentVersion: 2,
          idempotencyKey: "race-cancel",
          intentId: raceIntentId,
          operation: "cancelRecipeImport",
        })
      : await dispatch({
          actionId,
          expectedActionVersion: 2,
          idempotencyKey: "race-confirm",
          intentId: raceIntentId,
          operation: "confirmRecipeImportAction",
        });
    expect(collision).toMatchObject({
      error: { reason: "idempotency_conflict" },
      ok: false,
    });
  });

  it("initializes once and rejects a conflicting organization provenance", async () => {
    const objectName = await objectNameFor("organization-a");
    const initial = await ensureHousehold(objectName, "organization-a");
    const replay = await ensureHousehold(objectName, "organization-a");

    expect(initial).toMatchObject({ ok: true });
    if (!initial.ok) {
      throw new Error("Expected household initialization to succeed.");
    }
    if (!Schema.is(HouseholdMetadata)(initial.value)) {
      throw new Error("Expected household metadata from initialization.");
    }
    expect(initial.value).toEqual({
      createdAtEpochMs: expect.any(Number),
      organizationId: "organization-a",
    });
    expect(replay).toEqual(initial);

    const mismatch = await ensureHousehold(objectName, "organization-b");
    expect(mismatch).toMatchObject({ ok: false });
    if (mismatch.ok) {
      throw new Error("Expected conflicting household provenance to fail.");
    }
    expect(mismatch.error).toEqual({ _tag: "HouseholdProvenanceMismatch" });
    expect(JSON.stringify(mismatch.error)).not.toContain("organization-");
  });

  it("re-decodes and rejects a malformed internal command at the object boundary", async () => {
    const objectName = await objectNameFor("organization-malformed-object");
    const response = await runtime.dispatchFetch("http://localhost/", {
      body: JSON.stringify({
        objectName,
        operation: "invokeMalformedEnsure",
        payload: {
          admission: {
            actor: { _tag: "Member", actorId: "a".repeat(64) },
            organizationId: "organization-malformed-object",
          },
          unexpectedAuthority: true,
        },
      }),
      method: "POST",
    });
    await expect(response.json()).resolves.toEqual({
      error: { _tag: "HouseholdInvalidInput" },
      ok: false,
    });
  });

  it("rejects corrupt persisted household provenance metadata", async () => {
    const organizationId = "organization-corrupt-provenance";
    const objectName = await objectNameFor(organizationId);
    expect(await ensureHousehold(objectName, organizationId)).toMatchObject({
      ok: true,
    });

    await corruptHouseholdProvenanceCreatedAt({
      createdAtEpochMs: -1,
      objectName,
    });

    expect(await ensureHousehold(objectName, organizationId)).toEqual({
      error: { _tag: "HouseholdPersistenceFailure", operation: "read" },
      ok: false,
    });
  });

  it("fails closed and repeatably when a per-object migration cannot apply", async () => {
    const probe = async () => {
      const response = await runtime.dispatchFetch("http://localhost/", {
        body: JSON.stringify({
          objectName: "broken-migration-proof",
          operation: "probeMigrationFailure",
        }),
        method: "POST",
      });
      return response.json();
    };

    expect(await probe()).toMatchObject({ ok: false });
    expect(await probe()).toMatchObject({ ok: false });
  });

  it("keeps a committed import admission final across dispatch exhaustion, replay, and restart", async () => {
    const organizationId = "organization-workflow-admission";
    const objectName = await objectNameFor(organizationId);
    const initialInput = {
      idempotencyKey: "workflow-admission-restart-proof",
      objectName,
      organizationId,
      sourceUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000101",
    } as const;

    const committed = await admitRecipeImport(initialInput);
    if (!committed.ok) {
      throw new Error(
        `Expected recipe import admission to commit: ${JSON.stringify(committed.error)}`
      );
    }
    expect(committed.value.workflowIdentity).toMatch(
      /^import-acquisition:v1:[a-f\d]{64}$/u
    );
    expect(committed.value.workflowIdentity).not.toContain(
      committed.value.intent.id
    );
    expect(JSON.stringify(committed.value)).not.toContain(organizationId);

    const replay = await admitRecipeImport(initialInput);
    expect(replay).toEqual(committed);

    const pending = await inspectImportWorkflowDispatch(
      objectName,
      committed.value.dispatchId
    );
    expect(pending).toEqual({
      ok: true,
      value: {
        admission: expect.objectContaining({
          dispatchId: committed.value.dispatchId,
          workflowIdentity: committed.value.workflowIdentity,
        }),
        attempts: 0,
        exhaustedAtEpochMs: null,
        state: "pending",
      },
    });

    const unavailableAttempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordRecipeImportDispatch({
          dispatchId: committed.value.dispatchId,
          objectName,
          organizationId,
          outcome: "unavailable",
          workflowIdentity: committed.value.workflowIdentity,
        })
      )
    );
    for (const unavailable of unavailableAttempts) {
      expect(unavailable).toMatchObject({ ok: true });
    }
    const exhausted = await inspectImportWorkflowDispatch(
      objectName,
      committed.value.dispatchId
    );
    expect(exhausted).toMatchObject({
      ok: true,
      value: {
        admission: expect.objectContaining({
          dispatchId: committed.value.dispatchId,
          workflowIdentity: committed.value.workflowIdentity,
        }),
        attempts: 5,
        state: "exhausted",
      },
    });

    await runtime.dispose();
    runtime = makeRuntime();
    expect(await admitRecipeImport(initialInput)).toEqual(committed);
    expect(
      await inspectImportWorkflowDispatch(
        objectName,
        committed.value.dispatchId
      )
    ).toMatchObject({
      ok: true,
      value: { attempts: 5, state: "exhausted" },
    });

    const nextImport = await admitRecipeImport({
      ...initialInput,
      idempotencyKey: "workflow-admission-next-import-proof",
      sourceUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000102",
    });
    expect(nextImport).toMatchObject({ ok: true });
    if (!nextImport.ok) {
      throw new Error("Expected a new recipe import to commit.");
    }
    expect(nextImport.value.workflowIdentity).not.toBe(
      committed.value.workflowIdentity
    );
  });

  it("rejects corrupt persisted outbox projections at the repository boundary", async () => {
    const organizationId = "organization-workflow-corrupt-outbox";
    const objectName = await objectNameFor(organizationId);
    const committed = await admitRecipeImport({
      idempotencyKey: "corrupt-outbox-projection-proof",
      objectName,
      organizationId,
      sourceUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000103",
    });
    if (!committed.ok) {
      throw new Error("Expected corrupt outbox fixture admission to commit.");
    }

    await corruptImportWorkflowDispatchState({
      dispatchId: committed.value.dispatchId,
      objectName,
      state: "caller-invented-state",
    });

    expect(
      await inspectImportWorkflowDispatch(
        objectName,
        committed.value.dispatchId
      )
    ).toMatchObject({
      error: { _tag: "HouseholdWorkflowAdmissionPersistenceFailure" },
      ok: false,
    });
  });

  it("creates and reads a meal plan after a runtime restart", async () => {
    const objectName = await objectNameFor("organization-meal-plan");
    const created = await createMealPlan(objectName, "organization-meal-plan");
    if (!created.ok) {
      throw new Error(
        `Expected the household object to create a meal plan: ${JSON.stringify(created.error)}`
      );
    }
    expect(created).toMatchObject({ ok: true });

    await runtime.dispose();
    runtime = makeRuntime();

    const persisted = await readMealPlan(
      objectName,
      "organization-meal-plan",
      created.value.draftId
    );
    expect(persisted).toEqual(created);
  });

  it("rejects an oversized encoded plan without leaving a partial draft", async () => {
    const objectName = await objectNameFor("organization-oversized-create");
    const organizationId = "organization-oversized-create";
    const request = makeMaximumSlotRequest("oversized-create");
    const created = await createMealPlan(objectName, organizationId, {
      approvedRecipes: [
        makeLargeApprovedRecipe({
          character: "x",
          importId: "018f47ad-91aa-7c35-b6fe-000000000501",
          ingredientLineCount: 16,
        }),
      ],
      policy: makeRepeatedRecipePolicy(),
      request,
    });

    expect(created).toMatchObject({
      error: { _tag: "MealPlanPersistenceFailure", operation: "create" },
      ok: false,
    });
    expect(
      await readMaybeMealPlan(
        objectName,
        organizationId,
        `draft-${request.requestKey}`
      )
    ).toEqual({ ok: true, value: null });
  });

  it("rejects a draft that cannot reserve a terminal decision", async () => {
    const objectName = await objectNameFor("organization-terminal-headroom");
    const organizationId = "organization-terminal-headroom";
    const request = makeMaximumSlotRequest("terminal-headroom");
    const created = await createMealPlan(objectName, organizationId, {
      approvedRecipes: [
        makeLargeApprovedRecipe({
          character: "h",
          importId: "018f47ad-91aa-7c35-b6fe-000000000505",
          ingredientLineCount: 14,
          recipeNameLength: 2500,
        }),
      ],
      policy: makeRepeatedRecipePolicy(),
      request,
    });

    if (created.ok) {
      expect(jsonByteLength(created.value)).toBeGreaterThan(1_867_232);
      expect(jsonByteLength(created.value)).toBeLessThanOrEqual(1_900_000);
    }
    expect(created).toMatchObject({
      error: { _tag: "MealPlanPersistenceFailure", operation: "create" },
      ok: false,
    });
    expect(
      await readMaybeMealPlan(
        objectName,
        organizationId,
        `draft-${request.requestKey}`
      )
    ).toEqual({ ok: true, value: null });
  });

  it("persists a valid encoded plan near the conservative size limit", async () => {
    const objectName = await objectNameFor("organization-near-limit-create");
    const organizationId = "organization-near-limit-create";
    const request = makeMaximumSlotRequest("near-limit-create");
    const created = await createMealPlan(objectName, organizationId, {
      approvedRecipes: [
        makeLargeApprovedRecipe({
          character: "n",
          importId: "018f47ad-91aa-7c35-b6fe-000000000502",
          ingredientLineCount: 14,
        }),
      ],
      policy: makeRepeatedRecipePolicy(),
      request,
    });
    if (!created.ok) {
      throw new Error(
        `Expected the near-limit meal plan to persist: ${JSON.stringify(created.error)}`
      );
    }

    expect(jsonByteLength(created.value)).toBeGreaterThan(1_700_000);
    expect(
      await readMealPlan(
        objectName,
        organizationId,
        `draft-${request.requestKey}`
      )
    ).toEqual(created);
  });

  it("keeps every accepted near-limit draft terminalizable", async () => {
    const approvalObjectName = await objectNameFor(
      "organization-near-limit-approval"
    );
    const approvalOrganizationId = "organization-near-limit-approval";
    const approvalRequest = makeMaximumSlotRequest("near-limit-approval");
    const rejectionObjectName = await objectNameFor(
      "organization-near-limit-rejection"
    );
    const rejectionOrganizationId = "organization-near-limit-rejection";
    const rejectionRequest = makeMaximumSlotRequest("near-limit-rejection");
    const nearLimitRecipe = makeLargeApprovedRecipe({
      character: "t",
      importId: "018f47ad-91aa-7c35-b6fe-000000000506",
      ingredientLineCount: 14,
      recipeNameLength: 1700,
    });
    const [approvalCreated, rejectionCreated] = await Promise.all([
      createMealPlan(approvalObjectName, approvalOrganizationId, {
        approvedRecipes: [nearLimitRecipe],
        policy: makeRepeatedRecipePolicy(),
        request: approvalRequest,
      }),
      createMealPlan(rejectionObjectName, rejectionOrganizationId, {
        approvedRecipes: [nearLimitRecipe],
        policy: makeRepeatedRecipePolicy(),
        request: rejectionRequest,
      }),
    ]);
    if (!approvalCreated.ok || !rejectionCreated.ok) {
      throw new Error("Expected both near-limit drafts to persist.");
    }
    expect(jsonByteLength(approvalCreated.value)).toBeGreaterThan(1_860_000);
    expect(jsonByteLength(approvalCreated.value)).toBeLessThanOrEqual(
      1_867_232
    );
    expect(jsonByteLength(rejectionCreated.value)).toBeGreaterThan(1_860_000);
    expect(jsonByteLength(rejectionCreated.value)).toBeLessThanOrEqual(
      1_867_232
    );

    const maximumEscapedReason = "\u0001".repeat(4096);
    const [approved, rejected] = await Promise.all([
      mutateMealPlan({
        objectName: approvalObjectName,
        operation: "approveMealPlan",
        organizationId: approvalOrganizationId,
        request: Schema.decodeUnknownSync(MealPlanDecisionRequestWire)({
          draftId: approvalCreated.value.draftId,
          expectedRevision: approvalCreated.value.revision,
          mutationId: "p".repeat(128),
          reason: maximumEscapedReason,
        }),
      }),
      mutateMealPlan({
        objectName: rejectionObjectName,
        operation: "rejectMealPlan",
        organizationId: rejectionOrganizationId,
        request: Schema.decodeUnknownSync(MealPlanDecisionRequestWire)({
          draftId: rejectionCreated.value.draftId,
          expectedRevision: rejectionCreated.value.revision,
          mutationId: "r".repeat(128),
          reason: maximumEscapedReason,
        }),
      }),
    ]);

    expect(approved).toMatchObject({
      ok: true,
      value: { _tag: "Approved" },
    });
    expect(rejected).toMatchObject({
      ok: true,
      value: { _tag: "Rejected" },
    });
    if (!approved.ok || !rejected.ok) {
      throw new Error(
        "Expected both near-limit terminal decisions to persist."
      );
    }
    expect(jsonByteLength(approved.value)).toBeLessThanOrEqual(1_900_000);
    expect(jsonByteLength(rejected.value)).toBeLessThanOrEqual(1_900_000);
    expect(
      await readMealPlan(
        approvalObjectName,
        approvalOrganizationId,
        approvalCreated.value.draftId
      )
    ).toEqual(approved);
    expect(
      await readMealPlan(
        rejectionObjectName,
        rejectionOrganizationId,
        rejectionCreated.value.draftId
      )
    ).toEqual(rejected);
  }, 20_000);

  it("keeps fingerprint-heavy drafts replayable and terminalizable", async () => {
    const approvalObjectName = await objectNameFor(
      "organization-fingerprint-heavy-approval"
    );
    const approvalOrganizationId = "organization-fingerprint-heavy-approval";
    const approvalRequest = Schema.decodeUnknownSync(MealPlanRequest)({
      ...Schema.encodeSync(MealPlanRequest)(syntheticMealPlanRequest),
      requestKey: "fingerprint-heavy-approval",
    });
    const rejectionObjectName = await objectNameFor(
      "organization-fingerprint-heavy-rejection"
    );
    const rejectionOrganizationId = "organization-fingerprint-heavy-rejection";
    const rejectionRequest = Schema.decodeUnknownSync(MealPlanRequest)({
      ...Schema.encodeSync(MealPlanRequest)(syntheticMealPlanRequest),
      requestKey: "fingerprint-heavy-rejection",
    });
    const policy = makeFingerprintHeavyPolicy("fingerprint-heavy-v1");
    const [approvalCreated, rejectionCreated] = await Promise.all([
      createMealPlan(approvalObjectName, approvalOrganizationId, {
        policy,
        request: approvalRequest,
      }),
      createMealPlan(rejectionObjectName, rejectionOrganizationId, {
        policy,
        request: rejectionRequest,
      }),
    ]);
    if (!approvalCreated.ok || !rejectionCreated.ok) {
      throw new Error(
        `Expected both fingerprint-heavy drafts to persist: ${JSON.stringify({ approvalCreated, rejectionCreated })}`
      );
    }
    expect(jsonByteLength(approvalCreated.value)).toBeGreaterThan(1_000_000);
    expect(jsonByteLength(approvalCreated.value)).toBeLessThanOrEqual(
      1_867_232
    );

    await runtime.dispose();
    runtime = makeRuntime();
    const replay = await createMealPlan(
      approvalObjectName,
      approvalOrganizationId,
      { policy, request: approvalRequest }
    );
    expect(replay).toEqual(approvalCreated);
    const collision = await createMealPlan(
      approvalObjectName,
      approvalOrganizationId,
      {
        policy: makeFingerprintHeavyPolicy("fingerprint-heavy-v2"),
        request: approvalRequest,
      }
    );
    expect(failureTag(collision)).toBe("MealPlanRequestConflict");

    const maximumEscapedReason = "\u0001".repeat(4096);
    const [approved, rejected] = await Promise.all([
      mutateMealPlan({
        objectName: approvalObjectName,
        operation: "approveMealPlan",
        organizationId: approvalOrganizationId,
        request: Schema.decodeUnknownSync(MealPlanDecisionRequestWire)({
          draftId: approvalCreated.value.draftId,
          expectedRevision: approvalCreated.value.revision,
          mutationId: "p".repeat(128),
          reason: maximumEscapedReason,
        }),
      }),
      mutateMealPlan({
        objectName: rejectionObjectName,
        operation: "rejectMealPlan",
        organizationId: rejectionOrganizationId,
        request: Schema.decodeUnknownSync(MealPlanDecisionRequestWire)({
          draftId: rejectionCreated.value.draftId,
          expectedRevision: rejectionCreated.value.revision,
          mutationId: "r".repeat(128),
          reason: maximumEscapedReason,
        }),
      }),
    ]);

    expect(approved).toMatchObject({
      ok: true,
      value: { _tag: "Approved" },
    });
    expect(rejected).toMatchObject({
      ok: true,
      value: { _tag: "Rejected" },
    });
    const [approvalStorage, rejectionStorage] = await Promise.all([
      inspectMealPlanStorage(approvalObjectName, approvalCreated.value.draftId),
      inspectMealPlanStorage(
        rejectionObjectName,
        rejectionCreated.value.draftId
      ),
    ]);
    if (approvalStorage.value === null || rejectionStorage.value === null) {
      throw new Error("Expected both persisted meal-plan rows.");
    }
    expect(approvalStorage.value.replayKeyBytes).toBe(64);
    expect(rejectionStorage.value.replayKeyBytes).toBe(64);
    expect(
      approvalStorage.value.planJsonBytes + approvalStorage.value.replayKeyBytes
    ).toBeLessThanOrEqual(1_900_000);
    expect(
      rejectionStorage.value.planJsonBytes +
        rejectionStorage.value.replayKeyBytes
    ).toBeLessThanOrEqual(1_900_000);
  }, 20_000);

  it("keeps swap-grown drafts terminalizable after rejecting an oversized mutation", async () => {
    const largeRecipes = [
      makeLargeApprovedRecipe({
        character: "a",
        importId: "018f47ad-91aa-7c35-b6fe-000000000503",
        ingredientLineCount: 16,
      }),
      makeLargeApprovedRecipe({
        character: "b",
        importId: "018f47ad-91aa-7c35-b6fe-000000000504",
        ingredientLineCount: 16,
      }),
    ];
    const growUntilRejected = async (input: {
      readonly objectName: string;
      readonly organizationId: string;
      readonly requestKey: string;
    }) => {
      const created = await createMealPlan(
        input.objectName,
        input.organizationId,
        {
          approvedRecipes: largeRecipes,
          request: makeSingleDinnerRequest(input.requestKey),
        }
      );
      if (!created.ok) {
        throw new Error("Expected the large swap-audit fixture to be created.");
      }
      const swapUntilRejected = async (
        lastValid: SuccessfulMealPlanResponse,
        index: number
      ): Promise<{
        readonly lastValid: SuccessfulMealPlanResponse;
        readonly rejected: FailedMealPlanResponse;
        readonly rejectedRequest: typeof ManualMealSwapRequestWire.Type;
      }> => {
        if (index >= 20) {
          throw new Error("Expected repeated swaps to reach the size limit.");
        }
        const currentRecipeId = lastValid.value.meals[0]?.sourceRecipe.importId;
        const replacement = largeRecipes.find(
          ({ importId }) => importId !== currentRecipeId
        );
        if (replacement === undefined) {
          throw new Error("Expected an alternate large recipe fixture.");
        }
        const request = Schema.decodeUnknownSync(ManualMealSwapRequestWire)({
          draftId: created.value.draftId,
          expectedRevision: lastValid.value.revision,
          mutationId: `${input.requestKey}-swap-${index}`,
          reason: "Exercise the persisted audit size boundary.",
          replacementImportId: replacement.importId,
          slotId: "large-audit-dinner",
        });
        const result = await mutateMealPlan({
          approvedRecipes: largeRecipes,
          objectName: input.objectName,
          operation: "swapMealPlan",
          organizationId: input.organizationId,
          request,
        });
        if (!result.ok) {
          return { lastValid, rejected: result, rejectedRequest: request };
        }
        return swapUntilRejected(result, index + 1);
      };
      return {
        created,
        ...(await swapUntilRejected(created, 0)),
      };
    };

    const approvalInput = {
      objectName: await objectNameFor("organization-large-swap-approval"),
      organizationId: "organization-large-swap-approval",
      requestKey: "large-swap-approval",
    };
    const rejectionInput = {
      objectName: await objectNameFor("organization-large-swap-rejection"),
      organizationId: "organization-large-swap-rejection",
      requestKey: "large-swap-rejection",
    };
    const [approvalScenario, rejectionScenario] = await Promise.all([
      growUntilRejected(approvalInput),
      growUntilRejected(rejectionInput),
    ]);

    expect(approvalScenario.lastValid.value.audit.length).toBeGreaterThan(1);
    expect(rejectionScenario.lastValid.value.audit.length).toBeGreaterThan(1);
    expect(failureTag(approvalScenario.rejected)).toBe(
      "MealPlanPersistenceFailure"
    );
    expect(failureTag(rejectionScenario.rejected)).toBe(
      "MealPlanPersistenceFailure"
    );

    const replayRejectedSwap = (input: {
      readonly objectName: string;
      readonly organizationId: string;
      readonly request: typeof ManualMealSwapRequestWire.Type;
    }) =>
      mutateMealPlan({
        approvedRecipes: largeRecipes,
        objectName: input.objectName,
        operation: "swapMealPlan",
        organizationId: input.organizationId,
        request: input.request,
      });
    const [approvalReplay, rejectionReplay] = await Promise.all([
      replayRejectedSwap({
        ...approvalInput,
        request: approvalScenario.rejectedRequest,
      }),
      replayRejectedSwap({
        ...rejectionInput,
        request: rejectionScenario.rejectedRequest,
      }),
    ]);
    expect(failureTag(approvalReplay)).toBe("MealPlanPersistenceFailure");
    expect(failureTag(rejectionReplay)).toBe("MealPlanPersistenceFailure");

    await runtime.dispose();
    runtime = makeRuntime();
    const [approvalPersisted, rejectionPersisted] = await Promise.all([
      readMealPlan(
        approvalInput.objectName,
        approvalInput.organizationId,
        approvalScenario.created.value.draftId
      ),
      readMealPlan(
        rejectionInput.objectName,
        rejectionInput.organizationId,
        rejectionScenario.created.value.draftId
      ),
    ]);
    expect(approvalPersisted).toEqual(approvalScenario.lastValid);
    expect(rejectionPersisted).toEqual(rejectionScenario.lastValid);

    const maximumEscapedReason = "\u0001".repeat(4096);
    const [approved, rejected] = await Promise.all([
      mutateMealPlan({
        objectName: approvalInput.objectName,
        operation: "approveMealPlan",
        organizationId: approvalInput.organizationId,
        request: Schema.decodeUnknownSync(MealPlanDecisionRequestWire)({
          draftId: approvalScenario.created.value.draftId,
          expectedRevision: approvalScenario.lastValid.value.revision,
          mutationId: "p".repeat(128),
          reason: maximumEscapedReason,
        }),
      }),
      mutateMealPlan({
        objectName: rejectionInput.objectName,
        operation: "rejectMealPlan",
        organizationId: rejectionInput.organizationId,
        request: Schema.decodeUnknownSync(MealPlanDecisionRequestWire)({
          draftId: rejectionScenario.created.value.draftId,
          expectedRevision: rejectionScenario.lastValid.value.revision,
          mutationId: "r".repeat(128),
          reason: maximumEscapedReason,
        }),
      }),
    ]);
    expect(approved).toMatchObject({
      ok: true,
      value: { _tag: "Approved" },
    });
    expect(rejected).toMatchObject({
      ok: true,
      value: { _tag: "Rejected" },
    });
  }, 30_000);

  it("replays an identical create and rejects a changed request with the same key", async () => {
    const objectName = await objectNameFor("organization-create-replay");
    const organizationId = "organization-create-replay";
    const created = await createMealPlan(objectName, organizationId);
    const replay = await createMealPlan(objectName, organizationId);

    expect(replay).toEqual(created);

    const changedPolicy = Schema.decodeUnknownSync(MealPlanPolicy)({
      ...syntheticPlanningPolicy,
      maxRecipeUses: 2,
    });
    const collision = await createMealPlan(objectName, organizationId, {
      policy: changedPolicy,
    });
    expect(failureTag(collision)).toBe("MealPlanRequestConflict");
  });

  it("keeps identical draft IDs physically isolated between household objects", async () => {
    const firstRecipe = approvedRecipes.at(0);
    const secondRecipe = approvedRecipes.at(1);
    if (firstRecipe === undefined || secondRecipe === undefined) {
      throw new Error("Expected two approved recipe fixtures.");
    }
    const first = await createMealPlan(
      await objectNameFor("organization-isolated-a"),
      "organization-isolated-a",
      { approvedRecipes: [firstRecipe] }
    );
    const second = await createMealPlan(
      await objectNameFor("organization-isolated-b"),
      "organization-isolated-b",
      { approvedRecipes: [secondRecipe] }
    );
    if (!first.ok || !second.ok) {
      throw new Error("Expected both isolated household plans to be created.");
    }
    expect(second.value.draftId).toBe(first.value.draftId);
    expect(second.value.meals).not.toEqual(first.value.meals);

    const rereadFirst = await readMealPlan(
      await objectNameFor("organization-isolated-a"),
      "organization-isolated-a",
      first.value.draftId
    );
    const rereadSecond = await readMealPlan(
      await objectNameFor("organization-isolated-b"),
      "organization-isolated-b",
      second.value.draftId
    );
    expect(rereadFirst).toEqual(first);
    expect(rereadSecond).toEqual(second);
  });

  it("serializes concurrent stale mutations so exactly one revision wins", async () => {
    const objectName = await objectNameFor("organization-concurrent-mutations");
    const organizationId = "organization-concurrent-mutations";
    const created = await createMealPlan(objectName, organizationId);
    if (!created.ok) {
      throw new Error(
        "Expected concurrent mutation plan fixture to be created."
      );
    }
    const request = (mutationId: string, reason: string) =>
      Schema.decodeUnknownSync(ManualMealSwapRequestWire)({
        draftId: created.value.draftId,
        expectedRevision: 0,
        mutationId,
        reason,
        replacementImportId: syntheticReplacementRecipeId,
        slotId: "synthetic-dinner",
      });

    const results = await Promise.all([
      mutateMealPlan({
        objectName,
        operation: "swapMealPlan",
        organizationId,
        request: request("concurrent-a", "First concurrent command."),
      }),
      mutateMealPlan({
        objectName,
        operation: "swapMealPlan",
        organizationId,
        request: request("concurrent-b", "Second concurrent command."),
      }),
    ]);

    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    const failed = results.find(({ ok }) => !ok);
    if (failed === undefined) {
      throw new Error(
        "Expected one concurrent mutation to lose the revision race."
      );
    }
    expect(failureTag(failed)).toBe("MealPlanVersionConflict");

    const persisted = await readMealPlan(
      objectName,
      organizationId,
      created.value.draftId
    );
    if (!persisted.ok) {
      throw new Error("Expected the concurrent winner to remain persisted.");
    }
    expect(persisted.value).toMatchObject({
      _tag: "Draft",
      audit: [{ actorId: "a".repeat(64) }],
      revision: 1,
    });
  });

  it("persists swap and decision idempotency, concurrency, terminality, and audit", async () => {
    const objectName = await objectNameFor("organization-mutations");
    const organizationId = "organization-mutations";
    const created = await createMealPlan(objectName, organizationId);
    if (!created.ok) {
      throw new Error("Expected mutation plan fixture to be created.");
    }

    const swap = Schema.decodeUnknownSync(ManualMealSwapRequestWire)({
      draftId: created.value.draftId,
      expectedRevision: 0,
      mutationId: "swap-a",
      reason: "Use the household alternative.",
      replacementImportId: syntheticReplacementRecipeId,
      slotId: "synthetic-dinner",
    });
    const swapped = await mutateMealPlan({
      objectName,
      operation: "swapMealPlan",
      organizationId,
      request: swap,
    });
    const swapReplay = await mutateMealPlan({
      objectName,
      operation: "swapMealPlan",
      organizationId,
      request: swap,
    });
    expect(swapReplay).toEqual(swapped);
    if (!swapped.ok) {
      throw new Error("Expected swap to succeed.");
    }
    expect(swapped.value).toMatchObject({
      _tag: "Draft",
      audit: [{ actorId: "a".repeat(64), mutationId: "swap-a" }],
      revision: 1,
    });

    const swapCollision = await mutateMealPlan({
      objectName,
      operation: "swapMealPlan",
      organizationId,
      request: Schema.decodeUnknownSync(ManualMealSwapRequestWire)({
        ...swap,
        reason: "A changed command with the same mutation ID.",
      }),
    });
    expect(failureTag(swapCollision)).toBe("MealPlanMutationConflict");

    const staleSwap = await mutateMealPlan({
      objectName,
      operation: "swapMealPlan",
      organizationId,
      request: Schema.decodeUnknownSync(ManualMealSwapRequestWire)({
        ...swap,
        mutationId: "swap-stale",
      }),
    });
    expect(failureTag(staleSwap)).toBe("MealPlanVersionConflict");

    const approval = Schema.decodeUnknownSync(MealPlanDecisionRequestWire)({
      draftId: created.value.draftId,
      expectedRevision: 1,
      mutationId: "decision-a",
      reason: "Approved by the household.",
    });
    const approved = await mutateMealPlan({
      objectName,
      operation: "approveMealPlan",
      organizationId,
      request: approval,
    });
    const approvalReplay = await mutateMealPlan({
      objectName,
      operation: "approveMealPlan",
      organizationId,
      request: approval,
    });
    expect(approvalReplay).toEqual(approved);
    if (!approved.ok) {
      throw new Error("Expected approval to succeed.");
    }
    expect(approved.value).toMatchObject({
      _tag: "Approved",
      audit: [{ actorId: "a".repeat(64), mutationId: "swap-a" }],
      decision: { actorId: "a".repeat(64), mutationId: "decision-a" },
      revision: 2,
    });

    const terminalRewrite = await mutateMealPlan({
      objectName,
      operation: "rejectMealPlan",
      organizationId,
      request: Schema.decodeUnknownSync(MealPlanDecisionRequestWire)({
        ...approval,
        expectedRevision: 2,
        mutationId: "decision-terminal-rewrite",
      }),
    });
    expect(failureTag(terminalRewrite)).toBe("MealPlanTransitionRejected");

    await runtime.dispose();
    runtime = makeRuntime();
    const persisted = await readMealPlan(
      objectName,
      organizationId,
      created.value.draftId
    );
    expect(persisted).toEqual(approved);
  });
});
