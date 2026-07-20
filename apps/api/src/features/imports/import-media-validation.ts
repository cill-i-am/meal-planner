import { Effect, Schema } from "effect";

import type { TerminalMediaFailure } from "./import-media.model.js";

const ProbeOutput = Schema.Struct({
  format: Schema.Struct({
    duration: Schema.String,
    format_name: Schema.String,
    size: Schema.String,
  }),
  streams: Schema.Array(
    Schema.Struct({
      codec_name: Schema.String,
      codec_type: Schema.Literals(["audio", "video"]),
      index: Schema.Number,
    })
  ),
});

const invalidMedia = (
  code: "invalid_media" | "limit_exceeded" | "unsupported_streams"
): TerminalMediaFailure => ({
  _tag: "TerminalMedia",
  code,
  stage: "validation",
});

export const hasIsoBaseMediaFileType = (header: Uint8Array) =>
  header.length >= 8 &&
  header[4] === 0x66 &&
  header[5] === 0x74 &&
  header[6] === 0x79 &&
  header[7] === 0x70;

export const validateMediaProbe = (
  input: unknown,
  limits: {
    readonly actualBytes: number;
    readonly maximumBytes: number;
    readonly maximumDurationSeconds: number;
  }
) =>
  Effect.gen(function* validateProbe() {
    const probe = yield* Schema.decodeUnknownEffect(ProbeOutput)(input).pipe(
      Effect.mapError(() => invalidMedia("invalid_media"))
    );
    const durationSeconds = Number(probe.format.duration);
    const reportedBytes = Number(probe.format.size);
    if (
      !probe.format.format_name.split(",").includes("mp4") ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      !Number.isSafeInteger(reportedBytes) ||
      reportedBytes !== limits.actualBytes ||
      limits.actualBytes <= 0
    ) {
      return yield* Effect.fail(invalidMedia("invalid_media"));
    }
    if (
      durationSeconds > limits.maximumDurationSeconds ||
      limits.actualBytes > limits.maximumBytes
    ) {
      return yield* Effect.fail(invalidMedia("limit_exceeded"));
    }
    const summaries = probe.streams.map((stream) => ({
      codec: stream.codec_name,
      index: stream.index,
      type: stream.codec_type,
    }));
    if (
      summaries.some(
        (stream) =>
          stream.codec.trim().length === 0 ||
          !Number.isInteger(stream.index) ||
          stream.index < 0
      )
    ) {
      return yield* Effect.fail(invalidMedia("invalid_media"));
    }
    const audioStreams = summaries
      .filter((stream) => stream.type === "audio")
      .map(({ codec, index }) => ({ codec, index }));
    const videoStreams = summaries
      .filter((stream) => stream.type === "video")
      .map(({ codec, index }) => ({ codec, index }));
    if (audioStreams.length === 0 || videoStreams.length === 0) {
      return yield* Effect.fail(invalidMedia("unsupported_streams"));
    }
    return {
      audioStreams: audioStreams as [
        (typeof audioStreams)[number],
        ...(typeof audioStreams)[number][],
      ],
      bytes: limits.actualBytes,
      durationSeconds,
      videoStreams: videoStreams as [
        (typeof videoStreams)[number],
        ...(typeof videoStreams)[number][],
      ],
    };
  });
