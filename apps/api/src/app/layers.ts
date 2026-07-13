import * as Http from "node:http";

import { NodeHttpClient, NodeHttpServer } from "@effect/platform-node";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { TescoLive } from "../features/tesco/tesco.layer.js";
import { AppConfig, AppConfigLive } from "./config.js";
import { AppRoutes } from "./routes.js";

const BaseLive = Layer.mergeAll(AppConfigLive, NodeHttpClient.layerUndici);

const ServicesLive = Layer.mergeAll(
  BaseLive,
  TescoLive.pipe(Layer.provide(BaseLive))
);

const ServerLive = Layer.unwrap(
  AppConfig.useSync((config) =>
    NodeHttpServer.layer(() => Http.createServer(), {
      host: config.server.host,
      port: config.server.port,
    })
  )
).pipe(Layer.provide(AppConfigLive));

export const AppLive = HttpRouter.serve(AppRoutes).pipe(
  Layer.provide(Layer.mergeAll(ServerLive, ServicesLive))
);
