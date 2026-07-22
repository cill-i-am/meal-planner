import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import { respondRecipeReview } from "./import-recipe-review.http.js";
import {
  ApprovedRecipeBankResponse,
  CorrectRecipeDraftRequest,
  GetRecipeReviewResponse,
  RecipeReviewMutationResponse,
  RecipeReviewService,
  TransitionRecipeDraftRequest,
  authenticatedRecipeReviewer,
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
    yield* authorizer.authorize(request.headers["authorization"]);
    return authenticatedRecipeReviewer;
  });

export const RecipeReviewRouteDefinitions = [
  HttpRouter.route("GET", "/recipe-drafts/:id", (request) =>
    Effect.gen(function* getRecipeDraftReview() {
      yield* authorize(request);
      const { id } = yield* decodeImportId;
      const service = yield* RecipeReviewService;
      return { review: yield* service.get(id) };
    }).pipe((effect) =>
      respondRecipeReview(effect, GetRecipeReviewResponse, 200)
    )
  ),
  HttpRouter.route("PATCH", "/recipe-drafts/:id", (request) =>
    Effect.gen(function* correctRecipeDraft() {
      const actorId = yield* authorize(request);
      const { id } = yield* decodeImportId;
      const body = yield* decodeCorrection;
      const service = yield* RecipeReviewService;
      return { review: yield* service.correct(id, body, actorId) };
    }).pipe((effect) =>
      respondRecipeReview(effect, RecipeReviewMutationResponse, 200)
    )
  ),
  HttpRouter.route("POST", "/recipe-drafts/:id/approve", (request) =>
    Effect.gen(function* approveRecipeDraft() {
      const actorId = yield* authorize(request);
      const { id } = yield* decodeImportId;
      const body = yield* decodeTransition;
      const service = yield* RecipeReviewService;
      return { review: yield* service.approve(id, body, actorId) };
    }).pipe((effect) =>
      respondRecipeReview(effect, RecipeReviewMutationResponse, 200)
    )
  ),
  HttpRouter.route("POST", "/recipe-drafts/:id/reject", (request) =>
    Effect.gen(function* rejectRecipeDraft() {
      const actorId = yield* authorize(request);
      const { id } = yield* decodeImportId;
      const body = yield* decodeTransition;
      const service = yield* RecipeReviewService;
      return { review: yield* service.reject(id, body, actorId) };
    }).pipe((effect) =>
      respondRecipeReview(effect, RecipeReviewMutationResponse, 200)
    )
  ),
  HttpRouter.route("POST", "/recipe-drafts/:id/return-to-review", (request) =>
    Effect.gen(function* returnRecipeDraftToReview() {
      const actorId = yield* authorize(request);
      const { id } = yield* decodeImportId;
      const body = yield* decodeTransition;
      const service = yield* RecipeReviewService;
      return { review: yield* service.returnToReview(id, body, actorId) };
    }).pipe((effect) =>
      respondRecipeReview(effect, RecipeReviewMutationResponse, 200)
    )
  ),
  HttpRouter.route("GET", "/recipe-bank", (request) =>
    Effect.gen(function* getApprovedRecipeBank() {
      yield* authorize(request);
      const service = yield* RecipeReviewService;
      return { recipes: yield* service.listApproved() };
    }).pipe((effect) =>
      respondRecipeReview(effect, ApprovedRecipeBankResponse, 200)
    )
  ),
] as const;

export const RecipeReviewRoutes = HttpRouter.addAll(
  RecipeReviewRouteDefinitions
);
