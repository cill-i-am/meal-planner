import { Schema } from "effect";

export const PrivateMediaArtifactPathPrefix = "/artifacts/" as const;

/** Build the private, container-local route for one registered artifact id. */
export const privateMediaArtifactPath = (artifactId: string) =>
  `${PrivateMediaArtifactPathPrefix}${encodeURIComponent(artifactId)}`;

export const AcquisitionReaderId = Schema.String.check(Schema.isUUID(4));
export const AcquisitionReaderHeader = "x-acquisition-reader";
