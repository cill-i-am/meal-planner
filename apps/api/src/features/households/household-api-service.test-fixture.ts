import {
  HouseholdMemberDepartureOperation,
  MealPlanPersistenceFailure,
} from "@meal-planner/household-api";
import type {
  CancelledRecipeImportIntent,
  Recipe,
  RecipeImportAction,
  RecipeImportIntent,
  RecipeImportTimeline,
  SucceededRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import * as Cloudflare from "alchemy/Cloudflare";
import { makeWorkflowBridge } from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
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
import type {
  HouseholdAdmitImportBatchInput,
  HouseholdClaimImportBatchItemInput,
  HouseholdCompleteImportBatchItemInput,
  HouseholdFailImportBatchItemInput,
  HouseholdReadImportBatchInput,
  HouseholdRecordImportBatchDispatchInput,
} from "./batches/household-import-batch.contract.js";
import {
  HouseholdClaimAcquisitionAttemptInput,
  HouseholdCommitAcquisitionEvidenceInput,
  HouseholdMutateEvidenceStageInput,
  HouseholdObserveEvidenceReferenceInput,
  HouseholdPrepareRecipeRecoveryInput,
  HouseholdReadAcquisitionAttemptsInput,
  HouseholdReadEvidenceReferencesInput,
  HouseholdReadEvidenceStageInput,
  HouseholdReadImportTerminalCheckpointInput,
  HouseholdReadRecipeRecoveryAttemptInput,
} from "./evidence/household-evidence.contract.js";
import type {
  HouseholdClaimAcquisitionAttemptResult,
  HouseholdCommitAcquisitionEvidenceResult,
  HouseholdMutateEvidenceStageResult,
  HouseholdObserveEvidenceReferenceResult,
  HouseholdPrepareRecipeRecoveryResult,
  HouseholdReadAcquisitionAttemptsResult,
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
  makeHouseholdPeopleGateway,
  makeHouseholdPeopleRequestLayer,
  makeHouseholdRequestLayer,
} from "./household-request-composition.js";
import type {
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdPersistenceFailure } from "./household.contract.js";
import { HouseholdMemberDepartureSystemState } from "./people/household-people.contract.js";
import { makeHouseholdPeopleControlPlane } from "./people/household-people.control-plane.js";
import {
  makeMemberDepartureWorkflowStarter,
  MemberDepartureWorkflowInput,
} from "./people/member-departure.js";
import type { MemberDepartureWorkflowStarter } from "./people/member-departure.js";
import {
  coordinateMemberDeparture,
  makeMemberDepartureWorkflowPorts,
} from "./people/member-departure.workflow.js";
import type { MemberDepartureHouseholdPort } from "./people/member-departure.workflow.js";
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
  HouseholdTransitionRecipeImportLifecycleInput,
  HouseholdActiveRecipeImportActionResult,
  HouseholdAdmitRecipeImportResult,
  HouseholdRecordRecipeImportDispatchResult,
} from "./recipe-import/household-recipe-import.contract.js";
import { HouseholdRecordRecipeImportDispatchInput } from "./recipe-import/household-recipe-import.contract.js";

