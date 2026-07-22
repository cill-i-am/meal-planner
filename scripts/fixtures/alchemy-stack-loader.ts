import * as Alchemy from "alchemy";
import { inMemoryState } from "alchemy/State";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { fixtureLoaded } from "./alchemy-stack-loader-value.js";

export default Alchemy.Stack(
  "MealPlannerStackLoaderFixture",
  { providers: Layer.empty, state: inMemoryState() },
  Effect.succeed({ fixtureLoaded })
);
