import { Context, Layer } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";

import {
  MutatePlanningContentPayload,
  PlanningContentSnapshot,
  SavedRecipePage,
  SavedRecipePageQuery,
} from "./meal-content.js";
import { ProblemDetails } from "./problem-details.js";

export const HouseholdPlanningContentInvalidProblem = ProblemDetails(
  400,
  "invalid_request"
);
export const HouseholdPlanningContentConflictProblem = ProblemDetails(
  409,
  "planning_content_conflict"
);
export const HouseholdPlanningContentUnavailableProblem = ProblemDetails(
  503,
  "planning_content_unavailable"
);

export const HouseholdPlanningContentGroup = HttpApiGroup.make(
  "planningContent"
).add(
  HttpApiEndpoint.get(
    "listSavedRecipes",
    "/v1/planning-content/saved-recipes",
    {
      error: HouseholdPlanningContentUnavailableProblem,
      query: SavedRecipePageQuery,
      success: SavedRecipePage,
    }
  ),
  HttpApiEndpoint.get("read", "/v1/planning-content", {
    error: HouseholdPlanningContentUnavailableProblem,
    success: PlanningContentSnapshot,
  }),
  HttpApiEndpoint.post("mutate", "/v1/planning-content", {
    error: [
      HouseholdPlanningContentInvalidProblem,
      HouseholdPlanningContentConflictProblem,
      HouseholdPlanningContentUnavailableProblem,
    ],
    payload: MutatePlanningContentPayload,
    success: PlanningContentSnapshot,
  })
);

export const HouseholdPlanningContentApi = HttpApi.make(
  "householdPlanningContentApi"
).add(HouseholdPlanningContentGroup);
export type HouseholdPlanningContentApiClient = HttpApiClient.ForApi<
  typeof HouseholdPlanningContentApi
>;
export const HouseholdPlanningContentApiClient =
  Context.Service<HouseholdPlanningContentApiClient>(
    "meal-planner/HouseholdPlanningContentApiClient"
  );
export const makeHouseholdPlanningContentApiClientLayer = (options: {
  readonly baseUrl: string | URL;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}) =>
  Layer.effect(
    HouseholdPlanningContentApiClient,
    HttpApiClient.make(HouseholdPlanningContentApi, {
      baseUrl: options.baseUrl,
      transformClient: (client) =>
        HttpClient.mapRequest(
          client,
          HttpClientRequest.setHeaders(options.headers ?? {})
        ),
    })
  );
