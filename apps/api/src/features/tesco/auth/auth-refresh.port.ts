import type { Effect } from "effect";
import { Context } from "effect";

import type { TescoSoftLoginRefreshError } from "./auth.errors.js";
import type { TescoAuthCookieHeader, TescoAuthSnapshot } from "./auth.model.js";

export interface TescoAuthRefresh {
  readonly refresh: (
    cookieHeader: TescoAuthCookieHeader
  ) => Effect.Effect<TescoAuthSnapshot, TescoSoftLoginRefreshError>;
}

export const TescoAuthRefresh = Context.Service<TescoAuthRefresh>(
  "meal-planner/TescoAuthRefresh"
);
