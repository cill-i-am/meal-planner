import type { RpcCallError, RpcDecodeError } from "alchemy/Rpc";
import { Effect, Option, Schema, Stream } from "effect";
import type { HttpServerError } from "effect/unstable/http/HttpServerError";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type {
  AcquisitionMediaObjectLike,
  ContainerAcquisitionError,
  PreparedMediaArtifact,
} from "./import-media-acquirer.js";
import { privateMediaArtifactPath } from "./import-media-artifact-transport.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import type {
  RetryableAcquisitionFailure,
  TikTokIdentity,
} from "./import-media.model.js";
import {
  RetryableAcquisitionFailure as RetryableAcquisitionFailureSchema,
  TerminalMediaFailure,
  UnavailableFailure,
  UnsupportedCarouselFailure,
} from "./import-media.model.js";

const ContainerAcquisitionFailure = Schema.Union([
  RetryableAcquisitionFailureSchema,
  TerminalMediaFailure,
  UnavailableFailure,
  UnsupportedCarouselFailure,
]);

type PreparedProviderEvidence = Effect.Success<
  ReturnType<NonNullable<AcquisitionMediaObjectLike["prepareProviderEvidence"]>>
>;

type AcquisitionRpcFailure =
  | ContainerAcquisitionError
  | RpcCallError
  | RpcDecodeError;

type AcquisitionRpcEffect<Value> = Effect.Effect<Value, AcquisitionRpcFailure>;

type PrivateArtifactFetchEffect = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Error | HttpServerError
>;

export interface AcquisitionMediaObjectStub {
  readonly cleanup: (artifactId: string) => AcquisitionRpcEffect<void>;
  readonly fetch: (
    request: HttpServerRequest.HttpServerRequest
  ) => PrivateArtifactFetchEffect;
  readonly prepare: (
    input: TikTokIdentity
  ) => AcquisitionRpcEffect<PreparedMediaArtifact>;
  readonly prepareProviderEvidence: (
    artifactId: string,
    durationSeconds: number
  ) => AcquisitionRpcEffect<PreparedProviderEvidence>;
}

const privateArtifactFailure = (): RetryableAcquisitionFailure =>
  new RetryableAcquisitionError({
    reason: "container_rpc",
    stage: "container",
  });

const openPrivateArtifact = Effect.fn(
  "ImportMediaAcquisitionObject.openPrivateArtifact"
)(function* openPrivateArtifactEffect(
  stub: AcquisitionMediaObjectStub,
  artifactId: string
) {
  const request = HttpServerRequest.fromWeb(
    new Request(
      `http://acquisition-object.invalid${privateMediaArtifactPath(artifactId)}`
    )
  );
  const response = yield* stub
    .fetch(request)
    .pipe(Effect.mapError(privateArtifactFailure));
  if (response.status !== 200 || response.body._tag !== "Stream") {
    return yield* Effect.fail(privateArtifactFailure());
  }
  return response.body.stream.pipe(Stream.mapError(privateArtifactFailure));
});

/** Adapt the private DO fetch transport to the Effect-shaped application port. */
export const makeAcquisitionMediaObject = (
  stub: AcquisitionMediaObjectStub
): AcquisitionMediaObjectLike => ({
  cleanup: (artifactId) =>
    stub.cleanup(artifactId).pipe(Effect.mapError(privateArtifactFailure)),
  prepare: (input) =>
    stub.prepare(input).pipe(
      Effect.matchEffect({
        onFailure: (error) => {
          const decoded = Schema.decodeUnknownOption(
            ContainerAcquisitionFailure
          )(error);
          return Effect.fail(
            Option.isSome(decoded) ? decoded.value : privateArtifactFailure()
          );
        },
        onSuccess: Effect.succeed,
      })
    ),
  prepareProviderEvidence: (artifactId, durationSeconds) =>
    stub.prepareProviderEvidence(artifactId, durationSeconds).pipe(
      Effect.matchEffect({
        onFailure: (error) => {
          const decoded = Schema.decodeUnknownOption(
            RetryableAcquisitionFailureSchema
          )(error);
          return Effect.fail(
            Option.isSome(decoded) ? decoded.value : privateArtifactFailure()
          );
        },
        onSuccess: Effect.succeed,
      })
    ),
  readArtifact: (artifactId) =>
    Stream.unwrap(openPrivateArtifact(stub, artifactId)),
});
