import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import { TikTokMediaContainer } from "./import-media-container.js";

export const ImportMediaAcquisitionObjectRuntime = Effect.fn(
  "ImportMediaAcquisitionObject.initialize"
)(function* ImportMediaAcquisitionObjectInit() {
  const media = yield* TikTokMediaContainer;
  const fetch = Effect.fn("ImportMediaAcquisitionObject.fetch")(
    function* forwardPrivateArtifactRequest() {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const containerPort = yield* media.getTcpPort(3000);
      return yield* containerPort.fetch(request);
    }
  );
  return Effect.succeed({
    cleanup: (artifactId: string) => media.cleanup(artifactId),
    fetch: fetch(),
    prepare: media.prepare,
    prepareProviderEvidence: media.prepareProviderEvidence,
  });
})().pipe(
  Effect.provide(
    Cloudflare.Containers.layer(TikTokMediaContainer, {
      enableInternet: true,
    })
  )
);

export class ImportMediaAcquisitionObject extends Cloudflare.DurableObject<ImportMediaAcquisitionObject>()(
  "ImportMediaAcquisitionObject",
  ImportMediaAcquisitionObjectRuntime
) {}
