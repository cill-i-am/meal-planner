import { MealPlanPersistenceFailure } from "@meal-planner/household-api";
import type {
  CancelledRecipeImportIntent,
  Recipe,
  RecipeImportAction,
  RecipeImportIntent,
  RecipeImportTimeline,
  SucceededRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import * as authSchema from "../auth/auth.database-schema.js";
import { makeMealPlannerAuth } from "../auth/auth.js";
import {
  AuthenticatedOrganizationResolver,
  AuthPrincipalResolver,
  makeAuthenticatedOrganizationResolver,
  makeAuthPrincipalResolver,
} from "../auth/auth.principal.js";
import {
  RecipeImportHouseholdDomain,
  makeRecipeImportHttpApiLayer,
} from "../imports/import-intent-api.http.js";
import { RecipeImportWorkflowDispatcher } from "../imports/import-workflow-dispatcher.js";
import type {
  HouseholdCommitAcquisitionEvidenceInput,
  HouseholdCommitAcquisitionEvidenceResult,
  HouseholdObserveEvidenceReferenceInput,
  HouseholdObserveEvidenceReferenceResult,
} from "./evidence/household-evidence.contract.js";
import type { HouseholdDomainWorkerMethods } from "./household-domain-worker.js";
import type {
  HouseholdCreateMealPlanFromRecipeBankInput,
  HouseholdDecideMealPlanInput,
  HouseholdMealPlanWire,
  HouseholdReadMealPlanInput,
  HouseholdSwapMealPlanFromRecipeBankInput,
} from "./household-meal-plan.contract.js";
import {
  makeHouseholdDomainGateway,
  makeHouseholdMealPlanGateway,
  makeHouseholdMealPlanRequestLayer,
  makeHouseholdRequestLayer,
} from "./household-request-composition.js";
import type {
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdPersistenceFailure } from "./household.contract.js";
import type {
  HouseholdAdmitRecipeImportInput,
  HouseholdAnswerRecipeImportActionInput,
  HouseholdCancelRecipeImportInput,
  HouseholdCommitRecipeImportDraftInput,
  HouseholdConfirmRecipeImportActionInput,
  HouseholdReadRecipeImportActionInput,
  HouseholdReadRecipeImportInput,
  HouseholdReadRecipeInput,
  HouseholdRecipePage,
  HouseholdRecipePageInput,
  HouseholdResolveRecipeImportSourceInput,
  HouseholdActiveRecipeImportActionResult,
  HouseholdAdmitRecipeImportResult,
} from "./recipe-import/household-recipe-import.contract.js";
import { HouseholdRecipeImportFailure } from "./recipe-import/household-recipe-import.contract.js";

const baseURL = "https://meal-planner.test";
const recipeImportFailure = () =>
  HouseholdRecipeImportFailure.make({ reason: "persistence_unavailable" });

const isRpcErrorEnvelope = (
  value: unknown
): value is { readonly _tag: "~alchemy/rpc/error"; readonly error: unknown } =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "~alchemy/rpc/error" &&
  "error" in value;

const rpcResponse = (value: unknown) => {
  if (!isRpcErrorEnvelope(value)) {
    return Response.json(value);
  }
  const reason =
    typeof value.error === "object" &&
    value.error !== null &&
    "reason" in value.error
      ? value.error.reason
      : undefined;
  const errorTag =
    typeof value.error === "object" &&
    value.error !== null &&
    "_tag" in value.error
      ? value.error._tag
      : undefined;
  const status =
    reason === "intent_not_found"
      ? 404
      : reason === "generation_conflict" || reason === "idempotency_conflict"
        ? 409
        : 400;
  return Response.json({ errorTag, reason, rejected: true }, { status });
};

interface HouseholdApiFixtureEnv {
  readonly BETTER_AUTH_SECRET: string;
  readonly HouseholdDomainWorker: {
    readonly admitRecipeImport: (
      input: HouseholdAdmitRecipeImportInput
    ) => Promise<typeof HouseholdAdmitRecipeImportResult.Encoded>;
    readonly answerRecipeImportAction: (
      input: HouseholdAnswerRecipeImportActionInput
    ) => Promise<typeof RecipeImportIntent.Encoded>;
    readonly approveMealPlan: (
      input: HouseholdDecideMealPlanInput
    ) => Promise<HouseholdMealPlanWire>;
    readonly createMealPlanFromRecipeBank: (
      input: HouseholdCreateMealPlanFromRecipeBankInput
    ) => Promise<HouseholdMealPlanWire>;
    readonly cancelRecipeImport: (
      input: HouseholdCancelRecipeImportInput
    ) => Promise<typeof CancelledRecipeImportIntent.Encoded>;
    readonly commitAcquisitionEvidence: (
      input: HouseholdCommitAcquisitionEvidenceInput
    ) => Promise<typeof HouseholdCommitAcquisitionEvidenceResult.Encoded>;
    readonly commitRecipeImportDraft: (
      input: HouseholdCommitRecipeImportDraftInput
    ) => Promise<typeof HouseholdActiveRecipeImportActionResult.Encoded>;
    readonly observeEvidenceReference: (
      input: HouseholdObserveEvidenceReferenceInput
    ) => Promise<typeof HouseholdObserveEvidenceReferenceResult.Encoded>;
    readonly confirmRecipeImportAction: (
      input: HouseholdConfirmRecipeImportActionInput
    ) => Promise<typeof SucceededRecipeImportIntent.Encoded>;
    readonly ensureHousehold: (
      input: HouseholdEnsureInput
    ) => Promise<HouseholdMetadata>;
    readonly readMealPlan: (
      input: HouseholdReadMealPlanInput
    ) => Promise<HouseholdMealPlanWire | null>;
    readonly readRecipe: (
      input: HouseholdReadRecipeInput
    ) => Promise<typeof Recipe.Encoded>;
    readonly readRecipeImport: (
      input: HouseholdReadRecipeImportInput
    ) => Promise<typeof RecipeImportIntent.Encoded>;
    readonly readRecipeImportAction: (
      input: HouseholdReadRecipeImportActionInput
    ) => Promise<typeof RecipeImportAction.Encoded>;
    readonly readRecipeImportTimeline: (
      input: HouseholdReadRecipeImportInput
    ) => Promise<typeof RecipeImportTimeline.Encoded>;
    readonly listRecipeBank: (
      input: HouseholdRecipePageInput
    ) => Promise<typeof HouseholdRecipePage.Encoded>;
    readonly rejectMealPlan: (
      input: HouseholdDecideMealPlanInput
    ) => Promise<HouseholdMealPlanWire>;
    readonly swapMealPlanFromRecipeBank: (
      input: HouseholdSwapMealPlanFromRecipeBankInput
    ) => Promise<HouseholdMealPlanWire>;
    readonly resolveRecipeImportSource: (
      input: HouseholdResolveRecipeImportSourceInput
    ) => Promise<typeof RecipeImportIntent.Encoded>;
  };
  readonly MealPlannerAuthDatabase: AnyD1Database;
}

/**
 * Provider-free host shell. Authentication, membership resolution, private
 * routing, recipe selection, and meal-plan mutation all use production code.
 */
export default {
  fetch: async (request: Request, env: HouseholdApiFixtureEnv) => {
    if (request.headers.get("x-test-private-household-malformed") === "1") {
      try {
        const accepted = await env.HouseholdDomainWorker.ensureHousehold({
          admission: {
            actor: { _tag: "Member", actorId: "a".repeat(64) },
            organizationId: "organization-private-malformed",
          },
          unexpectedAuthority: true,
        } as never);
        const rpcResult = accepted as HouseholdMetadata & {
          readonly _tag?: string;
        };
        return rpcResult._tag === "~alchemy/rpc/error"
          ? Response.json({ rejected: true }, { status: 400 })
          : Response.json({ rejected: false }, { status: 500 });
      } catch {
        return Response.json({ rejected: true }, { status: 400 });
      }
    }
    const testSystemOperation = request.headers.get(
      "x-test-household-system-operation"
    );
    if (
      testSystemOperation === "commit-acquisition-evidence" ||
      testSystemOperation === "observe-evidence-reference" ||
      testSystemOperation === "resolve" ||
      testSystemOperation === "commit-draft"
    ) {
      try {
        const input: unknown = await request.json();
        const result =
          testSystemOperation === "resolve"
            ? await env.HouseholdDomainWorker.resolveRecipeImportSource(
                input as HouseholdResolveRecipeImportSourceInput
              )
            : testSystemOperation === "commit-draft"
              ? await env.HouseholdDomainWorker.commitRecipeImportDraft(
                  input as HouseholdCommitRecipeImportDraftInput
                )
              : testSystemOperation === "observe-evidence-reference"
                ? await env.HouseholdDomainWorker.observeEvidenceReference(
                    input as HouseholdObserveEvidenceReferenceInput
                  )
                : await env.HouseholdDomainWorker.commitAcquisitionEvidence(
                    input as HouseholdCommitAcquisitionEvidenceInput
                  );
        return rpcResponse(result);
      } catch {
        return Response.json({ rejected: true }, { status: 400 });
      }
    }
    const auth = makeMealPlannerAuth({
      baseURL,
      database: drizzle(env.MealPlannerAuthDatabase),
      schema: authSchema,
      secret: env.BETTER_AUTH_SECRET,
    });
    if (new URL(request.url).pathname.startsWith("/api/auth/")) {
      return auth.fetch(request);
    }
    const resolver = makeAuthenticatedOrganizationResolver({ auth });
    const principalResolver = makeAuthPrincipalResolver({ auth });
    const householdDomain = {
      admitRecipeImport: (input: HouseholdAdmitRecipeImportInput) =>
        Effect.tryPromise({
          catch: recipeImportFailure,
          try: () => env.HouseholdDomainWorker.admitRecipeImport(input),
        }),
      answerRecipeImportAction: (
        input: HouseholdAnswerRecipeImportActionInput
      ) =>
        Effect.tryPromise({
          catch: recipeImportFailure,
          try: () => env.HouseholdDomainWorker.answerRecipeImportAction(input),
        }),
      cancelRecipeImport: (input: HouseholdCancelRecipeImportInput) =>
        Effect.tryPromise({
          catch: recipeImportFailure,
          try: () => env.HouseholdDomainWorker.cancelRecipeImport(input),
        }),
      confirmRecipeImportAction: (
        input: HouseholdConfirmRecipeImportActionInput
      ) =>
        Effect.tryPromise({
          catch: recipeImportFailure,
          try: () => env.HouseholdDomainWorker.confirmRecipeImportAction(input),
        }),
      readRecipe: (input: HouseholdReadRecipeInput) =>
        Effect.tryPromise({
          catch: recipeImportFailure,
          try: () => env.HouseholdDomainWorker.readRecipe(input),
        }),
      readRecipeImport: (input: HouseholdReadRecipeImportInput) =>
        Effect.tryPromise({
          catch: recipeImportFailure,
          try: () => env.HouseholdDomainWorker.readRecipeImport(input),
        }),
      readRecipeImportAction: (input: HouseholdReadRecipeImportActionInput) =>
        Effect.tryPromise({
          catch: recipeImportFailure,
          try: () => env.HouseholdDomainWorker.readRecipeImportAction(input),
        }),
      readRecipeImportTimeline: (input: HouseholdReadRecipeImportInput) =>
        Effect.tryPromise({
          catch: recipeImportFailure,
          try: () => env.HouseholdDomainWorker.readRecipeImportTimeline(input),
        }),
    } as HouseholdDomainWorkerMethods;
    const importServices = Layer.mergeAll(
      Layer.succeed(AuthPrincipalResolver, principalResolver),
      Layer.succeed(AuthenticatedOrganizationResolver, resolver),
      Layer.succeed(RecipeImportHouseholdDomain, householdDomain),
      Layer.succeed(
        RecipeImportWorkflowDispatcher,
        RecipeImportWorkflowDispatcher.of({ dispatch: () => Effect.void })
      )
    );
    const householdLayer = makeHouseholdRequestLayer({
      gateway: makeHouseholdDomainGateway({
        ensureHousehold: (input) =>
          Effect.tryPromise({
            catch: () =>
              HouseholdPersistenceFailure.make({ operation: "ensure" }),
            try: () => env.HouseholdDomainWorker.ensureHousehold(input),
          }),
      }),
      resolver,
    });
    const mealPlanDomain: Parameters<
      typeof makeHouseholdMealPlanGateway
    >[0]["domain"] = {
      approveMealPlan: (input) =>
        Effect.tryPromise({
          catch: () => MealPlanPersistenceFailure.make({ operation: "save" }),
          try: () => env.HouseholdDomainWorker.approveMealPlan(input),
        }),
      createMealPlanFromRecipeBank: (input) =>
        Effect.tryPromise({
          catch: () => MealPlanPersistenceFailure.make({ operation: "create" }),
          try: () =>
            env.HouseholdDomainWorker.createMealPlanFromRecipeBank(input),
        }),
      readMealPlan: (input) =>
        Effect.tryPromise({
          catch: () => MealPlanPersistenceFailure.make({ operation: "read" }),
          try: () => env.HouseholdDomainWorker.readMealPlan(input),
        }),
      rejectMealPlan: (input) =>
        Effect.tryPromise({
          catch: () => MealPlanPersistenceFailure.make({ operation: "save" }),
          try: () => env.HouseholdDomainWorker.rejectMealPlan(input),
        }),
      swapMealPlanFromRecipeBank: (input) =>
        Effect.tryPromise({
          catch: () => MealPlanPersistenceFailure.make({ operation: "save" }),
          try: () =>
            env.HouseholdDomainWorker.swapMealPlanFromRecipeBank(input),
        }),
    };
    const mealPlanLayer = makeHouseholdMealPlanRequestLayer({
      gateway: makeHouseholdMealPlanGateway({ domain: mealPlanDomain }),
      resolver,
    });
    const mounted = HttpRouter.toWebHandler(
      Layer.mergeAll(
        householdLayer,
        mealPlanLayer,
        makeRecipeImportHttpApiLayer().pipe(
          Layer.provide(importServices),
          HttpRouter.provideRequest(importServices)
        )
      ),
      { disableLogger: true }
    );
    try {
      return await mounted.handler(request);
    } finally {
      await mounted.dispose();
    }
  },
};
