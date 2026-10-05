import {
  HouseholdMealPlanApiClient,
  makeHouseholdMealPlanApiClientLayer,
} from "@meal-planner/household-api";
import type {
  ChangeMealPlanPayload,
  CreateMealPlanPayload,
  DecideMealPlanPayload,
  MealPlanId,
} from "@meal-planner/household-api";
import { Data, Effect, Layer } from "effect";
import { createEffectQuery } from "effect-query";

import { apiHttpLayer } from "../api-client/index.js";
import type { ApiRuntime } from "../api-client/index.js";
import { displayedIdentityHeaders } from "../auth/index.js";
import type { DisplayedIdentity } from "../auth/index.js";

const effectQuery = createEffectQuery(Layer.empty);

export class MealPlanOperationFailure extends Data.TaggedError(
  "MealPlanOperationFailure"
)<{
  readonly cause: unknown;
}> {}

export const mealPlanKey = (scope: DisplayedIdentity) =>
  ["meal-plans", scope.userId, scope.organizationId] as const;

const withClient = <A, E>(
  runtime: ApiRuntime,
  scope: DisplayedIdentity,
  operation: (api: HouseholdMealPlanApiClient) => Effect.Effect<A, E>
) =>
  HouseholdMealPlanApiClient.use(operation).pipe(
    Effect.provide(
      makeHouseholdMealPlanApiClientLayer({
        baseUrl: runtime.baseUrl,
        headers: displayedIdentityHeaders(scope),
      })
    ),
    Effect.provide(apiHttpLayer(runtime)),
    Effect.mapError((cause) => new MealPlanOperationFailure({ cause }))
  );

export const mealPlanListQueryOptions = (
  runtime: ApiRuntime,
  scope: DisplayedIdentity
) =>
  effectQuery.queryOptions({
    queryFn: () => withClient(runtime, scope, (api) => api.mealPlans.list()),
    queryKey: [...mealPlanKey(scope), "list"],
    retry: false,
    staleTime: 30_000,
  });

export const mealPlanDetailQueryOptions = (
  runtime: ApiRuntime,
  scope: DisplayedIdentity,
  planId: MealPlanId | undefined
) =>
  effectQuery.queryOptions({
    enabled: planId !== undefined,
    queryFn: () => {
      if (planId === undefined) {
        throw new Error("A plan is required.");
      }
      return withClient(runtime, scope, (api) =>
        api.mealPlans.read({ params: { planId } })
      );
    },
    queryKey: [...mealPlanKey(scope), "detail", planId],
    retry: false,
    staleTime: 0,
  });

export const createMealPlanMutationOptions = (
  runtime: ApiRuntime,
  scope: DisplayedIdentity
) =>
  effectQuery.mutationOptions({
    mutationFn: (payload: CreateMealPlanPayload) =>
      withClient(runtime, scope, (api) => api.mealPlans.create({ payload })),
    mutationKey: [...mealPlanKey(scope), "create"],
  });

export const changeMealPlanMutationOptions = (
  runtime: ApiRuntime,
  scope: DisplayedIdentity
) =>
  effectQuery.mutationOptions({
    mutationFn: ({
      planId,
      payload,
    }: {
      readonly planId: MealPlanId;
      readonly payload: ChangeMealPlanPayload;
    }) =>
      withClient(runtime, scope, (api) =>
        api.mealPlans.change({ params: { planId }, payload })
      ),
    mutationKey: [...mealPlanKey(scope), "change"],
  });

export type PlanDecision =
  | "approve"
  | "proposeRevision"
  | "acceptRevision"
  | "rejectRevision";
export const decideMealPlanMutationOptions = (
  runtime: ApiRuntime,
  scope: DisplayedIdentity,
  decision: PlanDecision
) =>
  effectQuery.mutationOptions({
    mutationFn: ({
      planId,
      payload,
    }: {
      readonly planId: MealPlanId;
      readonly payload: DecideMealPlanPayload;
    }) =>
      withClient(runtime, scope, (api) => {
        const input = { params: { planId }, payload };
        switch (decision) {
          case "approve": {
            return api.mealPlans.approve(input);
          }
          case "proposeRevision": {
            return api.mealPlans.proposeRevision(input);
          }
          case "acceptRevision": {
            return api.mealPlans.acceptRevision(input);
          }
          case "rejectRevision": {
            return api.mealPlans.rejectRevision(input);
          }
          default: {
            throw new Error("Unsupported plan decision.");
          }
        }
      }),
    mutationKey: [...mealPlanKey(scope), decision],
  });
