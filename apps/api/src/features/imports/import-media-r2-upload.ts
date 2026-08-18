import { Effect } from "effect";
import type { Stream } from "effect";

import type {
  AcquisitionBucketLike,
  AcquisitionPutOptions,
} from "./import-media-acquirer.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import { MaximumR2OperationMilliseconds } from "./import-media.model.js";
import type { RetryableAcquisitionFailure } from "./import-media.model.js";

const retryableUploadFailure = (
  reason: NonNullable<RetryableAcquisitionFailure["reason"]>
): RetryableAcquisitionFailure =>
  new RetryableAcquisitionError({ reason, stage: "store" });

/** Stream one private artifact through the application-owned R2 port. */
export const putPrivateArtifact = Effect.fn("ImportMedia.putPrivateArtifact")(
  (
    bucket: AcquisitionBucketLike,
    input: {
      readonly key: string;
      readonly options: AcquisitionPutOptions;
      readonly stream: Stream.Stream<Uint8Array, RetryableAcquisitionFailure>;
    }
  ) =>
    bucket.put(input.key, input.stream, input.options).pipe(
      Effect.map((stored) => stored !== null),
      Effect.timeoutOrElse({
        duration: MaximumR2OperationMilliseconds,
        orElse: () =>
          Effect.fail(retryableUploadFailure("acquisition_timeout")),
      })
    )
);
