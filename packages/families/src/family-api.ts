import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { Context, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/unstable/httpapi";

import { CreateFamily, Family, UpdateFamily } from "./family.js";
import {
  FamilyUnauthorized,
  FamilyForbidden,
  FamilyNotFound,
  FamilyInvalidInput,
  FamilyConflict,
  FamilyUnavailable,
  FamilyRateLimited,
} from "./http-errors.js";

export class FamilySchemaErrors extends HttpApiMiddleware.Service<FamilySchemaErrors>()(
  "FamilySchemaErrors",
  { error: FamilyInvalidInput }
) {}
const errors = [
  FamilyUnauthorized,
  FamilyForbidden,
  FamilyNotFound,
  FamilyConflict,
  FamilyRateLimited,
  FamilyUnavailable,
];
const params = { familyId: HouseholdOrganizationId };
const Families = HttpApiGroup.make("families").add(
  HttpApiEndpoint.get("list", "/v1/families", {
    error: errors,
    success: Schema.Array(Family),
  }),
  HttpApiEndpoint.get("get", "/v1/families/:familyId", {
    error: errors,
    params,
    success: Family,
  }),
  HttpApiEndpoint.post("create", "/v1/families", {
    error: errors,
    payload: CreateFamily,
    success: Family,
  }),
  HttpApiEndpoint.post(
    "resumeCreation",
    "/v1/families/:familyId/resume-creation",
    { error: errors, params, success: Family }
  ),
  HttpApiEndpoint.patch("update", "/v1/families/:familyId", {
    error: errors,
    params,
    payload: UpdateFamily,
    success: Family,
  }),
  HttpApiEndpoint.post("complete", "/v1/families/:familyId/complete-setup", {
    error: errors,
    params,
    success: Family,
  })
);
export const FamilyApi = HttpApi.make("familyApi")
  .add(Families)
  .middleware(FamilySchemaErrors);
export type FamilyApiClient = HttpApiClient.ForApi<typeof FamilyApi>;
export const FamilyApiClient = Context.Service<FamilyApiClient>(
  "meal-planner/FamilyApiClient"
);
export const makeFamilyApiClientLayer = (options: {
  readonly baseUrl: string;
  readonly headers: Readonly<Record<string, string>>;
}) =>
  Layer.effect(
    FamilyApiClient,
    HttpApiClient.make(FamilyApi, {
      baseUrl: options.baseUrl,
      transformClient: (client) =>
        client.pipe(
          HttpClient.mapRequest((request) =>
            request.pipe(HttpClientRequest.setHeaders(options.headers))
          )
        ),
    })
  );
