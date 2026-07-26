import { Context } from "effect";
import type { Effect } from "effect";

import type {
  RetryableAcquisitionFailure,
  TerminalMediaFailure,
  TikTokIdentity,
  UnavailableFailure,
  UnsupportedCarouselFailure,
} from "./import-media.model.js";

export interface CanonicalSourceMetadata {
  readonly canonicalId: string;
  readonly canonicalUrl: string;
  readonly caption: string | null;
  readonly creator: {
    readonly displayName: string | null;
    readonly handle: string | null;
    readonly id: string | null;
  };
  readonly observedAt: string;
  readonly provenance: {
    readonly canonicalUrl: "provider_observed";
    readonly caption: "creator_provided" | null;
    readonly creator: {
      readonly displayName: "provider_observed" | null;
      readonly handle: "provider_observed" | null;
      readonly id: "provider_observed" | null;
    };
    readonly publishedAt: "provider_observed" | null;
  };
  readonly publishedAt: string | null;
}

/** Internal-only request hints: never encode, checkpoint, persist, log, or return from RPC. */
export interface MediaRequestHeaders {
  readonly accept?: string;
  readonly acceptLanguage?: string;
  readonly referer?: string;
  readonly userAgent?: string;
}

/** Internal-only value: never encode, checkpoint, persist, log, or return from RPC. */
export interface ResolvedVideoSource {
  readonly mediaLocator: string;
  readonly metadata: CanonicalSourceMetadata;
  readonly requestHeaders: MediaRequestHeaders;
}

export interface SourceResolverShape {
  readonly resolve: (
    identity: TikTokIdentity
  ) => Effect.Effect<
    ResolvedVideoSource,
    | RetryableAcquisitionFailure
    | TerminalMediaFailure
    | UnavailableFailure
    | UnsupportedCarouselFailure
  >;
}

export class SourceResolver extends Context.Service<
  SourceResolver,
  SourceResolverShape
>()("meal-planner/SourceResolver") {}
