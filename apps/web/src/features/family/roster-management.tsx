import {
  InviteHouseholdAdultPayload,
  RenameHouseholdPersonPayload,
  HouseholdOrganizationId,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import type {
  HouseholdPeopleRoster,
  HouseholdPerson,
} from "@meal-planner/household-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { MoreHorizontalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAppForm } from "../../components/forms/form.js";
import { OperationError } from "../../components/operation-error.js";
import { Button } from "../../components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import { FieldGroup } from "../../components/ui/field.js";
import { PendingButton } from "../../components/ui/pending-button.js";
import { Overlay } from "../../components/ui/responsive-overlay.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { useApiRuntime } from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import {
  HouseholdPeopleOperationError,
  makeHouseholdPeopleEffectOperations,
  householdPeopleFailureCode,
} from "../household-people/client.js";
import type { HouseholdPeopleEffectOperations } from "../household-people/client.js";
import {
  InvitationEmailInput,
  PersonNameInput,
} from "../household-people/form-input.js";
import { usePendingRequest } from "../request-recovery/index.js";
import { useFamily } from "./family-context.js";
import { familyKeys } from "./family-operations.js";
import { peopleEffectQuery } from "./people-queries.js";
import { RosterCommand } from "./person-commands.js";

const RosterRequest = Schema.Struct({
  command: RosterCommand,
  organizationId: HouseholdOrganizationId,
});
interface PendingRosterRequest {
  readonly organizationId: HouseholdOrganizationId;
  readonly state: {
    readonly phase: "pending";
    readonly command: RosterCommand;
  };
}
type RosterActionDraft =
  | {
      readonly kind: "invite";
      readonly email: string;
      readonly person: HouseholdPerson;
    }
  | {
      readonly kind: "rename";
      readonly name: string;
      readonly person: HouseholdPerson;
    }
  | { readonly kind: "remove"; readonly person: HouseholdPerson };
export type RosterAction = RosterActionDraft["kind"];
type RosterIntent = RosterActionDraft | RosterCommand;
type RosterPresentation = Omit<PendingRosterRequest, "state"> & {
  readonly state:
    | { readonly action: RosterActionDraft; readonly phase: "draft" }
    | PendingRosterRequest["state"];
};
interface Presentation {
  readonly operation: RosterPresentation;
  readonly open: boolean;
}

const emailValidator = Schema.toStandardSchemaV1(InvitationEmailInput);
const nameValidator = Schema.toStandardSchemaV1(PersonNameInput);

const makeDraftAction = (
  kind: RosterAction,
  person: HouseholdPerson
): RosterActionDraft => {
  if (kind === "invite") {
    return { email: "", kind, person };
  }
  if (kind === "rename") {
    return { kind, name: person.displayName, person };
  }
  return { kind, person };
};

const commandDraft = (command: RosterCommand): RosterActionDraft => {
  if (command.kind === "invite") {
    return { email: command.email, kind: "invite", person: command.person };
  }
  if (command.kind === "rename") {
    return { kind: "rename", name: command.name, person: command.person };
  }
  return { kind: "remove", person: command.person };
};

const commandFromForm = (
  action: RosterActionDraft,
  value: { readonly email: string; readonly name: string }
): RosterCommand => {
  const mutationId = crypto.randomUUID();
  if (action.kind === "invite") {
    return Schema.decodeUnknownSync(RosterCommand)({
      email: Schema.decodeUnknownSync(InvitationEmailInput)(value.email),
      kind: "invite",
      mutationId,
      person: action.person,
    });
  }
  if (action.kind === "rename") {
    return Schema.decodeUnknownSync(RosterCommand)({
      kind: "rename",
      mutationId,
      name: Schema.decodeUnknownSync(PersonNameInput)(value.name),
      person: action.person,
    });
  }
  return Schema.decodeUnknownSync(RosterCommand)({
    kind: "remove",
    mutationId,
    person: action.person,
  });
};

