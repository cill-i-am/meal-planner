import * as Cloudflare from "alchemy/Cloudflare";
import type { Effect } from "effect";

import type {
  ContainerAcquisitionError,
  PreparedMediaArtifact,
} from "./import-media-acquirer.js";
import type {
  RetryableAcquisitionFailure,
  ProviderEvidenceTransport,
  TikTokIdentity,
} from "./import-media.model.js";

export class TikTokMediaContainer extends Cloudflare.Container<
  TikTokMediaContainer,
  {
    readonly prepare: (
      request: TikTokIdentity
    ) => Effect.Effect<PreparedMediaArtifact, ContainerAcquisitionError>;
    readonly prepareProviderEvidence: (
      artifactId: string,
      durationSeconds: number
    ) => Effect.Effect<
      typeof ProviderEvidenceTransport.Encoded,
      RetryableAcquisitionFailure
    >;
  }
>()("TikTokMediaContainer") {}
