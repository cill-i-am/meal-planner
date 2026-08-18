import { constants } from "node:fs";
import { open, rm } from "node:fs/promises";
// eslint-disable-next-line unicorn/import-style -- The root Alchemy TypeScript config disables synthetic default imports.
import { join } from "node:path";

import { Clock, Effect, Schema } from "effect";

import type { MediaProcessRunner } from "./import-media-process.js";
import {
  RetryableAcquisitionError,
  TerminalMediaError,
  UnavailableError,
  UnsupportedCarouselError,
} from "./import-media.errors.js";
import {
  MaximumConcurrentFragments,
  MaximumMediaDurationSeconds,
} from "./import-media.model.js";
import type {
  RetryableAcquisitionFailure,
  TerminalMediaFailure,
  TikTokIdentity,
  UnavailableFailure,
  UnsupportedCarouselFailure,
} from "./import-media.model.js";
import type {
  MediaRequestHeaders,
  SourceResolver,
} from "./import-source-resolver.js";
import {
  decodeTikTokMediaSession,
  isAllowedTikTokMediaHostname,
} from "./import-source-session.js";

const unavailable = (): UnavailableFailure =>
  new UnavailableError({ code: "private_or_unavailable" });
const retryableSession = (): RetryableAcquisitionFailure =>
  new RetryableAcquisitionError({ stage: "resolve" });
const invalidSession = (): RetryableAcquisitionFailure =>
  new RetryableAcquisitionError({
    reason: "media_session_invalid",
    stage: "resolve",
  });
const unsupportedCarousel = (): UnsupportedCarouselFailure =>
  new UnsupportedCarouselError({ code: "unsupported_carousel" });
const invalidMetadata = (): TerminalMediaFailure =>
  new TerminalMediaError({ code: "invalid_media", stage: "resolve" });
const sourceLimitExceeded = (): TerminalMediaFailure =>
  new TerminalMediaError({ code: "limit_exceeded", stage: "resolve" });

const TikTokProviderMetadataEnvelope = Schema.Struct({
  _type: Schema.optionalKey(Schema.Json),
  availability: Schema.optionalKey(Schema.Json),
  description: Schema.optionalKey(Schema.Json),
  duration: Schema.optionalKey(Schema.Json),
  entries: Schema.optionalKey(Schema.Json),
  http_headers: Schema.optionalKey(Schema.Json),
  id: Schema.optionalKey(Schema.Json),
  timestamp: Schema.optionalKey(Schema.Json),
  title: Schema.optionalKey(Schema.Json),
  uploader: Schema.optionalKey(Schema.Json),
  uploader_id: Schema.optionalKey(Schema.Json),
  uploader_url: Schema.optionalKey(Schema.Json),
  url: Schema.optionalKey(Schema.Json),
  webpage_url: Schema.optionalKey(Schema.Json),
});
type TikTokProviderMetadataEnvelope =
  typeof TikTokProviderMetadataEnvelope.Type;

const decodeTikTokProviderMetadataEnvelope = Schema.decodeUnknownSync(
  Schema.fromJsonString(TikTokProviderMetadataEnvelope)
);

const stringOrNull = (value: Schema.Json | undefined) =>
  Schema.is(Schema.String)(value) && value.trim().length > 0 ? value : null;

const containsControlCharacter = (value: string) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });

const safeHeaderValue = (
  value: Schema.Json | undefined,
  maximumLength: number
) => {
  if (
    !Schema.is(Schema.String)(value) ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    containsControlCharacter(value)
  ) {
    return;
  }
  return value;
};

const headerValue = (
  headers: Schema.JsonObject,
  name: string,
  maximumLength: number
) => {
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name
  );
  return safeHeaderValue(entry?.[1], maximumLength);
};

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Schema.is(Schema.Record(Schema.String, Schema.Json))(value);

const safeTikTokReferer = (value: string | undefined) => {
  if (value === undefined) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !["tiktok.com", "www.tiktok.com"].includes(url.hostname.toLowerCase())
    ) {
      return null;
    }
    return `https://www.tiktok.com${url.pathname}`;
  } catch {
    return null;
  }
};

