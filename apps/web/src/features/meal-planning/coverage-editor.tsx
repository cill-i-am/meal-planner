import { MealPlanResolution } from "@meal-planner/household-api";
import type {
  MealPlanCoverage,
  MealPlanVersion,
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
import { Input } from "../../components/ui/input.js";
import { Textarea } from "../../components/ui/textarea.js";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/toggle-group.js";
import { dateLabel, resolutionLabel } from "./plan-projection.js";

interface PlanPerson {
  readonly id: string;
  readonly displayName: string;
}

const ChangeFields = Schema.Struct({
  choice: Schema.Literals([
    "saved",
    "external",
    "prepared",
    "flexible",
    "skip",
  ]),
  description: Schema.String,
  optionAmount: Schema.String,
  optionId: Schema.String,
  preparedAmount: Schema.String,
  preparedId: Schema.String,
  reason: Schema.String,
  replaceShared: Schema.Boolean,
});
type ChangeFields = typeof ChangeFields.Type;

const sourceQuantity = (option: PlanningContentSnapshot["options"][number]) => {
  if (option.kind === "recipe" || option.kind === "assembled") {
    return option.yield;
  }
  return option.kind === "packaged" ? option.quantity : null;
};

const nextResolution = (
  fields: ChangeFields,
  coverage: MealPlanCoverage,
  snapshot: PlanningContentSnapshot
): MealPlanResolution => {
  const rationale = fields.reason.trim();
  if (rationale.length === 0) {
    throw new Error("Say what you want to change.");
  }
  if (fields.choice === "saved") {
    const option = snapshot.options.find(
      (item) => item.optionId === fields.optionId
    );
    if (!option) {
      throw new Error("Choose a saved meal.");
    }
    const yieldQuantity = sourceQuantity(option);
    if (option.kind !== "external" && yieldQuantity?._tag !== "Known") {
      throw new Error(
        "Review this meal’s quantity in Food book before allocating it."
      );
    }
    let quantity: { amount: number; unit: string } | null = null;
    if (yieldQuantity?._tag === "Known") {
      if (fields.replaceShared && coverage.resolution._tag === "MealOption") {
        if (coverage.resolution.quantity?.unit !== yieldQuantity.unit) {
          throw new Error(
            "Shared portions use a different unit. Change each plate separately."
          );
        }
        ({ quantity } = coverage.resolution);
      } else {
        const amount = Number(fields.optionAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error("Enter a positive amount for this person.");
        }
        quantity = { amount, unit: yieldQuantity.unit };
      }
    }
    return Schema.decodeUnknownSync(MealPlanResolution)({
      _tag: "MealOption",
      eventId: crypto.randomUUID(),
      option: {
        kind: option.kind,
        optionId: option.optionId,
        optionVersion: option.optionVersion,
      },
      quantity,
      rationale,
    });
  }
  if (fields.choice === "external") {
    return Schema.decodeUnknownSync(MealPlanResolution)({
      _tag: "External",
      description: fields.description.trim(),
      rationale,
    });
  }
  if (fields.choice === "prepared") {
    const portion = snapshot.preparedPortions.find(
      (item) => item.id === fields.preparedId
    );
    if (!portion) {
      throw new Error("Choose confirmed prepared food.");
    }
    return Schema.decodeUnknownSync(MealPlanResolution)({
      _tag: "Prepared",
      outputId: portion.id,
      quantity: {
        amount: Number(fields.preparedAmount),
        unit: portion.quantity.unit,
      },
      rationale,
    });
  }
  return Schema.decodeUnknownSync(MealPlanResolution)({
    _tag: fields.choice === "skip" ? "Skip" : "Flexible",
    rationale,
  });
};

export const CoverageEditor = ({
  coverage,
  snapshot,
  cookEvents,
  people,
  pending,
  onClose,
  onSubmit,
}: {
  readonly coverage: MealPlanCoverage;
  readonly snapshot: PlanningContentSnapshot;
  readonly cookEvents: MealPlanVersion["cookEvents"];
  readonly people: readonly PlanPerson[];
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (
    resolution: MealPlanResolution,
    reason: string,
    replaceShared: boolean
  ) => void;
}) => {
  const [formError, setFormError] = useState<string | null>(null);
  const person = people.find(
    (item) => item.id === coverage.requirement.personId
  );
  const occasion = snapshot.managedOccasions.find(
    (item) => item.occasionId === coverage.requirement.occasion
  );
  const form = useForm({
    defaultValues: Schema.decodeUnknownSync(ChangeFields)({
      choice: "saved",
      description: "",
      optionAmount: "",
      optionId: snapshot.options[0]?.optionId ?? "",
      preparedAmount: "",
      preparedId:
        snapshot.preparedPortions.find(
          (portion) => portion.state === "available"
        )?.id ?? "",
      reason: "",
      replaceShared: false,
    }),
    onSubmit: ({ value }) => {
      try {
        const fields = Schema.decodeUnknownSync(ChangeFields)(value);
        const resolution = nextResolution(fields, coverage, snapshot);
        setFormError(null);
        onSubmit(
          resolution,
          fields.reason.trim(),
          fields.replaceShared &&
            coverage.resolution._tag === "MealOption" &&
            resolution._tag === "MealOption"
        );
      } catch (error) {
        setFormError(
          error instanceof Error && error.message.length < 160
            ? error.message
            : "Check the meal and amount before saving."
        );
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(ChangeFields) },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
      className="flex flex-col gap-6"
    >
      <div>
        <p className="text-muted-foreground text-xs tracking-widest uppercase">
          {dateLabel(coverage.requirement.date, {
            day: "numeric",
            month: "short",
            weekday: "long",
          })}{" "}
          · {occasion?.label ?? "Meal"}
        </p>
        <h3 className="font-display mt-2 text-4xl">
          {person?.displayName ?? "Family member"}’s meal.
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          Current choice:{" "}
          {resolutionLabel(coverage.resolution, snapshot, cookEvents)}
        </p>
      </div>
      <FieldGroup>
        <form.Field name="choice">
          {(field) => (
            <Field>
              <FieldLabel>Choose a change</FieldLabel>
              <ToggleGroup
                aria-label="Meal change type"
                value={[field.state.value]}
                onValueChange={(values) => {
                  const decoded = Schema.decodeUnknownOption(
                    ChangeFields.fields.choice
                  )(values[0]);
                  if (decoded._tag === "Some") {
                    field.handleChange(decoded.value);
                  }
                }}
                className="flex flex-wrap"
              >
                <ToggleGroupItem value="saved">Saved meal</ToggleGroupItem>
                <ToggleGroupItem value="external">
                  Takeaway or out
                </ToggleGroupItem>
                <ToggleGroupItem value="prepared">Leftovers</ToggleGroupItem>
                <ToggleGroupItem value="flexible">Decide later</ToggleGroupItem>
                <ToggleGroupItem value="skip">Skip</ToggleGroupItem>
              </ToggleGroup>
            </Field>
          )}
        </form.Field>
        <form.Subscribe
          selector={(state) => ({
            choice: state.values.choice,
            optionId: state.values.optionId,
            preparedId: state.values.preparedId,
            replaceShared: state.values.replaceShared,
          })}
        >
          {({ choice, optionId, preparedId, replaceShared }) => {
            const selectedOption = snapshot.options.find(
              (item) => item.optionId === optionId
            );
            const selectedPrepared = snapshot.preparedPortions.find(
              (item) => item.id === preparedId
            );
            const yieldQuantity = selectedOption
              ? sourceQuantity(selectedOption)
              : null;
            return (
              <>
                {choice === "saved" && (
                  <>
                    <form.Field name="optionId">
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor="plan-option">
                            Saved meal
                          </FieldLabel>
                          <select
                            id="plan-option"
                            className="border-input bg-control h-11 w-full rounded-xl border px-3"
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                          >
                            <option value="">Choose a meal</option>
                            {snapshot.options.map((option) => (
                              <option
                                key={option.optionId}
                                value={option.optionId}
                              >
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <FieldDescription>
                            The planner checks suitability and dependencies when
                            you save.
                          </FieldDescription>
                        </Field>
                      )}
                    </form.Field>
                    {selectedOption?.kind !== "external" && !replaceShared && (
                      <form.Field name="optionAmount">
                        {(field) => (
                          <Field>
                            <FieldLabel htmlFor="plan-option-amount">
                              Amount for {person?.displayName ?? "this person"}
                              {yieldQuantity?._tag === "Known"
                                ? ` (${yieldQuantity.unit})`
                                : ""}
                            </FieldLabel>
                            <Input
                              id="plan-option-amount"
                              type="number"
                              min="0"
                              step="any"
                              value={field.state.value}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                            />
                            <FieldDescription>
                              {yieldQuantity?._tag === "Known"
                                ? `Confirmed batch yield: ${yieldQuantity.amount} ${yieldQuantity.unit}.`
                                : "Confirm yield and shopping quantities in Food book first."}
                            </FieldDescription>
                          </Field>
                        )}
                      </form.Field>
                    )}
                    {coverage.resolution._tag === "MealOption" && (
                      <form.Field name="replaceShared">
                        {(field) => (
                          <Field orientation="horizontal">
                            <Checkbox
                              id="plan-replace-shared"
                              checked={field.state.value}
                              onCheckedChange={(checked) =>
                                field.handleChange(checked === true)
                              }
                            />
                            <FieldLabel htmlFor="plan-replace-shared">
                              Change everyone sharing this meal event
                            </FieldLabel>
                            <FieldDescription>
                              Existing allocations stay. Dependent leftovers
                              become visible gaps.
                            </FieldDescription>
                          </Field>
                        )}
                      </form.Field>
                    )}
                  </>
                )}
                {choice === "external" && (
                  <form.Field name="description">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="plan-external">
                          What happened?
                        </FieldLabel>
                        <Input
                          id="plan-external"
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          maxLength={160}
                          placeholder="Takeaway, dinner out, or another external meal"
                        />
                      </Field>
                    )}
                  </form.Field>
                )}
                {choice === "prepared" && (
                  <>
                    <form.Field name="preparedId">
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor="plan-prepared">
                            Prepared food
                          </FieldLabel>
                          <select
                            id="plan-prepared"
                            className="border-input bg-control h-11 w-full rounded-xl border px-3"
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                          >
                            <option value="">Choose confirmed food</option>
                            {snapshot.preparedPortions
                              .filter(
                                (portion) => portion.state === "available"
                              )
                              .map((portion) => (
                                <option key={portion.id} value={portion.id}>
                                  {portion.label} · {portion.remainingAmount}{" "}
                                  {portion.quantity.unit} remaining
                                </option>
                              ))}
                          </select>
                        </Field>
                      )}
                    </form.Field>
                    <form.Field name="preparedAmount">
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor="plan-amount">
                            Amount to use
                            {selectedPrepared
                              ? ` (${selectedPrepared.quantity.unit})`
                              : ""}
                          </FieldLabel>
                          <Input
                            id="plan-amount"
                            type="number"
                            min="0"
                            step="any"
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                          />
                        </Field>
                      )}
                    </form.Field>
                  </>
                )}
              </>
            );
          }}
        </form.Subscribe>
        <form.Field name="reason">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="plan-reason">Why change it?</FieldLabel>
              <Textarea
                id="plan-reason"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                maxLength={600}
                placeholder="A short note for the family plan"
              />
            </Field>
          )}
        </form.Field>
      </FieldGroup>
      {formError && (
        <Alert variant="destructive">
          <AlertTitle>Check this change</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={pending || submitting}>
              Review change
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
};
