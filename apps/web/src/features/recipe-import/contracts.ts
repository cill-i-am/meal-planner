import { Schema } from "effect";

const TrimmedText = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);

const MaximumRecipeUrlLength = 2048;
const TikTokHosts = new Set([
  "tiktok.com",
  "www.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
]);

const isSafeTikTokUrl = Schema.makeFilter<string>(
  (input) => {
    if (input.length > MaximumRecipeUrlLength) {
      return false;
    }

    try {
      const url = new URL(input);
      return (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.port === "" &&
        TikTokHosts.has(url.hostname.toLowerCase())
      );
    } catch {
      return false;
    }
  },
  { expected: "a public TikTok HTTPS URL without credentials or a port" },
  true
);

export const TikTokRecipeUrl = TrimmedText.pipe(
  Schema.check(isSafeTikTokUrl),
  Schema.brand("TikTokRecipeUrl")
);
export type TikTokRecipeUrl = typeof TikTokRecipeUrl.Type;

export const ImportId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("RecipeImportId")
);
export type ImportId = typeof ImportId.Type;

export const DraftId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("RecipeDraftId")
);
export type DraftId = typeof DraftId.Type;

export const RequestId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("RecipeImportRequestId")
);
export type RequestId = typeof RequestId.Type;

const InProgressStatusKind = Schema.Literals([
  "queued",
  "acquiring",
  "acquired",
  "transcribing",
  "transcribed",
  "extracting_visual",
  "visual_evidence_found",
  "visual_evidence_empty",
  "visual_evidence_low_confidence",
]);

export const ImportStatusView = Schema.Union([
  Schema.Struct({ kind: InProgressStatusKind }),
  Schema.Struct({ kind: Schema.Literal("needs_review") }),
  Schema.Struct({
    code: Schema.Literals([
      "private_or_unavailable",
      "acquisition_temporarily_unavailable",
      "invalid_or_unsupported_media",
      "transcription_failed",
      "visual_evidence_failed",
      "recipe_extraction_failed",
    ]),
    kind: Schema.Literal("failed"),
  }),
  Schema.Struct({
    code: Schema.Literal("unsupported_post_type"),
    kind: Schema.Literal("unsupported"),
  }),
]);
export type ImportStatusView = typeof ImportStatusView.Type;

export const isTerminalImportStatus = (status: ImportStatusView) =>
  status.kind === "needs_review" ||
  status.kind === "failed" ||
  status.kind === "unsupported";

export const SubmitImportInput = Schema.Struct({
  idempotencyKey: RequestId,
  sourceUrl: TikTokRecipeUrl,
});
export type SubmitImportInput = typeof SubmitImportInput.Type;

export const ImportIdentityInput = Schema.Struct({ importId: ImportId });
export type ImportIdentityInput = typeof ImportIdentityInput.Type;

export const DraftIdentityInput = Schema.Struct({ draftId: DraftId });
export type DraftIdentityInput = typeof DraftIdentityInput.Type;

export const ApproveRecipeInput = Schema.Struct({
  draftId: DraftId,
  expectedVersion: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  ),
  mutationId: RequestId,
});
export type ApproveRecipeInput = typeof ApproveRecipeInput.Type;

export const RecipeBankInput = Schema.Struct({ sourceUrl: TikTokRecipeUrl });
export type RecipeBankInput = typeof RecipeBankInput.Type;

export const ImportProgressView = Schema.Struct({
  draftId: Schema.optionalKey(DraftId),
  importId: ImportId,
  status: ImportStatusView,
});
export type ImportProgressView = typeof ImportProgressView.Type;

const RecipeSourceView = Schema.Struct({
  label: Schema.Literal("TikTok"),
  link: TikTokRecipeUrl,
});

export const RecipeReviewView = Schema.Struct({
  draftId: DraftId,
  ingredientLines: Schema.NonEmptyArray(TrimmedText),
  instructions: Schema.NonEmptyArray(TrimmedText),
  name: TrimmedText,
  source: RecipeSourceView,
  status: Schema.Literals(["needs_review", "approved"]),
  version: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  ),
});
export type RecipeReviewView = typeof RecipeReviewView.Type;

export const ApprovalView = Schema.Struct({
  draftId: DraftId,
  outcome: Schema.Literals(["applied", "replayed"]),
  status: Schema.Literal("approved"),
  version: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  ),
});
export type ApprovalView = typeof ApprovalView.Type;

export const SavedRecipeView = Schema.Struct({
  ingredientLines: Schema.NonEmptyArray(TrimmedText),
  instructions: Schema.NonEmptyArray(TrimmedText),
  name: TrimmedText,
  recipeId: ImportId,
  source: RecipeSourceView,
  version: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  ),
});
export type SavedRecipeView = typeof SavedRecipeView.Type;

export const RecipeBankView = Schema.Struct({
  recipe: Schema.NullOr(SavedRecipeView),
});
export type RecipeBankView = typeof RecipeBankView.Type;

export const SafeFailureCode = Schema.Literals([
  "invalid_request",
  "server_configuration",
  "conflict",
  "unavailable",
  "invalid_upstream_response",
]);
export type SafeFailureCode = typeof SafeFailureCode.Type;

export const SafeFailure = Schema.Struct({
  code: SafeFailureCode,
  message: TrimmedText,
  retryable: Schema.Boolean,
});
export type SafeFailure = typeof SafeFailure.Type;

export type OperationResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly error: SafeFailure; readonly ok: false };

export interface RecipeImportOperations {
  readonly approve: (
    input: ApproveRecipeInput
  ) => Promise<OperationResult<ApprovalView>>;
  readonly listBank: (
    input: RecipeBankInput
  ) => Promise<OperationResult<RecipeBankView>>;
  readonly loadReview: (
    input: DraftIdentityInput
  ) => Promise<OperationResult<RecipeReviewView>>;
  readonly poll: (
    input: ImportIdentityInput
  ) => Promise<OperationResult<ImportProgressView>>;
  readonly submit: (
    input: SubmitImportInput
  ) => Promise<OperationResult<ImportProgressView>>;
}
