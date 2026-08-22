import { MealPlanRecipeSnapshot } from "@meal-planner/household-api";
import { Recipe } from "@meal-planner/recipe-import-api";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { Context, Effect, Option, Schema } from "effect";

import migrations from "../../../household-migrations/migrations.js";
import { ApprovedRecipe } from "../imports/import-recipe-review.js";
import {
  MealPlan,
  MealPlanDraftId,
  MealPlanPolicy,
  MealPlanRequest,
} from "../meal-planning/meal-plan.js";
import type { MealPlanServiceError } from "../meal-planning/meal-plan.js";
import { HouseholdDispatchId } from "./foundation/import-workflow-admission.contract.js";
import { makeImportWorkflowAdmissionRepository } from "./foundation/import-workflow-admission.repository.js";
import type { HouseholdCreateMealPlanFromRecipeBankInput } from "./household-meal-plan.contract.js";
import {
  HouseholdManualMealSwapCommand,
  HouseholdMealPlanDecisionCommand,
} from "./household-meal-plan.contract.js";
import { HouseholdObjectRuntime } from "./household-object-runtime.js";
import type {
  HouseholdDomainFailure,
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdOrganizationId } from "./household.contract.js";
import {
  householdMeta,
  householdMealPlans,
  householdOutbox,
  householdRecipes,
} from "./household.database-schema.js";
import {
  HouseholdAdmitRecipeImportInput,
  HouseholdCancelRecipeImportInput,
  HouseholdCommitRecipeImportDraftInput,
  HouseholdConfirmRecipeImportActionInput,
  HouseholdReadRecipeImportInput,
  HouseholdRecordRecipeImportDispatchInput,
  HouseholdRecipePageInput,
  HouseholdResolveRecipeImportSourceInput,
  HouseholdTransitionRecipeImportLifecycleInput,
} from "./recipe-import/household-recipe-import.contract.js";
import { makeHouseholdRecipeImportRepository } from "./recipe-import/household-recipe-import.repository.js";
import {
  HouseholdMemberAdmission,
  HouseholdSystemAdmission,
} from "./rpc/command-envelope.js";
import type { HouseholdSystemPurpose } from "./rpc/command-envelope.js";
import {
  HouseholdCanonicalEncoding,
  HouseholdDigest,
  HouseholdIdentityGenerator,
} from "./shared-kernel/authority-services.js";
import { HouseholdAuthorityServicesLive } from "./shared-kernel/authority-services.live.js";

const ApprovedRecipeWire = Schema.toEncoded(ApprovedRecipe);
const MealPlanWire = Schema.toEncoded(MealPlan);
const MealPlanPolicyWire = Schema.toEncoded(MealPlanPolicy);
const MealPlanRequestWire = Schema.toEncoded(MealPlanRequest);
const ManualMealSwapRequestWire = Schema.toEncoded(
  HouseholdManualMealSwapCommand
);
const MealPlanDecisionRequestWire = Schema.toEncoded(
  HouseholdMealPlanDecisionCommand
);

