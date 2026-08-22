import { Effect, Option, Schema } from "effect";
import { html as parse5Html, parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";

import { SourceCanonicalId } from "./import.contracts.js";
import { invalidSource, sourceIdentityUnavailable } from "./import.errors.js";
import type {
  CanonicalIdentityResolution,
  CanonicalSourceIdentity,
  CanonicalSourceIdentityResolver,
} from "./source-identity.js";
import { ValidatedVideoUrl } from "./source-identity.js";
import {
  isTikTokShortLink,
  makeTikTokHttpTransport,
  parseTikTokHttpUrl,
} from "./tiktok-http.transport.js";
import type {
  TikTokFetcher,
  TikTokHttpPolicyOptions,
  TikTokTransportFailure,
} from "./tiktok-http.transport.js";

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
          imagePost: Schema.optionalKey(Schema.Json),
          video: Schema.optionalKey(Schema.Json),
        }),
      }),
      statusCode: Schema.Literal(0),
    }),
  }),
});

const TikTokHandlePattern = /^[A-Za-z0-9._]{1,24}$/u;
const TikTokCanonicalIdPattern = /^\d+$/u;

const sanitizeLocator = (url: URL): string => {
  const path = url.pathname.replace(/\/+$/u, "") || "/";
  return `${url.origin}${path}`;
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
      readonly canonicalUrl: ValidatedVideoUrl;
      readonly identity: CanonicalSourceIdentity;
    }
  | {
      readonly _tag: "VideoIdentity";
      readonly canonicalUrl: ValidatedVideoUrl;
      readonly identity: CanonicalSourceIdentity;
      readonly videoUrl: ValidatedVideoUrl;
    }
  | undefined => {
  const videoMatch = /^\/@[^/]+\/video\/(?<canonicalId>\d+)\/?$/u.exec(
    url.pathname
  );
  const videoId = videoMatch?.groups?.["canonicalId"];
  if (videoId !== undefined) {
    const canonicalUrl = Schema.decodeUnknownSync(ValidatedVideoUrl)(
      sanitizeLocator(url)
    );
    return {
      _tag: "VideoIdentity",
      canonicalUrl,
      identity: makeIdentity(videoId),
      videoUrl: canonicalUrl,
    };
  }

  const photoMatch =
    /^\/@[^/]*\/(?:photo|photos)\/(?<canonicalId>\d+)\/?$/u.exec(url.pathname);
  const photoId = photoMatch?.groups?.["canonicalId"];
  if (photoId !== undefined) {
    return {
      _tag: "UnsupportedIdentity",
      canonicalUrl: Schema.decodeUnknownSync(ValidatedVideoUrl)(
        sanitizeLocator(url)
      ),
      identity: makeIdentity(photoId),
    };
  }
  return undefined;
};

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

const parseHandoffMetadata = (html: string): Schema.Json | undefined => {
  const content = findHydrationContent(parse(html).childNodes);
  if (content === undefined) {
    return undefined;
  }
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))(content)
  );
};

const parseHandoffCanonical = (
  decodedJson: Schema.Json
): string | undefined => {
  const metadata = Schema.decodeUnknownOption(TikTokHandoffMetadata)(
    decodedJson
  );
  return Option.isSome(metadata)
    ? metadata.value.__DEFAULT_SCOPE__["seo.abtest"].canonical
    : undefined;
};

const isJsonObject = (
  value: Schema.Json | undefined
): value is Schema.JsonObject =>
  Schema.is(Schema.Record(Schema.String, Schema.Json))(value);

const parseHandoffItem = (
  decodedJson: Schema.Json
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

  const hasVideo = isJsonObject(item.video);
  const hasImagePost = isJsonObject(item.imagePost);
  if (hasVideo === hasImagePost) {
    return undefined;
  }

  const canonicalUrl = parseTikTokHttpUrl(
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

const resolveHandoffResponse = (html: string) =>
  Effect.gen(function* resolveHandoffResponseEffect() {
    const metadata = parseHandoffMetadata(html);
    if (metadata === undefined) {
      return yield* Effect.fail(sourceIdentityUnavailable());
    }
    const item = parseHandoffItem(metadata);
    const canonical = parseHandoffCanonical(metadata);

    if (canonical !== undefined) {
      const canonicalUrl = parseTikTokHttpUrl(canonical);
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

const mapTransportFailure = (failure: TikTokTransportFailure) =>
  failure._tag === "TikTokTransportInvalidTarget"
    ? invalidSource()
    : sourceIdentityUnavailable();

const resolveShortLink = (
  transport: ReturnType<typeof makeTikTokHttpTransport>,
  initial: URL
) =>
  Effect.gen(function* resolveShortLinkEffect() {
    const handoff = yield* transport
      .resolveHandoff(initial)
      .pipe(Effect.mapError(mapTransportFailure));
    if (handoff._tag === "HandoffHtml") {
      return yield* resolveHandoffResponse(handoff.body);
    }
    const parsed = parseCanonicalPath(handoff.url);
    return parsed === undefined
      ? yield* Effect.fail(sourceIdentityUnavailable())
      : parsed;
  });

export const makeTikTokCanonicalSourceIdentityResolver = (
  fetcher: TikTokFetcher,
  options?: TikTokHttpPolicyOptions
): CanonicalSourceIdentityResolver => {
  const transport = makeTikTokHttpTransport(fetcher, options);
  return {
    resolve: Effect.fn("TikTokCanonicalSourceIdentityResolver.resolve")(
      function* resolve(source) {
        const url = parseTikTokHttpUrl(source.url);
        if (url === undefined) {
          return yield* Effect.fail(invalidSource());
        }

        const parsed = parseCanonicalPath(url);
        if (parsed !== undefined) {
          return parsed;
        }
        if (!isTikTokShortLink(url)) {
          return yield* Effect.fail(invalidSource());
        }
        return yield* resolveShortLink(transport, url);
      }
    ),
  };
};
