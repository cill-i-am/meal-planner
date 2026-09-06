import type { RpcCallError, RpcDecodeError } from "alchemy/Rpc";
import { Effect, Option, Schema, Scope, Stream } from "effect";
import type { HttpServerError } from "effect/unstable/http/HttpServerError";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type {
  AcquisitionMediaObjectLike,
  ContainerAcquisitionError,
  PreparedMediaArtifact,
} from "./import-media-acquirer.js";
import {
  AcquisitionReaderHeader,
  privateMediaArtifactPath,
} from "./import-media-artifact-transport.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import type {
  RetryableAcquisitionFailure,
  TikTokIdentity,
  ProviderEvidenceTransport,
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
  readonly closeReader: (
    artifactId: string,
    readerId: string
  ) => AcquisitionRpcEffect<void>;
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
  ) => AcquisitionRpcEffect<typeof ProviderEvidenceTransport.Encoded>;
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
  artifactId: string,
  readerId: string
) {
  const request = HttpServerRequest.fromWeb(
    new Request(
      `http://acquisition-object.invalid${privateMediaArtifactPath(artifactId)}`,
      { headers: { [AcquisitionReaderHeader]: readerId } }
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
    Stream.unwrap(
      Effect.gen(function* readArtifact() {
        const readerId = crypto.randomUUID();
        const close = yield* Effect.cached(
          stub
            .closeReader(artifactId, readerId)
            .pipe(Effect.mapError(privateArtifactFailure), Effect.orDie)
        );
        yield* Effect.addFinalizer(() => close);
        const body = yield* openPrivateArtifact(
          stub,
          artifactId,
          readerId
        ).pipe(Effect.onError(() => close));
        // Register after the source pull so acknowledgement runs before native cancel.
        return Stream.transformPull(body, (pull, scope) =>
          Scope.addFinalizer(scope, close).pipe(Effect.as(pull))
        );
      })
    ),
});
