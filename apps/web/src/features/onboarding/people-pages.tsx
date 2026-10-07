import type {
  HouseholdPerson,
  HouseholdPeopleRoster,
} from "@meal-planner/household-api";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Schema } from "effect";
import { useState } from "react";
import type { ReactNode } from "react";

import { useAppForm } from "../../components/forms/form.js";
import { OperationError } from "../../components/operation-error.js";
import { StatusScreen } from "../../components/status-screen.js";
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
import { apiEffectQuery } from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import {
  PersonRow,
  useFamilyRoster,
  PersonCreation,
  PersonDraft,
  useAddFamilyPerson,
  RosterActions,
  RosterManagementOverlay,
  useRosterManagement,
  useFamily,
} from "../family/index.js";
import type { RosterAction } from "../family/index.js";
import {
  PersonNameInput,
  ParticipationInput,
  InvitationEmailInput,
} from "../household-people/index.js";
import { SetupFrame } from "./setup-ui.js";

const nameValidator = Schema.toStandardSchemaV1(PersonNameInput);
const participationValidator = Schema.toStandardSchemaV1(ParticipationInput);
const emailValidator = Schema.toStandardSchemaV1(InvitationEmailInput);
type Draft = typeof PersonDraft.Type;
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
                <OperationError>
                  Your family list couldn’t refresh. Your draft is still here;
                  you can save and return later.
                </OperationError>
              )}
              {logoutError && (
                <OperationError>
                  We couldn’t log you out. Try again.
                </OperationError>
              )}
              {error && !logoutError && (
                <OperationError>
                  We couldn’t save this person. Try again.
                </OperationError>
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

export const AddPersonPage = () => {
  const returnTo = useRouterState({ select: (state) => state.location.href });
  const setup = useFamily();
  const navigate = useNavigate();
  const account = useAccount();
  const roster = useFamilyRoster();
  const manage = useRosterManagement();
  const save = useAddFamilyPerson();
  const [navigationFailed, setNavigationFailed] = useState(false);
  const openReview = async () => {
    try {
      await navigate({
        search: setup.family ? { familyId: setup.family.id } : {},
        to: "/setup/review",
      });
    } catch {
      setNavigationFailed(true);
    }
  };
  const logout = useMutation(
    apiEffectQuery.mutationOptions({
      mutationFn: () => account.logout("/setup"),
      mutationKey: ["setup-logout"],
    })
  );
  const submit = async (command: PersonCreation) => {
    if (!setup.family) {
      return;
    }
    try {
      const result = await save.submit(command);
      if (result.invitationIssue === null) {
        await openReview();
      }
    } catch {
      /* The retained request and mutation own an uncertain outcome. */
    }
  };
  let saveError = "We couldn’t confirm the result. Try again.";
  if (save.data) {
    saveError =
      "This person is saved, but we couldn’t refresh the family. Continue to try again.";
  } else if (save.needsAuthentication) {
    saveError =
      "Your session ended. Log in in a new tab, then return here to retry this request.";
  }
  if (save.pendingRequest || save.isSuccess) {
    const pending = save.pendingRequest;
    return (
      <SetupFrame
        step="people"
        action={
          <Button
            variant="link"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
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
                  {save.isSuccess ? "Person added" : "Check your request"}
                </h1>
              </CardTitle>
              <CardDescription>
                {save.isSuccess
                  ? "Their profile is saved in your family."
                  : "We kept the submitted details. Retry the same request to confirm the result."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {save.data?.invitationIssue && (
                <OperationError>
                  The person is saved, but the invitation was rejected. Review
                  the family and use Invite to join to correct the address.
                </OperationError>
              )}
              {save.error && <OperationError>{saveError}</OperationError>}
              {navigationFailed && (
                <OperationError>
                  The person is saved. Try opening your family again.
                </OperationError>
              )}
              {logout.error && (
                <OperationError>
                  We couldn’t log you out. Try again.
                </OperationError>
              )}
              {save.needsAuthentication && (
                <Link
                  to="/login"
                  search={{ redirect: returnTo }}
                  target="_blank"
                  rel="noopener"
                >
                  Log in in a new tab
                </Link>
              )}
              {pending ? (
                <PendingButton
                  pending={save.isPending}
                  pendingLabel="Checking request…"
                  disabled={save.isPending}
                  onClick={() => {
                    void submit(pending.command);
                  }}
                >
                  Check and continue
                </PendingButton>
              ) : (
                <Button
                  onClick={() => {
                    void openReview();
                  }}
                >
                  Review family
                </Button>
              )}
            </CardContent>
          </CardBody>
        </Card>
      </SetupFrame>
    );
  }
  if (roster.isPending) {
    return <StatusScreen pending title="Loading your family…" />;
  }
  if (!roster.data) {
    return (
      <StatusScreen
        title="Your family couldn’t load"
        retry={() => roster.refetch()}
      />
    );
  }
  return (
    <PersonDraftForm
      draft={{ email: "", invite: false, name: "", participation: "adult" }}
      roster={roster.data}
      organizer={setup.family?.canManage ?? false}
      rosterError={roster.isError}
      busy={save.isPending}
      saving={save.isPending}
      disabled={save.isPending || manage.managing}
      overlay={
        <>
          <RosterManagementOverlay management={manage} />
        </>
      }
      error={Boolean(save.error)}
      logoutError={Boolean(logout.error)}
      loggingOut={logout.isPending}
      submit={submit}
      logout={() => logout.mutate()}
      cancel={() => {
        void openReview();
      }}
      onAction={(kind, person) => manage.begin({ kind, person })}
    />
  );
};
