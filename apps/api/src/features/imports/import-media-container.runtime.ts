import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { Effect, Option, Schema, Stream } from "effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { makeContainerMediaAcquirer } from "./import-media-acquirer.container.js";
import type { MediaAcquirer } from "./import-media-acquirer.js";
import { PrivateMediaArtifactPathPrefix } from "./import-media-artifact-transport.js";
import { TikTokMediaContainer } from "./import-media-container.js";
import {
  makeMediaProcessRunner,
  makeTemporaryArtifactStore,
  NodeCommandExecutor,
  scanTemporaryWorkspace,
} from "./import-media-process.js";
import type { MediaProcessRunner } from "./import-media-process.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import type { TikTokIdentity } from "./import-media.model.js";
import {
  acquisitionArtifactId,
  FrameTimestampMilliseconds,
  MediaArtifactId,
  MediaByteCount,
  MediaDurationMilliseconds,
  MediaDurationSeconds,
  ProductionMediaLimits,
  Sha256Hex,
} from "./import-media.model.js";
import type { SourceResolver } from "./import-source-resolver.js";
import { makeTikTokSourceResolver } from "./import-source-resolver.tiktok.js";

export const TikTokMediaContainerDockerfile = `
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS tools
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates curl git gnupg nasm xz-utils && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --output /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_linux && echo "58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a  /usr/local/bin/yt-dlp" | sha256sum --check && chmod 0555 /usr/local/bin/yt-dlp
RUN gpg --batch --keyserver hkps://keyserver.ubuntu.com --recv-keys DD1EC9E8DE085C629B3E1846B18E8928B3948D64 && test "$(gpg --with-colons --fingerprint DD1EC9E8DE085C629B3E1846B18E8928B3948D64 | awk -F: '$1 == "fpr" { print $10; exit }')" = "DD1EC9E8DE085C629B3E1846B18E8928B3948D64"
RUN git init /tmp/ffmpeg-source && cd /tmp/ffmpeg-source && git remote add origin https://github.com/FFmpeg/FFmpeg.git && git fetch --depth 1 origin tag n9.0.1 && git verify-tag n9.0.1 && test "$(git rev-parse 'n9.0.1^{commit}')" = "bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa" && git checkout --detach n9.0.1 && test "$(git rev-parse HEAD)" = "bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa" && mkdir /tmp/ffmpeg && git archive --format=tar n9.0.1 | tar --extract --directory /tmp/ffmpeg
RUN cd /tmp/ffmpeg && ./configure --disable-debug --disable-doc --disable-ffplay --disable-network --disable-shared --enable-static && make -j2 && make install && ffmpeg -version | grep "ffmpeg version 9.0.1" && ffprobe -version | grep "ffprobe version 9.0.1"
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
COPY --from=tools /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp
COPY --from=tools /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=tools /usr/local/bin/ffprobe /usr/local/bin/ffprobe
RUN groupadd --gid 10001 media && useradd --uid 10001 --gid media --no-create-home --home-dir /nonexistent media && mkdir -p /work/tmp && chown -R media:media /work
ENV TMPDIR=/work/tmp
USER 10001:10001
`;

const retryableContainer = () =>
  new RetryableAcquisitionError({ stage: "container" });

const temporaryWorkspaceUnavailable = () =>
  new RetryableAcquisitionError({
    reason: "temporary_workspace_unavailable",
    stage: "container",
  });

const privateArtifactHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
} as const;

const closedArtifactResponse = (status: number) =>
  HttpServerResponse.empty({ headers: privateArtifactHeaders, status });

const registeredArtifactMissing = () =>
  ({ _tag: "RegisteredArtifactMissing" }) as const;

const decodeFrameDimensions = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      streams: Schema.NonEmptyArray(
        Schema.Struct({
          height: Schema.Number.pipe(
            Schema.check(Schema.isInt(), Schema.isGreaterThan(0))
          ),
          width: Schema.Number.pipe(
            Schema.check(Schema.isInt(), Schema.isGreaterThan(0))
          ),
        })
      ),
    })
  )
);

export interface TikTokMediaContainerRuntimeDependencies {
  readonly acquirer: MediaAcquirer;
  readonly artifacts: ReturnType<typeof makeTemporaryArtifactStore>;
  readonly makeTemporaryRoot?: (importId: string) => Promise<string>;
  readonly processRunner: MediaProcessRunner;
  readonly resolver: SourceResolver;
}

