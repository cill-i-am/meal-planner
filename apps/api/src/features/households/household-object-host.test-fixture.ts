import * as Cloudflare from "alchemy/Cloudflare";
import { DurableObject } from "cloudflare:workers";
import { Context, Effect, Schema } from "effect";

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
import type {
  HouseholdDomainFailure,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdEnsureInput } from "./household.contract.js";

const ApprovedRecipeWire = Schema.toEncoded(ApprovedRecipe);
const MealPlanWire = Schema.toEncoded(MealPlan);
const MealPlanPolicyWire = Schema.toEncoded(MealPlanPolicy);
const MealPlanRequestWire = Schema.toEncoded(MealPlanRequest);
const ManualMealSwapRequestWire = Schema.toEncoded(ManualMealSwapRequest);
const MealPlanDecisionRequestWire = Schema.toEncoded(MealPlanDecisionRequest);

const alchemyRuntimeContractKey = "shape";
const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({
      HouseholdObject: {
        constructor: HouseholdObjectRuntime,
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

interface HouseholdObjectClient {
  readonly approveMealPlan: (input: {
    readonly organizationId: HouseholdEnsureInput["organizationId"];
    readonly request: typeof MealPlanDecisionRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly createMealPlan: (input: {
    readonly approvedRecipes: readonly (typeof ApprovedRecipeWire.Type)[];
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
  readonly readMealPlan: (input: {
    readonly draftId: MealPlanDraftId;
    readonly organizationId: HouseholdEnsureInput["organizationId"];
  }) => Effect.Effect<
    typeof MealPlanWire.Type | null,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly rejectMealPlan: (input: {
    readonly organizationId: HouseholdEnsureInput["organizationId"];
    readonly request: typeof MealPlanDecisionRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly swapMealPlan: (input: {
    readonly approvedRecipes: readonly (typeof ApprovedRecipeWire.Type)[];
    readonly organizationId: HouseholdEnsureInput["organizationId"];
    readonly request: typeof ManualMealSwapRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
}

const HouseholdTestCommand = Schema.Union([
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
    operation: Schema.Literal("readMealPlan"),
    organizationId: HouseholdEnsureInput.fields.organizationId,
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
        household.createMealPlan({
          approvedRecipes: command.approvedRecipes,
          organizationId: command.organizationId,
          policy: command.policy,
          request: command.request,
        })
      );
    }
    if (command.operation === "ensure") {
      return respond(
        household.ensureHousehold({
          organizationId: command.organizationId,
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
    if (command.operation === "rejectMealPlan") {
      return respond(
        household.rejectMealPlan({
          organizationId: command.organizationId,
          request: command.request,
        })
      );
    }
    return respond(
      household.swapMealPlan({
        approvedRecipes: command.approvedRecipes,
        organizationId: command.organizationId,
        request: command.request,
      })
    );
  },
};
