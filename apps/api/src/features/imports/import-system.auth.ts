import { Context } from "effect";

import type { ImportAuthorizerShape } from "./import.auth.js";

/** System-only authorization capability for operational import routes. */
export class ImportSystemAuthorizer extends Context.Service<
  ImportSystemAuthorizer,
  ImportAuthorizerShape
>()("meal-planner/ImportSystemAuthorizer") {}
