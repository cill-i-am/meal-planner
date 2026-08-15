import { Effect, Stream } from "effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { AcquisitionMediaObjectLike } from "./import-media-acquirer.js";
import { privateMediaArtifactPath } from "./import-media-artifact-transport.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import type { RetryableAcquisitionFailure } from "./import-media.model.js";

type AcquisitionControlPlane = Pick<
  AcquisitionMediaObjectLike,
  "cleanup" | "prepare"
> &
  Required<Pick<AcquisitionMediaObjectLike, "prepareProviderEvidence">>;

export type AcquisitionMediaObjectStub = AcquisitionControlPlane & {
  readonly fetch: (
    request: HttpServerRequest.HttpServerRequest
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, unknown>;
};

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
  cleanup: (artifactId) => stub.cleanup(artifactId),
  prepare: (input) => stub.prepare(input),
  prepareProviderEvidence: (artifactId, durationSeconds) =>
    stub.prepareProviderEvidence(artifactId, durationSeconds),
  readArtifact: (artifactId) =>
    Stream.unwrap(openPrivateArtifact(stub, artifactId)),
});
