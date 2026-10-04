import type { InvitationId } from "@meal-planner/household-api";
import { InvitationResponse } from "@meal-planner/invitations";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";

import { useApiRuntime } from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import { useFamilyActions } from "../family/index.js";
import { usePendingRequest } from "../request-recovery/index.js";
import { respondInvitationMutationOptions } from "./invitation-operations.js";

export const useInvitationResponse = (invitationId: InvitationId) => {
  const { user } = useAccount();
  const runtime = useApiRuntime();
  const family = useFamilyActions();
  const queryClient = useQueryClient();
  const retained = usePendingRequest<InvitationResponse>(
    `${user.id}:invitation:${invitationId}`
  );
  const mutation = useMutation(
    respondInvitationMutationOptions(runtime, user.id, invitationId)
  );
  return {
    continueAcceptedInvitation: () => {
      if (retained.pending?.decision === "decline") {
        retained.release(retained.pending.mutationId);
      }
    },
    isPending: mutation.isPending,
    pendingRequest: retained.pending,
    submit: async (decision: "accept" | "decline") => {
      const command =
        retained.pending ??
        Schema.decodeUnknownSync(InvitationResponse, {
          onExcessProperty: "error",
        })({
          decision,
          mutationId: crypto.randomUUID(),
        });
      const submitted = retained.retain(command.mutationId, command);
      const result = await mutation.mutateAsync(submitted);
      if (result.status === "joined") {
        await Effect.runPromise(family.selectFamily(result.familyId));
      }
      await queryClient.invalidateQueries({
        queryKey: ["setup-invitation", user.id, invitationId],
      });
      await family.refresh();
      retained.release(submitted.mutationId);
      return result;
    },
  };
};
