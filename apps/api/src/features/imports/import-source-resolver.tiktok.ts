import { constants } from "node:fs";
import { open, rm } from "node:fs/promises";
// eslint-disable-next-line unicorn/import-style -- The root Alchemy TypeScript config disables synthetic default imports.
import { join } from "node:path";

import { Clock, Effect } from "effect";

import type { MediaProcessRunnerShape } from "./import-media-process.js";
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
  SourceResolverShape,
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

const stringOrNull = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const containsControlCharacter = (value: string) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });

const safeHeaderValue = (value: unknown, maximumLength: number) => {
  if (
    typeof value !== "string" ||
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
  headers: Record<string, unknown>,
  name: string,
  maximumLength: number
) => {
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name
  );
  return safeHeaderValue(entry?.[1], maximumLength);
};

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
  record: Record<string, unknown>
): MediaRequestHeaders => {
  const raw = record["http_headers"];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  const headers = raw as Record<string, unknown>;
  const accept = headerValue(headers, "accept", 1024);
  const acceptLanguage = headerValue(headers, "accept-language", 256);
  const referer = safeTikTokReferer(headerValue(headers, "referer", 2048));
  const userAgent = headerValue(headers, "user-agent", 1024);
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

const parseMetadata = Effect.fn("ImportMedia.parseTikTokMetadata")(
  function* parseTikTokMetadataEffect(
    input: Uint8Array,
    identity: TikTokIdentity
  ) {
    const currentTimeMillis = yield* Clock.currentTimeMillis;
    return yield* Effect.try({
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
        const requestHeaders = mediaRequestHeaders(record);
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
            observedAt: new Date(currentTimeMillis).toISOString(),
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
          requestHeaders,
        };
      },
    });
  }
);

export const makeTikTokSourceResolver = (
  processRunner: MediaProcessRunnerShape
): SourceResolverShape => ({
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
            if (
              !stats.isFile() ||
              stats.mode % 0o1000 !== 0o600 ||
              (typeof process.getuid === "function" &&
                stats.uid !== process.getuid()) ||
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
