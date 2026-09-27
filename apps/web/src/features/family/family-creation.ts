import type { FamilyName } from "@meal-planner/families";
import { CreateFamily } from "@meal-planner/families";
import type { UserId } from "@meal-planner/household-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";

import { useApiRuntime } from "../api-client/index.js";
import type { ApiRuntime } from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import { usePendingRequest } from "../request-recovery/index.js";
import {
  familyEffectQuery,
  familyOperation,
  familyKeys,
} from "./family-operations.js";

export const familyCreationMutationOptions = (
  runtime: ApiRuntime,
  userId: UserId
) =>
  familyEffectQuery.mutationOptions({
    mutationFn: (payload: CreateFamily) =>
      familyOperation(runtime, userId, (api) =>
        api.families.create({ payload })
      ),
    mutationKey: ["families", userId, "create"],
  });

export const useCreateFamily = () => {
  const { user } = useAccount();
  const runtime = useApiRuntime();
  const queryClient = useQueryClient();
  const retained = usePendingRequest<CreateFamily>(`${user.id}:family-create`);
  const mutation = useMutation({
    ...familyCreationMutationOptions(runtime, user.id),
    onError: (error, command) => {
      const rejected = error.match({
        FamilyForbidden: () => true,
        FamilyInvalidInput: () => true,
        OrElse: () => false,
      });
      if (rejected) {
        retained.release(command.mutationId);
      }
    },
    onSuccess: async (family, command) => {
      retained.release(command.mutationId);
      queryClient.setQueryData(familyKeys.detail(user.id, family.id), family);
      await queryClient.invalidateQueries({
        queryKey: familyKeys.list(user.id),
      });
    },
  });
  return {
    ...mutation,
    pendingRequest: retained.pending,
    submit: (name: typeof FamilyName.Type) => {
      if (mutation.data) {
        return Promise.resolve(mutation.data);
      }
      const command =
        retained.pending ??
        Schema.decodeUnknownSync(CreateFamily)({
          mutationId: crypto.randomUUID(),
          name,
        });
      return mutation.mutateAsync(retained.retain(command.mutationId, command));
    },
  };
};
