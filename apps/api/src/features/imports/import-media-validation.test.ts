import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  hasIsoBaseMediaFileType,
  validateMediaProbe,
} from "./import-media-validation.js";

const validProbe = {
  format: {
    duration: "1.000000",
    format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    size: "1024",
  },
  streams: [
    { codec_name: "h264", codec_type: "video", index: 0 },
    { codec_name: "aac", codec_type: "audio", index: 1 },
  ],
};

const expectTerminal = async (effect: Effect.Effect<unknown, unknown>) => {
  const exit = await Effect.runPromiseExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected terminal media failure");
  }
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
    _tag: "TerminalMedia",
    stage: "validation",
  });
};

describe("real media validation", () => {
  it("requires an ISO BMFF file-type box, audio, video, duration, and size", async () => {
    const validated = await Effect.runPromise(
      validateMediaProbe(validProbe, {
        actualBytes: 1024,
        maximumBytes: 2048,
        maximumDurationSeconds: 900,
      })
    );
    const header = new Uint8Array([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ]);

    expect(validated).toEqual({
      audioStreams: [{ codec: "aac", index: 1 }],
      bytes: 1024,
      durationSeconds: 1,
      videoStreams: [{ codec: "h264", index: 0 }],
    });
    expect(hasIsoBaseMediaFileType(header)).toBe(true);
    expect(
      hasIsoBaseMediaFileType(new TextEncoder().encode("not an mp4"))
    ).toBe(false);
  });

  it("rejects filename/MIME-only, missing stream, corrupt, and bounded-limit cases", async () => {
    await expectTerminal(
      validateMediaProbe(
        {
          ...validProbe,
          format: { ...validProbe.format, format_name: "matroska" },
        },
        { actualBytes: 1024, maximumBytes: 2048, maximumDurationSeconds: 900 }
      )
    );
    await expectTerminal(
      validateMediaProbe(
        { ...validProbe, streams: validProbe.streams.slice(0, 1) },
        { actualBytes: 1024, maximumBytes: 2048, maximumDurationSeconds: 900 }
      )
    );
    await expectTerminal(
      validateMediaProbe(
        { malformed: true },
        {
          actualBytes: 1024,
          maximumBytes: 2048,
          maximumDurationSeconds: 900,
        }
      )
    );
    await expectTerminal(
      validateMediaProbe(validProbe, {
        actualBytes: 2049,
        maximumBytes: 2048,
        maximumDurationSeconds: 900,
      })
    );
    await expectTerminal(
      validateMediaProbe(
        { ...validProbe, format: { ...validProbe.format, duration: "901" } },
        { actualBytes: 1024, maximumBytes: 2048, maximumDurationSeconds: 900 }
      )
    );
  });
});
