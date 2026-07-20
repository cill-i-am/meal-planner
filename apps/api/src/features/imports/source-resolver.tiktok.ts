import { Effect, Schema } from "effect";

import { SourceCanonicalId } from "./import.contracts.js";
import { invalidSource, sourceValidationUnavailable } from "./import.errors.js";
import type {
  CanonicalSourceIdentityResolverShape,
  CanonicalSourceIdentity,
  SourceAvailabilityValidatorShape,
} from "./source-resolver.js";
import { ValidatedVideoUrl } from "./source-resolver.js";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const allowedTikTokHosts = new Set([
  "m.tiktok.com",
  "tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "www.tiktok.com",
]);

const shortLinkHosts = new Set(["vm.tiktok.com", "vt.tiktok.com"]);

const parseAllowedTikTokUrl = (input: string): URL | undefined => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !allowedTikTokHosts.has(url.hostname)
  ) {
    return undefined;
  }
  return url;
};

const sanitizeLocator = (url: URL): string => {
  const path = url.pathname.replace(/\/+$/u, "") || "/";
  return `${url.origin}${path}`;
};

const resolveRedirectLocation = (
  location: string,
  current: URL
): string | undefined => {
  try {
    return new URL(location, current).toString();
  } catch {
    return undefined;
  }
};

const makeIdentity = (canonicalId: string): CanonicalSourceIdentity => ({
  canonicalId: Schema.decodeUnknownSync(SourceCanonicalId)(canonicalId),
  kind: "tiktok",
});

const parseCanonicalPath = (
  url: URL
):
  | {
      readonly _tag: "UnsupportedIdentity";
      readonly identity: CanonicalSourceIdentity;
    }
  | {
      readonly _tag: "VideoIdentity";
      readonly identity: CanonicalSourceIdentity;
      readonly videoUrl: ValidatedVideoUrl;
    }
  | undefined => {
  const videoMatch = /^\/@[^/]+\/video\/(?<canonicalId>\d+)\/?$/u.exec(
    url.pathname
  );
  const videoId = videoMatch?.groups?.["canonicalId"];
  if (videoId !== undefined) {
    return {
      _tag: "VideoIdentity",
      identity: makeIdentity(videoId),
      videoUrl: Schema.decodeUnknownSync(ValidatedVideoUrl)(
        sanitizeLocator(url)
      ),
    };
  }

  const photoMatch =
    /^\/@[^/]+\/(?:photo|photos)\/(?<canonicalId>\d+)\/?$/u.exec(url.pathname);
  const photoId = photoMatch?.groups?.["canonicalId"];
  if (photoId !== undefined) {
    return {
      _tag: "UnsupportedIdentity",
      identity: makeIdentity(photoId),
    };
  }
  return undefined;
};

const fetchManual = (fetcher: Fetcher, url: string, headers?: HeadersInit) =>
  Effect.tryPromise({
    catch: sourceValidationUnavailable,
    try: (signal) =>
      fetcher(url, {
        ...(headers === undefined ? {} : { headers }),
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

const resolveShortLink = (fetcher: Fetcher, initial: URL) =>
  Effect.gen(function* resolveShortLinkEffect() {
    let current = initial;

    for (let hop = 0; hop < 5; hop += 1) {
      const response = yield* fetchManual(fetcher, current.toString());
      if (response.status < 300 || response.status >= 400) {
        yield* cancelResponseBody(response);
        return yield* Effect.fail(sourceValidationUnavailable());
      }

      yield* cancelResponseBody(response);

      const location = response.headers.get("location");
      if (location === null) {
        return yield* Effect.fail(sourceValidationUnavailable());
      }

      const redirectLocation = resolveRedirectLocation(location, current);
      const next =
        redirectLocation === undefined
          ? undefined
          : parseAllowedTikTokUrl(redirectLocation);
      if (next === undefined) {
        return yield* Effect.fail(invalidSource());
      }
      current = next;

      const parsed = parseCanonicalPath(current);
      if (parsed !== undefined) {
        return parsed;
      }
    }

    return yield* Effect.fail(sourceValidationUnavailable());
  });

export const makeTikTokCanonicalSourceIdentityResolver = (
  fetcher: Fetcher
): CanonicalSourceIdentityResolverShape => ({
  resolve: (source) => {
    const url = parseAllowedTikTokUrl(source.url);
    if (url === undefined) {
      return Effect.fail(invalidSource());
    }

    const parsed = parseCanonicalPath(url);
    if (parsed !== undefined) {
      return Effect.succeed(parsed);
    }
    if (!shortLinkHosts.has(url.hostname)) {
      return Effect.fail(invalidSource());
    }
    return resolveShortLink(fetcher, url);
  },
});

const TikTokOEmbedResponse = Schema.Struct({
  html: Schema.String,
  type: Schema.Literal("video"),
  version: Schema.String,
});

const parseOEmbedUrl = (input: string): URL | undefined => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }

  return url.origin === "https://www.tiktok.com" &&
    url.username === "" &&
    url.password === "" &&
    url.port === ""
    ? url
    : undefined;
};

const fetchOEmbed = (fetcher: Fetcher, initial: URL) =>
  Effect.gen(function* fetchOEmbedEffect() {
    let current = initial;

    for (let hop = 0; hop < 3; hop += 1) {
      const response = yield* fetchManual(fetcher, current.toString(), {
        accept: "application/json",
      });

      if (response.status < 300 || response.status >= 400) {
        return response;
      }

      yield* cancelResponseBody(response);

      const location = response.headers.get("location");
      if (location === null) {
        return yield* Effect.fail(sourceValidationUnavailable());
      }
      const redirectLocation = resolveRedirectLocation(location, current);
      const next =
        redirectLocation === undefined
          ? undefined
          : parseOEmbedUrl(redirectLocation);
      if (next === undefined) {
        return yield* Effect.fail(sourceValidationUnavailable());
      }
      current = next;
    }

    return yield* Effect.fail(sourceValidationUnavailable());
  });

const MaximumOEmbedBytes = 65_536;

const cancelReader = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Effect.tryPromise({
    catch: sourceValidationUnavailable,
    try: () => reader.cancel(),
  }).pipe(Effect.ignore);

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
