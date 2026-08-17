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

import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import { Separator } from "../../components/ui/separator.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { recipeImportIntentRedirectSearch } from "./navigation.js";
import type { RecipeImportOperations } from "./operations.js";
import {
  makeRecipeImportProfileSession,
  recipeImportQueryKeys,
} from "./profile-query-isolation.js";
import { RecipeImportProfileAlias } from "./profiles.js";
import type {
  RecipeImportProfileAlias as RecipeImportProfileAliasType,
  RecipeImportPublicProfile,
} from "./profiles.js";

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

export const RecipeImportPage = ({
  initialIntentId,
  makeRequestId = () => crypto.randomUUID(),
  onProfileChange,
  operations,
  pollIntervalMs = 650,
  profileAlias,
  profiles,
}: {
  readonly initialIntentId?: RecipeImportIntentId;
  readonly makeRequestId?: () => string;
  readonly onProfileChange: (
    profileAlias: RecipeImportProfileAliasType
  ) => Promise<void>;
  readonly operations: RecipeImportOperations;
  readonly pollIntervalMs?: number;
  readonly profileAlias: RecipeImportProfileAliasType;
  readonly profiles: readonly RecipeImportPublicProfile[];
}) => {
  const queryClient = useQueryClient();
  const profileSession = useMemo(
    () => makeRecipeImportProfileSession(),
    [profileAlias]
  );
  useEffect(() => {
    profileSession.mount();
    return profileSession.unmount;
  }, [profileSession]);
  const changeProfile = async (nextAlias: RecipeImportProfileAliasType) => {
    if (nextAlias === profileAlias) {
      return;
    }
    profileSession.beginSwitch();
    try {
      await onProfileChange(nextAlias);
    } catch {
      profileSession.recover();
    }
  };
  const activeProfile = profiles.find(
    (profile) => profile.alias === profileAlias
  );
  if (activeProfile === undefined) {
    throw new Error("Recipe import profile is unavailable.");
  }
  const createMutation = useMutation({
    mutationFn: operations.create,
    retry: false,
  });
  const createdIntent = profileSession.isActive()
    ? createMutation.data
    : undefined;
  const activeIntentId = createdIntent?.id ?? initialIntentId;
  const intentQuery = useQuery({
    enabled: activeIntentId !== undefined,
    initialData: createdIntent,
    queryFn:
      activeIntentId === undefined
        ? skipToken
        : () => operations.getIntent({ intentId: activeIntentId }),
    queryKey: recipeImportQueryKeys.intent(profileAlias, activeIntentId),
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
      profileAlias,
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
    queryKey: recipeImportQueryKeys.recipe(profileAlias, recipeId),
    retry: false,
  });
  const confirmMutation = useMutation({
    mutationFn: operations.confirmAction,
    onSuccess: (succeeded) => {
      if (!profileSession.isActive()) {
        return;
      }
      queryClient.setQueryData(
        recipeImportQueryKeys.intent(profileAlias, succeeded.id),
        succeeded
      );
      return queryClient.invalidateQueries({
        queryKey: recipeImportQueryKeys.actions(profileAlias, succeeded.id),
      });
    },
    retry: false,
  });
  const answerMutation = useMutation({
    mutationFn: operations.answerAction,
    onSuccess: (updated) => {
      if (!profileSession.isActive()) {
        return;
      }
      queryClient.setQueryData(
        recipeImportQueryKeys.intent(profileAlias, updated.id),
        updated
      );
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: recipeImportQueryKeys.intent(profileAlias, updated.id),
        }),
        queryClient.invalidateQueries({
          queryKey: recipeImportQueryKeys.actions(profileAlias, updated.id),
        }),
      ]);
    },
    retry: false,
  });
  const cancelMutation = useMutation({
    mutationFn: operations.cancel,
    onSuccess: (cancelled) => {
      if (!profileSession.isActive()) {
        return;
      }
      return queryClient.setQueryData(
        recipeImportQueryKeys.intent(profileAlias, cancelled.id),
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
    profileSession.isActive() &&
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
        <div className="profile-control">
          <Label className="profile-label" htmlFor="recipe-import-profile">
            Household
          </Label>
          <select
            aria-describedby="active-recipe-import-profile"
            className="profile-select"
            id="recipe-import-profile"
            onChange={(event) => {
              const nextAlias = Schema.decodeUnknownSync(
                RecipeImportProfileAlias
              )(event.target.value);
              void changeProfile(nextAlias);
            }}
            value={profileAlias}
          >
            {profiles.map((profile) => (
              <option key={profile.alias} value={profile.alias}>
                {profile.label}
              </option>
            ))}
          </select>
          <span className="active-profile" id="active-recipe-import-profile">
            Viewing {activeProfile.label}
          </span>
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
                      profileAlias,
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
