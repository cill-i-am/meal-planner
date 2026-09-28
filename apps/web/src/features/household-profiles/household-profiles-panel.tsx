import type {
  HouseholdPerson,
  HouseholdPersonId,
  PersonProfile,
  ProfileCommand,
  ProfileFact,
} from "@meal-planner/household-api";
import { useForm } from "@tanstack/react-form";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Label } from "../../components/ui/label.js";
import { PendingButton } from "../../components/ui/pending-button.js";
import type { HouseholdPeopleOperations } from "../household-people/index.js";
import {
  isAmbiguousProfileError,
  ProfileOperationError,
} from "./operations.js";
import type { HouseholdProfileOperations } from "./operations.js";
import { describeProfileFact, ProfileFactForm } from "./profile-fact-form.js";
import {
  useHouseholdProfileState,
  usePersonProfile,
  useProfileHistory,
} from "./profile-state.js";

const pendingMessage = (saving: boolean, authenticationRequired: boolean) => {
  if (saving) {
    return "Saving your change…";
  }
  if (authenticationRequired) {
    return "Sign in again in another tab, then return here and retry the saved change. Its exact command is retained; authentication rejection does not resolve an earlier uncertain result.";
  }
  return "The last change’s outcome is not known. Resolve it before making another profile change.";
};
const basisFor = (person: HouseholdPerson) => {
  if (person.isCurrentAdult) {
    return "self";
  }
  return person.kind === "dependant" ? "household_adult" : "provisional";
};
const standingLabel = (fact: ProfileFact) => {
  if (fact.standing._tag === "provisional") {
    return "Provisional";
  }
  return fact.standing.basis === "self"
    ? "Self-confirmed"
    : "Confirmed by a household adult";
};
const profileErrorMessage = (error: Error | null) => {
  if (!(error instanceof ProfileOperationError)) {
    return "This profile could not be loaded. Retry when the service is available.";
  }
  const messages = {
    adult_required: "Link an active adult person before editing profiles.",
    ambiguous:
      "The change may have saved. Retry the saved command before making another change.",
    authentication_required:
      "Sign in again, then retry the saved change. Its exact command is retained.",
    fact_conflict:
      "This fact conflicts with existing information. Reload and resolve the conflict explicitly.",
    fact_not_found:
      "This fact is no longer current. Reload the profile before editing.",
    mutation_collision:
      "This saved command conflicts with an earlier command. No new change was made. Reload before starting again.",
    person_archived:
      "This person is archived. Restore them in the roster before editing.",
    person_not_found: "This person is not available in this household.",
    profile_unavailable:
      "The profile service is unavailable. Retry the saved command.",
    safety_confirmation_required:
      "Use the separate safety change flow and explicitly confirm the change.",
    self_required:
      "You can only self-confirm facts for your linked person. Another adult’s new information must be provisional.",
    stale_version:
      "This profile changed. Reload it, review the latest version, then explicitly reapply your change.",
  };
  return messages[error.code];
};

const ProfileHistory = ({
  operations,
  organizationId,
  personId,
  people,
}: {
  readonly operations: HouseholdProfileOperations;
  readonly organizationId: string;
  readonly personId: HouseholdPersonId;
  readonly people: readonly HouseholdPerson[];
}) => {
  const history = useProfileHistory(operations, organizationId, personId);
  return (
    <details className="border-t pt-3">
      <summary className="min-h-11 cursor-pointer font-semibold">
        Version and change history
      </summary>
      {history.isError && (
        <Alert>
          History could not be loaded.{" "}
          <Button
            onClick={() => {
              void history.refetch();
            }}
          >
            Retry history
          </Button>
        </Alert>
      )}
      {history.isPending && <p role="status">Loading history…</p>}
      <ol className="space-y-4">
        {history.data?.pages
          .flatMap((page) => page.versions)
          .map((version) => {
            const { audit } = version;
            if (audit === null) {
              return null;
            }
            const actor =
              people.find((person) => person.id === audit.actorPersonId)
                ?.displayName ?? "Household adult";
            return (
              <li key={version.version}>
                <p>
                  <strong>Version {version.version}</strong> · {actor} ·{" "}
                  {new Date(audit.atEpochMs).toLocaleString()} ·{" "}
                  {audit.source === "interview"
                    ? "Interview confirmation"
                    : "Manual entry"}
                </p>
                <p>
                  Before:{" "}
                  {audit.before === null
                    ? "No fact"
                    : describeProfileFact(audit.before.value)}
                  {audit.before === null
                    ? ""
                    : ` — ${standingLabel(audit.before)}`}
                </p>
                <p>
                  After:{" "}
                  {audit.after === null
                    ? "Fact removed"
                    : describeProfileFact(audit.after.value)}
                  {audit.after === null
                    ? ""
                    : ` — ${standingLabel(audit.after)}`}
                </p>
              </li>
            );
          })}
      </ol>
      {history.hasNextPage && (
        <PendingButton
          disabled={history.isFetchingNextPage}
          pending={history.isFetchingNextPage}
          pendingLabel="Loading older changes…"
          onClick={() => {
            void history.fetchNextPage();
          }}
        >
          Older changes
        </PendingButton>
      )}
    </details>
  );
};

