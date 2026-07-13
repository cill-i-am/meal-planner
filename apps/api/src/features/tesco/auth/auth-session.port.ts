import type { Effect } from "effect";
import { Context } from "effect";

import type { TescoAuthRefreshError } from "../tesco.errors.js";
import type { TescoAuthorization } from "./auth.model.js";

export interface TescoAuthSessionShape {
  readonly authorization: Effect.Effect<
    TescoAuthorization,
    TescoAuthRefreshError
  >;
  readonly refreshAfterUnauthorized: (
    failedAuthorization: TescoAuthorization
  ) => Effect.Effect<TescoAuthorization, TescoAuthRefreshError>;
}

export class TescoAuthSession extends Context.Service<
  TescoAuthSession,
  TescoAuthSessionShape
>()("meal-planner/TescoAuthSession") {}
