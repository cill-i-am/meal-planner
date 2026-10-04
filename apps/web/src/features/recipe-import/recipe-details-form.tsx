import {
  recipeIngredientFromText,
  recipeInstructionFromText,
} from "@meal-planner/recipe-domain";
import {
  AnswerReviewRecipeActionRequest,
  IdempotencyKey,
} from "@meal-planner/recipe-import-api";
import type { RecipeImportAction } from "@meal-planner/recipe-import-api";
import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/button.js";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";
import { PendingButton } from "../../components/ui/pending-button.js";
import { Textarea } from "../../components/ui/textarea.js";
import type { RecipeImportOperations } from "./browser-operations.js";

type ActiveReviewAction = Extract<
  RecipeImportAction,
  { readonly status: "active" }
>;
const decodeAnswer = Schema.decodeUnknownSync(AnswerReviewRecipeActionRequest);
const decodeIdempotencyKey = Schema.decodeUnknownSync(IdempotencyKey);
const idempotencyKey = (makeRequestId: () => string) =>
  decodeIdempotencyKey(makeRequestId());

type RecipeEditorValue =
  | string
  | number
  | boolean
  | null
  | readonly RecipeEditorValue[]
  | { readonly [key: string]: RecipeEditorValue };
const RecipeEditorSchema: Schema.Codec<RecipeEditorValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(RecipeEditorSchema),
    Schema.Record(Schema.String, RecipeEditorSchema),
  ])
);
const decodeEditorDraft = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, RecipeEditorSchema))
);
const detailLabels: Readonly<Record<string, string>> = {
  alt: "Image description",
  amount: "Amount",
  author: "Author",
  basis: "Nutrition basis",
  caption: "Caption",
  categories: "Categories",
  cook: "Cooking",
  cuisines: "Cuisines",
  description: "Description",
  dietary: "Dietary claims from the source",
  duration: "Duration",
  equipment: "Equipment",
  group: "Section heading",
  inactive: "Waiting or resting",
  ingredients: "Ingredients",
  instructions: "Method",
  kind: "Claim type",
  language: "Language (two-letter code)",
  localName: "Local name",
  max: "Upper amount (for a range)",
  media: "Images and videos",
  name: "Name",
  note: "Note",
  notes: "Storage, leftovers and other notes",
  nutrients: "Nutrients",
  nutrition: "Nutrition from the source",
  optional: "Optional ingredient",
  original: "Original source wording",
  prep: "Preparation",
  preparation: "Preparation",
  quantity: "Amount",
  role: "Purpose",
  seconds: "Minutes",
  servings: "Servings or yield",
  servingsCount: "Servings",
  size: "Size",
  source: "Source",
  sourceTags: "Source labels",
  step: "Step number",
  techniques: "Techniques",
  temperature: "Temperature",
  text: "Instruction",
  times: "Cooking times",
  total: "Total",
  type: "Type",
  unit: "Unit",
  url: "HTTPS link",
  value: "Amount",
};
const newDetail = (key: string): RecipeEditorValue => {
  switch (key) {
    case "ingredients": {
      return recipeIngredientFromText("");
    }
    case "instructions": {
      return recipeInstructionFromText("", 1);
    }
    case "quantity": {
      return { max: null, unit: null, value: 1 };
    }
    case "servings": {
      return { max: null, original: "", quantity: 1, unit: null };
    }
    case "author": {
      return { name: "", url: null };
    }
    case "nutrition": {
      return {
        basis: { description: null, servings: null, type: "serving" },
        nutrients: [],
        original: "",
        source: "provided",
      };
    }
    case "nutrients": {
      return { amount: { unit: "g", value: 0 }, name: "" };
    }
    case "dietary": {
      return {
        kind: "diet",
        name: "",
        original: "",
        source: "provided",
        value: true,
      };
    }
    case "media": {
      return {
        alt: null,
        caption: null,
        role: "gallery",
        step: null,
        type: "image",
        url: "",
      };
    }
    case "duration":
    case "prep":
    case "cook":
    case "inactive":
    case "total": {
      return { seconds: 0 };
    }
    case "temperature": {
      return { unit: "C", value: 180 };
    }
    case "optional": {
      return false;
    }
    case "max": {
      return 1;
    }
    case "step": {
      return 1;
    }
    default: {
      return "";
    }
  }
};
const isRecord = (
  value: RecipeEditorValue
): value is Readonly<Record<string, RecipeEditorValue>> =>
  value !== null &&
  !Schema.is(Schema.String)(value) &&
  !Schema.is(Schema.Number)(value) &&
  !Schema.is(Schema.Boolean)(value) &&
  !Array.isArray(value);

