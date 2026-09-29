import {
  KnownQuantity,
  MealOption,
  MealOptionCover,
  PlanningOptionVersion,
  PreparationProfile,
  QuantityUnit,
  SubstitutionPolicy,
} from "@meal-planner/household-api";
import type { FoodComponent } from "@meal-planner/household-api";
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
import { CoverPicker } from "./cover-picker.js";

const ComponentDraft = Schema.Struct({
  amount: Schema.String,
  name: Schema.String,
  substitutionPolicy: SubstitutionPolicy,
  unit: QuantityUnit,
});
const ReviewFields = Schema.Struct({
  amount: Schema.String,
  attention: PreparationProfile.fields.attention,
  cleanup: PreparationProfile.fields.cleanup,
  components: Schema.Array(ComponentDraft),
  cover: Schema.NullOr(MealOptionCover),
  elapsed: Schema.String,
  equipment: Schema.String,
  handsOn: Schema.String,
  productIdentity: Schema.String,
  startRequirement: PreparationProfile.fields.startRequirement,
  substantialCookEvent: PreparationProfile.fields.substantialCookEvent,
  unit: QuantityUnit,
});
type ReviewFields = typeof ReviewFields.Type;

const emptyComponent = (): typeof ComponentDraft.Type => ({
  amount: "",
  name: "",
  substitutionPolicy: "ask",
  unit: "item",
});

const fromComponent = (
  component: FoodComponent
): typeof ComponentDraft.Type => ({
  amount:
    component.quantity._tag === "Known"
      ? String(component.quantity.amount)
      : "",
  name: component.name,
  substitutionPolicy: component.substitutionPolicy,
  unit: component.quantity._tag === "Known" ? component.quantity.unit : "item",
});

const sourceFor = (option: MealOption) => {
  switch (option.kind) {
    case "recipe": {
      return option.yield;
    }
    case "assembled": {
      return option.yield;
    }
    case "packaged": {
      return option.quantity;
    }
    case "external": {
      return null;
    }
    default: {
      return null;
    }
  }
};
const componentsFor = (option: MealOption): readonly FoodComponent[] => {
  switch (option.kind) {
    case "recipe": {
      return option.shoppingComponents;
    }
    case "assembled": {
      return option.components;
    }
    default: {
      return [];
    }
  }
};
const knownTimeText = (time: PreparationProfile["elapsedTime"] | undefined) =>
  time?._tag === "Known" ? String(time.minutes) : "";
const componentDrafts = (components: readonly FoodComponent[]) =>
  components.length ? components.map(fromComponent) : [emptyComponent()];
const defaults = (option: MealOption): ReviewFields => {
  const source = sourceFor(option);
  const components = componentsFor(option);
  const preparation = option.kind === "external" ? null : option.preparation;
  return Schema.decodeUnknownSync(ReviewFields)({
    amount: source?._tag === "Known" ? String(source.amount) : "",
    attention: preparation?.attention ?? "unknown",
    cleanup: preparation?.cleanup ?? "unknown",
    components: componentDrafts(components),
    cover: option.cover,
    elapsed: knownTimeText(preparation?.elapsedTime),
    equipment: preparation?.requiredEquipment.join(", ") ?? "",
    handsOn: knownTimeText(preparation?.handsOnTime),
    productIdentity:
      option.kind === "packaged" ? (option.productIdentity ?? "") : "",
    startRequirement: preparation?.startRequirement ?? "unknown",
    substantialCookEvent: preparation?.substantialCookEvent ?? "unknown",
    unit: source?._tag === "Known" ? source.unit : "portion",
  });
};

const knownQuantity = (amount: string, unit: QuantityUnit) =>
  Schema.decodeUnknownSync(KnownQuantity)({
    _tag: "Known",
    amount: Number(amount),
    sourceText: null,
    unit,
  });

const reviewedComponents = (components: ReviewFields["components"]) =>
  components.map((component) => ({
    name: component.name.trim(),
    quantity: knownQuantity(component.amount, component.unit),
    substitutionPolicy: component.substitutionPolicy,
  }));

const reviewedPreparation = (fields: ReviewFields) =>
  Schema.decodeUnknownSync(PreparationProfile)({
    attention: fields.attention,
    cleanup: fields.cleanup,
    elapsedTime:
      fields.elapsed.trim() === ""
        ? { _tag: "Unknown" }
        : { _tag: "Known", minutes: Number(fields.elapsed) },
    handsOnTime:
      fields.handsOn.trim() === ""
        ? { _tag: "Unknown" }
        : { _tag: "Known", minutes: Number(fields.handsOn) },
    requiredEquipment: fields.equipment
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    startRequirement: fields.startRequirement,
    substantialCookEvent: fields.substantialCookEvent,
  });

