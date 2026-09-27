import type {
  HouseholdOrganizationId,
  UserId,
} from "@meal-planner/household-api";
import { Layer } from "effect";
import { createEffectQuery } from "effect-query";

import type { ApiRuntime } from "../api-client/index.js";
import { makeHouseholdPeopleEffectOperations } from "../household-people/client.js";
import { familyKeys } from "./family-operations.js";

export const peopleEffectQuery = createEffectQuery(Layer.empty);

export const familyRosterQueryOptions = (
  runtime: ApiRuntime,
  userId: typeof UserId.Type,
  organizationId: typeof HouseholdOrganizationId.Type | undefined
) =>
  peopleEffectQuery.queryOptions({
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
