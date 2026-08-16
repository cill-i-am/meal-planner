import { useForm } from "@tanstack/react-form";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Schema } from "effect";

import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import { Separator } from "../../components/ui/separator.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import {
  ApproveRecipeInput,
  ImportIdentityInput,
  RecipeBankInput,
  SubmitImportInput,
  TikTokRecipeUrl,
  isTerminalImportStatus,
} from "./contracts.js";
import type {
  ImportStatusView,
  OperationResult,
  RecipeImportOperations,
  SafeFailure,
} from "./contracts.js";

const stages = [
  "Waiting to begin",
  "Getting the source",
  "Reading spoken recipe details",
  "Reading on-screen recipe details",
  "Draft ready to check",
] as const;

const statusLabels = {
  acquired: "Getting the source",
  acquiring: "Getting the source",
  extracting_visual: "Reading on-screen recipe details",
  failed: "Import stopped",
  needs_review: "Draft ready to check",
  queued: "Waiting to begin",
  transcribed: "Reading spoken recipe details",
  transcribing: "Reading spoken recipe details",
  unsupported: "Import stopped",
  visual_evidence_empty: "Reading on-screen recipe details",
  visual_evidence_found: "Reading on-screen recipe details",
  visual_evidence_low_confidence: "Reading on-screen recipe details",
} satisfies Record<
  ImportStatusView["kind"],
  (typeof stages)[number] | "Import stopped"
>;

const urlMessage = (value: string) => {
  let message: string | undefined;
  try {
    Schema.decodeUnknownSync(TikTokRecipeUrl)(value);
  } catch {
    message = "Enter a public TikTok HTTPS link.";
  }
  return message;
};

const failureFrom = <A,>(result: OperationResult<A> | undefined) =>
  result?.ok === false ? result.error : undefined;

