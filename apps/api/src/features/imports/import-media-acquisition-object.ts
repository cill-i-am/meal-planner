import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { TikTokMediaContainer } from "./import-media-container.js";

export const ImportMediaAcquisitionObjectRuntime = Effect.gen(
  function* ImportMediaAcquisitionObjectInit() {
    const media = yield* TikTokMediaContainer;
    return Effect.succeed({
      cleanup: (artifactId: string) => media.cleanup(artifactId),
      prepare: media.prepare,
      prepareProviderEvidence: media.prepareProviderEvidence,
      stream: media.stream,
    });
  }
).pipe(
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
