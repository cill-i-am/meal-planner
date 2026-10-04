import type {
  HouseholdOrganizationId,
  UserId,
} from "@meal-planner/household-api";

import { apiEffectQuery } from "../api-client/index.js";
import type { ApiRuntime } from "../api-client/index.js";
import { makeHouseholdPeopleEffectOperations } from "../household-people/index.js";
import { familyKeys } from "./family-operations.js";

export const familyRosterQueryOptions = (
  runtime: ApiRuntime,
  userId: typeof UserId.Type,
  organizationId: typeof HouseholdOrganizationId.Type | undefined
) =>
  apiEffectQuery.queryOptions({
    enabled: organizationId !== undefined,
    queryFn: () => {
      if (organizationId === undefined) {
        throw new Error("A family is required.");
      }
      return makeHouseholdPeopleEffectOperations(
        {
          organizationId,
          userId,
        },
        runtime
      ).list(false);
    },
    queryKey: familyKeys.people(userId, organizationId),
    retry: false,
    staleTime: 30_000,
  });
