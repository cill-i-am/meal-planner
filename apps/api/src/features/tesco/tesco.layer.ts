import { Effect, Layer } from "effect";

import { makeTescoAuthSessionLive } from "./auth/auth-session.js";
import { makeTescoSoftLoginAuthRefreshLive } from "./auth/soft-login-auth-refresh.js";
import { makeTescoAuthenticatedGraphQlTransportLive } from "./catalogue/authenticated-graphql-transport.js";
import { makeTescoXapiCatalogueLive } from "./catalogue/xapi-catalogue.js";
import { loadTescoConfig } from "./tesco.config.js";
import type { TescoConfig } from "./tesco.config.js";

export const makeTescoLive = (config: TescoConfig) => {
  const authSessionLive = makeTescoAuthSessionLive(config.authBootstrap).pipe(
    Layer.provide(makeTescoSoftLoginAuthRefreshLive(config.softLogin))
  );
  const transportLive = makeTescoAuthenticatedGraphQlTransportLive(
    config.catalogue
  ).pipe(Layer.provide(authSessionLive));

  return makeTescoXapiCatalogueLive(config.catalogue).pipe(
    Layer.provide(transportLive)
  );
};

export const TescoLive = Layer.unwrap(
  loadTescoConfig.pipe(Effect.map(makeTescoLive))
);
