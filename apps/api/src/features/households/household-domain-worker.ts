import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";

import type { MealPlanServiceError } from "../meal-planning/meal-plan.js";
import type {
  HouseholdCreateMealPlanInput,
  HouseholdDecideMealPlanInput,
  HouseholdMealPlanWire,
  HouseholdReadMealPlanInput,
  HouseholdSwapMealPlanInput,
} from "./household-meal-plan.contract.js";
import {
  HouseholdCreateMealPlanInput as HouseholdCreateMealPlanInputSchema,
  HouseholdDecideMealPlanInput as HouseholdDecideMealPlanInputSchema,
  HouseholdReadMealPlanInput as HouseholdReadMealPlanInputSchema,
  HouseholdSwapMealPlanInput as HouseholdSwapMealPlanInputSchema,
} from "./household-meal-plan.contract.js";
import { HouseholdObjectLocator } from "./household-object-locator.js";
import HouseholdObject from "./household-object.js";
import type {
  HouseholdDomainFailure,
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import {
  HouseholdInvalidInput,
  HouseholdEnsureInput as HouseholdEnsureInputSchema,
} from "./household.contract.js";
import type { HouseholdCommandAdmission } from "./rpc/command-envelope.js";
import { HouseholdAuthorityServicesLive } from "./shared-kernel/authority-services.live.js";

export interface HouseholdDomainWorkerMethods {
  readonly approveMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly createMealPlan: (
    input: HouseholdCreateMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly ensureHousehold: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
  readonly readMealPlan: (
    input: HouseholdReadMealPlanInput
  ) => Effect.Effect<
    HouseholdMealPlanWire | null,
    HouseholdMealPlanDomainFailure
  >;
  readonly rejectMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly swapMealPlan: (
    input: HouseholdSwapMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
}

export type HouseholdMealPlanDomainFailure =
  | HouseholdDomainFailure
  | MealPlanServiceError;

/** Private RPC boundary for organization-scoped household state. */
export class HouseholdDomainWorker extends Cloudflare.Worker<
  HouseholdDomainWorker,
  Cloudflare.WorkerShape & HouseholdDomainWorkerMethods
>()("HouseholdDomainWorker") {}

const HouseholdDomainWorkerRuntime = Effect.gen(function* makeDomainWorker() {
  const households = yield* HouseholdObject;
  const locator = yield* HouseholdObjectLocator;
  const route = <
    A extends { readonly admission: HouseholdCommandAdmission },
    I,
    B,
    E,
  >(
    schema: Schema.Codec<A, I, never>,
    input: A,
    invoke: (
      household: ReturnType<typeof households.getByName>,
      command: A
    ) => Effect.Effect<B, E>
  ) =>
    Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(
      input
    ).pipe(
      Effect.mapError(() => HouseholdInvalidInput.make({})),
      Effect.flatMap((command) =>
        locator.locate(command.admission.organizationId).pipe(
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.flatMap((objectName) =>
            invoke(households.getByName(objectName), command)
          )
        )
      )
    );
  return {
    approveMealPlan: (input: HouseholdDecideMealPlanInput) =>
      route(HouseholdDecideMealPlanInputSchema, input, (household, command) =>
        household.approveMealPlan(command)
      ),
    createMealPlan: (input: HouseholdCreateMealPlanInput) =>
      route(HouseholdCreateMealPlanInputSchema, input, (household, command) =>
        household.createMealPlan(command)
      ),
    ensureHousehold: (input: HouseholdEnsureInput) =>
      route(HouseholdEnsureInputSchema, input, (household, command) =>
        household.ensureHousehold(command)
      ),
    readMealPlan: (input: HouseholdReadMealPlanInput) =>
      route(HouseholdReadMealPlanInputSchema, input, (household, command) =>
        household.readMealPlan(command)
      ),
    rejectMealPlan: (input: HouseholdDecideMealPlanInput) =>
      route(HouseholdDecideMealPlanInputSchema, input, (household, command) =>
        household.rejectMealPlan(command)
      ),
    swapMealPlan: (input: HouseholdSwapMealPlanInput) =>
      route(HouseholdSwapMealPlanInputSchema, input, (household, command) =>
        household.swapMealPlan(command)
      ),
  } satisfies HouseholdDomainWorkerMethods;
});

export default HouseholdDomainWorker.make(
  {
    main: import.meta.url,
    observability: {
      enabled: true,
      headSamplingRate: 1,
      logs: {
        enabled: true,
        headSamplingRate: 1,
        invocationLogs: false,
        persist: true,
      },
      traces: { enabled: false },
    },
    workersDev: false,
  },
  HouseholdDomainWorkerRuntime.pipe(
    Effect.provide(HouseholdObjectLocator.layer),
    Effect.provide(HouseholdAuthorityServicesLive)
  )
);
