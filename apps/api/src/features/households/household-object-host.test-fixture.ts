import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { Context, Effect, Schema } from "effect";

import migrations from "../../../household-migrations/migrations.js";
import { ApprovedRecipe } from "../imports/import-recipe-review.js";
import {
  ManualMealSwapRequest,
  MealPlan,
  MealPlanDecisionRequest,
  MealPlanDraftId,
  MealPlanPolicy,
  MealPlanRequest,
} from "../meal-planning/meal-plan.js";
import type { MealPlanServiceError } from "../meal-planning/meal-plan.js";
import { HouseholdObjectRuntime } from "./household-object.js";
import * as RecipeBankContract from "./household-recipe-bank.contract.js";
import type {
  HouseholdDomainFailure,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdEnsureInput } from "./household.contract.js";
import {
  householdMealPlans,
  householdRecipeBank,
} from "./household.database-schema.js";

const ApprovedRecipeWire = Schema.toEncoded(ApprovedRecipe);
const HouseholdAnswerRecipeReviewInputSchema =
  RecipeBankContract.HouseholdAnswerRecipeReviewInput;
const HouseholdOpenRecipeReviewInputSchema =
  RecipeBankContract.HouseholdOpenRecipeReviewInput;
const HouseholdReadRecipeReviewInputSchema =
  RecipeBankContract.HouseholdReadRecipeReviewInput;
const HouseholdTransitionRecipeReviewInputSchema =
  RecipeBankContract.HouseholdTransitionRecipeReviewInput;
const MealPlanWire = Schema.toEncoded(MealPlan);
const MealPlanPolicyWire = Schema.toEncoded(MealPlanPolicy);
const MealPlanRequestWire = Schema.toEncoded(MealPlanRequest);
const ManualMealSwapRequestWire = Schema.toEncoded(ManualMealSwapRequest);
const MealPlanDecisionRequestWire = Schema.toEncoded(MealPlanDecisionRequest);