const mediaRequestHeaders = (
  raw: Schema.Json | undefined
): MediaRequestHeaders => {
  if (raw === undefined || !isJsonObject(raw)) {
    return {};
  }
  const accept = headerValue(raw, "accept", 1024);
  const acceptLanguage = headerValue(raw, "accept-language", 256);
  const referer = safeTikTokReferer(headerValue(raw, "referer", 2048));
  const userAgent = headerValue(raw, "user-agent", 1024);
  return {
    ...(accept === undefined ? {} : { accept }),
    ...(acceptLanguage === undefined ? {} : { acceptLanguage }),
    ...(referer === null ? {} : { referer }),
    ...(userAgent === undefined ? {} : { userAgent }),
  };
};

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
      isAllowedTikTokMediaHostname(hostname)
    );
  } catch {
    return false;
  }
};

const classifyMetadata = (metadata: TikTokProviderMetadataEnvelope) => {
  if (metadata._type === "playlist" || Array.isArray(metadata.entries)) {
    return "carousel" as const;
  }
  if (
    metadata.availability === "needs_auth" ||
    metadata.availability === "private" ||
    metadata.availability === "subscriber_only"
  ) {
    return "unavailable" as const;
  }
  return "video" as const;
};

const validatedSourceFields = (
  metadata: TikTokProviderMetadataEnvelope,
  identity: TikTokIdentity
) => {
  const id = stringOrNull(metadata.id);
  const canonicalUrl = stringOrNull(metadata.webpage_url);
  const mediaLocator = stringOrNull(metadata.url);
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

const creatorHandle = (uploaderUrlValue: Schema.Json | undefined) => {
  const uploaderUrl = stringOrNull(uploaderUrlValue);
  if (uploaderUrl === null) {
    return null;
  }
  const match = /^\/@(?<handle>[^/]+)$/u.exec(new URL(uploaderUrl).pathname);
  return match?.groups?.["handle"] ?? null;
};

type TikTokProviderMetadata =
  | { readonly _tag: "carousel" }
  | { readonly _tag: "limit" }
  | { readonly _tag: "unavailable" }
  | {
      readonly _tag: "video";
      readonly canonicalUrl: string;
      readonly caption: string | null;
      readonly creator: {
        readonly displayName: string | null;
        readonly handle: string | null;
        readonly id: string | null;
      };
      readonly mediaLocator: string;
      readonly publishedAt: string | null;
      readonly requestHeaders: MediaRequestHeaders;
    };

const decodeTikTokProviderMetadata = (
  input: Uint8Array,
  identity: TikTokIdentity
): TikTokProviderMetadata => {
  const metadata = decodeTikTokProviderMetadataEnvelope(
    new TextDecoder().decode(input)
  );
  const classification = classifyMetadata(metadata);
  if (classification === "carousel") {
    return { _tag: "carousel" };
  }
  if (classification === "unavailable") {
    return { _tag: "unavailable" };
  }
  const { canonicalUrl, mediaLocator } = validatedSourceFields(
    metadata,
    identity
  );
  if (
    Schema.is(Schema.Number)(metadata.duration) &&
    Number.isFinite(metadata.duration) &&
    metadata.duration > MaximumMediaDurationSeconds
  ) {
    return { _tag: "limit" };
  }
  const { timestamp } = metadata;
  return {
    _tag: "video",
    canonicalUrl,
    caption: stringOrNull(metadata.description) ?? stringOrNull(metadata.title),
    creator: {
      displayName: stringOrNull(metadata.uploader),
      handle: creatorHandle(metadata.uploader_url),
      id: stringOrNull(metadata.uploader_id),
    },
    mediaLocator,
    publishedAt:
      Schema.is(Schema.Number)(timestamp) && Number.isSafeInteger(timestamp)
        ? new Date(timestamp * 1000).toISOString()
        : null,
    requestHeaders: mediaRequestHeaders(metadata.http_headers),
  };
};

const parseMetadata = Effect.fn("ImportMedia.parseTikTokMetadata")(
  function* parseTikTokMetadataEffect(
    input: Uint8Array,
    identity: TikTokIdentity
  ) {
    const currentTimeMillis = yield* Clock.currentTimeMillis;
    const decoded = yield* Effect.try({
      catch: invalidMetadata,
      try: () => decodeTikTokProviderMetadata(input, identity),
    });
    if (decoded._tag !== "video") {
      return decoded;
    }
    const { canonicalUrl, caption, creator, mediaLocator, publishedAt } =
      decoded;
    return {
      _tag: "video" as const,
      mediaLocator,
      metadata: {
        canonicalId: identity.canonicalId,
        canonicalUrl,
        caption,
        creator,
        observedAt: new Date(currentTimeMillis).toISOString(),
        provenance: {
          canonicalUrl: "provider_observed" as const,
          caption: caption === null ? null : ("creator_provided" as const),
          creator: {
            displayName:
              creator.displayName === null
                ? null
                : ("provider_observed" as const),
            handle:
              creator.handle === null ? null : ("provider_observed" as const),
            id: creator.id === null ? null : ("provider_observed" as const),
          },
          publishedAt:
            publishedAt === null ? null : ("provider_observed" as const),
        },
        publishedAt,
      },
      requestHeaders: decoded.requestHeaders,
    };
  }
);

export const makeTikTokSourceResolver = (
  processRunner: MediaProcessRunner
): SourceResolver => ({
  resolve: Effect.fn("ImportMedia.resolveTikTokSource")(
    (identity, workspaceRoot) => {
      const sessionPath = join(workspaceRoot, "yt-dlp-session.cookies");
      const createSessionFile = Effect.tryPromise({
        catch: retryableSession,
        try: async () => {
          try {
            const file = await open(sessionPath, "wx", 0o600);
            try {
              await file.writeFile("# Netscape HTTP Cookie File\n");
            } finally {
              await file.close();
            }
            return sessionPath;
          } catch (error) {
            await rm(sessionPath, { force: true });
            throw error;
          }
        },
      });
      const removeSessionFile = () =>
        Effect.tryPromise({
          catch: retryableSession,
          try: () => rm(sessionPath, { force: true }),
        });
      const readSession = Effect.tryPromise({
        catch: invalidSession,
        try: async () => {
          const file = await open(
            sessionPath,
            // eslint-disable-next-line no-bitwise -- O_NOFOLLOW must be combined with the read-only flag to reject symlink substitution.
            constants.O_RDONLY | constants.O_NOFOLLOW
          );
          try {
            const stats = await file.stat();
            const processUserId = process.getuid?.();
            if (
              !stats.isFile() ||
              stats.mode % 0o1000 !== 0o600 ||
              (processUserId !== undefined && stats.uid !== processUserId) ||
              stats.size <= 0 ||
              stats.size > 64 * 1024
            ) {
              throw new Error("invalid session file");
            }
            return decodeTikTokMediaSession(await file.readFile());
          } finally {
            await file.close();
          }
        },
      });
      return Effect.acquireUseRelease(
        createSessionFile,
        () =>
          Effect.gen(function* resolveTikTokSource() {
            const sourceUrl = `https://www.tiktok.com/@_/video/${identity.canonicalId}`;
            const result = yield* processRunner.run(
              "yt-dlp",
              [
                "--ignore-config",
                "--no-cache-dir",
                "--cookies",
                sessionPath,
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
              {
                deadlineMilliseconds: 30_000,
                failure: "retryable",
                workspaceRoot,
              }
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
                const session = yield* readSession;
                return {
                  mediaLocator: parsed.mediaLocator,
                  metadata: parsed.metadata,
                  requestHeaders: parsed.requestHeaders,
                  session,
                };
              }
              default: {
                return yield* Effect.fail(invalidMetadata());
              }
            }
          }),
        removeSessionFile
      );
    }
  ),
});
