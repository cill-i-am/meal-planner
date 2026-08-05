import { Effect, Redacted, Schema } from "effect";

import { TescoSoftLoginResponseInvalid } from "./auth.errors.js";
import { TescoAuthorizationValue } from "./auth.model.js";

const TescoDiscoverAuthConfig = Schema.Struct({
  "mfe-orchestrator": Schema.Struct({
    props: Schema.Struct({
      config: Schema.Struct({
        authorization: TescoAuthorizationValue,
      }),
    }),
  }),
});

const DiscoverScriptPattern =
  /<script[^>]*type=["']application\/discover\+json["'][^>]*>(?<json>[\s\S]*?)<\/script>/u;

export const discoverJsonFromHtml = (
  html: string
): Effect.Effect<unknown, TescoSoftLoginResponseInvalid> =>
  Effect.gen(function* () {
    const match = DiscoverScriptPattern.exec(html);
    const jsonText = match?.groups?.["json"];
    if (jsonText === undefined) {
      return yield* Effect.fail(new TescoSoftLoginResponseInvalid());
    }

    return yield* Effect.try({
      catch: () => new TescoSoftLoginResponseInvalid(),
      try: () => JSON.parse(jsonText) as unknown,
    });
  });

export const authorizationFromDiscoverConfig = (value: unknown) =>
  Schema.decodeUnknownEffect(TescoDiscoverAuthConfig)(value).pipe(
    Effect.map((discoverConfig) =>
      Redacted.make(
        discoverConfig["mfe-orchestrator"].props.config.authorization
      )
    ),
    Effect.mapError(() => new TescoSoftLoginResponseInvalid())
  );
