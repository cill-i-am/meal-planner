import { Effect, Schema } from "effect";

import { sourceValidationUnavailable } from "./import.errors.js";
import type { SourceAvailabilityValidatorShape } from "./source-availability.js";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const fetchOEmbed = (fetcher: Fetcher, endpoint: URL) =>
  Effect.tryPromise({
    catch: sourceValidationUnavailable,
    try: (signal) =>
      fetcher(endpoint, {
        headers: { accept: "application/json" },
        method: "GET",
        redirect: "manual",
        signal,
      }),
  });

const cancelResponseBody = (response: Response) => {
  const { body } = response;
  if (body === null) {
    return Effect.void;
  }
  return Effect.tryPromise({
    catch: sourceValidationUnavailable,
    try: () => body.cancel(),
  }).pipe(Effect.ignore);
};

const TikTokOEmbedResponse = Schema.Struct({
  html: Schema.String,
  type: Schema.Literal("video"),
  version: Schema.String,
});

const MaximumOEmbedBytes = 65_536;

const ignoreCancellation = async (cancellation: Promise<unknown>) => {
  try {
    await cancellation;
  } catch {
    // Best-effort release failures stay private.
  }
};

const cancelReader = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Effect.sync(() => {
    try {
      void ignoreCancellation(reader.cancel());
    } catch {
      // Best-effort release must remain finite and privacy-safe.
    }
  });

const readOEmbedBody = (response: Response) => {
  const { body } = response;
  if (body === null) {
    return Effect.succeed("");
  }

  return Effect.acquireUseRelease(
    Effect.sync(() => body.getReader()),
    (reader) =>
      Effect.gen(function* readBoundedOEmbedBody() {
        const contentLength = Number(response.headers.get("content-length"));
        if (
          Number.isFinite(contentLength) &&
          contentLength > MaximumOEmbedBytes
        ) {
          return yield* Effect.fail(sourceValidationUnavailable());
        }

        const decoder = new TextDecoder();
        let bytesRead = 0;
        let text = "";
        while (true) {
          const chunk = yield* Effect.tryPromise({
            catch: sourceValidationUnavailable,
            try: () => reader.read(),
          });
          if (chunk.done) {
            return text + decoder.decode();
          }
          bytesRead += chunk.value.byteLength;
          if (bytesRead > MaximumOEmbedBytes) {
            return yield* Effect.fail(sourceValidationUnavailable());
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
      }),
    cancelReader
  );
};

export const makeTikTokSourceAvailabilityValidator = (
  fetcher: Fetcher
): SourceAvailabilityValidatorShape => ({
  validate: ({ identity, videoUrl }) =>
    Effect.gen(function* validate() {
      const endpoint = new URL("https://www.tiktok.com/oembed");
      endpoint.searchParams.set("url", videoUrl);
      const response = yield* fetchOEmbed(fetcher, endpoint);

      if (response.status === 401 || response.status === 404) {
        yield* cancelResponseBody(response);
        return { _tag: "PrivateOrUnavailable" as const };
      }
      if (response.status !== 200) {
        yield* cancelResponseBody(response);
        return yield* Effect.fail(sourceValidationUnavailable());
      }

      const body = yield* readOEmbedBody(response);
      const decoded = yield* Effect.try({
        catch: sourceValidationUnavailable,
        try: () =>
          Schema.decodeUnknownSync(TikTokOEmbedResponse)(JSON.parse(body)),
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
    }),
});
