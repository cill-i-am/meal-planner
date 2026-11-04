import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import SigenApi from "./apps/sigen-api/src/worker.js";

/** Independent stack: never deploys Meal Planner, Tesco, or their credentials. */
export default Alchemy.Stack(
  "SigenApi",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* deploySigen() {
    const stage = yield* Alchemy.Stage;
    if (stage !== "prod") {
      return yield* Effect.die(
        "The private Sigen stack requires --stage prod."
      );
    }
    const worker = yield* SigenApi;
    return { apiUrl: worker.url, workerName: worker.workerName };
  })
);
