import {
  Fallback,
  ManagedOccasion,
  MealOccasionId,
  PlanningContentId,
  Routine,
} from "@meal-planner/household-api";
import type {
  HouseholdPerson,
  PlanningContentCommand,
  PlanningContentSnapshot,
} from "@meal-planner/household-api";
import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field.js";

const defaultOccasions = ["Breakfast", "Lunch", "Dinner", "Snacks"] as const;
const weekdayLabels = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;
const allWeekdays = [0, 1, 2, 3, 4, 5, 6] as const;
const CoverageFields = Schema.Struct({ selected: Schema.Array(Schema.String) });
const RoutineFields = Schema.Struct({
  editingId: Schema.String,
  occasionId: Schema.String,
  optionId: Schema.String,
  scope: Schema.String,
  selection: Schema.Literals(["pin", "prefer", "rotate"]),
  weekdays: Schema.Array(Schema.Number),
});
const FallbackFields = Schema.Struct({
  editingId: Schema.String,
  optionId: Schema.String,
  personId: Schema.String,
});

const optionRef = (option: PlanningContentSnapshot["options"][number]) => ({
  kind: option.kind,
  optionId: option.optionId,
  optionVersion: option.optionVersion,
});

const fallbackFromFields = (
  snapshot: PlanningContentSnapshot,
  person: HouseholdPerson,
  option: PlanningContentSnapshot["options"][number],
  editing?: PlanningContentSnapshot["fallbacks"][number]
) =>
  Schema.decodeUnknownSync(Fallback)({
    id:
      editing?.id ??
      Schema.decodeUnknownSync(PlanningContentId)(crypto.randomUUID()),
    locations: editing?.locations ?? [],
    occasionIds:
      editing?.occasionIds ??
      snapshot.managedOccasions
        .filter((occasion) => occasion.personId === person.id)
        .map((occasion) => occasion.occasionId),
    optionRef: optionRef(option),
    personId: person.id,
    priority:
      editing?.priority ??
      Math.max(
        0,
        ...snapshot.fallbacks
          .filter((item) => item.personId === person.id)
          .map((item) => item.priority)
      ) + 1,
    state: "active",
    substitutionPolicy: editing?.substitutionPolicy ?? "ask",
    version: (editing?.version ?? 0) + 1,
  });

