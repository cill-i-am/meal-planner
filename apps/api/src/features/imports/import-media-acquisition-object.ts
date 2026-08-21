import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import { TikTokMediaContainer } from "./import-media-container.js";
import { AcquisitionArtifactId, TikTokIdentity } from "./import-media.model.js";

const decodeAcquisitionArtifact = (artifactId: string) =>
  Schema.decodeUnknownEffect(AcquisitionArtifactId)(artifactId).pipe(
    Effect.orDie
  );

export const ImportMediaAcquisitionObjectRuntime = Effect.fn(
  "ImportMediaAcquisitionObject.initialize"
)(function* ImportMediaAcquisitionObjectInit() {
  const media = yield* TikTokMediaContainer;
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
      Schema.decodeUnknownEffect(TikTokIdentity)(untrustedIdentity).pipe(
        Effect.orDie,
        Effect.flatMap(media.prepare)
      ),
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
 * product authority; callers address this object by import ID and every
 * artifact command is fenced by its acquisition execution generation.
 */
export class ImportMediaAcquisitionObject extends Cloudflare.DurableObject<ImportMediaAcquisitionObject>()(
  "ImportMediaAcquisitionObject",
  ImportMediaAcquisitionObjectRuntime
) {}
