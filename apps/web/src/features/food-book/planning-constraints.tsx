import { Availability, CookingCapacity } from "@meal-planner/household-api";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";

const CapacityFields = Schema.Struct({
  equipment: Schema.String,
  maximum: Schema.String,
});
const AvailabilityFields = Schema.Struct({
  handsOffStart: Schema.String,
  location: Schema.String,
  occasion: Schema.String,
  window: Schema.String,
});

export const PlanningConstraints = ({
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
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null
  );
  const entries = snapshot.managedOccasions.filter(
    (item) => item.state === "managed"
  );
  const capacity = useForm({
    defaultValues: Schema.decodeUnknownSync(CapacityFields)({
      equipment: snapshot.cookingCapacity.availableEquipment.join(", "),
      maximum: String(
        snapshot.cookingCapacity.maximumSubstantialCookEventsPerWeek
      ),
    }),
    onSubmit: ({ value }) => {
      try {
        const decoded = Schema.decodeUnknownSync(CookingCapacity)({
          availableEquipment: value.equipment
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          maximumSubstantialCookEventsPerWeek: Number(value.maximum),
        });
        setCapacityError(null);
        onCommand({ _tag: "SetCookingCapacity", value: decoded });
      } catch {
        setCapacityError(
          "Enter between zero and 21 substantial cooks per week."
        );
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(CapacityFields) },
  });
  const available = useForm({
    defaultValues: Schema.decodeUnknownSync(AvailabilityFields)({
      handsOffStart: "unknown",
      location: "home",
      occasion: entries[0]
        ? `${entries[0].personId}:${entries[0].occasionId}`
        : "",
      window: "",
    }),
    onSubmit: ({ value }) => {
      const target = entries.find(
        (entry) => `${entry.personId}:${entry.occasionId}` === value.occasion
      );
      if (!target) {
        setAvailabilityError("Choose a managed meal.");
        return;
      }
      try {
        const next = Schema.decodeUnknownSync(Availability)({
          handsOffStart: value.handsOffStart,
          location: value.location,
          occasionId: target.occasionId,
          personId: target.personId,
          preparationWindowMinutes: Number(value.window),
          weekdays: target.weekdays,
        });
        setAvailabilityError(null);
        onCommand({
          _tag: "SetPersonAvailability",
          entries: [
            ...snapshot.availability.filter(
              (item) =>
                item.personId === target.personId &&
                item.occasionId !== target.occasionId
            ),
            next,
          ],
          personId: target.personId,
        });
      } catch {
        setAvailabilityError(
          "Enter a nonnegative preparation window and choose a location."
        );
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(AvailabilityFields) },
  });
  return (
    <section className="border-border border-t pt-9">
      <div>
        <p className="text-muted-foreground text-xs tracking-widest uppercase">
          What fits real life
        </p>
        <h2 className="font-display mt-2 text-4xl">Time, place and cooking.</h2>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
          These limits help the planner avoid asking your family to cook where
          or when it cannot work.
        </p>
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void capacity.handleSubmit();
          }}
          className="border-border flex flex-col gap-5 rounded-3xl border p-6"
        >
          <h3 className="font-display text-3xl">Cooking capacity.</h3>
          <FieldGroup>
            <capacity.Field name="maximum">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="capacity-maximum">
                    Substantial cooks per week
                  </FieldLabel>
                  <Input
                    id="capacity-maximum"
                    type="number"
                    min={0}
                    max={21}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                  <FieldDescription>
                    Set zero when no substantial cooking is available.
                  </FieldDescription>
                </Field>
              )}
            </capacity.Field>
            <capacity.Field name="equipment">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="capacity-equipment">
                    Available equipment
                  </FieldLabel>
                  <Input
                    id="capacity-equipment"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Separate items with commas"
                  />
                </Field>
              )}
            </capacity.Field>
          </FieldGroup>
          {capacityError && (
            <Alert variant="destructive">
              <AlertTitle>Check cooking capacity</AlertTitle>
              <AlertDescription>{capacityError}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending}>
            Save cooking capacity
          </Button>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void available.handleSubmit();
          }}
          className="border-border flex flex-col gap-5 rounded-3xl border p-6"
        >
          <h3 className="font-display text-3xl">Where and when.</h3>
          <FieldGroup>
            <available.Field name="occasion">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="availability-occasion">
                    Person and meal
                  </FieldLabel>
                  <select
                    id="availability-occasion"
                    className="border-input bg-control h-11 rounded-xl border px-3"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  >
                    <option value="">Choose a meal</option>
                    {entries.map((entry) => (
                      <option
                        key={`${entry.personId}:${entry.occasionId}`}
                        value={`${entry.personId}:${entry.occasionId}`}
                      >
                        {people.find((person) => person.id === entry.personId)
                          ?.displayName ?? "Family member"}{" "}
                        · {entry.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </available.Field>
            <available.Field name="location">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="availability-location">
                    Location
                  </FieldLabel>
                  <select
                    id="availability-location"
                    className="border-input bg-control h-11 rounded-xl border px-3"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  >
                    <option value="home">Home</option>
                    <option value="school">School</option>
                    <option value="office">Office</option>
                    <option value="travel">Travel</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
              )}
            </available.Field>
            <available.Field name="window">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="availability-window">
                    Preparation window in minutes
                  </FieldLabel>
                  <Input
                    id="availability-window"
                    type="number"
                    min="0"
                    step="1"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                </Field>
              )}
            </available.Field>
            <available.Field name="handsOffStart">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="availability-hands-off">
                    Can hands-off cooking start earlier?
                  </FieldLabel>
                  <select
                    id="availability-hands-off"
                    className="border-input bg-control h-11 rounded-xl border px-3"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  >
                    <option value="unknown">Not yet confirmed</option>
                    <option value="available">Yes</option>
                    <option value="unavailable">No</option>
                  </select>
                </Field>
              )}
            </available.Field>
          </FieldGroup>
          {availabilityError && (
            <Alert variant="destructive">
              <AlertTitle>Check availability</AlertTitle>
              <AlertDescription>{availabilityError}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending || entries.length === 0}>
            Save availability
          </Button>
        </form>
      </div>
    </section>
  );
};
