import {
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  HouseholdPersonDisplayName,
  HouseholdPersonMutationId,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import type { HouseholdPerson } from "@meal-planner/household-api";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useRef } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import { HouseholdAssociationControls } from "./household-association-controls.js";
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

const displayNameMessage = (value: string) =>
  Schema.is(HouseholdPersonDisplayName)(value)
    ? undefined
    : "Name must be between 1 and 80 characters with no leading or trailing spaces.";

const hasFailureCode = (
  error: Error | null,
  code: HouseholdPeopleOperationFailureCode
) => householdPeopleFailureCode(error) === code;

const retryAmbiguousFailure = (failureCount: number, error: Error) =>
  failureCount < 1 && isAmbiguousHouseholdPeopleFailure(error);

const resetMutationIfSettled = (mutation: {
  readonly isPending: boolean;
  readonly reset: () => void;
}) => {
  if (!mutation.isPending) {
    mutation.reset();
  }
};

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
  disabled,
  onRetry,
  retryLabel,
}: {
  readonly disabled: boolean;
  readonly onRetry: () => void;
  readonly retryLabel: string;
}) => (
  <div className="people-confirmation">
    <Button disabled={disabled} onClick={onRetry} type="button">
      {retryLabel}
    </Button>
  </div>
);

const CreatorBootstrapForm = ({
  error,
  isDisabled,
  isPending,
  onMutate,
  onRetry,
  variables,
  visible,
}: {
  readonly error: Error | null;
  readonly isDisabled: boolean;
  readonly isPending: boolean;
  readonly onMutate: (payload: BootstrapHouseholdCreatorPayload) => void;
  readonly onRetry: (payload: BootstrapHouseholdCreatorPayload) => void;
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
      <form.Field
        name="displayName"
        validators={{ onBlur: ({ value }) => displayNameMessage(value) }}
      >
        {(field) => (
          <>
            <Label htmlFor="creator-name">Your name</Label>
            <Input
              aria-describedby="creator-name-error"
              aria-invalid={field.state.meta.errors.length > 0}
              disabled={isDisabled}
              id="creator-name"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              value={field.state.value}
            />
            <p className="field-error" id="creator-name-error">
              {field.state.meta.errors.filter(Boolean).join(" ")}
            </p>
          </>
        )}
      </form.Field>
      <Button disabled={isDisabled || retryIntent} type="submit">
        {isPending ? "Setting up…" : "Set up my person"}
      </Button>
      {retryIntent ? (
        <RetryIntentActions
          disabled={isPending}
          onRetry={() => onRetry(variables)}
          retryLabel="Retry setting up my person"
        />
      ) : null}
    </form>
  ) : null;
};

