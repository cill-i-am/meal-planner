import type {
  HouseholdOrganizationId,
  UserId,
} from "@meal-planner/household-api";
import { Layer } from "effect";
import { createEffectQuery } from "effect-query";

import { makeBrowserHouseholdPeopleEffectOperations } from "../household-people/client.js";
import { familyKeys } from "./family-operations.js";

export const peopleEffectQuery = createEffectQuery(Layer.empty);

export const familyRosterQueryOptions = (
  userId: typeof UserId.Type,
  organizationId: typeof HouseholdOrganizationId.Type | undefined
) =>
  peopleEffectQuery.queryOptions({
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
    queryKey: familyKeys.people(userId, organizationId),
  });
