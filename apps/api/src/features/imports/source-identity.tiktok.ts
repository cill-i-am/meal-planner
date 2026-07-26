import { Effect, Option, Schema } from "effect";

import { SourceCanonicalId } from "./import.contracts.js";
import { invalidSource, sourceIdentityUnavailable } from "./import.errors.js";
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
const MaximumHandoffBodyBytes = 512 * 1024;

const TikTokHandoffMetadata = Schema.Struct({
  __DEFAULT_SCOPE__: Schema.Struct({
    "seo.abtest": Schema.Struct({
      canonical: Schema.String,
    }),
  }),
});

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
        await body?.cancel();
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

        const readNext = async (): Promise<string> => {
          const next = await reader.read();
          if (next.done) {
            return `${text}${decoder.decode()}`;
          }
          bytesRead += next.value.byteLength;
          if (bytesRead > MaximumHandoffBodyBytes) {
            await reader.cancel();
            throw new Error("TikTok handoff body exceeds the resolution limit");
          }
          text += decoder.decode(next.value, { stream: true });
          return readNext();
        };
        const result = await readNext();
        return result;
      } finally {
        signal.removeEventListener("abort", cancelForInterruption);
      }
    },
  });

const getQuotedAttribute = (
  attributes: string,
  name: "id" | "type"
): string | undefined => {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')`,
    "iu"
  ).exec(attributes);
  return match?.groups?.["double"] ?? match?.groups?.["single"];
};

const rawTextElementNames = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

interface HtmlTag {
  readonly _tag: "End" | "Start";
  readonly attributes: string;
  readonly end: number;
  readonly name: string;
  readonly selfClosing: boolean;
}

const findTagEnd = (html: string, start: number): number | undefined => {
  let quote: "'" | '"' | undefined;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return undefined;
};

const readNextTag = (html: string, start: number): HtmlTag | undefined => {
  let index = start;
  while (index < html.length) {
    const tagStart = html.indexOf("<", index);
    if (tagStart === -1) {
      return undefined;
    }

    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = /--!?>/gu;
      commentEnd.lastIndex = tagStart + 4;
      const match = commentEnd.exec(html);
      if (match === null) {
        return undefined;
      }
      index = commentEnd.lastIndex;
      continue;
    }

    if (html.startsWith("<!", tagStart) || html.startsWith("<?", tagStart)) {
      const declarationEnd = findTagEnd(html, tagStart + 2);
      if (declarationEnd === undefined) {
        return undefined;
      }
      index = declarationEnd + 1;
      continue;
    }

    const match = /^<(?<closing>\/)?\s*(?<name>[A-Za-z][\w:-]*)/u.exec(
      html.slice(tagStart)
    );
    const name = match?.groups?.["name"]?.toLowerCase();
    if (match === null || name === undefined) {
      index = tagStart + 1;
      continue;
    }

    const end = findTagEnd(html, tagStart + match[0].length);
    if (end === undefined) {
      return undefined;
    }
    const attributes = html.slice(tagStart + match[0].length, end);
    return {
      _tag: match.groups?.["closing"] === undefined ? "Start" : "End",
      attributes,
      end: end + 1,
      name,
      selfClosing: /\/\s*$/u.test(attributes),
    };
  }
  return undefined;
};

const findRawTextEnd = (
  html: string,
  elementName: string,
  start: number
): { readonly content: string; readonly end: number } | undefined => {
  const closingTag = new RegExp(`</${elementName}\\s*>`, "giu");
  closingTag.lastIndex = start;
  const match = closingTag.exec(html);
  return match === null
    ? undefined
    : {
        content: html.slice(start, match.index),
        end: closingTag.lastIndex,
      };
};

const decodeHandoffCanonical = (content: string): string | undefined => {
  let decodedJson: unknown;
  try {
    decodedJson = JSON.parse(content);
  } catch {
    return undefined;
  }
  const metadata = Schema.decodeUnknownOption(TikTokHandoffMetadata)(
    decodedJson
  );
  return Option.isSome(metadata)
    ? metadata.value.__DEFAULT_SCOPE__["seo.abtest"].canonical
    : undefined;
};

const isHydrationScript = (tag: HtmlTag): boolean =>
  tag.name === "script" &&
  getQuotedAttribute(tag.attributes, "id") ===
    "__UNIVERSAL_DATA_FOR_REHYDRATION__" &&
  getQuotedAttribute(tag.attributes, "type")?.toLowerCase() ===
    "application/json";

const parseHandoffCanonical = (html: string): string | undefined => {
  let index = 0;
  let templateDepth = 0;

  while (index < html.length) {
    const tag = readNextTag(html, index);
    if (tag === undefined) {
      return undefined;
    }

    if (tag._tag === "End") {
      if (tag.name === "template" && templateDepth > 0) {
        templateDepth -= 1;
      }
      index = tag.end;
      continue;
    }

    if (tag.name === "template" && !tag.selfClosing) {
      templateDepth += 1;
    }

    if (tag.name === "plaintext") {
      return undefined;
    }
    if (!rawTextElementNames.has(tag.name) || tag.selfClosing) {
      index = tag.end;
      continue;
    }

    const rawText = findRawTextEnd(html, tag.name, tag.end);
    if (rawText === undefined) {
      return undefined;
    }
    if (templateDepth === 0 && isHydrationScript(tag)) {
      return decodeHandoffCanonical(rawText.content);
    }
    index = rawText.end;
  }
  return undefined;
};

const resolveHandoffResponse = (response: Response) =>
  Effect.gen(function* resolveHandoffResponseEffect() {
    const contentType = response.headers.get("content-type");
    if (contentType === null || !/^text\/html(?:\s*;|$)/iu.test(contentType)) {
      yield* cancelResponseBody(response);
      return yield* Effect.fail(sourceIdentityUnavailable());
    }

    const html = yield* readBoundedResponseBody(response);
    const canonical = parseHandoffCanonical(html);
    if (canonical === undefined) {
      return yield* Effect.fail(sourceIdentityUnavailable());
    }

    const canonicalUrl = parseAllowedTikTokUrl(canonical);
    if (canonicalUrl === undefined) {
      return yield* Effect.fail(invalidSource());
    }
    const parsed = parseCanonicalPath(canonicalUrl);
    return parsed === undefined
      ? yield* Effect.fail(sourceIdentityUnavailable())
      : parsed;
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
