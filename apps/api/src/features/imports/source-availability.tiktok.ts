import { Effect, Schema } from "effect";

import { sourceValidationUnavailable } from "./import.errors.js";
import type { SourceAvailabilityValidator } from "./source-availability.js";
import { makeTikTokHttpTransport } from "./tiktok-http.transport.js";
import type {
  TikTokFetcher,
  TikTokHttpPolicyOptions,
} from "./tiktok-http.transport.js";

const TikTokOEmbedResponse = Schema.Struct({
  html: Schema.String,
  type: Schema.Literal("video"),
  version: Schema.String,
});

export const makeTikTokSourceAvailabilityValidator = (
  fetcher: TikTokFetcher,
  options?: TikTokHttpPolicyOptions
): SourceAvailabilityValidator => {
  const transport = makeTikTokHttpTransport(fetcher, options);
  return {
    validate: Effect.fn("TikTokSourceAvailabilityValidator.validate")(
      function* validate({ identity, videoUrl }) {
        const result = yield* transport
          .fetchOEmbed(videoUrl)
          .pipe(Effect.mapError(sourceValidationUnavailable));
        if (result._tag === "PrivateOrUnavailable") {
          return result;
        }

        const decoded = yield* Effect.try({
          catch: sourceValidationUnavailable,
          try: () =>
            Schema.decodeUnknownSync(TikTokOEmbedResponse)(
              JSON.parse(result.body)
            ),
        });
        const doubleQuotedVideoId = `data-video-id="${identity.canonicalId}"`;
        const singleQuotedVideoId = `data-video-id='${identity.canonicalId}'`;
        if (
          !decoded.html.includes(doubleQuotedVideoId) &&
          !decoded.html.includes(singleQuotedVideoId)
        ) {
          return yield* Effect.fail(sourceValidationUnavailable());
        }

        return { _tag: "Available" as const };
      }
    ),
  };
};
