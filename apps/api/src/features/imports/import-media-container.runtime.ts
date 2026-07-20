import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates curl gnupg nasm xz-utils && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --output /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp_linux && echo "6bbb3d314cde4febe36e5fa1d55462e29c974f63444e707871834f6d8cc210ae  /usr/local/bin/yt-dlp" | sha256sum --check && chmod 0555 /usr/local/bin/yt-dlp
RUN gpg --batch --keyserver hkps://keyserver.ubuntu.com --recv-keys FCF986EA15E6E293A5644F10B4322F04D67658D8 && test "$(gpg --with-colons --fingerprint FCF986EA15E6E293A5644F10B4322F04D67658D8 | awk -F: '$1 == "fpr" { print $10; exit }')" = "FCF986EA15E6E293A5644F10B4322F04D67658D8"
RUN curl --fail --location --output /tmp/ffmpeg.tar.xz https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz && curl --fail --location --output /tmp/ffmpeg.tar.xz.asc https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz.asc && gpg --batch --verify /tmp/ffmpeg.tar.xz.asc /tmp/ffmpeg.tar.xz
RUN mkdir /tmp/ffmpeg && tar --extract --xz --file /tmp/ffmpeg.tar.xz --strip-components=1 --directory /tmp/ffmpeg && cd /tmp/ffmpeg && ./configure --disable-debug --disable-doc --disable-ffplay --disable-network --disable-shared --enable-static && make -j2 && make install && ffmpeg -version | grep "ffmpeg version 8.1.2" && ffprobe -version | grep "ffprobe version 8.1.2"
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
      stream: (artifactId) => {
        const artifact = artifacts.get(artifactId);
        if (artifact === undefined || artifact.path === null) {
          return Stream.fail(retryableContainer());
        }
        const { path, root } = artifact;
        return Stream.fromEffect(scanTemporaryWorkspace(root)).pipe(
          Stream.flatMap(() =>
            Stream.fromReadableStream({
              evaluate: () =>
                Readable.toWeb(
                  createReadStream(path)
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
