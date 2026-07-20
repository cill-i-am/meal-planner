import * as Cloudflare from "alchemy/Cloudflare";
import type { Effect, Stream } from "effect";

import type {
  ContainerAcquisitionError,
  PreparedMediaArtifact,
} from "./import-media-acquirer.js";
import type {
  RetryableAcquisitionFailure,
  TikTokIdentity,
} from "./import-media.model.js";

export class TikTokMediaContainer extends Cloudflare.Container<
  TikTokMediaContainer,
  {
    readonly cleanup: (artifactId: string) => Effect.Effect<void>;
    readonly prepare: (
      request: TikTokIdentity
    ) => Effect.Effect<PreparedMediaArtifact, ContainerAcquisitionError>;
    readonly stream: (
      artifactId: string
    ) => Stream.Stream<Uint8Array, RetryableAcquisitionFailure>;
  }
>()("TikTokMediaContainer") {}
