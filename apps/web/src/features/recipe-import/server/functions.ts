import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import {
  ApproveRecipeInput,
  DraftIdentityInput,
  ImportIdentityInput,
  RecipeBankInput,
  SubmitImportInput,
} from "../contracts.js";
import type { OperationResult } from "../contracts.js";
import { makeImportApiClient } from "./import-api-client.js";
import type { ImportApiFailure } from "./import-api-client.js";

const validate =
  <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  (input: unknown): S["Type"] => {
    try {
      return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(
        input
      );
    } catch {
      throw new Error("Invalid recipe import request.");
    }
  };

const run = <A>(
  effect: Effect.Effect<A, ImportApiFailure>
): Promise<OperationResult<A>> =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: (failure) => ({
          error: failure.failure,
          ok: false as const,
        }),
        onSuccess: (value) => ({ ok: true as const, value }),
      })
    )
  );

const configuredClient = () =>
  makeImportApiClient({
    baseUrl: process.env["RECIPE_IMPORT_API_BASE_URL"] ?? "",
    token: process.env["RECIPE_IMPORT_API_TOKEN"] ?? "",
  });

export const submitRecipeImport = createServerFn({ method: "POST" })
  .validator(validate(SubmitImportInput))
  .handler(({ data }) =>
    run(
      configuredClient().pipe(Effect.flatMap((client) => client.submit(data)))
    )
  );

export const pollRecipeImport = createServerFn({ method: "GET" })
  .validator(validate(ImportIdentityInput))
  .handler(({ data }) =>
    run(configuredClient().pipe(Effect.flatMap((client) => client.poll(data))))
  );

export const loadRecipeReview = createServerFn({ method: "GET" })
  .validator(validate(DraftIdentityInput))
  .handler(({ data }) =>
    run(
      configuredClient().pipe(
        Effect.flatMap((client) => client.loadReview(data.draftId))
      )
    )
  );

export const approveRecipeDraft = createServerFn({ method: "POST" })
  .validator(validate(ApproveRecipeInput))
  .handler(({ data }) =>
    run(
      configuredClient().pipe(Effect.flatMap((client) => client.approve(data)))
    )
  );

export const listMatchingRecipeBankEntry = createServerFn({ method: "GET" })
  .validator(validate(RecipeBankInput))
  .handler(({ data }) =>
    run(
      configuredClient().pipe(Effect.flatMap((client) => client.listBank(data)))
    )
  );