const buildReviewedOption = (
  option: MealOption,
  fields: ReviewFields
): MealOption => {
  const optionVersion = Schema.decodeUnknownSync(PlanningOptionVersion)(
    option.optionVersion + 1
  );
  if (option.kind === "external") {
    return Schema.decodeUnknownSync(MealOption)({
      ...option,
      cover: fields.cover,
      optionVersion,
    });
  }
  const quantity = knownQuantity(fields.amount, fields.unit);
  const preparation = reviewedPreparation(fields);
  if (option.kind === "packaged") {
    return Schema.decodeUnknownSync(MealOption)({
      ...option,
      cover: fields.cover,
      optionVersion,
      preparation,
      productIdentity: fields.productIdentity.trim() || null,
      quantity,
    });
  }
  const components = reviewedComponents(fields.components);
  if (components.length === 0) {
    throw new Error("At least one component is needed.");
  }
  if (option.kind === "recipe") {
    return Schema.decodeUnknownSync(MealOption)({
      ...option,
      cover: fields.cover,
      optionVersion,
      preparation,
      shoppingComponents: components,
      shoppingStatus: "reviewed",
      yield: quantity,
    });
  }
  return Schema.decodeUnknownSync(MealOption)({
    ...option,
    components,
    cover: fields.cover,
    optionVersion,
    preparation,
    yield: quantity,
  });
};

