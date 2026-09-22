import { Context, Schema } from "effect";

import { OpaqueAuthId } from "./auth-values.js";

export const HouseholdOrganizationId = OpaqueAuthId.pipe(
  Schema.brand("HouseholdOrganizationId")
);
export type HouseholdOrganizationId = typeof HouseholdOrganizationId.Type;

export const HouseholdPrincipal = Schema.Struct({
  organizationId: HouseholdOrganizationId,
});
export type HouseholdPrincipal = typeof HouseholdPrincipal.Type;

export class HouseholdCurrentPrincipal extends Context.Service<
  HouseholdCurrentPrincipal,
  HouseholdPrincipal
>()("meal-planner/HouseholdCurrentPrincipal") {}
