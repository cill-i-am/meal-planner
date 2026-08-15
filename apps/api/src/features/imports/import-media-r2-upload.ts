import { Effect, Exit, Stream } from "effect";

import type {
  AcquisitionBucketLike,
  AcquisitionPutOptions,
} from "./import-media-acquirer.js";
import type { RetryableAcquisitionFailure } from "./import-media.model.js";
import {
  MaximumLocalCleanupMilliseconds,
  MaximumR2OperationMilliseconds,
} from "./import-media.model.js";

interface UploadTransport {
  readonly controller: AbortController;
  readonly piping: Promise<void>;
  readonly readable: ReadableStream;
}

const retryableUploadFailure = (
  reason: NonNullable<RetryableAcquisitionFailure["reason"]>
): RetryableAcquisitionFailure => ({
  _tag: "RetryableAcquisitionFailure",
  reason,
  stage: "store",
});

const acquireTransport = (input: {
  readonly options: AcquisitionPutOptions;
  readonly stream: Stream.Stream<Uint8Array, RetryableAcquisitionFailure>;
}): Effect.Effect<UploadTransport, RetryableAcquisitionFailure> =>
  Effect.try({
    catch: () => retryableUploadFailure("container_rpc"),
    try: () => {
      const FixedLengthStreamConstructor = (
        globalThis as unknown as {
          readonly FixedLengthStream: new (length: number) => {
            readonly readable: ReadableStream;
            readonly writable: WritableStream<Uint8Array>;
          };
        }
      ).FixedLengthStream;
      const controller = new AbortController();
      const fixedLength = new FixedLengthStreamConstructor(
        input.options.contentLength
      );
      return {
        controller,
        piping: Stream.toReadableStream(input.stream).pipeTo(
          fixedLength.writable,
          { signal: controller.signal }
        ),
        readable: fixedLength.readable,
      };
    },
  });

const settleTransport = (transport: UploadTransport) =>
  Effect.gen(function* settleUploadTransport() {
    transport.controller.abort();
    yield* Effect.tryPromise({
      catch: () => null,
      try: () => transport.readable.cancel(),
    }).pipe(Effect.ignore);
    yield* Effect.tryPromise({
      catch: () => null,
      try: () => transport.piping,
    }).pipe(Effect.ignore);
  }).pipe(
    Effect.timeoutOrElse({
      duration: MaximumLocalCleanupMilliseconds,
      orElse: () => Effect.void,
    })
  );

/** Adapt one private Effect byte stream to the R2 host upload boundary. */
export const putPrivateArtifact = Effect.fn("ImportMedia.putPrivateArtifact")(
  (
    bucket: AcquisitionBucketLike,
    input: {
      readonly key: string;
      readonly options: AcquisitionPutOptions;
      readonly stream: Stream.Stream<Uint8Array, RetryableAcquisitionFailure>;
    }
  ) =>
    Effect.acquireUseRelease(
      acquireTransport(input),
      (transport) =>
        Effect.all(
          {
            piping: Effect.tryPromise({
              catch: () => retryableUploadFailure("container_rpc"),
              try: () => transport.piping,
            }),
            stored: Effect.tryPromise({
              catch: () => retryableUploadFailure("container_rpc"),
              try: () =>
                bucket.put(input.key, transport.readable, input.options),
            }),
          },
          { concurrency: "unbounded" }
        ).pipe(
          Effect.map(({ stored }) => stored !== null),
          Effect.timeoutOrElse({
            duration: MaximumR2OperationMilliseconds,
            orElse: () =>
              Effect.fail(retryableUploadFailure("acquisition_timeout")),
          })
        ),
      (transport, exit) =>
        Exit.isSuccess(exit) ? Effect.void : settleTransport(transport)
    )
);