const CreatePersonForm = ({
  error,
  isDisabled,
  isPending,
  onMutate,
  onRetry,
  variables,
  visible,
}: {
  readonly error: Error | null;
  readonly isDisabled: boolean;
  readonly isPending: boolean;
  readonly onMutate: (payload: CreateHouseholdPersonPayload) => void;
  readonly onRetry: (payload: CreateHouseholdPersonPayload) => void;
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
      <form.Field
        name="displayName"
        validators={{ onBlur: ({ value }) => displayNameMessage(value) }}
      >
        {(field) => (
          <>
            <Label htmlFor="new-person-name">Name</Label>
            <Input
              aria-describedby="new-person-name-error"
              aria-invalid={field.state.meta.errors.length > 0}
              disabled={isDisabled}
              id="new-person-name"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              value={field.state.value}
            />
            <p className="field-error" id="new-person-name-error">
              {field.state.meta.errors.filter(Boolean).join(" ")}
            </p>
          </>
        )}
      </form.Field>
      <form.Field name="kind">
        {(field) => (
          <>
            <Label htmlFor="new-person-kind">Kind</Label>
            <select
              className="field-select"
              disabled={isDisabled}
              id="new-person-kind"
              onChange={(event) =>
                field.handleChange(event.target.value as "adult" | "dependant")
              }
              value={field.state.value}
            >
              <option value="dependant">Dependant</option>
              <option value="adult">Adult</option>
            </select>
          </>
        )}
      </form.Field>
      <Button disabled={isDisabled || retryIntent} type="submit">
        {isPending ? "Adding…" : "Add person"}
      </Button>
      {retryIntent ? (
        <RetryIntentActions
          disabled={isPending}
          onRetry={() => onRetry(variables)}
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

  const renderPanel = () => (
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
  return renderPanel();
};

const firstError = (errors: readonly (Error | null)[]) =>
  errors.find((error) => error !== null) ?? null;

const hasAmbiguousRetryIntent = (mutation: {
  readonly error: Error | null;
  readonly variables: unknown;
}) =>
  mutation.variables !== undefined &&
  isAmbiguousHouseholdPeopleFailure(mutation.error);

interface TransitionMutationVariables {
  readonly action: "archive" | "restore";
  readonly personId: Parameters<HouseholdPeopleOperations["archive"]>[0];
  readonly payload: TransitionHouseholdPersonPayload;
}

const TransitionRetryIntentActions = ({
  disabled,
  onRetry,
  personName,
  variables,
}: {
  readonly disabled: boolean;
  readonly onRetry: (variables: TransitionMutationVariables) => void;
  readonly personName: string | undefined;
  readonly variables: TransitionMutationVariables | undefined;
}) =>
  variables === undefined ? null : (
    <RetryIntentActions
      disabled={disabled}
      onRetry={() => onRetry(variables)}
      retryLabel={`Retry ${
        variables.action === "archive" ? "archiving" : "restoring"
      } ${personName ?? "this person"}`}
    />
  );

const AssociationRetryIntent = <Payload,>({
  disabled,
  label,
  mutation,
  onRetry,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly mutation: {
    readonly error: Error | null;
    readonly variables: Payload | undefined;
  };
  readonly onRetry: (payload: Payload) => void;
}) => {
  const { variables } = mutation;
  return hasAmbiguousRetryIntent(mutation) && variables !== undefined ? (
    <RetryIntentActions
      disabled={disabled}
      onRetry={() => onRetry(variables)}
      retryLabel={label}
    />
  ) : null;
};

/** Minimal explicit household roster and lifecycle surface. */
export const HouseholdPeoplePanel = ({
  currentMemberId,
  operations,
  organizationId,
}: {
  readonly currentMemberId?: string;
  readonly operations: HouseholdPeopleOperations;
  readonly organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const personActionLock = useRef(false);
  const queryKey = ["household-people", organizationId] as const;
  const roster = useQuery({ queryFn: () => operations.list(true), queryKey });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const bootstrap = useMutation({
    mutationFn: (payload: BootstrapHouseholdCreatorPayload) =>
      operations.bootstrapCreator(payload),
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: refresh,
    retry: retryAmbiguousFailure,
  });
  const create = useMutation({
    mutationFn: (payload: CreateHouseholdPersonPayload) =>
      operations.create(payload),
    onSettled: () => {
      personActionLock.current = false;
    },
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
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: refresh,
    retry: retryAmbiguousFailure,
  });
  const inviteAdult = useMutation({
    mutationFn:
      operations.inviteAdult ??
      (() => Promise.reject(new Error("unsupported"))),
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: refresh,
    retry: retryAmbiguousFailure,
  });
  const completeAdultLink = useMutation({
    mutationFn:
      operations.completeAdultLink ??
      (() => Promise.reject(new Error("unsupported"))),
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: refresh,
    retry: retryAmbiguousFailure,
  });
  const departAdult = useMutation({
    mutationFn:
      operations.departAdult ??
      (() => Promise.reject(new Error("unsupported"))),
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: refresh,
    retry: retryAmbiguousFailure,
  });
  const repairAdultLink = useMutation({
    mutationFn:
      operations.repairAdultLink ??
      (() => Promise.reject(new Error("unsupported"))),
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: refresh,
    retry: retryAmbiguousFailure,
  });
  const returnAdult = useMutation({
    mutationFn:
      operations.returnAdult ??
      (() => Promise.reject(new Error("unsupported"))),
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: refresh,
    retry: retryAmbiguousFailure,
  });
  const isPersonMutationPending = [
    bootstrap.isPending,
    completeAdultLink.isPending,
    create.isPending,
    departAdult.isPending,
    inviteAdult.isPending,
    repairAdultLink.isPending,
    returnAdult.isPending,
    transition.isPending,
  ].some(Boolean);
  const hasUnresolvedAmbiguousIntent = [
    bootstrap,
    completeAdultLink,
    create,
    departAdult,
    inviteAdult,
    repairAdultLink,
    returnAdult,
    transition,
  ].some(hasAmbiguousRetryIntent);
  const resetSettledMutations = () => {
    resetMutationIfSettled(bootstrap);
    resetMutationIfSettled(create);
    resetMutationIfSettled(inviteAdult);
    resetMutationIfSettled(completeAdultLink);
    resetMutationIfSettled(departAdult);
    resetMutationIfSettled(repairAdultLink);
    resetMutationIfSettled(returnAdult);
    resetMutationIfSettled(transition);
  };
  const runIfIdle = (action: () => void, allowAmbiguousRetry = false) => {
    if (
      personActionLock.current ||
      isPersonMutationPending ||
      (hasUnresolvedAmbiguousIntent && !allowAmbiguousRetry)
    ) {
      return;
    }
    personActionLock.current = true;
    if (!allowAmbiguousRetry) {
      resetSettledMutations();
    }
    action();
  };
  const beginBootstrap = (payload: BootstrapHouseholdCreatorPayload) => {
    runIfIdle(() => bootstrap.mutate(payload));
  };
  const beginCreate = (payload: CreateHouseholdPersonPayload) => {
    runIfIdle(() => create.mutate(payload));
  };
  const beginTransition = (value: Parameters<typeof transition.mutate>[0]) => {
    runIfIdle(() => transition.mutate(value));
  };
  const retryBootstrap = (payload: BootstrapHouseholdCreatorPayload) => {
    runIfIdle(() => bootstrap.mutate(payload), true);
  };
  const retryCreate = (payload: CreateHouseholdPersonPayload) => {
    runIfIdle(() => create.mutate(payload), true);
  };
  const retryTransition = (value: Parameters<typeof transition.mutate>[0]) => {
    runIfIdle(() => transition.mutate(value), true);
  };
  const error = firstError([
    roster.error,
    bootstrap.error,
    create.error,
    transition.error,
    inviteAdult.error,
    completeAdultLink.error,
    departAdult.error,
    repairAdultLink.error,
    returnAdult.error,
  ]);
  const bootstrapConflict = hasFailureCode(
    bootstrap.error,
    "bootstrap_conflict"
  );
  const creatorSlotOccupied =
    bootstrapConflict || roster.data?.creatorSlot === "occupied";
  const transitionPersonName = roster.data?.people.find(
    (person) => person.id === transition.variables?.personId
  )?.displayName;
  const renderAssociationControls = () =>
    roster.data === undefined ? null : (
      <>
        <HouseholdAssociationControls
          {...(currentMemberId === undefined ? {} : { currentMemberId })}
          disabled={isPersonMutationPending || hasUnresolvedAmbiguousIntent}
          {...(operations.completeAdultLink === undefined
            ? {}
            : {
                onCompleteLink: (payload) =>
                  runIfIdle(() => completeAdultLink.mutate(payload)),
              })}
          {...(operations.departAdult === undefined
            ? {}
            : {
                onDepart: (payload) =>
                  runIfIdle(() => departAdult.mutate(payload)),
              })}
          {...(operations.inviteAdult === undefined
            ? {}
            : {
                onInvite: (payload) =>
                  runIfIdle(() => inviteAdult.mutate(payload)),
              })}
          {...(operations.repairAdultLink === undefined
            ? {}
            : {
                onRepair: (payload) =>
                  runIfIdle(() => repairAdultLink.mutate(payload)),
              })}
          {...(operations.returnAdult === undefined
            ? {}
            : {
                onReturn: (payload) =>
                  runIfIdle(() => returnAdult.mutate(payload)),
              })}
          roster={roster.data}
        />
        <AssociationRetryIntent
          disabled={isPersonMutationPending}
          label="Retry sending this invitation"
          mutation={inviteAdult}
          onRetry={(payload) =>
            runIfIdle(() => inviteAdult.mutate(payload), true)
          }
        />
        <AssociationRetryIntent
          disabled={isPersonMutationPending}
          label="Retry linking my account"
          mutation={completeAdultLink}
          onRetry={(payload) =>
            runIfIdle(() => completeAdultLink.mutate(payload), true)
          }
        />
        <AssociationRetryIntent
          disabled={isPersonMutationPending}
          label="Retry repairing this link"
          mutation={repairAdultLink}
          onRetry={(payload) =>
            runIfIdle(() => repairAdultLink.mutate(payload), true)
          }
        />
        <AssociationRetryIntent
          disabled={isPersonMutationPending}
          label="Retry this departure"
          mutation={departAdult}
          onRetry={(payload) =>
            runIfIdle(() => departAdult.mutate(payload), true)
          }
        />
        <AssociationRetryIntent
          disabled={isPersonMutationPending}
          label="Retry restoring this person"
          mutation={returnAdult}
          onRetry={(payload) =>
            runIfIdle(() => returnAdult.mutate(payload), true)
          }
        />
      </>
    );

  const renderHouseholdPeople = () => (
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
        isDisabled={isPersonMutationPending || hasUnresolvedAmbiguousIntent}
        isPending={bootstrap.isPending}
        onMutate={beginBootstrap}
        onRetry={retryBootstrap}
        variables={bootstrap.variables}
        visible={
          roster.data?.currentPersonId === null &&
          roster.data.creatorSlot === "available" &&
          !bootstrapConflict
        }
      />
      {roster.data === undefined ? null : (
        <>
          <PeopleList
            isPending={isPersonMutationPending}
            onTransition={beginTransition}
            people={roster.data.people}
            retryIntent={hasUnresolvedAmbiguousIntent}
          />
          {renderAssociationControls()}
        </>
      )}
      <TransitionRetryIntentActions
        disabled={isPersonMutationPending}
        onRetry={retryTransition}
        personName={transitionPersonName}
        variables={
          hasAmbiguousRetryIntent(transition) ? transition.variables : undefined
        }
      />
      <CreatePersonForm
        error={create.error}
        isDisabled={isPersonMutationPending || hasUnresolvedAmbiguousIntent}
        isPending={create.isPending}
        onMutate={beginCreate}
        onRetry={retryCreate}
        variables={create.variables}
        visible={roster.data !== undefined}
      />
    </section>
  );
  return renderHouseholdPeople();
};
