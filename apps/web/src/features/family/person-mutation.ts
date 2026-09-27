import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";

import { useApiRuntime } from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import { makeHouseholdPeopleEffectOperations } from "../household-people/client.js";
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
      const rejected = error.match({
        HouseholdPeopleOperationError: (failure) =>
          [
            "invalid_request",
            "organizer_required",
            "mutation_collision",
          ].includes(failure.code),
        OrElse: () => false,
      });
      if (rejected) {
        retained.release(request.command.person.mutationId);
      }
    },
    onSuccess: async (_result, request) => {
      retained.release(request.command.person.mutationId);
      await queryClient.invalidateQueries({
        queryKey: familyKeys.people(user.id, request.organizationId),
      });
    },
  });
  return {
    ...mutation,
    pendingRequest: retained.pending,
    submit: (command: PersonCreation) => {
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
