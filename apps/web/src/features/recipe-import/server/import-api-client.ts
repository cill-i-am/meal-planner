import "@tanstack/react-start/server-only";
import { Data, Effect, Redacted, Schema } from "effect";

import {
  ApprovalView,
  ImportId,
  ImportProgressView,
  ImportStatusView,
  RecipeBankView,
  RecipeReviewView,
  SafeFailure,
  TikTokRecipeUrl,
} from "../contracts.js";
import type {
  ApproveRecipeInput,
  DraftId,
  ImportIdentityInput,
  RecipeBankInput,
  SafeFailure as SafeFailureType,
  SubmitImportInput,
} from "../contracts.js";

const UpstreamImport = Schema.Struct({
  id: ImportId,
  status: ImportStatusView,
});
const UpstreamCreateResponse = Schema.Struct({ import: UpstreamImport });
const UpstreamGetResponse = Schema.Struct({ import: UpstreamImport });

const SupportedText = Schema.Struct({
  state: Schema.Literal("supported"),
  value: Schema.String,
});
const SupportedList = Schema.Struct({
  items: Schema.NonEmptyArray(SupportedText),
  state: Schema.Literal("supported"),
});
const UpstreamReviewResponse = Schema.Struct({
  review: Schema.Struct({
    draft: Schema.Struct({
      extraction: Schema.Struct({
        ingredientLines: SupportedList,
        instructions: SupportedList,
        name: SupportedText,
        sourceUrl: SupportedText,
      }),
      importId: ImportId,
    }),
    lifecycle: Schema.Literals(["needs_review", "approved"]),
    version: Schema.Number,
  }),
});
const UpstreamApprovalResponse = Schema.Struct({
  outcome: Schema.Struct({
    _tag: Schema.Literals(["Applied", "Replayed"]),
    resultingVersion: Schema.Number,
    review: Schema.Struct({ lifecycle: Schema.Literal("approved") }),
  }),
});
const UpstreamBankResponse = Schema.Struct({
  recipes: Schema.Array(
    Schema.Struct({
      importId: ImportId,
      recipe: Schema.Struct({
        ingredientLines: Schema.NonEmptyArray(Schema.String),
        instructions: Schema.NonEmptyArray(Schema.String),
        name: Schema.String,
      }),
      source: Schema.Struct({ sourceUrl: Schema.NullOr(TikTokRecipeUrl) }),
      version: Schema.Number,
    })
  ),
});

const isLoopbackBaseUrl = Schema.makeFilter<string>(
  (input) => {
    try {
      const url = new URL(input);
      return (
        url.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) &&
        url.username === "" &&
        url.password === "" &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === ""
      );
    } catch {
      return false;
    }
  },
  { expected: "a loopback-only HTTP API base URL" },
  true
);

const ApiConfig = Schema.Struct({
  baseUrl: Schema.String.pipe(Schema.check(isLoopbackBaseUrl)),
  token: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
});

export const ImportApiFailure = Data.TaggedError("ImportApiFailure")<{
  readonly failure: SafeFailureType;
}>;
export type ImportApiFailure = InstanceType<typeof ImportApiFailure>;

const fail = (
  code: SafeFailureType["code"],
  message: string,
  retryable: boolean
) =>
  new ImportApiFailure({
    failure: Schema.decodeUnknownSync(SafeFailure)({
      code,
      message,
      retryable,
    }),
  });

const invalidResponse = () =>
  fail(
    "invalid_upstream_response",
    "The import service returned an unexpected response.",
    false
  );

const failureForStatus = (status: number) => {
  switch (status) {
    case 401: {
      return fail(
        "server_configuration",
        "Recipe importing is not configured correctly.",
        false
      );
    }
    case 409: {
      return fail(
        "conflict",
        "This request conflicts with an earlier attempt.",
        false
      );
    }
    case 422: {
      return fail(
        "invalid_request",
        "This recipe request is not valid.",
        false
      );
    }
    case 503: {
      return fail(
        "unavailable",
        "Recipe importing is temporarily unavailable. Please try again.",
        true
      );
    }
    default: {
      return invalidResponse();
    }
  }
};

interface ValidConfig {
  readonly baseUrl: string;
  readonly token: Redacted.Redacted<string>;
}

