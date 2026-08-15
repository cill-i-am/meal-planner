export const PrivateMediaArtifactPathPrefix = "/artifacts/" as const;

/** Build the private, container-local route for one registered artifact id. */
export const privateMediaArtifactPath = (artifactId: string) =>
  `${PrivateMediaArtifactPathPrefix}${encodeURIComponent(artifactId)}`;
