import { Effect, Schema } from "effect";

import { SourceCanonicalId } from "./import.contracts.js";
import { invalidSource, sourceValidationUnavailable } from "./import.errors.js";
import type {
  CanonicalSourceIdentity,
  CanonicalSourceIdentityResolverShape,
} from "./source-identity.js";
import { ValidatedVideoUrl } from "./source-identity.js";

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

const fetchManual = (fetcher: Fetcher, url: string) =>
  Effect.tryPromise({
    catch: sourceValidationUnavailable,
    try: (signal) =>
      fetcher(url, {
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
