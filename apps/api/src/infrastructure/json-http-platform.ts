import { Effect, FileSystem, Layer, Path } from "effect";
import { Etag, HttpPlatform } from "effect/unstable/http";

/** JSON-only Worker APIs do not expose file responses. */
const WorkerHttpPlatform = Layer.succeed(HttpPlatform.HttpPlatform, {
  compression: {
    algorithms: new Set<HttpPlatform.CompressionAlgorithm>(),
    compressResponse: (response) => Effect.succeed(response),
  },
  fileResponse: () => Effect.die("File responses are unsupported"),
  fileWebResponse: () => Effect.die("File responses are unsupported"),
  platform: "web",
});

export const JsonHttpPlatformServices = Layer.mergeAll(
  Etag.layer,
  FileSystem.layerNoop({}),
  WorkerHttpPlatform,
  Path.layer
);
