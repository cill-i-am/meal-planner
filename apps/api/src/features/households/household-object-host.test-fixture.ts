import {
  AssociateAdultInvitationPayload,
  BootstrapHouseholdCreatorPayload,
  CancelMemberDeparturePayload,
  CompleteAcceptedAdultLinkPayload,
  CreateHouseholdPersonPayload,
  HouseholdAssociationVersion,
  HouseholdMemberDepartureOperationId,
  HouseholdPeopleAuditActorId,
  HouseholdPeopleOperationReason,
  HouseholdPersonLinkageSubject,
  HouseholdPersonId,
  HouseholdPersonMutationId,
  HouseholdPersonVersion,
  MealPlanRecipeSnapshot,
  PrepareMemberDeparturePayload,
  RepairAdultAccountLinkPayload,
  RestoreReturningAdultLinkPayload,
  RetryMemberDeparturePayload,
} from "@meal-planner/household-api";
import { Recipe } from "@meal-planner/recipe-import-api";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import { DurableObject } from "cloudflare:workers";
import { asc, eq } from "drizzle-orm";
import { Context, Effect, Option, Schema } from "effect";

import migrations from "../../../household-migrations/migrations.js";
import { ApprovedRecipe } from "../imports/import-recipe-review.js";
import {
  MealPlan,
  MealPlanDraftId,
  MealPlanPolicy,
  MealPlanRequest,
} from "../meal-planning/meal-plan.js";
import type { MealPlanServiceError } from "../meal-planning/meal-plan.js";
import { HouseholdImportBatchQueueWriter } from "./batches/household-import-batch-queue.port.js";
import { HouseholdDispatchId } from "./foundation/import-workflow-admission.contract.js";
import { makeImportWorkflowAdmissionRepository } from "./foundation/import-workflow-admission.repository.js";
import type { HouseholdCreateMealPlanFromRecipeBankInput } from "./household-meal-plan.contract.js";
import {
  HouseholdManualMealSwapCommand,
  HouseholdMealPlanDecisionCommand,
} from "./household-meal-plan.contract.js";
import { HouseholdObjectRuntime } from "./household-object-runtime.js";
import type {
  HouseholdDomainFailure,
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdOrganizationId } from "./household.contract.js";
import {
  householdCreatorAssociationSingletonKey,
  householdMeta,
  householdMealPlans,
  householdOutbox,
  householdPeople,
  householdPersonAudits,
  householdPersonCreatorAssociations,
  householdPersonMutationReceipts,
  householdRecipes,
} from "./household.database-schema.js";
import type {
  HouseholdAssociateAdultInvitationInput,
  HouseholdBootstrapCreatorPersonInput,
  HouseholdCancelMemberDepartureInput,
  HouseholdCompleteAcceptedAdultLinkInput,
  HouseholdConfirmMemberAccessRevokedInput,
  HouseholdCreatePersonInput,
  HouseholdFinalizeMemberDepartureInput,
  HouseholdGetMemberDepartureInput,
  HouseholdGetPersonInput,
  HouseholdListPeopleInput,
  HouseholdMarkMemberDepartureRepairRequiredInput,
  HouseholdPrepareMemberDepartureInput,
  HouseholdReadMemberDepartureSystemInput,
  HouseholdRepairAdultAccountLinkInput,
  HouseholdRestoreReturningAdultLinkInput,
  HouseholdRetryMemberDepartureInput,
  HouseholdStartMemberDepartureInput,
  HouseholdTransitionPersonInput,
} from "./people/household-people.contract.js";
import {
  HouseholdAdmitRecipeImportInput,
  HouseholdAnswerRecipeImportActionInput,
  HouseholdCancelRecipeImportInput,
  HouseholdCommitRecipeImportDraftInput,
  HouseholdConfirmRecipeImportActionInput,
  HouseholdReadRecipeImportInput,
  HouseholdRecordRecipeImportDispatchInput,
  HouseholdRecipePageInput,
  HouseholdResolveRecipeImportSourceInput,
  HouseholdTransitionRecipeImportLifecycleInput,
} from "./recipe-import/household-recipe-import.contract.js";
import { makeHouseholdRecipeImportRepository } from "./recipe-import/household-recipe-import.repository.js";
import {
  HouseholdMemberAdmission,
  HouseholdPeopleCreatorAdmission,
  HouseholdPeopleMemberAdmission,
  HouseholdSystemAdmission,
} from "./rpc/command-envelope.js";
import type { HouseholdSystemPurpose } from "./rpc/command-envelope.js";
import {
  HouseholdCanonicalEncoding,
  HouseholdDigest,
  HouseholdIdentityGenerator,
} from "./shared-kernel/authority-services.js";
import { HouseholdAuthorityServicesLive } from "./shared-kernel/authority-services.live.js";

const ApprovedRecipeWire = Schema.toEncoded(ApprovedRecipe);
const MealPlanWire = Schema.toEncoded(MealPlan);
const MealPlanPolicyWire = Schema.toEncoded(MealPlanPolicy);
const MealPlanRequestWire = Schema.toEncoded(MealPlanRequest);
const ManualMealSwapRequestWire = Schema.toEncoded(
  HouseholdManualMealSwapCommand
);
const MealPlanDecisionRequestWire = Schema.toEncoded(
  HouseholdMealPlanDecisionCommand
);