const ProfileFacts = ({
  person,
  profile,
  disabled,
  submit,
}: {
  readonly person: HouseholdPerson;
  readonly profile: PersonProfile;
  readonly disabled: boolean;
  readonly submit: (command: ProfileCommand) => void;
}) => (
  <ul className="divide-y">
    {profile.facts.map((fact) => (
      <li key={fact.id} className="space-y-2 py-4">
        <p className="font-semibold">{describeProfileFact(fact.value)}</p>
        <p>
          {standingLabel(fact)} ·{" "}
          {fact.source === "interview"
            ? "Interview confirmation"
            : "Manual entry"}{" "}
          · Updated in version {fact.updatedInVersion}
        </p>
        <div className="flex flex-wrap gap-2">
          {fact.standing._tag === "provisional" &&
            basisFor(person) !== "provisional" && (
              <Button
                disabled={disabled}
                onClick={() =>
                  submit({
                    _tag: "ConfirmProfileFact",
                    basis: person.isCurrentAdult ? "self" : "household_adult",
                    factId: fact.id,
                  })
                }
              >
                Confirm fact
              </Button>
            )}
          {fact.value._tag === "FoodPreference" && (
            <Button
              disabled={disabled}
              onClick={() =>
                submit({ _tag: "RemoveOrdinaryProfileFact", factId: fact.id })
              }
            >
              Remove preference
            </Button>
          )}
        </div>
        <details>
          <summary className="min-h-11 cursor-pointer">
            {fact.value._tag === "FoodPreference"
              ? "Edit preference"
              : "Change or remove safety fact"}
          </summary>
          <ProfileFactForm
            key={`${fact.id}:${profile.version}`}
            basis={basisFor(person)}
            disabled={disabled}
            fact={fact}
            submit={submit}
          />
        </details>
      </li>
    ))}
  </ul>
);

const SelectedProfile = ({
  operations,
  organizationId,
  person,
  people,
  blocked,
  error,
  clearError,
  send,
}: {
  readonly operations: HouseholdProfileOperations;
  readonly organizationId: string;
  readonly person: HouseholdPerson;
  readonly people: readonly HouseholdPerson[];
  readonly blocked: boolean;
  readonly error: Error | null;
  readonly clearError: () => void;
  readonly send: (profile: PersonProfile, command: ProfileCommand) => void;
}) => {
  const profile = usePersonProfile(operations, organizationId, person.id);
  const definitiveError =
    error !== null &&
    !isAmbiguousProfileError(error) &&
    !(
      error instanceof ProfileOperationError &&
      error.code === "authentication_required"
    );
  const disabled =
    blocked ||
    person.lifecycle === "archived" ||
    definitiveError ||
    profile.isError ||
    profile.isFetching;
  return (
    <div className="space-y-4">
      <h3>{person.displayName}’s food profile</h3>
      {profile.isPending && <p role="status">Loading profile…</p>}
      {(profile.isError || definitiveError) && (
        <Alert>
          <p>{profileErrorMessage(error)}</p>
          <Button
            onClick={async () => {
              const result = await profile.refetch();
              if (result.isSuccess) {
                clearError();
              }
            }}
          >
            Reload profile
          </Button>
        </Alert>
      )}
      {person.lifecycle === "archived" && (
        <p>
          Archived person — history is preserved. Restore them in the roster
          before editing.
        </p>
      )}
      {profile.data !== undefined && (
        <>
          <p>
            Profile version {profile.data.version}.{" "}
            {profile.data.facts.length === 0
              ? "No facts recorded. Missing information does not mean no safety constraints."
              : ""}
          </p>
          <ProfileFacts
            person={person}
            profile={profile.data}
            disabled={disabled}
            submit={(command) => {
              if (profile.data !== undefined) {
                send(profile.data, command);
              }
            }}
          />
          <ProfileFactForm
            key={`${person.id}:${profile.data.version}`}
            basis={basisFor(person)}
            disabled={disabled}
            submit={(command) => {
              if (profile.data !== undefined) {
                send(profile.data, command);
              }
            }}
          />
          <ProfileHistory
            operations={operations}
            organizationId={organizationId}
            personId={person.id}
            people={people}
          />
        </>
      )}
    </div>
  );
};

