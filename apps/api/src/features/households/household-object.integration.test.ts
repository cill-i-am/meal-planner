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
import {
  HouseholdImportWorkflowAdmissionResult,
  HouseholdImportWorkflowDispatchView,
} from "./foundation/import-workflow-admission.contract.js";
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
import { HouseholdAuthorityServicesLive } from "./shared-kernel/authority-services.live.js";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
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

const ImportWorkflowAdmissionResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: HouseholdImportWorkflowAdmissionResult,
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

const CountResponse = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Number }),
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

const admitImportWorkflow = async (input: {
  readonly alarmFailure?: boolean;
  readonly dispatchId?: string;
  readonly executionGeneration: number;
  readonly importId: string;
  readonly mutationId: string;
  readonly objectName: string;
  readonly organizationId: string;
}) => {
  const command: {
    alarmFailure?: boolean;
    dispatchId?: string;
    executionGeneration: number;
    importId: string;
    mutationId: string;
    objectName: string;
    operation: "admitImportWorkflow";
    organizationId: string;
  } = {
    executionGeneration: input.executionGeneration,
    importId: input.importId,
    mutationId: input.mutationId,
    objectName: input.objectName,
    operation: "admitImportWorkflow",
    organizationId: input.organizationId,
  };
  if (input.alarmFailure !== undefined) {
    command.alarmFailure = input.alarmFailure;
  }
  if (input.dispatchId !== undefined) {
    command.dispatchId = input.dispatchId;
  }
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify(command),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(ImportWorkflowAdmissionResponse)(
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

const inspectImportWorkflowAdmissionCount = async (input: {
  readonly executionGeneration: number;
  readonly importId: string;
  readonly objectName: string;
}) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      ...input,
      operation: "inspectImportWorkflowAdmissionCount",
    }),
    method: "POST",
  });
  return Schema.decodeUnknownPromise(CountResponse)(await response.json());
};

const markImportWorkflowDispatchExhausted = async (input: {
  readonly dispatchId: string;
  readonly exhaustedAtEpochMs: number;
  readonly objectName: string;
}) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      ...input,
      operation: "markImportWorkflowDispatchExhausted",
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return response.json();
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

  it("keeps a committed Workflow admission final across alarm failure, exhaustion, replay, generation, and restart", async () => {
    const organizationId = "organization-workflow-admission";
    const objectName = await objectNameFor(organizationId);
    const initialInput = {
      alarmFailure: true,
      dispatchId: "dispatch-workflow-generation-1",
      executionGeneration: 1,
      importId: "35c4f35a-d410-47d3-8c5a-b5c27dac52d8",
      mutationId: "1".repeat(64),
      objectName,
      organizationId,
    } as const;

    const committed = await admitImportWorkflow(initialInput);
    if (!committed.ok) {
      throw new Error(
        `Expected Workflow admission to commit: ${JSON.stringify(committed.error)}`
      );
    }
    expect(committed.value.workflowIdentity).toMatch(
      /^import-acquisition:v1:[a-f\d]{64}$/u
    );
    expect(committed.value.workflowIdentity).not.toContain(
      initialInput.importId
    );
    expect(JSON.stringify(committed.value)).not.toContain(organizationId);

    const replay = await admitImportWorkflow({
      ...initialInput,
      alarmFailure: false,
      dispatchId: "a-replay-must-not-mint-this-dispatch-id",
    });
    expect(replay).toEqual(committed);

    const pending = await inspectImportWorkflowDispatch(
      objectName,
      committed.value.dispatchId
    );
    expect(pending).toEqual({
      ok: true,
      value: {
        admission: committed.value,
        attempts: 0,
        exhaustedAtEpochMs: null,
        state: "pending",
      },
    });

    await markImportWorkflowDispatchExhausted({
      dispatchId: committed.value.dispatchId,
      exhaustedAtEpochMs: committed.value.committedAtEpochMs + 10_000,
      objectName,
    });
    const exhausted = await inspectImportWorkflowDispatch(
      objectName,
      committed.value.dispatchId
    );
    expect(exhausted).toMatchObject({
      ok: true,
      value: {
        admission: committed.value,
        state: "exhausted",
      },
    });

    await runtime.dispose();
    runtime = makeRuntime();
    expect(await admitImportWorkflow(initialInput)).toEqual(committed);

    const nextGeneration = await admitImportWorkflow({
      ...initialInput,
      alarmFailure: false,
      dispatchId: "dispatch-workflow-generation-2",
      executionGeneration: 2,
      mutationId: "2".repeat(64),
    });
    expect(nextGeneration).toMatchObject({ ok: true });
    if (!nextGeneration.ok) {
      throw new Error("Expected a new execution generation to commit.");
    }
    expect(nextGeneration.value.workflowIdentity).not.toBe(
      committed.value.workflowIdentity
    );
  });

  it("rolls back admission when its required outbox insert cannot commit", async () => {
    const organizationId = "organization-workflow-atomicity";
    const objectName = await objectNameFor(organizationId);
    const dispatchId = "dispatch-forced-atomicity-collision";
    const first = await admitImportWorkflow({
      dispatchId,
      executionGeneration: 1,
      importId: "a5670d4d-6300-4395-8ed7-7a8257d46067",
      mutationId: "3".repeat(64),
      objectName,
      organizationId,
    });
    if (!first.ok) {
      throw new Error(
        `Expected atomicity fixture admission to commit: ${JSON.stringify(first.error)}`
      );
    }

    const rejected = await admitImportWorkflow({
      dispatchId,
      executionGeneration: 1,
      importId: "b2d1d9af-8b35-43be-b53e-6aa801f571ca",
      mutationId: "4".repeat(64),
      objectName,
      organizationId,
    });
    expect(rejected).toMatchObject({
      error: { _tag: "HouseholdWorkflowAdmissionPersistenceFailure" },
      ok: false,
    });
    expect(
      await inspectImportWorkflowAdmissionCount({
        executionGeneration: 1,
        importId: "b2d1d9af-8b35-43be-b53e-6aa801f571ca",
        objectName,
      })
    ).toEqual({ ok: true, value: 0 });
  });

  it("rejects corrupt persisted outbox projections at the repository boundary", async () => {
    const organizationId = "organization-workflow-corrupt-outbox";
    const objectName = await objectNameFor(organizationId);
    const committed = await admitImportWorkflow({
      dispatchId: "dispatch-corrupt-outbox",
      executionGeneration: 1,
      importId: "e3dbe6a7-bc0f-4f7d-b938-bdd80544b7be",
      mutationId: "5".repeat(64),
      objectName,
      organizationId,
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
