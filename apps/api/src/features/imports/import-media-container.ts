import * as Cloudflare from "alchemy/Cloudflare";
import type { Effect } from "effect";

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
    readonly prepareProviderEvidence: (
      artifactId: string,
      durationSeconds: number
    ) => Effect.Effect<
      {
        readonly audio: {
          readonly artifactId: string;
          readonly bytes: number;
          readonly durationMilliseconds: number;
          readonly sha256: string;
        };
        readonly frames: readonly {
          readonly artifactId: string;
          readonly bytes: number;
          readonly height: number;
          readonly sha256: string;
          readonly timestampMilliseconds: number;
          readonly width: number;
        }[];
      },
      RetryableAcquisitionFailure
    >;
  }
>()("TikTokMediaContainer") {}
