import * as Cloudflare from "alchemy/Cloudflare";
import { DurableObject } from "cloudflare:workers";
import { Context, Effect } from "effect";

import { HouseholdObjectRuntime } from "./household-object.js";

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
    stack: { name: "MealPlanner", stage: "test-household-domain" },
  }
)("HouseholdObject");

/** Generated-entry fixture for Alchemy's public Durable Object bridge. */
export class HouseholdObject extends HouseholdObjectBridge {}
