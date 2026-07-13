import type { Effect } from "effect";
import { Context } from "effect";

import type { TescoAuthRefreshError } from "../tesco.errors.js";
import type { TescoAuthCookieHeader, TescoAuthSnapshot } from "./auth.model.js";

export interface TescoAuthRefreshShape {
  readonly refresh: (
    cookieHeader: TescoAuthCookieHeader
  ) => Effect.Effect<TescoAuthSnapshot, TescoAuthRefreshError>;
}

export class TescoAuthRefresh extends Context.Service<
  TescoAuthRefresh,
  TescoAuthRefreshShape
>()("meal-planner/TescoAuthRefresh") {}
