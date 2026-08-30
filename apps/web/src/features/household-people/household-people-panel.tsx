import {
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  HouseholdPersonMutationId,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import type { HouseholdPerson } from "@meal-planner/household-api";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import {
  householdPeopleFailureCode,
  isAmbiguousHouseholdPeopleFailure,
} from "./operations.js";
import type {
  HouseholdPeopleOperationFailureCode,
  HouseholdPeopleOperations,
} from "./operations.js";

const mutationId = () =>
  Schema.decodeUnknownSync(HouseholdPersonMutationId)(crypto.randomUUID());

const hasFailureCode = (
  error: Error | null,
  code: HouseholdPeopleOperationFailureCode
) => householdPeopleFailureCode(error) === code;

const retryAmbiguousFailure = (failureCount: number, error: Error) =>
  failureCount < 1 && isAmbiguousHouseholdPeopleFailure(error);

const creatorSlotOccupiedMessage =
  "This household already has a creator person. Your account remains unlinked. You can continue using the shared roster; account linking is not available here.";

const failureMessage = (error: Error) => {
  const code = householdPeopleFailureCode(error);
  switch (code) {
    case "bootstrap_conflict": {
      return creatorSlotOccupiedMessage;
    }
    case "stale_version": {
      return "This person changed. Refresh the roster and try again.";
    }
    case "unauthorized": {
      return "Your household session is no longer authorized. Sign in again.";
    }
    case "creator_required": {
      return "Only the household owner can set up the first adult person.";
    }
    case "mutation_collision": {
      return "That retry no longer matches this change. Submit it again.";
    }
    case "lifecycle_conflict": {
      return "That person has already changed lifecycle. Refresh the roster.";
    }
    case "internal_error":
    case "people_unavailable":
    case "transport_unavailable": {
      return "The household roster is temporarily unavailable.";
    }
    default: {
      return "The household roster could not be updated.";
    }
  }
};

const failureTitle = (error: Error) =>
  hasFailureCode(error, "bootstrap_conflict")
    ? "Account not linked"
    : "Roster not updated";

const CreatorSlotOccupiedNotice = ({
  visible,
}: {
  readonly visible: boolean;
}) =>
  visible ? (
    <Alert role="status" title="Account not linked">
      {creatorSlotOccupiedMessage}
    </Alert>
  ) : null;

const RetryIntentActions = ({
  abandonLabel,
  disabled,
  onAbandon,
  onRetry,
  retryLabel,
}: {
  readonly abandonLabel: string;
  readonly disabled: boolean;
  readonly onAbandon: () => void;
  readonly onRetry: () => void;
  readonly retryLabel: string;
}) => (
  <div className="people-confirmation">
    <Button disabled={disabled} onClick={onRetry} type="button">
      {retryLabel}
    </Button>
    <Button
      className="button-secondary"
      disabled={disabled}
      onClick={onAbandon}
      type="button"
    >
      {abandonLabel}
    </Button>
  </div>
);

const CreatorBootstrapForm = ({
  error,
  isPending,
  onDiscard,
  onMutate,
  variables,
  visible,
}: {
  readonly error: Error | null;
  readonly isPending: boolean;
  readonly onDiscard: () => void;
  readonly onMutate: (payload: BootstrapHouseholdCreatorPayload) => void;
  readonly variables: BootstrapHouseholdCreatorPayload | undefined;
  readonly visible: boolean;
}) => {
  const retryIntent =
    variables !== undefined && isAmbiguousHouseholdPeopleFailure(error);
  const form = useForm({
    defaultValues: { displayName: "" },
    onSubmit: ({ value }) => {
      if (retryIntent) {
        return;
      }
      onMutate(
        Schema.decodeUnknownSync(BootstrapHouseholdCreatorPayload)({
          ...value,
          mutationId: mutationId(),
        })
      );
    },
  });

  return visible ? (
    <form
      className="people-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h3>Set up your adult person</h3>
      <form.Field name="displayName">
        {(field) => (
          <>
            <Label htmlFor="creator-name">Your name</Label>
            <Input
              id="creator-name"
              onChange={(event) => {
                if (retryIntent) {
                  onDiscard();
                }
                field.handleChange(event.target.value);
              }}
              value={field.state.value}
            />
          </>
        )}
      </form.Field>
      <Button disabled={isPending || retryIntent} type="submit">
        {isPending ? "Setting up…" : "Set up my person"}
      </Button>
      {retryIntent ? (
        <RetryIntentActions
          abandonLabel="Discard setup retry"
          disabled={isPending}
          onAbandon={onDiscard}
          onRetry={() => onMutate(variables)}
          retryLabel="Retry setting up my person"
        />
      ) : null}
    </form>
  ) : null;
};

const CreatePersonForm = ({
  error,
  isPending,
  onDiscard,
  onMutate,
  variables,
  visible,
}: {
  readonly error: Error | null;
  readonly isPending: boolean;
  readonly onDiscard: () => void;
  readonly onMutate: (payload: CreateHouseholdPersonPayload) => void;
  readonly variables: CreateHouseholdPersonPayload | undefined;
  readonly visible: boolean;
}) => {
  const retryIntent =
    variables !== undefined && isAmbiguousHouseholdPeopleFailure(error);
  const form = useForm({
    defaultValues: {
      displayName: "",
      kind: "dependant" as "adult" | "dependant",
    },
    onSubmit: ({ value }) => {
      if (retryIntent) {
        return;
      }
      onMutate(
        Schema.decodeUnknownSync(CreateHouseholdPersonPayload)({
          ...value,
          mutationId: mutationId(),
        })
      );
    },
  });

  return visible ? (
    <form
      className="people-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h3>Add a person</h3>
      <form.Field name="displayName">
        {(field) => (
          <>
            <Label htmlFor="new-person-name">Name</Label>
            <Input
              id="new-person-name"
              onChange={(event) => {
                if (retryIntent) {
                  onDiscard();
                }
                field.handleChange(event.target.value);
              }}
              value={field.state.value}
            />
          </>
        )}
      </form.Field>
      <form.Field name="kind">
        {(field) => (
          <>
            <Label htmlFor="new-person-kind">Kind</Label>
            <select
              className="field-select"
              id="new-person-kind"
              onChange={(event) => {
                if (retryIntent) {
                  onDiscard();
                }
                field.handleChange(event.target.value as "adult" | "dependant");
              }}
              value={field.state.value}
            >
              <option value="dependant">Dependant</option>
              <option value="adult">Adult</option>
            </select>
          </>
        )}
      </form.Field>
      <Button disabled={isPending || retryIntent} type="submit">
        {isPending ? "Adding…" : "Add person"}
      </Button>
      {retryIntent ? (
        <RetryIntentActions
          abandonLabel="Discard add-person retry"
          disabled={isPending}
          onAbandon={onDiscard}
          onRetry={() => onMutate(variables)}
          retryLabel="Retry adding this person"
        />
      ) : null}
    </form>
  ) : null;
};

interface PersonTransition {
  readonly action: "archive" | "restore";
  readonly personId: HouseholdPerson["id"];
  readonly payload: TransitionHouseholdPersonPayload;
}

const PeopleList = ({
  isPending,
  onTransition,
  people,
  retryIntent,
}: {
  readonly isPending: boolean;
  readonly onTransition: (transition: PersonTransition) => void;
  readonly people: readonly HouseholdPerson[];
  readonly retryIntent: boolean;
}) => {
  const archiveConfirmation = useForm({
    defaultValues: { personId: null as null | string },
  });

  return (
    <ul className="people-list">
      {people.map((person) => (
        <li
          className={
            person.lifecycle === "archived"
              ? "person-row person-row-archived"
              : "person-row"
          }
          key={person.id}
        >
          <span>
            <strong>{person.displayName}</strong>
            <small>
              {person.kind}
              {person.isCurrentAdult ? " · you" : ""}
              {person.lifecycle === "archived" ? " · archived" : ""}
            </small>
          </span>
          <archiveConfirmation.Subscribe
            selector={(state) => state.values.personId}
          >
            {(pendingArchiveId) => {
              const transitionPerson = (action: "archive" | "restore") => {
                if (retryIntent) {
                  return;
                }
                onTransition({
                  action,
                  payload: Schema.decodeUnknownSync(
                    TransitionHouseholdPersonPayload
                  )({
                    expectedVersion: person.version,
                    mutationId: mutationId(),
                  }),
                  personId: person.id,
                });
              };
              if (person.lifecycle === "archived") {
                return (
                  <Button
                    className="button-secondary"
                    disabled={isPending || retryIntent}
                    onClick={() => transitionPerson("restore")}
                    type="button"
                  >
                    Restore
                  </Button>
                );
              }
              if (pendingArchiveId === person.id) {
                return (
                  <span className="people-confirmation">
                    <Button
                      disabled={isPending || retryIntent}
                      onClick={() => {
                        transitionPerson("archive");
                        archiveConfirmation.setFieldValue("personId", null);
                      }}
                      type="button"
                    >
                      Confirm archive
                    </Button>
                    <Button
                      className="button-secondary"
                      onClick={() =>
                        archiveConfirmation.setFieldValue("personId", null)
                      }
                      type="button"
                    >
                      Cancel
                    </Button>
                  </span>
                );
              }
              return (
                <Button
                  className="button-secondary"
                  disabled={isPending || retryIntent}
                  onClick={() =>
                    archiveConfirmation.setFieldValue("personId", person.id)
                  }
                  type="button"
                >
                  Archive
                </Button>
              );
            }}
          </archiveConfirmation.Subscribe>
        </li>
      ))}
    </ul>
  );
};

const firstError = (errors: readonly (Error | null)[]) =>
  errors.find((error) => error !== null) ?? null;

/** Minimal explicit household roster and lifecycle surface. */
export const HouseholdPeoplePanel = ({
  operations,
  organizationId,
}: {
  readonly operations: HouseholdPeopleOperations;
  readonly organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const queryKey = ["household-people", organizationId] as const;
  const roster = useQuery({ queryFn: () => operations.list(true), queryKey });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const bootstrap = useMutation({
    mutationFn: (payload: BootstrapHouseholdCreatorPayload) =>
      operations.bootstrapCreator(payload),
    onSuccess: refresh,
    retry: retryAmbiguousFailure,
  });
  const create = useMutation({
    mutationFn: (payload: CreateHouseholdPersonPayload) =>
      operations.create(payload),
    onSuccess: refresh,
    retry: retryAmbiguousFailure,
  });
  const transition = useMutation({
    mutationFn: ({
      action,
      personId,
      payload,
    }: {
      readonly action: "archive" | "restore";
      readonly personId: Parameters<HouseholdPeopleOperations["archive"]>[0];
      readonly payload: TransitionHouseholdPersonPayload;
    }) =>
      action === "archive"
        ? operations.archive(personId, payload)
        : operations.restore(personId, payload),
    onSuccess: refresh,
    retry: retryAmbiguousFailure,
  });
  const error = firstError([
    roster.error,
    bootstrap.error,
    create.error,
    transition.error,
  ]);
  const bootstrapConflict = hasFailureCode(
    bootstrap.error,
    "bootstrap_conflict"
  );
  const creatorSlotOccupied =
    bootstrapConflict || roster.data?.creatorSlot === "occupied";
  const transitionRetryIntent =
    transition.variables !== undefined &&
    isAmbiguousHouseholdPeopleFailure(transition.error);
  const transitionPersonName = roster.data?.people.find(
    (person) => person.id === transition.variables?.personId
  )?.displayName;

  return (
    <section
      aria-labelledby="household-people-heading"
      className="people-panel"
    >
      <div className="people-heading-row">
        <div>
          <p className="eyebrow">Household</p>
          <h2 id="household-people-heading">People</h2>
        </div>
        <Button
          className="button-secondary"
          disabled={roster.isFetching}
          onClick={() => void roster.refetch()}
          type="button"
        >
          {roster.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {roster.isPending ? (
        <p role="status">Loading the household roster…</p>
      ) : null}
      {error === null ? null : (
        <Alert role="alert" title={failureTitle(error)}>
          {failureMessage(error)}
        </Alert>
      )}
      <CreatorSlotOccupiedNotice
        visible={
          !bootstrapConflict &&
          creatorSlotOccupied &&
          roster.data?.currentPersonId === null
        }
      />
      <CreatorBootstrapForm
        error={bootstrap.error}
        isPending={bootstrap.isPending}
        onDiscard={() => bootstrap.reset()}
        onMutate={(payload) => bootstrap.mutate(payload)}
        variables={bootstrap.variables}
        visible={
          roster.data?.currentPersonId === null &&
          roster.data.creatorSlot === "available" &&
          !bootstrapConflict
        }
      />
      {roster.data === undefined ? null : (
        <PeopleList
          isPending={transition.isPending}
          onTransition={(value) => transition.mutate(value)}
          people={roster.data.people}
          retryIntent={transitionRetryIntent}
        />
      )}
      {transitionRetryIntent ? (
        <RetryIntentActions
          abandonLabel={`Discard ${transition.variables.action} retry`}
          disabled={transition.isPending}
          onAbandon={() => transition.reset()}
          onRetry={() => transition.mutate(transition.variables)}
          retryLabel={`Retry ${
            transition.variables.action === "archive"
              ? "archiving"
              : "restoring"
          } ${transitionPersonName ?? "this person"}`}
        />
      ) : null}
      <CreatePersonForm
        error={create.error}
        isPending={create.isPending}
        onDiscard={() => create.reset()}
        onMutate={(payload) => create.mutate(payload)}
        variables={create.variables}
        visible={roster.data !== undefined}
      />
    </section>
  );
};