export const RecipeImportPage = ({
  makeRequestId = () => crypto.randomUUID(),
  operations,
  pollIntervalMs = 650,
}: {
  readonly makeRequestId?: () => string;
  readonly operations: RecipeImportOperations;
  readonly pollIntervalMs?: number;
}) => {
  const queryClient = useQueryClient();
  const submitMutation = useMutation({
    mutationFn: operations.submit,
    retry: false,
  });

  const form = useForm({
    defaultValues: { sourceUrl: "" },
    onSubmit: ({ value }) => {
      const input = Schema.decodeUnknownSync(SubmitImportInput)({
        idempotencyKey: makeRequestId(),
        sourceUrl: value.sourceUrl,
      });
      submitMutation.mutate(input);
    },
  });

  const submitted = submitMutation.data?.ok
    ? submitMutation.data.value
    : undefined;
  const sourceUrl = submitMutation.variables?.sourceUrl;
  const statusQuery = useQuery({
    enabled: submitted !== undefined,
    initialData:
      submitted === undefined
        ? undefined
        : { ok: true as const, value: submitted },
    queryFn: () =>
      operations.poll(
        Schema.decodeUnknownSync(ImportIdentityInput)({
          importId: submitted?.importId,
        })
      ),
    queryKey: ["recipe-import", submitted?.importId, "status"],
    refetchInterval: (query) => {
      const result = query.state.data;
      return result?.ok === true && !isTerminalImportStatus(result.value.status)
        ? pollIntervalMs
        : false;
    },
    retry: false,
  });

  const progress = statusQuery.data?.ok ? statusQuery.data.value : submitted;
  const draftId =
    progress?.status.kind === "needs_review" ? progress.draftId : undefined;
  const reviewQuery = useQuery({
    enabled: draftId !== undefined,
    queryFn:
      draftId === undefined
        ? skipToken
        : () => operations.loadReview({ draftId }),
    queryKey: ["recipe-import", draftId, "review"],
    retry: false,
  });
  const review = reviewQuery.data?.ok ? reviewQuery.data.value : undefined;

  const approvalMutation = useMutation({
    mutationFn: operations.approve,
    onSuccess: async (result) => {
      if (result.ok && sourceUrl !== undefined) {
        await queryClient.invalidateQueries({
          queryKey: ["recipe-bank", sourceUrl],
        });
      }
    },
    retry: false,
  });

  const bankQuery = useQuery({
    enabled: review !== undefined && sourceUrl !== undefined,
    queryFn: () =>
      operations.listBank(
        Schema.decodeUnknownSync(RecipeBankInput)({ sourceUrl })
      ),
    queryKey: ["recipe-bank", sourceUrl],
    retry: false,
  });
  const savedRecipe =
    approvalMutation.data?.ok === true && bankQuery.data?.ok === true
      ? bankQuery.data.value.recipe
      : null;

  const operationFailure: SafeFailure | undefined =
    failureFrom(submitMutation.data) ??
    failureFrom(statusQuery.data) ??
    failureFrom(reviewQuery.data) ??
    failureFrom(approvalMutation.data) ??
    failureFrom(bankQuery.data);
  const terminalFailure =
    progress?.status.kind === "failed" ||
    progress?.status.kind === "unsupported";
  const currentLabel = progress
    ? statusLabels[progress.status.kind]
    : undefined;
  const currentStage =
    currentLabel === undefined || currentLabel === "Import stopped"
      ? -1
      : stages.indexOf(currentLabel);
  let retryAction: (() => void) | undefined;
  if (
    approvalMutation.data?.ok === false &&
    approvalMutation.data.error.retryable &&
    approvalMutation.variables !== undefined
  ) {
    retryAction = () => approvalMutation.mutate(approvalMutation.variables);
  } else if (
    submitMutation.data?.ok === false &&
    submitMutation.data.error.retryable &&
    submitMutation.variables !== undefined
  ) {
    retryAction = () => submitMutation.mutate(submitMutation.variables);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <span className="wordmark">Meal Planner</span>
        <Badge>Local proof</Badge>
      </header>

      <div className="workspace">
        <section className="reading-area" aria-labelledby="page-title">
          <div className="intro">
            <p className="eyebrow">Recipe Bank</p>
            <h1 id="page-title">Import a recipe</h1>
            <p className="lede">
              Paste one public recipe or video link. We’ll prepare a draft for
              you to check before it is saved.
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
              validators={{ onBlur: ({ value }) => urlMessage(value) }}
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
                      selector={(state) => [
                        state.canSubmit,
                        state.isSubmitting,
                      ]}
                    >
                      {([canSubmit, isSubmitting]) => (
                        <Button
                          disabled={
                            !canSubmit ||
                            isSubmitting ||
                            submitMutation.isPending
                          }
                          type="submit"
                        >
                          Create draft
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
            {(submitMutation.isPending ||
              (progress !== undefined &&
                !isTerminalImportStatus(progress.status))) && (
              <section
                aria-labelledby="working-title"
                className="processing-document"
              >
                <p className="eyebrow">In progress</p>
                <h2 id="working-title">Working on your recipe</h2>
                <p className="status-line">
                  {currentLabel ?? "Waiting to begin"}
                </p>
                <Skeleton className="skeleton-line" />
                <Skeleton className="skeleton-line short" />
              </section>
            )}

            {(operationFailure !== undefined || terminalFailure) && (
              <Alert>
                <h2>This link couldn’t be imported</h2>
                <p>
                  {operationFailure?.message ??
                    "Check that the TikTok link is public and points to a supported video."}
                </p>
                {retryAction !== undefined && (
                  <Button onClick={retryAction}>Try again</Button>
                )}
              </Alert>
            )}

            {draftId !== undefined &&
              review === undefined &&
              operationFailure === undefined && (
                <section aria-label="Loading recipe draft">
                  <Skeleton className="skeleton-title" />
                  <Skeleton className="skeleton-line" />
                  <Skeleton className="skeleton-line short" />
                </section>
              )}

            {review !== undefined && savedRecipe === null && (
              <article
                className="review-document"
                aria-labelledby="review-title"
              >
                <div className="review-heading">
                  <div>
                    <p className="eyebrow">Ready for your check</p>
                    <h2 id="review-title">Review draft</h2>
                  </div>
                  <Badge>Version {review.version}</Badge>
                </div>
                <h3 className="recipe-name">{review.name}</h3>
                <a href={review.source.link} rel="noreferrer" target="_blank">
                  {review.source.label} source
                </a>
                <div className="recipe-columns">
                  <section aria-labelledby="ingredients-title">
                    <h3 id="ingredients-title">Ingredients</h3>
                    <ul>
                      {review.ingredientLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </section>
                  <section aria-labelledby="method-title">
                    <h3 id="method-title">Method</h3>
                    <ol>
                      {review.instructions.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </section>
                </div>
                <div className="approve-bar">
                  <p>Check the draft above before saving it to Recipe Bank.</p>
                  <Button
                    disabled={approvalMutation.isPending}
                    onClick={() =>
                      approvalMutation.mutate(
                        Schema.decodeUnknownSync(ApproveRecipeInput)({
                          draftId: review.draftId,
                          expectedVersion: review.version,
                          mutationId: makeRequestId(),
                        })
                      )
                    }
                  >
                    Approve recipe
                  </Button>
                </div>
              </article>
            )}

            {savedRecipe !== null && (
              <section
                className="success-document"
                aria-labelledby="success-title"
              >
                <p className="eyebrow success">Complete</p>
                <h2 id="success-title">Recipe saved</h2>
                <p>Added to Recipe Bank.</p>
                <div className="saved-entry">
                  <span>{savedRecipe.name}</span>
                  <Badge>Saved</Badge>
                </div>
              </section>
            )}
          </div>
        </section>

        <aside aria-label="Import status" className="status-rail">
          <p className="rail-title">Import status</p>
          <ol>
            {stages.map((stage, index) => (
              <li
                aria-current={index === currentStage ? "step" : undefined}
                className={index <= currentStage ? "active" : ""}
                key={stage}
              >
                <span aria-hidden="true" className="stage-marker" />
                {stage}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </main>
  );
};
