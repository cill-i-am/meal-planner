import {
  CompleteHouseholdAdultLinkPayload,
  DepartHouseholdAdultPayload,
  HouseholdAuthResourceId,
  HouseholdInvitationEmail,
  HouseholdPeopleOperationReason,
  HouseholdPersonMutationId,
  InviteHouseholdAdultPayload,
  RepairHouseholdAdultLinkPayload,
  ReturnHouseholdAdultPayload,
} from "@meal-planner/household-api";
import type {
  HouseholdMemberDepartureOperation,
  HouseholdPeopleRoster,
  InviteHouseholdAdultPayload as InviteHouseholdAdultPayloadType,
} from "@meal-planner/household-api";
import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";

import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";

const newMutationId = () =>
  Schema.decodeUnknownSync(HouseholdPersonMutationId)(crypto.randomUUID());

const departureStatusMessage = (
  state: HouseholdMemberDepartureOperation["state"]
) => {
  switch (state) {
    case "prepared": {
      return "Access revocation has not started.";
    }
    case "revoking_access": {
      return "Access revocation is pending.";
    }
    case "revocation_repair_required": {
      return "Access revocation needs repair.";
    }
    case "access_revoked": {
      return "Roster finalization is pending.";
    }
    case "finalization_repair_required": {
      return "Roster finalization needs repair.";
    }
    case "completed": {
      return "Household departure completed.";
    }
    case "cancelled": {
      return "Household departure cancelled.";
    }
    default: {
      return "Departure status is unavailable.";
    }
  }
};

export const PendingInvitationReconciliation = ({
  disabled,
  inviteIntent,
  onReplay,
  personName,
}: {
  readonly disabled: boolean;
  readonly inviteIntent: InviteHouseholdAdultPayloadType;
  readonly onReplay: (payload: InviteHouseholdAdultPayloadType) => void;
  readonly personName: string;
}) => (
  <section className="people-form">
    <h3>Finish invitation setup</h3>
    <p>Intended person: {personName}</p>
    <Button
      disabled={disabled}
      onClick={() => onReplay(inviteIntent)}
      type="button"
    >
      Finish original invitation
    </Button>
    <p className="helper">
      This retries the exact original request. It creates the missing original
      invitation or reuses its deterministic identity; it cannot select another
      pending invitation or send a replacement.
    </p>
  </section>
);

