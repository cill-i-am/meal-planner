import type { HouseholdPerson } from "@meal-planner/household-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useApiRuntime } from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import { makeHouseholdPeopleEffectOperations } from "../household-people/client.js";
import { usePendingRequest } from "../request-recovery/index.js";
import { useFamily } from "./family-context.js";
import { familyKeys } from "./family-operations.js";
import { peopleEffectQuery } from "./people-queries.js";
import type { RosterCommand } from "./person-commands.js";
import { runRosterCommand } from "./roster-commands.js";
import { terminalFailure } from "./roster-feedback.js";
import { commandDraft, makeDraftAction } from "./roster-model.js";
import type {
  RosterAction,
  PendingRosterRequest,
  Presentation,
  RosterRequest,
} from "./roster-model.js";

export const useRosterManagement = () => {
  const familyContext = useFamily();
  const account = useAccount();
  const runtime = useApiRuntime();
  const queryClient = useQueryClient();
  const submitting = useRef(false);
  const retained = usePendingRequest<typeof RosterRequest.Type>(
    `${account.user.id}:${familyContext.family?.id}:roster`
  );
  const [localPresentation, setPresentation] = useState<Presentation | null>(
    null
  );
  const presentation: Presentation | null = retained.pending
    ? {
        open: true,
        operation: {
          organizationId: retained.pending.organizationId,
          state: { command: retained.pending.command, phase: "pending" },
        },
      }
    : localPresentation;
  const mutation = useMutation({
    ...peopleEffectQuery.mutationOptions({
      mutationFn: (pending: PendingRosterRequest) =>
        runRosterCommand(
          pending.state.command,
          makeHouseholdPeopleEffectOperations(
            { organizationId: pending.organizationId, userId: account.user.id },
            runtime
          )
        ),
      mutationKey: [
        "families",
        account.user.id,
        familyContext.family?.id,
        "roster-command",
      ],
    }),
    onError: async (error, pending) => {
      const commandError =
        error._tag === "EffectQueryFailure"
          ? error.match({
              HouseholdPeopleOperationError: (failure) => failure,
              OrElse: () => null,
            })
          : null;
      if (commandError && terminalFailure(commandError)) {
        retained.release(pending.state.command.mutationId);
        setPresentation({
          open: true,
          operation: {
            organizationId: pending.organizationId,
            state: {
              action: commandDraft(pending.state.command),
              phase: "draft",
            },
          },
        });
        await queryClient.invalidateQueries({
          queryKey: familyKeys.people(account.user.id, pending.organizationId),
        });
      }
    },
    onSuccess: async (_result, pending) => {
      retained.release(pending.state.command.mutationId);
      setPresentation({ open: false, operation: pending });
      await queryClient.invalidateQueries({
        queryKey: familyKeys.people(account.user.id, pending.organizationId),
      });
    },
  });
  const submit = async (command: RosterCommand) => {
    if (!presentation?.open || submitting.current) {
      return;
    }
    const pending: PendingRosterRequest = {
      organizationId: presentation.operation.organizationId,
      state: {
        command:
          presentation.operation.state.phase === "pending"
            ? presentation.operation.state.command
            : command,
        phase: "pending",
      },
    };
    submitting.current = true;
    try {
      retained.retain(pending.state.command.mutationId, {
        command: pending.state.command,
        organizationId: pending.organizationId,
      });
      await mutation.mutateAsync(pending);
    } catch {
      // Failed requests retain the original command; the mutation renders its error.
    } finally {
      submitting.current = false;
    }
  };
  let mutationError: Error | null = mutation.error;
  if (mutation.error?._tag === "EffectQueryFailure") {
    const queryError = mutation.error;
    mutationError = queryError.match<Error>({
      HouseholdPeopleOperationError: (failure) => failure,
      OrElse: () => queryError,
    });
  }
  return {
    begin: ({
      kind,
      person,
    }: {
      readonly kind: RosterAction;
      readonly person: HouseholdPerson;
    }) => {
      if (presentation !== null || submitting.current) {
        return;
      }
      if (!familyContext.family) {
        throw new Error("A family is required.");
      }
      mutation.reset();
      setPresentation({
        open: true,
        operation: {
          organizationId: familyContext.family.id,
          state: { action: makeDraftAction(kind, person), phase: "draft" },
        },
      });
    },
    busy: mutation.isPending,
    close: () => {
      if (
        !presentation ||
        submitting.current ||
        presentation.operation.state.phase === "pending"
      ) {
        return;
      }
      setPresentation({ ...presentation, open: false });
    },
    error: mutationError,
    finishExit: () =>
      setPresentation((current) => (current?.open ? current : null)),
    managing: presentation !== null,
    presentation,
    submit,
  };
};
export type RosterManagement = ReturnType<typeof useRosterManagement>;
