import type { Effect } from "effect";
import { Context, Schema } from "effect";

import type {
  SourceCanonicalId,
  SourceDescriptor,
} from "./import.contracts.js";
import type { SourceIdentityError } from "./import.errors.js";

export const ValidatedVideoUrl = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^https:\/\//u)),
  Schema.brand("ValidatedVideoUrl")
);
export type ValidatedVideoUrl = typeof ValidatedVideoUrl.Type;

export interface CanonicalSourceIdentity {
  readonly canonicalId: SourceCanonicalId;
  readonly kind: "tiktok";
}

export interface VideoIdentity {
  readonly _tag: "VideoIdentity";
  readonly identity: CanonicalSourceIdentity;
  /** Ephemeral validated locator. It must never be persisted or logged. */
  readonly videoUrl: ValidatedVideoUrl;
}

export interface UnsupportedIdentity {
  readonly _tag: "UnsupportedIdentity";
  readonly identity: CanonicalSourceIdentity;
}

export type CanonicalIdentityResolution = UnsupportedIdentity | VideoIdentity;

export interface CanonicalSourceIdentityResolverShape {
  readonly resolve: (
    source: SourceDescriptor
  ) => Effect.Effect<CanonicalIdentityResolution, SourceIdentityError>;
}

export class CanonicalSourceIdentityResolver extends Context.Service<
  CanonicalSourceIdentityResolver,
  CanonicalSourceIdentityResolverShape
>()("meal-planner/CanonicalSourceIdentityResolver") {}
