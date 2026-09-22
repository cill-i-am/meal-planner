import {
  PersonCreation,
  PersonDraft,
  InviteHouseholdAdultPayload,
} from "@meal-planner/household-api";
import type {
  HouseholdPerson,
  HouseholdPeopleRoster,
  SetupCheckpoint,
} from "@meal-planner/household-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import type { ReactNode } from "react";

import { useAppForm } from "../../components/forms/form.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardBody,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import {
  Collapsible,
  CollapsibleContent,
} from "../../components/ui/collapsible.js";
import { FieldGroup } from "../../components/ui/field.js";
import { PersonRow, useSetupRoster } from "./family-review.js";
import { InvitationCorrectionForm } from "./invitation-correction.js";
import {
  PersonNameInput,
  ParticipationInput,
  InvitationEmailInput,
} from "./people-input.js";
import { saveSetupPerson } from "./person-save.js";
import {
  RosterActions,
  RosterManagementOverlay,
  useRosterManagement,
} from "./roster-management.js";
import type { RosterAction } from "./roster-management.js";
import { useSetup } from "./setup-context.js";
import { SetupError, SetupFrame, SetupStatus } from "./setup-ui.js";

const nameValidator = Schema.toStandardSchemaV1(PersonNameInput);
const participationValidator = Schema.toStandardSchemaV1(ParticipationInput);
const emailValidator = Schema.toStandardSchemaV1(InvitationEmailInput);
type Draft = typeof PersonDraft.Type;
type Pending = Extract<
  SetupCheckpoint,
  { stage: "person-create" | "person-invite" }
>;

const draftForAddPage = (checkpoint: SetupCheckpoint): Draft | null => {
  if (checkpoint.stage === "person-draft") {
    return checkpoint.draft;
  }
  if (
    checkpoint.stage === "person-manage" &&
    checkpoint.returnTo.stage === "person-draft"
  ) {
    return checkpoint.returnTo.draft;
  }
  return null;
};

const AddedPeople = ({
  roster,
  organizer,
  busy,
  onAction,
}: {
  readonly roster: HouseholdPeopleRoster;
  readonly organizer: boolean;
  readonly busy: boolean;
  readonly onAction: (kind: RosterAction, person: HouseholdPerson) => void;
}) => (
  <CardFooter variant="people">
    <p className="text-muted-foreground text-sm">Already added</p>
    {roster.people.map((person) => (
      <div key={person.id} className="flex w-full min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <PersonRow person={person} />
        </div>
        <RosterActions
          person={person}
          roster={roster}
          organizer={organizer}
          disabled={busy}
          onAction={onAction}
        />
      </div>
    ))}
  </CardFooter>
);

