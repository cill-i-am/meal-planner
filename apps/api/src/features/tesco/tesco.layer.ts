import { Layer } from "effect";

import { TescoAuthSessionLive } from "./auth/auth-session.js";
import { TescoSoftLoginAuthRefreshLive } from "./auth/soft-login-auth-refresh.js";
import { TescoXapiCatalogueLive } from "./catalogue/xapi-catalogue.js";

const TescoAuthLive = TescoAuthSessionLive.pipe(
  Layer.provideMerge(TescoSoftLoginAuthRefreshLive)
);

export const TescoLive = TescoXapiCatalogueLive.pipe(
  Layer.provideMerge(TescoAuthLive)
);