const alchemyRuntimeContractKey = "shape";
const HouseholdObjectTestRuntime = Effect.gen(
  function* initializeHouseholdObjectTestRuntime() {
    const household = yield* yield* HouseholdObjectRuntime.pipe(
      Effect.provide(HouseholdAuthorityServicesLive),
      Effect.provideService(HouseholdImportBatchQueueWriter, {
        send: () => Effect.void,
      })
    );
    const canonicalEncoding = yield* HouseholdCanonicalEncoding;
    const digest = yield* HouseholdDigest;
    const durableObjectState = yield* Cloudflare.DurableObjectState;
    const database = Drizzle.DurableObject({ migrations });
    const scoped = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(
          Cloudflare.DurableObjectState,
          durableObjectState
        ),
        Effect.scoped
      );
    // eslint-disable-next-line sort-keys -- Fixture RPC follows the production runtime surface, then corruption-only probes.
    return Effect.succeed({
      ...household,
      corruptImportWorkflowDispatchState: (
        dispatchId: HouseholdDispatchId,
        state: string
      ) =>
        scoped(
          Effect.gen(function* corruptImportWorkflowDispatchState() {
            const connection = yield* database;
            yield* connection
              .update(householdOutbox)
              .set({ state })
              .where(eq(householdOutbox.dispatchId, dispatchId));
          })
        ),
      corruptHouseholdProvenanceCreatedAt: (createdAtEpochMs: number) =>
        scoped(
          Effect.gen(function* corruptHouseholdProvenanceCreatedAt() {
            const connection = yield* database;
            yield* connection
              .update(householdMeta)
              .set({ createdAtEpochMs })
              .where(eq(householdMeta.singletonKey, "household"));
          })
        ),
      confirmRecipeImportActionWithRecipeId: (
        input: typeof HouseholdConfirmRecipeImportActionInput.Type,
        recipeId: string
      ) =>
        scoped(
          Effect.gen(function* confirmWithForcedRecipeIdentity() {
            const connection = yield* database;
            return yield* makeHouseholdRecipeImportRepository(connection)
              .confirm(input)
              .pipe(
                Effect.provideService(
                  HouseholdCanonicalEncoding,
                  canonicalEncoding
                ),
                Effect.provideService(HouseholdDigest, digest),
                Effect.provideService(
                  HouseholdIdentityGenerator,
                  HouseholdIdentityGenerator.of({
                    generate: () => Effect.succeed(recipeId),
                  })
                )
              );
          })
        ),
      inspectImportWorkflowDispatch: (dispatchId: HouseholdDispatchId) =>
        scoped(
          Effect.gen(function* inspectImportWorkflowDispatch() {
            const connection = yield* database;
            const result =
              yield* makeImportWorkflowAdmissionRepository(connection).inspect(
                dispatchId
              );
            return Option.getOrNull(result);
          })
        ),
      inspectHouseholdPeopleState: () =>
        scoped(
          Effect.gen(function* inspectHouseholdPeopleState() {
            const connection = yield* database;
            const audits = yield* connection
              .select({
                command: householdPersonAudits.command,
                nextVersion: householdPersonAudits.nextVersion,
                personId: householdPersonAudits.personId,
                sequence: householdPersonAudits.sequence,
              })
              .from(householdPersonAudits)
              .orderBy(asc(householdPersonAudits.sequence));
            const associations = yield* connection
              .select()
              .from(householdPersonCreatorAssociations);
            const people = yield* connection.select().from(householdPeople);
            const receipts = yield* connection
              .select({
                mutationId: householdPersonMutationReceipts.mutationId,
              })
              .from(householdPersonMutationReceipts);
            return { associations, audits, people, receipts };
          })
        ),
      proveCreatorAssociationSingletonConstraint: () =>
        scoped(
          Effect.gen(function* proveCreatorAssociationSingletonConstraint() {
            const connection = yield* database;
            yield* connection
              .insert(householdPersonCreatorAssociations)
              .values({
                createdAtEpochMs: 1,
                linkageSubject: "a".repeat(64),
                personId: "person_00000000-0000-4000-8000-000000000001",
                singletonKey: householdCreatorAssociationSingletonKey,
              });
            const rejectedSecond = yield* connection
              .insert(householdPersonCreatorAssociations)
              .values({
                createdAtEpochMs: 2,
                linkageSubject: "b".repeat(64),
                personId: "person_00000000-0000-4000-8000-000000000002",
                singletonKey: householdCreatorAssociationSingletonKey,
              })
              .pipe(
                Effect.matchEffect({
                  onFailure: () => Effect.succeed(true),
                  onSuccess: () => Effect.succeed(false),
                })
              );
            const associations = yield* connection
              .select()
              .from(householdPersonCreatorAssociations);
            return { associations, rejectedSecond };
          })
        ),
      invokeMalformedEnsure: (payload: Schema.Json) =>
        household.ensureHousehold(payload as HouseholdEnsureInput),
      inspectMealPlanStorage: (draftId: MealPlanDraftId) =>
        scoped(
          Effect.gen(function* inspectMealPlanStorage() {
            const connection = yield* database;
            const [row] = yield* connection
              .select({
                planJson: householdMealPlans.planJson,
                requestFingerprintDigest:
                  householdMealPlans.requestFingerprintDigest,
              })
              .from(householdMealPlans)
              .where(eq(householdMealPlans.draftId, draftId))
              .limit(1);
            if (row === undefined) {
              return null;
            }
            const encoder = new TextEncoder();
            return {
              planJsonBytes: encoder.encode(row.planJson).byteLength,
              replayKeyBytes: encoder.encode(row.requestFingerprintDigest)
                .byteLength,
            };
          })
        ),
      seedApprovedRecipes: (count: number) =>
        scoped(
          Effect.gen(function* seedApprovedRecipes() {
            const connection = yield* database;
            yield* Effect.forEach(
              Array.from({ length: count }, (_, index) => index + 1),
              (index) => {
                const suffix = index.toString(16).padStart(12, "0");
                const importId = `00000000-0000-4000-8000-${suffix}`;
                const recipeId = `10000000-0000-4000-8000-${suffix}`;
                const planningRecipe = Schema.decodeUnknownSync(
                  MealPlanRecipeSnapshot
                )({
                  approvedAt: "2026-08-22T00:00:00.000Z",
                  extractionFingerprint: index.toString(16).padStart(64, "0"),
                  importId,
                  recipe: {
                    ingredientLines: [`Ingredient ${index}`],
                    instructions: [`Cook recipe ${index}.`],
                    name: `Approved recipe ${index}`,
                  },
                  source: {
                    evidenceFingerprint: (index + count)
                      .toString(16)
                      .padStart(64, "0"),
                    sourceUrl: null,
                  },
                  tags: {
                    cuisines: ["Irish"],
                    dietaryFit: "household_match",
                    difficulty: "easy",
                    leftovers: "one_meal",
                    mealTypes: ["dinner"],
                    totalTimeBand: "under_30_minutes",
                  },
                  version: 1,
                });
                const publicRecipe = Schema.decodeUnknownSync(Recipe)({
                  id: recipeId,
                  object: "recipe",
                  recipe: {
                    author: null,
                    category: null,
                    cookTimeMinutes: 10,
                    cuisine: "Irish",
                    description: null,
                    ingredientLines: [`Ingredient ${index}`],
                    ingredientQuantities: null,
                    ingredientUnits: null,
                    instructions: [`Cook recipe ${index}.`],
                    name: `Approved recipe ${index}`,
                    nutrition: null,
                    prepTimeMinutes: 5,
                    temperatureCelsius: null,
                    tools: ["Pot"],
                    totalTimeMinutes: 15,
                    yield: "2 servings",
                  },
                  tags: planningRecipe.tags,
                });
                return connection.insert(householdRecipes).values({
                  importId,
                  planningRecipeJson: Schema.encodeSync(
                    Schema.fromJsonString(MealPlanRecipeSnapshot)
                  )(planningRecipe),
                  publicRecipeJson: Schema.encodeSync(
                    Schema.fromJsonString(Recipe)
                  )(publicRecipe),
                  publishedAt: "2026-08-22T00:00:00.000Z",
                  recipeId,
                  version: 1,
                });
              },
              { discard: true }
            );
          })
        ),
    });
  }
);
const BrokenMigrationObjectTestRuntime = Effect.gen(
  function* initializeBrokenMigrationObject() {
    const durableObjectState = yield* Cloudflare.DurableObjectState;
    const database = Drizzle.DurableObject({
      migrations: {
        migrations: {
          intentionally_broken: "CREATE TABLE broken_foundation(;",
        },
      },
    });
    return Effect.succeed({
      probe: () =>
        database.pipe(
          Effect.provideService(
            Cloudflare.DurableObjectState,
            durableObjectState
          ),
          Effect.scoped,
          Effect.as("unexpected-success")
        ),
    });
  }
);
const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({
      BrokenMigrationObject: {
        constructor: BrokenMigrationObjectTestRuntime,
        services: Context.empty(),
      },
      HouseholdObject: {
        constructor: HouseholdObjectTestRuntime.pipe(
          Effect.provide(HouseholdAuthorityServicesLive)
        ),
        services: Context.empty(),
      },
    }),
    [alchemyRuntimeContractKey]: () => ({}),
  },
});
const HouseholdObjectBridge = Cloudflare.makeDurableObjectBridge(
  DurableObject,
  {
    entrypoint,
    stack: { name: "MealPlanner", stage: "test-household" },
  }
)("HouseholdObject");

