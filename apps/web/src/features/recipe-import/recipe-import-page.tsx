import {
  RecipeText,
  formatRecipeIngredient,
  recipeIngredientFromText,
  recipeInstructionFromText,
  PlanningDifficulty,
  PlanningLeftovers,
  PlanningMealType,
  PlanningTotalTimeBand,
} from "@meal-planner/recipe-domain";
import type { RecipeDraftContent } from "@meal-planner/recipe-domain";
import {
  AnswerReviewRecipeActionRequest,
  IdempotencyKey,
  SourceUrl,
} from "@meal-planner/recipe-import-api";
import type {
  Recipe,
  RecipeImportAction,
  RecipeImportIntent,
  RecipeImportIntentId,
  SourceUrl as RecipeSourceUrl,
} from "@meal-planner/recipe-import-api";
import { useForm } from "@tanstack/react-form";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Schema } from "effect";
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import { PendingButton } from "../../components/ui/pending-button.js";
import { Separator } from "../../components/ui/separator.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Textarea } from "../../components/ui/textarea.js";
import { recipeImportQueryKeys } from "./household-query-isolation.js";
import type { RecipeImportOperations } from "./operations.js";

type ActiveReviewAction = Extract<
  RecipeImportAction,
  { readonly status: "active" }
>;

const stageLabels = {
  acquiring_media: "Getting the source",
  analyzing_evidence: "Reading recipe details",
  extracting_recipe: "Extracting the recipe",
  finalizing_recipe: "Saving the recipe",
  grounding_recipe: "Checking the recipe details",
  preparing_review: "Preparing your review",
  resolving_source: "Resolving the link",
} as const;

const sourceUrlValidator = Schema.toStandardSchemaV1(SourceUrl);
const nameValidator = Schema.toStandardSchemaV1(RecipeText);
const decodeSourceUrl = Schema.decodeUnknownSync(SourceUrl);
const decodeAnswer = Schema.decodeUnknownSync(AnswerReviewRecipeActionRequest);
const decodeIdempotencyKey = Schema.decodeUnknownSync(IdempotencyKey);

const idempotencyKey = (makeRequestId: () => string) =>
  decodeIdempotencyKey(makeRequestId());

const planningTagLabels = {
  "30_to_60_minutes": "30 to 60 minutes",
  breakfast: "Breakfast",
  dessert: "Dessert",
  dinner: "Dinner",
  easy: "Easy",
  hard: "Hard",
  household_match: "Household match",
  lunch: "Lunch",
  medium: "Medium",
  needs_adaptation: "Needs adaptation",
  none: "None",
  not_suitable: "Not suitable",
  one_meal: "One meal",
  over_60_minutes: "Over 60 minutes",
  snack: "Snack",
  two_plus_meals: "Two or more meals",
  under_30_minutes: "Under 30 minutes",
  unknown: "Unknown",
} as const;

const PlanningTagSelect = <T extends keyof typeof planningTagLabels>({
  id,
  label,
  name,
  onBlur,
  onChange,
  schema,
  value,
}: {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly onBlur: () => void;
  readonly onChange: (value: T) => void;
  readonly schema: Schema.Literals<readonly T[]>;
  readonly value: T;
}) => (
  <div className="field-stack">
    <Label htmlFor={id}>{label}</Label>
    <select
      className="field-select"
      id={id}
      name={name}
      onBlur={onBlur}
      onChange={(event) =>
        onChange(Schema.decodeUnknownSync(schema)(event.target.value))
      }
      value={value}
    >
      {schema.literals.map((option) => (
        <option key={option} value={option}>
          {planningTagLabels[option]}
        </option>
      ))}
    </select>
  </div>
);

