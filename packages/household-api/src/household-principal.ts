import { Context, Schema } from "effect";

export const HouseholdOrganizationId = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(255)
  ),
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