const actionTitle = (action: RosterIntent): string => {
  const name = action.person.displayName;
  if (action.kind === "invite") {
    return `Invite ${name}`;
  }
  if (action.kind === "rename") {
    return `Edit ${name}’s name`;
  }
  return `Remove ${name} from family?`;
};

const actionDescription = (action: RosterIntent): string => {
  if (action.kind === "invite") {
    return "Create an invitation so they can sign in and manage their preferences.";
  }
  if (action.kind === "rename") {
    return "Change the name shown to your family.";
  }
  if (action.person.associationState === "linked") {
    return "Their account will stay active, but they’ll lose access to this family. Their profile will be archived.";
  }
  if (action.person.associationState === "invitation_pending") {
    return "Their pending invitation will be cancelled and their profile archived.";
  }
  return "Their profile will be archived and removed from your family list.";
};

const actionButtonLabel = (action: RosterIntent, pending: boolean) => {
  if (pending) {
    return "Check and continue";
  }
  if (action.kind === "invite") {
    return `Invite ${action.person.displayName}`;
  }
  if (action.kind === "rename") {
    return "Save changes";
  }
  return action.person.associationState === "invitation_pending"
    ? "Cancel invitation & remove"
    : `Remove ${action.person.displayName}`;
};

const actionPendingLabel = (action: RosterIntent) => {
  if (action.kind === "invite") {
    return "Sending invitation…";
  }
  if (action.kind === "rename") {
    return "Saving name…";
  }
  return `Removing ${action.person.displayName}…`;
};

const runRosterCommand = (
  command: RosterCommand,
  people: HouseholdPeopleEffectOperations
) => {
  switch (command.kind) {
    case "invite": {
      return people
        .inviteAdult(
          Schema.decodeUnknownSync(InviteHouseholdAdultPayload)({
            email: command.email,
            mutationId: command.mutationId,
            personId: command.person.id,
          })
        )
        .pipe(Effect.asVoid);
    }
    case "rename": {
      return people
        .rename(
          command.person.id,
          Schema.decodeUnknownSync(RenameHouseholdPersonPayload)({
            displayName: command.name,
            expectedVersion: command.person.version,
            mutationId: command.mutationId,
          })
        )
        .pipe(Effect.asVoid);
    }
    case "remove": {
      return people
        .remove(
          command.person.id,
          Schema.decodeUnknownSync(TransitionHouseholdPersonPayload)({
            expectedVersion: command.person.version,
            mutationId: command.mutationId,
          })
        )
        .pipe(Effect.asVoid);
    }
    default: {
      throw new Error("Unknown roster command.");
    }
  }
};

const restoreRosterFocus = (personId: HouseholdPerson["id"]) => {
  setTimeout(() => {
    const row = [
      ...document.querySelectorAll<HTMLElement>("[data-roster-person-id]"),
    ].find((element) => element.dataset["rosterPersonId"] === personId);
    (
      row?.querySelector<HTMLElement>("button:not(:disabled)") ??
      document.querySelector<HTMLElement>("#auth-title")
    )?.focus();
  }, 0);
};

const terminalFailure = (error: Error) =>
  [
    "association_conflict",
    "association_stale",
    "departure_conflict",
    "invitation_rejected",
    "lifecycle_conflict",
    "mutation_collision",
    "organizer_required",
    "person_not_found",
    "stale_version",
    "invalid_request",
    "unauthorized",
  ].includes(householdPeopleFailureCode(error) ?? "");

const failureMessage = (error: Error) => {
  if (error instanceof HouseholdPeopleOperationError) {
    if (error.invitationRejection === "already_invited") {
      return "An invitation is already waiting for this email. Check the address or review your family.";
    }
    if (error.invitationRejection === "already_member") {
      return "This email already belongs to someone in your family. Check the address and try again.";
    }
    if (error.invitationRejection === "invalid_email") {
      return "Check the email address and try again.";
    }
    if (error.invitationRejection === "limit") {
      return "Your family has too many pending invitations. Review your family before inviting again.";
    }
    if (
      error.code === "organizer_required" ||
      error.invitationRejection === "forbidden"
    ) {
      return "Only the family organiser can make this change.";
    }
    if (error.code === "stale_version" || error.code === "association_stale") {
      return "This person changed. Close this window and review the latest family list.";
    }
    if (
      error.code === "association_conflict" ||
      error.code === "departure_conflict"
    ) {
      return "This person’s account state changed. Close this window and review the latest family list.";
    }
  }
  if (terminalFailure(error)) {
    return "This change couldn’t be made. Close this window and review the latest family list.";
  }
  return "We couldn’t confirm the change. Try again to check the same request.";
};

