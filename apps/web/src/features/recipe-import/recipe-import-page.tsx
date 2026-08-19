import {
  AnswerReviewRecipeActionRequest,
  IdempotencyKey,
  SourceUrl,
} from "@meal-planner/recipe-import-api";
import type {
  RecipeImportAction,
  RecipeImportIntentId,
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
import { recipeImportIntentRedirectSearch } from "./navigation.js";
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

const sourceUrlMessage = (value: string) => {
  let message: string | undefined;
  try {
    Schema.decodeUnknownSync(SourceUrl)(value);
  } catch {
    message = "Enter an absolute HTTPS recipe link.";
  }
  return message;
};

const idempotencyKey = (makeRequestId: () => string) =>
  Schema.decodeUnknownSync(IdempotencyKey)(makeRequestId());

const nameAnswerMessage = (
  value: string,
  actionVersion: ActiveReviewAction["actionVersion"]
) => {
  let message: string | undefined;
  try {
    Schema.decodeUnknownSync(AnswerReviewRecipeActionRequest)({
      answers: [{ field: "name", value }],
      expectedActionVersion: actionVersion,
    });
  } catch {
    message = "Enter a recipe name.";
  }
  return message;
};

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
      const request = Schema.decodeUnknownSync(AnswerReviewRecipeActionRequest)(
        {
          answers: [{ field: "name", value: value.name }],
          expectedActionVersion: action.actionVersion,
        }
      );
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
          onBlur: ({ value }) => nameAnswerMessage(value, action.actionVersion),
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
              {field.state.meta.errors.filter(Boolean).join(" ")}
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
      const request = Schema.decodeUnknownSync(AnswerReviewRecipeActionRequest)(
        {
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
        }
      );
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
            <div className="field-stack">
              <Label htmlFor={`mealType-${action.id}`}>Meal type</Label>
              <select
                className="field-select"
                id={`mealType-${action.id}`}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.target.value as typeof field.state.value
                  )
                }
                value={field.state.value}
              >
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
                <option value="snack">Snack</option>
                <option value="dessert">Dessert</option>
              </select>
            </div>
          )}
        </form.Field>
        <form.Field name="dietaryFit">
          {(field) => (
            <div className="field-stack">
              <Label htmlFor={`dietaryFit-${action.id}`}>Dietary fit</Label>
              <select
                className="field-select"
                id={`dietaryFit-${action.id}`}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.target.value as typeof field.state.value
                  )
                }
                value={field.state.value}
              >
                <option value="household_match">Household match</option>
                <option value="needs_adaptation">Needs adaptation</option>
                <option value="not_suitable">Not suitable</option>
              </select>
            </div>
          )}
        </form.Field>
        <form.Field name="difficulty">
          {(field) => (
            <div className="field-stack">
              <Label htmlFor={`difficulty-${action.id}`}>Difficulty</Label>
              <select
                className="field-select"
                id={`difficulty-${action.id}`}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.target.value as typeof field.state.value
                  )
                }
                value={field.state.value}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          )}
        </form.Field>
        <form.Field name="leftovers">
          {(field) => (
            <div className="field-stack">
              <Label htmlFor={`leftovers-${action.id}`}>Leftovers</Label>
              <select
                className="field-select"
                id={`leftovers-${action.id}`}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.target.value as typeof field.state.value
                  )
                }
                value={field.state.value}
              >
                <option value="none">None</option>
                <option value="one_meal">One meal</option>
                <option value="two_plus_meals">Two or more meals</option>
              </select>
            </div>
          )}
        </form.Field>
        <form.Field name="totalTimeBand">
          {(field) => (
            <div className="field-stack">
              <Label htmlFor={`totalTimeBand-${action.id}`}>Total time</Label>
              <select
                className="field-select"
                id={`totalTimeBand-${action.id}`}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.target.value as typeof field.state.value
                  )
                }
                value={field.state.value}
              >
                <option value="under_30_minutes">Under 30 minutes</option>
                <option value="30_to_60_minutes">30 to 60 minutes</option>
                <option value="over_60_minutes">Over 60 minutes</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
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

