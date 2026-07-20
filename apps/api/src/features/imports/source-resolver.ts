import type { Effect } from "effect";
import { Context, Schema } from "effect";

import type {
  SourceCanonicalId,
  SourceDescriptor,
} from "./import.contracts.js";
import type { ImportSourceError } from "./import.errors.js";

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
  ) => Effect.Effect<CanonicalIdentityResolution, ImportSourceError>;
}

export class CanonicalSourceIdentityResolver extends Context.Service<
  CanonicalSourceIdentityResolver,
  CanonicalSourceIdentityResolverShape
>()("meal-planner/CanonicalSourceIdentityResolver") {}

export interface AvailableSource {
  readonly _tag: "Available";
}

export interface PrivateOrUnavailableSource {
  readonly _tag: "PrivateOrUnavailable";
}

export type SourceAvailability = AvailableSource | PrivateOrUnavailableSource;

export interface SourceAvailabilityValidatorShape {
  readonly validate: (
    source: Omit<VideoIdentity, "_tag">
  ) => Effect.Effect<SourceAvailability, ImportSourceError>;
}

export const SourceAvailabilityValidator =
  Context.Service<SourceAvailabilityValidatorShape>(
    "meal-planner/SourceAvailabilityValidator"
  );