const CoveragePersonEditor = ({
  entries,
  onCommand,
  pending,
  person,
}: {
  readonly entries: PlanningContentSnapshot["managedOccasions"];
  readonly onCommand: (command: PlanningContentCommand) => void;
  readonly pending: boolean;
  readonly person: HouseholdPerson;
}) => {
  const [error, setError] = useState<string | null>(null);
  const missingDefaults = defaultOccasions.filter(
    (label) => !entries.some((entry) => entry.label === label)
  );
  const form = useForm({
    defaultValues: Schema.decodeUnknownSync(CoverageFields)({
      selected: entries
        .filter((entry) => entry.state === "managed")
        .map((entry) => entry.occasionId),
    }),
    onSubmit: ({ value }) => {
      if (pending) {
        return;
      }
      try {
        const selected = new Set(
          Schema.decodeUnknownSync(CoverageFields)(value).selected
        );
        const next = [
          ...entries.map((entry) =>
            Schema.decodeUnknownSync(ManagedOccasion)({
              ...entry,
              state: selected.has(entry.occasionId) ? "managed" : "disabled",
            })
          ),
          ...missingDefaults
            .filter((label) => selected.has(`default:${label}`))
            .map((label) =>
              Schema.decodeUnknownSync(ManagedOccasion)({
                label,
                occasionId: Schema.decodeUnknownSync(MealOccasionId)(
                  crypto.randomUUID()
                ),
                personId: person.id,
                state: "managed",
                weekdays: allWeekdays,
              })
            ),
        ];
        setError(null);
        onCommand({
          _tag: "SetPersonManagedOccasions",
          entries: next,
          personId: person.id,
        });
      } catch {
        setError("The managed meals could not be checked. Try again.");
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(CoverageFields) },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="bg-background rounded-2xl p-4"
    >
      <h4 className="font-medium">{person.displayName}</h4>
      <form.Field name="selected">
        {(field) => (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {[
              ...entries.map((entry) => ({
                key: entry.occasionId,
                label: entry.label,
              })),
              ...missingDefaults.map((label) => ({
                key: `default:${label}`,
                label,
              })),
            ].map((item) => (
              <label
                key={item.key}
                className="flex min-h-10 items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={field.state.value.includes(item.key)}
                  onCheckedChange={(checked) =>
                    field.handleChange(
                      checked === true
                        ? [...field.state.value, item.key]
                        : field.state.value.filter((key) => key !== item.key)
                    )
                  }
                />
                {item.label}
              </label>
            ))}
          </div>
        )}
      </form.Field>
      {error && (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>Check managed meals</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <Button
            className="mt-4"
            size="sm"
            type="submit"
            disabled={pending || submitting}
          >
            Save {person.displayName}’s meals
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
};

const CoverageSetup = ({
  people,
  pending,
  onCommand,
}: {
  readonly people: readonly HouseholdPerson[];
  readonly pending: boolean;
  readonly onCommand: (command: PlanningContentCommand) => void;
}) => {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: Schema.decodeUnknownSync(CoverageFields)({
      selected: people.flatMap((person) =>
        defaultOccasions.map((label) => `${person.id}:${label}`)
      ),
    }),
    onSubmit: ({ value }) => {
      if (pending) {
        return;
      }
      const selected = new Set(
        Schema.decodeUnknownSync(CoverageFields)(value).selected
      );
      if (selected.size === 0) {
        setError("Choose at least one meal to manage.");
        return;
      }
      try {
        const ids = Object.fromEntries(
          defaultOccasions.map((label) => [
            label,
            Schema.decodeUnknownSync(MealOccasionId)(crypto.randomUUID()),
          ])
        );
        const entries = people.flatMap((person) =>
          defaultOccasions
            .filter((label) => selected.has(`${person.id}:${label}`))
            .map((label) =>
              Schema.decodeUnknownSync(ManagedOccasion)({
                label,
                occasionId: ids[label],
                personId: person.id,
                state: "managed",
                weekdays: allWeekdays,
              })
            )
        );
        setError(null);
        onCommand({ _tag: "SetManagedOccasions", entries });
      } catch {
        setError("The meal setup could not be checked. Try again.");
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(CoverageFields) },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="bg-accent rounded-3xl p-6 md:p-8"
    >
      <p className="text-xs tracking-widest uppercase">
        First, choose coverage
      </p>
      <h3 className="font-display mt-2 text-3xl">
        Whose meals are we planning?
      </h3>
      <p className="text-muted-foreground mt-2 text-sm leading-6">
        Select the daily meals managed for each person. You can leave a meal out
        when the family does not plan it here.
      </p>
      <form.Field name="selected">
        {(field) => (
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {people.map((person) => (
              <fieldset
                key={person.id}
                className="bg-background rounded-2xl p-4"
              >
                <legend className="font-medium">{person.displayName}</legend>
                <div className="mt-3 grid gap-3">
                  {defaultOccasions.map((label) => {
                    const key = `${person.id}:${label}`;
                    return (
                      <label
                        key={label}
                        className="flex min-h-10 items-center gap-3 text-sm"
                      >
                        <Checkbox
                          checked={field.state.value.includes(key)}
                          onCheckedChange={(checked) =>
                            field.handleChange(
                              checked === true
                                ? [...field.state.value, key]
                                : field.state.value.filter(
                                    (item) => item !== key
                                  )
                            )
                          }
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        )}
      </form.Field>
      {error && (
        <Alert variant="destructive" className="mt-5">
          <AlertTitle>Check coverage</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <Button
            className="mt-6"
            type="submit"
            disabled={pending || submitting || people.length === 0}
          >
            Save managed meals
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
};

const RoutineEditor = ({
  snapshot,
  people,
  pending,
  onCommand,
}: {
  readonly snapshot: PlanningContentSnapshot;
  readonly people: readonly HouseholdPerson[];
  readonly pending: boolean;
  readonly onCommand: (command: PlanningContentCommand) => void;
}) => {
  const occasions = [
    ...new Map(
      snapshot.managedOccasions.map((entry) => [entry.occasionId, entry])
    ).values(),
  ];
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: Schema.decodeUnknownSync(RoutineFields)({
      editingId: "",
      occasionId: occasions[0]?.occasionId ?? "",
      optionId: snapshot.options[0]?.optionId ?? "",
      scope: "household",
      selection: "pin",
      weekdays: [...allWeekdays],
    }),
    onSubmit: ({ value }) => {
      if (pending) {
        return;
      }
      const fields = Schema.decodeUnknownSync(RoutineFields)(value);
      const selectedOption = snapshot.options.find(
        (option) => option.optionId === fields.optionId
      );
      const selectedOccasion = occasions.find(
        (occasion) => occasion.occasionId === fields.occasionId
      );
      const person = people.find((entry) => entry.id === fields.scope);
      const editing =
        fields.editingId === ""
          ? undefined
          : snapshot.routines.find((rule) => rule.id === fields.editingId);
      if (fields.editingId !== "" && !editing) {
        setError("This routine changed. Choose it again before saving.");
        return;
      }
      let routineScope:
        | { _tag: "Household" }
        | { _tag: "Person"; personId: HouseholdPerson["id"] }
        | null = null;
      if (fields.scope === "household") {
        routineScope = { _tag: "Household" };
      } else if (person) {
        routineScope = { _tag: "Person", personId: person.id };
      }
      if (
        !selectedOption ||
        !selectedOccasion ||
        !routineScope ||
        fields.weekdays.length === 0
      ) {
        setError("Choose a meal, an occasion and at least one day.");
        return;
      }
      const overlaps = snapshot.routines.some(
        (rule) =>
          rule.id !== editing?.id &&
          rule.state === "active" &&
          rule.occasionId === selectedOccasion.occasionId &&
          rule.scope._tag === routineScope._tag &&
          (rule.scope._tag === "Household" ||
            (routineScope._tag === "Person" &&
              rule.scope.personId === routineScope.personId)) &&
          rule.weekdays.some((day) => fields.weekdays.includes(day))
      );
      if (overlaps) {
        setError(
          "This overlaps another active routine. Edit or pause that routine first."
        );
        return;
      }
      try {
        const routine = Schema.decodeUnknownSync(Routine)({
          choice: {
            _tag: "Options",
            optionRefs: [optionRef(selectedOption)],
            selection: fields.selection,
          },
          id:
            editing?.id ??
            Schema.decodeUnknownSync(PlanningContentId)(crypto.randomUUID()),
          occasionId: selectedOccasion.occasionId,
          scope: routineScope,
          state: "active",
          version: (editing?.version ?? 0) + 1,
          weekdays: [...fields.weekdays].toSorted(),
        });
        setError(null);
        onCommand({ _tag: "PutRoutine", value: routine });
      } catch {
        setError("The routine needs a valid meal and day selection.");
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(RoutineFields) },
  });
  const edit = (routine: PlanningContentSnapshot["routines"][number]) => {
    if (
      routine.choice._tag !== "Options" ||
      routine.choice.optionRefs.length !== 1
    ) {
      return;
    }
    const [reference] = routine.choice.optionRefs;
    if (!reference) {
      return;
    }
    form.setFieldValue("editingId", routine.id);
    form.setFieldValue(
      "scope",
      routine.scope._tag === "Household" ? "household" : routine.scope.personId
    );
    form.setFieldValue("occasionId", routine.occasionId);
    form.setFieldValue("optionId", reference.optionId);
    form.setFieldValue("weekdays", [...routine.weekdays]);
    form.setFieldValue("selection", routine.choice.selection);
    setError(null);
  };
  const pause = (routine: PlanningContentSnapshot["routines"][number]) => {
    if (pending) {
      return;
    }
    try {
      const value = Schema.decodeUnknownSync(Routine)({
        ...routine,
        state: "paused",
        version: routine.version + 1,
      });
      setError(null);
      onCommand({ _tag: "PutRoutine", value });
    } catch {
      setError("This routine could not be paused. Try again.");
    }
  };
  return (
    <div className="border-border flex flex-col gap-5 rounded-3xl border p-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-5"
      >
        <div>
          <p className="text-muted-foreground text-xs tracking-widest uppercase">
            A familiar rhythm
          </p>
          <h3 className="font-display mt-2 text-3xl">Repeat what works.</h3>
        </div>
        <FieldGroup>
          <form.Field name="scope">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="routine-person">For whom?</FieldLabel>
                <select
                  id="routine-person"
                  className="border-input bg-control h-11 rounded-xl border px-3"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  <option value="household">Everyone</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.displayName}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </form.Field>
          <form.Field name="occasionId">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="routine-occasion">Meal</FieldLabel>
                <select
                  id="routine-occasion"
                  className="border-input bg-control h-11 rounded-xl border px-3"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  {occasions.map((occasion) => (
                    <option
                      key={occasion.occasionId}
                      value={occasion.occasionId}
                    >
                      {occasion.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </form.Field>
          <form.Field name="optionId">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="routine-option">Saved food</FieldLabel>
                <select
                  id="routine-option"
                  className="border-input bg-control h-11 rounded-xl border px-3"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  {snapshot.options.map((option) => (
                    <option key={option.optionId} value={option.optionId}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </form.Field>
          <form.Field name="selection">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="routine-selection">
                  How strongly?
                </FieldLabel>
                <select
                  id="routine-selection"
                  className="border-input bg-control h-11 rounded-xl border px-3"
                  value={field.state.value}
                  onChange={(event) =>
                    field.handleChange(
                      Schema.decodeUnknownSync(RoutineFields.fields.selection)(
                        event.target.value
                      )
                    )
                  }
                >
                  <option value="pin">Keep this choice</option>
                  <option value="prefer">Prefer it</option>
                  <option value="rotate">Rotate it</option>
                </select>
                <FieldDescription>
                  This guides a draft. Person suitability still needs review.
                </FieldDescription>
              </Field>
            )}
          </form.Field>
        </FieldGroup>
        <form.Field name="weekdays">
          {(field) => (
            <fieldset>
              <legend className="text-sm font-medium">Days</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {weekdayLabels.map((label, index) => (
                  <label
                    key={label}
                    className="flex min-h-10 items-center gap-1.5 text-sm"
                  >
                    <Checkbox
                      checked={field.state.value.includes(index)}
                      onCheckedChange={(checked) =>
                        field.handleChange(
                          checked === true
                            ? [...field.state.value, index]
                            : field.state.value.filter((day) => day !== index)
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </form.Field>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Check the routine</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form.Subscribe
          selector={(state) =>
            [state.isSubmitting, state.values.editingId] as const
          }
        >
          {([submitting, editingId]) => (
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={
                  pending ||
                  submitting ||
                  occasions.length === 0 ||
                  snapshot.options.length === 0
                }
              >
                {editingId ? "Update routine" : "Save routine"}
              </Button>
              {editingId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => form.reset()}
                >
                  Cancel edit
                </Button>
              )}
            </div>
          )}
        </form.Subscribe>
      </form>
      {snapshot.routines.length > 0 && (
        <div className="border-border border-t pt-4">
          <h4 className="font-medium">Saved routines</h4>
          <ul className="mt-3 space-y-3">
            {snapshot.routines.map((routine) => {
              const label =
                occasions.find(
                  (occasion) => occasion.occasionId === routine.occasionId
                )?.label ?? "Earlier meal";
              const { scope, choice } = routine;
              const target =
                scope._tag === "Household"
                  ? "Everyone"
                  : (people.find((person) => person.id === scope.personId)
                      ?.displayName ?? "Family member");
              const reference =
                choice._tag === "Options" && choice.optionRefs.length === 1
                  ? choice.optionRefs[0]
                  : undefined;
              const canEdit =
                reference !== undefined &&
                snapshot.options.some(
                  (option) => option.optionId === reference.optionId
                );
              return (
                <li
                  key={routine.id}
                  className="border-border flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {target} · {label}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {routine.state === "paused" ? "Paused" : "Active"} ·{" "}
                      {routine.weekdays
                        .map((day) => weekdayLabels[day])
                        .join(", ")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {canEdit && (
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => edit(routine)}
                      >
                        Edit
                      </Button>
                    )}
                    {routine.state === "active" && (
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => pause(routine)}
                      >
                        Pause
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

const FallbackEditor = ({
  snapshot,
  people,
  pending,
  onCommand,
}: {
  readonly snapshot: PlanningContentSnapshot;
  readonly people: readonly HouseholdPerson[];
  readonly pending: boolean;
  readonly onCommand: (command: PlanningContentCommand) => void;
}) => {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: Schema.decodeUnknownSync(FallbackFields)({
      editingId: "",
      optionId: snapshot.options[0]?.optionId ?? "",
      personId: people[0]?.id ?? "",
    }),
    onSubmit: ({ value }) => {
      if (pending) {
        return;
      }
      const fields = Schema.decodeUnknownSync(FallbackFields)(value);
      const person = people.find((entry) => entry.id === fields.personId);
      const option = snapshot.options.find(
        (entry) => entry.optionId === fields.optionId
      );
      const editing =
        fields.editingId === ""
          ? undefined
          : snapshot.fallbacks.find((item) => item.id === fields.editingId);
      if (fields.editingId !== "" && !editing) {
        setError("This fallback changed. Choose it again before saving.");
        return;
      }
      if (!person || !option) {
        setError("Choose a person and saved meal.");
        return;
      }
      if (editing && editing.personId !== person.id) {
        setError("Keep this fallback with its original person.");
        return;
      }
      if (
        !editing &&
        snapshot.fallbacks.some(
          (item) =>
            item.personId === person.id &&
            item.state === "active" &&
            item.optionRef.optionId === option.optionId
        )
      ) {
        setError(
          "This food is already an active fallback for this person. Edit it instead."
        );
        return;
      }
      try {
        const fallback = fallbackFromFields(snapshot, person, option, editing);
        setError(null);
        onCommand({ _tag: "PutFallback", value: fallback });
      } catch {
        setError("This fallback could not be checked.");
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(FallbackFields) },
  });
  const edit = (fallback: PlanningContentSnapshot["fallbacks"][number]) => {
    form.setFieldValue("editingId", fallback.id);
    form.setFieldValue("personId", fallback.personId);
    form.setFieldValue("optionId", fallback.optionRef.optionId);
    setError(null);
  };
  const pause = (fallback: PlanningContentSnapshot["fallbacks"][number]) => {
    if (pending) {
      return;
    }
    try {
      const value = Schema.decodeUnknownSync(Fallback)({
        ...fallback,
        state: "paused",
        version: fallback.version + 1,
      });
      setError(null);
      onCommand({ _tag: "PutFallback", value });
    } catch {
      setError("This fallback could not be paused. Try again.");
    }
  };
  return (
    <div className="border-border flex flex-col gap-5 rounded-3xl border p-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-5"
      >
        <div>
          <p className="text-muted-foreground text-xs tracking-widest uppercase">
            When the shared meal does not fit
          </p>
          <h3 className="font-display mt-2 text-3xl">A dependable fallback.</h3>
        </div>
        <FieldGroup>
          <form.Subscribe selector={(state) => state.values.editingId}>
            {(editingId) => (
              <form.Field name="personId">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="fallback-person">Person</FieldLabel>
                    <select
                      id="fallback-person"
                      className="border-input bg-control h-11 rounded-xl border px-3"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      disabled={editingId !== ""}
                    >
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.displayName}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </form.Field>
            )}
          </form.Subscribe>
          <form.Field name="optionId">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="fallback-option">Saved food</FieldLabel>
                <select
                  id="fallback-option"
                  className="border-input bg-control h-11 rounded-xl border px-3"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  {snapshot.options.map((option) => (
                    <option key={option.optionId} value={option.optionId}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldDescription>
                  Suitability must still be confirmed for this person.
                </FieldDescription>
              </Field>
            )}
          </form.Field>
        </FieldGroup>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Check the fallback</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form.Subscribe
          selector={(state) =>
            [state.isSubmitting, state.values.editingId] as const
          }
        >
          {([submitting, editingId]) => (
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={
                  pending ||
                  submitting ||
                  people.length === 0 ||
                  snapshot.options.length === 0
                }
              >
                {editingId ? "Update fallback" : "Save fallback"}
              </Button>
              {editingId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => form.reset()}
                >
                  Cancel edit
                </Button>
              )}
            </div>
          )}
        </form.Subscribe>
      </form>
      {snapshot.fallbacks.length > 0 && (
        <div className="border-border border-t pt-4">
          <h4 className="font-medium">Saved fallbacks</h4>
          <ul className="mt-3 space-y-3">
            {snapshot.fallbacks.map((fallback) => {
              const target =
                people.find((person) => person.id === fallback.personId)
                  ?.displayName ?? "Family member";
              const label =
                snapshot.options.find(
                  (option) => option.optionId === fallback.optionRef.optionId
                )?.label ?? "Earlier saved food";
              const canEdit = snapshot.options.some(
                (option) => option.optionId === fallback.optionRef.optionId
              );
              return (
                <li
                  key={fallback.id}
                  className="border-border flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {target} · {label}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {fallback.state === "active" ? "Active" : "Paused"} ·
                      priority {fallback.priority}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {canEdit && (
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => edit(fallback)}
                      >
                        Edit
                      </Button>
                    )}
                    {fallback.state === "active" && (
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => pause(fallback)}
                      >
                        Pause
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

export const PlanningFoundations = ({
  snapshot,
  people,
  pending,
  onCommand,
}: {
  readonly snapshot: PlanningContentSnapshot;
  readonly people: readonly HouseholdPerson[];
  readonly pending: boolean;
  readonly onCommand: (command: PlanningContentCommand) => void;
}) => (
  <section className="border-border border-t pt-9">
    <div className="mb-6">
      <p className="text-muted-foreground text-xs tracking-widest uppercase">
        Your family’s rhythm
      </p>
      <h2 className="font-display mt-2 text-4xl">The food you come back to.</h2>
    </div>
    {snapshot.managedOccasions.length === 0 ? (
      <CoverageSetup people={people} pending={pending} onCommand={onCommand} />
    ) : (
      <section
        className="bg-accent mb-6 rounded-3xl p-6 md:p-8"
        aria-labelledby="managed-coverage-title"
      >
        <h3 id="managed-coverage-title" className="font-display text-3xl">
          Meals we manage.
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          Adjust each person’s meals here. Existing meal identities and their
          days stay in place.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {people.map((person) => {
            const entries = snapshot.managedOccasions.filter(
              (entry) => entry.personId === person.id
            );
            const fingerprint = entries
              .map((entry) => `${entry.occasionId}:${entry.state}`)
              .join("|");
            return (
              <CoveragePersonEditor
                key={`${person.id}:${fingerprint}`}
                person={person}
                entries={entries}
                pending={pending}
                onCommand={onCommand}
              />
            );
          })}
        </div>
      </section>
    )}
    {snapshot.managedOccasions.length > 0 && (
      <div className="grid gap-5 lg:grid-cols-2">
        <RoutineEditor
          snapshot={snapshot}
          people={people}
          pending={pending}
          onCommand={onCommand}
        />
        <FallbackEditor
          snapshot={snapshot}
          people={people}
          pending={pending}
          onCommand={onCommand}
        />
      </div>
    )}
  </section>
);