export const RecipeImportPage = ({
  householdDomainStatus,
  householdId,
  householdName,
  initialIntentId,
  makeRequestId = () => crypto.randomUUID(),
  onSignOut,
  operations,
  pollIntervalMs = 650,
}: {
  readonly householdDomainStatus?: ReactNode;
  readonly householdId: string;
  readonly householdName: string;
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

  const form = useForm({
    defaultValues: { sourceUrl: "" },
    onSubmit: ({ value }) => {
      const sourceUrl = Schema.decodeUnknownSync(SourceUrl)(value.sourceUrl);
      createMutation.mutate({
        idempotencyKey: idempotencyKey(makeRequestId),
        request: { source: { kind: "tiktok", url: sourceUrl } },
      });
    },
  });

  const hasRequestFailure =
    session.active &&
    (createMutation.isError ||
      intentQuery.isError ||
      actionQuery.isError ||
      answerMutation.isError ||
      confirmMutation.isError ||
      cancelMutation.isError ||
      recipeQuery.isError);
  const isProcessing = intent?.status === "processing";
  const isCancelled = intent?.status === "cancelled";
  const isFailed = intent?.status === "failed";
  const isRedirected = intent?.status === "redirected";
  const action = actionQuery.data;
  const recipe = recipeQuery.data;

  return (
    <main className="app-shell">
      <header className="topbar">
        <span className="wordmark">Meal Planner</span>
        <div className="session-control">
          {householdDomainStatus}
          <span className="active-household">{householdName}</span>
          <Button onClick={() => void onSignOut()} type="button">
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

          <form
            className="import-form"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <form.Field
              name="sourceUrl"
              validators={{ onBlur: ({ value }) => sourceUrlMessage(value) }}
            >
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
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
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
                          disabled={
                            !canSubmit ||
                            isSubmitting ||
                            createMutation.isPending
                          }
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
                    {field.state.meta.errors.filter(Boolean).join(" ")}
                  </p>
                </div>
              )}
            </form.Field>
          </form>

          <Separator />

          <div aria-live="polite" className="flow-region">
            {(createMutation.isPending || isProcessing) && (
              <section
                aria-labelledby="working-title"
                className="processing-document"
              >
                <p className="eyebrow">In progress</p>
                <h2 id="working-title">Working on your recipe</h2>
                <p className="status-line">
                  {intent?.status === "processing"
                    ? stageLabels[intent.processing.type]
                    : "Creating your import"}
                </p>
                {intent?.status === "processing" && (
                  <Button
                    disabled={cancelMutation.isPending}
                    onClick={() =>
                      cancelMutation.mutate({
                        idempotencyKey: idempotencyKey(makeRequestId),
                        intentId: intent.id,
                        request: {
                          expectedIntentVersion: intent.intentVersion,
                        },
                      })
                    }
                  >
                    Cancel import
                  </Button>
                )}
                <Skeleton className="skeleton-line" />
                <Skeleton className="skeleton-line short" />
              </section>
            )}

            {hasRequestFailure && (
              <Alert>
                <h2>This import couldn’t be completed</h2>
                <p>Please try again later.</p>
              </Alert>
            )}

            {isFailed && (
              <Alert>
                <h2>This link couldn’t be imported</h2>
                <p>{intent.error.message}</p>
              </Alert>
            )}

            {isCancelled && (
              <Alert>
                <h2>Import cancelled</h2>
                <p>This import was cancelled before a recipe was saved.</p>
              </Alert>
            )}

            {isRedirected && (
              <Alert>
                <h2>An existing import is already in progress</h2>
                <p>This request was redirected to the canonical import.</p>
                <Link
                  from="/"
                  search={(previous) =>
                    recipeImportIntentRedirectSearch(
                      previous,
                      intent.redirect.intentId
                    )
                  }
                  to="/"
                >
                  View existing import
                </Link>
              </Alert>
            )}

            {actionReference !== undefined &&
              action === undefined &&
              !actionQuery.isError && (
                <section aria-label="Loading recipe review">
                  <Skeleton className="skeleton-title" />
                  <Skeleton className="skeleton-line" />
                </section>
              )}

            {action?.status === "active" && (
              <article
                className="review-document"
                aria-labelledby="review-title"
              >
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
                {action.review.recipe.ingredientLines !== null && (
                  <section aria-labelledby="ingredients-title">
                    <h3 id="ingredients-title">Ingredients</h3>
                    <ul>
                      {action.review.recipe.ingredientLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {action.review.recipe.instructions !== null && (
                  <section aria-labelledby="method-title">
                    <h3 id="method-title">Method</h3>
                    <ol>
                      {action.review.recipe.instructions.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </section>
                )}
                {action.review.editableFields.includes("name") && (
                  <NameAnswerForm
                    action={action}
                    isPending={answerMutation.isPending}
                    key={`${action.id}:${action.actionVersion}`}
                    makeRequestId={makeRequestId}
                    submit={answerMutation.mutate}
                  />
                )}
                {action.review.editableFields.includes("tags") && (
                  <TagsAnswerForm
                    action={action}
                    isPending={answerMutation.isPending}
                    key={`${action.id}:${action.actionVersion}:tags`}
                    makeRequestId={makeRequestId}
                    submit={answerMutation.mutate}
                  />
                )}
                <div className="approve-bar">
                  <p>Confirm this recipe to save it.</p>
                  <Button
                    disabled={confirmMutation.isPending}
                    onClick={() =>
                      confirmMutation.mutate({
                        actionId: action.id,
                        idempotencyKey: idempotencyKey(makeRequestId),
                        intentId: action.intentId,
                        request: {
                          expectedActionVersion: action.actionVersion,
                        },
                      })
                    }
                  >
                    Confirm recipe
                  </Button>
                </div>
              </article>
            )}

            {intent?.status === "succeeded" &&
              recipe === undefined &&
              !recipeQuery.isError && (
                <section aria-label="Loading saved recipe">
                  <Skeleton className="skeleton-title" />
                  <Skeleton className="skeleton-line" />
                </section>
              )}

            {recipe !== undefined && (
              <section
                className="success-document"
                aria-labelledby="success-title"
              >
                <p className="eyebrow success">Complete</p>
                <h2 id="success-title">Recipe saved</h2>
                <p>Added to your recipe collection.</p>
                <div className="saved-entry">
                  <span>{recipe.recipe.name ?? "Recipe"}</span>
                  <Badge>Saved</Badge>
                </div>
              </section>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};
