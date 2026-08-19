import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";

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
  readonly ensureHousehold: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
}

/** Private RPC boundary for organization-scoped household state. */
export class HouseholdDomainWorker extends Cloudflare.Worker<
  HouseholdDomainWorker,
  Cloudflare.WorkerShape & HouseholdDomainWorkerMethods
>()("HouseholdDomainWorker") {}

const HouseholdDomainWorkerRuntime = Effect.gen(function* makeDomainWorker() {
  const households = yield* HouseholdObject;
  return {
    ensureHousehold: (input: HouseholdEnsureInput) =>
      Schema.decodeUnknownEffect(HouseholdEnsureInputSchema)(input).pipe(
        Effect.mapError(() => HouseholdInvalidInput.make({})),
        Effect.flatMap((command) =>
          households
            .getByName(householdObjectName(command.organizationId))
            .ensureHousehold(command)
        )
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
