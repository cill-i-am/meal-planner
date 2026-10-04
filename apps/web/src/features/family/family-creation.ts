import type { Family, FamilyName } from "@meal-planner/families";
import {
  CreateFamily,
  FamilyForbidden,
  FamilyInvalidInput,
} from "@meal-planner/families";
import type { UserId } from "@meal-planner/household-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useState } from "react";

import {
  apiEffectQuery,
  useApiRuntime,
  queryFailure,
} from "../api-client/index.js";
import type { ApiRuntime } from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import { usePendingRequest } from "../request-recovery/index.js";
import { familyOperation, familyKeys } from "./family-operations.js";

export const familyCreationMutationOptions = (
  runtime: ApiRuntime,
  userId: UserId
) =>
  apiEffectQuery.mutationOptions({
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
  const scope = user.id;
  const [receipt, setReceipt] = useState<{
    scope: string;
    result: Family;
  }>();
  const saved = receipt?.scope === scope ? receipt.result : undefined;
  const mutation = useMutation({
    ...familyCreationMutationOptions(runtime, user.id),
    onError: (error, command) => {
      const failure = queryFailure(error);
      const rejected =
        Schema.is(FamilyForbidden)(failure) ||
        Schema.is(FamilyInvalidInput)(failure);
      if (rejected) {
        retained.release(command.mutationId);
      }
    },
    onSuccess: async (family, command) => {
      setReceipt({ result: family, scope });
      retained.release(command.mutationId);
      queryClient.setQueryData(familyKeys.detail(user.id, family.id), family);
      await queryClient.invalidateQueries({
        queryKey: familyKeys.list(user.id),
      });
    },
  });
  return {
    ...mutation,
    data: saved ?? mutation.data,
    isSuccess: saved !== undefined || mutation.isSuccess,
    pendingRequest: retained.pending,
    submit: (name: typeof FamilyName.Type) => {
      if (saved) {
        return Promise.resolve(saved);
      }
      const command =
        retained.pending ??
        Schema.decodeUnknownSync(CreateFamily, { onExcessProperty: "error" })({
          mutationId: crypto.randomUUID(),
          name,
        });
      return mutation.mutateAsync(retained.retain(command.mutationId, command));
    },
  };
};
