import { Effect, Option, Schema } from "effect";
import { html as parse5Html, parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";

import { SourceCanonicalId } from "./import.contracts.js";
import { invalidSource, sourceIdentityUnavailable } from "./import.errors.js";
import type {
  CanonicalIdentityResolution,
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
const MaximumHandoffBodyBytes = 512 * 1024;

const ignoreCancellation = async (cancellation: Promise<unknown>) => {
  try {
    await cancellation;
  } catch {
    // Best-effort release failures stay private.
  }
};

const cancelBestEffort = (cancel: () => Promise<unknown>) => {
  try {
    void ignoreCancellation(cancel());
  } catch {
    // Best-effort release must remain finite and privacy-safe.
  }
};

const TikTokHandoffMetadata = Schema.Struct({
  __DEFAULT_SCOPE__: Schema.Struct({
    "seo.abtest": Schema.Struct({
      canonical: Schema.String,
    }),
  }),
});

const TikTokHandoffItemMetadata = Schema.Struct({
  __DEFAULT_SCOPE__: Schema.Struct({
    "webapp.video-detail": Schema.Struct({
      itemInfo: Schema.Struct({
        itemStruct: Schema.Struct({
          author: Schema.Struct({
            uniqueId: Schema.String,
          }),
          id: Schema.String,
          imagePost: Schema.optionalKey(Schema.Unknown),
          video: Schema.optionalKey(Schema.Unknown),
        }),
      }),
      statusCode: Schema.Literal(0),
    }),
  }),
});

const TikTokHandlePattern = /^[A-Za-z0-9._]{1,24}$/u;
const TikTokCanonicalIdPattern = /^\d+$/u;

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
    /^\/@[^/]*\/(?:photo|photos)\/(?<canonicalId>\d+)\/?$/u.exec(url.pathname);
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
    catch: sourceIdentityUnavailable,
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
    catch: sourceIdentityUnavailable,
    try: () => body.cancel(),
  }).pipe(Effect.ignore);
};

const readBoundedResponseBody = (response: Response) =>
  Effect.tryPromise({
    catch: sourceIdentityUnavailable,
    try: async (signal) => {
      const { body } = response;
      const contentLength = response.headers.get("content-length");
      if (
        contentLength !== null &&
        (!/^\d+$/u.test(contentLength) ||
          Number(contentLength) > MaximumHandoffBodyBytes)
      ) {
        if (body !== null) {
          cancelBestEffort(() => body.cancel());
        }
        throw new Error("TikTok handoff body exceeds the resolution limit");
      }

      if (body === null) {
        throw new Error("TikTok handoff body is unavailable");
      }

      const reader = body.getReader();
      const cancelForInterruption = async () => {
        try {
          await reader.cancel();
        } catch {
          // The owning resolution is already interrupted.
        }
      };
      signal.addEventListener("abort", cancelForInterruption, { once: true });

      try {
        const decoder = new TextDecoder();
        let bytesRead = 0;
        let text = "";

        while (true) {
          // eslint-disable-next-line no-await-in-loop -- A response stream must be consumed serially under one byte budget.
          const next = await reader.read();
          if (next.done) {
            return `${text}${decoder.decode()}`;
          }
          bytesRead += next.value.byteLength;
          if (bytesRead > MaximumHandoffBodyBytes) {
            cancelBestEffort(() => reader.cancel());
            throw new Error("TikTok handoff body exceeds the resolution limit");
          }
          text += decoder.decode(next.value, { stream: true });
        }
      } finally {
        signal.removeEventListener("abort", cancelForInterruption);
      }
    },
  });

const getAttribute = (
  element: DefaultTreeAdapterTypes.Element,
  name: "id" | "type"
): string | undefined =>
  element.attrs.find((attribute) => attribute.name === name)?.value;

const findHydrationContent = (
  nodes: readonly DefaultTreeAdapterTypes.ChildNode[]
): string | undefined => {
  const pending = nodes.toReversed();

  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (node.nodeName === "template") {
      continue;
    }
    if (
      node.nodeName === "script" &&
      node.namespaceURI === parse5Html.NS.HTML &&
      getAttribute(node, "id") === "__UNIVERSAL_DATA_FOR_REHYDRATION__" &&
      getAttribute(node, "type")?.toLowerCase() === "application/json"
    ) {
      return node.childNodes
        .filter(
          (child): child is DefaultTreeAdapterTypes.TextNode =>
            child.nodeName === "#text"
        )
        .map((child) => child.value)
        .join("");
    }

    if ("childNodes" in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child !== undefined) {
          pending.push(child);
        }
      }
    }
  }
  return undefined;
};