const alchemyRuntimeContractKey = "shape";
const HouseholdObjectTestRuntime = Effect.gen(
  function* initializeHouseholdObjectTestRuntime() {
    const household = yield* yield* HouseholdObjectRuntime;
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
    return Effect.succeed({
      ...household,
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
      seedApprovedRecipes: (
        recipes: readonly (typeof ApprovedRecipeWire.Type)[]
      ) =>
        scoped(
          Effect.gen(function* seedHouseholdRecipeBank() {
            const connection = yield* database;
            yield* Effect.all(
              recipes.map((wire) =>
                Effect.gen(function* seedApprovedRecipe() {
                  const recipe =
                    yield* Schema.decodeUnknownEffect(ApprovedRecipe)(wire);
                  yield* connection
                    .insert(householdRecipeBank)
                    .values({
                      approvedRecipeJson: Schema.encodeSync(
                        Schema.fromJsonString(ApprovedRecipe)
                      )(recipe),
                      importId: recipe.importId,
                      reviewVersion: recipe.version,
                    })
                    .onConflictDoUpdate({
                      set: {
                        approvedRecipeJson: Schema.encodeSync(
                          Schema.fromJsonString(ApprovedRecipe)
                        )(recipe),
                        reviewVersion: recipe.version,
                      },
                      target: householdRecipeBank.importId,
                    });
                })
              ),
              { discard: true }
            );
          })
        ),
    });
  }
);
const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({
      HouseholdObject: {
        constructor: HouseholdObjectTestRuntime,
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

type RecipeReviewFailure =
  | HouseholdDomainFailure
  | RecipeBankContract.RecipeReviewMutationConflict
  | RecipeBankContract.RecipeReviewNotFound
  | RecipeBankContract.RecipeReviewOpenConflict
  | RecipeBankContract.RecipeReviewTransitionRejected
  | RecipeBankContract.RecipeReviewVersionConflict;

interface HouseholdObjectClient {
  readonly answerRecipeReview: (
    input: RecipeBankContract.HouseholdAnswerRecipeReviewInput
  ) => Effect.Effect<
    RecipeBankContract.HouseholdRecipeReviewWire,
    RecipeReviewFailure
  >;
  readonly approveMealPlan: (input: {
    readonly organizationId: HouseholdEnsureInput["organizationId"];
    readonly request: typeof MealPlanDecisionRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly createMealPlan: (input: {
    readonly organizationId: HouseholdEnsureInput["organizationId"];
    readonly policy: typeof MealPlanPolicyWire.Type;
    readonly request: typeof MealPlanRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly ensureHousehold: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
  readonly inspectMealPlanStorage: (draftId: MealPlanDraftId) => Effect.Effect<{
    readonly planJsonBytes: number;
    readonly replayKeyBytes: number;
  } | null>;
  readonly listApprovedRecipes: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<
    readonly RecipeBankContract.HouseholdApprovedRecipeWire[],
    HouseholdDomainFailure
  >;
  readonly openRecipeReview: (
    input: RecipeBankContract.HouseholdOpenRecipeReviewInput
  ) => Effect.Effect<
    RecipeBankContract.HouseholdRecipeReviewWire,
    HouseholdDomainFailure | RecipeBankContract.RecipeReviewOpenConflict
  >;
  readonly readMealPlan: (input: {
    readonly draftId: MealPlanDraftId;
    readonly organizationId: HouseholdEnsureInput["organizationId"];
  }) => Effect.Effect<
    typeof MealPlanWire.Type | null,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly readRecipeReview: (
    input: RecipeBankContract.HouseholdReadRecipeReviewInput
  ) => Effect.Effect<
    RecipeBankContract.HouseholdRecipeReviewWire,
    RecipeReviewFailure
  >;
  readonly rejectMealPlan: (input: {
    readonly organizationId: HouseholdEnsureInput["organizationId"];
    readonly request: typeof MealPlanDecisionRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly swapMealPlan: (input: {
    readonly organizationId: HouseholdEnsureInput["organizationId"];
    readonly request: typeof ManualMealSwapRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly seedApprovedRecipes: (
    recipes: readonly (typeof ApprovedRecipeWire.Type)[]
  ) => Effect.Effect<void>;
  readonly transitionRecipeReview: (
    input: RecipeBankContract.HouseholdTransitionRecipeReviewInput
  ) => Effect.Effect<
    RecipeBankContract.HouseholdRecipeReviewWire,
    RecipeReviewFailure
  >;
}

const HouseholdTestCommand = Schema.Union([
  Schema.Struct({
    ...HouseholdAnswerRecipeReviewInputSchema.fields,
    objectName: Schema.String,
    operation: Schema.Literal("answerRecipeReview"),
  }),
  Schema.Struct({
    ...HouseholdOpenRecipeReviewInputSchema.fields,
    objectName: Schema.String,
    operation: Schema.Literal("openRecipeReview"),
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("approveMealPlan"),
    organizationId: HouseholdEnsureInput.fields.organizationId,
    request: MealPlanDecisionRequestWire,
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("ensure"),
    organizationId: HouseholdEnsureInput.fields.organizationId,
  }),
  Schema.Struct({
    approvedRecipes: Schema.Array(ApprovedRecipeWire),
    objectName: Schema.String,
    operation: Schema.Literal("createMealPlan"),
    organizationId: HouseholdEnsureInput.fields.organizationId,
    policy: MealPlanPolicyWire,
    request: MealPlanRequestWire,
  }),
  Schema.Struct({
    draftId: MealPlanDraftId,
    objectName: Schema.String,
    operation: Schema.Literal("inspectMealPlanStorage"),
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("listApprovedRecipes"),
    organizationId: HouseholdEnsureInput.fields.organizationId,
  }),
  Schema.Struct({
    draftId: MealPlanDraftId,
    objectName: Schema.String,
    operation: Schema.Literal("readMealPlan"),
    organizationId: HouseholdEnsureInput.fields.organizationId,
  }),
  Schema.Struct({
    ...HouseholdReadRecipeReviewInputSchema.fields,
    objectName: Schema.String,
    operation: Schema.Literal("readRecipeReview"),
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("rejectMealPlan"),
    organizationId: HouseholdEnsureInput.fields.organizationId,
    request: MealPlanDecisionRequestWire,
  }),
  Schema.Struct({
    approvedRecipes: Schema.Array(ApprovedRecipeWire),
    objectName: Schema.String,
    operation: Schema.Literal("swapMealPlan"),
    organizationId: HouseholdEnsureInput.fields.organizationId,
    request: ManualMealSwapRequestWire,
  }),
  Schema.Struct({
    ...HouseholdTransitionRecipeReviewInputSchema.fields,
    objectName: Schema.String,
    operation: Schema.Literal("transitionRecipeReview"),
  }),
]);

interface HouseholdTestEnv {
  readonly HouseholdObject: {
    readonly getByName: (name: string) => object;
  };
}

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
  fetch: async (request: Request, env: HouseholdTestEnv) => {
    const command = await Schema.decodeUnknownPromise(HouseholdTestCommand)(
      await request.json()
    );
    const household = Cloudflare.makeRpcStub<HouseholdObjectClient>(
      env.HouseholdObject.getByName(command.objectName)
    );
    if (command.operation === "answerRecipeReview") {
      return respond(household.answerRecipeReview(command));
    }
    if (command.operation === "approveMealPlan") {
      return respond(
        household.approveMealPlan({
          organizationId: command.organizationId,
          request: command.request,
        })
      );
    }
    if (command.operation === "createMealPlan") {
      return respond(
        household.seedApprovedRecipes(command.approvedRecipes).pipe(
          Effect.flatMap(() =>
            household.createMealPlan({
              organizationId: command.organizationId,
              policy: command.policy,
              request: command.request,
            })
          )
        )
      );
    }
    if (command.operation === "ensure") {
      return respond(
        household.ensureHousehold({
          organizationId: command.organizationId,
        })
      );
    }
    if (command.operation === "inspectMealPlanStorage") {
      return respond(household.inspectMealPlanStorage(command.draftId));
    }
    if (command.operation === "listApprovedRecipes") {
      return respond(
        household.listApprovedRecipes({
          organizationId: command.organizationId,
        })
      );
    }
    if (command.operation === "openRecipeReview") {
      return respond(
        household.openRecipeReview({
          openedAt: command.openedAt,
          organizationId: command.organizationId,
          snapshot: command.snapshot,
        })
      );
    }
    if (command.operation === "readMealPlan") {
      return respond(
        household.readMealPlan({
          draftId: command.draftId,
          organizationId: command.organizationId,
        })
      );
    }
    if (command.operation === "readRecipeReview") {
      return respond(household.readRecipeReview(command));
    }
    if (command.operation === "rejectMealPlan") {
      return respond(
        household.rejectMealPlan({
          organizationId: command.organizationId,
          request: command.request,
        })
      );
    }
    if (command.operation === "transitionRecipeReview") {
      return respond(household.transitionRecipeReview(command));
    }
    return respond(
      household.seedApprovedRecipes(command.approvedRecipes).pipe(
        Effect.flatMap(() =>
          household.swapMealPlan({
            organizationId: command.organizationId,
            request: command.request,
          })
        )
      )
    );
  },
};
