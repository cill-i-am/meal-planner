import { MAX_PRIVATE_FRAME_BYTES } from "@meal-planner/private-interview-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { privateCommandDecoder } from "./private-output-socket.js";

const decode = privateCommandDecoder(Schema.Struct({ content: Schema.String }));

describe("native private socket command admission", () => {
  it("decodes the declared text frame without accepting extras or binary", () => {
    expect(decode('{"content":"hello"}')).toEqual({
      _tag: "Accepted",
      command: { content: "hello" },
    });
    for (const frame of [
      '{"content":"hello","authorization":"invalid"}',
      "{",
      "[]",
      new ArrayBuffer(1),
    ]) {
      expect(decode(frame)).toEqual({ _tag: "Rejected", closeCode: 1008 });
    }
  });

  it("limits UTF-8 bytes rather than JavaScript characters before decoding", () => {
    const frame = JSON.stringify({
      content: "€".repeat(Math.ceil(MAX_PRIVATE_FRAME_BYTES / 2)),
    });
    expect(frame.length).toBeLessThan(MAX_PRIVATE_FRAME_BYTES);
    expect(decode(frame)).toEqual({ _tag: "Rejected", closeCode: 1009 });
  });
});
