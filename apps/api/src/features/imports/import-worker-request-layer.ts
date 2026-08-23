import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Schema } from "effect";
import type { Redacted } from "effect";

import type { AuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import {
  AuthenticatedOrganizationResolver as AuthenticatedOrganizationResolverService,
  AuthPrincipalResolver,
} from "../auth/auth.principal.js";
import { HouseholdDispatchId } from "../households/foundation/import-workflow-admission.contract.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { ImportWorkflowIdentity } from "../households/shared-kernel/workflow-identity.js";
import {
  ProviderAccountingService,
  makeD1ProviderAccountingService,
} from "../provider-accounting/provider-accounting.service.js";
import type { ImportEvidenceRoute } from "./import-evidence-event.js";
import { RecipeImportHouseholdDomain } from "./import-intent-api.http.js";
import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import { makeD1ImportObservabilityTraceStore } from "./import-observability.d1.js";
import type { ImportTraceContext } from "./import-observability.js";
import { ImportObservabilityTraceStore } from "./import-observability.js";
import {
  ProviderRecoveryService,
  makeProviderRecoveryService,
} from "./import-provider-recovery.js";
import type { RecipeRecoveryWorkflowStarter } from "./import-recipe-recovery.js";
import type { ImportPrincipal } from "./import-system-principal.js";
import {
  ImportSystemAuthorizer,
  makeImportSystemAuthorizer,
} from "./import-system.auth.js";
import { RecipeImportWorkflowDispatcher } from "./import-workflow-dispatcher.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import type { ImportWorkflowReconciler } from "./import.workflow.js";

/** Inputs required to construct the import HTTP route services once. */
export interface ImportWorkerRequestLayerInput {
  readonly database: AnyD1Database;
  readonly importWorkflowStarter: ImportWorkflowReconciler;
  readonly now: () => string;
  readonly organizationResolver: AuthenticatedOrganizationResolver;
  readonly principalResolver: AuthPrincipalResolver;
  readonly recipeRecoveryStarter: RecipeRecoveryWorkflowStarter;
  readonly registerEvidenceRoute: (
    route: ImportEvidenceRoute
  ) => Effect.Effect<void, object>;
  readonly runtimeContext: Effect.Success<typeof RuntimeContext>;
  readonly systemApiToken: Redacted.Redacted<string>;
  readonly systemPrincipal: ImportPrincipal;
  readonly trace: ImportTraceContext;
  readonly householdDomain: HouseholdDomainWorkerMethods;
}

const timestamp = (now: () => string) =>
  Schema.decodeUnknownSync(ImportTimestamp)(now());

export const makeRecipeImportWorkflowDispatcher = (input: {
  readonly householdDomain: Pick<
    HouseholdDomainWorkerMethods,
    "recordRecipeImportDispatch"
  >;
  readonly importWorkflowStarter: Pick<
    ImportWorkflowReconciler,
    "dispatchAdmission"
  >;
  readonly retryDelaysMilliseconds: readonly number[];
  readonly registerEvidenceRoute: (
    route: ImportEvidenceRoute
  ) => Effect.Effect<void, object>;
  readonly scheduleRetry: (effect: Effect.Effect<void>) => Effect.Effect<void>;
  readonly trace: ImportTraceContext;
}) =>
  RecipeImportWorkflowDispatcher.of({
    dispatch: ({ admission, committed }) =>
      Effect.gen(function* dispatchCommittedRecipeImport() {
        const importId = yield* Schema.decodeUnknownEffect(ImportId)(
          committed.intent.id
        );
        const executionGeneration = yield* Schema.decodeUnknownEffect(
          ImportIntentExecutionGeneration
        )(1);
        const dispatchId = yield* Schema.decodeUnknownEffect(
          HouseholdDispatchId
        )(committed.dispatchId);
        const workflowIdentity = yield* Schema.decodeUnknownEffect(
          ImportWorkflowIdentity
        )(committed.workflowIdentity);
        const recordDispatch = (
          outcome: "prepared" | "started" | "unavailable"
        ) =>
          input.householdDomain.recordRecipeImportDispatch({
            admission: {
              actor: {
                _tag: "System",
                purpose: "import_workflow_dispatch",
              },
              organizationId: admission.organizationId,
            },
            dispatchId,
            originalTrace: input.trace,
            outcome,
            workflowIdentity,
          });
        const prepareDispatch = input
          .registerEvidenceRoute({
            executionGeneration,
            importId,
            organizationId: admission.organizationId,
            routeVersion: 1,
          })
          .pipe(Effect.flatMap(() => recordDispatch("prepared")));
        const dispatchOnce = prepareDispatch.pipe(
          Effect.flatMap(() =>
            input.importWorkflowStarter
              .dispatchAdmission({
                executionGeneration,
                importId,
                organizationId: admission.organizationId,
                trace: input.trace,
                workflowIdentity,
              })
              .pipe(
                Effect.as("started" as const),
                Effect.catchCause(() => Effect.succeed("unavailable" as const)),
                Effect.flatMap((outcome) =>
                  recordDispatch(outcome).pipe(Effect.as(outcome))
                )
              )
          ),
          Effect.catchCause(() => Effect.succeed("unavailable" as const))
        );
        if ((yield* dispatchOnce) === "unavailable") {
          yield* input.scheduleRetry(
            Effect.gen(function* retryCommittedRecipeImportDispatch() {
              for (const delayMilliseconds of input.retryDelaysMilliseconds) {
                yield* Effect.sleep(delayMilliseconds);
                if ((yield* dispatchOnce) === "started") {
                  break;
                }
              }
            })
          );
        }
      }).pipe(
        Effect.catchCause(() =>
          Effect.logWarning("recipe_import.workflow_dispatch_input_invalid")
        )
      ),
  });

/** Construct the typed import route services at the Worker composition root. */
export const makeImportWorkerRequestLayer = (
  input: ImportWorkerRequestLayerInput
) => {
  const accounting = Layer.succeed(
    ProviderAccountingService,
    ProviderAccountingService.of(
      makeD1ProviderAccountingService({
        database: input.database,
        now: () => timestamp(input.now),
      })
    )
  );
  const recovery = Layer.succeed(
    ProviderRecoveryService,
    ProviderRecoveryService.of(
      makeProviderRecoveryService({
        householdDomain: input.householdDomain,
        recipeRecoveryStarter: input.recipeRecoveryStarter,
        workflowStarter: input.importWorkflowStarter,
      })
    )
  );
  const workflowDispatcher = makeRecipeImportWorkflowDispatcher({
    householdDomain: input.householdDomain,
    importWorkflowStarter: input.importWorkflowStarter,
    registerEvidenceRoute: input.registerEvidenceRoute,
    retryDelaysMilliseconds: [2000, 4000, 8000, 16_000],
    scheduleRetry: (effect) =>
      Effect.gen(function* scheduleImportDispatchRetry() {
        const executionContext = yield* Effect.serviceOption(
          Cloudflare.WorkerExecutionContext
        );
        if (executionContext._tag === "Some") {
          yield* executionContext.value
            .waitUntil(effect)
            .pipe(Effect.provideService(RuntimeContext, input.runtimeContext));
        }
      }),
    trace: input.trace,
  });

  return Layer.mergeAll(
    Layer.succeed(
      AuthPrincipalResolver,
      AuthPrincipalResolver.of(input.principalResolver)
    ),
    Layer.succeed(
      AuthenticatedOrganizationResolverService,
      AuthenticatedOrganizationResolverService.of(input.organizationResolver)
    ),
    Layer.succeed(
      RecipeImportHouseholdDomain,
      RecipeImportHouseholdDomain.of(input.householdDomain)
    ),
    Layer.succeed(RecipeImportWorkflowDispatcher, workflowDispatcher),
    Layer.effect(
      ImportSystemAuthorizer,
      Effect.map(
        makeImportSystemAuthorizer({
          principal: input.systemPrincipal,
          token: input.systemApiToken,
        }),
        ImportSystemAuthorizer.of
      )
    ),
    Layer.succeed(
      ImportObservabilityTraceStore,
      makeD1ImportObservabilityTraceStore(input.database, input.now)
    ),
    accounting,
    recovery
  );
};