const choicesFor = (
  key: string,
  path: string,
  value: RecipeEditorValue
): readonly string[] | null => {
  if (key === "optional" || Schema.is(Schema.Boolean)(value)) {
    return ["true", "false"];
  }
  if (key === "kind") {
    return ["diet", "allergen"];
  }
  if (key === "role") {
    return ["hero", "gallery", "step", "thumbnail"];
  }
  if (key === "type") {
    if (path.includes("media")) {
      return ["image", "video"];
    }
    return ["serving", "recipe", "100g"];
  }
  if (key === "unit" && path.includes("temperature")) {
    return ["C", "F"];
  }
  if (key === "unit" && path.includes("nutrition")) {
    return ["g", "mg", "mcg", "kcal", "kJ"];
  }
  return null;
};
const choiceLabel = (choice: string) => {
  if (choice === "true") {
    return "Yes";
  }
  if (choice === "false") {
    return "No";
  }
  return choice;
};
const PrimitiveDetailControl = ({
  label,
  nullable,
  onChange,
  path,
  value,
}: {
  readonly label: string;
  readonly nullable: boolean;
  readonly onChange: (value: RecipeEditorValue) => void;
  readonly path: string;
  readonly value: RecipeEditorValue;
}) => {
  const key = path.split(".").at(-1) ?? path;
  const choices = choicesFor(key, path, value);
  let control: ReactNode;
  if (choices !== null) {
    control = (
      <select
        id={path}
        className="field-select"
        value={String(value)}
        onChange={(event) =>
          onChange(
            Schema.is(Schema.Boolean)(value)
              ? event.target.value === "true"
              : event.target.value
          )
        }
      >
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choiceLabel(choice)}
          </option>
        ))}
      </select>
    );
  } else if (Schema.is(Schema.Number)(value)) {
    control = (
      <Input
        id={path}
        type="number"
        step="any"
        value={key === "seconds" ? value / 60 : value}
        onChange={(event) =>
          onChange(
            event.target.value === ""
              ? 0
              : Number(event.target.value) * (key === "seconds" ? 60 : 1)
          )
        }
      />
    );
  } else {
    control = (
      <Textarea
        id={path}
        rows={key === "text" || key === "original" ? 2 : 1}
        value={Schema.is(Schema.String)(value) ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <Field>
      <FieldLabel htmlFor={path}>{label}</FieldLabel>
      {control}
      {nullable ? (
        <Button type="button" variant="ghost" onClick={() => onChange(null)}>
          Clear {label.toLowerCase()}
        </Button>
      ) : null}
    </Field>
  );
};

const DetailControl = ({
  value,
  onChange,
  path,
  label,
  nullable = false,
}: {
  readonly value: RecipeEditorValue;
  readonly onChange: (value: RecipeEditorValue) => void;
  readonly path: string;
  readonly label: string;
  readonly nullable?: boolean;
}) => {
  const key = path.split(".").at(-1) ?? path;
  if (value === null) {
    return (
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <p className="text-muted-foreground text-sm">Not provided</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (key === "ingredients" || key === "instructions") {
              onChange([]);
              return;
            }
            if (
              path.includes("basis.servings") ||
              path.includes("servings.quantity")
            ) {
              onChange(1);
              return;
            }
            onChange(newDetail(key));
          }}
        >
          Add {label.toLowerCase()}
        </Button>
      </Field>
    );
  }
  if (Array.isArray(value)) {
    return (
      <FieldGroup>
        <h4>{label}</h4>
        {value.map((item: RecipeEditorValue, index: number) => (
          <FieldGroup key={`${path}-${index}`}>
            <DetailControl
              path={`${path}.${index}`}
              label={`${label} ${index + 1}`}
              value={item}
              onChange={(next) =>
                onChange(
                  value.map((current: RecipeEditorValue, i: number) =>
                    i === index ? next : current
                  )
                )
              }
            />
            <Button
              variant="ghost"
              type="button"
              onClick={() =>
                onChange(
                  value
                    .filter((_: RecipeEditorValue, i: number) => i !== index)
                    .map((current: RecipeEditorValue, i: number) =>
                      key === "instructions" && isRecord(current)
                        ? { ...current, step: i + 1 }
                        : current
                    )
                )
              }
            >
              Remove {label.toLowerCase()} {index + 1}
            </Button>
          </FieldGroup>
        ))}
        <Button
          variant="outline"
          type="button"
          onClick={() => {
            const next = newDetail(key);
            onChange([
              ...value,
              key === "instructions" && isRecord(next)
                ? { ...next, step: value.length + 1 }
                : next,
            ]);
          }}
        >
          Add {label.toLowerCase()}
        </Button>
      </FieldGroup>
    );
  }
  if (isRecord(value)) {
    return (
      <FieldGroup>
        <h4>{label}</h4>
        {Object.entries(value)
          .filter(
            ([child]) =>
              (!["ingredientId", "source", "step"].includes(child) &&
                !(child === "ingredients" && path.includes("instructions"))) ||
              (child === "step" && path.includes("media"))
          )
          .map(([child, item]) => (
            <DetailControl
              key={child}
              path={`${path}.${child}`}
              label={detailLabels[child] ?? child}
              value={item}
              nullable={
                ![
                  "name",
                  "original",
                  "text",
                  "value",
                  "seconds",
                  "quantity",
                  "unit",
                  "type",
                  "role",
                  "kind",
                  "basis",
                  "amount",
                ].includes(child) ||
                ["max", "unit"].includes(child) ||
                (child === "quantity" && path.includes("ingredients"))
              }
              onChange={(next) => onChange({ ...value, [child]: next })}
            />
          ))}
        {nullable ? (
          <Button type="button" variant="ghost" onClick={() => onChange(null)}>
            Clear {label.toLowerCase()}
          </Button>
        ) : null}
      </FieldGroup>
    );
  }
  return (
    <PrimitiveDetailControl
      label={label}
      nullable={nullable}
      onChange={onChange}
      path={path}
      value={value}
    />
  );
};

