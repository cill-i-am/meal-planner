import { ReviewedRoster } from "@meal-planner/agent-conversations-api";
import type { ConversationActionState } from "@meal-planner/agent-conversations-api";
import { useForm, useStore } from "@tanstack/react-form";
import { Schema } from "effect";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useState } from "react";

import { OperationError } from "../../components/operation-error.js";
import { Avatar, AvatarFallback } from "../../components/ui/avatar.js";
import { Button } from "../../components/ui/button.js";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";
import { PendingButton } from "../../components/ui/pending-button.js";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/toggle-group.js";

interface DraftPerson {
  readonly draftId: string;
  readonly displayName: string;
  readonly kind: "adult" | "dependant";
}
interface Draft {
  readonly familyName: string;
  readonly creatorName: string;
  readonly people: readonly DraftPerson[];
}

const rosterValidator = Schema.toStandardSchemaV1(
  Schema.Struct({
    creatorName: ReviewedRoster.fields.creatorName,
    familyName: ReviewedRoster.fields.familyName,
    people: Schema.mutable(ReviewedRoster.fields.people),
  })
);

const friendlyKind = (kind: DraftPerson["kind"]) =>
  kind === "adult" ? "Adult" : "Child";

const personTone = (index: number): "peach" | "rose" | "lilac" => {
  switch (index % 3) {
    case 0: {
      return "peach";
    }
    case 1: {
      return "rose";
    }
    default: {
      return "lilac";
    }
  }
};

type SaveStatus = "idle" | "pending" | "unknown" | "committed" | "rejected";

const isUnknown = (
  actionState: ConversationActionState | null | undefined,
  status: SaveStatus | undefined
) => actionState?._tag === "Unknown" || status === "unknown";

const isLocked = (
  busy: boolean,
  actionState: ConversationActionState | null | undefined,
  status: SaveStatus | undefined
) =>
  busy ||
  isUnknown(actionState, status) ||
  status === "pending" ||
  status === "committed" ||
  status === "rejected" ||
  actionState?._tag === "Pending" ||
  actionState?._tag === "Committed";

const RosterFeedback = ({
  validationError,
  error,
  resultUnknown,
  actionState,
}: {
  readonly validationError: string | null;
  readonly error: string | null | undefined;
  readonly resultUnknown: boolean;
  readonly actionState: ConversationActionState | null | undefined;
}) => (
  <>
    {validationError && <FieldError>{validationError}</FieldError>}
    {error && <OperationError>{error}</OperationError>}
    {resultUnknown && !error && (
      <OperationError>
        We couldn’t confirm whether your family was saved. Check again to
        continue the same request.
      </OperationError>
    )}
    {actionState?._tag === "Rejected" && (
      <OperationError>
        {actionState.reason === "stale_review"
          ? "This draft changed. Refresh it before creating your family."
          : "This family request couldn’t be accepted. Check your account and try again."}
      </OperationError>
    )}
  </>
);

