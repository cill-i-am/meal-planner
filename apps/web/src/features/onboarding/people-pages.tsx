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
import { Effect, Schema } from "effect";
import { useState } from "react";
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
import { PendingButton } from "../../components/ui/pending-button.js";
import { PersonRow, useSetupRoster } from "./family-review.js";
import { InvitationCorrectionForm } from "./invitation-correction.js";
import { setupEffectQuery } from "./onboarding-people.js";
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
    <p className="text-muted-foreground text-sm">Your family so far</p>
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
  saving,
  disabled,
  error,
  submit,
  logout,
  loggingOut,
  logoutError,
  cancel,
  roster,
  organizer,
  rosterError,
  onAction,
  overlay,
}: {
  readonly draft: Draft;
  readonly busy: boolean;
  readonly saving: boolean;
  readonly disabled: boolean;
  readonly error: boolean;
  readonly submit: (command: PersonCreation) => Promise<void>;
  readonly logout: (draft: Draft) => void;
  readonly loggingOut: boolean;
  readonly logoutError: boolean;
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
            logout(Schema.decodeUnknownSync(PersonDraft)(form.state.values))
          }
        >
          {loggingOut ? "Logging out…" : "Log out"}
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
              <CardDescription>
                <form.Subscribe
                  selector={(state) => state.values.participation}
                >
                  {(participation) =>
                    participation === "dependant"
                      ? "Add a child you plan meals for. You’ll manage their food preferences."
                      : "Add an adult you plan meals for. You can invite them to join now or later."
                  }
                </form.Subscribe>
              </CardDescription>
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
              {logoutError && (
                <SetupError>
                  We couldn’t save your place or log you out. Try again.
                </SetupError>
              )}
              {error && !logoutError && (
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
                      <PendingButton
                        type="submit"
                        disabled={disabled}
                        pending={saving}
                        pendingLabel="Saving person…"
                      >
                        {label}
                      </PendingButton>
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
  saving,
  failed,
  logoutFailed,
  retry,
  logout,
}: {
  readonly pending: Pending;
  readonly busy: boolean;
  readonly saving: boolean;
  readonly failed: boolean;
  readonly logoutFailed: boolean;
  readonly retry: () => void;
  readonly logout: () => void;
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
        <Button variant="link" disabled={busy} onClick={logout}>
          Log out
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
            {logoutFailed && (
              <SetupError>
                We couldn’t save your place or log you out. Try again.
              </SetupError>
            )}
            <PendingButton
              disabled={busy}
              onClick={retry}
              pending={saving}
              pendingLabel="Checking request…"
            >
              {retryLabel}
            </PendingButton>
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
  const [openingReview, setOpeningReview] = useState(false);
  const [openReviewFailed, setOpenReviewFailed] = useState(false);
  const openReview = async (organizationId: Pending["organizationId"]) => {
    setOpeningReview(true);
    setOpenReviewFailed(false);
    try {
      await queryClient.invalidateQueries({
        queryKey: ["setup-roster", organizationId],
      });
      await navigate({ to: "/setup" });
    } catch {
      setOpenReviewFailed(true);
    } finally {
      setOpeningReview(false);
    }
  };
  const save = useMutation(
    setupEffectQuery.mutationOptions({
      mutationFn: (pending: Pending) =>
        Effect.gen(function* savePersonCheckpoint() {
          yield* setup.save({ checkpoint: pending, status: "active" });
          yield* saveSetupPerson(
            pending,
            setup.peopleEffectForFamily(pending.organizationId),
            (next, sourceCommandId) =>
              setup.save(
                { checkpoint: next, status: "active" },
                sourceCommandId
              )
          );
        }),
      mutationKey: ["setup-person-save"],
      onSuccess: (_result, pending) => openReview(pending.organizationId),
    })
  );
  const exit = useMutation(
    setupEffectQuery.mutationOptions({
      mutationFn: (next: SetupCheckpoint) =>
        setup.logout({ checkpoint: next, status: "paused" }),
      mutationKey: ["setup-person-logout"],
    })
  );
  const cancel = useMutation(
    setupEffectQuery.mutationOptions({
      mutationFn: () => {
        if (!("organizationId" in checkpoint)) {
          return Effect.void;
        }
        return setup.save({
          checkpoint: {
            organizationId: checkpoint.organizationId,
            stage: "family-review",
          },
          status: "active",
        });
      },
      mutationKey: ["setup-person-cancel"],
      onSuccess: () => navigate({ to: "/setup/review" }),
    })
  );
  const pending =
    checkpoint.stage === "person-create" || checkpoint.stage === "person-invite"
      ? checkpoint
      : save.variables;
  const busy =
    openingReview ||
    [save, exit, cancel].some((operation) => operation.isPending);
  if (checkpoint.stage === "person-invite-draft") {
    return (
      <InvitationCorrectionForm
        checkpoint={checkpoint}
        busy={busy}
        saving={save.isPending}
        error={Boolean(exit.error || cancel.error || openReviewFailed)}
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
        logout={(email) => exit.mutate({ ...checkpoint, email })}
        cancel={() => cancel.mutate()}
      />
    );
  }
  if (pending) {
    return (
      <PendingPersonRequest
        pending={pending}
        busy={busy}
        saving={save.isPending}
        failed={Boolean(save.error || openReviewFailed)}
        logoutFailed={Boolean(exit.error)}
        retry={async () => {
          if (save.isSuccess) {
            await openReview(pending.organizationId);
          } else {
            save.mutate(pending);
          }
        }}
        logout={() => exit.mutate(pending)}
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
        action={
          <Button
            variant="link"
            disabled={busy}
            onClick={() => exit.mutate(checkpoint)}
          >
            {exit.isPending ? "Logging out…" : "Log out"}
          </Button>
        }
        footer={
          <Button
            variant="link"
            disabled={busy}
            onClick={() => cancel.mutate()}
          >
            Cancel
          </Button>
        }
      >
        {(exit.error || cancel.error || openReviewFailed) && (
          <SetupError>
            {exit.error
              ? "We couldn’t save your place or log you out. Try again."
              : "We couldn’t save your place. Try again."}
          </SetupError>
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
      saving={save.isPending}
      disabled={busy || manage.managing}
      overlay={<RosterManagementOverlay management={manage} />}
      error={Boolean(cancel.error)}
      logoutError={Boolean(exit.error)}
      loggingOut={exit.isPending}
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
      logout={(draft) => {
        if (checkpoint.stage === "person-draft") {
          exit.mutate({ ...checkpoint, draft });
        } else {
          exit.mutate(checkpoint);
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
