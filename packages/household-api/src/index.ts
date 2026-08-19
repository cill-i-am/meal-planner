import { Context, Layer, Schema } from "effect";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import type { HouseholdCurrentPrincipal } from "./household-principal.js";
import { HouseholdOrganizationId } from "./household-principal.js";

export {
  HouseholdCurrentPrincipal,
  HouseholdOrganizationId,
  HouseholdPrincipal,
} from "./household-principal.js";

export const HouseholdStatus = Schema.Struct({
  createdAtEpochMs: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  organizationId: HouseholdOrganizationId,
  status: Schema.Literal("ready"),
});
export type HouseholdStatus = typeof HouseholdStatus.Type;

const ProblemDetails = <const Status extends number, const Code extends string>(
  status: Status,
  code: Code
) =>
  Schema.Struct({
    code: Schema.Literal(code),
    message: Schema.String,
    status: Schema.Literal(status),
  }).pipe(
    HttpApiSchema.status(status),
    HttpApiSchema.asJson({ contentType: "application/problem+json" })
  );

export const HouseholdUnauthorizedProblem = ProblemDetails(401, "unauthorized");
export const HouseholdInternalProblem = ProblemDetails(500, "internal_error");

export class HouseholdSessionAuth extends HttpApiMiddleware.Service<
  HouseholdSessionAuth,
  { provides: HouseholdCurrentPrincipal }
>()("HouseholdSessionAuth", { error: HouseholdUnauthorizedProblem }) {}

const HouseholdsGroup = HttpApiGroup.make("households")
  .add(
    HttpApiEndpoint.get("current", "/v1/household", {
      error: HouseholdInternalProblem,
      success: HouseholdStatus,
    })
  )
  .middleware(HouseholdSessionAuth);

export const HouseholdApi = HttpApi.make("householdApi").add(HouseholdsGroup);

export type HouseholdApiClient = HttpApiClient.ForApi<typeof HouseholdApi>;

export const HouseholdApiClient = Context.Service<HouseholdApiClient>(
  "meal-planner/HouseholdApiClient"
);

export const makeHouseholdApiClientLayer = (options: {
  readonly baseUrl: string | URL;
}) =>
  Layer.effect(
    HouseholdApiClient,
    HttpApiClient.make(HouseholdApi, { baseUrl: options.baseUrl })
  );