const baseURL = "https://meal-planner.test";

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
  readonly HOUSEHOLD_TEST_OBSERVATIONS: {
    readonly get: (key: string) => Promise<string | null>;
    readonly put: (key: string, value: string) => Promise<void>;
  };
  readonly HouseholdDomainWorker: {
    readonly admitImportBatch: (
      input: HouseholdAdmitImportBatchInput
    ) => Promise<Schema.Json>;
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
    readonly claimImportBatchItem: (
      input: HouseholdClaimImportBatchItemInput
    ) => Promise<Schema.Json>;
    readonly claimAcquisitionAttempt: (
      input: typeof HouseholdClaimAcquisitionAttemptInput.Encoded
    ) => Promise<typeof HouseholdClaimAcquisitionAttemptResult.Encoded>;
    readonly completeImportBatchItem: (
      input: HouseholdCompleteImportBatchItemInput
    ) => Promise<Schema.Json>;
    readonly commitAcquisitionEvidence: (
      input: typeof HouseholdCommitAcquisitionEvidenceInput.Encoded
    ) => Promise<typeof HouseholdCommitAcquisitionEvidenceResult.Encoded>;
    readonly mutateEvidenceStage: (
      input: typeof HouseholdMutateEvidenceStageInput.Encoded
    ) => Promise<typeof HouseholdMutateEvidenceStageResult.Encoded>;
    readonly commitRecipeImportDraft: (
      input: HouseholdCommitRecipeImportDraftInput
    ) => Promise<typeof HouseholdActiveRecipeImportActionResult.Encoded>;
    readonly confirmMemberAccessRevoked: (
      input: Parameters<
        HouseholdDomainWorkerMethods["confirmMemberAccessRevoked"]
      >[0]
    ) => Promise<Schema.Json>;
    readonly observeEvidenceReference: (
      input: typeof HouseholdObserveEvidenceReferenceInput.Encoded
    ) => Promise<typeof HouseholdObserveEvidenceReferenceResult.Encoded>;
    readonly prepareRecipeRecovery: (
      input: typeof HouseholdPrepareRecipeRecoveryInput.Encoded
    ) => Promise<typeof HouseholdPrepareRecipeRecoveryResult.Encoded>;
    readonly readEvidenceReferences: (
      input: typeof HouseholdReadEvidenceReferencesInput.Encoded
    ) => Promise<typeof HouseholdReadEvidenceReferencesResult.Encoded>;
    readonly readAcquisitionAttempts: (
      input: typeof HouseholdReadAcquisitionAttemptsInput.Encoded
    ) => Promise<typeof HouseholdReadAcquisitionAttemptsResult.Encoded>;
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
    readonly finalizeMemberDeparture: (
      input: Parameters<
        HouseholdDomainWorkerMethods["finalizeMemberDeparture"]
      >[0]
    ) => Promise<Schema.Json>;
    readonly failImportBatchItem: (
      input: HouseholdFailImportBatchItemInput
    ) => Promise<Schema.Json>;
    readonly readMealPlan: (
      input: HouseholdReadMealPlanInput
    ) => Promise<HouseholdMealPlanWire | null>;
    readonly getMemberDeparture: (
      input: Parameters<HouseholdDomainWorkerMethods["getMemberDeparture"]>[0]
    ) => Promise<Schema.Json>;
    readonly markMemberDepartureRepairRequired: (
      input: Parameters<
        HouseholdDomainWorkerMethods["markMemberDepartureRepairRequired"]
      >[0]
    ) => Promise<Schema.Json>;
    readonly readImportBatch: (
      input: HouseholdReadImportBatchInput
    ) => Promise<Schema.Json>;
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
    readonly recordImportBatchDispatch: (
      input: HouseholdRecordImportBatchDispatchInput
    ) => Promise<void>;
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
    readonly transitionRecipeImportLifecycle: (
      input: HouseholdTransitionRecipeImportLifecycleInput
    ) => Promise<typeof RecipeImportIntent.Encoded>;
  };
  readonly MemberDepartureTestWorkflow: RawMemberDepartureWorkflowBinding;
  readonly MealPlannerAuthDatabase: AnyD1Database;
}

const NativeWorkflowStatus = Schema.Struct({
  status: Schema.Literals([
    "complete",
    "errored",
    "paused",
    "queued",
    "running",
    "terminated",
    "waiting",
    "waitingForPause",
  ]),
});

interface RawMemberDepartureWorkflowInstance {
  readonly sendEvent: (event: {
    readonly payload?: Schema.Json;
    readonly type: string;
  }) => Promise<void>;
  readonly status: () => Promise<Schema.Json>;
}

interface RawMemberDepartureWorkflowBinding {
  readonly createBatch: (
    batch: readonly { readonly id?: string; readonly params?: Schema.Json }[]
  ) => Promise<readonly RawMemberDepartureWorkflowInstance[]>;
  readonly get: (id: string) => Promise<RawMemberDepartureWorkflowInstance>;
}

