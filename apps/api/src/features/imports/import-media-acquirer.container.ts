import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { open, readdir, rm, stat } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
// eslint-disable-next-line unicorn/import-style -- The root Alchemy TypeScript config disables synthetic default imports.
import { join } from "node:path";
import { checkServerIdentity } from "node:tls";

import { Effect } from "effect";

import type { MediaAcquirerShape } from "./import-media-acquirer.js";
import type { MediaProcessRunnerShape } from "./import-media-process.js";
import { scanTemporaryWorkspace } from "./import-media-process.js";
import {
  hasIsoBaseMediaFileType,
  validateMediaProbe,
} from "./import-media-validation.js";
import type { TerminalMediaFailure } from "./import-media.model.js";
import {
  MaximumMediaProcessMilliseconds,
  MaximumSourceRedirects,
} from "./import-media.model.js";
import { isSafeTikTokMediaLocator } from "./import-source-resolver.tiktok.js";

const terminal = (
  code: "invalid_media" | "limit_exceeded" | "unsupported_streams"
): TerminalMediaFailure => ({
  _tag: "TerminalMedia",
  code,
  stage: "validation",
});

const retryableDownload = () => ({
  _tag: "RetryableAcquisitionFailure" as const,
  stage: "container" as const,
});
const UnsafeMediaDestination = Symbol("UnsafeMediaDestination");
const MediaDownloadLimitExceeded = Symbol("MediaDownloadLimitExceeded");

const BlockedMediaAddresses = new BlockList();
const GlobalUnicastMediaAddresses = new BlockList();
GlobalUnicastMediaAddresses.addSubnet("2000::", 3, "ipv6");
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  BlockedMediaAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  BlockedMediaAddresses.addSubnet(network, prefix, "ipv6");
}

export const isPublicMediaAddress = (address: string) => {
  const family = isIP(address);
  if (family === 4) {
    return !BlockedMediaAddresses.check(address, "ipv4");
  }
  if (family === 6) {
    if (address.toLowerCase().startsWith("::ffff:")) {
      return false;
    }
    return (
      GlobalUnicastMediaAddresses.check(address, "ipv6") &&
      !BlockedMediaAddresses.check(address, "ipv6")
    );
  }
  return false;
};

export interface SecureMediaDownloadResponse {
  readonly body: AsyncIterable<Uint8Array>;
  readonly contentLength: number | null;
  readonly destroy: () => void;
  readonly location: string | undefined;
  readonly statusCode: number;
}

export interface SecureMediaDownloadClient {
  readonly request: (
    url: URL,
    address: string,
    signal: AbortSignal
  ) => Promise<SecureMediaDownloadResponse>;
  readonly resolve: (hostname: string) => Promise<readonly string[]>;
}

export interface SecureMediaDownloader {
  readonly download: (
    locator: string,
    destination: string,
    maximumBytes: number
  ) => Effect.Effect<
    void,
    ReturnType<typeof retryableDownload> | TerminalMediaFailure
  >;
}

const responseContentLength = (
  value: string | string[] | undefined
): number | null => {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) {
    return null;
  }
  const parsed = Number(first);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

export const NodeSecureMediaDownloadClient: SecureMediaDownloadClient = {
  request: (url, address, signal) =>
    // eslint-disable-next-line promise/avoid-new -- Node HTTPS exposes response callbacks, not a promise API.
    new Promise((resolve, reject) => {
      const request = httpsRequest(
        {
          checkServerIdentity: (_hostname, certificate) =>
            checkServerIdentity(url.hostname, certificate),
          headers: {
            accept: "*/*",
            host: url.hostname,
            "user-agent": "MealPlannerMediaAcquirer/1.0",
          },
          hostname: address,
          method: "GET",
          path: `${url.pathname}${url.search}`,
          servername: url.hostname,
          signal,
        },
        (response) => {
          resolve({
            body: response,
            contentLength: responseContentLength(
              response.headers["content-length"]
            ),
            destroy: () => response.destroy(),
            location: response.headers.location,
            statusCode: response.statusCode ?? 0,
          });
        }
      );
      request.once("error", reject);
      request.end();
    }),
  resolve: async (hostname) => {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map(({ address }) => address);
  },
};

const downloadFailure = (error: unknown) => {
  if (error === UnsafeMediaDestination) {
    return terminal("invalid_media");
  }
  if (error === MediaDownloadLimitExceeded) {
    return terminal("limit_exceeded");
  }
  return retryableDownload();
};

const requestSafeMedia = async (
  client: SecureMediaDownloadClient,
  locator: string,
  redirects: number,
  signal: AbortSignal
): Promise<SecureMediaDownloadResponse> => {
  if (!isSafeTikTokMediaLocator(locator)) {
    throw UnsafeMediaDestination;
  }
  const url = new URL(locator);
  const addresses = await client.resolve(url.hostname);
  if (
    addresses.length === 0 ||
    addresses.some((address) => !isPublicMediaAddress(address))
  ) {
    throw UnsafeMediaDestination;
  }
  const [address] = addresses;
  if (address === undefined) {
    throw UnsafeMediaDestination;
  }
  const response = await client.request(url, address, signal);
  if (
    [301, 302, 303, 307, 308].includes(response.statusCode) &&
    response.location !== undefined
  ) {
    response.destroy();
    if (redirects === MaximumSourceRedirects) {
      throw UnsafeMediaDestination;
    }
    return requestSafeMedia(
      client,
      new URL(response.location, locator).toString(),
      redirects + 1,
      signal
    );
  }
  return response;
};

