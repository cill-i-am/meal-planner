import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import { DurableObject } from "cloudflare:workers";
import { and, count, eq } from "drizzle-orm";
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
import { admitImportWorkflow } from "./foundation/admit-import-workflow.js";
import {
  HouseholdOutboxAlarm,
  HouseholdOutboxAlarmFailure,
} from "./foundation/household-outbox-alarm.js";
import {
  HouseholdAdmitImportWorkflowInput,
  HouseholdDispatchId,
  HouseholdWorkflowAdmissionMutationId,
} from "./foundation/import-workflow-admission.contract.js";
import type { HouseholdImportWorkflowAdmissionResult } from "./foundation/import-workflow-admission.contract.js";
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
  householdImportWorkflowAdmissions,
  householdMeta,
  householdMealPlans,
  householdOutbox,
} from "./household.database-schema.js";
import {
  HouseholdAdmitRecipeImportInput,
  HouseholdCommitRecipeImportDraftInput,
  HouseholdConfirmRecipeImportActionInput,
  HouseholdResolveRecipeImportSourceInput,
} from "./recipe-import/household-recipe-import.contract.js";
import {
  HouseholdMemberAdmission,
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
      Effect.provide(HouseholdAuthorityServicesLive)
    );
    const canonicalEncoding = yield* HouseholdCanonicalEncoding;
    const digest = yield* HouseholdDigest;
    const liveIdentity = yield* HouseholdIdentityGenerator;
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
    // eslint-disable-next-line sort-keys -- Fixture RPC follows the production runtime surface, then foundation-only probes.
    return Effect.succeed({
      ...household,
      admitImportWorkflow: (
        input: HouseholdAdmitImportWorkflowInput,
        testOptions?: {
          readonly alarmFailure?: boolean;
          readonly dispatchId?: string;
        }
      ) =>
        scoped(
          Effect.gen(function* admitImportWorkflowForTest() {
            const connection = yield* database;
            const forcedDispatchId = testOptions?.dispatchId;
            const identity =
              forcedDispatchId === undefined
                ? liveIdentity
                : HouseholdIdentityGenerator.of({
                    generate: () => Effect.succeed(forcedDispatchId),
                  });
            return yield* admitImportWorkflow(connection, input).pipe(
              Effect.provideService(
                HouseholdCanonicalEncoding,
                canonicalEncoding
              ),
              Effect.provideService(HouseholdDigest, digest),
              Effect.provideService(HouseholdIdentityGenerator, identity),
              Effect.provideService(
                HouseholdOutboxAlarm,
                HouseholdOutboxAlarm.of({
                  schedule: () =>
                    testOptions?.alarmFailure === true
                      ? Effect.fail(new HouseholdOutboxAlarmFailure())
                      : Effect.void,
                })
              )
            );
          })
        ),
      inspectImportWorkflowAdmissionCount: (
        importId: string,
        executionGeneration: number
      ) =>
        scoped(
          Effect.gen(function* inspectImportWorkflowAdmissionCount() {
            const connection = yield* database;
            const [row] = yield* connection
              .select({ value: count() })
              .from(householdImportWorkflowAdmissions)
              .where(
                and(
                  eq(householdImportWorkflowAdmissions.importId, importId),
                  eq(
                    householdImportWorkflowAdmissions.executionGeneration,
                    executionGeneration
                  )
                )
              );
            return row?.value ?? 0;
          })
        ),
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
      invokeMalformedEnsure: (payload: Schema.Json) =>
        household.ensureHousehold(payload as HouseholdEnsureInput),
      markImportWorkflowDispatchExhausted: (
        dispatchId: HouseholdDispatchId,
        exhaustedAtEpochMs: number
      ) =>
        scoped(
          Effect.gen(function* markImportWorkflowDispatchExhausted() {
            const connection = yield* database;
            yield* makeImportWorkflowAdmissionRepository(
              connection
            ).markExhausted(dispatchId, exhaustedAtEpochMs);
          })
        ),
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
  readonly admitRecipeImport: (
    input: typeof HouseholdAdmitRecipeImportInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly admitImportWorkflow: (
    input: HouseholdAdmitImportWorkflowInput,
    testOptions?: {
      readonly alarmFailure?: boolean;
      readonly dispatchId?: string;
    }
  ) => Effect.Effect<HouseholdImportWorkflowAdmissionResult, unknown>;
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
  readonly commitRecipeImportDraft: (
    input: typeof HouseholdCommitRecipeImportDraftInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly confirmRecipeImportAction: (
    input: typeof HouseholdConfirmRecipeImportActionInput.Type
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
  readonly inspectImportWorkflowAdmissionCount: (
    importId: string,
    executionGeneration: number
  ) => Effect.Effect<number>;
  readonly inspectImportWorkflowDispatch: (
    dispatchId: typeof HouseholdDispatchId.Type
  ) => Effect.Effect<unknown>;
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
  readonly rejectMealPlan: (input: {
    readonly admission: HouseholdMemberAdmission;
    readonly request: typeof MealPlanDecisionRequestWire.Type;
  }) => Effect.Effect<
    typeof MealPlanWire.Type,
    HouseholdDomainFailure | MealPlanServiceError
  >;
  readonly resolveRecipeImportSource: (
    input: typeof HouseholdResolveRecipeImportSourceInput.Type
  ) => Effect.Effect<unknown, unknown>;
  readonly markImportWorkflowDispatchExhausted: (
    dispatchId: typeof HouseholdDispatchId.Type,
    exhaustedAtEpochMs: number
  ) => Effect.Effect<void, unknown>;
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
    alarmFailure: Schema.optionalKey(Schema.Boolean),
    dispatchId: Schema.optionalKey(HouseholdDispatchId),
    executionGeneration:
      HouseholdAdmitImportWorkflowInput.fields.executionGeneration,
    importId: HouseholdAdmitImportWorkflowInput.fields.importId,
    mutationId: HouseholdWorkflowAdmissionMutationId,
    objectName: Schema.String,
    operation: Schema.Literal("admitImportWorkflow"),
    organizationId: HouseholdOrganizationId,
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
    executionGeneration:
      HouseholdAdmitImportWorkflowInput.fields.executionGeneration,
    importId: HouseholdAdmitImportWorkflowInput.fields.importId,
    objectName: Schema.String,
    operation: Schema.Literal("inspectImportWorkflowAdmissionCount"),
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
    dispatchId: HouseholdDispatchId,
    exhaustedAtEpochMs: Schema.Int,
    objectName: Schema.String,
    operation: Schema.Literal("markImportWorkflowDispatchExhausted"),
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

const memberAdmission = (organizationId: typeof HouseholdOrganizationId.Type) =>
  Schema.decodeUnknownSync(HouseholdMemberAdmission)({
    actor: { _tag: "Member", actorId: "a".repeat(64) },
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

export default {
  // eslint-disable-next-line complexity -- Closed test routing enumerates the complete object RPC surface.
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
    if (command.operation === "admitRecipeImport") {
      return respond(
        household.admitRecipeImport({
          admission: memberAdmission(command.organizationId),
          idempotencyKey: command.idempotencyKey,
          source: command.source,
        })
      );
    }
    if (command.operation === "admitImportWorkflow") {
      const testOptions: {
        alarmFailure?: boolean;
        dispatchId?: string;
      } = {};
      if (command.alarmFailure !== undefined) {
        testOptions.alarmFailure = command.alarmFailure;
      }
      if (command.dispatchId !== undefined) {
        testOptions.dispatchId = command.dispatchId;
      }
      return respond(
        household.admitImportWorkflow(
          {
            admission: systemAdmission(command.organizationId),
            executionGeneration: command.executionGeneration,
            importId: command.importId,
            mutationId: command.mutationId,
          },
          testOptions
        )
      );
    }
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
    if (command.operation === "inspectMealPlanStorage") {
      return respond(household.inspectMealPlanStorage(command.draftId));
    }
    if (command.operation === "inspectImportWorkflowAdmissionCount") {
      return respond(
        household.inspectImportWorkflowAdmissionCount(
          command.importId,
          command.executionGeneration
        )
      );
    }
    if (command.operation === "inspectImportWorkflowDispatch") {
      return respond(
        household.inspectImportWorkflowDispatch(command.dispatchId)
      );
    }
    if (command.operation === "invokeMalformedEnsure") {
      return respond(household.invokeMalformedEnsure(command.payload));
    }
    if (command.operation === "markImportWorkflowDispatchExhausted") {
      return respond(
        household.markImportWorkflowDispatchExhausted(
          command.dispatchId,
          command.exhaustedAtEpochMs
        )
      );
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
    return respond(
      household.swapMealPlan({
        admission: memberAdmission(command.organizationId),
        approvedRecipes: command.approvedRecipes,
        request: command.request,
      })
    );
  },
};