const testSystemOperations = [
  "claim-acquisition-attempt",
  "claim-batch-item",
  "commit-acquisition-evidence",
  "complete-batch-item",
  "commit-draft",
  "fail-batch-item",
  "mutate-evidence-stage",
  "observe-evidence-reference",
  "prepare-recipe-recovery",
  "read-acquisition-attempts",
  "read-evidence-references",
  "read-evidence-stage",
  "read-recipe-recovery-attempt",
  "read-terminal-checkpoint",
  "resolve",
  "transition-lifecycle",
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
      case "claim-acquisition-attempt": {
        result = await env.HouseholdDomainWorker.claimAcquisitionAttempt(
          Schema.decodeUnknownSync(
            Schema.toEncoded(HouseholdClaimAcquisitionAttemptInput)
          )(input)
        );
        break;
      }
      case "commit-draft": {
        result = await env.HouseholdDomainWorker.commitRecipeImportDraft(
          input as HouseholdCommitRecipeImportDraftInput
        );
        break;
      }
      case "claim-batch-item": {
        result = await env.HouseholdDomainWorker.claimImportBatchItem(
          input as HouseholdClaimImportBatchItemInput
        );
        break;
      }
      case "complete-batch-item": {
        result = await env.HouseholdDomainWorker.completeImportBatchItem(
          input as HouseholdCompleteImportBatchItemInput
        );
        break;
      }
      case "fail-batch-item": {
        result = await env.HouseholdDomainWorker.failImportBatchItem(
          input as HouseholdFailImportBatchItemInput
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
      case "read-acquisition-attempts": {
        result = await env.HouseholdDomainWorker.readAcquisitionAttempts(
          Schema.decodeUnknownSync(
            Schema.toEncoded(HouseholdReadAcquisitionAttemptsInput)
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
      case "transition-lifecycle": {
        result =
          await env.HouseholdDomainWorker.transitionRecipeImportLifecycle(
            input as HouseholdTransitionRecipeImportLifecycleInput
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

const adaptMemberDepartureWorkflowInstance = (
  instance: RawMemberDepartureWorkflowInstance
) => ({
  sendEvent: (event: {
    readonly payload?: Schema.Json;
    readonly type: string;
  }) => Effect.promise(() => instance.sendEvent(event)).pipe(Effect.orDie),
  status: () =>
    Effect.promise(() => instance.status()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(NativeWorkflowStatus)),
      Effect.orDie
    ),
});

const makeNativeMemberDepartureStarter = (env: HouseholdApiFixtureEnv) =>
  makeMemberDepartureWorkflowStarter({
    createBatch: (batch) =>
      Effect.promise(() =>
        env.MemberDepartureTestWorkflow.createBatch(batch)
      ).pipe(
        Effect.map((instances) =>
          instances.map(adaptMemberDepartureWorkflowInstance)
        ),
        Effect.orDie
      ),
    get: (id) =>
      Effect.promise(() => env.MemberDepartureTestWorkflow.get(id)).pipe(
        Effect.map(adaptMemberDepartureWorkflowInstance),
        Effect.orDie
      ),
  });

const memberDepartureWorkflowExport = {
  kind: "workflow" as const,
  make: (env: HouseholdApiFixtureEnv) =>
    Effect.succeed((rawInput: Schema.Json) =>
      Effect.gen(function* runMemberDepartureFixtureWorkflow() {
        const input = yield* Schema.decodeUnknownEffect(
          MemberDepartureWorkflowInput,
          { onExcessProperty: "error" }
        )(rawInput).pipe(Effect.orDie);
        yield* Effect.promise(() =>
          env.HOUSEHOLD_TEST_OBSERVATIONS.put(
            `member-departure-workflow:${input.organizationId}`,
            JSON.stringify(input)
          )
        );
        const household: MemberDepartureHouseholdPort = {
          confirmMemberAccessRevoked: (command) =>
            Effect.promise(() =>
              env.HouseholdDomainWorker.confirmMemberAccessRevoked(command)
            ).pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(
                  Schema.toEncoded(HouseholdMemberDepartureOperation)
                )
              ),
              Effect.orDie
            ),
          finalizeMemberDeparture: (command) =>
            Effect.promise(() =>
              env.HouseholdDomainWorker.finalizeMemberDeparture(command)
            ).pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(
                  Schema.toEncoded(HouseholdMemberDepartureOperation)
                )
              ),
              Effect.orDie
            ),
          getMemberDeparture: (command) =>
            Effect.promise(() =>
              env.HouseholdDomainWorker.getMemberDeparture(command)
            ).pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(
                  Schema.toEncoded(HouseholdMemberDepartureSystemState)
                )
              ),
              Effect.orDie
            ),
          markMemberDepartureRepairRequired: (command) =>
            Effect.promise(() =>
              env.HouseholdDomainWorker.markMemberDepartureRepairRequired(
                command
              )
            ).pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(
                  Schema.toEncoded(HouseholdMemberDepartureOperation)
                )
              ),
              Effect.orDie
            ),
        };
        const ports = makeMemberDepartureWorkflowPorts({
          authDatabase: Effect.succeed(env.MealPlannerAuthDatabase),
          household,
          input,
        });
        return yield* coordinateMemberDeparture(
          input,
          ports,
          undefined,
          "2 seconds"
        );
      })
    ),
};