export const makeSecureMediaDownloader = (
  client: SecureMediaDownloadClient
): SecureMediaDownloader => ({
  download: (locator, destination, maximumBytes) =>
    Effect.tryPromise({
      catch: downloadFailure,
      try: async (signal) => {
        const file = await open(destination, "wx");
        let completed = false;
        try {
          const response = await requestSafeMedia(client, locator, 0, signal);
          if (response.statusCode !== 200) {
            response.destroy();
            throw new Error("media download failed");
          }
          if (
            response.contentLength !== null &&
            response.contentLength > maximumBytes
          ) {
            response.destroy();
            throw MediaDownloadLimitExceeded;
          }
          let bytes = 0;
          for await (const chunk of response.body) {
            bytes += chunk.byteLength;
            if (bytes > maximumBytes) {
              response.destroy();
              throw MediaDownloadLimitExceeded;
            }
            await file.write(chunk);
          }
          if (bytes === 0) {
            throw MediaDownloadLimitExceeded;
          }
          completed = true;
        } finally {
          await file.close();
          if (!completed) {
            await rm(destination, { force: true });
          }
        }
      },
    }),
});

const checksumFile = (filePath: string) =>
  Effect.tryPromise({
    catch: () => terminal("invalid_media"),
    try: async () => {
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(filePath)) {
        digest.update(chunk as Buffer);
      }
      return digest.digest("hex");
    },
  });

export const makeContainerMediaAcquirer = (
  processRunner: MediaProcessRunnerShape,
  downloader: SecureMediaDownloader = makeSecureMediaDownloader(
    NodeSecureMediaDownloadClient
  )
): MediaAcquirerShape => ({
  acquire: (source, limits, workspaceRoot) =>
    Effect.gen(function* acquireMedia() {
      const deadlineAt = Date.now() + MaximumMediaProcessMilliseconds;
      const remainingMilliseconds = () => Math.max(1, deadlineAt - Date.now());
      yield* scanTemporaryWorkspace(workspaceRoot);
      const downloadPath = join(workspaceRoot, "source.download");
      yield* downloader
        .download(source.mediaLocator, downloadPath, limits.maximumMediaBytes)
        .pipe(
          Effect.timeoutOrElse({
            duration: remainingMilliseconds(),
            orElse: () => Effect.fail(retryableDownload()),
          })
        );
      yield* scanTemporaryWorkspace(workspaceRoot);
      const sources = (yield* Effect.tryPromise({
        catch: () => terminal("invalid_media"),
        try: () => readdir(workspaceRoot),
      })).filter((name) => name.startsWith("source."));
      const [sourceName, ...additionalSources] = sources;
      if (sourceName === undefined || additionalSources.length !== 0) {
        return yield* Effect.fail(terminal("invalid_media"));
      }
      const mediaPath = join(workspaceRoot, "original.mp4");
      yield* processRunner.run(
        "ffmpeg",
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          join(workspaceRoot, sourceName),
          "-map",
          "0:v:0",
          "-map",
          "0:a:0",
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          mediaPath,
        ],
        {
          deadlineMilliseconds: remainingMilliseconds(),
          failure: "terminal",
          workspaceRoot,
        }
      );
      yield* scanTemporaryWorkspace(workspaceRoot);
      const mediaStats = yield* Effect.tryPromise({
        catch: () => terminal("invalid_media"),
        try: () => stat(mediaPath),
      });
      const handle = yield* Effect.acquireRelease(
        Effect.tryPromise({
          catch: () => terminal("invalid_media"),
          try: () => open(mediaPath, "r"),
        }),
        (file) => Effect.promise(() => file.close()).pipe(Effect.ignore)
      );
      const header = new Uint8Array(12);
      yield* Effect.tryPromise({
        catch: () => terminal("invalid_media"),
        try: () => handle.read(header, 0, header.byteLength, 0),
      });
      if (!hasIsoBaseMediaFileType(header)) {
        return yield* Effect.fail(terminal("invalid_media"));
      }
      const probe = yield* processRunner.run(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_format",
          "-show_streams",
          "-of",
          "json",
          mediaPath,
        ],
        {
          deadlineMilliseconds: remainingMilliseconds(),
          failure: "terminal",
          workspaceRoot,
        }
      );
      const parsedProbe = yield* Effect.try({
        catch: () => terminal("invalid_media"),
        try: () =>
          JSON.parse(new TextDecoder().decode(probe.stdout)) as unknown,
      });
      const validated = yield* validateMediaProbe(parsedProbe, {
        actualBytes: mediaStats.size,
        maximumBytes: limits.maximumMediaBytes,
        maximumDurationSeconds: limits.maximumDurationSeconds,
      });
      return {
        ...validated,
        filePath: mediaPath,
        metadata: source.metadata,
        sha256: yield* checksumFile(mediaPath),
      };
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: MaximumMediaProcessMilliseconds,
        orElse: () =>
          Effect.fail({
            _tag: "RetryableAcquisitionFailure" as const,
            stage: "process" as const,
          }),
      })
    ),
});
