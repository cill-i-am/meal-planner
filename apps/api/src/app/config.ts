import { Config, Context, Effect, Layer, Schema } from "effect";

import { TescoConfigDefinition } from "../features/tesco/tesco.config.js";
import type { TescoConfig } from "../features/tesco/tesco.config.js";
import { AppConfigError } from "./errors.js";

const ConfigText = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);

export const ServerHost = ConfigText.pipe(Schema.brand("ServerHost"));
export type ServerHost = typeof ServerHost.Type;

export interface ServerConfig {
  readonly host: ServerHost;
  readonly port: number;
}

export interface AppConfigShape {
  readonly server: ServerConfig;
  readonly tesco: TescoConfig;
}

export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()(
  "meal-planner/AppConfig"
) {}

export const AppConfigDefinition = Config.all({
  server: Config.all({
    host: Config.schema(ServerHost, "HOST"),
    port: Config.port("PORT"),
  }),
  tesco: TescoConfigDefinition,
});

export const AppConfigLive = Layer.effect(
  AppConfig,
  AppConfigDefinition.pipe(
    Effect.mapError(
      (cause) => new AppConfigError("Invalid application configuration", cause)
    )
  )
);
