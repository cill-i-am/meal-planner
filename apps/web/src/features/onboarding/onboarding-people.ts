import type {
  HouseholdOrganizationId,
  UserId,
} from "@meal-planner/household-api";
import { Layer } from "effect";
import { createEffectQuery } from "effect-query";

import { makeBrowserHouseholdPeopleEffectOperations } from "../household-people/browser-operations.js";

export const setupEffectQuery = createEffectQuery(Layer.empty);

export const onboardingRosterQueryOptions = (
  userId: typeof UserId.Type,
  organizationId: typeof HouseholdOrganizationId.Type | undefined
) =>
  setupEffectQuery.queryOptions({
    enabled: organizationId !== undefined,
    queryFn: () => {
      if (organizationId === undefined) {
        throw new Error("A family is required.");
      }
      return makeBrowserHouseholdPeopleEffectOperations({
        organizationId,
        userId,
      }).list(false);
    },
    queryKey: ["setup-roster", organizationId, userId],
  });