export const HouseholdProfilesPanel = ({
  accountId,
  operations,
  organizationId,
  peopleOperations,
}: {
  readonly accountId: string;
  readonly operations: HouseholdProfileOperations;
  readonly organizationId: string;
  readonly peopleOperations: Pick<HouseholdPeopleOperations, "list">;
}) => {
  const { clearError, error, isSaving, pending, retryPending, roster, send } =
    useHouseholdProfileState({
      accountId,
      operations,
      organizationId,
      peopleOperations,
    });
  const selection = useForm({ defaultValues: { personId: "" } });
  return (
    <section
      id="household-profiles"
      aria-labelledby="household-profiles-heading"
      className="space-y-4 border-t pt-6"
    >
      <h2 id="household-profiles-heading">Food profiles</h2>
      <p>
        Food preferences and safety facts are visible to this household. Nothing
        here is a private conversation.
      </p>
      {roster.isError && (
        <Alert>
          People could not be loaded.{" "}
          <Button
            onClick={() => {
              void roster.refetch();
            }}
          >
            Retry people
          </Button>
        </Alert>
      )}
      {roster.data?.currentPersonId === null && (
        <p>
          Link your adult person in the roster before editing food profiles.
        </p>
      )}
      {pending !== null && (
        <Alert>
          <p>
            {pendingMessage(isSaving, pending.authenticationRequired === true)}
          </p>
          {pending.authenticationRequired && (
            <p>
              <a href="/" target="_blank" rel="noreferrer">
                Open sign-in in another tab
              </a>
            </p>
          )}
          <PendingButton
            disabled={isSaving}
            pending={isSaving}
            pendingLabel="Checking saved change…"
            onClick={retryPending}
          >
            {pending.authenticationRequired
              ? "I’ve signed in — retry saved change"
              : "Retry saved change"}
          </PendingButton>
        </Alert>
      )}
      <selection.Field name="personId">
        {(field) => (
          <div>
            <Label htmlFor="profile-person">Person</Label>
            <select
              id="profile-person"
              className="input"
              disabled={pending !== null}
              value={
                pending?.personId ??
                (field.state.value ||
                  roster.data?.currentPersonId ||
                  roster.data?.people[0]?.id ||
                  "")
              }
              onChange={(event) => field.handleChange(event.target.value)}
            >
              {roster.data?.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                  {person.lifecycle === "archived" ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </selection.Field>
      <selection.Subscribe selector={(state) => state.values.personId}>
        {(selected) => {
          const personId =
            pending?.personId ??
            (selected ||
              roster.data?.currentPersonId ||
              roster.data?.people[0]?.id);
          const person = roster.data?.people.find(
            (candidate) => candidate.id === personId
          );
          return person === undefined ? null : (
            <SelectedProfile
              operations={operations}
              organizationId={organizationId}
              person={person}
              people={roster.data?.people ?? []}
              blocked={
                pending !== null ||
                isSaving ||
                roster.data?.currentPersonId === null
              }
              error={error}
              clearError={clearError}
              send={(profile, command) => send(person.id, profile, command)}
            />
          );
        }}
      </selection.Subscribe>
    </section>
  );
};
