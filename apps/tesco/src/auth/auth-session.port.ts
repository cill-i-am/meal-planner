import type { Effect } from "effect";
import { Context } from "effect";

import type { TescoCredentialsRejected } from "./auth.errors.js";
import type { TescoAuthorization } from "./auth.model.js";

export interface TescoAuthSession {
  readonly authorization: Effect.Effect<
    TescoAuthorization,
    TescoCredentialsRejected
  >;
  readonly refreshAfterUnauthorized: (
    failedAuthorization: TescoAuthorization
  ) => Effect.Effect<TescoAuthorization, TescoCredentialsRejected>;
}

export const TescoAuthSession = Context.Service<TescoAuthSession>(
  "meal-planner/TescoAuthSession"
);
