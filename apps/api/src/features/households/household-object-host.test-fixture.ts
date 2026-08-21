import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import { DurableObject } from "cloudflare:workers";
import { and, count, eq } from "drizzle-orm";
import { Context, Effect, Option, Schema } from "effect";

import migrations from "../../../household-migrations/migrations.js";
import { ApprovedRecipe } from "../imports/import-recipe-review.js";
import {
  ManualMealSwapRequest,
  MealPlan,
  MealPlanDecisionRequest,
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
  HouseholdImportWorkflowAdmissionResult,
  HouseholdWorkflowAdmissionMutationId,
} from "./foundation/import-workflow-admission.contract.js";
import { makeImportWorkflowAdmissionRepository } from "./foundation/import-workflow-admission.repository.js";
import { HouseholdObjectRuntime } from "./household-object-runtime.js";
import type {
  HouseholdDomainFailure,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdEnsureInput } from "./household.contract.js";
import { HouseholdOrganizationId } from "./household.contract.js";
import {
  householdImportWorkflowAdmissions,
  householdMealPlans,
} from "./household.database-schema.js";
import type { HouseholdMemberAdmission } from "./rpc/command-envelope.js";
import {
  HouseholdMemberAdmission as HouseholdMemberAdmissionSchema,
  HouseholdSystemAdmission,
} from "./rpc/command-envelope.js";
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
const ManualMealSwapRequestWire = Schema.toEncoded(ManualMealSwapRequest);
const MealPlanDecisionRequestWire = Schema.toEncoded(MealPlanDecisionRequest);

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
            const identity =
              testOptions?.dispatchId === undefined
                ? liveIdentity
                : HouseholdIdentityGenerator.of({
                    generate: () => Effect.succeed(testOptions.dispatchId!),
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
      invokeMalformedEnsure: (payload: unknown) =>
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

export class BrokenMigrationObject extends BrokenMigrationObjectBridge {}

interface HouseholdObjectClient {
  readonly admitImportWorkflow: (
    input: HouseholdAdmitImportWorkflowInput,
    testOptions?: {
      readonly alarmFailure?: boolean;
      readonly dispatchId?: string;
    }
  ) => Effect.Effect<
    typeof HouseholdImportWorkflowAdmissionResult.Type,
    unknown
  >;
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
    payload: unknown
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
    approvedRecipes: Schema.Array(ApprovedRecipeWire),
    objectName: Schema.String,
    operation: Schema.Literal("createMealPlan"),
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
    payload: Schema.Unknown,
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
  Schema.decodeUnknownSync(HouseholdMemberAdmissionSchema)({
    actor: { _tag: "Member", actorId: "a".repeat(64) },
    organizationId,
  });

const systemAdmission = (organizationId: typeof HouseholdOrganizationId.Type) =>
  Schema.decodeUnknownSync(HouseholdSystemAdmission)({
    actor: { _tag: "System", purpose: "import_workflow_dispatch" },
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
    if (command.operation === "admitImportWorkflow") {
      const testOptions = {
        ...(command.alarmFailure === undefined
          ? {}
          : { alarmFailure: command.alarmFailure }),
        ...(command.dispatchId === undefined
          ? {}
          : { dispatchId: command.dispatchId }),
      };
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
    return respond(
      household.swapMealPlan({
        admission: memberAdmission(command.organizationId),
        approvedRecipes: command.approvedRecipes,
        request: command.request,
      })
    );
  },
};
