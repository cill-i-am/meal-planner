import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { PrivateDiscoveryKimiStreamDiagnostic } from "./private-discovery-kimi-stream.js";
import {
  makePrivateDiscoveryKimiStreamDecoder,
  PRIVATE_DISCOVERY_KIMI_STREAM_LIMITS as limits,
  PrivateDiscoveryKimiStreamFailure,
} from "./private-discovery-kimi-stream.js";
import {
  kimiBudgetArguments,
  kimiBudgetEnding,
  kimiBudgetOpening,
  kimiBudgetTool,
  kimiChoice,
  kimiChunk,
  kimiEvent,
  maximalKimiStream,
} from "./private-discovery-kimi-stream.test-fixtures.js";
import { SubmitDiscoveryTurn } from "./private-discovery-model.js";

type Decoder = ReturnType<typeof makePrivateDiscoveryKimiStreamDecoder>;
const encoder = new TextEncoder();
const push = (decoder: Decoder, text: string) =>
  decoder.push(encoder.encode(text));
const delta = (text: string, field: "arguments" | "reasoning_content") =>
  kimiEvent(
    kimiChunk([
      kimiChoice(
        field === "arguments"
          ? { tool_calls: [{ function: { arguments: text }, index: 0 }] }
          : { reasoning_content: text }
      ),
    ])
  );
const fill = (
  decoder: Decoder,
  bytes: number,
  field: "arguments" | "reasoning_content"
) => {
  let remaining = bytes;
  while (remaining !== 0) {
    const size = Math.min(16_384, remaining);
    push(decoder, delta(" ".repeat(size), field));
    remaining -= size;
  }
};
const assertLatched = (
  decoder: Decoder,
  operation: () => void,
  check: typeof PrivateDiscoveryKimiStreamDiagnostic.Type.check
) => {
  let first: PrivateDiscoveryKimiStreamFailure | undefined;
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateDiscoveryKimiStreamFailure);
    if (!(error instanceof PrivateDiscoveryKimiStreamFailure)) {
      throw error;
    }
    first = error;
  }
  expect(first?.diagnostic.check).toBe(check);
  for (const later of [
    () => decoder.push(encoder.encode(kimiBudgetOpening + kimiBudgetEnding)),
    () => decoder.finish(),
  ]) {
    let laterFailure: unknown;
    try {
      later();
    } catch (error) {
      laterFailure = error;
    }
    expect(laterFailure).toBe(first);
  }
  expect(decoder.readMetrics()).toMatchObject({
    pendingEventBytes: 0,
    pendingLineBytes: 0,
    retainedTextBytes: 0,
  });
  return first?.diagnostic;
};

