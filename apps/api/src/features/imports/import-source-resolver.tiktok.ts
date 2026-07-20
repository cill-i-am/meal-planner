import { Effect } from "effect";

import type { MediaProcessRunnerShape } from "./import-media-process.js";
import type {
  TerminalMediaFailure,
  TikTokIdentity,
  UnavailableFailure,
  UnsupportedCarouselFailure,
} from "./import-media.model.js";
import {
  MaximumConcurrentFragments,
  MaximumMediaDurationSeconds,
} from "./import-media.model.js";
import type { SourceResolverShape } from "./import-source-resolver.js";

const unavailable = (): UnavailableFailure => ({
  _tag: "Unavailable",
  code: "private_or_unavailable",
});
const unsupportedCarousel = (): UnsupportedCarouselFailure => ({
  _tag: "UnsupportedCarousel",
  code: "unsupported_carousel",
});
const invalidMetadata = (): TerminalMediaFailure => ({
  _tag: "TerminalMedia",
  code: "invalid_media",
  stage: "resolve",
});
const sourceLimitExceeded = (): TerminalMediaFailure => ({
  _tag: "TerminalMedia",
  code: "limit_exceeded",
  stage: "resolve",
});

const stringOrNull = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const AllowedMediaHostnameSuffixes = [
  "akamaized.net",
  "byteoversea.com",
  "ibytedtos.com",
  "muscdn.com",
  "tiktok.com",
  "tiktokcdn-us.com",
  "tiktokcdn.com",
  "tiktokv.com",
] as const;

const isAllowedMediaHostname = (hostname: string) =>
  AllowedMediaHostnameSuffixes.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  );

export const isSafeTikTokMediaLocator = (value: string) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.hash === "" &&
      hostname !== "localhost" &&
      !hostname.endsWith(".localhost") &&
      !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) &&
      !hostname.startsWith("[") &&
      isAllowedMediaHostname(hostname)
    );
  } catch {
    return false;
  }
};

const decodeMetadataRecord = (input: Uint8Array) => {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(input));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("invalid metadata");
  }
  return parsed as Record<string, unknown>;
};

const classifyMetadata = (record: Record<string, unknown>) => {
  if (record["_type"] === "playlist" || Array.isArray(record["entries"])) {
    return "carousel" as const;
  }
  if (
    record["availability"] === "needs_auth" ||
    record["availability"] === "private" ||
    record["availability"] === "subscriber_only"
  ) {
    return "unavailable" as const;
  }
  return "video" as const;
};

const validatedSourceFields = (
  record: Record<string, unknown>,
  identity: TikTokIdentity
) => {
  const id = stringOrNull(record["id"]);
  const canonicalUrl = stringOrNull(record["webpage_url"]);
  const mediaLocator = stringOrNull(record["url"]);
  if (
    id !== identity.canonicalId ||
    canonicalUrl === null ||
    mediaLocator === null ||
    !isSafeTikTokMediaLocator(mediaLocator)
  ) {
    throw new Error("invalid metadata");
  }
  const url = new URL(canonicalUrl);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !["tiktok.com", "www.tiktok.com"].includes(url.hostname) ||
    !new RegExp(`^/@[^/]+/video/${identity.canonicalId}$`, "u").test(
      url.pathname
    )
  ) {
    throw new Error("invalid canonical URL");
  }
  return {
    canonicalUrl: `https://www.tiktok.com${url.pathname}`,
    mediaLocator,
  };
};

const creatorHandle = (record: Record<string, unknown>) => {
  const uploaderUrl = stringOrNull(record["uploader_url"]);
  if (uploaderUrl === null) {
    return null;
  }
  const match = /^\/@(?<handle>[^/]+)$/u.exec(new URL(uploaderUrl).pathname);
  return match?.groups?.["handle"] ?? null;
};

const parseMetadata = (input: Uint8Array, identity: TikTokIdentity) =>
  Effect.try({
    catch: invalidMetadata,
    try: () => {
      const record = decodeMetadataRecord(input);
      const classification = classifyMetadata(record);
      if (classification === "carousel") {
        return { _tag: "carousel" as const };
      }
      if (classification === "unavailable") {
        return { _tag: "unavailable" as const };
      }
      const { canonicalUrl, mediaLocator } = validatedSourceFields(
        record,
        identity
      );
      if (
        typeof record["duration"] === "number" &&
        Number.isFinite(record["duration"]) &&
        record["duration"] > MaximumMediaDurationSeconds
      ) {
        return { _tag: "limit" as const };
      }
      const { timestamp } = record;
      const publishedAt =
        typeof timestamp === "number" && Number.isSafeInteger(timestamp)
          ? new Date(timestamp * 1000).toISOString()
          : null;
      const caption =
        stringOrNull(record["description"]) ?? stringOrNull(record["title"]);
      const displayName = stringOrNull(record["uploader"]);
      const creatorId = stringOrNull(record["uploader_id"]);
      const handle = creatorHandle(record);
      return {
        _tag: "video" as const,
        mediaLocator,
        metadata: {
          canonicalId: identity.canonicalId,
          canonicalUrl,
          caption,
          creator: {
            displayName,
            handle,
            id: creatorId,
          },
          observedAt: new Date().toISOString(),
          provenance: {
            canonicalUrl: "provider_observed" as const,
            caption: caption === null ? null : ("creator_provided" as const),
            creator: {
              displayName:
                displayName === null ? null : ("provider_observed" as const),
              handle: handle === null ? null : ("provider_observed" as const),
              id: creatorId === null ? null : ("provider_observed" as const),
            },
            publishedAt:
              publishedAt === null ? null : ("provider_observed" as const),
          },
          publishedAt,
        },
      };
    },
  });

export const makeTikTokSourceResolver = (
  processRunner: MediaProcessRunnerShape
): SourceResolverShape => ({
  resolve: (identity) =>
    Effect.gen(function* resolveTikTokSource() {
      const sourceUrl = `https://www.tiktok.com/@_/video/${identity.canonicalId}`;
      const result = yield* processRunner.run(
        "yt-dlp",
        [
          "--ignore-config",
          "--no-cache-dir",
          "--dump-single-json",
          "--skip-download",
          "--no-playlist",
          "--socket-timeout",
          "30",
          "--retries",
          "0",
          "--fragment-retries",
          "0",
          "--concurrent-fragments",
          String(MaximumConcurrentFragments),
          sourceUrl,
        ],
        { deadlineMilliseconds: 30_000, failure: "retryable" }
      );
      const parsed = yield* parseMetadata(result.stdout, identity);
      switch (parsed._tag) {
        case "carousel": {
          return yield* Effect.fail(unsupportedCarousel());
        }
        case "limit": {
          return yield* Effect.fail(sourceLimitExceeded());
        }
        case "unavailable": {
          return yield* Effect.fail(unavailable());
        }
        case "video": {
          return {
            mediaLocator: parsed.mediaLocator,
            metadata: parsed.metadata,
          };
        }
        default: {
          return yield* Effect.fail(invalidMetadata());
        }
      }
    }),
});