const AlchemyRuntimeContractKey = "shape";
const memberDepartureEntrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({
      MemberDepartureTestWorkflow: memberDepartureWorkflowExport,
    }),
    [AlchemyRuntimeContractKey]: () => ({}),
  },
});
const MemberDepartureWorkflowBridge = makeWorkflowBridge(WorkflowEntrypoint, {
  entrypoint: memberDepartureEntrypoint,
  stack: { name: "meal-planner", stage: "test" },
})("MemberDepartureTestWorkflow");

export class MemberDepartureTestWorkflow extends MemberDepartureWorkflowBridge {}

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
    const householdDomain =
      Cloudflare.makeRpcStub<HouseholdDomainWorkerMethods>(
        env.HouseholdDomainWorker
      );
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
    const nativeDepartureWorkflow = makeNativeMemberDepartureStarter(env);
    const departureCrash = request.headers.get("x-test-member-departure-crash");
    const departureWorkflow: MemberDepartureWorkflowStarter = {
      confirmTerminal: nativeDepartureWorkflow.confirmTerminal,
      ensureStarted: (input) =>
        nativeDepartureWorkflow
          .ensureStarted(input)
          .pipe(
            Effect.andThen(
              departureCrash === "before-removal"
                ? Effect.die("Injected crash before membership removal")
                : Effect.void
            )
          ),
      signalRemovalOutcome: (input, outcome) =>
        departureCrash === "after-removal-before-signal"
          ? Effect.die("Injected crash after membership removal")
          : nativeDepartureWorkflow.signalRemovalOutcome(input, outcome),
    };
    const peopleLayer = makeHouseholdPeopleRequestLayer({
      gateway: makeHouseholdPeopleGateway({
        controlPlane: makeHouseholdPeopleControlPlane({
          auth,
          database: drizzle(env.MealPlannerAuthDatabase),
        }),
        departureWorkflow,
        domain: {
          archiveHouseholdPerson: (input) =>
            householdDomain.archiveHouseholdPerson(input),
          associateAdultInvitation: (input) =>
            householdDomain.associateAdultInvitation(input),
          bootstrapCreatorPerson: (input) =>
            Effect.promise(async () => {
              await Promise.all([
                env.HOUSEHOLD_TEST_OBSERVATIONS.put(
                  "people-bootstrap-private-invoked",
                  "true"
                ),
                env.HOUSEHOLD_TEST_OBSERVATIONS.put(
                  `people-bootstrap-private-invoked:${input.payload.mutationId}`,
                  "true"
                ),
              ]);
            }).pipe(
              Effect.flatMap(() =>
                householdDomain.bootstrapCreatorPerson(input)
              )
            ),
          cancelMemberDeparture: (input) =>
            householdDomain.cancelMemberDeparture(input),
          completeAcceptedAdultLink: (input) =>
            householdDomain.completeAcceptedAdultLink(input),
          createHouseholdPerson: (input) =>
            householdDomain.createHouseholdPerson(input),
          getHouseholdPerson: (input) =>
            householdDomain.getHouseholdPerson(input),
          getMemberDeparture: (input) =>
            householdDomain.getMemberDeparture(input),
          listHouseholdPeople: (input) =>
            householdDomain.listHouseholdPeople(input),
          prepareMemberDeparture: (input) =>
            householdDomain.prepareMemberDeparture(input),
          repairAdultAccountLink: (input) =>
            householdDomain.repairAdultAccountLink(input),
          restoreHouseholdPerson: (input) =>
            householdDomain.restoreHouseholdPerson(input),
          restoreReturningAdultLink: (input) =>
            householdDomain.restoreReturningAdultLink(input),
          retryMemberDeparture: (input) =>
            householdDomain.retryMemberDeparture(input),
          startMemberDeparture: (input) =>
            householdDomain.startMemberDeparture(input),
        },
      }),
      resolver,
    });
    const mounted = HttpRouter.toWebHandler(
      Layer.mergeAll(
        householdLayer,
        mealPlanLayer,
        peopleLayer,
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