export const OptionPlanningReview = ({
  option,
  pending,
  onSave,
}: {
  readonly option: MealOption;
  readonly pending: boolean;
  readonly onSave: (option: MealOption) => void;
}) => {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: defaults(option),
    onSubmit: ({ value }) => {
      try {
        const reviewed = buildReviewedOption(
          option,
          Schema.decodeUnknownSync(ReviewFields)(value)
        );
        setError(null);
        onSave(reviewed);
      } catch {
        setError(
          "Enter a positive amount and unit for the yield and every named component."
        );
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(ReviewFields) },
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
          Planning review
        </p>
        <h2 className="font-display mt-2 text-4xl">Confirm what this makes.</h2>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Use only amounts you know. The original recipe or product details stay
          available to inspect.
        </p>
      </div>
      <FieldGroup>
        <form.Field name="cover">
          {(field) => (
            <CoverPicker
              cover={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        {option.kind !== "external" && (
          <>
            <div className="grid grid-cols-[1fr_8rem] gap-3">
              <form.Field name="amount">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="review-yield-amount">
                      {option.kind === "packaged"
                        ? "Product amount"
                        : "Original batch yield"}
                    </FieldLabel>
                    <Input
                      id="review-yield-amount"
                      type="number"
                      min="0"
                      step="any"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      required
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="unit">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="review-yield-unit">Unit</FieldLabel>
                    <select
                      id="review-yield-unit"
                      className="border-input bg-control h-11 rounded-xl border px-3"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(
                          Schema.decodeUnknownSync(QuantityUnit)(
                            event.target.value
                          )
                        )
                      }
                    >
                      {QuantityUnit.literals.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </form.Field>
            </div>
            {option.kind === "packaged" && (
              <form.Field name="productIdentity">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="review-product-identity">
                      Exact product identity
                    </FieldLabel>
                    <Input
                      id="review-product-identity"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      maxLength={160}
                    />
                    <FieldDescription>
                      Leave blank when the exact product is not yet known.
                    </FieldDescription>
                  </Field>
                )}
              </form.Field>
            )}
            {(option.kind === "recipe" || option.kind === "assembled") && (
              <form.Field name="components">
                {(field) => (
                  <fieldset className="flex flex-col gap-4">
                    <legend className="text-sm font-medium">
                      {option.kind === "recipe"
                        ? "Shopping components"
                        : "Meal components"}
                    </legend>
                    {field.state.value.map((component, index) => (
                      <div
                        className="grid grid-cols-[minmax(0,1fr)_5.5rem_6rem] gap-2"
                        key={index}
                      >
                        <Input
                          aria-label={`Component ${index + 1} name`}
                          placeholder="Ingredient or product"
                          value={component.name}
                          onChange={(event) =>
                            field.handleChange(
                              field.state.value.map((item, position) =>
                                position === index
                                  ? { ...item, name: event.target.value }
                                  : item
                              )
                            )
                          }
                          required
                          maxLength={160}
                        />
                        <Input
                          aria-label={`Component ${index + 1} amount`}
                          type="number"
                          min="0"
                          step="any"
                          value={component.amount}
                          onChange={(event) =>
                            field.handleChange(
                              field.state.value.map((item, position) =>
                                position === index
                                  ? { ...item, amount: event.target.value }
                                  : item
                              )
                            )
                          }
                          required
                        />
                        <select
                          aria-label={`Component ${index + 1} unit`}
                          className="border-input bg-control h-11 rounded-xl border px-2"
                          value={component.unit}
                          onChange={(event) =>
                            field.handleChange(
                              field.state.value.map((item, position) =>
                                position === index
                                  ? {
                                      ...item,
                                      unit: Schema.decodeUnknownSync(
                                        QuantityUnit
                                      )(event.target.value),
                                    }
                                  : item
                              )
                            )
                          }
                        >
                          {QuantityUnit.literals.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      className="self-start"
                      onClick={() =>
                        field.handleChange([
                          ...field.state.value,
                          emptyComponent(),
                        ])
                      }
                    >
                      Add component
                    </Button>
                  </fieldset>
                )}
              </form.Field>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <form.Field name="attention">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="review-attention">
                      Attention
                    </FieldLabel>
                    <select
                      id="review-attention"
                      className="border-input bg-control h-11 rounded-xl border px-3"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(
                          Schema.decodeUnknownSync(
                            PreparationProfile.fields.attention
                          )(event.target.value)
                        )
                      }
                    >
                      {PreparationProfile.fields.attention.literals.map(
                        (value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        )
                      )}
                    </select>
                  </Field>
                )}
              </form.Field>
              <form.Field name="cleanup">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="review-cleanup">Cleanup</FieldLabel>
                    <select
                      id="review-cleanup"
                      className="border-input bg-control h-11 rounded-xl border px-3"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(
                          Schema.decodeUnknownSync(
                            PreparationProfile.fields.cleanup
                          )(event.target.value)
                        )
                      }
                    >
                      {PreparationProfile.fields.cleanup.literals.map(
                        (value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        )
                      )}
                    </select>
                  </Field>
                )}
              </form.Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <form.Field name="elapsed">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="review-elapsed">
                      Elapsed minutes
                    </FieldLabel>
                    <Input
                      id="review-elapsed"
                      type="number"
                      min="0"
                      step="1"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder="Unknown"
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="handsOn">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="review-hands-on">
                      Hands-on minutes
                    </FieldLabel>
                    <Input
                      id="review-hands-on"
                      type="number"
                      min="0"
                      step="1"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder="Unknown"
                    />
                  </Field>
                )}
              </form.Field>
            </div>
            <form.Field name="startRequirement">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="review-start">
                    When must it start?
                  </FieldLabel>
                  <select
                    id="review-start"
                    className="border-input bg-control h-11 rounded-xl border px-3"
                    value={field.state.value}
                    onChange={(event) =>
                      field.handleChange(
                        Schema.decodeUnknownSync(
                          PreparationProfile.fields.startRequirement
                        )(event.target.value)
                      )
                    }
                  >
                    <option value="unknown">Unknown</option>
                    <option value="none">No preparation</option>
                    <option value="during_window">
                      During the meal window
                    </option>
                    <option value="advance_start">Start in advance</option>
                  </select>
                </Field>
              )}
            </form.Field>
            <form.Field name="substantialCookEvent">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="review-substantial">
                    Substantial cooking event?
                  </FieldLabel>
                  <select
                    id="review-substantial"
                    className="border-input bg-control h-11 rounded-xl border px-3"
                    value={field.state.value}
                    onChange={(event) =>
                      field.handleChange(
                        Schema.decodeUnknownSync(
                          PreparationProfile.fields.substantialCookEvent
                        )(event.target.value)
                      )
                    }
                  >
                    <option value="unknown">Unknown</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </Field>
              )}
            </form.Field>
            <form.Field name="equipment">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="review-equipment">Equipment</FieldLabel>
                  <Input
                    id="review-equipment"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Separate items with commas"
                    maxLength={500}
                  />
                </Field>
              )}
            </form.Field>
          </>
        )}
      </FieldGroup>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Review needed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <Button type="submit" disabled={pending || submitting}>
            Confirm planning details
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
};