const parseHandoffMetadata = (html: string): unknown | undefined => {
  const content = findHydrationContent(parse(html).childNodes);
  if (content === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
};

const parseHandoffCanonical = (decodedJson: unknown): string | undefined => {
  const metadata = Schema.decodeUnknownOption(TikTokHandoffMetadata)(
    decodedJson
  );
  return Option.isSome(metadata)
    ? metadata.value.__DEFAULT_SCOPE__["seo.abtest"].canonical
    : undefined;
};

const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseHandoffItem = (
  decodedJson: unknown
): CanonicalIdentityResolution | undefined => {
  const metadata = Schema.decodeUnknownOption(TikTokHandoffItemMetadata)(
    decodedJson
  );
  if (Option.isNone(metadata)) {
    return undefined;
  }

  const item =
    metadata.value.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct;
  if (
    !TikTokCanonicalIdPattern.test(item.id) ||
    !TikTokHandlePattern.test(item.author.uniqueId)
  ) {
    return undefined;
  }

  const hasVideo = isObject(item.video);
  const hasImagePost = isObject(item.imagePost);
  if (hasVideo === hasImagePost) {
    return undefined;
  }

  const canonicalUrl = parseAllowedTikTokUrl(
    `https://www.tiktok.com/@${item.author.uniqueId}/${hasVideo ? "video" : "photo"}/${item.id}`
  );
  return canonicalUrl === undefined
    ? undefined
    : parseCanonicalPath(canonicalUrl);
};

const resolutionsMatch = (
  left: CanonicalIdentityResolution,
  right: CanonicalIdentityResolution
): boolean =>
  left._tag === right._tag &&
  left.identity.kind === right.identity.kind &&
  left.identity.canonicalId === right.identity.canonicalId;

const resolveHandoffResponse = (response: Response) =>
  Effect.gen(function* resolveHandoffResponseEffect() {
    const contentType = response.headers.get("content-type");
    if (contentType === null || !/^text\/html(?:\s*;|$)/iu.test(contentType)) {
      yield* cancelResponseBody(response);
      return yield* Effect.fail(sourceIdentityUnavailable());
    }

    const html = yield* readBoundedResponseBody(response);
    const metadata = parseHandoffMetadata(html);
    if (metadata === undefined) {
      return yield* Effect.fail(sourceIdentityUnavailable());
    }
    const item = parseHandoffItem(metadata);
    const canonical = parseHandoffCanonical(metadata);

    if (canonical !== undefined) {
      const canonicalUrl = parseAllowedTikTokUrl(canonical);
      if (canonicalUrl === undefined) {
        return yield* Effect.fail(invalidSource());
      }
      const parsedCanonical = parseCanonicalPath(canonicalUrl);
      if (parsedCanonical !== undefined) {
        if (item !== undefined && !resolutionsMatch(parsedCanonical, item)) {
          return yield* Effect.fail(sourceIdentityUnavailable());
        }
        return parsedCanonical;
      }
    }

    return item === undefined
      ? yield* Effect.fail(sourceIdentityUnavailable())
      : item;
  });

const resolveShortLink = (fetcher: Fetcher, initial: URL) =>
  Effect.gen(function* resolveShortLinkEffect() {
    let current = initial;

    for (let hop = 0; hop < 5; hop += 1) {
      const response = yield* fetchManual(fetcher, current.toString());
      if (response.status === 200) {
        return yield* resolveHandoffResponse(response);
      }
      if (response.status < 300 || response.status >= 400) {
        yield* cancelResponseBody(response);
        return yield* Effect.fail(sourceIdentityUnavailable());
      }

      yield* cancelResponseBody(response);
      const location = response.headers.get("location");
      if (location === null) {
        return yield* Effect.fail(sourceIdentityUnavailable());
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

    return yield* Effect.fail(sourceIdentityUnavailable());
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