const alchemyRuntimeContractKey = "shape";
const HouseholdObjectTestRuntime = Effect.gen(
  function* initializeHouseholdObjectTestRuntime() {
    const household = yield* yield* HouseholdObjectRuntime.pipe(
      Effect.provide(HouseholdAuthorityServicesLive)
    );
    const canonicalEncoding = yield* HouseholdCanonicalEncoding;
    const digest = yield* HouseholdDigest;
    const durableObjectState = yield* Cloudflare.DurableObjectState;
    const database = Drizzle.DurableObject({ migrations });
    const scoped = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(
          Cloudflare.DurableObjectState,
          durableObjectState
        ),
        Effect.scoped
      );
    // eslint-disable-next-line sort-keys -- Fixture RPC follows the production runtime surface, then corruption-only probes.
    return Effect.succeed({
      ...household,
      corruptImportWorkflowDispatchState: (
        dispatchId: HouseholdDispatchId,
        state: string
      ) =>
        scoped(
          Effect.gen(function* corruptImportWorkflowDispatchState() {
            const connection = yield* database;
            yield* connection
              .update(householdOutbox)
              .set({ state })
              .where(eq(householdOutbox.dispatchId, dispatchId));
          })
        ),
      corruptHouseholdProvenanceCreatedAt: (createdAtEpochMs: number) =>
        scoped(
          Effect.gen(function* corruptHouseholdProvenanceCreatedAt() {
            const connection = yield* database;
            yield* connection
              .update(householdMeta)
              .set({ createdAtEpochMs })
              .where(eq(householdMeta.singletonKey, "household"));
          })
        ),
      confirmRecipeImportActionWithRecipeId: (
        input: typeof HouseholdConfirmRecipeImportActionInput.Type,
        recipeId: string
      ) =>
        scoped(
          Effect.gen(function* confirmWithForcedRecipeIdentity() {
            const connection = yield* database;
            return yield* makeHouseholdRecipeImportRepository(connection)
              .confirm(input)
              .pipe(
                Effect.provideService(
                  HouseholdCanonicalEncoding,
                  canonicalEncoding
                ),
                Effect.provideService(HouseholdDigest, digest),
                Effect.provideService(
                  HouseholdIdentityGenerator,
                  HouseholdIdentityGenerator.of({
                    generate: () => Effect.succeed(recipeId),
                  })
                )
              );
          })
        ),
      inspectImportWorkflowDispatch: (dispatchId: HouseholdDispatchId) =>
        scoped(
          Effect.gen(function* inspectImportWorkflowDispatch() {
            const connection = yield* database;
            const result =
              yield* makeImportWorkflowAdmissionRepository(connection).inspect(
                dispatchId
              );
            return Option.getOrNull(result);
          })
        ),
      invokeMalformedEnsure: (payload: Schema.Json) =>
        household.ensureHousehold(payload as HouseholdEnsureInput),
      inspectMealPlanStorage: (draftId: MealPlanDraftId) =>
        scoped(
          Effect.gen(function* inspectMealPlanStorage() {
            const connection = yield* database;
            const [row] = yield* connection
              .select({
                planJson: householdMealPlans.planJson,
                requestFingerprintDigest:
                  householdMealPlans.requestFingerprintDigest,
              })
              .from(householdMealPlans)
              .where(eq(householdMealPlans.draftId, draftId))
              .limit(1);
            if (row === undefined) {
              return null;
            }
            const encoder = new TextEncoder();
            return {
              planJsonBytes: encoder.encode(row.planJson).byteLength,
              replayKeyBytes: encoder.encode(row.requestFingerprintDigest)
                .byteLength,
            };
          })
        ),
      seedApprovedRecipes: (count: number) =>
        scoped(
          Effect.gen(function* seedApprovedRecipes() {
            const connection = yield* database;
            yield* Effect.forEach(
              Array.from({ length: count }, (_, index) => index + 1),
              (index) => {
                const suffix = index.toString(16).padStart(12, "0");
                const importId = `00000000-0000-4000-8000-${suffix}`;
                const recipeId = `10000000-0000-4000-8000-${suffix}`;
                const planningRecipe = Schema.decodeUnknownSync(
                  MealPlanRecipeSnapshot
                )({
                  approvedAt: "2026-08-22T00:00:00.000Z",
                  extractionFingerprint: index.toString(16).padStart(64, "0"),
                  importId,
                  recipe: {
                    ingredientLines: [`Ingredient ${index}`],
                    instructions: [`Cook recipe ${index}.`],
                    name: `Approved recipe ${index}`,
                  },
                  source: {
                    evidenceFingerprint: (index + count)
                      .toString(16)
                      .padStart(64, "0"),
                    sourceUrl: null,
                  },
                  tags: {
                    cuisines: ["Irish"],
                    dietaryFit: "household_match",
                    difficulty: "easy",
                    leftovers: "one_meal",
                    mealTypes: ["dinner"],
                    totalTimeBand: "under_30_minutes",
                  },
                  version: 1,
                });
                const publicRecipe = Schema.decodeUnknownSync(Recipe)({
                  id: recipeId,
                  object: "recipe",
                  recipe: {
                    author: null,
                    category: null,
                    cookTimeMinutes: 10,
                    cuisine: "Irish",
                    description: null,
                    ingredientLines: [`Ingredient ${index}`],
                    ingredientQuantities: null,
                    ingredientUnits: null,
                    instructions: [`Cook recipe ${index}.`],
                    name: `Approved recipe ${index}`,
                    nutrition: null,
                    prepTimeMinutes: 5,
                    temperatureCelsius: null,
                    tools: ["Pot"],
                    totalTimeMinutes: 15,
                    yield: "2 servings",
                  },
                  tags: planningRecipe.tags,
                });
                return connection.insert(householdRecipes).values({
                  importId,
                  planningRecipeJson: Schema.encodeSync(
                    Schema.fromJsonString(MealPlanRecipeSnapshot)
                  )(planningRecipe),
                  publicRecipeJson: Schema.encodeSync(
                    Schema.fromJsonString(Recipe)
                  )(publicRecipe),
                  publishedAt: "2026-08-22T00:00:00.000Z",
                  recipeId,
                  version: 1,
                });
              },
              { discard: true }
            );
          })
        ),
    });
  }
);
const BrokenMigrationObjectTestRuntime = Effect.gen(
  function* initializeBrokenMigrationObject() {
    const durableObjectState = yield* Cloudflare.DurableObjectState;
    const database = Drizzle.DurableObject({
      migrations: {
        migrations: {
          intentionally_broken: "CREATE TABLE broken_foundation(;",
        },
      },
    });
    return Effect.succeed({
      probe: () =>
        database.pipe(
          Effect.provideService(
            Cloudflare.DurableObjectState,
            durableObjectState
          ),
          Effect.scoped,
          Effect.as("unexpected-success")
        ),
    });
  }
);
const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({
      BrokenMigrationObject: {
        constructor: BrokenMigrationObjectTestRuntime,
        services: Context.empty(),
      },
      HouseholdObject: {
        constructor: HouseholdObjectTestRuntime.pipe(
          Effect.provide(HouseholdAuthorityServicesLive)
        ),
        services: Context.empty(),
      },
    }),
    [alchemyRuntimeContractKey]: () => ({}),
  },
});
const HouseholdObjectBridge = Cloudflare.makeDurableObjectBridge(
  DurableObject,
  {
    entrypoint,
    stack: { name: "MealPlanner", stage: "test-household" },
  }
)("HouseholdObject");

