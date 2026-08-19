import * as Cloudflare from "alchemy/Cloudflare";
import { DurableObject } from "cloudflare:workers";
import { Context, Effect, Schema } from "effect";

import { HouseholdObjectRuntime } from "./household-object.js";
import type {
  HouseholdDomainFailure,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdEnsureInput } from "./household.contract.js";

const alchemyRuntimeContractKey = "shape";
const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({
      HouseholdObject: {
        constructor: HouseholdObjectRuntime,
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

interface HouseholdObjectClient {
  readonly ensureHousehold: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
}

const HouseholdTestCommand = Schema.Struct({
  objectName: Schema.String,
  organizationId: HouseholdEnsureInput.fields.organizationId,
});

interface HouseholdTestEnv {
  readonly HouseholdObject: {
    readonly getByName: (name: string) => object;
  };
}

export default {
  fetch: async (request: Request, env: HouseholdTestEnv) => {
    const command = await Schema.decodeUnknownPromise(HouseholdTestCommand)(
      await request.json()
    );
    const household = Cloudflare.makeRpcStub<HouseholdObjectClient>(
      env.HouseholdObject.getByName(command.objectName)
    );
    return Effect.runPromise(
      household
        .ensureHousehold({ organizationId: command.organizationId })
        .pipe(
          Effect.match({
            onFailure: (error) => Response.json({ error, ok: false }),
            onSuccess: (value) => Response.json({ ok: true, value }),
          })
        )
    );
  },
};