const PersonDraftForm = ({
  draft,
  busy,
  disabled,
  error,
  submit,
  pause,
  cancel,
  roster,
  organizer,
  rosterError,
  onAction,
  overlay,
}: {
  readonly draft: Draft;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly error: boolean;
  readonly submit: (command: PersonCreation) => Promise<void>;
  readonly pause: (draft: Draft) => void;
  readonly cancel: () => void;
  readonly roster: HouseholdPeopleRoster;
  readonly organizer: boolean;
  readonly rosterError?: boolean;
  readonly onAction: (
    kind: RosterAction,
    person: HouseholdPerson,
    draft: Draft
  ) => void;
  readonly overlay: ReactNode;
}) => {
  const defaultParticipation: string = draft.participation || "adult";
  const form = useAppForm({
    defaultValues: {
      email: draft.email,
      invite: draft.invite ?? false,
      name: draft.name,
      participation: defaultParticipation,
    },
    onSubmit: async ({ value }) => {
      const person = {
        displayName: value.name.trim(),
        kind: value.participation,
        mutationId: crypto.randomUUID(),
      };
      const command = Schema.decodeUnknownSync(PersonCreation)(
        value.participation === "adult" && value.invite
          ? {
              email: Schema.decodeUnknownSync(InvitationEmailInput)(
                value.email
              ),
              invitationMutationId: crypto.randomUUID(),
              kind: "invited",
              person,
            }
          : { kind: "managed", person }
      );
      await submit(command);
    },
  });
  return (
    <SetupFrame
      step="people"
      action={
        <Button
          variant="link"
          disabled={disabled}
          onClick={() =>
            pause(Schema.decodeUnknownSync(PersonDraft)(form.state.values))
          }
        >
          Save & exit
        </Button>
      }
    >
      <form.AppForm>
        <form.Frame className="max-w-140" size="sm" pending={busy}>
          <CardBody>
            <CardHeader>
              <form.Heading errorTitle="Add someone" rejected={error}>
                Add someone
              </form.Heading>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <form.AppField
                  name="name"
                  validators={{ onChange: nameValidator }}
                >
                  {(field) => (
                    <field.TextField
                      id="person-name"
                      label="Name"
                      maxLength={80}
                      autoComplete="off"
                      disabled={disabled}
                    />
                  )}
                </form.AppField>
                <div>
                  <form.AppField
                    name="participation"
                    validators={{ onChange: participationValidator }}
                    listeners={{
                      onChange: () => {
                        form.setFieldValue("invite", false);
                        form.setFieldValue("email", "", { dontValidate: true });
                        form.setFieldMeta("email", (meta) => ({
                          ...meta,
                          errorMap: {},
                          errors: [],
                        }));
                      },
                    }}
                  >
                    {(field) => (
                      <field.ParticipationField
                        id="person-participation"
                        disabled={disabled}
                      />
                    )}
                  </form.AppField>
                  <form.Subscribe
                    selector={(state) => ({
                      invite: state.values.invite,
                      participation: state.values.participation,
                    })}
                  >
                    {({ invite, participation }) => (
                      <Collapsible open={participation === "adult"}>
                        <CollapsibleContent
                          id="person-invite-choice"
                          aria-labelledby="person-participation-label"
                          inert={participation !== "adult"}
                          variant="adult"
                        >
                          <div className="pt-5">
                            <form.AppField name="invite">
                              {(field) => (
                                <field.InviteField
                                  disabled={
                                    disabled || participation !== "adult"
                                  }
                                >
                                  <form.AppField
                                    name="email"
                                    validators={{
                                      onChange: invite
                                        ? emailValidator
                                        : undefined,
                                    }}
                                  >
                                    {(emailField) => (
                                      <emailField.TextField
                                        id="person-email"
                                        label="Email"
                                        maxLength={254}
                                        autoComplete="off"
                                        type="email"
                                        disabled={
                                          disabled ||
                                          participation !== "adult" ||
                                          !invite
                                        }
                                      />
                                    )}
                                  </form.AppField>
                                </field.InviteField>
                              )}
                            </form.AppField>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </form.Subscribe>
                </div>
              </FieldGroup>
              {rosterError && (
                <SetupError>
                  Your family list couldn’t refresh. Your draft is still here;
                  you can save and return later.
                </SetupError>
              )}
              {error && (
                <SetupError>We couldn’t save your place. Try again.</SetupError>
              )}
              <div className="flex flex-col gap-2">
                <form.Subscribe
                  selector={(state) => ({
                    invite: state.values.invite,
                    participation: state.values.participation,
                  })}
                >
                  {({ invite, participation }) => {
                    const label =
                      participation === "adult" && invite
                        ? "Add and invite"
                        : "Add person";
                    return (
                      <Button type="submit" disabled={disabled}>
                        {busy ? "Saving…" : label}
                      </Button>
                    );
                  }}
                </form.Subscribe>
                <Button variant="link" disabled={disabled} onClick={cancel}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </CardBody>
          <AddedPeople
            roster={roster}
            organizer={organizer}
            busy={disabled}
            onAction={(kind, person) =>
              onAction(
                kind,
                person,
                Schema.decodeUnknownSync(PersonDraft)(form.state.values)
              )
            }
          />
        </form.Frame>
      </form.AppForm>
      {overlay}
    </SetupFrame>
  );
};

const PendingPersonRequest = ({
  pending,
  busy,
  failed,
  pauseFailed,
  retry,
  pause,
}: {
  readonly pending: Pending;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly pauseFailed: boolean;
  readonly retry: () => void;
  readonly pause: () => void;
}) => {
  const name =
    pending.stage === "person-invite"
      ? pending.displayName
      : pending.command.person.displayName;
  const retryLabel =
    pending.stage === "person-invite"
      ? "Finish invitation"
      : "Check and continue";
  return (
    <SetupFrame
      step="people"
      action={
        <Button variant="link" disabled={busy} onClick={pause}>
          Save & exit
        </Button>
      }
    >
      <Card className="w-full max-w-140" size="sm">
        <CardBody>
          <CardHeader>
            <CardTitle>
              <h1
                id="auth-title"
                tabIndex={-1}
                className="text-task-mobile/8 md:text-task-desktop/9 font-semibold tracking-tight focus:outline-none"
              >
                {pending.stage === "person-invite"
                  ? `Finish ${name}’s invitation`
                  : `Finish adding ${name}`}
              </h1>
            </CardTitle>
            <CardDescription>
              {pending.stage === "person-invite"
                ? "Their profile is saved. We still need to confirm the invitation."
                : "We’ve kept your request. Check the result before adding anyone else."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pending.stage === "person-invite" && (
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-sm">
                  Invitation for
                </span>
                <span>{pending.displayName}</span>
                <span className="text-muted-foreground text-sm wrap-anywhere">
                  {pending.command.email}
                </span>
              </div>
            )}
            {failed && (
              <SetupError>
                We couldn’t finish that request. Try again to check and complete
                the same request.
              </SetupError>
            )}
            {pauseFailed && (
              <SetupError>We couldn’t save your place. Try again.</SetupError>
            )}
            <Button disabled={busy} onClick={retry}>
              {busy ? "Saving…" : retryLabel}
            </Button>
          </CardContent>
        </CardBody>
      </Card>
    </SetupFrame>
  );
};

export const AddPersonPage = () => {
  const setup = useSetup();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const roster = useSetupRoster();
  const { checkpoint } = setup.progress;
  const manage = useRosterManagement();
  const save = useMutation({
    mutationFn: async (pending: Pending) => {
      await setup.save({ checkpoint: pending, status: "active" });
      await setup.selectFamily(pending.organizationId);
      await saveSetupPerson(
        pending,
        setup.peopleForFamily(pending.organizationId),
        (next) => setup.save({ checkpoint: next, status: "active" })
      );
      await queryClient.invalidateQueries({
        queryKey: ["setup-roster", pending.organizationId],
      });
      await navigate({ to: "/setup" });
    },
  });
  const pause = useMutation({
    mutationFn: async (next: SetupCheckpoint) => {
      await setup.save({ checkpoint: next, status: "paused" });
      await navigate({ to: "/setup/saved" });
    },
  });
  const cancel = useMutation({
    mutationFn: async () => {
      if (!("organizationId" in checkpoint)) {
        return;
      }
      await setup.save({
        checkpoint: {
          organizationId: checkpoint.organizationId,
          stage: "family-review",
        },
        status: "active",
      });
      await navigate({ to: "/setup/review" });
    },
  });
  const pending =
    checkpoint.stage === "person-create" || checkpoint.stage === "person-invite"
      ? checkpoint
      : save.variables;
  const busy = [save, pause, cancel].some((operation) => operation.isPending);
  if (checkpoint.stage === "person-invite-draft") {
    return (
      <InvitationCorrectionForm
        checkpoint={checkpoint}
        busy={busy}
        error={Boolean(pause.error || cancel.error)}
        submit={async (email) => {
          await save
            .mutateAsync({
              command: Schema.decodeUnknownSync(InviteHouseholdAdultPayload)({
                email,
                mutationId: crypto.randomUUID(),
                personId: checkpoint.personId,
              }),
              displayName: checkpoint.displayName,
              organizationId: checkpoint.organizationId,
              stage: "person-invite",
            })
            .catch(() => {
              /* Saved command owns uncertain outcomes. */
            });
        }}
        pause={(email) => pause.mutate({ ...checkpoint, email })}
        cancel={() => cancel.mutate()}
      />
    );
  }
  if (pending) {
    return (
      <PendingPersonRequest
        pending={pending}
        busy={busy}
        failed={Boolean(save.error)}
        pauseFailed={Boolean(pause.error)}
        retry={() => save.mutate(pending)}
        pause={() => pause.mutate(pending)}
      />
    );
  }
  if (roster.isPending) {
    return <SetupStatus title="Loading your family…" />;
  }
  if (!roster.data) {
    return (
      <SetupStatus
        title="Your family didn’t load"
        retry={() => roster.refetch()}
        footer={
          <>
            <Button
              variant="link"
              disabled={busy}
              onClick={() => pause.mutate(checkpoint)}
            >
              Save & exit
            </Button>
            <Button
              variant="link"
              disabled={busy}
              onClick={() => cancel.mutate()}
            >
              Cancel
            </Button>
          </>
        }
      >
        {(pause.error || cancel.error) && (
          <SetupError>We couldn’t save your place. Try again.</SetupError>
        )}
      </SetupStatus>
    );
  }
  const activeDraft = draftForAddPage(checkpoint);
  if (!activeDraft || !("organizationId" in checkpoint)) {
    return null;
  }
  return (
    <PersonDraftForm
      draft={activeDraft}
      roster={roster.data}
      organizer={setup.isFamilyOrganizer(checkpoint.organizationId)}
      rosterError={roster.isError}
      busy={busy}
      disabled={busy || manage.managing}
      overlay={<RosterManagementOverlay management={manage} />}
      error={Boolean(pause.error || cancel.error)}
      submit={async (command) => {
        await save
          .mutateAsync({
            command,
            organizationId: checkpoint.organizationId,
            stage: "person-create",
          })
          .catch(() => {
            /* Mutation retains and displays the failure. */
          });
      }}
      pause={(draft) => {
        if (checkpoint.stage === "person-draft") {
          pause.mutate({ ...checkpoint, draft });
        }
      }}
      cancel={() => cancel.mutate()}
      onAction={(kind, person, draft) => {
        manage.begin({
          kind,
          person,
          returnTo: { draft, stage: "person-draft" },
        });
      }}
    />
  );
};