describe("incremental Kimi resource budgets", () => {
  it.each(["arguments", "reasoning_content"] as const)(
    "accepts exactly 2 MiB of logical %s and a schema-valid tool submission",
    (field) => {
      const decoder = makePrivateDiscoveryKimiStreamDecoder();
      const tool = {
        ...kimiBudgetTool,
        function: { ...kimiBudgetTool.function, arguments: "" },
      };
      push(
        decoder,
        kimiEvent(
          kimiChunk([kimiChoice({ role: "assistant", tool_calls: [tool] })])
        )
      );
      const available =
        limits.logicalTextBytes -
        decoder.readMetrics().logicalTextBytes -
        encoder.encode(kimiBudgetArguments).byteLength;
      fill(decoder, available, field);
      if (field === "reasoning_content") {
        expect(decoder.readMetrics().retainedTextBytes).toBe(
          encoder.encode(`${tool.id}${tool.function.name}`).byteLength
        );
      }
      push(decoder, delta(kimiBudgetArguments, "arguments"));
      expect(decoder.readMetrics().logicalTextBytes).toBe(
        limits.logicalTextBytes
      );
      push(decoder, kimiBudgetEnding);
      const completion = decoder.finish();
      const args =
        completion.choices[0]?.message.tool_calls?.[0]?.function.arguments;
      expect(
        Schema.decodeUnknownSync(SubmitDiscoveryTurn)(
          JSON.parse(args ?? "null")
        )
      ).toEqual(JSON.parse(kimiBudgetArguments));
      expect(decoder.readMetrics()).toMatchObject({
        logicalTextBytes: limits.logicalTextBytes,
        retainedTextBytes: 0,
      });
    }
  );

  it.each([false, true])(
    "counts a surrogate pair split between deltas with extra byte %s",
    (extra) => {
      const decoder = makePrivateDiscoveryKimiStreamDecoder();
      push(decoder, kimiBudgetOpening);
      fill(
        decoder,
        limits.logicalTextBytes - decoder.readMetrics().logicalTextBytes - 7,
        "reasoning_content"
      );
      push(decoder, delta("漢", "reasoning_content"));
      push(decoder, delta("\uD83C", "reasoning_content"));
      expect(decoder.readMetrics().logicalTextBytes).toBe(
        limits.logicalTextBytes - 1
      );
      push(decoder, delta("", "reasoning_content"));
      push(decoder, delta("\uDF45", "reasoning_content"));
      expect(decoder.readMetrics().logicalTextBytes).toBe(
        limits.logicalTextBytes
      );
      if (extra) {
        const diagnostic = assertLatched(
          decoder,
          () => push(decoder, delta("x", "reasoning_content")),
          "logical_text_limit"
        );
        expect(diagnostic).toMatchObject({
          limit: limits.logicalTextBytes,
          observed: limits.logicalTextBytes + 1,
        });
      } else {
        push(decoder, kimiBudgetEnding);
        decoder.finish();
      }
    }
  );

  it("bounds an ignored line before retaining its excess byte", () => {
    const decoder = makePrivateDiscoveryKimiStreamDecoder();
    push(decoder, `:${"x".repeat(limits.lineBytes - 1)}`);
    expect(decoder.readMetrics().pendingLineBytes).toBe(limits.lineBytes);
    expect(
      assertLatched(decoder, () => push(decoder, "x"), "line_limit")
    ).toMatchObject({
      limit: limits.lineBytes,
      observed: limits.lineBytes + 1,
    });
  });

  it("bounds a multiline event including ignored metadata", () => {
    const decoder = makePrivateDiscoveryKimiStreamDecoder();
    for (let index = 0; index < 4; index += 1) {
      push(decoder, `ignored:${"x".repeat(limits.lineBytes - 9)}\n`);
    }
    expect(decoder.readMetrics().pendingEventBytes).toBe(limits.eventBytes);
    expect(
      assertLatched(decoder, () => push(decoder, "x"), "event_limit")
    ).toMatchObject({
      limit: limits.eventBytes,
      observed: limits.eventBytes + 1,
    });
  });

  it("counts usage and DONE toward the data-event ceiling and rejects one extra event", () => {
    const decoder = makePrivateDiscoveryKimiStreamDecoder();
    push(decoder, kimiBudgetOpening);
    const empty = encoder.encode(delta("", "reasoning_content"));
    for (let index = 0; index < limits.dataEvents - 4; index += 1) {
      decoder.push(empty);
    }
    push(decoder, kimiBudgetEnding);
    expect(decoder.readMetrics().dataEvents).toBe(limits.dataEvents);
    expect(
      assertLatched(
        decoder,
        () => push(decoder, "data: {}\n\n"),
        "event_count_limit"
      )
    ).toMatchObject({
      limit: limits.dataEvents,
      observed: limits.dataEvents + 1,
    });
  });

  it("rejects an oversized incoming wire chunk before attempting UTF-8 decoding", () => {
    const decoder = makePrivateDiscoveryKimiStreamDecoder();
    const bytes = new Uint8Array(limits.wireBytes + 1);
    bytes[0] = 0xff;
    expect(
      assertLatched(decoder, () => decoder.push(bytes), "wire_limit")
    ).toMatchObject({
      limit: limits.wireBytes,
      metrics: { pendingEventBytes: 0, pendingLineBytes: 0 },
      observed: limits.wireBytes + 1,
    });
  });

  it.each(["utf-8", "schema", "eof"] as const)(
    "latches %s failure even if later bytes could finish a response",
    (kind) => {
      const decoder = makePrivateDiscoveryKimiStreamDecoder();
      push(decoder, kimiBudgetOpening);
      if (kind === "utf-8") {
        assertLatched(
          decoder,
          () => decoder.push(new Uint8Array([0xff])),
          "invalid_utf8"
        );
      } else if (kind === "schema") {
        assertLatched(
          decoder,
          () => push(decoder, "data: {}\n\n"),
          "chunk_schema"
        );
      } else {
        assertLatched(decoder, () => decoder.finish(), "missing_done");
      }
    }
  );

  it("accepts BOM, CRLF and UTF-8 split across byte feeds, then forbids feed after EOF", () => {
    const decoder = makePrivateDiscoveryKimiStreamDecoder();
    const bytes = encoder.encode(
      `\uFEFF${kimiBudgetOpening}${kimiBudgetEnding}: final comment`.replaceAll(
        "\n",
        "\r\n"
      )
    );
    for (const byte of bytes) {
      decoder.push(new Uint8Array([byte]));
    }
    decoder.finish();
    assertLatched(
      decoder,
      () => push(decoder, ": after EOF\n\n"),
      "stream_closed"
    );
  });

  it.each(["finish", "wire_overflow"] as const)(
    "admits all finite budgets on demand before %s",
    async (outcome) => {
      const decoder = makePrivateDiscoveryKimiStreamDecoder();
      const chunks = maximalKimiStream();
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            const next = chunks.next();
            if (next.done) {
              controller.close();
            } else {
              controller.enqueue(next.value);
            }
          },
        },
        { highWaterMark: 0 }
      );
      const reader = stream.getReader();
      let peakRetained = 0;
      while (true) {
        // oxlint-disable-next-line no-await-in-loop -- Demand-driven input proves there is no complete-wire test fixture or prebuffer.
        const part = await reader.read();
        if (part.done) {
          break;
        }
        decoder.push(part.value);
        const metrics = decoder.readMetrics();
        peakRetained = Math.max(peakRetained, metrics.retainedTextBytes);
      }
      if (outcome === "wire_overflow") {
        expect(
          assertLatched(decoder, () => push(decoder, "x"), "wire_limit")
        ).toMatchObject({
          limit: limits.wireBytes,
          observed: limits.wireBytes + 1,
        });
        return;
      }
      const completion = decoder.finish();
      expect(
        completion.choices[0]?.message.tool_calls?.[0]?.function.arguments
      ).toBe(kimiBudgetArguments);
      expect(peakRetained).toBe(
        encoder.encode(
          `${kimiBudgetTool.id}${kimiBudgetTool.function.name}${kimiBudgetArguments}`
        ).byteLength
      );
      expect(decoder.readMetrics()).toMatchObject({
        dataEvents: limits.dataEvents,
        logicalTextBytes: limits.logicalTextBytes,
        peakEventBytes: limits.eventBytes,
        peakLineBytes: limits.lineBytes,
        retainedTextBytes: 0,
        wireBytes: limits.wireBytes,
      });
    },
    30_000
  );
});