export const RecipeDetailsForm = ({
  action,
  isBlocked,
  isPending,
  makeRequestId,
  submit,
}: {
  readonly action: ActiveReviewAction;
  readonly isBlocked: boolean;
  readonly isPending: boolean;
  readonly makeRequestId: () => string;
  readonly submit: (
    input: Parameters<RecipeImportOperations["answerAction"]>[0]
  ) => void;
}) => {
  const draft = JSON.stringify(action.review.recipe);
  const buildRequest = (encoded: string) => {
    const value = decodeEditorDraft(encoded);
    return decodeAnswer({
      answers: isRecord(value)
        ? action.review.editableFields
            .filter((field) => field !== "name" && field !== "tags")
            .map((field) => ({ field, value: value[field] }))
        : [],
      expectedActionVersion: action.actionVersion,
    });
  };
  const form = useForm({
    defaultValues: { draft },
    onSubmit: ({ value }) =>
      submit({
        actionId: action.id,
        idempotencyKey: idempotencyKey(makeRequestId),
        intentId: action.intentId,
        request: buildRequest(value.draft),
      }),
    validators: {
      onSubmit: ({ value }) => {
        try {
          buildRequest(value.draft);
          return null;
        } catch {
          return "Check the recipe details. Add source wording and names, use positive amounts and ascending ranges, and provide valid HTTPS links.";
        }
      },
    },
  });
  if (
    !action.review.editableFields.some(
      (field) => field !== "name" && field !== "tags"
    )
  ) {
    return null;
  }
  return (
    <details className="flex flex-col gap-4">
      <summary className="cursor-pointer py-3">Edit recipe details</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <fieldset
          disabled={isBlocked || isPending}
          className="flex flex-col gap-5"
        >
          <p className="text-muted-foreground text-sm">
            Keep the original wording. Add quantities and other details only
            when you can confirm them. Leave anything unknown as not provided.
          </p>
          <form.Field name="draft">
            {(field) => (
              <FieldGroup>
                {isRecord(decodeEditorDraft(field.state.value))
                  ? Object.entries(decodeEditorDraft(field.state.value))
                      .filter(
                        ([key]) =>
                          key !== "name" &&
                          action.review.editableFields.some(
                            (editable) => editable === key
                          )
                      )
                      .map(([key, value]) => (
                        <details key={key}>
                          <summary className="cursor-pointer py-3">
                            {detailLabels[key] ?? key}
                          </summary>
                          <DetailControl
                            path={`${action.id}.${key}`}
                            label={detailLabels[key] ?? key}
                            value={value}
                            nullable={[
                              "author",
                              "servings",
                              "nutrition",
                              "language",
                              "description",
                            ].includes(key)}
                            onChange={(next) => {
                              if (
                                isRecord(decodeEditorDraft(field.state.value))
                              ) {
                                field.handleChange(
                                  JSON.stringify({
                                    ...decodeEditorDraft(field.state.value),
                                    [key]: next,
                                  })
                                );
                              }
                            }}
                          />
                        </details>
                      ))
                  : null}
              </FieldGroup>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.errors}>
            {(errors) =>
              errors.length > 0 ? (
                <p role="alert" className="text-destructive">
                  {errors.join(" ")}
                </p>
              ) : null
            }
          </form.Subscribe>
          <PendingButton
            disabled={isPending}
            pending={isPending}
            pendingLabel="Saving recipe details…"
            type="submit"
          >
            Save recipe details
          </PendingButton>
        </fieldset>
      </form>
    </details>
  );
};
