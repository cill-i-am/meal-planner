import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
// eslint-disable-next-line unicorn/import-style -- This TypeScript target does not enable synthetic default imports.
import * as path from "node:path";
import { Readable } from "node:stream";

import { Effect, Stream } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { makeContainerMediaAcquirer } from "./import-media-acquirer.container.js";
import { TikTokMediaContainer } from "./import-media-container.js";
import {
  makeMediaProcessRunner,
  makeTemporaryArtifactStore,
  NodeCommandExecutor,
  scanTemporaryWorkspace,
} from "./import-media-process.js";
import {
  acquisitionArtifactId,
  ProductionMediaLimits,
} from "./import-media.model.js";
import { makeTikTokSourceResolver } from "./import-source-resolver.tiktok.js";

export const TikTokMediaContainerDockerfile = `
FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90 AS tools
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates curl git gnupg nasm xz-utils && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --output /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp_linux && echo "6bbb3d314cde4febe36e5fa1d55462e29c974f63444e707871834f6d8cc210ae  /usr/local/bin/yt-dlp" | sha256sum --check && chmod 0555 /usr/local/bin/yt-dlp
RUN gpg --batch --keyserver hkps://keyserver.ubuntu.com --recv-keys DD1EC9E8DE085C629B3E1846B18E8928B3948D64 && test "$(gpg --with-colons --fingerprint DD1EC9E8DE085C629B3E1846B18E8928B3948D64 | awk -F: '$1 == "fpr" { print $10; exit }')" = "DD1EC9E8DE085C629B3E1846B18E8928B3948D64"
RUN git init /tmp/ffmpeg-source && cd /tmp/ffmpeg-source && git remote add origin https://github.com/FFmpeg/FFmpeg.git && git fetch --depth 1 origin tag n8.1.2 && git verify-tag n8.1.2 && test "$(git rev-parse 'n8.1.2^{commit}')" = "38b88335f99e76ed89ff3c93f877fdefce736c13" && git checkout --detach n8.1.2 && test "$(git rev-parse HEAD)" = "38b88335f99e76ed89ff3c93f877fdefce736c13" && mkdir /tmp/ffmpeg && git archive --format=tar n8.1.2 | tar --extract --directory /tmp/ffmpeg
RUN cd /tmp/ffmpeg && ./configure --disable-debug --disable-doc --disable-ffplay --disable-network --disable-shared --enable-static && make -j2 && make install && ffmpeg -version | grep "ffmpeg version 8.1.2" && ffprobe -version | grep "ffprobe version 8.1.2"
FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90
COPY --from=tools /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp
COPY --from=tools /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=tools /usr/local/bin/ffprobe /usr/local/bin/ffprobe
RUN groupadd --gid 10001 media && useradd --uid 10001 --gid media --no-create-home --home-dir /nonexistent media && mkdir /work && chown media:media /work
USER 10001:10001
`;

const retryableContainer = () => ({
  _tag: "RetryableAcquisitionFailure" as const,
  stage: "container" as const,
});

