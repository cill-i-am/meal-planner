import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import { RecipeReviewCompatibility } from "./import-recipe-review.compatibility.js";
import { respondRecipeReview } from "./import-recipe-review.http.js";
import {
  ApprovedRecipeBankResponse,
  CorrectRecipeDraftRequest,
  GetRecipeReviewResponse,
  RecipeReviewMutationResponse,
  TransitionRecipeDraftRequest,
} from "./import-recipe-review.js";
import { ImportAuthorizer } from "./import.auth.js";
import { ImportId } from "./import.contracts.js";
import { invalidImportId, invalidImportRequest } from "./import.errors.js";

const decodeImportId = HttpRouter.schemaPathParams(
  Schema.Struct({ id: ImportId })
).pipe(Effect.mapError(() => invalidImportId()));

const decodeCorrection = HttpServerRequest.schemaBodyJson(
  CorrectRecipeDraftRequest
).pipe(Effect.mapError(() => invalidImportRequest()));

const decodeTransition = HttpServerRequest.schemaBodyJson(
  TransitionRecipeDraftRequest
).pipe(Effect.mapError(() => invalidImportRequest()));

const authorize = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* authorizeRecipeReview() {
    const authorizer = yield* ImportAuthorizer;
    return yield* authorizer.authorize(request.headers["authorization"]);
  });

export const RecipeReviewRouteDefinitions = [
  HttpRouter.route("GET", "/recipe-drafts/:id", (request) =>
    Effect.gen(function* getRecipeDraftReview() {
      const principal = yield* authorize(request);
      const { id } = yield* decodeImportId;
      const service = yield* RecipeReviewCompatibility;
      return { review: yield* service.get(principal, id) };
    }).pipe((effect) =>
      respondRecipeReview(effect, GetRecipeReviewResponse, 200)
    )
  ),
  HttpRouter.route("PATCH", "/recipe-drafts/:id", (request) =>
    Effect.gen(function* correctRecipeDraft() {
      const principal = yield* authorize(request);
      const { id } = yield* decodeImportId;
      const body = yield* decodeCorrection;
      const service = yield* RecipeReviewCompatibility;
      return { outcome: yield* service.correct(principal, id, body) };
    }).pipe((effect) =>
      respondRecipeReview(effect, RecipeReviewMutationResponse, 200)
    )
  ),
  HttpRouter.route("POST", "/recipe-drafts/:id/approve", (request) =>
    Effect.gen(function* approveRecipeDraft() {
      const principal = yield* authorize(request);
      const { id } = yield* decodeImportId;
      const body = yield* decodeTransition;
      const service = yield* RecipeReviewCompatibility;
      return { outcome: yield* service.approve(principal, id, body) };
    }).pipe((effect) =>
      respondRecipeReview(effect, RecipeReviewMutationResponse, 200)
    )
  ),
  HttpRouter.route("POST", "/recipe-drafts/:id/reject", (request) =>
    Effect.gen(function* rejectRecipeDraft() {
      const principal = yield* authorize(request);
      const { id } = yield* decodeImportId;
      const body = yield* decodeTransition;
      const service = yield* RecipeReviewCompatibility;
      return { outcome: yield* service.reject(principal, id, body) };
    }).pipe((effect) =>
      respondRecipeReview(effect, RecipeReviewMutationResponse, 200)
    )
  ),
  HttpRouter.route("POST", "/recipe-drafts/:id/return-to-review", (request) =>
    Effect.gen(function* returnRecipeDraftToReview() {
      const principal = yield* authorize(request);
      const { id } = yield* decodeImportId;
      const body = yield* decodeTransition;
      const service = yield* RecipeReviewCompatibility;
      return {
        outcome: yield* service.returnToReview(principal, id, body),
      };
    }).pipe((effect) =>
      respondRecipeReview(effect, RecipeReviewMutationResponse, 200)
    )
  ),
  HttpRouter.route("GET", "/recipe-bank", (request) =>
    Effect.gen(function* getApprovedRecipeBank() {
      const principal = yield* authorize(request);
      const service = yield* RecipeReviewCompatibility;
      return { recipes: yield* service.listApproved(principal) };
    }).pipe((effect) =>
      respondRecipeReview(effect, ApprovedRecipeBankResponse, 200)
    )
  ),
] as const;

export const RecipeReviewRoutes = HttpRouter.addAll(
  RecipeReviewRouteDefinitions
);
