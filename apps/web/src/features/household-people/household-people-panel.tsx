import {
  CancelHouseholdAdultDeparturePayload,
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  HouseholdPeopleOperationReason,
  HouseholdPersonDisplayName,
  HouseholdPersonMutationId,
  RetryHouseholdAdultDeparturePayload,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import type {
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureOperationId,
  HouseholdPerson,
} from "@meal-planner/household-api";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useCallback, useRef, useSyncExternalStore } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import {
  DepartureRecovery,
  HouseholdAssociationControls,
  PendingInvitationReconciliation,
} from "./household-association-controls.js";
import {
  householdPeopleFailureCode,
  isAmbiguousHouseholdPeopleFailure,
} from "./operations.js";
import type {
  HouseholdPeopleOperationFailureCode,
  HouseholdPeopleOperations,
} from "./operations.js";
import {
  clearDepartureIntent,
  clearInvitationIntent,
  retainedHouseholdPeopleIntents,
  retainDepartureIntent,
  retainInvitationIntent,
  subscribeToRetainedHouseholdPeopleIntents,
} from "./retained-intents.js";

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

interface CancelDepartureMutationVariables {
  readonly operationId: HouseholdMemberDepartureOperationId;
  readonly payload: CancelHouseholdAdultDeparturePayload;
}

