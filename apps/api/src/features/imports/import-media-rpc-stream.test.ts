import { StreamErrorTag, toRpcStream } from "alchemy/Rpc";
import type { RpcStreamEnvelope } from "alchemy/Rpc";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

const readBytes = async (envelope: RpcStreamEnvelope) =>
  new Uint8Array(await new Response(envelope.body).arrayBuffer());

const readText = (envelope: RpcStreamEnvelope) =>
  new Response(envelope.body).text();

describe("installed Alchemy native RPC stream patch", () => {
  it("preserves every byte across multi-chunk calls without reusing an exhausted stream", async () => {
    const chunks = [
      new Uint8Array(64 * 1024).fill(1),
      new Uint8Array(64 * 1024).fill(2),
      new Uint8Array(24).fill(3),
    ];
    const expected = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    let finalized = 0;
    const makeStream = () =>
      Stream.fromIterable(chunks).pipe(
        Stream.onExit(() =>
          Effect.sync(() => {
            finalized += 1;
          })
        )
      );

    const first = await Effect.runPromise(toRpcStream(makeStream()));
    const second = await Effect.runPromise(toRpcStream(makeStream()));
    const firstBytes = Buffer.from(await readBytes(first));
    const secondBytes = Buffer.from(await readBytes(second));

    expect(first.encoding).toBe("bytes");
    expect(firstBytes.byteLength).toBe(expected.byteLength);
    expect(firstBytes.equals(expected)).toBe(true);
    expect(secondBytes.equals(expected)).toBe(true);
    expect(finalized).toBe(2);
  });

  it("preserves JSONL values and appends a typed marker for a source failure", async () => {
    let finalized = 0;
    const source = Stream.make({ index: 1 }, { index: 2 }).pipe(
      Stream.concat(Stream.fail({ _tag: "SyntheticStreamFailure" })),
      Stream.onExit(() =>
        Effect.sync(() => {
          finalized += 1;
        })
      )
    );

    const envelope = await Effect.runPromise(toRpcStream(source));
    const text = await readText(envelope);
    const lines = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);

    expect(envelope.encoding).toBe("jsonl");
    expect(lines).toEqual([
      { index: 1 },
      { index: 2 },
      {
        _tag: StreamErrorTag,
        error: { _tag: "SyntheticStreamFailure" },
      },
    ]);
    expect(finalized).toBe(1);
  });

  it("closes the owned peel scope when the source fails before its first element", async () => {
    let finalized = 0;
    const source = Stream.fail({ _tag: "SyntheticPeelFailure" }).pipe(
      Stream.onExit(() =>
        Effect.sync(() => {
          finalized += 1;
        })
      )
    );

    const envelope = await Effect.runPromise(toRpcStream(source));
    const text = await readText(envelope);
    const marker = JSON.parse(text.trim()) as unknown;

    expect(marker).toEqual({
      _tag: StreamErrorTag,
      error: { _tag: "SyntheticPeelFailure" },
    });
    expect(finalized).toBe(1);
  });

  it("closes the owned peel scope exactly once when the consumer cancels after the head", async () => {
    let finalized = 0;
    const source = Stream.fromIterable([
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]).pipe(
      Stream.onExit(() =>
        Effect.sync(() => {
          finalized += 1;
        })
      )
    );

    const envelope = await Effect.runPromise(toRpcStream(source));
    const reader = envelope.body.getReader();
    const head = await reader.read();
    await reader.cancel("synthetic early cancellation");

    expect(head.done).toBe(false);
    expect(head.value).toEqual(new Uint8Array([1]));
    expect(finalized).toBe(1);
  });
});
