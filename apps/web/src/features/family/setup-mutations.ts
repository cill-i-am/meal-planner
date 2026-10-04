import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiEffectQuery, useApiRuntime } from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import { familyKeys, familyOperation } from "./family-operations.js";

export const useResumeFamilyCreation = (familyId: HouseholdOrganizationId) => {
  const runtime = useApiRuntime();
  const { user } = useAccount();
  const queryClient = useQueryClient();
  return useMutation(
    apiEffectQuery.mutationOptions({
      mutationFn: () =>
        familyOperation(runtime, user.id, (api) =>
          api.families.resumeCreation({ params: { familyId } })
        ),
      mutationKey: ["families", user.id, familyId, "resume-creation"],
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: familyKeys.all(user.id) }),
    })
  );
};

export const useCompleteFamilySetup = () => {
  const runtime = useApiRuntime();
  const { user } = useAccount();
  const queryClient = useQueryClient();
  return useMutation(
    apiEffectQuery.mutationOptions({
      mutationFn: (familyId: HouseholdOrganizationId) =>
        familyOperation(runtime, user.id, (api) =>
          api.families.complete({ params: { familyId } })
        ),
      mutationKey: ["families", user.id, "complete"],
      onSuccess: async (family) => {
        queryClient.setQueryData(familyKeys.detail(user.id, family.id), family);
        await queryClient.invalidateQueries({
          queryKey: familyKeys.list(user.id),
        });
      },
    })
  );
};