const requestJson = Effect.fn("RecipeImportApi.request")(
  (config: ValidConfig, path: string, init: RequestInit) =>
    Effect.tryPromise({
      catch: () =>
        fail(
          "unavailable",
          "Recipe importing is temporarily unavailable. Please try again.",
          true
        ),
      try: (signal) =>
        fetch(new URL(path, config.baseUrl), {
          ...init,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${Redacted.value(config.token)}`,
            ...init.headers,
          },
          signal,
        }),
    }).pipe(
      Effect.flatMap((response) =>
        response.ok
          ? Effect.tryPromise({
              catch: invalidResponse,
              try: () => response.json(),
            })
          : Effect.fail(failureForStatus(response.status))
      )
    )
);

const decode =
  <S extends Schema.Top>(schema: S) =>
  (input: unknown) =>
    Schema.decodeUnknownEffect(schema, { onExcessProperty: "ignore" })(
      input
    ).pipe(Effect.mapError(invalidResponse));

export const makeImportApiClient = Effect.fn("RecipeImportApi.make")(
  (input: { readonly baseUrl: string; readonly token: string }) =>
    Schema.decodeUnknownEffect(ApiConfig)(input).pipe(
      Effect.mapError(() =>
        fail(
          "server_configuration",
          "Recipe importing is not configured correctly.",
          false
        )
      ),
      Effect.map((config) => {
        const validConfig: ValidConfig = {
          baseUrl: config.baseUrl,
          token: Redacted.make(config.token),
        };

        return {
          approve: Effect.fn("RecipeImportApi.approve")(
            (request: ApproveRecipeInput) =>
              requestJson(
                validConfig,
                `/recipe-drafts/${request.draftId}/approve`,
                {
                  body: JSON.stringify({
                    expectedVersion: request.expectedVersion,
                    mutationId: request.mutationId,
                    reason: "Recipe checked in the web proof of concept.",
                  }),
                  headers: { "content-type": "application/json" },
                  method: "POST",
                }
              ).pipe(
                Effect.flatMap(decode(UpstreamApprovalResponse)),
                Effect.map((response) =>
                  Schema.decodeUnknownSync(ApprovalView)({
                    draftId: request.draftId,
                    outcome:
                      response.outcome._tag === "Applied"
                        ? "applied"
                        : "replayed",
                    status: response.outcome.review.lifecycle,
                    version: response.outcome.resultingVersion,
                  })
                )
              )
          ),
          listBank: Effect.fn("RecipeImportApi.listBank")(
            (request: RecipeBankInput) =>
              requestJson(validConfig, "/recipe-bank", { method: "GET" }).pipe(
                Effect.flatMap(decode(UpstreamBankResponse)),
                Effect.map((response) => {
                  const matching = response.recipes.find(
                    (recipe) => recipe.source.sourceUrl === request.sourceUrl
                  );
                  return Schema.decodeUnknownSync(RecipeBankView)({
                    recipe:
                      matching === undefined ||
                      matching.source.sourceUrl === null
                        ? null
                        : {
                            ingredientLines: matching.recipe.ingredientLines,
                            instructions: matching.recipe.instructions,
                            name: matching.recipe.name,
                            recipeId: matching.importId,
                            source: {
                              label: "TikTok",
                              link: matching.source.sourceUrl,
                            },
                            version: matching.version,
                          },
                  });
                })
              )
          ),
          loadReview: Effect.fn("RecipeImportApi.loadReview")(
            (draftId: DraftId) =>
              requestJson(validConfig, `/recipe-drafts/${draftId}`, {
                method: "GET",
              }).pipe(
                Effect.flatMap(decode(UpstreamReviewResponse)),
                Effect.map((response) =>
                  Schema.decodeUnknownSync(RecipeReviewView)({
                    draftId,
                    ingredientLines:
                      response.review.draft.extraction.ingredientLines.items.map(
                        (item) => item.value
                      ),
                    instructions:
                      response.review.draft.extraction.instructions.items.map(
                        (item) => item.value
                      ),
                    name: response.review.draft.extraction.name.value,
                    source: {
                      label: "TikTok",
                      link: response.review.draft.extraction.sourceUrl.value,
                    },
                    status: response.review.lifecycle,
                    version: response.review.version,
                  })
                )
              )
          ),
          poll: Effect.fn("RecipeImportApi.poll")(
            (request: ImportIdentityInput) =>
              requestJson(validConfig, `/imports/${request.importId}`, {
                method: "GET",
              }).pipe(
                Effect.flatMap(decode(UpstreamGetResponse)),
                Effect.map((response) =>
                  Schema.decodeUnknownSync(ImportProgressView)({
                    ...(response.import.status.kind === "needs_review"
                      ? { draftId: response.import.id }
                      : {}),
                    importId: response.import.id,
                    status: response.import.status,
                  })
                )
              )
          ),
          submit: Effect.fn("RecipeImportApi.submit")(
            (request: SubmitImportInput) =>
              requestJson(validConfig, "/imports", {
                body: JSON.stringify({
                  source: { kind: "tiktok", url: request.sourceUrl },
                }),
                headers: {
                  "content-type": "application/json",
                  "idempotency-key": request.idempotencyKey,
                },
                method: "POST",
              }).pipe(
                Effect.flatMap(decode(UpstreamCreateResponse)),
                Effect.map((response) =>
                  Schema.decodeUnknownSync(ImportProgressView)({
                    importId: response.import.id,
                    status: response.import.status,
                  })
                )
              )
          ),
        };
      })
    )
);
