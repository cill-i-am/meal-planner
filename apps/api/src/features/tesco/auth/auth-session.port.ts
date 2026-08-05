import type { Effect } from "effect";
import { Context } from "effect";

import type { TescoAuthSessionError } from "./auth.errors.js";
import type { TescoAuthorization } from "./auth.model.js";

export interface TescoAuthSessionShape {
  readonly authorization: Effect.Effect<
    TescoAuthorization,
    TescoAuthSessionError
  >;
  readonly refreshAfterUnauthorized: (
    failedAuthorization: TescoAuthorization
  ) => Effect.Effect<TescoAuthorization, TescoAuthSessionError>;
}

export class TescoAuthSession extends Context.Service<
  TescoAuthSession,
  TescoAuthSessionShape
>()("meal-planner/TescoAuthSession") {}
