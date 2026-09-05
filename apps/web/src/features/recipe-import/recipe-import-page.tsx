import {
  PlanningDietaryFit,
  PlanningDifficulty,
  PlanningLeftovers,
  PlanningMealType,
  PlanningTotalTimeBand,
} from "@meal-planner/recipe-domain";
import {
  AnswerReviewRecipeActionRequest,
  IdempotencyKey,
  RecipeReviewAnswer,
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
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import { Separator } from "../../components/ui/separator.js";
import { Skeleton } from "../../components/ui/skeleton.js";
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
const nameValidator = Schema.toStandardSchemaV1(
  RecipeReviewAnswer.members[0].fields.value
);
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
      <Button disabled={isPending} type="submit">
        Save recipe name
      </Button>
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
      cuisine: tags?.cuisines.join(", ") ?? action.review.recipe.cuisine ?? "",
      dietaryFit: tags?.dietaryFit ?? ("household_match" as const),
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
              dietaryFit: value.dietaryFit,
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
        <form.Field name="dietaryFit">
          {(field) => (
            <PlanningTagSelect
              id={`dietaryFit-${action.id}`}
              label="Dietary fit"
              name={field.name}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              schema={PlanningDietaryFit}
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
          <Button
            disabled={!canSubmit || cuisine.trim().length === 0 || isPending}
            type="submit"
          >
            Save planning tags
          </Button>
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
                  <Button
                    disabled={!canSubmit || isSubmitting || isPending}
                    type="submit"
                  >
                    Import recipe
                  </Button>
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
        <Button
          disabled={isCancelling}
          onClick={() =>
            cancel({
              idempotencyKey: idempotencyKey(makeRequestId),
              intentId: intent.id,
              request: { expectedIntentVersion: intent.intentVersion },
            })
          }
        >
          Cancel import
        </Button>
      ) : null}
      <Skeleton className="skeleton-line" />
      <Skeleton className="skeleton-line short" />
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
    {action.review.recipe.ingredientLines === null ? null : (
      <section aria-labelledby="ingredients-title">
        <h3 id="ingredients-title">Ingredients</h3>
        <ul>
          {action.review.recipe.ingredientLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    )}
    {action.review.recipe.instructions === null ? null : (
      <section aria-labelledby="method-title">
        <h3 id="method-title">Method</h3>
        <ol>
          {action.review.recipe.instructions.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
    )}
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
      <Button
        disabled={isConfirming}
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
      </Button>
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
        <Skeleton className="skeleton-title" />
        <Skeleton className="skeleton-line" />
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
                <Skeleton className="skeleton-title" />
                <Skeleton className="skeleton-line" />
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
