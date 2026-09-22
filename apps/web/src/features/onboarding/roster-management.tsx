import {
  InviteHouseholdAdultPayload,
  RenameHouseholdPersonPayload,
  SetupRosterCommand,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import type {
  HouseholdPeopleRoster,
  HouseholdPerson,
  SetupCheckpoint,
  SetupRosterActionDraft,
  SetupRosterReturn,
} from "@meal-planner/household-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { MoreHorizontalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAppForm } from "../../components/forms/form.js";
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
import { Overlay } from "../../components/ui/responsive-overlay.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import {
  HouseholdPeopleOperationError,
  householdPeopleFailureCode,
} from "../household-people/operations.js";
import type { HouseholdPeopleOperations } from "../household-people/operations.js";
import { InvitationEmailInput, PersonNameInput } from "./people-input.js";
import { useSetup } from "./setup-context.js";
import { SetupError } from "./setup-ui.js";

type ManagementCheckpoint = Extract<
  SetupCheckpoint,
  { stage: "person-manage" }
>;
type RosterAction = SetupRosterActionDraft["kind"];
type RosterIntent = SetupRosterActionDraft | SetupRosterCommand;

const emailValidator = Schema.toStandardSchemaV1(InvitationEmailInput);
const nameValidator = Schema.toStandardSchemaV1(PersonNameInput);

const makeDraftAction = (
  kind: RosterAction,
  person: HouseholdPerson
): SetupRosterActionDraft => {
  if (kind === "invite") {
    return { email: "", kind, person };
  }
  if (kind === "rename") {
    return { kind, name: person.displayName, person };
  }
  return { kind, person };
};

const commandDraft = (command: SetupRosterCommand): SetupRosterActionDraft => {
  if (command.kind === "invite") {
    return { email: command.email, kind: "invite", person: command.person };
  }
  if (command.kind === "rename") {
    return { kind: "rename", name: command.name, person: command.person };
  }
  return { kind: "remove", person: command.person };
};

