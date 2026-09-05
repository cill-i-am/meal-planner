import { Effect, Redacted, Schema } from "effect";

import { TescoSoftLoginResponseInvalid } from "./auth.errors.js";
import { TescoAuthorizationValue } from "./auth.model.js";
import type { TescoAuthorization } from "./auth.model.js";

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

export const authorizationFromDiscoverHtml = (
  html: string
): Effect.Effect<TescoAuthorization, TescoSoftLoginResponseInvalid> =>
  Effect.gen(function* () {
    const match = DiscoverScriptPattern.exec(html);
    const jsonText = match?.groups?.["json"];
    if (jsonText === undefined) {
      return yield* Effect.fail(new TescoSoftLoginResponseInvalid());
    }

    return yield* Effect.try({
      catch: () => new TescoSoftLoginResponseInvalid(),
      try: () => JSON.parse(jsonText),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(TescoDiscoverAuthConfig)),
      Effect.mapError(() => new TescoSoftLoginResponseInvalid()),
      Effect.map((config) =>
        Redacted.make(config["mfe-orchestrator"].props.config.authorization)
      )
    );
  });
