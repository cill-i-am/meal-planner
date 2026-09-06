import type * as Cloudflare from "alchemy/Cloudflare";
import type { BaseRuntimeContext } from "alchemy/RuntimeContext";
import { Effect, Exit, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";

import type { AcquisitionPutOptions } from "./import-media-acquirer.js";
import { adaptAcquisitionBucket } from "./import-media-acquisition-bucket.alchemy.js";

const runtimeContext: BaseRuntimeContext = {
  Type: "native-r2-adapter-test",
  env: {},
  get: () => Effect.die("No runtime configuration is needed"),
  id: "native-r2-adapter-test",
  set: () => Effect.die("No runtime configuration is needed"),
};
const options: AcquisitionPutOptions = {
  contentLength: 4,
  customMetadata: {},
  httpMetadata: { cacheControl: "private, no-store", contentType: "video/mp4" },
  onlyIf: { etagDoesNotMatch: "*" },
  sha256: new ArrayBuffer(32),
};

const fixture = (put: () => Promise<null>) => {
  const client = {
    raw: Effect.succeed({ put }),
  } as unknown as Cloudflare.R2.ReadWriteBucketClient;
  return adaptAcquisitionBucket(client, runtimeContext);
};

describe("native R2 producer ownership", () => {
  it("cancels and joins the producer when create-only rejects before consuming its body", async () => {
    const started = Promise.withResolvers<true>();
    let finalized = false;
    const stream = Stream.fromEffect(
      Effect.sync(() => started.resolve(true)).pipe(
        Effect.andThen(Effect.never)
      )
    ).pipe(
      Stream.ensuring(
        Effect.sync(() => {
          finalized = true;
        })
      )
    );
    const bucket = fixture(async () => {
      await started.promise;
      return null;
    });
    expect(
      await Effect.runPromise(bucket.put("existing", stream, options))
    ).toBeNull();
    expect(finalized).toBe(true);
  });

  it("cancels and joins the producer on a native put rejection", async () => {
    const started = Promise.withResolvers<true>();
    let finalized = false;
    const stream = Stream.fromEffect(
      Effect.sync(() => started.resolve(true)).pipe(
        Effect.andThen(Effect.never)
      )
    ).pipe(
      Stream.ensuring(
        Effect.sync(() => {
          finalized = true;
        })
      )
    );
    const bucket = fixture(async () => {
      await started.promise;
      throw new Error("synthetic put failure");
    });
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(bucket.put("rejected", stream, options))
      )
    ).toBe(true);
    expect(finalized).toBe(true);
  });

  it("joins producer cancellation when the acquisition is interrupted", async () => {
    const started = Promise.withResolvers<true>();
    let finalized = false;
    const stream = Stream.fromEffect(
      Effect.sync(() => started.resolve(true)).pipe(
        Effect.andThen(Effect.never)
      )
    ).pipe(
      Stream.ensuring(
        Effect.sync(() => {
          finalized = true;
        })
      )
    );
    const bucket = fixture(() => Promise.withResolvers<never>().promise);
    const upload = Effect.runFork(bucket.put("interrupted", stream, options));
    await started.promise;
    await Effect.runPromise(Fiber.interrupt(upload));
    expect(finalized).toBe(true);
  });
});