export class HouseholdObject extends HouseholdObjectBridge {}

const BrokenMigrationObjectBridge = Cloudflare.makeDurableObjectBridge(
  DurableObject,
  {
    entrypoint,
    stack: { name: "MealPlanner", stage: "test-household" },
  }
)("BrokenMigrationObject");

// eslint-disable-next-line max-classes-per-file -- The installed fixture exports both production and deliberately broken migration classes.
export class BrokenMigrationObject extends BrokenMigrationObjectBridge {}

interface HouseholdObjectClient {
  readonly admitRecipeImport: (
    input: typeof HouseholdAdmitRecipeImportInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly approveMealPlan: (input: {
    readonly admission: HouseholdMemberAdmission;
    readonly request: typeof MealPlanDecisionRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly createMealPlan: (input: {
    readonly admission: HouseholdMemberAdmission;
    readonly approvedRecipes: readonly (typeof ApprovedRecipeWire.Type)[];
    readonly policy: typeof MealPlanPolicyWire.Type;
    readonly request: typeof MealPlanRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly createMealPlanFromRecipeBank: (
    input: typeof HouseholdCreateMealPlanFromRecipeBankInput.Type
  ) => Effect.Effect<typeof MealPlanWire.Type, unknown>;
  readonly commitRecipeImportDraft: (
    input: typeof HouseholdCommitRecipeImportDraftInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly cancelRecipeImport: (
    input: typeof HouseholdCancelRecipeImportInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly confirmRecipeImportAction: (
    input: typeof HouseholdConfirmRecipeImportActionInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly confirmRecipeImportActionWithRecipeId: (
    input: typeof HouseholdConfirmRecipeImportActionInput.Type,
    recipeId: string
  ) => Effect.Effect<unknown, unknown>;
  readonly corruptImportWorkflowDispatchState: (
    dispatchId: typeof HouseholdDispatchId.Type,
    state: string
  ) => Effect.Effect<void, unknown>;
  readonly corruptHouseholdProvenanceCreatedAt: (
    createdAtEpochMs: number
  ) => Effect.Effect<void, unknown>;
  readonly ensureHousehold: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
  readonly inspectImportWorkflowDispatch: (
    dispatchId: typeof HouseholdDispatchId.Type
  ) => Effect.Effect<unknown>;
  readonly inspectMealPlanStorage: (draftId: MealPlanDraftId) => Effect.Effect<{
    readonly planJsonBytes: number;
    readonly replayKeyBytes: number;
  } | null>;
  readonly invokeMalformedEnsure: (
    payload: Schema.Json
  ) => Effect.Effect<unknown, HouseholdDomainFailure>;
  readonly readMealPlan: (input: {
    readonly admission: HouseholdMemberAdmission;
    readonly draftId: MealPlanDraftId;
  }) => Effect.Effect<
    typeof MealPlanWire.Type | null,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly readRecipeImport: (
    input: typeof HouseholdReadRecipeImportInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly recordRecipeImportDispatch: (
    input: typeof HouseholdRecordRecipeImportDispatchInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly rejectMealPlan: (input: {
    readonly admission: HouseholdMemberAdmission;
    readonly request: typeof MealPlanDecisionRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly resolveRecipeImportSource: (
    input: typeof HouseholdResolveRecipeImportSourceInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly transitionRecipeImportLifecycle: (
    input: typeof HouseholdTransitionRecipeImportLifecycleInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly listRecipeBank: (
    input: typeof HouseholdRecipePageInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly seedApprovedRecipes: (count: number) => Effect.Effect<void, unknown>;
  readonly swapMealPlan: (input: {
    readonly admission: HouseholdMemberAdmission;
    readonly approvedRecipes: readonly (typeof ApprovedRecipeWire.Type)[];
    readonly request: typeof ManualMealSwapRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
}

const HouseholdTestCommand = Schema.Union([
  Schema.Struct({
    expectedIntentVersion:
      HouseholdCancelRecipeImportInput.fields.request.fields
        .expectedIntentVersion,
    idempotencyKey: HouseholdCancelRecipeImportInput.fields.idempotencyKey,
    intentId: HouseholdCancelRecipeImportInput.fields.intentId,
    objectName: Schema.String,
    operation: Schema.Literal("cancelRecipeImport"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    actionId: HouseholdConfirmRecipeImportActionInput.fields.actionId,
    expectedActionVersion:
      HouseholdConfirmRecipeImportActionInput.fields.request.fields
        .expectedActionVersion,
    idempotencyKey:
      HouseholdConfirmRecipeImportActionInput.fields.idempotencyKey,
    intentId: HouseholdConfirmRecipeImportActionInput.fields.intentId,
    objectName: Schema.String,
    operation: Schema.Literal("confirmRecipeImportActionWithRecipeId"),
    organizationId: HouseholdOrganizationId,
    recipeId: Recipe.fields.id,
  }),
  Schema.Struct({
    byteLimit: HouseholdRecipePageInput.fields.byteLimit,
    cursor: HouseholdRecipePageInput.fields.cursor,
    limit: HouseholdRecipePageInput.fields.limit,
    objectName: Schema.String,
    operation: Schema.Literal("listRecipeBank"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    intentId: HouseholdReadRecipeImportInput.fields.intentId,
    objectName: Schema.String,
    operation: Schema.Literal("readRecipeImport"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    idempotencyKey: HouseholdAdmitRecipeImportInput.fields.idempotencyKey,
    objectName: Schema.String,
    operation: Schema.Literal("admitRecipeImport"),
    organizationId: HouseholdOrganizationId,
    source: HouseholdAdmitRecipeImportInput.fields.source,
  }),
  Schema.Struct({
    createdAtEpochMs: Schema.Int,
    objectName: Schema.String,
    operation: Schema.Literal("corruptHouseholdProvenanceCreatedAt"),
  }),
  Schema.Struct({
    dispatchId: HouseholdDispatchId,
    objectName: Schema.String,
    operation: Schema.Literal("corruptImportWorkflowDispatchState"),
    state: Schema.String,
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("probeMigrationFailure"),
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("approveMealPlan"),
    organizationId: HouseholdOrganizationId,
    request: MealPlanDecisionRequestWire,
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("ensure"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    evidenceFingerprint:
      HouseholdCommitRecipeImportDraftInput.fields.evidenceFingerprint,
    expectedGeneration:
      HouseholdCommitRecipeImportDraftInput.fields.expectedGeneration,
    extractionFingerprint:
      HouseholdCommitRecipeImportDraftInput.fields.extractionFingerprint,
    intentId: HouseholdCommitRecipeImportDraftInput.fields.intentId,
    mutationId: HouseholdCommitRecipeImportDraftInput.fields.mutationId,
    objectName: Schema.String,
    operation: Schema.Literal("commitRecipeImportDraft"),
    organizationId: HouseholdOrganizationId,
    review: HouseholdCommitRecipeImportDraftInput.fields.review,
  }),
  Schema.Struct({
    actionId: HouseholdConfirmRecipeImportActionInput.fields.actionId,
    expectedActionVersion:
      HouseholdConfirmRecipeImportActionInput.fields.request.fields
        .expectedActionVersion,
    idempotencyKey:
      HouseholdConfirmRecipeImportActionInput.fields.idempotencyKey,
    intentId: HouseholdConfirmRecipeImportActionInput.fields.intentId,
    objectName: Schema.String,
    operation: Schema.Literal("confirmRecipeImportAction"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    approvedRecipes: Schema.Array(ApprovedRecipeWire),
    objectName: Schema.String,
    operation: Schema.Literal("createMealPlan"),
    organizationId: HouseholdOrganizationId,
    policy: MealPlanPolicyWire,
    request: MealPlanRequestWire,
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("createMealPlanFromRecipeBank"),
    organizationId: HouseholdOrganizationId,
    policy: MealPlanPolicyWire,
    request: MealPlanRequestWire,
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("invokeMalformedEnsure"),
    payload: Schema.Json,
  }),
  Schema.Struct({
    dispatchId: HouseholdDispatchId,
    objectName: Schema.String,
    operation: Schema.Literal("inspectImportWorkflowDispatch"),
  }),
  Schema.Struct({
    draftId: MealPlanDraftId,
    objectName: Schema.String,
    operation: Schema.Literal("inspectMealPlanStorage"),
  }),
  Schema.Struct({
    dispatchId: HouseholdRecordRecipeImportDispatchInput.fields.dispatchId,
    objectName: Schema.String,
    operation: Schema.Literal("recordRecipeImportDispatch"),
    organizationId: HouseholdOrganizationId,
    outcome: HouseholdRecordRecipeImportDispatchInput.fields.outcome,
    workflowIdentity:
      HouseholdRecordRecipeImportDispatchInput.fields.workflowIdentity,
  }),
  Schema.Struct({
    count: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
    objectName: Schema.String,
    operation: Schema.Literal("seedApprovedRecipes"),
  }),
  Schema.Struct({
    draftId: MealPlanDraftId,
    objectName: Schema.String,
    operation: Schema.Literal("readMealPlan"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("rejectMealPlan"),
    organizationId: HouseholdOrganizationId,
    request: MealPlanDecisionRequestWire,
  }),
  Schema.Struct({
    canonicalSourceId:
      HouseholdResolveRecipeImportSourceInput.fields.canonicalSourceId,
    canonicalUrl: HouseholdResolveRecipeImportSourceInput.fields.canonicalUrl,
    expectedGeneration:
      HouseholdResolveRecipeImportSourceInput.fields.expectedGeneration,
    intentId: HouseholdResolveRecipeImportSourceInput.fields.intentId,
    mutationId: HouseholdResolveRecipeImportSourceInput.fields.mutationId,
    objectName: Schema.String,
    operation: Schema.Literal("resolveRecipeImportSource"),
    organizationId: HouseholdOrganizationId,
    sourceKind: HouseholdResolveRecipeImportSourceInput.fields.sourceKind,
  }),
  Schema.Struct({
    expectedGeneration:
      HouseholdTransitionRecipeImportLifecycleInput.fields.expectedGeneration,
    intentId: HouseholdTransitionRecipeImportLifecycleInput.fields.intentId,
    objectName: Schema.String,
    operation: Schema.Literal("transitionRecipeImportLifecycle"),
    organizationId: HouseholdOrganizationId,
    transition: HouseholdTransitionRecipeImportLifecycleInput.fields.transition,
  }),
  Schema.Struct({
    approvedRecipes: Schema.Array(ApprovedRecipeWire),
    objectName: Schema.String,
    operation: Schema.Literal("swapMealPlan"),
    organizationId: HouseholdOrganizationId,
    request: ManualMealSwapRequestWire,
  }),
]);

interface HouseholdTestEnv {
  readonly BrokenMigrationObject: {
    readonly getByName: (name: string) => object;
  };
  readonly HouseholdObject: {
    readonly getByName: (name: string) => object;
  };
}

const memberAdmission = (organizationId: typeof HouseholdOrganizationId.Type) =>
  Schema.decodeUnknownSync(HouseholdMemberAdmission)({
    actor: { _tag: "Member", actorId: "a".repeat(64) },
    organizationId,
  });

const systemAdmission = (
  organizationId: typeof HouseholdOrganizationId.Type,
  purpose: typeof HouseholdSystemPurpose.Type = "import_workflow_dispatch"
) =>
  Schema.decodeUnknownSync(HouseholdSystemAdmission)({
    actor: { _tag: "System", purpose },
    organizationId,
  });

const respond = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: (error) => Response.json({ error, ok: false }),
        onSuccess: (value) => Response.json({ ok: true, value }),
      })
    )
  );

export default {
  // eslint-disable-next-line complexity -- Closed test routing enumerates the complete object RPC surface.
  fetch: async (request: Request, env: HouseholdTestEnv) => {
    const command = await Schema.decodeUnknownPromise(HouseholdTestCommand)(
      await request.json()
    );
    if (command.operation === "probeMigrationFailure") {
      const broken = Cloudflare.makeRpcStub<{
        readonly probe: () => Effect.Effect<string>;
      }>(env.BrokenMigrationObject.getByName(command.objectName));
      return respond(broken.probe());
    }
    const household = Cloudflare.makeRpcStub<HouseholdObjectClient>(
      env.HouseholdObject.getByName(command.objectName)
    );
    if (command.operation === "admitRecipeImport") {
      return respond(
        household.admitRecipeImport({
          admission: memberAdmission(command.organizationId),
          idempotencyKey: command.idempotencyKey,
          source: command.source,
        })
      );
    }
    if (command.operation === "approveMealPlan") {
      return respond(
        household.approveMealPlan({
          admission: memberAdmission(command.organizationId),
          request: command.request,
        })
      );
    }
    if (command.operation === "createMealPlan") {
      return respond(
        household.createMealPlan({
          admission: memberAdmission(command.organizationId),
          approvedRecipes: command.approvedRecipes,
          policy: command.policy,
          request: command.request,
        })
      );
    }
    if (command.operation === "createMealPlanFromRecipeBank") {
      return respond(
        household.createMealPlanFromRecipeBank({
          admission: memberAdmission(command.organizationId),
          policy: command.policy,
          request: command.request,
        })
      );
    }
    if (command.operation === "commitRecipeImportDraft") {
      return respond(
        household.commitRecipeImportDraft({
          admission: systemAdmission(
            command.organizationId,
            "recipe_import_lifecycle_commit"
          ),
          evidenceFingerprint: command.evidenceFingerprint,
          expectedGeneration: command.expectedGeneration,
          extractionFingerprint: command.extractionFingerprint,
          intentId: command.intentId,
          mutationId: command.mutationId,
          review: command.review,
        })
      );
    }
    if (command.operation === "cancelRecipeImport") {
      return respond(
        household.cancelRecipeImport({
          admission: memberAdmission(command.organizationId),
          idempotencyKey: command.idempotencyKey,
          intentId: command.intentId,
          request: { expectedIntentVersion: command.expectedIntentVersion },
        })
      );
    }
    if (command.operation === "confirmRecipeImportAction") {
      return respond(
        household.confirmRecipeImportAction({
          actionId: command.actionId,
          admission: memberAdmission(command.organizationId),
          idempotencyKey: command.idempotencyKey,
          intentId: command.intentId,
          request: { expectedActionVersion: command.expectedActionVersion },
        })
      );
    }
    if (command.operation === "confirmRecipeImportActionWithRecipeId") {
      return respond(
        household.confirmRecipeImportActionWithRecipeId(
          {
            actionId: command.actionId,
            admission: memberAdmission(command.organizationId),
            idempotencyKey: command.idempotencyKey,
            intentId: command.intentId,
            request: { expectedActionVersion: command.expectedActionVersion },
          },
          command.recipeId
        )
      );
    }
    if (command.operation === "corruptImportWorkflowDispatchState") {
      return respond(
        household.corruptImportWorkflowDispatchState(
          command.dispatchId,
          command.state
        )
      );
    }
    if (command.operation === "corruptHouseholdProvenanceCreatedAt") {
      return respond(
        household.corruptHouseholdProvenanceCreatedAt(command.createdAtEpochMs)
      );
    }
    if (command.operation === "ensure") {
      return respond(
        household.ensureHousehold({
          admission: memberAdmission(command.organizationId),
        })
      );
    }
    if (command.operation === "inspectMealPlanStorage") {
      return respond(household.inspectMealPlanStorage(command.draftId));
    }
    if (command.operation === "inspectImportWorkflowDispatch") {
      return respond(
        household.inspectImportWorkflowDispatch(command.dispatchId)
      );
    }
    if (command.operation === "invokeMalformedEnsure") {
      return respond(household.invokeMalformedEnsure(command.payload));
    }
    if (command.operation === "recordRecipeImportDispatch") {
      return respond(
        household.recordRecipeImportDispatch({
          admission: systemAdmission(command.organizationId),
          dispatchId: command.dispatchId,
          outcome: command.outcome,
          workflowIdentity: command.workflowIdentity,
        })
      );
    }
    if (command.operation === "listRecipeBank") {
      return respond(
        household.listRecipeBank({
          admission: memberAdmission(command.organizationId),
          byteLimit: command.byteLimit,
          cursor: command.cursor,
          limit: command.limit,
        })
      );
    }
    if (command.operation === "seedApprovedRecipes") {
      return respond(household.seedApprovedRecipes(command.count));
    }
    if (command.operation === "readMealPlan") {
      return respond(
        household.readMealPlan({
          admission: memberAdmission(command.organizationId),
          draftId: command.draftId,
        })
      );
    }
    if (command.operation === "readRecipeImport") {
      return respond(
        household.readRecipeImport({
          admission: memberAdmission(command.organizationId),
          intentId: command.intentId,
        })
      );
    }
    if (command.operation === "rejectMealPlan") {
      return respond(
        household.rejectMealPlan({
          admission: memberAdmission(command.organizationId),
          request: command.request,
        })
      );
    }
    if (command.operation === "resolveRecipeImportSource") {
      return respond(
        household.resolveRecipeImportSource({
          admission: systemAdmission(
            command.organizationId,
            "recipe_import_lifecycle_commit"
          ),
          canonicalSourceId: command.canonicalSourceId,
          canonicalUrl: command.canonicalUrl,
          expectedGeneration: command.expectedGeneration,
          intentId: command.intentId,
          mutationId: command.mutationId,
          sourceKind: command.sourceKind,
        })
      );
    }
    if (command.operation === "transitionRecipeImportLifecycle") {
      return respond(
        household.transitionRecipeImportLifecycle({
          admission: systemAdmission(
            command.organizationId,
            "recipe_import_lifecycle_commit"
          ),
          expectedGeneration: command.expectedGeneration,
          intentId: command.intentId,
          transition: command.transition,
        })
      );
    }
    return respond(
      household.swapMealPlan({
        admission: memberAdmission(command.organizationId),
        approvedRecipes: command.approvedRecipes,
        request: command.request,
      })
    );
  },
};
