import {
  PersonCreation,
  PersonDraft,
  InviteHouseholdAdultPayload,
} from "@meal-planner/household-api";
import type {
  HouseholdPeopleRoster,
  SetupCheckpoint,
} from "@meal-planner/household-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";

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

const AddedPeople = ({
  roster,
}: {
  readonly roster: HouseholdPeopleRoster;
}) => (
  <CardFooter variant="people">
    <p className="text-muted-foreground text-sm">Already added</p>
    {roster.people.map((person) => (
      <PersonRow key={person.id} person={person} />
    ))}
  </CardFooter>
);

const PersonDraftForm = ({
  draft,
  busy,
  error,
  submit,
  pause,
  cancel,
  roster,
  rosterError,
}: {
  readonly draft: Draft;
  readonly busy: boolean;
  readonly error: boolean;
  readonly submit: (command: PersonCreation) => Promise<void>;
  readonly pause: (draft: Draft) => void;
  readonly cancel: () => void;
  readonly roster: HouseholdPeopleRoster;
  readonly rosterError?: boolean;
}) => {
  const form = useAppForm({
    defaultValues: {
      email: draft.email,
      invite: draft.invite ?? false,
      name: draft.name,
      participation: draft.participation as string,
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
          disabled={busy}
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
                      disabled={busy}
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
                        disabled={busy}
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
                                  disabled={busy || participation !== "adult"}
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
                                          busy ||
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
                      <Button type="submit" disabled={busy}>
                        {busy ? "Saving…" : label}
                      </Button>
                    );
                  }}
                </form.Subscribe>
                <Button variant="link" disabled={busy} onClick={cancel}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </CardBody>
          <AddedPeople roster={roster} />
        </form.Frame>
      </form.AppForm>
    </SetupFrame>
  );
};

export const AddPersonPage = () => {
  const setup = useSetup();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const roster = useSetupRoster();
  const { checkpoint } = setup.progress;
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
  const retryLabel =
    checkpoint.stage === "person-invite"
      ? "Finish invitation"
      : "Check and continue";
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
    const name =
      pending.stage === "person-invite"
        ? pending.displayName
        : pending.command.person.displayName;
    return (
      <SetupFrame
        step="people"
        action={
          <Button
            variant="link"
            disabled={busy}
            onClick={() => pause.mutate(pending)}
          >
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
              {save.error && (
                <SetupError>
                  We couldn’t finish that request. Try again to check and
                  complete the same request.
                </SetupError>
              )}
              {pause.error && (
                <SetupError>We couldn’t save your place. Try again.</SetupError>
              )}
              <Button disabled={busy} onClick={() => save.mutate(pending)}>
                {busy ? "Saving…" : retryLabel}
              </Button>
            </CardContent>
          </CardBody>
        </Card>
      </SetupFrame>
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
  if (checkpoint.stage !== "person-draft") {
    return null;
  }
  return (
    <PersonDraftForm
      draft={checkpoint.draft}
      roster={roster.data}
      rosterError={roster.isError}
      busy={busy}
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
      pause={(draft) => pause.mutate({ ...checkpoint, draft })}
      cancel={() => cancel.mutate()}
    />
  );
};
