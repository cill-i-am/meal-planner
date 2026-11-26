import { Effect, Option, Schema } from "effect";
import { html as parse5Html, parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";

import { SourceCanonicalId } from "../contracts/import.contracts.js";
import {
  invalidSource,
  sourceIdentityUnavailable,
} from "../contracts/import.errors.js";
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

const sanitizeLocator = (url: URL) => {
  const path = url.pathname.replace(/\/+$/u, "") || "/";
  {
    const checkedResult = `${url.origin}${path}`;
    return checkedResult;
  }
};

const makeIdentity = (canonicalId: string) => {
  const checkedResult: CanonicalSourceIdentity = {
    canonicalId: Schema.decodeUnknownSync(SourceCanonicalId)(canonicalId),
    kind: "tiktok",
  };
  return checkedResult;
};

const parseCanonicalPath = (url: URL) => {
  const videoMatch = /^\/@[^/]+\/video\/(?<canonicalId>\d+)\/?$/u.exec(
    url.pathname
  );
  const videoId = videoMatch?.groups?.["canonicalId"];
  if (videoId !== undefined) {
    const canonicalUrl = Schema.decodeUnknownSync(ValidatedVideoUrl)(
      sanitizeLocator(url)
    );
    {
      const checkedResult:
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
        | undefined = {
        _tag: "VideoIdentity",
        canonicalUrl,
        identity: makeIdentity(videoId),
        videoUrl: canonicalUrl,
      };
      return checkedResult;
    }
  }

  const photoMatch =
    /^\/@[^/]*\/(?:photo|photos)\/(?<canonicalId>\d+)\/?$/u.exec(url.pathname);
  const photoId = photoMatch?.groups?.["canonicalId"];
  if (photoId !== undefined) {
    const checkedResult:
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
      | undefined = {
      _tag: "UnsupportedIdentity",
      canonicalUrl: Schema.decodeUnknownSync(ValidatedVideoUrl)(
        sanitizeLocator(url)
      ),
      identity: makeIdentity(photoId),
    };
    return checkedResult;
  }
  {
    const checkedResult:
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
      | undefined = undefined;
    return checkedResult;
  }
};

const getAttribute = (
  element: DefaultTreeAdapterTypes.Element,
  name: "id" | "type"
) => {
  const checkedResult: string | undefined = element.attrs.find(
    (attribute) => attribute.name === name
  )?.value;
  return checkedResult;
};

const findHydrationContent = (
  nodes: readonly DefaultTreeAdapterTypes.ChildNode[]
) => {
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
      const checkedResult: string | undefined = node.childNodes
        .filter(
          (child): child is DefaultTreeAdapterTypes.TextNode =>
            child.nodeName === "#text"
        )
        .map((child) => child.value)
        .join("");
      return checkedResult;
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
  {
    const checkedResult: string | undefined = undefined;
    return checkedResult;
  }
};

const parseHandoffMetadata = (html: string) => {
  const content = findHydrationContent(parse(html).childNodes);
  if (content === undefined) {
    const checkedResult: Schema.Json | undefined = undefined;
    return checkedResult;
  }
  {
    const checkedResult: Schema.Json | undefined = Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))(content)
    );
    return checkedResult;
  }
};

const parseHandoffCanonical = (decodedJson: Schema.Json) => {
  const metadata = Schema.decodeUnknownOption(TikTokHandoffMetadata)(
    decodedJson
  );
  {
    const checkedResult: string | undefined = Option.isSome(metadata)
      ? metadata.value.__DEFAULT_SCOPE__["seo.abtest"].canonical
      : undefined;
    return checkedResult;
  }
};

const isJsonObject = (
  value: Schema.Json | undefined
): value is Schema.JsonObject =>
  Schema.is(Schema.Record(Schema.String, Schema.Json))(value);

const parseHandoffItem = (decodedJson: Schema.Json) => {
  const metadata = Schema.decodeUnknownOption(TikTokHandoffItemMetadata)(
    decodedJson
  );
  if (Option.isNone(metadata)) {
    const checkedResult: CanonicalIdentityResolution | undefined = undefined;
    return checkedResult;
  }

  const item =
    metadata.value.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct;
  if (
    !TikTokCanonicalIdPattern.test(item.id) ||
    !TikTokHandlePattern.test(item.author.uniqueId)
  ) {
    const checkedResult: CanonicalIdentityResolution | undefined = undefined;
    return checkedResult;
  }

  const hasVideo = isJsonObject(item.video);
  const hasImagePost = isJsonObject(item.imagePost);
  if (hasVideo === hasImagePost) {
    const checkedResult: CanonicalIdentityResolution | undefined = undefined;
    return checkedResult;
  }

  const canonicalUrl = parseTikTokHttpUrl(
    `https://www.tiktok.com/@${item.author.uniqueId}/${hasVideo ? "video" : "photo"}/${item.id}`
  );
  {
    const checkedResult: CanonicalIdentityResolution | undefined =
      canonicalUrl === undefined ? undefined : parseCanonicalPath(canonicalUrl);
    return checkedResult;
  }
};

const resolutionsMatch = (
  left: CanonicalIdentityResolution,
  right: CanonicalIdentityResolution
) => {
  const checkedResult: boolean =
    left._tag === right._tag &&
    left.identity.kind === right.identity.kind &&
    left.identity.canonicalId === right.identity.canonicalId;
  return checkedResult;
};

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
) => {
  const transport = makeTikTokHttpTransport(fetcher, options);
  {
    const checkedResult: CanonicalSourceIdentityResolver = {
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
    return checkedResult;
  }
};