const NameAnswerForm = ({
  action,
  isPending,
  makeRequestId,
  submit,
}: {
  readonly action: ActiveReviewAction;
  readonly isPending: boolean;
  readonly makeRequestId: () => string;
  readonly submit: (
    input: Parameters<RecipeImportOperations["answerAction"]>[0]
  ) => void;
}) => {
  const form = useForm({
    defaultValues: { name: action.review.recipe.name ?? "" },
    onSubmit: ({ value }) => {
      const request = decodeAnswer({
        answers: [{ field: "name", value: value.name }],
        expectedActionVersion: action.actionVersion,
      });
      submit({
        actionId: action.id,
        idempotencyKey: idempotencyKey(makeRequestId),
        intentId: action.intentId,
        request,
      });
    },
  });

  return (
    <form
      className="field-stack"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="name"
        validators={{
          onBlur: nameValidator,
        }}
      >
        {(field) => (
          <>
            <Label htmlFor={`${field.name}-${action.id}`}>Recipe name</Label>
            <Input
              aria-describedby={`${field.name}-${action.id}-error`}
              aria-invalid={field.state.meta.errors.length > 0}
              id={`${field.name}-${action.id}`}
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              value={field.state.value}
            />
            <p className="field-error" id={`${field.name}-${action.id}-error`}>
              {field.state.meta.errors.length > 0
                ? "Enter a recipe name."
                : null}
            </p>
          </>
        )}
      </form.Field>
      <PendingButton
        disabled={isPending}
        pending={isPending}
        pendingLabel="Saving recipe name…"
        type="submit"
      >
        Save recipe name
      </PendingButton>
    </form>
  );
};

