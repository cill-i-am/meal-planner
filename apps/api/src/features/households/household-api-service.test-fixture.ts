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
import { Effect, Layer, Option, Schema } from "effect";
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
import {
  HouseholdCommitAcquisitionEvidenceInput,
  HouseholdMutateEvidenceStageInput,
  HouseholdObserveEvidenceReferenceInput,
  HouseholdPrepareRecipeRecoveryInput,
  HouseholdReadEvidenceReferencesInput,
  HouseholdReadEvidenceStageInput,
  HouseholdReadImportTerminalCheckpointInput,
  HouseholdReadRecipeRecoveryAttemptInput,
} from "./evidence/household-evidence.contract.js";
import type {
  HouseholdCommitAcquisitionEvidenceResult,
  HouseholdMutateEvidenceStageResult,
  HouseholdObserveEvidenceReferenceResult,
  HouseholdPrepareRecipeRecoveryResult,
  HouseholdReadEvidenceReferencesResult,
  HouseholdReadEvidenceStageResult,
  HouseholdReadImportTerminalCheckpointResult,
  HouseholdReadRecipeRecoveryAttemptResult,
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
  HouseholdRecordRecipeImportDispatchResult,
} from "./recipe-import/household-recipe-import.contract.js";
import {
  HouseholdRecipeImportFailure,
  HouseholdRecordRecipeImportDispatchInput,
} from "./recipe-import/household-recipe-import.contract.js";

const baseURL = "https://meal-planner.test";
const recipeImportFailure = () =>
  HouseholdRecipeImportFailure.make({ reason: "persistence_unavailable" });

const RpcErrorEnvelope = Schema.Struct({
  _tag: Schema.Literal("~alchemy/rpc/error"),
  error: Schema.Struct({
    _tag: Schema.optionalKey(Schema.String),
    reason: Schema.optionalKey(Schema.String),
  }),
});

const failureStatus = (reason: string | undefined) => {
  if (reason === "intent_not_found") {
    return 404;
  }
  if (reason === "generation_conflict" || reason === "idempotency_conflict") {
    return 409;
  }
  return 400;
};

const rpcResponse = (value: Schema.Json) => {
  const decoded = Schema.decodeUnknownOption(RpcErrorEnvelope)(value);
  if (Option.isNone(decoded)) {
    return Response.json(value);
  }
  const { _tag: errorTag, reason } = decoded.value.error;
  const status = failureStatus(reason);
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
      input: typeof HouseholdCommitAcquisitionEvidenceInput.Encoded
    ) => Promise<typeof HouseholdCommitAcquisitionEvidenceResult.Encoded>;
    readonly mutateEvidenceStage: (
      input: typeof HouseholdMutateEvidenceStageInput.Encoded
    ) => Promise<typeof HouseholdMutateEvidenceStageResult.Encoded>;
    readonly commitRecipeImportDraft: (
      input: HouseholdCommitRecipeImportDraftInput
    ) => Promise<typeof HouseholdActiveRecipeImportActionResult.Encoded>;
    readonly observeEvidenceReference: (
      input: typeof HouseholdObserveEvidenceReferenceInput.Encoded
    ) => Promise<typeof HouseholdObserveEvidenceReferenceResult.Encoded>;
    readonly prepareRecipeRecovery: (
      input: typeof HouseholdPrepareRecipeRecoveryInput.Encoded
    ) => Promise<typeof HouseholdPrepareRecipeRecoveryResult.Encoded>;
    readonly readEvidenceReferences: (
      input: typeof HouseholdReadEvidenceReferencesInput.Encoded
    ) => Promise<typeof HouseholdReadEvidenceReferencesResult.Encoded>;
    readonly readEvidenceStage: (
      input: typeof HouseholdReadEvidenceStageInput.Encoded
    ) => Promise<typeof HouseholdReadEvidenceStageResult.Encoded>;
    readonly readImportTerminalCheckpoint: (
      input: typeof HouseholdReadImportTerminalCheckpointInput.Encoded
    ) => Promise<typeof HouseholdReadImportTerminalCheckpointResult.Encoded>;
    readonly readRecipeRecoveryAttempt: (
      input: typeof HouseholdReadRecipeRecoveryAttemptInput.Encoded
    ) => Promise<typeof HouseholdReadRecipeRecoveryAttemptResult.Encoded>;
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
    readonly recordRecipeImportDispatch: (
      input: HouseholdRecordRecipeImportDispatchInput
    ) => Promise<typeof HouseholdRecordRecipeImportDispatchResult.Encoded>;
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

const testSystemOperations = [
  "commit-acquisition-evidence",
  "commit-draft",
  "mutate-evidence-stage",
  "observe-evidence-reference",
  "prepare-recipe-recovery",
  "read-evidence-references",
  "read-evidence-stage",
  "read-recipe-recovery-attempt",
  "read-terminal-checkpoint",
  "resolve",
] as const;
type TestSystemOperation = (typeof testSystemOperations)[number];
const isTestSystemOperation = (
  operation: string | null
): operation is TestSystemOperation =>
  operation !== null &&
  (testSystemOperations as readonly string[]).includes(operation);