export const canManagePerson = (
  person: HouseholdPerson,
  roster: HouseholdPeopleRoster,
  organizer: boolean
) => ({
  invite:
    organizer &&
    person.kind === "adult" &&
    (person.associationState === "unlinked" ||
      person.associationState === "invitation_declined" ||
      person.associationState === "invitation_unavailable") &&
    !person.isCurrentAdult,
  remove: organizer && !person.isCurrentAdult,
  rename:
    roster.currentPersonId !== null && (organizer || person.isCurrentAdult),
});

export const RosterActions = ({
  person,
  roster,
  organizer,
  disabled,
  onAction,
}: {
  readonly person: HouseholdPerson;
  readonly roster: HouseholdPeopleRoster;
  readonly organizer: boolean;
  readonly disabled: boolean;
  readonly onAction: (kind: RosterAction, person: HouseholdPerson) => void;
}) => {
  const allowed = canManagePerson(person, roster, organizer);
  if (!allowed.invite && !allowed.rename && !allowed.remove) {
    return null;
  }
  return (
    <div
      className="flex shrink-0 items-center gap-2"
      data-roster-person-id={person.id}
    >
      {allowed.invite && (
        <Button
          variant="link"
          disabled={disabled}
          onClick={() => onAction("invite", person)}
        >
          {person.associationState === "unlinked"
            ? "Invite to join"
            : "Invite again"}
        </Button>
      )}
      {(allowed.rename || allowed.remove) && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Manage ${person.displayName}`}
                      disabled={disabled}
                    />
                  }
                />
              }
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{`Manage ${person.displayName}`}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" data-theme="auth">
            <DropdownMenuGroup>
              {allowed.rename && (
                <DropdownMenuItem onClick={() => onAction("rename", person)}>
                  Edit name
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            {allowed.remove && (
              <>
                {allowed.rename && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onAction("remove", person)}
                  >
                    Remove from family
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

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
type RosterManagement = ReturnType<typeof useRosterManagement>;

const PendingResultNotice = ({
  pending,
  busy,
}: {
  readonly pending: boolean;
  readonly busy: boolean;
}) => {
  if (!pending || busy) {
    return null;
  }
  return (
    <p className="text-muted-foreground text-sm">
      We’ve kept this exact request. Retry to confirm what happened before
      making another change.
    </p>
  );
};

const RosterManagementDialog = ({
  operation,
  open,
  onExited,
  management,
}: {
  readonly management: RosterManagement;
  readonly operation: RosterPresentation;
  readonly open: boolean;
  readonly onExited: () => void;
}) => {
  const { state } = operation;
  const action = state.phase === "draft" ? state.action : state.command;
  const { busy, close, error, submit } = management;
  const formElement = useRef<HTMLFormElement>(null);
  const form = useAppForm({
    defaultValues: {
      email: action.kind === "invite" ? action.email : "",
      name: action.kind === "rename" ? action.name : "",
    },
    onSubmit: async ({ value }) => {
      if (state.phase === "pending") {
        return;
      }
      const command = commandFromForm(state.action, value);
      await submit(command);
    },
  });
  const pendingCommand = state.phase === "pending" ? state.command : null;
  useEffect(() => {
    if (pendingCommand) {
      form.reset({
        email: pendingCommand.kind === "invite" ? pendingCommand.email : "",
        name: pendingCommand.kind === "rename" ? pendingCommand.name : "",
      });
    }
  }, [form, pendingCommand]);
  const disabled = !open || busy;
  const pending = state.phase === "pending";
  const reviewRequired =
    !pending &&
    error !== null &&
    terminalFailure(error) &&
    householdPeopleFailureCode(error) !== "invitation_rejected";
  return (
    <Overlay.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next || !open) {
          return;
        }
        details.cancel();
        if (busy || pending) {
          return;
        }
        close();
      }}
      desktop="dialog"
      dialogProps={{
        onOpenChangeComplete: (next) => {
          if (!next) {
            onExited();
          }
        },
      }}
      drawerProps={{
        onOpenChangeComplete: (next) => {
          if (!next) {
            onExited();
          }
        },
      }}
    >
      <Overlay.Content
        data-theme="auth"
        showCloseButton={!pending && !disabled}
      >
        <Overlay.Header>
          <Overlay.Title>{actionTitle(action)}</Overlay.Title>
          <Overlay.Description>{actionDescription(action)}</Overlay.Description>
        </Overlay.Header>
        <Overlay.Body>
          <form.AppForm>
            <form
              ref={formElement}
              id="roster-management-form"
              noValidate
              aria-busy={busy}
              onSubmit={async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await form.handleSubmit();
                formElement.current
                  ?.querySelector<HTMLElement>(
                    'input[aria-invalid="true"]:not(:disabled)'
                  )
                  ?.focus();
              }}
            >
              <FieldGroup>
                {action.kind === "invite" && (
                  <form.AppField
                    name="email"
                    validators={{
                      onChange: emailValidator,
                      onSubmit: emailValidator,
                    }}
                  >
                    {(field) => (
                      <field.TextField
                        id="roster-invite-email"
                        label="Email"
                        type="email"
                        maxLength={254}
                        autoComplete="off"
                        disabled={disabled || pending}
                      />
                    )}
                  </form.AppField>
                )}
                {action.kind === "rename" && (
                  <form.AppField
                    name="name"
                    validators={{
                      onChange: nameValidator,
                      onSubmit: nameValidator,
                    }}
                  >
                    {(field) => (
                      <field.TextField
                        id="roster-edit-name"
                        label="Name"
                        maxLength={80}
                        autoComplete="off"
                        disabled={disabled || pending}
                      />
                    )}
                  </form.AppField>
                )}
              </FieldGroup>
            </form>
          </form.AppForm>
          <PendingResultNotice pending={pending && open} busy={busy} />
          {error && <OperationError>{failureMessage(error)}</OperationError>}
        </Overlay.Body>
        <Overlay.Footer>
          {reviewRequired ? (
            <Button size="xl" disabled={disabled} onClick={() => close()}>
              Review family
            </Button>
          ) : (
            <PendingButton
              type="submit"
              form="roster-management-form"
              variant={action.kind === "remove" ? "destructive" : "default"}
              size="xl"
              disabled={disabled}
              pending={busy}
              pendingLabel={actionPendingLabel(action)}
              onClick={
                pending
                  ? async (event) => {
                      event.preventDefault();
                      await submit(state.command);
                    }
                  : undefined
              }
            >
              {actionButtonLabel(action, pending)}
            </PendingButton>
          )}
          <Button
            variant="link"
            disabled={disabled || pending}
            onClick={() => close()}
          >
            Cancel
          </Button>
        </Overlay.Footer>
      </Overlay.Content>
    </Overlay.Root>
  );
};

export const RosterManagementOverlay = ({
  management,
}: {
  readonly management: RosterManagement;
}) => {
  const { presentation } = management;
  if (!presentation) {
    return null;
  }
  const { operation, open } = presentation;
  const action =
    operation.state.phase === "draft"
      ? operation.state.action
      : operation.state.command;
  return (
    <RosterManagementDialog
      key={`${action.kind}-${action.person.id}`}
      operation={operation}
      management={management}
      open={open}
      onExited={() => {
        management.finishExit();
        restoreRosterFocus(action.person.id);
      }}
    />
  );
};
