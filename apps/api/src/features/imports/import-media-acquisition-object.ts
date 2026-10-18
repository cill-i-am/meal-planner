import * as Cloudflare from "alchemy/Cloudflare";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Effect, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import { makeAcquisitionLifetime } from "./import-media-acquisition-lifetime.js";
import {
  AcquisitionReaderHeader,
  AcquisitionReaderId,
} from "./import-media-artifact-transport.js";
import { TikTokMediaContainer } from "./import-media-container.js";
import {
  AcquisitionArtifact,
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
  const container = yield* TikTokMediaContainer;
  return Effect.gen(function* runtime() {
    const durableObjectState = yield* Cloudflare.DurableObjectState;
    const runtimeContext = yield* Effect.context<RuntimeContext>();
    const lifetime = yield* makeAcquisitionLifetime(container);
    const media = yield* Effect.cached(
      container
        .start({ enableInternet: true })
        .pipe(Effect.provide(runtimeContext), Effect.as(container))
    );
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
    const decodeReaderArtifact = (artifactId: string) =>
      Schema.decodeUnknownEffect(AcquisitionArtifact)(artifactId).pipe(
        Effect.flatMap(([owner]) =>
          requireMatchingCoordinator(coordinatorId, owner)
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
        yield* decodeReaderArtifact(artifactId);
        const started = yield* media;
        const containerPort = yield* started.getTcpPort(3000);
        return yield* containerPort.fetch(request);
      }
    );
    return {
      alarm: () => lifetime.alarm,
      cleanup: (artifactId: string) =>
        decodeAcquisitionArtifact(artifactId).pipe(
          Effect.flatMap(() => lifetime.cleanup)
        ),
      closeReader: (artifactId: string, readerId: string) =>
        decodeReaderArtifact(artifactId).pipe(
          Effect.andThen(
            Schema.decodeUnknownEffect(AcquisitionReaderId)(readerId)
          ),
          Effect.orDie,
          Effect.flatMap(lifetime.closeReader)
        ),
      fetch: Effect.gen(function* admitPrivateArtifact() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const readerId = yield* Schema.decodeUnknownEffect(AcquisitionReaderId)(
          request.headers[AcquisitionReaderHeader]
        ).pipe(Effect.orDie);
        return yield* lifetime.fetch(readerId, fetch());
      }),
      prepare: (untrustedIdentity: typeof TikTokIdentity.Type) =>
        decodeIdentity(untrustedIdentity).pipe(
          Effect.flatMap((identity) =>
            lifetime.use(
              media.pipe(
                Effect.flatMap((started) =>
                  started.prepare(identity).pipe(Effect.provide(runtimeContext))
                )
              )
            )
          )
        ),
      prepareProviderEvidence: (artifactId: string, durationSeconds: number) =>
        decodeAcquisitionArtifact(artifactId).pipe(
          Effect.flatMap((decodedArtifactId) =>
            lifetime.use(
              media.pipe(
                Effect.flatMap((started) =>
                  started
                    .prepareProviderEvidence(decodedArtifactId, durationSeconds)
                    .pipe(Effect.provide(runtimeContext))
                )
              )
            )
          )
        ),
    };
  });
})();

/**
 * Noncanonical execution/transport coordinator only. The import intent keeps
 * product authority; callers address this object by import ID plus execution
 * generation, and every artifact command must match that same fence.
 */
export class ImportMediaAcquisitionObject extends Cloudflare.DurableObject<ImportMediaAcquisitionObject>()(
  "ImportMediaAcquisitionObject",
  ImportMediaAcquisitionObjectRuntime
) {}