interface RetryDepartureMutationVariables {
  readonly operationId: HouseholdMemberDepartureOperationId;
  readonly payload: RetryHouseholdAdultDeparturePayload;
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
  const subscribeToRetainedIntents = useCallback(
    (listener: () => void) =>
      subscribeToRetainedHouseholdPeopleIntents(organizationId, listener),
    [organizationId]
  );
  const readRetainedIntents = useCallback(
    () => retainedHouseholdPeopleIntents(organizationId),
    [organizationId]
  );
  const retainedIntents = useSyncExternalStore(
    subscribeToRetainedIntents,
    readRetainedIntents,
    readRetainedIntents
  );
  const departureState = useForm({
    defaultValues: {
      operation: null as HouseholdMemberDepartureOperation | null,
    },
  });
  const acceptDepartureOperation = (
    operation: HouseholdMemberDepartureOperation
  ) => {
    departureState.setFieldValue("operation", operation);
    if (operation.state === "completed" || operation.state === "cancelled") {
      clearDepartureIntent(organizationId);
    }
  };
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
    onMutate: (payload) => {
      retainInvitationIntent(organizationId, payload);
    },
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: () => {
      clearInvitationIntent(organizationId);
      void refresh();
    },
    retry: false,
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
    onMutate: (payload) => {
      retainDepartureIntent(organizationId, payload);
    },
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: (operation) => {
      acceptDepartureOperation(operation);
      void refresh();
    },
    retry: false,
  });
  const getDeparture = useMutation({
    mutationFn: (operationId: HouseholdMemberDepartureOperationId) =>
      operations.getDeparture === undefined
        ? Promise.reject(new Error("unsupported"))
        : operations.getDeparture(operationId),
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: (operation) => {
      acceptDepartureOperation(operation);
    },
    retry: retryAmbiguousFailure,
  });
  const getDepartureByMutation = useMutation({
    mutationFn: (
      retainedMutationId: NonNullable<
        (typeof retainedIntents)["departure"]
      >["mutationId"]
    ) =>
      operations.getDepartureByMutation === undefined
        ? Promise.reject(new Error("unsupported"))
        : operations.getDepartureByMutation(retainedMutationId),
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: acceptDepartureOperation,
    retry: retryAmbiguousFailure,
  });
  const cancelDeparture = useMutation({
    mutationFn: ({ operationId, payload }: CancelDepartureMutationVariables) =>
      operations.cancelDeparture === undefined
        ? Promise.reject(new Error("unsupported"))
        : operations.cancelDeparture(operationId, payload),
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: (operation) => {
      acceptDepartureOperation(operation);
      void refresh();
    },
    retry: retryAmbiguousFailure,
  });
  const retryDeparture = useMutation({
    mutationFn: ({ operationId, payload }: RetryDepartureMutationVariables) =>
      operations.retryDeparture === undefined
        ? Promise.reject(new Error("unsupported"))
        : operations.retryDeparture(operationId, payload),
    onSettled: () => {
      personActionLock.current = false;
    },
    onSuccess: (operation) => {
      acceptDepartureOperation(operation);
      void refresh();
    },
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
    cancelDeparture.isPending,
    completeAdultLink.isPending,
    create.isPending,
    departAdult.isPending,
    getDeparture.isPending,
    getDepartureByMutation.isPending,
    inviteAdult.isPending,
    repairAdultLink.isPending,
    retryDeparture.isPending,
    returnAdult.isPending,
    transition.isPending,
  ].some(Boolean);
  const hasUnresolvedGenericIntent = [
    bootstrap,
    completeAdultLink,
    create,
    repairAdultLink,
    returnAdult,
    transition,
  ].some(hasAmbiguousRetryIntent);
  const invitationNeedsReconciliation =
    retainedIntents.invitation !== null && !inviteAdult.isPending;
  const invitationIntentActive = retainedIntents.invitation !== null;
  const resetSettledMutations = () => {
    resetMutationIfSettled(bootstrap);
    resetMutationIfSettled(cancelDeparture);
    resetMutationIfSettled(create);
    resetMutationIfSettled(inviteAdult);
    resetMutationIfSettled(completeAdultLink);
    resetMutationIfSettled(departAdult);
    resetMutationIfSettled(getDeparture);
    resetMutationIfSettled(getDepartureByMutation);
    resetMutationIfSettled(repairAdultLink);
    resetMutationIfSettled(retryDeparture);
    resetMutationIfSettled(returnAdult);
    resetMutationIfSettled(transition);
    departureState.setFieldValue("operation", null);
  };
  const error = firstError([
    roster.error,
    bootstrap.error,
    create.error,
    transition.error,
    inviteAdult.error,
    completeAdultLink.error,
    departAdult.error,
    getDeparture.error,
    getDepartureByMutation.error,
    cancelDeparture.error,
    retryDeparture.error,
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
  const renderHouseholdPeople = (
    departureOperation: HouseholdMemberDepartureOperation | null
  ) => {
    const deriveRecoveryState = () => {
      const departureUnresolved =
        retainedIntents.departure !== null ||
        (departureOperation !== null &&
          departureOperation.state !== "completed" &&
          departureOperation.state !== "cancelled");
      const hasUnresolvedExactRecovery =
        invitationNeedsReconciliation ||
        departureUnresolved ||
        hasAmbiguousRetryIntent(cancelDeparture) ||
        hasAmbiguousRetryIntent(retryDeparture);
      return {
        departureUnresolved,
        hasUnresolvedIntent:
          hasUnresolvedGenericIntent || hasUnresolvedExactRecovery,
        retainedDepartureMemberId: retainedIntents.departure?.memberId,
      };
    };
    const {
      departureUnresolved,
      hasUnresolvedIntent,
      retainedDepartureMemberId,
    } = deriveRecoveryState();
    const runExactRecovery = (action: () => void) => {
      if (personActionLock.current || isPersonMutationPending) {
        return;
      }
      personActionLock.current = true;
      action();
    };
    const runNewIntent = (action: () => void) => {
      if (
        personActionLock.current ||
        isPersonMutationPending ||
        hasUnresolvedIntent
      ) {
        return;
      }
      personActionLock.current = true;
      resetSettledMutations();
      action();
    };
    const beginTransition = (
      value: Parameters<typeof transition.mutate>[0]
    ) => {
      runNewIntent(() => transition.mutate(value));
    };
    const retryTransition = (
      value: Parameters<typeof transition.mutate>[0]
    ) => {
      runExactRecovery(() => transition.mutate(value));
    };
    const associationRecoveryDisabled =
      isPersonMutationPending ||
      departureUnresolved ||
      hasUnresolvedGenericIntent;
    const departureRecoveryDisabled =
      isPersonMutationPending ||
      invitationNeedsReconciliation ||
      hasUnresolvedGenericIntent;
    const renderInvitationRecovery = () => {
      const inviteIntent = retainedIntents.invitation;
      if (!invitationNeedsReconciliation || inviteIntent === null) {
        return null;
      }
      return (
        <PendingInvitationReconciliation
          disabled={associationRecoveryDisabled}
          inviteIntent={inviteIntent}
          onReplay={(payload) =>
            runExactRecovery(() => inviteAdult.mutate(payload))
          }
          personName={
            roster.data?.people.find(
              (person) => person.id === inviteIntent.personId
            )?.displayName ?? "Selected adult"
          }
        />
      );
    };
    const renderDepartureRecovery = () => {
      const retainedDeparture = retainedIntents.departure;
      if (
        departureOperation === null &&
        (retainedDeparture === null ||
          operations.getDepartureByMutation === undefined)
      ) {
        return null;
      }
      return (
        <DepartureRecovery
          disabled={departureRecoveryDisabled}
          isRecovering={getDepartureByMutation.isPending}
          operation={departureOperation}
          {...(operations.cancelDeparture === undefined ||
          hasAmbiguousRetryIntent(cancelDeparture)
            ? {}
            : {
                onCancel: (operation) =>
                  runExactRecovery(() =>
                    cancelDeparture.mutate({
                      operationId: operation.operationId,
                      payload: Schema.decodeUnknownSync(
                        CancelHouseholdAdultDeparturePayload
                      )({
                        expectedOperationVersion: operation.version,
                        mutationId: mutationId(),
                      }),
                    })
                  ),
              })}
          {...(operations.getDeparture === undefined ||
          departureOperation === null
            ? {}
            : {
                onRead: (operation: HouseholdMemberDepartureOperation) =>
                  runExactRecovery(() =>
                    getDeparture.mutate(operation.operationId)
                  ),
              })}
          {...(retainedDeparture === null ||
          operations.getDepartureByMutation === undefined ||
          departureOperation !== null
            ? {}
            : {
                onRecover: () =>
                  runExactRecovery(() =>
                    getDepartureByMutation.mutate(retainedDeparture.mutationId)
                  ),
              })}
          {...(operations.retryDeparture === undefined ||
          hasAmbiguousRetryIntent(retryDeparture)
            ? {}
            : {
                onRetry: (operation, memberId) =>
                  runExactRecovery(() =>
                    retryDeparture.mutate({
                      operationId: operation.operationId,
                      payload: Schema.decodeUnknownSync(
                        RetryHouseholdAdultDeparturePayload
                      )({
                        expectedOperationVersion: operation.version,
                        memberId,
                        mutationId: mutationId(),
                        reason: Schema.decodeUnknownSync(
                          HouseholdPeopleOperationReason
                        )("Explicit departure repair"),
                      }),
                    })
                  ),
              })}
          retainedMemberId={retainedDepartureMemberId}
        />
      );
    };
    const renderAssociationRetryIntents = () => (
      <>
        <AssociationRetryIntent
          disabled={isPersonMutationPending}
          label="Retry cancelling this departure"
          mutation={cancelDeparture}
          onRetry={(variables) =>
            runExactRecovery(() => cancelDeparture.mutate(variables))
          }
        />
        <AssociationRetryIntent
          disabled={isPersonMutationPending}
          label="Retry repairing this departure"
          mutation={retryDeparture}
          onRetry={(variables) =>
            runExactRecovery(() => retryDeparture.mutate(variables))
          }
        />
        <AssociationRetryIntent
          disabled={isPersonMutationPending}
          label="Retry linking my account"
          mutation={completeAdultLink}
          onRetry={(payload) =>
            runExactRecovery(() => completeAdultLink.mutate(payload))
          }
        />
        <AssociationRetryIntent
          disabled={isPersonMutationPending}
          label="Retry repairing this link"
          mutation={repairAdultLink}
          onRetry={(payload) =>
            runExactRecovery(() => repairAdultLink.mutate(payload))
          }
        />
        <AssociationRetryIntent
          disabled={isPersonMutationPending}
          label="Retry restoring this person"
          mutation={returnAdult}
          onRetry={(payload) =>
            runExactRecovery(() => returnAdult.mutate(payload))
          }
        />
      </>
    );
    const renderRoster = () => {
      if (roster.data === undefined) {
        return null;
      }
      return (
        <>
          <PeopleList
            isPending={isPersonMutationPending}
            onTransition={beginTransition}
            people={roster.data.people}
            retryIntent={hasUnresolvedIntent}
          />
          <HouseholdAssociationControls
            {...(currentMemberId === undefined ? {} : { currentMemberId })}
            disabled={isPersonMutationPending || hasUnresolvedIntent}
            {...(operations.completeAdultLink === undefined
              ? {}
              : {
                  onCompleteLink: (payload) =>
                    runNewIntent(() => completeAdultLink.mutate(payload)),
                })}
            {...(operations.departAdult === undefined || departureUnresolved
              ? {}
              : {
                  onDepart: (payload) =>
                    runNewIntent(() => departAdult.mutate(payload)),
                })}
            {...(operations.inviteAdult === undefined || invitationIntentActive
              ? {}
              : {
                  onInvite: (payload) =>
                    runNewIntent(() => inviteAdult.mutate(payload)),
                })}
            {...(operations.repairAdultLink === undefined
              ? {}
              : {
                  onRepair: (payload) =>
                    runNewIntent(() => repairAdultLink.mutate(payload)),
                })}
            {...(operations.returnAdult === undefined
              ? {}
              : {
                  onReturn: (payload) =>
                    runNewIntent(() => returnAdult.mutate(payload)),
                })}
            roster={roster.data}
          />
          {renderInvitationRecovery()}
          {renderDepartureRecovery()}
          {renderAssociationRetryIntents()}
        </>
      );
    };

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
            onClick={() => {
              void roster.refetch();
            }}
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
          isDisabled={isPersonMutationPending || hasUnresolvedIntent}
          isPending={bootstrap.isPending}
          onMutate={(payload) => runNewIntent(() => bootstrap.mutate(payload))}
          onRetry={(payload) =>
            runExactRecovery(() => bootstrap.mutate(payload))
          }
          variables={bootstrap.variables}
          visible={
            roster.data?.currentPersonId === null &&
            roster.data.creatorSlot === "available" &&
            !bootstrapConflict
          }
        />
        {renderRoster()}
        <TransitionRetryIntentActions
          disabled={isPersonMutationPending}
          onRetry={retryTransition}
          personName={transitionPersonName}
          variables={
            hasAmbiguousRetryIntent(transition)
              ? transition.variables
              : undefined
          }
        />
        <CreatePersonForm
          error={create.error}
          isDisabled={isPersonMutationPending || hasUnresolvedIntent}
          isPending={create.isPending}
          onMutate={(payload) => runNewIntent(() => create.mutate(payload))}
          onRetry={(payload) => runExactRecovery(() => create.mutate(payload))}
          variables={create.variables}
          visible={roster.data !== undefined}
        />
      </section>
    );
  };
  return (
    <departureState.Subscribe selector={(state) => state.values.operation}>
      {(departureOperation) => renderHouseholdPeople(departureOperation)}
    </departureState.Subscribe>
  );
};