const TagsAnswerForm = ({
  action,
  isPending,
  makeRequestId,
  submit,
}: {
  readonly action: ActiveReviewAction;
  readonly isPending: boolean;
  readonly makeRequestId: () => string;
  readonly submit: (
    input: Parameters<RecipeImportOperations["answerAction"]>[0]
  ) => void;
}) => {
  const { tags } = action.review;
  const form = useForm({
    defaultValues: {
      cuisine:
        tags?.cuisines.join(", ") ?? action.review.recipe.cuisines.join(", "),
      difficulty: tags?.difficulty ?? ("easy" as const),
      leftovers: tags?.leftovers ?? ("one_meal" as const),
      mealType: tags?.mealTypes[0] ?? ("dinner" as const),
      totalTimeBand: tags?.totalTimeBand ?? ("30_to_60_minutes" as const),
    },
    onSubmit: ({ value }) => {
      const request = decodeAnswer({
        answers: [
          {
            field: "tags",
            value: {
              cuisines: [value.cuisine.trim()],
              difficulty: value.difficulty,
              leftovers: value.leftovers,
              mealTypes: [value.mealType],
              totalTimeBand: value.totalTimeBand,
            },
          },
        ],
        expectedActionVersion: action.actionVersion,
      });
      submit({
        actionId: action.id,
        idempotencyKey: idempotencyKey(makeRequestId),
        intentId: action.intentId,
        request,
      });
    },
  });

  return (
    <form
      className="field-stack planning-tags-form"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <h3>Planning tags</h3>
      <form.Field name="cuisine">
        {(field) => (
          <div className="field-stack">
            <Label htmlFor={`cuisine-${action.id}`}>Cuisine</Label>
            <Input
              id={`cuisine-${action.id}`}
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>
      <div className="planning-tags-grid">
        <form.Field name="mealType">
          {(field) => (
            <PlanningTagSelect
              id={`mealType-${action.id}`}
              label="Meal type"
              name={field.name}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              schema={PlanningMealType}
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="difficulty">
          {(field) => (
            <PlanningTagSelect
              id={`difficulty-${action.id}`}
              label="Difficulty"
              name={field.name}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              schema={PlanningDifficulty}
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="leftovers">
          {(field) => (
            <PlanningTagSelect
              id={`leftovers-${action.id}`}
              label="Leftovers"
              name={field.name}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              schema={PlanningLeftovers}
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="totalTimeBand">
          {(field) => (
            <PlanningTagSelect
              id={`totalTimeBand-${action.id}`}
              label="Total time"
              name={field.name}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              schema={PlanningTotalTimeBand}
              value={field.state.value}
            />
          )}
        </form.Field>
      </div>
      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          cuisine: state.values.cuisine,
        })}
      >
        {({ canSubmit, cuisine }) => (
          <PendingButton
            disabled={!canSubmit || cuisine.trim().length === 0 || isPending}
            pending={isPending}
            pendingLabel="Saving planning tags…"
            type="submit"
          >
            Save planning tags
          </PendingButton>
        )}
      </form.Subscribe>
    </form>
  );
};

const ImportRecipeForm = ({
  isPending,
  submit,
}: {
  readonly isPending: boolean;
  readonly submit: (sourceUrl: RecipeSourceUrl) => void;
}) => {
  const form = useForm({
    defaultValues: { sourceUrl: "" },
    onSubmit: ({ value }) => {
      submit(decodeSourceUrl(value.sourceUrl));
    },
  });

  return (
    <form
      className="import-form"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="sourceUrl" validators={{ onBlur: sourceUrlValidator }}>
        {(field) => (
          <div className="field-stack">
            <Label htmlFor={field.name}>Recipe link</Label>
            <div className="input-row">
              <Input
                aria-describedby={`${field.name}-help ${field.name}-error`}
                aria-invalid={field.state.meta.errors.length > 0}
                autoComplete="url"
                id={field.name}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="https://www.tiktok.com/@cook/video/…"
                type="url"
                value={field.state.value}
              />
              <form.Subscribe
                selector={(state) => ({
                  canSubmit: state.canSubmit,
                  isSubmitting: state.isSubmitting,
                })}
              >
                {({ canSubmit, isSubmitting }) => (
                  <PendingButton
                    disabled={!canSubmit || isSubmitting || isPending}
                    pending={isPending}
                    pendingLabel="Starting import…"
                    type="submit"
                  >
                    Import recipe
                  </PendingButton>
                )}
              </form.Subscribe>
            </div>
            <p className="helper" id={`${field.name}-help`}>
              One link at a time.
            </p>
            <p className="field-error" id={`${field.name}-error`}>
              {field.state.meta.errors.length > 0
                ? "Enter an absolute HTTPS recipe link."
                : null}
            </p>
          </div>
        )}
      </form.Field>
    </form>
  );
};

const ProcessingStatus = ({
  cancel,
  isCancelling,
  isCreating,
  intent,
  makeRequestId,
}: {
  readonly cancel: (
    input: Parameters<RecipeImportOperations["cancel"]>[0]
  ) => void;
  readonly isCancelling: boolean;
  readonly isCreating: boolean;
  readonly intent: RecipeImportIntent | undefined;
  readonly makeRequestId: () => string;
}) => {
  if (!isCreating && intent?.status !== "processing") {
    return null;
  }

  return (
    <section aria-labelledby="working-title" className="processing-document">
      <p className="eyebrow">In progress</p>
      <h2 id="working-title">Working on your recipe</h2>
      <p className="status-line">
        {intent?.status === "processing"
          ? stageLabels[intent.processing.type]
          : "Creating your import"}
      </p>
      {intent?.status === "processing" ? (
        <PendingButton
          disabled={isCancelling}
          pending={isCancelling}
          pendingLabel="Cancelling import…"
          onClick={() =>
            cancel({
              idempotencyKey: idempotencyKey(makeRequestId),
              intentId: intent.id,
              request: { expectedIntentVersion: intent.intentVersion },
            })
          }
        >
          Cancel import
        </PendingButton>
      ) : null}
      <Skeleton variant="line" />
      <Skeleton variant="short-line" />
    </section>
  );
};

const IntentOutcome = ({
  intent,
}: {
  readonly intent: RecipeImportIntent | undefined;
}) => {
  if (intent?.status === "failed") {
    return (
      <Alert>
        <h2>This link couldn’t be imported</h2>
        <p>{intent.error.message}</p>
      </Alert>
    );
  }
  if (intent?.status === "cancelled") {
    return (
      <Alert>
        <h2>Import cancelled</h2>
        <p>This import was cancelled before a recipe was saved.</p>
      </Alert>
    );
  }
  if (intent?.status === "redirected") {
    return (
      <Alert>
        <h2>An existing import is already in progress</h2>
        <p>This request was redirected to the canonical import.</p>
        <Link from="/" search={{ intentId: intent.redirect.intentId }} to="/">
          View existing import
        </Link>
      </Alert>
    );
  }
  return null;
};

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

const RecipeDetailsForm = ({
  action,
  isPending,
  makeRequestId,
  submit,
}: {
  readonly action: ActiveReviewAction;
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
        <fieldset disabled={isPending} className="flex flex-col gap-5">
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

const durationText = (seconds: number) => {
  if (seconds % 60 === 0) {
    return `${seconds / 60} minutes`;
  }
  return `${seconds} seconds`;
};
const servingsText = (
  servings: NonNullable<RecipeDraftContent["servings"]>
) => {
  const amount =
    servings.max === null
      ? String(servings.quantity)
      : `${servings.quantity}–${servings.max}`;
  return `${amount} ${servings.unit ?? "(unit not provided)"}`;
};
const dietaryClaimText = (claim: RecipeDraftContent["dietary"][number]) => {
  if (claim.kind === "allergen") {
    return `Allergen: ${claim.name} — stated ${claim.value ? "present" : "absent"}`;
  }
  return `Diet: ${claim.name} — stated ${claim.value ? "yes" : "no"}`;
};
export const RecipeDetails = ({
  recipe,
}: {
  readonly recipe: RecipeDraftContent;
}) => (
  <div className="flex flex-col gap-5">
    {recipe.description ? <p>{recipe.description}</p> : null}
    {recipe.author ? <p>By {recipe.author.name}</p> : null}
    {recipe.servings === null ? (
      <p>Servings not provided</p>
    ) : (
      <div>
        <p>Yield: {servingsText(recipe.servings)}</p>
        {servingsText(recipe.servings) === recipe.servings.original ? null : (
          <p className="text-muted-foreground text-sm">
            Source: {recipe.servings.original}
          </p>
        )}
      </div>
    )}
    <dl className="flex flex-wrap gap-4">
      {Object.entries(recipe.times).map(([key, duration]) => (
        <div key={key}>
          <dt>{detailLabels[key]}</dt>
          <dd>
            {duration === null
              ? "Not provided"
              : durationText(duration.seconds)}
          </dd>
        </div>
      ))}
    </dl>
    <section aria-label="Ingredients">
      <h3>Ingredients</h3>
      {recipe.ingredients === null ? (
        <p>Ingredients not provided</p>
      ) : (
        recipe.ingredients.map((item, index, items) => (
          <div key={index}>
            {item.group !== null &&
            (index === 0 || items[index - 1]?.group !== item.group) ? (
              <h4>{item.group}</h4>
            ) : null}
            <p>
              {formatRecipeIngredient(item)}
              {item.optional === true ? " (optional)" : ""}
            </p>
            {formatRecipeIngredient(item) === item.original ? null : (
              <p className="text-muted-foreground text-sm">
                Source: {item.original}
              </p>
            )}
            {item.quantity === null ? (
              <p className="text-muted-foreground text-sm">
                Quantity not provided
              </p>
            ) : null}
            {item.note ? (
              <p className="text-muted-foreground text-sm">{item.note}</p>
            ) : null}
          </div>
        ))
      )}
    </section>
    <section aria-label="Method">
      <h3>Method</h3>
      {recipe.instructions === null ? (
        <p>Method not provided</p>
      ) : (
        recipe.instructions.map((item, index, items) => (
          <div key={item.step}>
            {item.group !== null &&
            (index === 0 || items[index - 1]?.group !== item.group) ? (
              <h4>{item.group}</h4>
            ) : null}
            <p>
              {item.step}. {item.text}
            </p>
            {item.duration !== null ||
            item.temperature !== null ||
            item.equipment.length > 0 ? (
              <p className="text-muted-foreground text-sm">
                {[
                  item.duration === null
                    ? null
                    : durationText(item.duration.seconds),
                  item.temperature === null
                    ? null
                    : `${item.temperature.value}°${item.temperature.unit}`,
                  ...item.equipment,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        ))
      )}
    </section>
    {recipe.equipment.length > 0 ? (
      <section>
        <h3>Equipment</h3>
        <p>{recipe.equipment.join(", ")}</p>
      </section>
    ) : null}
    {recipe.notes.length > 0 ? (
      <section>
        <h3>Notes</h3>
        {recipe.notes.map((note, index) => (
          <p key={index}>{note}</p>
        ))}
      </section>
    ) : null}
    {recipe.nutrition ? (
      <section>
        <h3>Nutrition</h3>
        <p>{recipe.nutrition.original}</p>
        <p>
          Per{" "}
          {recipe.nutrition.basis.type === "100g"
            ? "100 g"
            : recipe.nutrition.basis.type}
        </p>
        {recipe.nutrition.nutrients.map((nutrient) => (
          <p key={nutrient.name}>
            {nutrient.name}: {nutrient.amount.value} {nutrient.amount.unit}
          </p>
        ))}
      </section>
    ) : null}
    {recipe.dietary.length > 0 ? (
      <section>
        <h3>Source dietary claims</h3>
        {recipe.dietary.map((claim) => (
          <div key={`${claim.kind}:${claim.name}`}>
            <p>{dietaryClaimText(claim)}</p>
            <p className="text-muted-foreground text-sm">
              Source: {claim.original}
            </p>
          </div>
        ))}
      </section>
    ) : null}
    {recipe.media.length > 0 ? (
      <section>
        <h3>Recipe media</h3>
        {recipe.media.map((item) => (
          <p key={item.url}>
            <a href={item.url} rel="noreferrer" target="_blank">
              {item.caption ?? item.alt ?? `Source ${item.type}`}
            </a>
          </p>
        ))}
      </section>
    ) : null}
  </div>
);

const RecipeReview = ({
  action,
  answer,
  confirm,
  isAnswering,
  isConfirming,
  makeRequestId,
}: {
  readonly action: ActiveReviewAction;
  readonly answer: (
    input: Parameters<RecipeImportOperations["answerAction"]>[0]
  ) => void;
  readonly confirm: (
    input: Parameters<RecipeImportOperations["confirmAction"]>[0]
  ) => void;
  readonly isAnswering: boolean;
  readonly isConfirming: boolean;
  readonly makeRequestId: () => string;
}) => (
  <article className="review-document" aria-labelledby="review-title">
    <div className="review-heading">
      <div>
        <p className="eyebrow">Ready for your confirmation</p>
        <h2 id="review-title">Review recipe</h2>
      </div>
      <Badge>Version {action.actionVersion}</Badge>
    </div>
    <h3 className="recipe-name">
      {action.review.recipe.name ?? "Recipe ready to confirm"}
    </h3>
    <RecipeDetails recipe={action.review.recipe} />
    <RecipeDetailsForm
      key={`${action.id}:${action.actionVersion}:details`}
      action={action}
      isPending={isAnswering}
      makeRequestId={makeRequestId}
      submit={answer}
    />
    {action.review.editableFields.includes("name") ? (
      <NameAnswerForm
        action={action}
        isPending={isAnswering}
        key={`${action.id}:${action.actionVersion}`}
        makeRequestId={makeRequestId}
        submit={answer}
      />
    ) : null}
    {action.review.editableFields.includes("tags") ? (
      <TagsAnswerForm
        action={action}
        isPending={isAnswering}
        key={`${action.id}:${action.actionVersion}:tags`}
        makeRequestId={makeRequestId}
        submit={answer}
      />
    ) : null}
    <div className="approve-bar">
      <p>Confirm this recipe to save it.</p>
      <PendingButton
        disabled={isConfirming || isAnswering}
        pending={isConfirming}
        pendingLabel="Saving recipe…"
        onClick={() =>
          confirm({
            actionId: action.id,
            idempotencyKey: idempotencyKey(makeRequestId),
            intentId: action.intentId,
            request: { expectedActionVersion: action.actionVersion },
          })
        }
      >
        Confirm recipe
      </PendingButton>
    </div>
  </article>
);

const SavedRecipeStatus = ({
  hasRecipeError,
  intent,
  recipe,
}: {
  readonly hasRecipeError: boolean;
  readonly intent: RecipeImportIntent | undefined;
  readonly recipe: Recipe | undefined;
}) => {
  if (intent?.status === "succeeded" && recipe === undefined) {
    return hasRecipeError ? null : (
      <section aria-label="Loading saved recipe">
        <Skeleton variant="title" />
        <Skeleton variant="line" />
      </section>
    );
  }
  if (recipe === undefined) {
    return null;
  }
  return (
    <section className="success-document" aria-labelledby="success-title">
      <p className="eyebrow success">Complete</p>
      <h2 id="success-title">Recipe saved</h2>
      <p>Added to your recipe collection.</p>
      <RecipeDetails recipe={recipe.recipe} />
      <div className="saved-entry">
        <span>{recipe.recipe.name ?? "Recipe"}</span>
        <Badge>Saved</Badge>
      </div>
    </section>
  );
};

// eslint-disable-next-line complexity -- Keep query state and its rendering together instead of a forwarding component.
export const RecipeImportPage = ({
  householdDomainStatus,
  householdId,
  householdName,
  householdPeople,
  initialIntentId,
  makeRequestId = () => crypto.randomUUID(),
  onSignOut,
  operations,
  pollIntervalMs = 650,
}: {
  readonly householdDomainStatus?: ReactNode;
  readonly householdId: string;
  readonly householdName: string;
  readonly householdPeople?: ReactNode;
  readonly initialIntentId?: RecipeImportIntentId;
  readonly makeRequestId?: () => string;
  readonly onSignOut: () => Promise<void>;
  readonly operations: RecipeImportOperations;
  readonly pollIntervalMs?: number;
}) => {
  const queryClient = useQueryClient();
  const session = useMemo(() => ({ active: true }), [householdId]);
  useEffect(() => {
    session.active = true;
    return () => {
      session.active = false;
    };
  }, [session]);
  const createMutation = useMutation({
    mutationFn: operations.create,
    retry: false,
  });
  const createdIntent = session.active ? createMutation.data : undefined;
  const activeIntentId = createdIntent?.id ?? initialIntentId;
  const intentQuery = useQuery({
    enabled: activeIntentId !== undefined,
    initialData: createdIntent,
    queryFn:
      activeIntentId === undefined
        ? skipToken
        : () => operations.getIntent({ intentId: activeIntentId }),
    queryKey: recipeImportQueryKeys.intent(householdId, activeIntentId),
    refetchInterval: (query) =>
      query.state.data?.status === "processing" ? pollIntervalMs : false,
    retry: false,
  });
  const intent = intentQuery.data;
  const actionReference =
    intent?.status === "requires_action" ? intent.action : undefined;
  const actionIntentId = actionReference === undefined ? undefined : intent?.id;
  const actionQuery = useQuery({
    enabled: actionReference !== undefined,
    queryFn:
      actionReference === undefined || actionIntentId === undefined
        ? skipToken
        : () =>
            operations.getAction({
              actionId: actionReference.id,
              intentId: actionIntentId,
            }),
    queryKey: recipeImportQueryKeys.action(
      householdId,
      actionIntentId,
      actionReference?.id
    ),
    retry: false,
  });
  const recipeId =
    intent?.status === "succeeded" ? intent.result.recipeId : undefined;
  const recipeQuery = useQuery({
    enabled: recipeId !== undefined,
    queryFn:
      recipeId === undefined
        ? skipToken
        : () => operations.getRecipe({ recipeId }),
    queryKey: recipeImportQueryKeys.recipe(householdId, recipeId),
    retry: false,
  });
  const confirmMutation = useMutation({
    mutationFn: operations.confirmAction,
    onSuccess: (succeeded) => {
      if (!session.active) {
        return;
      }
      queryClient.setQueryData(
        recipeImportQueryKeys.intent(householdId, succeeded.id),
        succeeded
      );
      return queryClient.invalidateQueries({
        queryKey: recipeImportQueryKeys.actions(householdId, succeeded.id),
      });
    },
    retry: false,
  });
  const answerMutation = useMutation({
    mutationFn: operations.answerAction,
    onSuccess: (updated) => {
      if (!session.active) {
        return;
      }
      queryClient.setQueryData(
        recipeImportQueryKeys.intent(householdId, updated.id),
        updated
      );
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: recipeImportQueryKeys.intent(householdId, updated.id),
        }),
        queryClient.invalidateQueries({
          queryKey: recipeImportQueryKeys.actions(householdId, updated.id),
        }),
      ]);
    },
    retry: false,
  });
  const cancelMutation = useMutation({
    mutationFn: operations.cancel,
    onSuccess: (cancelled) => {
      if (!session.active) {
        return;
      }
      return queryClient.setQueryData(
        recipeImportQueryKeys.intent(householdId, cancelled.id),
        cancelled
      );
    },
    retry: false,
  });

  const hasRequestFailure =
    session.active &&
    (actionQuery.isError ||
      answerMutation.isError ||
      cancelMutation.isError ||
      confirmMutation.isError ||
      createMutation.isError ||
      intentQuery.isError ||
      recipeQuery.isError);
  const action = actionQuery.data;
  const recipe = recipeQuery.data;

  return (
    <main className="app-shell">
      <header className="topbar">
        <span className="wordmark">Meal Planner</span>
        <div className="session-control">
          {householdDomainStatus}
          <span className="active-household">{householdName}</span>
          <Button
            onClick={() => {
              void onSignOut();
            }}
            type="button"
          >
            Log out
          </Button>
        </div>
      </header>

      <div className="workspace">
        <section className="reading-area" aria-labelledby="page-title">
          <div className="intro">
            <p className="eyebrow">Recipe import</p>
            <h1 id="page-title">Import a recipe</h1>
            <p className="lede">
              Paste one public TikTok recipe or video link. We’ll prepare it for
              your confirmation before it is saved.
            </p>
          </div>

          <ImportRecipeForm
            isPending={createMutation.isPending}
            submit={(sourceUrl) =>
              createMutation.mutate({
                idempotencyKey: idempotencyKey(makeRequestId),
                request: { source: { kind: "tiktok", url: sourceUrl } },
              })
            }
          />

          <Separator />

          <div aria-live="polite" className="flow-region">
            <ProcessingStatus
              cancel={cancelMutation.mutate}
              intent={intent}
              isCancelling={cancelMutation.isPending}
              isCreating={createMutation.isPending}
              makeRequestId={makeRequestId}
            />
            {hasRequestFailure ? (
              <Alert>
                <h2>This import couldn’t be completed</h2>
                <p>Please try again later.</p>
              </Alert>
            ) : null}
            <IntentOutcome intent={intent} />
            {intent?.status === "requires_action" &&
            action === undefined &&
            !actionQuery.isError ? (
              <section aria-label="Loading recipe review">
                <Skeleton variant="title" />
                <Skeleton variant="line" />
              </section>
            ) : null}
            {intent?.status === "requires_action" &&
            action?.status === "active" ? (
              <RecipeReview
                action={action}
                answer={answerMutation.mutate}
                confirm={confirmMutation.mutate}
                isAnswering={answerMutation.isPending}
                isConfirming={confirmMutation.isPending}
                makeRequestId={makeRequestId}
              />
            ) : null}
            <SavedRecipeStatus
              hasRecipeError={recipeQuery.isError}
              intent={intent}
              recipe={recipe}
            />
          </div>
        </section>
        {householdPeople}
      </div>
    </main>
  );
};