const handleMalformedPrivateCommand = async (env: HouseholdApiFixtureEnv) => {
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
};

const handleTestSystemOperation = async (
  request: Request,
  env: HouseholdApiFixtureEnv,
  operation: TestSystemOperation
) => {
  try {
    const input = Schema.decodeUnknownSync(Schema.Json)(await request.json());
    let result: Schema.Json;
    switch (operation) {
      case "commit-draft": {
        result = await env.HouseholdDomainWorker.commitRecipeImportDraft(
          input as HouseholdCommitRecipeImportDraftInput
        );
        break;
      }
      case "mutate-evidence-stage": {
        result = await env.HouseholdDomainWorker.mutateEvidenceStage(
          Schema.decodeUnknownSync(
            Schema.toEncoded(HouseholdMutateEvidenceStageInput)
          )(input)
        );
        break;
      }
      case "observe-evidence-reference": {
        result = await env.HouseholdDomainWorker.observeEvidenceReference(
          Schema.decodeUnknownSync(
            Schema.toEncoded(HouseholdObserveEvidenceReferenceInput)
          )(input)
        );
        break;
      }
      case "prepare-recipe-recovery": {
        result = await env.HouseholdDomainWorker.prepareRecipeRecovery(
          Schema.decodeUnknownSync(
            Schema.toEncoded(HouseholdPrepareRecipeRecoveryInput)
          )(input)
        );
        break;
      }
      case "read-evidence-stage": {
        result = await env.HouseholdDomainWorker.readEvidenceStage(
          Schema.decodeUnknownSync(
            Schema.toEncoded(HouseholdReadEvidenceStageInput)
          )(input)
        );
        break;
      }
      case "read-evidence-references": {
        result = await env.HouseholdDomainWorker.readEvidenceReferences(
          Schema.decodeUnknownSync(
            Schema.toEncoded(HouseholdReadEvidenceReferencesInput)
          )(input)
        );
        break;
      }
      case "read-terminal-checkpoint": {
        result = await env.HouseholdDomainWorker.readImportTerminalCheckpoint(
          Schema.decodeUnknownSync(
            Schema.toEncoded(HouseholdReadImportTerminalCheckpointInput)
          )(input)
        );
        break;
      }
      case "read-recipe-recovery-attempt": {
        result = await env.HouseholdDomainWorker.readRecipeRecoveryAttempt(
          Schema.decodeUnknownSync(
            Schema.toEncoded(HouseholdReadRecipeRecoveryAttemptInput)
          )(input)
        );
        break;
      }
      case "resolve": {
        result = await env.HouseholdDomainWorker.resolveRecipeImportSource(
          input as HouseholdResolveRecipeImportSourceInput
        );
        break;
      }
      default: {
        result = await env.HouseholdDomainWorker.commitAcquisitionEvidence(
          Schema.decodeUnknownSync(
            Schema.toEncoded(HouseholdCommitAcquisitionEvidenceInput)
          )(input)
        );
      }
    }
    return rpcResponse(result);
  } catch {
    return Response.json({ rejected: true }, { status: 400 });
  }
};

/**
 * Provider-free host shell. Authentication, membership resolution, private
 * routing, recipe selection, and meal-plan mutation all use production code.
 */
export default {
  fetch: async (request: Request, env: HouseholdApiFixtureEnv) => {
    if (request.headers.get("x-test-private-household-malformed") === "1") {
      return handleMalformedPrivateCommand(env);
    }
    const testSystemOperation = request.headers.get(
      "x-test-household-system-operation"
    );
    if (isTestSystemOperation(testSystemOperation)) {
      return handleTestSystemOperation(request, env, testSystemOperation);
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
      recordRecipeImportDispatch: (
        input: HouseholdRecordRecipeImportDispatchInput
      ) =>
        Effect.tryPromise({
          catch: recipeImportFailure,
          try: () =>
            env.HouseholdDomainWorker.recordRecipeImportDispatch(input),
        }),
    } as HouseholdDomainWorkerMethods;
    const importServices = Layer.mergeAll(
      Layer.succeed(AuthPrincipalResolver, principalResolver),
      Layer.succeed(AuthenticatedOrganizationResolver, resolver),
      Layer.succeed(RecipeImportHouseholdDomain, householdDomain),
      Layer.succeed(
        RecipeImportWorkflowDispatcher,
        RecipeImportWorkflowDispatcher.of({
          dispatch: ({ admission, committed }) =>
            Schema.decodeUnknownEffect(
              HouseholdRecordRecipeImportDispatchInput
            )({
              admission: {
                actor: {
                  _tag: "System",
                  purpose: "import_workflow_dispatch",
                },
                organizationId: admission.organizationId,
              },
              dispatchId: committed.dispatchId,
              originalTrace: {
                correlationId: "00000000-0000-4000-8000-000000000188",
              },
              outcome: "started",
              workflowIdentity: committed.workflowIdentity,
            }).pipe(
              Effect.flatMap(householdDomain.recordRecipeImportDispatch),
              Effect.asVoid,
              Effect.orDie
            ),
        })
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