export default TikTokMediaContainer.make(
  {
    dockerfile: TikTokMediaContainerDockerfile,
    instanceType: "standard-1",
    main: import.meta.url,
    maxInstances: 2,
    runtime: "node",
  },
  Effect.sync(() => {
    const artifacts = makeTemporaryArtifactStore((root) =>
      rm(root, { force: true, recursive: true })
    );
    const processRunner = makeMediaProcessRunner(NodeCommandExecutor);
    const resolver = makeTikTokSourceResolver(processRunner);
    const acquirer = makeContainerMediaAcquirer(processRunner);

    const cleanup = (artifactId: string) =>
      Effect.tryPromise({
        catch: retryableContainer,
        try: () => artifacts.cleanup(artifactId),
      }).pipe(Effect.orDie);

    return TikTokMediaContainer.of({
      cleanup,
      fetch: Effect.succeed(HttpServerResponse.text("ready")),
      prepare: (request) =>
        Effect.gen(function* prepareMedia() {
          const artifactId = acquisitionArtifactId(
            request.importId,
            request.generation
          );
          yield* cleanup(artifactId);
          return yield* artifacts.use(
            artifactId,
            Effect.tryPromise({
              catch: retryableContainer,
              try: () =>
                mkdtemp(`${tmpdir()}/meal-planner-media-${request.importId}-`),
            }),
            (root) =>
              Effect.gen(function* resolveAndAcquire() {
                const resolved = yield* resolver.resolve(request);
                const artifact = yield* acquirer.acquire(
                  resolved,
                  ProductionMediaLimits,
                  root
                );
                artifacts.setPath(artifactId, artifact.filePath);
                return {
                  artifactId,
                  audioStreams: artifact.audioStreams,
                  bytes: artifact.bytes,
                  durationSeconds: artifact.durationSeconds,
                  metadata: artifact.metadata,
                  sha256: artifact.sha256,
                  videoStreams: artifact.videoStreams,
                };
              })
          );
        }),
      prepareProviderEvidence: (artifactId, durationSeconds) =>
        Effect.gen(function* prepareProviderEvidence() {
          const artifact = artifacts.get(artifactId);
          if (artifact === undefined || artifact.path === null) {
            return yield* Effect.fail(retryableContainer());
          }
          const sourcePath = artifact.path;
          const audioPath = path.join(artifact.root, "provider-audio.wav");
          yield* processRunner
            .run(
              "ffmpeg",
              [
                "-nostdin",
                "-y",
                "-i",
                sourcePath,
                "-map",
                "0:a:0",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                audioPath,
              ],
              {
                deadlineMilliseconds: 120_000,
                failure: "retryable",
                workspaceRoot: artifact.root,
              }
            )
            .pipe(Effect.mapError(retryableContainer));
          const boundedDuration = Math.max(1, durationSeconds);
          const timestamps = [0.2, 0.5, 0.8].map((fraction) =>
            Math.max(0, Math.floor(boundedDuration * fraction * 1000))
          );
          const frames = yield* Effect.forEach(
            timestamps,
            (timestampMilliseconds, index) =>
              Effect.gen(function* prepareFrame() {
                const framePath = path.join(
                  artifact.root,
                  `provider-frame-${index}.jpg`
                );
                yield* processRunner
                  .run(
                    "ffmpeg",
                    [
                      "-nostdin",
                      "-y",
                      "-ss",
                      String(timestampMilliseconds / 1000),
                      "-i",
                      sourcePath,
                      "-frames:v",
                      "1",
                      "-vf",
                      "scale='min(1280,iw)':-2",
                      framePath,
                    ],
                    {
                      deadlineMilliseconds: 60_000,
                      failure: "retryable",
                      workspaceRoot: artifact.root,
                    }
                  )
                  .pipe(Effect.mapError(retryableContainer));
                const probe = yield* processRunner
                  .run(
                    "ffprobe",
                    [
                      "-v",
                      "error",
                      "-select_streams",
                      "v:0",
                      "-show_entries",
                      "stream=width,height",
                      "-of",
                      "json",
                      framePath,
                    ],
                    {
                      deadlineMilliseconds: 10_000,
                      failure: "retryable",
                      workspaceRoot: artifact.root,
                    }
                  )
                  .pipe(Effect.mapError(retryableContainer));
                const dimensions = yield* Effect.try({
                  catch: retryableContainer,
                  try: () =>
                    JSON.parse(new TextDecoder().decode(probe.stdout)) as {
                      readonly streams?: readonly {
                        readonly height?: number;
                        readonly width?: number;
                      }[];
                    },
                });
                const { height, width } = dimensions.streams?.[0] ?? {};
                if (
                  !Number.isSafeInteger(height) ||
                  !Number.isSafeInteger(width) ||
                  height === undefined ||
                  width === undefined ||
                  height <= 0 ||
                  width <= 0
                ) {
                  return yield* Effect.fail(retryableContainer());
                }
                const bytes = yield* Effect.tryPromise({
                  catch: retryableContainer,
                  try: () => readFile(framePath),
                });
                const derivedArtifactId = `${artifactId}:frame:${index}`;
                artifacts.registerPath(
                  derivedArtifactId,
                  artifact.root,
                  framePath
                );
                return {
                  artifactId: derivedArtifactId,
                  bytes: bytes.byteLength,
                  height,
                  sha256: createHash("sha256").update(bytes).digest("hex"),
                  timestampMilliseconds,
                  width,
                };
              }),
            { concurrency: 1 }
          );
          const audioBytes = yield* Effect.tryPromise({
            catch: retryableContainer,
            try: () => readFile(audioPath),
          });
          const audioStats = yield* Effect.tryPromise({
            catch: retryableContainer,
            try: () => stat(audioPath),
          });
          if (audioStats.size !== audioBytes.byteLength) {
            return yield* Effect.fail(retryableContainer());
          }
          const audioArtifactId = `${artifactId}:audio`;
          artifacts.registerPath(audioArtifactId, artifact.root, audioPath);
          return {
            audio: {
              artifactId: audioArtifactId,
              bytes: audioBytes.byteLength,
              durationMilliseconds: Math.round(durationSeconds * 1000),
              sha256: createHash("sha256").update(audioBytes).digest("hex"),
            },
            frames,
          };
        }),
      stream: (artifactId) => {
        const artifact = artifacts.get(artifactId);
        if (artifact === undefined || artifact.path === null) {
          return Stream.fail(retryableContainer());
        }
        const { path: artifactPath, root } = artifact;
        return Stream.fromEffect(scanTemporaryWorkspace(root)).pipe(
          Stream.flatMap(() =>
            Stream.fromReadableStream({
              evaluate: () =>
                Readable.toWeb(
                  createReadStream(artifactPath)
                ) as ReadableStream<Uint8Array>,
              onError: retryableContainer,
            })
          ),
          Stream.mapError(retryableContainer)
        );
      },
    });
  })
);
