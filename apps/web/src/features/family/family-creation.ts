import type { CreateFamily } from "@meal-planner/families";
import type { UserId } from "@meal-planner/household-api";

import { familyEffectQuery, familyOperation } from "./family-operations.js";

export const familyCreationMutationOptions = (userId: UserId) =>
  familyEffectQuery.mutationOptions({
    mutationFn: (payload: CreateFamily) =>
      familyOperation(userId, (api) => api.families.create({ payload })),
    mutationKey: ["families", userId, "create"],
  });
