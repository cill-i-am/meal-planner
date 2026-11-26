import {
  MealPlan,
  MealPlanSummary,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanRequest,
  PlanningContentSnapshot,
  SavedRecipePage,
  PlanningContentRejected,
  ChangeMealPlanPayload,
  DecideMealPlanPayload,
  MutatePlanningContentPayload,
  SavedRecipePageQuery,
} from "@meal-planner/household-api";
import type {
  HouseholdPeoplePrincipal,
  MealPlanId,
} from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

import type {
  HouseholdChangeMealPlanInput,
  HouseholdCreateMealPlanInput,
  HouseholdDecideMealPlanInput,
  HouseholdListSavedRecipesInput,
  HouseholdMealPlanWire,
  HouseholdMealPlanSummaryListWire,
  HouseholdMutatePlanningContentInput,
  HouseholdPlanningContentWire,
  HouseholdReadPlanningContentInput,
  HouseholdReadMealPlanInput,
  HouseholdSavedRecipePageWire,
} from "./household-meal-plan.contract.js";
import type { HouseholdDomainFailure } from "./household.contract.js";
import type {
  HouseholdMealPlanGateway,
  HouseholdPlanningContentGateway,
  HouseholdMealPlanFailure,
} from "./household.gateway.js";
import { makeHouseholdPeopleAdmission } from "./rpc/command-envelope.js";

type MealPlanDomainFailure =
  | HouseholdDomainFailure
  | HouseholdMealPlanFailure
  | PlanningContentRejected;

