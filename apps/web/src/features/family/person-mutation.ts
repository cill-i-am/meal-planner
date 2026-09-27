import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Effect } from "effect";
import { Schema } from "effect";
import { useState } from "react";

import { useApiRuntime, queryFailure } from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import {
  makeHouseholdPeopleEffectOperations,
  HouseholdPeopleOperationError,
} from "../household-people/client.js";
import { usePendingRequest } from "../request-recovery/index.js";
import { useFamily } from "./family-context.js";
import { familyKeys } from "./family-operations.js";
import { peopleEffectQuery } from "./people-queries.js";
import { PersonCreation } from "./person-commands.js";
import { savePerson } from "./person-save.js";

const PersonRequest = Schema.Struct({
  command: PersonCreation,
  organizationId: HouseholdOrganizationId,
});

/** Owns the submitted command, its outcome, and the roster cache it changes. */
export const useAddFamilyPerson = () => {
  const { family } = useFamily();
  const { user } = useAccount();
  const runtime = useApiRuntime();
  const queryClient = useQueryClient();
  const retained = usePendingRequest<typeof PersonRequest.Type>(
    `${user.id}:${family?.id}:person-create`
  );
  const scope = `${user.id}:${family?.id}`;
  const [receipt, setReceipt] = useState<{
    scope: string;
    result: Effect.Success<ReturnType<typeof savePerson>>;
  }>();
  const saved = receipt?.scope === scope ? receipt.result : undefined;
  const mutation = useMutation({
    ...peopleEffectQuery.mutationOptions({
      mutationFn: (request: typeof PersonRequest.Type) =>
        savePerson(
          request.command,
          makeHouseholdPeopleEffectOperations(
            { organizationId: request.organizationId, userId: user.id },
            runtime
          )
        ),
      mutationKey: ["families", user.id, family?.id, "add-person"],
    }),
    onError: (error, request) => {
      const failure = queryFailure(error);
      const rejected =
        failure instanceof HouseholdPeopleOperationError &&
        [
          "invalid_request",
          "organizer_required",
          "mutation_collision",
        ].includes(failure.code);
      if (rejected) {
        retained.release(request.command.person.mutationId);
      }
    },
    onSuccess: async (result, request) => {
      setReceipt({ result, scope });
      retained.release(request.command.person.mutationId);
      await queryClient.invalidateQueries({
        queryKey: familyKeys.people(user.id, request.organizationId),
      });
    },
  });
  return {
    ...mutation,
    data: saved ?? mutation.data,
    isSuccess: saved !== undefined || mutation.isSuccess,
    pendingRequest: retained.pending,
    submit: (command: PersonCreation) => {
      if (saved) {
        return Promise.resolve(saved);
      }
      if (!family) {
        throw new Error("A family is required.");
      }
      const request = retained.pending ?? {
        command,
        organizationId: family.id,
      };
      return mutation.mutateAsync(
        retained.retain(request.command.person.mutationId, request)
      );
    },
  };
};
