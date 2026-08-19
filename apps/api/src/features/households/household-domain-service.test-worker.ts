import * as Cloudflare from "alchemy/Cloudflare";
import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect, Schema } from "effect";

import type {
  HouseholdDomainFailure,
  HouseholdEnsureInput as HouseholdEnsureInputValue,
  HouseholdMetadata,
} from "./household.contract.js";
import {
  HouseholdEnsureInput,
  householdObjectName,
} from "./household.contract.js";

interface HouseholdObjectClient {
  readonly ensureHousehold: (
    input: typeof HouseholdEnsureInput.Type
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
}

interface HouseholdDomainTestEnv {
  readonly HouseholdObject: {
    readonly getByName: (name: string) => object;
  };
}

/** Real private service-binding entrypoint backed by the production DO runtime. */
export default class HouseholdDomainTestWorker extends WorkerEntrypoint<HouseholdDomainTestEnv> {
  ensureHousehold(
    input: HouseholdEnsureInputValue
  ): Promise<HouseholdMetadata> {
    return Effect.runPromise(
      Schema.decodeUnknownEffect(HouseholdEnsureInput)(input).pipe(
        Effect.flatMap((command) =>
          Cloudflare.makeRpcStub<HouseholdObjectClient>(
            this.env.HouseholdObject.getByName(
              householdObjectName(command.organizationId)
            )
          ).ensureHousehold(command)
        )
      )
    );
  }
}

export { HouseholdObject } from "./household-domain-object.test-worker.js";
