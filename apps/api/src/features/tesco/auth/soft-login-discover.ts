import { Effect, Schema } from "effect";

import { TescoAuthRefreshError } from "../tesco.errors.js";
import { TescoAuthorization } from "./auth.model.js";

const TescoDiscoverAuthConfig = Schema.Struct({
  "mfe-orchestrator": Schema.Struct({
    props: Schema.Struct({
      config: Schema.Struct({
        authorization: TescoAuthorization,
      }),
    }),
  }),
});

const DiscoverScriptPattern =
  /<script[^>]*type=["']application\/discover\+json["'][^>]*>(?<json>[\s\S]*?)<\/script>/u;

export const discoverJsonFromHtml = (
  html: string
): Effect.Effect<unknown, TescoAuthRefreshError> =>
  Effect.gen(function* () {
    const match = DiscoverScriptPattern.exec(html);
    const jsonText = match?.groups?.["json"];
    if (jsonText === undefined) {
      return yield* Effect.fail(
        new TescoAuthRefreshError(
          "Tesco soft login did not return discover config",
          502
        )
      );
    }

    return yield* Effect.try({
      catch: (cause) =>
        new TescoAuthRefreshError(
          "Tesco discover config is not valid JSON",
          502,
          cause
        ),
      try: () => JSON.parse(jsonText) as unknown,
    });
  });

export const authorizationFromDiscoverConfig = (value: unknown) =>
  Schema.decodeUnknownEffect(TescoDiscoverAuthConfig)(value).pipe(
    Effect.map(
      (discoverConfig) =>
        discoverConfig["mfe-orchestrator"].props.config.authorization
    ),
    Effect.mapError(
      (cause) =>
        new TescoAuthRefreshError(
          "Tesco discover config is missing authorization",
          502,
          cause
        )
    )
  );