interface HouseholdMealPlanDomainPort {
  readonly createMealPlan: (
    input: HouseholdCreateMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly readMealPlan: (
    input: HouseholdReadMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire | null, MealPlanDomainFailure>;
  readonly listMealPlans: (
    input: HouseholdReadPlanningContentInput
  ) => Effect.Effect<HouseholdMealPlanSummaryListWire, MealPlanDomainFailure>;
  readonly changeMealPlan: (
    input: HouseholdChangeMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly approveMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly proposeMealPlanRevision: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly acceptMealPlanRevision: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly rejectMealPlanRevision: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly readPlanningContent: (
    input: HouseholdReadPlanningContentInput
  ) => Effect.Effect<HouseholdPlanningContentWire, MealPlanDomainFailure>;
  readonly mutatePlanningContent: (
    input: HouseholdMutatePlanningContentInput
  ) => Effect.Effect<HouseholdPlanningContentWire, MealPlanDomainFailure>;
  readonly listSavedRecipes: (
    input: HouseholdListSavedRecipesInput
  ) => Effect.Effect<HouseholdSavedRecipePageWire, MealPlanDomainFailure>;
}

const persistenceFailure = (operation: "create" | "read" | "save") =>
  MealPlanPersistenceFailure.make({ operation });

const mapPlanFailure = (
  error: MealPlanDomainFailure,
  operation: "create" | "read" | "save"
) => {
  switch (error._tag) {
    case "MealPlanMutationConflict":
    case "MealPlanNotFound":
    case "MealPlanPersistenceFailure":
    case "MealPlanRequestConflict":
    case "MealPlanRuleViolation":
    case "MealPlanTransitionRejected":
    case "MealPlanVersionConflict": {
      const checkedResult: HouseholdMealPlanFailure = error;
      return checkedResult;
    }
    default: {
      const checkedResult: HouseholdMealPlanFailure =
        persistenceFailure(operation);
      return checkedResult;
    }
  }
};

const decodePlanResponse = <A>(
  schema: Schema.Decoder<A, never>,
  wire: HouseholdMealPlanWire | HouseholdMealPlanSummaryListWire
) =>
  Schema.decodeUnknownEffect(schema)(wire).pipe(
    Effect.mapError(() => persistenceFailure("read"))
  );

type PeopleAdmission = Effect.Success<
  ReturnType<typeof makeHouseholdPeopleAdmission>
>;

const callPlan = <Wire, Result>(
  principal: HouseholdPeoplePrincipal,
  operation: "create" | "read" | "save",
  invoke: (
    admission: PeopleAdmission
  ) => Effect.Effect<Wire, MealPlanDomainFailure>,
  decode: (wire: Wire) => Effect.Effect<Result, HouseholdMealPlanFailure>
) => {
  const onInvocationFailure = (error: MealPlanDomainFailure) =>
    mapPlanFailure(error, operation);
  return Effect.gen(function* callAdmittedPlan() {
    const admission = yield* makeHouseholdPeopleAdmission(principal).pipe(
      Effect.mapError(() => persistenceFailure("read"))
    );
    const wire = yield* invoke(admission).pipe(
      Effect.mapError(onInvocationFailure)
    );
    return yield* decode(wire);
  });
};

const decodeMealPlan = (wire: HouseholdMealPlanWire) =>
  decodePlanResponse(MealPlan, wire);

export const makeHouseholdMealPlanGateway = (options: {
  readonly domain: HouseholdMealPlanDomainPort;
}) => {
  const decision = (
    method:
      | "approveMealPlan"
      | "proposeMealPlanRevision"
      | "acceptMealPlanRevision"
      | "rejectMealPlanRevision",
    input: {
      readonly planId: MealPlanId;
      readonly payload: DecideMealPlanPayload;
      readonly principal: HouseholdPeoplePrincipal;
    }
  ) =>
    callPlan(
      input.principal,
      "save",
      (admission) =>
        options.domain[method]({
          admission,
          payload: Schema.encodeSync(DecideMealPlanPayload)(input.payload),
          planId: input.planId,
        }),
      decodeMealPlan
    );
  const checkedResult: HouseholdMealPlanGateway = {
    acceptRevision: (input) => decision("acceptMealPlanRevision", input),
    approve: (input) => decision("approveMealPlan", input),
    change: ({ planId, payload, principal }) =>
      callPlan(
        principal,
        "save",
        (admission) =>
          options.domain.changeMealPlan({
            admission,
            payload: Schema.encodeSync(ChangeMealPlanPayload)(payload),
            planId,
          }),
        decodeMealPlan
      ),
    create: ({ payload, principal }) =>
      callPlan(
        principal,
        "create",
        (admission) =>
          options.domain.createMealPlan({
            admission,
            request: Schema.encodeSync(MealPlanRequest)(payload),
          }),
        decodeMealPlan
      ),
    list: ({ principal }) =>
      callPlan(
        principal,
        "read",
        (admission) => options.domain.listMealPlans({ admission }),
        (wire) => decodePlanResponse(Schema.Array(MealPlanSummary), wire)
      ),
    proposeRevision: (input) => decision("proposeMealPlanRevision", input),
    read: ({ planId, principal }) =>
      callPlan(
        principal,
        "read",
        (admission) => options.domain.readMealPlan({ admission, planId }),
        (wire) =>
          wire === null
            ? Effect.fail(MealPlanNotFound.make({ planId }))
            : decodeMealPlan(wire)
      ),
    rejectRevision: (input) => decision("rejectMealPlanRevision", input),
  };
  return checkedResult;
};

const planningContentUnavailable = () =>
  PlanningContentRejected.make({ reason: "unavailable" });

const planningContentFailure = (error: MealPlanDomainFailure) => {
  const checkedResult: PlanningContentRejected =
    error._tag === "PlanningContentRejected"
      ? error
      : planningContentUnavailable();
  return checkedResult;
};

const callPlanningContent = <A>(
  principal: HouseholdPeoplePrincipal,
  invoke: (
    admission: PeopleAdmission
  ) => Effect.Effect<unknown, MealPlanDomainFailure>,
  schema: Schema.Decoder<A, never>
) =>
  makeHouseholdPeopleAdmission(principal).pipe(
    Effect.mapError(planningContentUnavailable),
    Effect.flatMap((admission) =>
      invoke(admission).pipe(Effect.mapError(planningContentFailure))
    ),
    Effect.flatMap((wire) =>
      Schema.decodeUnknownEffect(schema)(wire).pipe(
        Effect.mapError(planningContentUnavailable)
      )
    )
  );

export const makeHouseholdPlanningContentGateway = (options: {
  readonly domain: HouseholdMealPlanDomainPort;
}) => {
  const checkedResult: HouseholdPlanningContentGateway = {
    listSavedRecipes: ({ principal, query }) =>
      callPlanningContent(
        principal,
        (admission) =>
          options.domain.listSavedRecipes({
            admission,
            query: Schema.encodeSync(SavedRecipePageQuery)(query),
          }),
        SavedRecipePage
      ),
    mutate: ({ principal, payload }) =>
      callPlanningContent(
        principal,
        (admission) =>
          options.domain.mutatePlanningContent({
            admission,
            payload: Schema.encodeSync(MutatePlanningContentPayload)(payload),
          }),
        PlanningContentSnapshot
      ),
    read: (principal) =>
      callPlanningContent(
        principal,
        (admission) => options.domain.readPlanningContent({ admission }),
        PlanningContentSnapshot
      ),
  };
  return checkedResult;
};
