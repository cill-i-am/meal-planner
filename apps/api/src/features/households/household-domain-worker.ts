import type { HouseholdOrganizationId } from "@meal-planner/household-api";
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
import HouseholdObject from "./household-object.js";
import type {
  HouseholdDomainFailure,
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import {
  HouseholdInvalidInput,
  householdObjectName,
  HouseholdEnsureInput as HouseholdEnsureInputSchema,
} from "./household.contract.js";

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
  const route = <
    A extends { readonly organizationId: HouseholdOrganizationId },
    I,
    R,
    B,
    E,
  >(
    schema: Schema.Codec<A, I, R>,
    input: A,
    invoke: (
      household: ReturnType<typeof households.getByName>,
      command: A
    ) => Effect.Effect<B, E>
  ) =>
    Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.mapError(() => HouseholdInvalidInput.make({})),
      Effect.flatMap((command) =>
        invoke(
          households.getByName(householdObjectName(command.organizationId)),
          command
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
      Schema.decodeUnknownEffect(HouseholdEnsureInputSchema)(input).pipe(
        Effect.mapError(() => HouseholdInvalidInput.make({})),
        Effect.flatMap((command) =>
          households
            .getByName(householdObjectName(command.organizationId))
            .ensureHousehold(command)
        )
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
  HouseholdDomainWorkerRuntime
);