export const DepartureRecovery = ({
  disabled,
  isRecovering,
  operation,
  onCancel,
  onRead,
  onRecover,
  onRetry,
  retainedMemberId,
}: {
  readonly disabled: boolean;
  readonly isRecovering: boolean;
  readonly operation: HouseholdMemberDepartureOperation | null;
  readonly onCancel?: (operation: HouseholdMemberDepartureOperation) => void;
  readonly onRead?: (operation: HouseholdMemberDepartureOperation) => void;
  readonly onRecover?: () => void;
  readonly onRetry?: (
    operation: HouseholdMemberDepartureOperation,
    memberId: typeof HouseholdAuthResourceId.Type
  ) => void;
  readonly retainedMemberId: typeof HouseholdAuthResourceId.Type | undefined;
}) => {
  const canRepair =
    operation?.canRetry === true &&
    (operation.state === "revocation_repair_required" ||
      operation.state === "finalization_repair_required");

  return (
    <div className="people-departure-recovery">
      {operation === null && onRecover !== undefined ? (
        <section className="people-form">
          <h3>Recover departure status</h3>
          <p>
            The original departure request is saved in this browser session.
          </p>
          <Button
            disabled={disabled || isRecovering}
            onClick={onRecover}
            type="button"
          >
            {isRecovering ? "Recovering…" : "Recover original departure"}
          </Button>
        </section>
      ) : null}
      {operation === null ? null : (
        <section
          aria-labelledby="departure-recovery-heading"
          className="people-form"
        >
          <h3 id="departure-recovery-heading">Departure status</h3>
          <p>{departureStatusMessage(operation.state)}</p>
          <div className="people-confirmation">
            {onRead === undefined ? null : (
              <Button
                className="button-secondary"
                disabled={disabled}
                onClick={() => onRead(operation)}
                type="button"
              >
                Check current status
              </Button>
            )}
            {operation.state === "prepared" && onCancel !== undefined ? (
              <Button
                className="button-secondary"
                disabled={disabled}
                onClick={() => onCancel(operation)}
                type="button"
              >
                Cancel departure
              </Button>
            ) : null}
          </div>
          {!canRepair ||
          onRetry === undefined ||
          retainedMemberId === undefined ? null : (
            <div className="people-form">
              <p className="helper">
                Using the membership from the original departure.
              </p>
              <Button
                disabled={disabled}
                onClick={() => onRetry(operation, retainedMemberId)}
                type="button"
              >
                Repair departure
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

const DepartureControl = ({
  currentMemberId,
  disabled,
  onDepart,
  person,
}: {
  readonly currentMemberId: string;
  readonly disabled: boolean;
  readonly onDepart: (payload: DepartHouseholdAdultPayload) => void;
  readonly person: HouseholdPeopleRoster["people"][number];
}) => {
  const form = useForm({ defaultValues: { confirmed: false } });
  const depart = () =>
    onDepart(
      Schema.decodeUnknownSync(DepartHouseholdAdultPayload)({
        expectedLinkVersion: person.associationVersion,
        expectedPersonVersion: person.version,
        memberId: Schema.decodeUnknownSync(HouseholdAuthResourceId)(
          currentMemberId
        ),
        mutationId: newMutationId(),
        personId: person.id,
        reason: Schema.decodeUnknownSync(HouseholdPeopleOperationReason)(
          "Member requested departure"
        ),
      })
    );

  return (
    <form.Subscribe selector={(state) => state.values.confirmed}>
      {(confirmed) =>
        confirmed ? (
          <div className="people-confirmation">
            <p>Access is revoked before your roster history is archived.</p>
            <Button disabled={disabled} onClick={depart} type="button">
              Confirm leave
            </Button>
            <Button
              className="button-secondary"
              disabled={disabled}
              onClick={() => form.setFieldValue("confirmed", false)}
              type="button"
            >
              Keep my membership
            </Button>
          </div>
        ) : (
          <Button
            className="button-secondary"
            disabled={disabled}
            onClick={() => form.setFieldValue("confirmed", true)}
            type="button"
          >
            Leave household
          </Button>
        )
      }
    </form.Subscribe>
  );
};

const CompleteLinkForm = ({
  disabled,
  onSubmit,
}: {
  readonly disabled: boolean;
  readonly onSubmit: (payload: CompleteHouseholdAdultLinkPayload) => void;
}) => {
  const form = useForm({
    defaultValues: { invitationId: "" },
    onSubmit: ({ value }) =>
      onSubmit(
        Schema.decodeUnknownSync(CompleteHouseholdAdultLinkPayload)({
          invitationId: value.invitationId,
          mutationId: newMutationId(),
        })
      ),
  });
  return (
    <form
      className="people-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h3>Finish joining this household</h3>
      <form.Field name="invitationId">
        {(field) => (
          <>
            <Label htmlFor="accepted-invitation-id">Invitation code</Label>
            <Input
              disabled={disabled}
              id="accepted-invitation-id"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              value={field.state.value}
            />
          </>
        )}
      </form.Field>
      <Button disabled={disabled} type="submit">
        Link my account
      </Button>
    </form>
  );
};

const InviteAdultForm = ({
  disabled,
  onSubmit,
  roster,
}: {
  readonly disabled: boolean;
  readonly onSubmit: (payload: InviteHouseholdAdultPayload) => void;
  readonly roster: HouseholdPeopleRoster;
}) => {
  const adults = roster.people.filter(
    (person) =>
      person.kind === "adult" &&
      person.lifecycle === "active" &&
      person.associationState === "unlinked"
  );
  const form = useForm({
    defaultValues: { email: "", personId: "" },
    onSubmit: ({ formApi, value }) => {
      onSubmit(
        Schema.decodeUnknownSync(InviteHouseholdAdultPayload)({
          email: Schema.decodeUnknownSync(HouseholdInvitationEmail)(
            value.email
          ),
          mutationId: newMutationId(),
          personId: value.personId,
        })
      );
      formApi.reset();
    },
  });
  if (adults.length === 0) {
    return null;
  }
  return (
    <form
      className="people-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h3>Invite an existing adult</h3>
      <p>
        Select the person first. Their email is sent only to the account
        service.
      </p>
      <form.Field name="personId">
        {(field) => (
          <>
            <Label htmlFor="invite-person">Person</Label>
            <select
              className="field-select"
              disabled={disabled}
              id="invite-person"
              onChange={(event) => field.handleChange(event.target.value)}
              value={field.state.value}
            >
              <option value="">Select an adult</option>
              {adults.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </>
        )}
      </form.Field>
      <form.Field name="email">
        {(field) => (
          <>
            <Label htmlFor="invite-email">Email</Label>
            <Input
              disabled={disabled}
              id="invite-email"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              type="email"
              value={field.state.value}
            />
          </>
        )}
      </form.Field>
      <Button disabled={disabled} type="submit">
        Send invitation
      </Button>
    </form>
  );
};

const RepairLinkForm = ({
  currentMemberId,
  disabled,
  onSubmit,
  roster,
}: {
  readonly currentMemberId: string;
  readonly disabled: boolean;
  readonly onSubmit: (payload: RepairHouseholdAdultLinkPayload) => void;
  readonly roster: HouseholdPeopleRoster;
}) => {
  const adults = roster.people.filter(
    (person) =>
      person.kind === "adult" &&
      person.lifecycle === "active" &&
      person.associationState === "unlinked"
  );
  const form = useForm({
    defaultValues: { personId: "" },
    onSubmit: ({ value }) => {
      const person = adults.find(({ id }) => id === value.personId);
      if (person === undefined) {
        return;
      }
      onSubmit(
        Schema.decodeUnknownSync(RepairHouseholdAdultLinkPayload)({
          expectedPersonVersion: person.version,
          memberId: Schema.decodeUnknownSync(HouseholdAuthResourceId)(
            currentMemberId
          ),
          mutationId: newMutationId(),
          personId: person.id,
          reason: Schema.decodeUnknownSync(HouseholdPeopleOperationReason)(
            "Explicit account link repair"
          ),
        })
      );
    },
  });
  if (adults.length === 0) {
    return null;
  }
  return (
    <form
      className="people-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h3>Repair my person link</h3>
      <form.Field name="personId">
        {(field) => (
          <select
            aria-label="Person to link"
            className="field-select"
            disabled={disabled}
            onChange={(event) => field.handleChange(event.target.value)}
            value={field.state.value}
          >
            <option value="">Select an adult</option>
            {adults.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
        )}
      </form.Field>
      <Button disabled={disabled} type="submit">
        Repair link
      </Button>
    </form>
  );
};

const ReturnAdultForm = ({
  disabled,
  onSubmit,
  roster,
}: {
  readonly disabled: boolean;
  readonly onSubmit: (payload: ReturnHouseholdAdultPayload) => void;
  readonly roster: HouseholdPeopleRoster;
}) => {
  const adults = roster.people.filter(
    (person) => person.kind === "adult" && person.lifecycle === "archived"
  );
  const form = useForm({
    defaultValues: { invitationId: "", personId: "" },
    onSubmit: ({ value }) => {
      const person = adults.find(({ id }) => id === value.personId);
      if (person === undefined) {
        return;
      }
      onSubmit(
        Schema.decodeUnknownSync(ReturnHouseholdAdultPayload)({
          expectedPersonVersion: person.version,
          invitationId: value.invitationId,
          mutationId: newMutationId(),
          personId: person.id,
        })
      );
    },
  });
  if (adults.length === 0) {
    return null;
  }
  return (
    <form
      className="people-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h3>Return to this household</h3>
      <form.Field name="personId">
        {(field) => (
          <select
            aria-label="Archived person"
            className="field-select"
            disabled={disabled}
            onChange={(event) => field.handleChange(event.target.value)}
            value={field.state.value}
          >
            <option value="">Select your person</option>
            {adults.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
        )}
      </form.Field>
      <form.Field name="invitationId">
        {(field) => (
          <Input
            aria-label="Accepted invitation code"
            disabled={disabled}
            onChange={(event) => field.handleChange(event.target.value)}
            value={field.state.value}
          />
        )}
      </form.Field>
      <Button disabled={disabled} type="submit">
        Restore my person
      </Button>
    </form>
  );
};

/** Minimal invitation/link/departure controls; Household projections remain privacy-safe. */
export const HouseholdAssociationControls = ({
  currentMemberId,
  disabled,
  onCompleteLink,
  onDepart,
  onInvite,
  onRepair,
  onReturn,
  roster,
}: {
  readonly currentMemberId?: string;
  readonly disabled: boolean;
  readonly onCompleteLink?: (
    payload: CompleteHouseholdAdultLinkPayload
  ) => void;
  readonly onDepart?: (payload: DepartHouseholdAdultPayload) => void;
  readonly onInvite?: (payload: InviteHouseholdAdultPayload) => void;
  readonly onRepair?: (payload: RepairHouseholdAdultLinkPayload) => void;
  readonly onReturn?: (payload: ReturnHouseholdAdultPayload) => void;
  readonly roster: HouseholdPeopleRoster;
}) => {
  const currentPerson = roster.people.find(
    (person) => person.id === roster.currentPersonId
  );
  return (
    <div className="people-association-controls">
      {onInvite === undefined ? null : (
        <InviteAdultForm
          disabled={disabled}
          onSubmit={onInvite}
          roster={roster}
        />
      )}
      {roster.currentPersonId === null && onCompleteLink !== undefined ? (
        <CompleteLinkForm disabled={disabled} onSubmit={onCompleteLink} />
      ) : null}
      {roster.currentPersonId === null &&
      currentMemberId !== undefined &&
      onRepair !== undefined ? (
        <RepairLinkForm
          currentMemberId={currentMemberId}
          disabled={disabled}
          onSubmit={onRepair}
          roster={roster}
        />
      ) : null}
      {roster.currentPersonId === null && onReturn !== undefined ? (
        <ReturnAdultForm
          disabled={disabled}
          onSubmit={onReturn}
          roster={roster}
        />
      ) : null}
      {currentPerson === undefined ||
      currentPerson.associationVersion === null ||
      currentMemberId === undefined ||
      onDepart === undefined ? null : (
        <DepartureControl
          currentMemberId={currentMemberId}
          disabled={disabled}
          onDepart={onDepart}
          person={currentPerson}
        />
      )}
    </div>
  );
};
