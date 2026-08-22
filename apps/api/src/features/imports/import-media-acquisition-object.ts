import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import { TikTokMediaContainer } from "./import-media-container.js";
import {
  AcquisitionArtifactId,
  AcquisitionCoordinatorId,
  TikTokIdentity,
  acquisitionCoordinatorId,
} from "./import-media.model.js";

const requireMatchingCoordinator = (
  coordinatorId: AcquisitionCoordinatorId,
  commandId: AcquisitionArtifactId | AcquisitionCoordinatorId
) =>
  coordinatorId === commandId
    ? Effect.succeed(commandId)
    : Effect.die("Acquisition command crossed its import execution fence");

export const ImportMediaAcquisitionObjectRuntime = Effect.fn(
  "ImportMediaAcquisitionObject.initialize"
)(function* ImportMediaAcquisitionObjectInit() {
  const durableObjectState = yield* Cloudflare.DurableObjectState;
  const media = yield* TikTokMediaContainer;
  const coordinatorId = yield* Schema.decodeUnknownEffect(
    AcquisitionCoordinatorId
  )(durableObjectState.id.name).pipe(Effect.orDie);
  const decodeAcquisitionArtifact = (artifactId: string) =>
    Schema.decodeUnknownEffect(AcquisitionArtifactId)(artifactId).pipe(
      Effect.flatMap((decoded) =>
        requireMatchingCoordinator(coordinatorId, decoded)
      ),
      Effect.orDie
    );
  const decodeIdentity = (untrustedIdentity: typeof TikTokIdentity.Type) =>
    Schema.decodeUnknownEffect(TikTokIdentity)(untrustedIdentity).pipe(
      Effect.flatMap((identity) =>
        requireMatchingCoordinator(
          coordinatorId,
          acquisitionCoordinatorId(identity.importId, identity.generation)
        ).pipe(Effect.as(identity))
      ),
      Effect.orDie
    );
  const fetch = Effect.fn("ImportMediaAcquisitionObject.fetch")(
    function* forwardPrivateArtifactRequest() {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const artifactId = decodeURIComponent(
        new URL(request.url, "https://acquisition.internal").pathname.replace(
          /^\/artifacts\//u,
          ""
        )
      );
      yield* decodeAcquisitionArtifact(artifactId);
      const containerPort = yield* media.getTcpPort(3000);
      return yield* containerPort.fetch(request);
    }
  );
  return Effect.succeed({
    cleanup: (artifactId: string) =>
      decodeAcquisitionArtifact(artifactId).pipe(Effect.flatMap(media.cleanup)),
    fetch: fetch(),
    prepare: (untrustedIdentity: typeof TikTokIdentity.Type) =>
      decodeIdentity(untrustedIdentity).pipe(Effect.flatMap(media.prepare)),
    prepareProviderEvidence: (artifactId: string, durationSeconds: number) =>
      decodeAcquisitionArtifact(artifactId).pipe(
        Effect.flatMap((decodedArtifactId) =>
          media.prepareProviderEvidence(decodedArtifactId, durationSeconds)
        )
      ),
  });
})().pipe(
  Effect.provide(
    Cloudflare.Containers.layer(TikTokMediaContainer, {
      enableInternet: true,
    })
  )
);

/**
 * Noncanonical execution/transport coordinator only. The import intent keeps
 * product authority; callers address this object by import ID plus execution
 * generation, and every artifact command must match that same fence.
 */
export class ImportMediaAcquisitionObject extends Cloudflare.DurableObject<ImportMediaAcquisitionObject>()(
  "ImportMediaAcquisitionObject",
  ImportMediaAcquisitionObjectRuntime
) {}