export class HouseholdObject extends HouseholdObjectBridge {}

const BrokenMigrationObjectBridge = Cloudflare.makeDurableObjectBridge(
  DurableObject,
  {
    entrypoint,
    stack: { name: "MealPlanner", stage: "test-household" },
  }
)("BrokenMigrationObject");

// eslint-disable-next-line max-classes-per-file -- The installed fixture exports both production and deliberately broken migration classes.
export class BrokenMigrationObject extends BrokenMigrationObjectBridge {}

interface HouseholdObjectClient {
  readonly associateAdultInvitation: (
    input: HouseholdAssociateAdultInvitationInput
  ) => Effect.Effect<unknown, unknown>;
  readonly archiveHouseholdPerson: (
    input: HouseholdTransitionPersonInput
  ) => Effect.Effect<unknown, unknown>;
  readonly admitRecipeImport: (
    input: typeof HouseholdAdmitRecipeImportInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly answerRecipeImportAction: (
    input: typeof HouseholdAnswerRecipeImportActionInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly bootstrapCreatorPerson: (
    input: HouseholdBootstrapCreatorPersonInput
  ) => Effect.Effect<unknown, unknown>;
  readonly cancelMemberDeparture: (
    input: HouseholdCancelMemberDepartureInput
  ) => Effect.Effect<unknown, unknown>;
  readonly approveMealPlan: (input: {
    readonly admission: HouseholdMemberAdmission;
    readonly request: typeof MealPlanDecisionRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly createMealPlan: (input: {
    readonly admission: HouseholdMemberAdmission;
    readonly approvedRecipes: readonly (typeof ApprovedRecipeWire.Type)[];
    readonly policy: typeof MealPlanPolicyWire.Type;
    readonly request: typeof MealPlanRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly createMealPlanFromRecipeBank: (
    input: typeof HouseholdCreateMealPlanFromRecipeBankInput.Type
  ) => Effect.Effect<typeof MealPlanWire.Type, unknown>;
  readonly createHouseholdPerson: (
    input: HouseholdCreatePersonInput
  ) => Effect.Effect<unknown, unknown>;
  readonly completeAcceptedAdultLink: (
    input: HouseholdCompleteAcceptedAdultLinkInput
  ) => Effect.Effect<unknown, unknown>;
  readonly confirmMemberAccessRevoked: (
    input: HouseholdConfirmMemberAccessRevokedInput
  ) => Effect.Effect<unknown, unknown>;
  readonly finalizeMemberDeparture: (
    input: HouseholdFinalizeMemberDepartureInput
  ) => Effect.Effect<unknown, unknown>;
  readonly commitRecipeImportDraft: (
    input: typeof HouseholdCommitRecipeImportDraftInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly cancelRecipeImport: (
    input: typeof HouseholdCancelRecipeImportInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly confirmRecipeImportAction: (
    input: typeof HouseholdConfirmRecipeImportActionInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly confirmRecipeImportActionWithRecipeId: (
    input: typeof HouseholdConfirmRecipeImportActionInput.Type,
    recipeId: string
  ) => Effect.Effect<unknown, unknown>;
  readonly corruptImportWorkflowDispatchState: (
    dispatchId: typeof HouseholdDispatchId.Type,
    state: string
  ) => Effect.Effect<void, unknown>;
  readonly corruptHouseholdProvenanceCreatedAt: (
    createdAtEpochMs: number
  ) => Effect.Effect<void, unknown>;
  readonly ensureHousehold: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
  readonly getHouseholdPerson: (
    input: HouseholdGetPersonInput
  ) => Effect.Effect<unknown, unknown>;
  readonly getMemberDeparture: (
    input:
      | HouseholdGetMemberDepartureInput
      | HouseholdReadMemberDepartureSystemInput
  ) => Effect.Effect<unknown, unknown>;
  readonly listHouseholdPeople: (
    input: HouseholdListPeopleInput
  ) => Effect.Effect<unknown, unknown>;
  readonly markMemberDepartureRepairRequired: (
    input: HouseholdMarkMemberDepartureRepairRequiredInput
  ) => Effect.Effect<unknown, unknown>;
  readonly prepareMemberDeparture: (
    input: HouseholdPrepareMemberDepartureInput
  ) => Effect.Effect<unknown, unknown>;
  readonly repairAdultAccountLink: (
    input: HouseholdRepairAdultAccountLinkInput
  ) => Effect.Effect<unknown, unknown>;
  readonly inspectImportWorkflowDispatch: (
    dispatchId: typeof HouseholdDispatchId.Type
  ) => Effect.Effect<unknown>;
  readonly inspectHouseholdPeopleState: () => Effect.Effect<unknown>;
  readonly proveCreatorAssociationSingletonConstraint: () => Effect.Effect<unknown>;
  readonly inspectMealPlanStorage: (draftId: MealPlanDraftId) => Effect.Effect<{
    readonly planJsonBytes: number;
    readonly replayKeyBytes: number;
  } | null>;
  readonly invokeMalformedEnsure: (
    payload: Schema.Json
  ) => Effect.Effect<unknown, HouseholdDomainFailure>;
  readonly readMealPlan: (input: {
    readonly admission: HouseholdMemberAdmission;
    readonly draftId: MealPlanDraftId;
  }) => Effect.Effect<
    typeof MealPlanWire.Type | null,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly readRecipeImport: (
    input: typeof HouseholdReadRecipeImportInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly recordRecipeImportDispatch: (
    input: typeof HouseholdRecordRecipeImportDispatchInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly rejectMealPlan: (input: {
    readonly admission: HouseholdMemberAdmission;
    readonly request: typeof MealPlanDecisionRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly restoreHouseholdPerson: (
    input: HouseholdTransitionPersonInput
  ) => Effect.Effect<unknown, unknown>;
  readonly restoreReturningAdultLink: (
    input: HouseholdRestoreReturningAdultLinkInput
  ) => Effect.Effect<unknown, unknown>;
  readonly retryMemberDeparture: (
    input: HouseholdRetryMemberDepartureInput
  ) => Effect.Effect<unknown, unknown>;
  readonly startMemberDeparture: (
    input: HouseholdStartMemberDepartureInput
  ) => Effect.Effect<unknown, unknown>;
  readonly resolveRecipeImportSource: (
    input: typeof HouseholdResolveRecipeImportSourceInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly transitionRecipeImportLifecycle: (
    input: typeof HouseholdTransitionRecipeImportLifecycleInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly listRecipeBank: (
    input: typeof HouseholdRecipePageInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly seedApprovedRecipes: (count: number) => Effect.Effect<void, unknown>;
  readonly swapMealPlan: (input: {
    readonly admission: HouseholdMemberAdmission;
    readonly approvedRecipes: readonly (typeof ApprovedRecipeWire.Type)[];
    readonly request: typeof ManualMealSwapRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
}

const HouseholdTestCommand = Schema.Union([
  Schema.Struct({
    actorId: Schema.String,
    invitationDigest: AssociateAdultInvitationPayload.fields.invitationDigest,
    invitationRequestDigest:
      AssociateAdultInvitationPayload.fields.invitationRequestDigest,
    linkageSubject: Schema.String,
    mutationId: HouseholdPersonMutationId,
    objectName: Schema.String,
    operation: Schema.Literal("associateAdultInvitation"),
    organizationId: HouseholdOrganizationId,
    personId: HouseholdPersonId,
  }),
  Schema.Struct({
    actorId: Schema.String,
    invitationDigest: CompleteAcceptedAdultLinkPayload.fields.invitationDigest,
    linkageSubject: Schema.String,
    mutationId: HouseholdPersonMutationId,
    objectName: Schema.String,
    operation: Schema.Literal("completeAcceptedAdultLink"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    actorId: Schema.String,
    expectedPersonVersion:
      RepairAdultAccountLinkPayload.fields.expectedPersonVersion,
    linkageSubject: Schema.String,
    mutationId: HouseholdPersonMutationId,
    objectName: Schema.String,
    operation: Schema.Literal("repairAdultAccountLink"),
    organizationId: HouseholdOrganizationId,
    personId: HouseholdPersonId,
    reason: HouseholdPeopleOperationReason,
    targetLinkageSubject: Schema.String,
  }),
  Schema.Struct({
    actorId: Schema.String,
    expectedLinkVersion:
      PrepareMemberDeparturePayload.fields.expectedLinkVersion,
    expectedPersonVersion:
      PrepareMemberDeparturePayload.fields.expectedPersonVersion,
    linkageSubject: Schema.String,
    mutationId: HouseholdPersonMutationId,
    objectName: Schema.String,
    operation: Schema.Literal("prepareMemberDeparture"),
    organizationId: HouseholdOrganizationId,
    personId: HouseholdPersonId,
    reason: HouseholdPeopleOperationReason,
    targetLinkageSubject: Schema.String,
  }),
  Schema.Struct({
    actorId: Schema.String,
    expectedOperationVersion: HouseholdAssociationVersion,
    linkageSubject: Schema.String,
    objectName: Schema.String,
    operation: Schema.Literal("startMemberDeparture"),
    operationId: HouseholdMemberDepartureOperationId,
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    actorId: Schema.String,
    expectedOperationVersion:
      CancelMemberDeparturePayload.fields.expectedOperationVersion,
    linkageSubject: Schema.String,
    mutationId: HouseholdPersonMutationId,
    objectName: Schema.String,
    operation: Schema.Literal("cancelMemberDeparture"),
    operationId: HouseholdMemberDepartureOperationId,
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    actorId: Schema.String,
    expectedOperationVersion:
      RetryMemberDeparturePayload.fields.expectedOperationVersion,
    linkageSubject: Schema.String,
    mutationId: HouseholdPersonMutationId,
    objectName: Schema.String,
    operation: Schema.Literal("retryMemberDeparture"),
    operationId: HouseholdMemberDepartureOperationId,
    organizationId: HouseholdOrganizationId,
    reason: HouseholdPeopleOperationReason,
    targetLinkageSubject: Schema.NullOr(HouseholdPersonLinkageSubject),
  }),
  Schema.Struct({
    actorId: Schema.String,
    linkageSubject: Schema.String,
    objectName: Schema.String,
    operation: Schema.Literal("getMemberDeparture"),
    operationId: HouseholdMemberDepartureOperationId,
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    expectedOperationVersion: HouseholdAssociationVersion,
    objectName: Schema.String,
    operation: Schema.Literals([
      "confirmMemberAccessRevoked",
      "finalizeMemberDeparture",
    ]),
    operationId: HouseholdMemberDepartureOperationId,
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    expectedOperationVersion: HouseholdAssociationVersion,
    objectName: Schema.String,
    operation: Schema.Literal("markMemberDepartureRepairRequired"),
    operationId: HouseholdMemberDepartureOperationId,
    organizationId: HouseholdOrganizationId,
    phase: Schema.Literals(["finalization", "revocation"]),
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("readMemberDepartureSystem"),
    operationId: HouseholdMemberDepartureOperationId,
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    actorId: Schema.String,
    expectedPersonVersion:
      RestoreReturningAdultLinkPayload.fields.expectedPersonVersion,
    invitationDigest: RestoreReturningAdultLinkPayload.fields.invitationDigest,
    linkageSubject: Schema.String,
    mutationId: HouseholdPersonMutationId,
    objectName: Schema.String,
    operation: Schema.Literal("restoreReturningAdultLink"),
    organizationId: HouseholdOrganizationId,
    personId: HouseholdPersonId,
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("inspectHouseholdPeopleState"),
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("proveCreatorAssociationSingletonConstraint"),
  }),
  Schema.Struct({
    actorId: Schema.String,
    displayName: BootstrapHouseholdCreatorPayload.fields.displayName,
    linkageSubject: Schema.String,
    mutationId: HouseholdPersonMutationId,
    objectName: Schema.String,
    operation: Schema.Literals([
      "bootstrapCreatorPerson",
      "bootstrapCreatorPersonAsMember",
    ]),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    actorId: Schema.String,
    displayName: CreateHouseholdPersonPayload.fields.displayName,
    kind: CreateHouseholdPersonPayload.fields.kind,
    linkageSubject: Schema.String,
    mutationId: HouseholdPersonMutationId,
    objectName: Schema.String,
    operation: Schema.Literal("createHouseholdPerson"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    actorId: Schema.String,
    includeArchived: Schema.Boolean,
    linkageSubject: Schema.String,
    objectName: Schema.String,
    operation: Schema.Literal("listHouseholdPeople"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    actorId: Schema.String,
    linkageSubject: Schema.String,
    objectName: Schema.String,
    operation: Schema.Literal("getHouseholdPerson"),
    organizationId: HouseholdOrganizationId,
    personId: HouseholdPersonId,
  }),
  Schema.Struct({
    actorId: Schema.String,
    expectedVersion: HouseholdPersonVersion,
    linkageSubject: Schema.String,
    mutationId: HouseholdPersonMutationId,
    objectName: Schema.String,
    operation: Schema.Literals([
      "archiveHouseholdPerson",
      "restoreHouseholdPerson",
    ]),
    organizationId: HouseholdOrganizationId,
    personId: HouseholdPersonId,
  }),
  Schema.Struct({
    actionId: HouseholdAnswerRecipeImportActionInput.fields.actionId,
    answers:
      HouseholdAnswerRecipeImportActionInput.fields.request.fields.answers,
    expectedActionVersion:
      HouseholdAnswerRecipeImportActionInput.fields.request.fields
        .expectedActionVersion,
    idempotencyKey:
      HouseholdAnswerRecipeImportActionInput.fields.idempotencyKey,
    intentId: HouseholdAnswerRecipeImportActionInput.fields.intentId,
    objectName: Schema.String,
    operation: Schema.Literal("answerRecipeImportAction"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    expectedIntentVersion:
      HouseholdCancelRecipeImportInput.fields.request.fields
        .expectedIntentVersion,
    idempotencyKey: HouseholdCancelRecipeImportInput.fields.idempotencyKey,
    intentId: HouseholdCancelRecipeImportInput.fields.intentId,
    objectName: Schema.String,
    operation: Schema.Literal("cancelRecipeImport"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    actionId: HouseholdConfirmRecipeImportActionInput.fields.actionId,
    expectedActionVersion:
      HouseholdConfirmRecipeImportActionInput.fields.request.fields
        .expectedActionVersion,
    idempotencyKey:
      HouseholdConfirmRecipeImportActionInput.fields.idempotencyKey,
    intentId: HouseholdConfirmRecipeImportActionInput.fields.intentId,
    objectName: Schema.String,
    operation: Schema.Literal("confirmRecipeImportActionWithRecipeId"),
    organizationId: HouseholdOrganizationId,
    recipeId: Recipe.fields.id,
  }),
  Schema.Struct({
    byteLimit: HouseholdRecipePageInput.fields.byteLimit,
    cursor: HouseholdRecipePageInput.fields.cursor,
    limit: HouseholdRecipePageInput.fields.limit,
    objectName: Schema.String,
    operation: Schema.Literal("listRecipeBank"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    intentId: HouseholdReadRecipeImportInput.fields.intentId,
    objectName: Schema.String,
    operation: Schema.Literal("readRecipeImport"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    idempotencyKey: HouseholdAdmitRecipeImportInput.fields.idempotencyKey,
    objectName: Schema.String,
    operation: Schema.Literal("admitRecipeImport"),
    organizationId: HouseholdOrganizationId,
    source: HouseholdAdmitRecipeImportInput.fields.source,
  }),
  Schema.Struct({
    createdAtEpochMs: Schema.Int,
    objectName: Schema.String,
    operation: Schema.Literal("corruptHouseholdProvenanceCreatedAt"),
  }),
  Schema.Struct({
    dispatchId: HouseholdDispatchId,
    objectName: Schema.String,
    operation: Schema.Literal("corruptImportWorkflowDispatchState"),
    state: Schema.String,
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("probeMigrationFailure"),
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("approveMealPlan"),
    organizationId: HouseholdOrganizationId,
    request: MealPlanDecisionRequestWire,
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("ensure"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    evidenceFingerprint:
      HouseholdCommitRecipeImportDraftInput.fields.evidenceFingerprint,
    expectedGeneration:
      HouseholdCommitRecipeImportDraftInput.fields.expectedGeneration,
    extractionFingerprint:
      HouseholdCommitRecipeImportDraftInput.fields.extractionFingerprint,
    intentId: HouseholdCommitRecipeImportDraftInput.fields.intentId,
    mutationId: HouseholdCommitRecipeImportDraftInput.fields.mutationId,
    objectName: Schema.String,
    operation: Schema.Literal("commitRecipeImportDraft"),
    organizationId: HouseholdOrganizationId,
    review: HouseholdCommitRecipeImportDraftInput.fields.review,
  }),
  Schema.Struct({
    actionId: HouseholdConfirmRecipeImportActionInput.fields.actionId,
    expectedActionVersion:
      HouseholdConfirmRecipeImportActionInput.fields.request.fields
        .expectedActionVersion,
    idempotencyKey:
      HouseholdConfirmRecipeImportActionInput.fields.idempotencyKey,
    intentId: HouseholdConfirmRecipeImportActionInput.fields.intentId,
    objectName: Schema.String,
    operation: Schema.Literal("confirmRecipeImportAction"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    approvedRecipes: Schema.Array(ApprovedRecipeWire),
    objectName: Schema.String,
    operation: Schema.Literal("createMealPlan"),
    organizationId: HouseholdOrganizationId,
    policy: MealPlanPolicyWire,
    request: MealPlanRequestWire,
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("createMealPlanFromRecipeBank"),
    organizationId: HouseholdOrganizationId,
    policy: MealPlanPolicyWire,
    request: MealPlanRequestWire,
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("invokeMalformedEnsure"),
    payload: Schema.Json,
  }),
  Schema.Struct({
    dispatchId: HouseholdDispatchId,
    objectName: Schema.String,
    operation: Schema.Literal("inspectImportWorkflowDispatch"),
  }),
  Schema.Struct({
    draftId: MealPlanDraftId,
    objectName: Schema.String,
    operation: Schema.Literal("inspectMealPlanStorage"),
  }),
  Schema.Struct({
    dispatchId: HouseholdRecordRecipeImportDispatchInput.fields.dispatchId,
    objectName: Schema.String,
    operation: Schema.Literal("recordRecipeImportDispatch"),
    organizationId: HouseholdOrganizationId,
    originalTrace:
      HouseholdRecordRecipeImportDispatchInput.fields.originalTrace,
    outcome: HouseholdRecordRecipeImportDispatchInput.fields.outcome,
    workflowIdentity:
      HouseholdRecordRecipeImportDispatchInput.fields.workflowIdentity,
  }),
  Schema.Struct({
    count: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
    objectName: Schema.String,
    operation: Schema.Literal("seedApprovedRecipes"),
  }),
  Schema.Struct({
    draftId: MealPlanDraftId,
    objectName: Schema.String,
    operation: Schema.Literal("readMealPlan"),
    organizationId: HouseholdOrganizationId,
  }),
  Schema.Struct({
    objectName: Schema.String,
    operation: Schema.Literal("rejectMealPlan"),
    organizationId: HouseholdOrganizationId,
    request: MealPlanDecisionRequestWire,
  }),
  Schema.Struct({
    canonicalSourceId:
      HouseholdResolveRecipeImportSourceInput.fields.canonicalSourceId,
    canonicalUrl: HouseholdResolveRecipeImportSourceInput.fields.canonicalUrl,
    expectedGeneration:
      HouseholdResolveRecipeImportSourceInput.fields.expectedGeneration,
    intentId: HouseholdResolveRecipeImportSourceInput.fields.intentId,
    mutationId: HouseholdResolveRecipeImportSourceInput.fields.mutationId,
    objectName: Schema.String,
    operation: Schema.Literal("resolveRecipeImportSource"),
    organizationId: HouseholdOrganizationId,
    sourceKind: HouseholdResolveRecipeImportSourceInput.fields.sourceKind,
  }),
  Schema.Struct({
    expectedGeneration:
      HouseholdTransitionRecipeImportLifecycleInput.fields.expectedGeneration,
    intentId: HouseholdTransitionRecipeImportLifecycleInput.fields.intentId,
    objectName: Schema.String,
    operation: Schema.Literal("transitionRecipeImportLifecycle"),
    organizationId: HouseholdOrganizationId,
    transition: HouseholdTransitionRecipeImportLifecycleInput.fields.transition,
  }),
  Schema.Struct({
    approvedRecipes: Schema.Array(ApprovedRecipeWire),
    objectName: Schema.String,
    operation: Schema.Literal("swapMealPlan"),
    organizationId: HouseholdOrganizationId,
    request: ManualMealSwapRequestWire,
  }),
]);

interface HouseholdTestEnv {
  readonly BrokenMigrationObject: {
    readonly getByName: (name: string) => object;
  };
  readonly HouseholdObject: {
    readonly getByName: (name: string) => object;
  };
}

const memberAdmission = (
  organizationId: typeof HouseholdOrganizationId.Type,
  actorId = "a".repeat(64)
) =>
  Schema.decodeUnknownSync(HouseholdMemberAdmission)({
    actor: { _tag: "Member", actorId },
    organizationId,
  });

const peopleMemberAdmission = (
  organizationId: typeof HouseholdOrganizationId.Type,
  actorId: string,
  linkageSubject: string
) =>
  Schema.decodeUnknownSync(HouseholdPeopleMemberAdmission)({
    actor: {
      _tag: "PeopleMember",
      actorId: Schema.decodeUnknownSync(HouseholdPeopleAuditActorId)(actorId),
      linkageSubject: Schema.decodeUnknownSync(HouseholdPersonLinkageSubject)(
        linkageSubject
      ),
    },
    organizationId,
  });

const peopleCreatorAdmission = (
  organizationId: typeof HouseholdOrganizationId.Type,
  actorId: string,
  linkageSubject: string
) =>
  Schema.decodeUnknownSync(HouseholdPeopleCreatorAdmission)({
    actor: {
      _tag: "PeopleCreator",
      actorId: Schema.decodeUnknownSync(HouseholdPeopleAuditActorId)(actorId),
      authority: "better_auth_owner",
      linkageSubject: Schema.decodeUnknownSync(HouseholdPersonLinkageSubject)(
        linkageSubject
      ),
    },
    organizationId,
  });

const systemAdmission = (
  organizationId: typeof HouseholdOrganizationId.Type,
  purpose: typeof HouseholdSystemPurpose.Type = "import_workflow_dispatch"
) =>
  Schema.decodeUnknownSync(HouseholdSystemAdmission)({
    actor: { _tag: "System", purpose },
    organizationId,
  });

const respond = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: (error) => Response.json({ error, ok: false }),
        onSuccess: (value) => Response.json({ ok: true, value }),
      })
    )
  );

const routeRecipeImportTestCommand = (
  household: HouseholdObjectClient,
  command: typeof HouseholdTestCommand.Type
) => {
  if (command.operation === "admitRecipeImport") {
    return respond(
      household.admitRecipeImport({
        admission: memberAdmission(command.organizationId),
        idempotencyKey: command.idempotencyKey,
        source: command.source,
      })
    );
  }
  if (command.operation === "answerRecipeImportAction") {
    return respond(
      household.answerRecipeImportAction({
        actionId: command.actionId,
        admission: memberAdmission(command.organizationId),
        idempotencyKey: command.idempotencyKey,
        intentId: command.intentId,
        request: {
          answers: command.answers,
          expectedActionVersion: command.expectedActionVersion,
        },
      })
    );
  }
  if (command.operation === "commitRecipeImportDraft") {
    return respond(
      household.commitRecipeImportDraft({
        admission: systemAdmission(
          command.organizationId,
          "recipe_import_lifecycle_commit"
        ),
        evidenceFingerprint: command.evidenceFingerprint,
        expectedGeneration: command.expectedGeneration,
        extractionFingerprint: command.extractionFingerprint,
        intentId: command.intentId,
        mutationId: command.mutationId,
        review: command.review,
      })
    );
  }
  if (command.operation === "cancelRecipeImport") {
    return respond(
      household.cancelRecipeImport({
        admission: memberAdmission(command.organizationId),
        idempotencyKey: command.idempotencyKey,
        intentId: command.intentId,
        request: { expectedIntentVersion: command.expectedIntentVersion },
      })
    );
  }
  if (command.operation === "confirmRecipeImportAction") {
    return respond(
      household.confirmRecipeImportAction({
        actionId: command.actionId,
        admission: memberAdmission(command.organizationId),
        idempotencyKey: command.idempotencyKey,
        intentId: command.intentId,
        request: { expectedActionVersion: command.expectedActionVersion },
      })
    );
  }
  if (command.operation === "confirmRecipeImportActionWithRecipeId") {
    return respond(
      household.confirmRecipeImportActionWithRecipeId(
        {
          actionId: command.actionId,
          admission: memberAdmission(command.organizationId),
          idempotencyKey: command.idempotencyKey,
          intentId: command.intentId,
          request: { expectedActionVersion: command.expectedActionVersion },
        },
        command.recipeId
      )
    );
  }
  if (command.operation === "recordRecipeImportDispatch") {
    return respond(
      household.recordRecipeImportDispatch({
        admission: systemAdmission(command.organizationId),
        dispatchId: command.dispatchId,
        originalTrace: command.originalTrace,
        outcome: command.outcome,
        workflowIdentity: command.workflowIdentity,
      })
    );
  }
  if (command.operation === "readRecipeImport") {
    return respond(
      household.readRecipeImport({
        admission: memberAdmission(command.organizationId),
        intentId: command.intentId,
      })
    );
  }
  if (command.operation === "resolveRecipeImportSource") {
    return respond(
      household.resolveRecipeImportSource({
        admission: systemAdmission(
          command.organizationId,
          "recipe_import_lifecycle_commit"
        ),
        canonicalSourceId: command.canonicalSourceId,
        canonicalUrl: command.canonicalUrl,
        expectedGeneration: command.expectedGeneration,
        intentId: command.intentId,
        mutationId: command.mutationId,
        sourceKind: command.sourceKind,
      })
    );
  }
  if (command.operation === "transitionRecipeImportLifecycle") {
    return respond(
      household.transitionRecipeImportLifecycle({
        admission: systemAdmission(
          command.organizationId,
          "recipe_import_lifecycle_commit"
        ),
        expectedGeneration: command.expectedGeneration,
        intentId: command.intentId,
        transition: command.transition,
      })
    );
  }
  return null;
};

const routeHouseholdAdministrationTestCommand = (
  household: HouseholdObjectClient,
  command: typeof HouseholdTestCommand.Type
) => {
  if (command.operation === "corruptImportWorkflowDispatchState") {
    return respond(
      household.corruptImportWorkflowDispatchState(
        command.dispatchId,
        command.state
      )
    );
  }
  if (command.operation === "corruptHouseholdProvenanceCreatedAt") {
    return respond(
      household.corruptHouseholdProvenanceCreatedAt(command.createdAtEpochMs)
    );
  }
  if (command.operation === "ensure") {
    return respond(
      household.ensureHousehold({
        admission: memberAdmission(command.organizationId),
      })
    );
  }
  if (command.operation === "inspectImportWorkflowDispatch") {
    return respond(household.inspectImportWorkflowDispatch(command.dispatchId));
  }
  if (command.operation === "inspectHouseholdPeopleState") {
    return respond(household.inspectHouseholdPeopleState());
  }
  if (command.operation === "proveCreatorAssociationSingletonConstraint") {
    return respond(household.proveCreatorAssociationSingletonConstraint());
  }
  if (command.operation === "invokeMalformedEnsure") {
    return respond(household.invokeMalformedEnsure(command.payload));
  }
  if (command.operation === "listRecipeBank") {
    return respond(
      household.listRecipeBank({
        admission: memberAdmission(command.organizationId),
        byteLimit: command.byteLimit,
        cursor: command.cursor,
        limit: command.limit,
      })
    );
  }
  if (command.operation === "seedApprovedRecipes") {
    return respond(household.seedApprovedRecipes(command.count));
  }
  return null;
};

const routeHouseholdAssociationTestCommand = (
  household: HouseholdObjectClient,
  command: typeof HouseholdTestCommand.Type
) => {
  if (command.operation === "associateAdultInvitation") {
    return respond(
      household.associateAdultInvitation({
        admission: peopleCreatorAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        payload: {
          invitationDigest: command.invitationDigest,
          invitationRequestDigest: command.invitationRequestDigest,
          mutationId: command.mutationId,
          personId: command.personId,
        },
      })
    );
  }
  if (command.operation === "completeAcceptedAdultLink") {
    return respond(
      household.completeAcceptedAdultLink({
        admission: peopleMemberAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        payload: {
          invitationDigest: command.invitationDigest,
          mutationId: command.mutationId,
        },
      })
    );
  }
  if (command.operation === "repairAdultAccountLink") {
    return respond(
      household.repairAdultAccountLink({
        admission: peopleCreatorAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        payload: {
          expectedPersonVersion: command.expectedPersonVersion,
          mutationId: command.mutationId,
          personId: command.personId,
          reason: command.reason,
        },
        targetLinkageSubject: Schema.decodeUnknownSync(
          HouseholdPersonLinkageSubject
        )(command.targetLinkageSubject),
      })
    );
  }
  return null;
};

const routeDepartureFinalizationTestCommand = (
  household: HouseholdObjectClient,
  command: typeof HouseholdTestCommand.Type
) => {
  if (command.operation === "getMemberDeparture") {
    return respond(
      household.getMemberDeparture({
        admission: peopleMemberAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        operationId: command.operationId,
      })
    );
  }
  if (command.operation === "readMemberDepartureSystem") {
    return respond(
      household.getMemberDeparture({
        admission: systemAdmission(
          command.organizationId,
          "member_departure_finalize"
        ),
        operationId: command.operationId,
      })
    );
  }
  if (command.operation === "confirmMemberAccessRevoked") {
    return respond(
      household.confirmMemberAccessRevoked({
        admission: systemAdmission(
          command.organizationId,
          "member_departure_finalize"
        ),
        expectedOperationVersion: command.expectedOperationVersion,
        operationId: command.operationId,
      })
    );
  }
  if (command.operation === "finalizeMemberDeparture") {
    return respond(
      household.finalizeMemberDeparture({
        admission: systemAdmission(
          command.organizationId,
          "member_departure_finalize"
        ),
        expectedOperationVersion: command.expectedOperationVersion,
        operationId: command.operationId,
      })
    );
  }
  if (command.operation === "markMemberDepartureRepairRequired") {
    return respond(
      household.markMemberDepartureRepairRequired({
        admission: systemAdmission(
          command.organizationId,
          "member_departure_finalize"
        ),
        expectedOperationVersion: command.expectedOperationVersion,
        operationId: command.operationId,
        phase: command.phase,
      })
    );
  }
  return null;
};

const routeHouseholdPeopleTestCommand = (
  household: HouseholdObjectClient,
  command: typeof HouseholdTestCommand.Type
) => {
  const associationResponse = routeHouseholdAssociationTestCommand(
    household,
    command
  );
  if (associationResponse !== null) {
    return associationResponse;
  }
  const finalizationResponse = routeDepartureFinalizationTestCommand(
    household,
    command
  );
  if (finalizationResponse !== null) {
    return finalizationResponse;
  }
  if (command.operation === "prepareMemberDeparture") {
    return respond(
      household.prepareMemberDeparture({
        admission: peopleMemberAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        payload: {
          expectedLinkVersion: command.expectedLinkVersion,
          expectedPersonVersion: command.expectedPersonVersion,
          mutationId: command.mutationId,
          personId: command.personId,
          reason: command.reason,
        },
        targetLinkageSubject: Schema.decodeUnknownSync(
          HouseholdPersonLinkageSubject
        )(command.targetLinkageSubject),
      })
    );
  }
  if (command.operation === "startMemberDeparture") {
    return respond(
      household.startMemberDeparture({
        admission: peopleMemberAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        expectedOperationVersion: command.expectedOperationVersion,
        operationId: command.operationId,
      })
    );
  }
  if (command.operation === "cancelMemberDeparture") {
    return respond(
      household.cancelMemberDeparture({
        admission: peopleMemberAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        operationId: command.operationId,
        payload: {
          expectedOperationVersion: command.expectedOperationVersion,
          mutationId: command.mutationId,
        },
      })
    );
  }
  if (command.operation === "retryMemberDeparture") {
    return respond(
      household.retryMemberDeparture({
        admission: peopleMemberAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        operationId: command.operationId,
        payload: {
          expectedOperationVersion: command.expectedOperationVersion,
          mutationId: command.mutationId,
          reason: command.reason,
        },
        targetLinkageSubject: command.targetLinkageSubject,
      })
    );
  }
  if (command.operation === "restoreReturningAdultLink") {
    return respond(
      household.restoreReturningAdultLink({
        admission: peopleMemberAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        payload: {
          expectedPersonVersion: command.expectedPersonVersion,
          invitationDigest: command.invitationDigest,
          mutationId: command.mutationId,
          personId: command.personId,
        },
      })
    );
  }
  if (command.operation === "bootstrapCreatorPerson") {
    return respond(
      household.bootstrapCreatorPerson({
        admission: peopleCreatorAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        payload: {
          displayName: command.displayName,
          mutationId: command.mutationId,
        },
      })
    );
  }
  if (command.operation === "bootstrapCreatorPersonAsMember") {
    return respond(
      household.bootstrapCreatorPerson({
        admission: peopleMemberAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        payload: {
          displayName: command.displayName,
          mutationId: command.mutationId,
        },
      } as never)
    );
  }
  if (command.operation === "createHouseholdPerson") {
    return respond(
      household.createHouseholdPerson({
        admission: peopleMemberAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        payload: {
          displayName: command.displayName,
          kind: command.kind,
          mutationId: command.mutationId,
        },
      })
    );
  }
  if (command.operation === "listHouseholdPeople") {
    return respond(
      household.listHouseholdPeople({
        admission: peopleMemberAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        query: { includeArchived: command.includeArchived ? "true" : "false" },
      })
    );
  }
  if (command.operation === "getHouseholdPerson") {
    return respond(
      household.getHouseholdPerson({
        admission: peopleMemberAdmission(
          command.organizationId,
          command.actorId,
          command.linkageSubject
        ),
        personId: command.personId,
      })
    );
  }
  if (
    command.operation === "archiveHouseholdPerson" ||
    command.operation === "restoreHouseholdPerson"
  ) {
    const input = {
      admission: peopleMemberAdmission(
        command.organizationId,
        command.actorId,
        command.linkageSubject
      ),
      payload: {
        expectedVersion: command.expectedVersion,
        mutationId: command.mutationId,
      },
      personId: command.personId,
    };
    return respond(
      command.operation === "archiveHouseholdPerson"
        ? household.archiveHouseholdPerson(input)
        : household.restoreHouseholdPerson(input)
    );
  }
  return null;
};

const routeMealPlanTestCommand = (
  household: HouseholdObjectClient,
  command: typeof HouseholdTestCommand.Type
) => {
  if (command.operation === "approveMealPlan") {
    return respond(
      household.approveMealPlan({
        admission: memberAdmission(command.organizationId),
        request: command.request,
      })
    );
  }
  if (command.operation === "createMealPlan") {
    return respond(
      household.createMealPlan({
        admission: memberAdmission(command.organizationId),
        approvedRecipes: command.approvedRecipes,
        policy: command.policy,
        request: command.request,
      })
    );
  }
  if (command.operation === "createMealPlanFromRecipeBank") {
    return respond(
      household.createMealPlanFromRecipeBank({
        admission: memberAdmission(command.organizationId),
        policy: command.policy,
        request: command.request,
      })
    );
  }
  if (command.operation === "inspectMealPlanStorage") {
    return respond(household.inspectMealPlanStorage(command.draftId));
  }
  if (command.operation === "readMealPlan") {
    return respond(
      household.readMealPlan({
        admission: memberAdmission(command.organizationId),
        draftId: command.draftId,
      })
    );
  }
  if (command.operation === "rejectMealPlan") {
    return respond(
      household.rejectMealPlan({
        admission: memberAdmission(command.organizationId),
        request: command.request,
      })
    );
  }
  if (command.operation === "swapMealPlan") {
    return respond(
      household.swapMealPlan({
        admission: memberAdmission(command.organizationId),
        approvedRecipes: command.approvedRecipes,
        request: command.request,
      })
    );
  }
  return null;
};

export default {
  fetch: async (request: Request, env: HouseholdTestEnv) => {
    const command = await Schema.decodeUnknownPromise(HouseholdTestCommand)(
      await request.json()
    );
    if (command.operation === "probeMigrationFailure") {
      const broken = Cloudflare.makeRpcStub<{
        readonly probe: () => Effect.Effect<string>;
      }>(env.BrokenMigrationObject.getByName(command.objectName));
      return respond(broken.probe());
    }
    const household = Cloudflare.makeRpcStub<HouseholdObjectClient>(
      env.HouseholdObject.getByName(command.objectName)
    );
    const recipeImportResponse = routeRecipeImportTestCommand(
      household,
      command
    );
    if (recipeImportResponse !== null) {
      return recipeImportResponse;
    }
    const administrationResponse = routeHouseholdAdministrationTestCommand(
      household,
      command
    );
    if (administrationResponse !== null) {
      return administrationResponse;
    }
    const peopleResponse = routeHouseholdPeopleTestCommand(household, command);
    if (peopleResponse !== null) {
      return peopleResponse;
    }
    const mealPlanResponse = routeMealPlanTestCommand(household, command);
    return mealPlanResponse ?? new Response(null, { status: 404 });
  },
};
