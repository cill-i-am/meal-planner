import { RuntimeContext } from "alchemy";
import type { BaseRuntimeContext } from "alchemy";
import type * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import type {
  AcquisitionBucketLike,
  R2ObjectBodyLike,
  R2ObjectLike,
} from "./import-media-acquirer.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import type { RetryableAcquisitionFailure } from "./import-media.model.js";

type AlchemyR2Object = NonNullable<
  Effect.Success<ReturnType<Cloudflare.R2.ReadWriteBucketClient["head"]>>
>;
type AlchemyR2ObjectBody = NonNullable<
  Effect.Success<ReturnType<Cloudflare.R2.ReadWriteBucketClient["get"]>>
>;
type AlchemyR2Failure = Effect.Error<
  ReturnType<Cloudflare.R2.ReadWriteBucketClient["head"]>
>;

const r2Object = (object: AlchemyR2Object): R2ObjectLike => ({
  checksums: object.checksums,
  ...(object.customMetadata === undefined
    ? {}
    : { customMetadata: object.customMetadata }),
  ...(object.httpMetadata === undefined
    ? {}
    : { httpMetadata: object.httpMetadata }),
  size: object.size,
});

const retryableR2Failure = (
  stage: "store" | "verify"
): RetryableAcquisitionFailure =>
  new RetryableAcquisitionError({ reason: "container_rpc", stage });

const normalizeR2PutFailure = (
  _failure: AlchemyR2Failure | RetryableAcquisitionFailure
): RetryableAcquisitionFailure => retryableR2Failure("store");

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
    client.put(key, value, options).pipe(
      Effect.provideService(RuntimeContext, runtimeContext),
      Effect.mapError(normalizeR2PutFailure),
      Effect.map((object) => (object === null ? null : r2Object(object)))
    ),
});
