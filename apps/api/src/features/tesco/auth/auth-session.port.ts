import type { Effect } from "effect";
import { Context } from "effect";

import type { TescoAuthSessionError } from "./auth.errors.js";
import type { TescoAuthorization } from "./auth.model.js";

export interface TescoAuthSession {
  readonly authorization: Effect.Effect<
    TescoAuthorization,
    TescoAuthSessionError
  >;
  readonly refreshAfterUnauthorized: (
    failedAuthorization: TescoAuthorization
  ) => Effect.Effect<TescoAuthorization, TescoAuthSessionError>;
}

export const TescoAuthSession = Context.Service<TescoAuthSession>(
  "meal-planner/TescoAuthSession"
);
