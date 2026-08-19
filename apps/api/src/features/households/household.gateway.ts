import type {
  HouseholdOrganizationId,
  HouseholdStatus,
} from "@meal-planner/household-api";
import type { Effect } from "effect";
import { Context } from "effect";

import type { HouseholdDomainFailure } from "./household.contract.js";

export interface HouseholdDomainGateway {
  readonly ensure: (
    organizationId: HouseholdOrganizationId
  ) => Effect.Effect<HouseholdStatus, HouseholdDomainFailure>;
}

export const HouseholdDomainGateway = Context.Service<HouseholdDomainGateway>(
  "meal-planner/HouseholdDomainGateway"
);
