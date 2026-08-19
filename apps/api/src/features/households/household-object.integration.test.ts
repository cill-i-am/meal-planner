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
  ManualMealSwapRequest,
  MealPlan,
  MealPlanDecisionRequest,
  MealPlanPolicy,
  MealPlanRequest,
} from "../meal-planning/meal-plan.js";
import {
  HouseholdDomainFailure,
  HouseholdMetadata,
} from "./household.contract.js";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const MealPlanWire = Schema.toEncoded(MealPlan);
const ApprovedRecipeWire = Schema.toEncoded(ApprovedRecipe);
const ManualMealSwapRequestWire = Schema.toEncoded(ManualMealSwapRequest);
const MealPlanDecisionRequestWire = Schema.toEncoded(MealPlanDecisionRequest);
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

describe("household Durable Object", () => {
  it("initializes once and rejects a conflicting organization provenance", async () => {
    const objectName = "household:v1:organization-a";
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
    expect(mismatch.error).toMatchObject({
      _tag: "HouseholdProvenanceMismatch",
      organizationId: "organization-b",
      persistedOrganizationId: "organization-a",
    });
  });

  it("creates and reads a meal plan after a runtime restart", async () => {
    const objectName = "household:v1:organization-meal-plan";
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
    const objectName = "household:v1:organization-oversized-create";
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
    const objectName = "household:v1:organization-terminal-headroom";
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
    const objectName = "household:v1:organization-near-limit-create";
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
    const approvalObjectName = "household:v1:organization-near-limit-approval";
    const approvalOrganizationId = "organization-near-limit-approval";
    const approvalRequest = makeMaximumSlotRequest("near-limit-approval");
    const rejectionObjectName =
      "household:v1:organization-near-limit-rejection";
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
          actorId: "a".repeat(128),
          decidedAt: "2026-08-01T12:30:00.000Z",
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
          actorId: "a".repeat(128),
          decidedAt: "2026-08-01T12:30:00.000Z",
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
          actorId: "actor-large-audit",
          draftId: created.value.draftId,
          expectedRevision: lastValid.value.revision,
          mutationId: `${input.requestKey}-swap-${index}`,
          reason: "Exercise the persisted audit size boundary.",
          replacementImportId: replacement.importId,
          slotId: "large-audit-dinner",
          swappedAt: "2026-08-01T12:00:00.000Z",
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
      objectName: "household:v1:organization-large-swap-approval",
      organizationId: "organization-large-swap-approval",
      requestKey: "large-swap-approval",
    };
    const rejectionInput = {
      objectName: "household:v1:organization-large-swap-rejection",
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
          actorId: "a".repeat(128),
          decidedAt: "2026-08-01T12:30:00.000Z",
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
          actorId: "a".repeat(128),
          decidedAt: "2026-08-01T12:30:00.000Z",
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
    const objectName = "household:v1:organization-create-replay";
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
      "household:v1:organization-isolated-a",
      "organization-isolated-a",
      { approvedRecipes: [firstRecipe] }
    );
    const second = await createMealPlan(
      "household:v1:organization-isolated-b",
      "organization-isolated-b",
      { approvedRecipes: [secondRecipe] }
    );
    if (!first.ok || !second.ok) {
      throw new Error("Expected both isolated household plans to be created.");
    }
    expect(second.value.draftId).toBe(first.value.draftId);
    expect(second.value.meals).not.toEqual(first.value.meals);

    const rereadFirst = await readMealPlan(
      "household:v1:organization-isolated-a",
      "organization-isolated-a",
      first.value.draftId
    );
    const rereadSecond = await readMealPlan(
      "household:v1:organization-isolated-b",
      "organization-isolated-b",
      second.value.draftId
    );
    expect(rereadFirst).toEqual(first);
    expect(rereadSecond).toEqual(second);
  });

  it("serializes concurrent stale mutations so exactly one revision wins", async () => {
    const objectName = "household:v1:organization-concurrent-mutations";
    const organizationId = "organization-concurrent-mutations";
    const created = await createMealPlan(objectName, organizationId);
    if (!created.ok) {
      throw new Error(
        "Expected concurrent mutation plan fixture to be created."
      );
    }
    const request = (mutationId: string, reason: string) =>
      Schema.decodeUnknownSync(ManualMealSwapRequestWire)({
        actorId: "actor-concurrent",
        draftId: created.value.draftId,
        expectedRevision: 0,
        mutationId,
        reason,
        replacementImportId: syntheticReplacementRecipeId,
        slotId: "synthetic-dinner",
        swappedAt: "2026-07-22T10:59:00.000Z",
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
      audit: [{ actorId: "actor-concurrent" }],
      revision: 1,
    });
  });

  it("persists swap and decision idempotency, concurrency, terminality, and audit", async () => {
    const objectName = "household:v1:organization-mutations";
    const organizationId = "organization-mutations";
    const created = await createMealPlan(objectName, organizationId);
    if (!created.ok) {
      throw new Error("Expected mutation plan fixture to be created.");
    }

    const swap = Schema.decodeUnknownSync(ManualMealSwapRequestWire)({
      actorId: "actor-a",
      draftId: created.value.draftId,
      expectedRevision: 0,
      mutationId: "swap-a",
      reason: "Use the household alternative.",
      replacementImportId: syntheticReplacementRecipeId,
      slotId: "synthetic-dinner",
      swappedAt: "2026-07-22T11:00:00.000Z",
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
      audit: [{ actorId: "actor-a", mutationId: "swap-a" }],
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
      actorId: "actor-a",
      decidedAt: "2026-07-22T11:05:00.000Z",
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
    expect(approved.value).toMatchObject({ _tag: "Approved", revision: 2 });

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
