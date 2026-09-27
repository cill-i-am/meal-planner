import type { HouseholdPerson } from "@meal-planner/household-api";
import { Schema } from "effect";
import { useEffect, useRef } from "react";

import { useAppForm } from "../../components/forms/form.js";
import { OperationError } from "../../components/operation-error.js";
import { Button } from "../../components/ui/button.js";
import { FieldGroup } from "../../components/ui/field.js";
import { PendingButton } from "../../components/ui/pending-button.js";
import { Overlay } from "../../components/ui/responsive-overlay.js";
import { householdPeopleFailureCode } from "../household-people/client.js";
import {
  InvitationEmailInput,
  PersonNameInput,
} from "../household-people/form-input.js";
import type { RosterCommand } from "./person-commands.js";
import { terminalFailure, failureMessage } from "./roster-feedback.js";
import { commandFromForm } from "./roster-model.js";
import type { RosterActionDraft, RosterPresentation } from "./roster-model.js";
import type { RosterManagement } from "./use-roster-management.js";

type RosterIntent = RosterActionDraft | RosterCommand;

const emailValidator = Schema.toStandardSchemaV1(InvitationEmailInput);
const nameValidator = Schema.toStandardSchemaV1(PersonNameInput);

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

const restoreRosterFocus = (
  personId: HouseholdPerson["id"],
  kind: RosterIntent["kind"]
) => {
  setTimeout(() => {
    const row = [
      ...document.querySelectorAll<HTMLElement>("[data-roster-person-id]"),
    ].find((element) => element.dataset["rosterPersonId"] === personId);
    (
      row?.querySelector<HTMLElement>(
        kind === "invite"
          ? "button:not(:disabled)"
          : 'button[aria-haspopup="menu"]:not(:disabled)'
      ) ?? document.querySelector<HTMLElement>("#auth-title")
    )?.focus();
  }, 0);
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
      const command = commandFromForm(state.action, value, crypto.randomUUID());
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
        restoreRosterFocus(action.person.id, action.kind);
      }}
    />
  );
};