export const makeTikTokMediaContainerRuntime = ({
  acquirer,
  artifacts,
  makeTemporaryRoot = (importId) =>
    mkdtemp(`${tmpdir()}/meal-planner-media-${importId}-`),
  processRunner,
  resolver,
}: TikTokMediaContainerRuntimeDependencies) => {
  const cleanup = Effect.fn("ImportMediaContainer.cleanup")((
    artifactId: string
  ) => {
    const decoded = Schema.decodeUnknownOption(MediaArtifactId)(artifactId);
    if (Option.isNone(decoded)) {
      return Effect.void;
    }
    return Effect.tryPromise({
      catch: retryableContainer,
      try: () => artifacts.cleanup(decoded.value),
    }).pipe(Effect.ignore);
  });

  const readRegisteredArtifact = Effect.fn(
    "ImportMediaContainer.readRegisteredArtifact"
  )(function* readRegisteredArtifactEffect(artifactId: string) {
    const artifact = artifacts.get(artifactId);
    if (
      artifact === undefined ||
      artifact.contentType === null ||
      artifact.path === null
    ) {
      return yield* Effect.fail(registeredArtifactMissing());
    }
    const { contentType, path: artifactPath, root } = artifact;
    yield* scanTemporaryWorkspace(root).pipe(
      Effect.mapError(registeredArtifactMissing)
    );
    const artifactStats = yield* Effect.tryPromise({
      catch: registeredArtifactMissing,
      try: () => stat(artifactPath),
    });
    if (!artifactStats.isFile() || !Number.isSafeInteger(artifactStats.size)) {
      return yield* Effect.fail(registeredArtifactMissing());
    }
    const stream = Stream.fromReadableStream({
      evaluate: () =>
        Readable.toWeb(
          createReadStream(artifactPath)
        ) as ReadableStream<Uint8Array>,
      onError: retryableContainer,
    });
    return { bytes: artifactStats.size, contentType, stream } as const;
  });

  const fetch = Effect.fn("ImportMediaContainer.fetch")(
    function* privateArtifactFetch() {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, "http://container.invalid");
      if (url.pathname === "/containerstarthealthcheck") {
        return HttpServerResponse.text("ready", {
          headers: privateArtifactHeaders,
        });
      }
      if (
        request.method !== "GET" ||
        !url.pathname.startsWith(PrivateMediaArtifactPathPrefix)
      ) {
        return closedArtifactResponse(404);
      }
      const encodedArtifactId = url.pathname.slice(
        PrivateMediaArtifactPathPrefix.length
      );
      const artifactId = yield* Effect.sync(() => {
        try {
          return Schema.decodeUnknownOption(MediaArtifactId)(
            decodeURIComponent(encodedArtifactId)
          );
        } catch {
          return Option.none<MediaArtifactId>();
        }
      });
      if (Option.isNone(artifactId)) {
        return closedArtifactResponse(400);
      }
      return yield* readRegisteredArtifact(artifactId.value).pipe(
        Effect.match({
          onFailure: () => closedArtifactResponse(404),
          onSuccess: ({ bytes, contentType, stream }) =>
            HttpServerResponse.stream(stream, {
              contentLength: bytes,
              contentType,
              headers: privateArtifactHeaders,
            }),
        })
      );
    }
  );

  const prepare = Effect.fn("ImportMediaContainer.prepare")(
    function* prepareMedia(request: TikTokIdentity) {
      const artifactId = acquisitionArtifactId(
        request.importId,
        request.generation
      );
      yield* cleanup(artifactId);
      return yield* artifacts.use(
        artifactId,
        Effect.tryPromise({
          catch: temporaryWorkspaceUnavailable,
          try: () => makeTemporaryRoot(request.importId),
        }),
        (root) =>
          Effect.gen(function* resolveAndAcquire() {
            const resolved = yield* resolver.resolve(request, root);
            const artifact = yield* acquirer.acquire(
              resolved,
              ProductionMediaLimits,
              root
            );
            artifacts.setPath(artifactId, artifact.filePath, "video/mp4");
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
    }
  );

  const prepareProviderEvidence = Effect.fn(
    "ImportMediaContainer.prepareProviderEvidence"
  )(function* prepareProviderEvidenceEffect(
    rawArtifactId: string,
    rawDurationSeconds: number
  ) {
    const artifactId = yield* Schema.decodeUnknownEffect(MediaArtifactId)(
      rawArtifactId
    ).pipe(Effect.mapError(retryableContainer));
    const durationSeconds = yield* Schema.decodeUnknownEffect(
      MediaDurationSeconds
    )(rawDurationSeconds).pipe(Effect.mapError(retryableContainer));
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
    const frameFractions = [0.2, 0.5, 0.8] as const;
    const prepareFrame = Effect.fn("ImportMediaContainer.prepareFrame")(
      function* prepareFrameEffect(fraction: number, index: number) {
        const timestampMilliseconds = yield* Schema.decodeUnknownEffect(
          FrameTimestampMilliseconds
        )(Math.max(0, Math.floor(boundedDuration * fraction * 1000))).pipe(
          Effect.mapError(retryableContainer)
        );
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
        const dimensions = yield* decodeFrameDimensions(
          new TextDecoder().decode(probe.stdout)
        ).pipe(Effect.mapError(retryableContainer));
        const [{ height, width }] = dimensions.streams;
        const bytes = yield* Effect.tryPromise({
          catch: retryableContainer,
          try: () => readFile(framePath),
        });
        const derivedArtifactId = yield* Schema.decodeUnknownEffect(
          MediaArtifactId
        )(`${artifactId}:frame:${index}`).pipe(
          Effect.mapError(retryableContainer)
        );
        artifacts.registerPath(
          derivedArtifactId,
          artifact.root,
          framePath,
          "image/jpeg"
        );
        return {
          artifactId: derivedArtifactId,
          bytes: yield* Schema.decodeUnknownEffect(MediaByteCount)(
            bytes.byteLength
          ).pipe(Effect.mapError(retryableContainer)),
          height,
          sha256: yield* Schema.decodeUnknownEffect(Sha256Hex)(
            createHash("sha256").update(bytes).digest("hex")
          ).pipe(Effect.mapError(retryableContainer)),
          timestampMilliseconds,
          width,
        };
      }
    );
    const frames = yield* Effect.forEach(frameFractions, prepareFrame, {
      concurrency: 1,
    });
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
    const audioArtifactId = yield* Schema.decodeUnknownEffect(MediaArtifactId)(
      `${artifactId}:audio`
    ).pipe(Effect.mapError(retryableContainer));
    artifacts.registerPath(
      audioArtifactId,
      artifact.root,
      audioPath,
      "audio/wav"
    );
    return {
      audio: {
        artifactId: audioArtifactId,
        bytes: yield* Schema.decodeUnknownEffect(MediaByteCount)(
          audioBytes.byteLength
        ).pipe(Effect.mapError(retryableContainer)),
        durationMilliseconds: yield* Schema.decodeUnknownEffect(
          MediaDurationMilliseconds
        )(Math.round(durationSeconds * 1000)).pipe(
          Effect.mapError(retryableContainer)
        ),
        sha256: yield* Schema.decodeUnknownEffect(Sha256Hex)(
          createHash("sha256").update(audioBytes).digest("hex")
        ).pipe(Effect.mapError(retryableContainer)),
      },
      frames,
    };
  });

  return TikTokMediaContainer.of({
    cleanup,
    fetch: fetch(),
    prepare,
    prepareProviderEvidence,
  });
};

const ProductionTikTokMediaContainerRuntime = Effect.sync(() => {
  const artifacts = makeTemporaryArtifactStore((root) =>
    rm(root, { force: true, recursive: true })
  );
  const processRunner = makeMediaProcessRunner(NodeCommandExecutor);
  return makeTikTokMediaContainerRuntime({
    acquirer: makeContainerMediaAcquirer(processRunner),
    artifacts,
    processRunner,
    resolver: makeTikTokSourceResolver(processRunner),
  });
});

export default TikTokMediaContainer.make(
  {
    dockerfile: { content: TikTokMediaContainerDockerfile },
    instanceType: "standard-1",
    main: import.meta.url,
    maxInstances: 2,
    runtime: "node",
  },
  ProductionTikTokMediaContainerRuntime
);