export const FamilyRosterEditor = ({
  initial,
  onAccept,
  onRetry,
  actionState,
  status,
  busy,
  error,
}: {
  readonly initial: Draft;
  readonly onAccept: (reviewed: ReviewedRoster) => Promise<void> | void;
  readonly onRetry?: () => Promise<void> | void;
  readonly actionState?: ConversationActionState | null;
  readonly status?: SaveStatus;
  readonly busy: boolean;
  readonly error?: string | null;
}) => {
  const [editing, setEditing] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      creatorName: initial.creatorName,
      familyName: initial.familyName,
      people: initial.people.map((person) => ({ ...person })),
    },
    onSubmit: async ({ value }) => {
      const reviewed = Schema.decodeUnknownSync(ReviewedRoster)(value);
      try {
        await onAccept(reviewed);
      } catch {
        // The action owner presents the failure and retains this exact request for retry.
      }
    },
    validators: { onSubmit: rosterValidator },
  });
  const draft = useStore(form.store, (state) => state.values);
  const formSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const reducedMotion = useReducedMotion();
  const resultUnknown = isUnknown(actionState, status);
  const locked = isLocked(busy || formSubmitting, actionState, status);
  const count = {
    adults: 1 + draft.people.filter((person) => person.kind === "adult").length,
    children: draft.people.filter((person) => person.kind === "dependant")
      .length,
  };

  return (
    <form
      aria-labelledby="family-proposal-title"
      className="border-border bg-background flex min-w-0 flex-col gap-6 rounded-3xl border p-5 md:p-8"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs tracking-widest uppercase">
          Draft · Check the details
        </p>
        <h2
          id="family-proposal-title"
          className="font-display text-4xl leading-none tracking-tight md:text-5xl"
        >
          {draft.familyName || "Your family"}
        </h2>
        <p className="text-muted-foreground text-sm">
          {count.adults} {count.adults === 1 ? "adult" : "adults"} ·{" "}
          {count.children} {count.children === 1 ? "child" : "children"}
        </p>
      </div>

      <FieldGroup>
        <form.Field name="familyName">
          {(field) => (
            <Field
              data-invalid={field.state.meta.errors.length > 0 || undefined}
            >
              <FieldLabel htmlFor="proposal-family-name">
                Family name
              </FieldLabel>
              <Input
                id="proposal-family-name"
                value={field.state.value ?? ""}
                maxLength={80}
                aria-invalid={field.state.meta.errors.length > 0 || undefined}
                disabled={locked}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="creatorName">
          {(field) => (
            <Field
              data-invalid={field.state.meta.errors.length > 0 || undefined}
            >
              <FieldLabel htmlFor="proposal-creator-name">Your name</FieldLabel>
              <Input
                id="proposal-creator-name"
                value={field.state.value}
                maxLength={80}
                aria-invalid={field.state.meta.errors.length > 0 || undefined}
                disabled={locked}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
              <FieldDescription>
                You’ll be the family organiser.
              </FieldDescription>
            </Field>
          )}
        </form.Field>
      </FieldGroup>

      <div
        className="flex flex-col gap-3"
        aria-label="People in your draft family"
      >
        <div className="border-border flex items-center gap-4 border-b pb-3">
          <Avatar size="lg" aria-hidden="true">
            <AvatarFallback tone="blue">
              {[...draft.creatorName][0] || "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {draft.creatorName || "Your name"}
            </p>
            <p className="text-muted-foreground text-xs">Adult · You</p>
          </div>
        </div>
        <form.Field name="people" mode="array">
          {(peopleField) => (
            <>
              <AnimatePresence initial={false}>
                {peopleField.state.value.map((person, index) => (
                  <m.div
                    key={person.draftId}
                    initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    {...(reducedMotion ? {} : { exit: { opacity: 0, y: -4 } })}
                    transition={{
                      duration: reducedMotion ? 0 : 0.22,
                      ease: "easeOut",
                    }}
                    className="border-border flex min-w-0 flex-col gap-3 border-b pb-3 last:border-0"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <Avatar size="lg" aria-hidden="true">
                        <AvatarFallback tone={personTone(index)}>
                          {[...person.displayName][0] || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {person.displayName || "Name needed"}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {friendlyKind(person.kind)} ·{" "}
                          {person.kind === "adult"
                            ? "Invite later"
                            : "Managed by you"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="link"
                        disabled={locked}
                        aria-expanded={editing === person.draftId}
                        onClick={() =>
                          setEditing((current) =>
                            current === person.draftId ? null : person.draftId
                          )
                        }
                      >
                        Edit
                      </Button>
                    </div>
                    {editing === person.draftId && (
                      <div className="pl-14">
                        <FieldGroup>
                          <form.Field name={`people[${index}].displayName`}>
                            {(field) => (
                              <Field
                                data-invalid={
                                  field.state.meta.errors.length > 0 ||
                                  undefined
                                }
                              >
                                <FieldLabel
                                  htmlFor={`proposal-person-${person.draftId}`}
                                >
                                  Name
                                </FieldLabel>
                                <Input
                                  id={`proposal-person-${person.draftId}`}
                                  value={field.state.value ?? ""}
                                  maxLength={80}
                                  aria-invalid={
                                    field.state.meta.errors.length > 0 ||
                                    undefined
                                  }
                                  disabled={locked}
                                  onChange={(event) =>
                                    field.handleChange(event.target.value)
                                  }
                                  onBlur={field.handleBlur}
                                />
                              </Field>
                            )}
                          </form.Field>
                          <form.Field name={`people[${index}].kind`}>
                            {(field) => (
                              <Field>
                                <FieldLabel>Age</FieldLabel>
                                <ToggleGroup
                                  variant="segment"
                                  aria-label={`${person.displayName || "Person"} age`}
                                  value={[field.state.value]}
                                  onValueChange={(values) => {
                                    if (
                                      values[0] === "adult" ||
                                      values[0] === "dependant"
                                    ) {
                                      field.handleChange(values[0]);
                                    }
                                  }}
                                >
                                  <ToggleGroupItem
                                    value="adult"
                                    disabled={locked}
                                  >
                                    Adult
                                  </ToggleGroupItem>
                                  <ToggleGroupItem
                                    value="dependant"
                                    disabled={locked}
                                  >
                                    Child
                                  </ToggleGroupItem>
                                </ToggleGroup>
                              </Field>
                            )}
                          </form.Field>
                          <Button
                            type="button"
                            variant="destructive-outline"
                            disabled={locked}
                            onClick={() => {
                              peopleField.removeValue(index);
                              setEditing(null);
                            }}
                          >
                            <Trash2Icon data-icon="inline-start" />
                            Remove person
                          </Button>
                        </FieldGroup>
                      </div>
                    )}
                  </m.div>
                ))}
              </AnimatePresence>
              <Button
                type="button"
                variant="link"
                className="self-start"
                disabled={locked || peopleField.state.value.length >= 20}
                onClick={() => {
                  const draftId = crypto.randomUUID();
                  peopleField.pushValue({
                    displayName: "",
                    draftId,
                    kind: "adult",
                  });
                  setEditing(draftId);
                }}
              >
                <PlusIcon data-icon="inline-start" />
                Add someone
              </Button>
            </>
          )}
        </form.Field>
      </div>
      <p className="text-muted-foreground text-sm">
        You can invite adults after creating your family. You’ll manage
        children’s profiles.
      </p>
      <form.Subscribe
        selector={(state) => ({
          attempts: state.submissionAttempts,
          errors: state.errors.length,
        })}
      >
        {({ attempts, errors }) => (
          <RosterFeedback
            validationError={
              attempts > 0 && errors > 0
                ? "Check the family name and each person’s name before creating your family."
                : null
            }
            error={error}
            resultUnknown={resultUnknown}
            actionState={actionState}
          />
        )}
      </form.Subscribe>
      <PendingButton
        type={resultUnknown ? "button" : "submit"}
        pending={busy || formSubmitting}
        pendingLabel="Saving your family…"
        disabled={
          busy ||
          formSubmitting ||
          status === "committed" ||
          status === "rejected" ||
          actionState?._tag === "Committed"
        }
        onClick={
          resultUnknown
            ? () => {
                void onRetry?.();
              }
            : undefined
        }
      >
        {resultUnknown ? "Check and continue" : "Create our family"}
      </PendingButton>
    </form>
  );
};
