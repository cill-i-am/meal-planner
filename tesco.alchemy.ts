import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import TescoMcp from "./apps/api/src/features/tesco/mcp/worker.js";

/** Independent deployment/security lifecycle: only the private Tesco MCP and its session object. */
export default Alchemy.Stack(
  "TescoMcp",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* TescoMcpStack() {
    const stage = yield* Alchemy.Stage;
    if (stage !== "prod") {
      return yield* Effect.die(
        "The private Tesco MCP stack requires --stage prod."
      );
    }
    const worker = yield* TescoMcp;
    return { mcpUrl: worker.url, workerName: worker.workerName };
  })
);
