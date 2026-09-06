import type * as Cloudflare from "alchemy/Cloudflare";
import { RuntimeContext } from "alchemy/RuntimeContext";
import type { BaseRuntimeContext } from "alchemy/RuntimeContext";
import { Deferred, Effect, Stream } from "effect";

import type {
  AcquisitionBucketLike,
  R2ObjectBodyLike,
  R2ObjectLike,
} from "./import-media-acquirer.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import type { RetryableAcquisitionFailure } from "./import-media.model.js";

type NativeR2PutBody = Parameters<
  Effect.Success<Cloudflare.R2.ReadWriteBucketClient["raw"]>["put"]
>[1];
declare const FixedLengthStream: new (bytes: number) => {
  readonly readable: Extract<NativeR2PutBody, { readonly locked: boolean }>;
  readonly writable: WritableStream<Uint8Array>;
};

type AlchemyR2Object = NonNullable<
  Effect.Success<ReturnType<Cloudflare.R2.ReadWriteBucketClient["head"]>>
>;
type AlchemyR2ObjectBody = NonNullable<
  Effect.Success<ReturnType<Cloudflare.R2.ReadWriteBucketClient["get"]>>
>;
const r2Object = (
  object: Pick<
    AlchemyR2Object,
    "checksums" | "size" | "customMetadata" | "httpMetadata"
  >
): R2ObjectLike => {
  let projected: R2ObjectLike = {
    checksums: object.checksums,
    size: object.size,
  };
  if (object.customMetadata !== undefined) {
    projected = { ...projected, customMetadata: object.customMetadata };
  }
  if (object.httpMetadata !== undefined) {
    projected = { ...projected, httpMetadata: object.httpMetadata };
  }
  return projected;
};

const retryableR2Failure = (
  stage: "store" | "verify"
): RetryableAcquisitionFailure =>
  new RetryableAcquisitionError({ reason: "container_rpc", stage });

const r2ObjectBody = (object: AlchemyR2ObjectBody): R2ObjectBodyLike => ({
  ...r2Object(object),
  arrayBuffer: () =>
    object
      .arrayBuffer()
      .pipe(Effect.mapError(() => retryableR2Failure("verify"))),
  text: () =>
    object.text().pipe(Effect.mapError(() => retryableR2Failure("verify"))),
});

/** Adapt Alchemy's R2 client to the application-owned, typed storage port. */
export const adaptAcquisitionBucket = (
  client: Cloudflare.R2.ReadWriteBucketClient,
  runtimeContext: BaseRuntimeContext
): AcquisitionBucketLike => ({
  get: (key) =>
    client.get(key).pipe(
      Effect.provideService(RuntimeContext, runtimeContext),
      Effect.mapError(() => retryableR2Failure("verify")),
      Effect.map((object) => (object === null ? null : r2ObjectBody(object)))
    ),
  head: (key) =>
    client.head(key).pipe(
      Effect.provideService(RuntimeContext, runtimeContext),
      Effect.mapError(() => retryableR2Failure("verify")),
      Effect.map((object) => (object === null ? null : r2Object(object)))
    ),
  put: (key, value, options) =>
    Effect.gen(function* putNativeR2() {
      const raw = yield* client.raw;
      const put = (body: Parameters<typeof raw.put>[1]) =>
        Effect.tryPromise({
          catch: () => retryableR2Failure("store"),
          try: () => raw.put(key, body, options),
        });
      if (!Stream.isStream(value)) {
        const object = yield* put(value);
        return object === null ? null : r2Object(object);
      }
      // Keep native R2 options on streamed puts and own the producer until it closes.
      // Alchemy beta.76's stream conversion omits options from raw.put.
      const object = yield* Effect.acquireUseRelease(
        Effect.gen(function* object() {
          const cancelled = yield* Deferred.make<true>();
          const abort = new AbortController();
          const fixed = new FixedLengthStream(options.contentLength);
          const producer = Stream.toReadableStream(
            value.pipe(Stream.interruptWhen(Deferred.await(cancelled)))
          )
            .pipeTo(fixed.writable, { signal: abort.signal })
            .then(
              () => ({ ok: true as const }),
              () => ({ ok: false as const })
            );
          return { abort, body: fixed.readable, cancelled, producer };
        }),
        ({ body, producer }) =>
          put(body).pipe(
            Effect.flatMap((stored) =>
              stored === null
                ? Effect.succeed(null)
                : Effect.promise(() => producer).pipe(
                    Effect.flatMap((result) =>
                      result.ok
                        ? Effect.succeed(stored)
                        : Effect.fail(retryableR2Failure("store"))
                    )
                  )
            )
          ),
        ({ abort, body, cancelled, producer }) =>
          Deferred.succeed(cancelled, true).pipe(
            Effect.andThen(
              Effect.promise(async () => {
                abort.abort();
                await body.cancel().catch(() => {
                  // Native R2 may already own the reader lock.
                });
                await producer;
              })
            )
          )
      );
      return object === null ? null : r2Object(object);
    }).pipe(Effect.provideService(RuntimeContext, runtimeContext)),
});
