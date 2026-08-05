import { Config, Context, Effect, Layer, Schema } from "effect";

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
}

export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()(
  "meal-planner/AppConfig"
) {}

export const AppConfigDefinition = Config.all({
  server: Config.all({
    host: Config.schema(ServerHost, "HOST"),
    port: Config.port("PORT"),
  }),
});

export const AppConfigLive = Layer.effect(
  AppConfig,
  AppConfigDefinition.pipe(
    Effect.mapError(
      (cause) => new AppConfigError("Invalid application configuration", cause)
    )
  )
);
