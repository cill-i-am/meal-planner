import type { Effect } from "effect";
import { Context } from "effect";

import type { TescoSoftLoginRefreshError } from "./auth.errors.js";
import type { TescoAuthCookieHeader, TescoAuthSnapshot } from "./auth.model.js";

export interface TescoAuthRefreshShape {
  readonly refresh: (
    cookieHeader: TescoAuthCookieHeader
  ) => Effect.Effect<TescoAuthSnapshot, TescoSoftLoginRefreshError>;
}

export class TescoAuthRefresh extends Context.Service<
  TescoAuthRefresh,
  TescoAuthRefreshShape
>()("meal-planner/TescoAuthRefresh") {}
