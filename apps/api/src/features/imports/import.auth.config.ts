import { Config } from "effect";

/** Internal automation credential; browser callers authenticate through Better Auth sessions. */
export const ImportSystemAuthorizationConfig = Config.redacted(
  "MEAL_PLANNER_IMPORT_API_TOKEN"
);
