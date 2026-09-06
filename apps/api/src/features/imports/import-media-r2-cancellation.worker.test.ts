import type * as Cloudflare from "alchemy/Cloudflare";
import type { BaseRuntimeContext } from "alchemy/RuntimeContext";
import { env } from "cloudflare:test";
import { Deferred, Effect, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { adaptAcquisitionBucket } from "./import-media-acquisition-bucket.alchemy.js";
import type { ImportWorkerR2TestEnvironment } from "./import-worker-test-environment.js";

declare const FixedLengthStream: new (bytes: number) => {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
};

const delay = (milliseconds: number) =>
  Effect.runPromise(Effect.sleep(milliseconds));

describe("native fixed-length upload cancellation", () => {
  it("requires readable cancellation to settle an aborted backpressured native write", async () => {
    const fixed = new FixedLengthStream(64 * 1024 * 1024);
    const abort = new AbortController();
    let produced = 0;
    let finalized = false;
    const source = Stream.fromIterable(
      Array.from({ length: 1024 }, () => new Uint8Array(64 * 1024))
    ).pipe(
      Stream.rechunk(1),
      Stream.tap(() =>
        Effect.sync(() => {
          produced += 1;
        })
      ),
      Stream.ensuring(
        Effect.sync(() => {
          finalized = true;
        })
      )
    );
    const producer = Stream.toReadableStream(source)
      .pipeTo(fixed.writable, {
        signal: abort.signal,
      })
      .then(
        () => "closed" as const,
        () => "aborted" as const
      );

    try {
      await delay(50);
      expect(produced).toBeGreaterThan(0);
      expect(produced).toBeLessThan(1024);
      expect(finalized).toBe(false);
      expect(
        await Promise.race([producer, delay(50).then(() => "pending")])
      ).toBe("pending");
      abort.abort();
      const result = await Promise.race([
        producer,
        delay(500).then(() => "deadline"),
      ]);
      expect(result).toBe("deadline");
    } finally {
      // A failed regression must still release the native pending write.
      await fixed.readable.cancel().catch(() => null);
      await Promise.race([producer, delay(500)]);
    }
  });

  it("joins the Effect producer when cancellation also releases the unread native output", async () => {
    const fixed = new FixedLengthStream(64 * 1024 * 1024);
    const abort = new AbortController();
    let finalized = false;
    const source = Stream.fromIterable(
      Array.from({ length: 1024 }, () => new Uint8Array(64 * 1024))
    ).pipe(
      Stream.rechunk(1),
      Stream.ensuring(
        Effect.sync(() => {
          finalized = true;
        })
      )
    );
    const producer = Stream.toReadableStream(source)
      .pipeTo(fixed.writable, {
        signal: abort.signal,
      })
      .then(
        () => "closed" as const,
        () => "aborted" as const
      );
    await delay(50);
    expect(finalized).toBe(false);
    abort.abort();
    const release = fixed.readable.cancel();
    expect(
      await Promise.race([
        Promise.all([producer, release]).then(([result]) => result),
        delay(500).then(() => "deadline"),
      ])
    ).toBe("aborted");
    expect(finalized).toBe(true);
  });

  it("returns conditional null after joining a production upload whose native consumer did not read", async () => {
    let body: ReadableStream<Uint8Array> | undefined;
    let finalized = false;
    const client = {
      raw: Effect.succeed({
        put: async (_key: string, value: ReadableStream<Uint8Array>) => {
          body = value;
          await delay(50);
          return null;
        },
      }),
    } as unknown as Cloudflare.R2.ReadWriteBucketClient;
    const runtime: BaseRuntimeContext = {
      Type: "cancellation-test",
      env: {},
      get: () => Effect.die("Unexpected runtime configuration read"),
      id: "cancellation-test",
      set: () => Effect.die("Unexpected runtime configuration write"),
    };
    const source = Stream.fromIterable(
      Array.from({ length: 1024 }, () => new Uint8Array(64 * 1024))
    ).pipe(
      Stream.rechunk(1),
      Stream.ensuring(
        Effect.sync(() => {
          finalized = true;
        })
      )
    );
    const stored = Effect.runPromise(
      adaptAcquisitionBucket(client, runtime).put(
        "conditional-recovery",
        source,
        {
          contentLength: 64 * 1024 * 1024,
          customMetadata: { sha256: "0".repeat(64) },
          httpMetadata: {
            cacheControl: "private, no-store",
            contentType: "video/mp4",
          },
          onlyIf: { etagDoesNotMatch: "*" },
          sha256: new ArrayBuffer(32),
        }
      )
    );
    try {
      expect(
        await Promise.race([stored, delay(500).then(() => "deadline")])
      ).toBe(null);
      expect(finalized).toBe(true);
    } finally {
      await body?.cancel().catch(() => null);
      await Promise.race([stored.catch(() => null), delay(500)]);
    }
  });

  it("interrupts and joins the producer while real native R2 owns the readable lock", async () => {
    const native = (env as ImportWorkerR2TestEnvironment).ImportEvidenceBucket;
    const key = "cancellation/locked-reader";
    const releaseSource = Deferred.makeUnsafe<boolean>();
    let body: ReadableStream<Uint8Array> | undefined;
    let finalized = false;
    const client = {
      raw: Effect.succeed({
        put: (...args: Parameters<typeof native.put>) => {
          body = args[1] as ReadableStream<Uint8Array>;
          return native.put(...args);
        },
      }),
    } as unknown as Cloudflare.R2.ReadWriteBucketClient;
    const runtime: BaseRuntimeContext = {
      Type: "cancellation-test",
      env: {},
      get: () => Effect.die("Unexpected runtime configuration read"),
      id: "cancellation-test",
      set: () => Effect.die("Unexpected runtime configuration write"),
    };
    const source = Stream.succeed(new Uint8Array(64 * 1024)).pipe(
      Stream.concat(
        Stream.fromEffect(
          Deferred.await(releaseSource).pipe(
            Effect.as(new Uint8Array(64 * 1024))
          )
        )
      ),
      Stream.ensuring(
        Effect.sync(() => {
          finalized = true;
        })
      )
    );
    const fiber = Effect.runFork(
      adaptAcquisitionBucket(client, runtime).put(key, source, {
        contentLength: 2 * 64 * 1024,
        customMetadata: { sha256: "0".repeat(64) },
        httpMetadata: {
          cacheControl: "private, no-store",
          contentType: "video/mp4",
        },
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: await crypto.subtle.digest(
          "SHA-256",
          new Uint8Array(2 * 64 * 1024)
        ),
      })
    );
    try {
      await delay(100);
      expect(body?.locked).toBe(true);
      expect(finalized).toBe(false);
      const interrupted = Effect.runPromise(Fiber.interrupt(fiber)).then(
        () => "interrupted"
      );
      expect(
        await Promise.race([interrupted, delay(500).then(() => "deadline")])
      ).toBe("interrupted");
      expect(finalized).toBe(true);
      expect(await native.head(key)).toBe(null);
    } finally {
      await Effect.runPromise(Deferred.succeed(releaseSource, true));
      await Promise.race([
        Effect.runPromise(Fiber.interrupt(fiber)),
        delay(500),
      ]);
      await native.delete(key);
    }
  });
});
