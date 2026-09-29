import {
  MealOption,
  MealOptionCover,
  PlanningContentId,
} from "@meal-planner/household-api";
import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../../components/ui/alert.js";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/toggle-group.js";
import { CoverPicker } from "./cover-picker.js";

const NewMealFields = Schema.Struct({
  amount: Schema.String,
  component: Schema.String,
  cover: Schema.NullOr(MealOptionCover),
  kind: Schema.Literals(["assembled", "packaged", "external"]),
  label: Schema.String,
  product: Schema.String,
  provider: Schema.String,
});

const unreviewedPreparation = {
  attention: "unknown",
  cleanup: "unknown",
  elapsedTime: { _tag: "Unknown" },
  handsOnTime: { _tag: "Unknown" },
  requiredEquipment: [],
  startRequirement: "unknown",
  substantialCookEvent: "unknown",
};

const newOption = (value: typeof NewMealFields.Type): MealOption => {
  const common = {
    cover: value.cover,
    label: value.label.trim(),
    optionId: Schema.decodeUnknownSync(PlanningContentId)(crypto.randomUUID()),
    optionVersion: 1,
  };
  const unresolved = { _tag: "Unresolved", sourceText: value.amount.trim() };
  if (value.kind === "assembled") {
    return Schema.decodeUnknownSync(MealOption)({
      ...common,
      components: [
        {
          name: value.component.trim(),
          quantity: unresolved,
          substitutionPolicy: "ask",
        },
      ],
      kind: value.kind,
      preparation: unreviewedPreparation,
      yield: { _tag: "Unresolved", sourceText: "Yield not confirmed" },
    });
  }
  if (value.kind === "packaged") {
    return Schema.decodeUnknownSync(MealOption)({
      ...common,
      kind: value.kind,
      preparation: unreviewedPreparation,
      productIdentity: null,
      productName: value.product.trim(),
      quantity: unresolved,
      substitutionPolicy: "ask",
    });
  }
  return Schema.decodeUnknownSync(MealOption)({
    ...common,
    kind: value.kind,
    provider: value.provider.trim() || null,
  });
};

export const NewMealOption = ({
  onSave,
}: {
  readonly onSave: (option: MealOption) => void;
}) => {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: Schema.decodeUnknownSync(NewMealFields)({
      amount: "",
      component: "",
      cover: null,
      kind: "assembled",
      label: "",
      product: "",
      provider: "",
    }),
    onSubmit: ({ value }) => {
      try {
        const decoded = Schema.decodeUnknownSync(NewMealFields)(value);
        const option = newOption(decoded);
        setError(null);
        onSave(option);
      } catch {
        setError("Add a name and the requested food details before saving.");
      }
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(NewMealFields) },
  });
  return (
    <form
      id="new-meal-option"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
      className="flex flex-col gap-6"
    >
      <div>
        <p className="text-muted-foreground text-xs tracking-widest uppercase">
          Food book
        </p>
        <h2 className="font-display mt-2 text-4xl">Add a familiar choice.</h2>
      </div>
      <FieldGroup>
        <form.Field name="kind">
          {(field) => (
            <Field>
              <FieldLabel>What kind of meal?</FieldLabel>
              <ToggleGroup
                value={[field.state.value]}
                onValueChange={(values) => {
                  const next = Schema.decodeUnknownOption(
                    NewMealFields.fields.kind
                  )(values[0]);
                  if (next._tag === "Some") {
                    field.handleChange(next.value);
                  }
                }}
                variant="segment"
              >
                <ToggleGroupItem value="assembled">Assembled</ToggleGroupItem>
                <ToggleGroupItem value="packaged">Packaged</ToggleGroupItem>
                <ToggleGroupItem value="external">Eating out</ToggleGroupItem>
              </ToggleGroup>
            </Field>
          )}
        </form.Field>
        <form.Field name="label">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="food-book-label">
                What do you call it?
              </FieldLabel>
              <Input
                id="food-book-label"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                required
                maxLength={160}
              />
            </Field>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.kind}>
          {(kind) => (
            <>
              {kind === "assembled" && (
                <>
                  <form.Field name="component">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="food-book-component">
                          First component
                        </FieldLabel>
                        <Input
                          id="food-book-component"
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          required
                          maxLength={160}
                        />
                        <FieldDescription>
                          Add more components in the planning review after
                          saving.
                        </FieldDescription>
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="amount">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="food-book-amount">
                          Source amount
                        </FieldLabel>
                        <Input
                          id="food-book-amount"
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          required
                          maxLength={160}
                          placeholder="For example, one tub"
                        />
                        <FieldDescription>
                          This stays unresolved until a measured amount is
                          confirmed.
                        </FieldDescription>
                      </Field>
                    )}
                  </form.Field>
                </>
              )}
              {kind === "packaged" && (
                <>
                  <form.Field name="product">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="food-book-product">
                          Product name
                        </FieldLabel>
                        <Input
                          id="food-book-product"
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          required
                          maxLength={160}
                        />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="amount">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="food-book-amount">
                          Source amount
                        </FieldLabel>
                        <Input
                          id="food-book-amount"
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          required
                          maxLength={160}
                          placeholder="For example, one pack"
                        />
                      </Field>
                    )}
                  </form.Field>
                </>
              )}
              {kind === "external" && (
                <form.Field name="provider">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="food-book-provider">
                        Place or provider
                      </FieldLabel>
                      <Input
                        id="food-book-provider"
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        maxLength={160}
                      />
                    </Field>
                  )}
                </form.Field>
              )}
            </>
          )}
        </form.Subscribe>
        <form.Field name="cover">
          {(field) => (
            <CoverPicker
              cover={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
      </FieldGroup>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Check this meal</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
};