const commandFromForm = (
  action: SetupRosterActionDraft,
  value: { readonly email: string; readonly name: string }
): SetupRosterCommand => {
  const mutationId = crypto.randomUUID();
  if (action.kind === "invite") {
    return Schema.decodeUnknownSync(SetupRosterCommand)({
      email: Schema.decodeUnknownSync(InvitationEmailInput)(value.email),
      kind: "invite",
      mutationId,
      person: action.person,
    });
  }
  if (action.kind === "rename") {
    return Schema.decodeUnknownSync(SetupRosterCommand)({
      kind: "rename",
      mutationId,
      name: Schema.decodeUnknownSync(PersonNameInput)(value.name),
      person: action.person,
    });
  }
  return Schema.decodeUnknownSync(SetupRosterCommand)({
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

const actionButtonLabel = (
  action: RosterIntent,
  busy: boolean,
  pending: boolean
) => {
  if (busy) {
    return "Saving…";
  }
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

const runRosterCommand = async (
  command: SetupRosterCommand,
  people: HouseholdPeopleOperations
) => {
  switch (command.kind) {
    case "invite": {
      if (!people.inviteAdult) {
        throw new Error("Invitation operation is unavailable.");
      }
      await people.inviteAdult(
        Schema.decodeUnknownSync(InviteHouseholdAdultPayload)({
          email: command.email,
          mutationId: command.mutationId,
          personId: command.person.id,
        })
      );
      return;
    }
    case "rename": {
      if (!people.rename) {
        throw new Error("Name editing is unavailable.");
      }
      await people.rename(
        command.person.id,
        Schema.decodeUnknownSync(RenameHouseholdPersonPayload)({
          displayName: command.name,
          expectedVersion: command.person.version,
          mutationId: command.mutationId,
        })
      );
      return;
    }
    case "remove": {
      if (!people.remove) {
        throw new Error("Person removal is unavailable.");
      }
      await people.remove(
        command.person.id,
        Schema.decodeUnknownSync(TransitionHouseholdPersonPayload)({
          expectedVersion: command.person.version,
          mutationId: command.mutationId,
        })
      );
      return;
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
    person.associationState === "unlinked" &&
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
          Invite
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
  const setup = useSetup();
  const open = useMutation({
    mutationFn: async ({
      kind,
      person,
      returnTo,
    }: {
      kind: RosterAction;
      person: HouseholdPerson;
      returnTo: SetupRosterReturn;
    }) => {
      const { checkpoint } = setup.progress;
      if (!("organizationId" in checkpoint)) {
        throw new Error("A family is required.");
      }
      const action = makeDraftAction(kind, person);
      await setup.save({
        checkpoint: {
          organizationId: checkpoint.organizationId,
          returnTo,
          stage: "person-manage",
          state: { action, phase: "draft" },
        },
        status: "active",
      });
    },
  });
  return open;
};

const useManagementMutations = (checkpoint: ManagementCheckpoint) => {
  const setup = useSetup();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const destination =
    checkpoint.returnTo.stage === "person-draft"
      ? ("/setup/people" as const)
      : ("/setup/review" as const);
  const close = useMutation({
    mutationFn: async () => {
      await setup.save({
        checkpoint: {
          ...checkpoint.returnTo,
          organizationId: checkpoint.organizationId,
        },
        status: "active",
      });
      await navigate({ to: destination });
    },
  });
  const mutation = useMutation({
    mutationFn: async (command: SetupRosterCommand) => {
      const pending: ManagementCheckpoint = {
        ...checkpoint,
        state: { command, phase: "pending" },
      };
      await setup.save({ checkpoint: pending, status: "active" });
      await setup.selectFamily(checkpoint.organizationId);
      const people = setup.peopleForFamily(checkpoint.organizationId);
      try {
        await runRosterCommand(command, people);
      } catch (error) {
        if (error instanceof Error && terminalFailure(error)) {
          const draft = commandDraft(command);
          await setup.save({
            checkpoint: {
              ...checkpoint,
              state: { action: draft, phase: "draft" },
            },
            status: "active",
          });
          await queryClient.invalidateQueries({
            queryKey: ["setup-roster", checkpoint.organizationId],
          });
        }
        throw error;
      }
      await queryClient.invalidateQueries({
        queryKey: ["setup-roster", checkpoint.organizationId],
      });
      await setup.save({
        checkpoint: {
          ...checkpoint.returnTo,
          organizationId: checkpoint.organizationId,
        },
        status: "active",
      });
      await navigate({ to: destination });
    },
  });
  return { close, mutation };
};

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
  checkpoint,
  open,
  onExited,
}: {
  readonly checkpoint: ManagementCheckpoint;
  readonly open: boolean;
  readonly onExited: () => void;
}) => {
  const { state } = checkpoint;
  const action = state.phase === "draft" ? state.action : state.command;
  const formElement = useRef<HTMLFormElement>(null);
  const { close, mutation } = useManagementMutations(checkpoint);
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
      await mutation.mutateAsync(command).catch(() => {
        // The persisted command owns uncertain results.
      });
    },
  });
  const busy = !open || close.isPending || mutation.isPending;
  const pending = state.phase === "pending";
  const reviewRequired =
    mutation.error !== null &&
    terminalFailure(mutation.error) &&
    householdPeopleFailureCode(mutation.error) !== "invitation_rejected";
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
        close.mutate();
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
      <Overlay.Content data-theme="auth" showCloseButton={!pending && !busy}>
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
                        disabled={busy || pending}
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
                        disabled={busy || pending}
                      />
                    )}
                  </form.AppField>
                )}
              </FieldGroup>
            </form>
          </form.AppForm>
          <PendingResultNotice pending={pending} busy={busy} />
          {mutation.error && (
            <SetupError>{failureMessage(mutation.error)}</SetupError>
          )}
          {close.error && (
            <SetupError>We couldn’t save your place. Try again.</SetupError>
          )}
        </Overlay.Body>
        <Overlay.Footer>
          {reviewRequired ? (
            <Button size="xl" disabled={busy} onClick={() => close.mutate()}>
              Review family
            </Button>
          ) : (
            <Button
              type="submit"
              form="roster-management-form"
              variant={action.kind === "remove" ? "destructive" : "default"}
              size="xl"
              disabled={busy}
              onClick={
                pending
                  ? (event) => {
                      event.preventDefault();
                      mutation.mutate(state.command);
                    }
                  : undefined
              }
            >
              {actionButtonLabel(action, busy, pending)}
            </Button>
          )}
          <Button
            variant="link"
            disabled={busy || pending}
            onClick={() => close.mutate()}
          >
            Cancel
          </Button>
        </Overlay.Footer>
      </Overlay.Content>
    </Overlay.Root>
  );
};

export const RosterManagementOverlay = () => {
  const { checkpoint } = useSetup().progress;
  const active = checkpoint.stage === "person-manage" ? checkpoint : null;
  const [snapshot, setSnapshot] = useState<ManagementCheckpoint | null>(active);
  useEffect(() => {
    if (active) {
      setSnapshot(active);
    }
  }, [active]);
  const presented = active ?? snapshot;
  if (!presented) {
    return null;
  }
  const action =
    presented.state.phase === "draft"
      ? presented.state.action
      : presented.state.command;
  return (
    <RosterManagementDialog
      key={`${action.kind}-${action.person.id}`}
      checkpoint={presented}
      open={active !== null}
      onExited={() => {
        setSnapshot(null);
        restoreRosterFocus(action.person.id);
      }}
    />
  );
};
