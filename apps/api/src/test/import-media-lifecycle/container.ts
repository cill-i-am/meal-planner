import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer, Stream } from "effect";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { makeTikTokMediaContainerRuntime } from "../../features/imports/import-media-container.runtime.js";
import { makeTemporaryArtifactStore } from "../../features/imports/import-media-process.js";
import { decodeTikTokMediaSession } from "../../features/imports/import-source-session.js";

const bytes = new Uint8Array(2 * 1024 * 1024).fill(77);
const runtime = makeTikTokMediaContainerRuntime({
  acquirer: {
    acquire: (source, _limits, root) =>
      Effect.promise(async () => {
        const filePath = path.join(root, "source.mp4");
        await writeFile(filePath, bytes);
        return {
          audioStreams: [{ codec: "aac", index: 1 }],
          bytes: bytes.length,
          durationSeconds: 12,
          filePath,
          metadata: source.metadata,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          videoStreams: [{ codec: "h264", index: 0 }],
        };
      }),
  },
  artifacts: makeTemporaryArtifactStore((root) =>
    rm(root, { force: true, recursive: true })
  ),
  processRunner: {
    run: (command, args) =>
      Effect.promise(async () => {
        if (command === "ffprobe") {
          return {
            stderrBytes: 0,
            stdout: new TextEncoder().encode(
              JSON.stringify({ streams: [{ height: 720, width: 1280 }] })
            ),
          };
        }
        await writeFile(String(args.at(-1)), bytes);
        return { stderrBytes: 0, stdout: new Uint8Array() };
      }),
  },
  resolver: {
    resolve: (identity) =>
      Effect.succeed({
        mediaLocator: "https://synthetic.invalid/media.mp4",
        metadata: {
          canonicalId: identity.canonicalId,
          canonicalUrl: `https://www.tiktok.com/@synthetic/video/${identity.canonicalId}`,
          caption: "Synthetic lifecycle proof",
          creator: { displayName: null, handle: null, id: null },
          observedAt: new Date().toISOString(),
          provenance: {
            canonicalUrl: "provider_observed",
            caption: "creator_provided",
            creator: { displayName: null, handle: null, id: null },
            publishedAt: null,
          },
          publishedAt: null,
        },
        requestHeaders: {},
        session: decodeTikTokMediaSession(
          new TextEncoder().encode(
            "# Netscape HTTP Cookie File\n.tiktok.com\tTRUE\t/\tTRUE\t0\tsessionid\tsynthetic-fixture\n"
          )
        ),
      }),
  },
});
// Constrain the fixture's transport speed so real readers remain observable.
const fetch = runtime.fetch.pipe(
  Effect.map((response) => {
    if (response.body._tag !== "Stream") {
      return response;
    }
    return HttpServerResponse.stream(
      response.body.stream.pipe(
        Stream.rechunk(65_536),
        Stream.tap(() => Effect.sleep(50))
      ),
      {
        contentLength: response.body.contentLength,
        headers: response.headers,
        status: response.status,
      }
    );
  })
);
const handler = Cloudflare.serveRpc(runtime, fetch).pipe(
  Effect.tapCause(Effect.logError)
);
NodeRuntime.runMain(
  Layer.launch(
    HttpServer.serve(handler).pipe(
      Layer.provide(
        NodeHttpServer.layer(() => createServer(), {
          host: "0.0.0.0",
          port: 3000,
        })
      )
    )
  )
);
