import { randomUUID } from "node:crypto";
import {
  access,
  appendFile,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
// eslint-disable-next-line unicorn/import-style -- The root Alchemy TypeScript config disables synthetic default imports.
import { join } from "node:path";
import { Readable } from "node:stream";

import * as Cloudflare from "alchemy/Cloudflare";
import { Cause, Context, Effect, Exit, Option, Schema } from "effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { describe, expect, it, vi } from "vitest";

import {
  makeContainerMediaAcquirer,
  makeSecureMediaDownloader,
} from "./import-media-acquirer.container.js";
import type {
  SecureMediaDownloadClient,
  SecureMediaDownloadResponse,
} from "./import-media-acquirer.container.js";
import { acquireStoreVerify } from "./import-media-acquirer.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import { makeAcquisitionMediaObject } from "./import-media-acquisition-object.client.js";
import type { AcquisitionMediaObjectStub } from "./import-media-acquisition-object.client.js";
import { ImportMediaAcquisitionObjectRuntime } from "./import-media-acquisition-object.js";
import { TikTokMediaContainer } from "./import-media-container.js";
import { makeTikTokMediaContainerRuntime } from "./import-media-container.runtime.js";
import { makeTemporaryArtifactStore } from "./import-media-process.js";
import type { MediaProcessRunnerShape } from "./import-media-process.js";
import {
  AcquisitionGeneration,
  MaximumMediaProcessMilliseconds,
  ProductionMediaLimits,
} from "./import-media.model.js";
import type { ImportObservabilityEvent } from "./import-observability.js";
import {
  ImportCorrelationId,
  ImportObservabilityTraceStore,
} from "./import-observability.js";
import { makeTikTokSourceResolver } from "./import-source-resolver.tiktok.js";
import { ImportId, SourceCanonicalId } from "./import.contracts.js";
import { runAcquisitionTask } from "./import.workflow.js";

const identity = {
  canonicalId: Schema.decodeUnknownSync(SourceCanonicalId)(
    "7520000000000000000"
  ),
  generation: Schema.decodeUnknownSync(AcquisitionGeneration)(1),
  importId: Schema.decodeUnknownSync(ImportId)(
    "018f47ad-91aa-7c35-b6fe-000000000001"
  ),
  kind: "tiktok" as const,
};
const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b1a"
);

const mediaBytes = new Uint8Array(128 * 1024 + 24);
mediaBytes.set([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
]);

const response = (statusCode = 200): SecureMediaDownloadResponse => ({
  body: Readable.from([mediaBytes]),
  contentLength: mediaBytes.byteLength,
  destroy: () => null,
  location: undefined,
  statusCode,
});

const videoMetadata = () => ({
  description: "Synthetic recipe boundary",
  duration: 12,
  http_headers: {
    Accept: "video/mp4",
    Authorization: "secret-header-canary",
    Cookie: "secret-header-canary",
    Referer: "https://www.tiktok.com/",
    "User-Agent": "synthetic-boundary",
  },
  id: identity.canonicalId,
  uploader: "Synthetic Cook",
  uploader_id: "synthetic-cook",
  uploader_url: "https://www.tiktok.com/@synthetic-cook",
  url: "https://v16m.tiktokcdn.com/media.mp4?token=locator-canary",
  webpage_url: `https://www.tiktok.com/@synthetic-cook/video/${identity.canonicalId}`,
});

const makeProcessRunner = (
  metadata: () => unknown = videoMetadata,
  sessionAudit?: {
    mode?: number;
    ownedByProcess?: boolean;
    path?: string;
    readonly value: string;
  },
  sessionDomain = ".tiktokcdn.com"
): MediaProcessRunnerShape => ({
  run: (command, args) =>
    Effect.promise(async () => {
      if (command === "yt-dlp") {
        const cookiesIndex = args.indexOf("--cookies");
        const sessionPath = args[cookiesIndex + 1];
        if (sessionPath === undefined) {
          throw new Error("Expected an ephemeral session file");
        }
        const sessionStats = await stat(sessionPath);
        if (sessionAudit !== undefined) {
          sessionAudit.mode = sessionStats.mode % 0o1000;
          sessionAudit.ownedByProcess =
            typeof process.getuid !== "function" ||
            sessionStats.uid === process.getuid();
          sessionAudit.path = sessionPath;
        }
        await appendFile(
          sessionPath,
          `${sessionDomain}\tTRUE\t/\tTRUE\t4102444800\tsynthetic_session\t${sessionAudit?.value ?? randomUUID()}\n`
        );
        return {
          stderrBytes: 0,
          stdout: new TextEncoder().encode(JSON.stringify(metadata())),
        };
      }
      if (command === "ffmpeg") {
        await writeFile(String(args.at(-1)), mediaBytes);
        return { stderrBytes: 0, stdout: new Uint8Array() };
      }
      if (command === "ffprobe") {
        return {
          stderrBytes: 0,
          stdout: new TextEncoder().encode(
            JSON.stringify({
              format: {
                duration: "12",
                format_name: "mp4",
                size: String(mediaBytes.byteLength),
              },
              streams: [
                { codec_name: "h264", codec_type: "video", index: 0 },
                { codec_name: "aac", codec_type: "audio", index: 1 },
              ],
            })
          ),
        };
      }
      throw new Error(`Unexpected command ${command}`);
    }),
});

const makeContainerFetcher = (
  runtime: ReturnType<typeof makeTikTokMediaContainerRuntime>,
  rpcFailure?: Error
) => {
  const runtimeWithFetch = runtime as typeof runtime & {
    readonly fetch: Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      never,
      HttpServerRequest.HttpServerRequest
    >;
  };
  const handler = Cloudflare.serveRpc(
    runtime as unknown as Record<string, unknown>,
    runtimeWithFetch.fetch
  );
  return Cloudflare.fromCloudflareFetcher({
    connect: () => {
      throw new Error("connect is not used by the acquisition RPC");
    },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const webRequest = new Request(input, init);
      if (
        rpcFailure !== undefined &&
        new URL(webRequest.url).pathname !== "/containerstarthealthcheck"
      ) {
        return new Response(rpcFailure.message, { status: 502 });
      }
      const request = HttpServerRequest.fromWeb(webRequest);
      const rpcResponse = await Effect.runPromise(
        Effect.scoped(
          handler.pipe(
            Effect.provideService(HttpServerRequest.HttpServerRequest, request)
          )
        )
      );
      return HttpServerResponse.toWeb(rpcResponse);
    },
  });
};

type InstalledAcquisitionBoundary = AcquisitionMediaObjectStub;

const withInstalledAcquisitionBoundary = async <A>(
  runtime: ReturnType<typeof makeTikTokMediaContainerRuntime>,
  use: (stub: InstalledAcquisitionBoundary) => Promise<A>,
  rpcFailure?: Error
) => {
  const bindingKey = "~alchemy/Container/Binding";
  const originalBinding = Object.getOwnPropertyDescriptor(
    TikTokMediaContainer,
    bindingKey
  );
  const fetcher = makeContainerFetcher(runtime, rpcFailure);
  Object.defineProperty(TikTokMediaContainer, bindingKey, {
    configurable: true,
    value: Effect.succeed(
      Effect.succeed({
        destroy: () => Effect.void,
        getTcpPort: () => Effect.succeed(fetcher),
        interceptAllOutboundHttp: () => Effect.void,
        interceptOutboundHttp: () => Effect.void,
        monitor: () => Effect.never,
        running: Effect.succeed(true),
        setInactivityTimeout: () => Effect.void,
        signal: () => Effect.void,
        start: () => Effect.void,
      })
    ),
  });

  const entrypoint = Effect.succeed({
    RuntimeContext: {
      exports: Effect.succeed({
        ImportMediaAcquisitionObject: {
          constructor: ImportMediaAcquisitionObjectRuntime,
          services: Context.empty(),
        },
      }),
      shape: () => ({}),
    },
  });
  class TestDurableObject {
    readonly ctx;
    constructor(ctx: unknown) {
      this.ctx = ctx;
    }
  }
  const pending: Promise<unknown>[] = [];
  const state = {
    blockConcurrencyWhile: <Value>(operation: () => Promise<Value>) =>
      operation(),
    container: {},
    id: { toString: () => "gaia-167-installed-boundary" },
    storage: {},
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  };

  try {
    const Bridge = Cloudflare.makeDurableObjectBridge(
      TestDurableObject as never,
      {
        entrypoint,
        stack: { name: "MealPlanner", stage: "test-gaia-167" },
      }
    )("ImportMediaAcquisitionObject");
    const object = new Bridge(state as never, {});
    const stub = Cloudflare.makeRpcStub<InstalledAcquisitionBoundary>(object);
    return await use(stub);
  } finally {
    await Promise.allSettled(pending);
    if (originalBinding === undefined) {
      Reflect.deleteProperty(TikTokMediaContainer, bindingKey);
    } else {
      Object.defineProperty(TikTokMediaContainer, bindingKey, originalBinding);
    }
  }
};

const untouchedBucket = (): AcquisitionBucketLike => ({
  get: () => Promise.reject(new Error("bucket must remain untouched")),
  head: () => Promise.reject(new Error("bucket must remain untouched")),
  put: () => Promise.reject(new Error("bucket must remain untouched")),
});

const runContainerRequest = (
  runtime: ReturnType<typeof makeTikTokMediaContainerRuntime>,
  request: Request
) => {
  const runtimeWithFetch = runtime as typeof runtime & {
    readonly fetch: Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      never,
      HttpServerRequest.HttpServerRequest
    >;
  };
  return Effect.runPromise(
    Effect.scoped(
      runtimeWithFetch.fetch.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(request)
        )
      )
    )
  ).then((serverResponse) => HttpServerResponse.toWeb(serverResponse));
};

describe("installed acquisition Durable Object boundary", () => {
  it("streams a registered private artifact above 128 KiB exactly", async () => {
    const root = await mkdtemp(join(tmpdir(), "private-artifact-read-"));
    const artifactId = "018f47ad-91aa-7c35-b6fe-000000000001:1:source";
    const artifactPath = join(root, "source.mp4");
    const artifacts = makeTemporaryArtifactStore((artifactRoot) =>
      rm(artifactRoot, { force: true, recursive: true })
    );
    const runtime = makeTikTokMediaContainerRuntime({
      acquirer: { acquire: () => Effect.die("acquirer must remain untouched") },
      artifacts,
      processRunner: makeProcessRunner(),
      resolver: { resolve: () => Effect.die("resolver must remain untouched") },
    });

    try {
      await writeFile(artifactPath, mediaBytes);
      artifacts.registerPath(artifactId, root, artifactPath, "video/mp4");

      const artifactResponse = await runContainerRequest(
        runtime,
        new Request(
          `http://container.invalid/artifacts/${encodeURIComponent(artifactId)}`
        )
      );
      const received = new Uint8Array(await artifactResponse.arrayBuffer());

      expect(artifactResponse.status).toBe(200);
      expect(artifactResponse.headers.get("cache-control")).toBe(
        "private, no-store"
      );
      expect(artifactResponse.headers.get("content-length")).toBe(
        String(mediaBytes.byteLength)
      );
      expect(artifactResponse.headers.get("content-type")).toBe("video/mp4");
      expect(received.byteLength).toBe(mediaBytes.byteLength);
      expect(received).toEqual(mediaBytes);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["missing", "/artifacts/missing:artifact", 404],
    ["malformed", "/artifacts/%00", 400],
    ["traversal", "/artifacts/..%2Fsource.mp4", 400],
  ])(
    "fails closed for a %s private artifact id",
    async (_case, path, status) => {
      const failureCanary = "opaque-artifact-read-canary";
      const runtime = makeTikTokMediaContainerRuntime({
        acquirer: { acquire: () => Effect.die(failureCanary) },
        artifacts: makeTemporaryArtifactStore(() => Promise.resolve()),
        processRunner: makeProcessRunner(),
        resolver: { resolve: () => Effect.die(failureCanary) },
      });

      const closedResponse = await runContainerRequest(
        runtime,
        new Request(`http://container.invalid${path}`)
      );

      expect(closedResponse.status).toBe(status);
      expect(closedResponse.headers.get("cache-control")).toBe(
        "private, no-store"
      );
      expect(await closedResponse.text()).not.toContain(failureCanary);
    }
  );

  it("classifies the container-wide process deadline as a timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "gaia-204-container-timeout-"));
    try {
      const source = await Effect.runPromise(
        makeTikTokSourceResolver(makeProcessRunner()).resolve(identity, root)
      );
      const acquirer = makeContainerMediaAcquirer(
        {
          run: () => Effect.never,
        },
        {
          download: (_locator, destination) =>
            Effect.promise(() => writeFile(destination, mediaBytes)),
        }
      );
      vi.useFakeTimers();
      const result = Effect.runPromiseExit(
        acquirer.acquire(source, ProductionMediaLimits, root)
      );

      await vi.advanceTimersByTimeAsync(MaximumMediaProcessMilliseconds);
      const exit = await result;

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(
          Option.getOrThrow(Cause.findErrorOption(exit.cause))
        ).toMatchObject({
          _tag: "RetryableAcquisitionFailure",
          reason: "container_process_timeout",
          stage: "process",
        });
      }
    } finally {
      vi.useRealTimers();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed before resolution when the temporary workspace is unavailable", async () => {
    let acquireCalls = 0;
    let resolveCalls = 0;
    const failureCanary = "opaque-temporary-workspace-canary";
    const runtime = makeTikTokMediaContainerRuntime({
      acquirer: {
        acquire: () => {
          acquireCalls += 1;
          return Effect.die("acquirer must remain untouched");
        },
      },
      artifacts: makeTemporaryArtifactStore(() => Promise.resolve()),
      makeTemporaryRoot: () => Promise.reject(new Error(failureCanary)),
      processRunner: makeProcessRunner(),
      resolver: {
        resolve: () => {
          resolveCalls += 1;
          return Effect.die("resolver must remain untouched");
        },
      },
    });

    const exit = await Effect.runPromiseExit(runtime.prepare(identity));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected temporary workspace allocation to fail");
    }
    const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));
    expect(failure).toMatchObject({
      _tag: "RetryableAcquisitionFailure",
      reason: "temporary_workspace_unavailable",
      stage: "container",
    });
    expect(JSON.stringify(failure)).not.toContain(failureCanary);
    expect(resolveCalls).toBe(0);
    expect(acquireCalls).toBe(0);
  });

  it("runs resolver and download through the Alchemy container layer and RPC", async () => {
    const root = await mkdtemp(join(tmpdir(), "gaia-167-installed-boundary-"));
    const requests: unknown[] = [];
    const sessionAudit: {
      mode?: number;
      ownedByProcess?: boolean;
      path?: string;
      readonly value: string;
    } = { value: randomUUID() };
    const downloadClient: SecureMediaDownloadClient = {
      request: (_url, _address, _signal, requestHeaders) => {
        const { cookie, ...safeHeaders } = requestHeaders;
        requests.push({
          ...safeHeaders,
          sessionPresent: cookie === `synthetic_session=${sessionAudit.value}`,
        });
        return Promise.resolve(response());
      },
      resolve: () => Promise.resolve(["8.8.8.8"]),
    };
    const processRunner = makeProcessRunner(
      videoMetadata,
      sessionAudit,
      "www.tiktok.com"
    );
    const artifacts = makeTemporaryArtifactStore((artifactRoot) =>
      rm(artifactRoot, { force: true, recursive: true })
    );
    const runtime = makeTikTokMediaContainerRuntime({
      acquirer: makeContainerMediaAcquirer(
        processRunner,
        makeSecureMediaDownloader(downloadClient)
      ),
      artifacts,
      makeTemporaryRoot: () => mkdtemp(join(root, "artifact-")),
      processRunner,
      resolver: makeTikTokSourceResolver(processRunner),
    });

    try {
      await withInstalledAcquisitionBoundary(runtime, async (stub) => {
        const prepared = await Effect.runPromise(stub.prepare(identity));
        expect(prepared).toMatchObject({
          bytes: mediaBytes.byteLength,
          durationSeconds: 12,
          metadata: {
            canonicalId: identity.canonicalId,
            caption: "Synthetic recipe boundary",
          },
        });
        expect(requests).toEqual([
          {
            accept: "video/mp4",
            referer: "https://www.tiktok.com/",
            sessionPresent: false,
            userAgent: "synthetic-boundary",
          },
        ]);
        expect(sessionAudit).toMatchObject({
          mode: 0o600,
          ownedByProcess: true,
        });
        expect(JSON.stringify(prepared)).not.toMatch(
          /secret-header-canary|locator-canary/u
        );
        expect(JSON.stringify(prepared)).not.toContain(sessionAudit.value);
        const stored = artifacts.get(prepared.artifactId);
        expect(stored?.path).not.toBeNull();
        await expect(access(String(sessionAudit.path))).rejects.toThrow();
        expect(await readFile(String(stored?.path))).toEqual(
          Buffer.from(mediaBytes)
        );
        const artifactResponse = await Effect.runPromise(
          stub.fetch(
            HttpServerRequest.fromWeb(
              new Request(
                `http://acquisition-object.invalid/artifacts/${encodeURIComponent(prepared.artifactId)}`
              )
            )
          )
        );
        const streamedBytes = Buffer.from(
          await HttpServerResponse.toWeb(artifactResponse).arrayBuffer()
        );
        expect(artifactResponse.status).toBe(200);
        expect(streamedBytes.byteLength).toBe(mediaBytes.byteLength);
        expect(streamedBytes.equals(Buffer.from(mediaBytes))).toBe(true);
        await Effect.runPromise(stub.cleanup(prepared.artifactId));
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("closes an installed RPC transport failure without retaining its detail", async () => {
    const processRunner = makeProcessRunner();
    const runtime = makeTikTokMediaContainerRuntime({
      acquirer: makeContainerMediaAcquirer(processRunner),
      artifacts: makeTemporaryArtifactStore(() => Promise.resolve()),
      processRunner,
      resolver: makeTikTokSourceResolver(processRunner),
    });
    const failureCanary = new Error("opaque-rpc-failure-canary");

    await withInstalledAcquisitionBoundary(
      runtime,
      async (stub) => {
        const exit = await Effect.runPromiseExit(
          acquireStoreVerify(
            untouchedBucket(),
            makeAcquisitionMediaObject(stub),
            {
              canonicalId: identity.canonicalId,
              generation: identity.generation,
              importId: identity.importId,
            }
          )
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) {
          throw new Error("Expected a closed RPC failure");
        }
        const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));
        expect(failure).toMatchObject({
          _tag: "RetryableAcquisitionFailure",
          reason: "container_rpc",
          stage: "container",
        });
        expect(JSON.stringify(failure)).not.toContain(failureCanary.message);
      },
      failureCanary
    );
  });

  it("carries installed download failures through retry exhaustion and replays a semantic outcome once", async () => {
    let mode: "carousel" | "video" = "video";
    let metadataCalls = 0;
    let resolveCalls = 0;
    const processRunner = makeProcessRunner(() => {
      metadataCalls += 1;
      return mode === "video"
        ? videoMetadata()
        : {
            _type: "playlist",
            entries: [{ id: "photo-1" }, { id: "photo-2" }],
            id: identity.canonicalId,
          };
    });
    const downloadClient: SecureMediaDownloadClient = {
      request: () => Promise.reject(new Error("must not connect")),
      resolve: () => {
        resolveCalls += 1;
        return Promise.reject(new Error("opaque-dns-failure-canary"));
      },
    };
    const runtime = makeTikTokMediaContainerRuntime({
      acquirer: makeContainerMediaAcquirer(
        processRunner,
        makeSecureMediaDownloader(downloadClient)
      ),
      artifacts: makeTemporaryArtifactStore((artifactRoot) =>
        rm(artifactRoot, { force: true, recursive: true })
      ),
      processRunner,
      resolver: makeTikTokSourceResolver(processRunner),
    });
    let allocations = 0;
    const events: ImportObservabilityEvent[] = [];
    const traceStore = ImportObservabilityTraceStore.of({
      append: (event) =>
        Effect.sync(() => {
          events.push(event);
        }),
      read: (id) =>
        Effect.succeed(events.filter((event) => event.correlationId === id)),
    });

    await withInstalledAcquisitionBoundary(runtime, async (stub) => {
      const execute = () =>
        runAcquisitionTask(
          () =>
            Effect.sync(() => ({
              canonicalSourceId: identity.canonicalId,
              generation: Schema.decodeUnknownSync(AcquisitionGeneration)(
                (allocations += 1)
              ),
            })),
          (allocation) =>
            acquireStoreVerify(
              untouchedBucket(),
              makeAcquisitionMediaObject(stub),
              {
                canonicalId: allocation.canonicalSourceId,
                generation: allocation.generation,
                importId: identity.importId,
              }
            ),
          { correlationId }
        );
      const exhausted = await Effect.runPromise(
        execute().pipe(
          Effect.provideService(ImportObservabilityTraceStore, traceStore)
        )
      );

      expect(exhausted).toEqual({
        _tag: "RetryExhausted",
        attempts: 3,
        generation: 3,
        reason: "download_dns",
        stage: "container",
      });
      expect(metadataCalls).toBe(3);
      expect(resolveCalls).toBe(3);
      expect(events).toEqual([
        {
          attempt: 1,
          correlationId,
          event: "acquisition.dispatch",
          outcome: "started",
        },
        {
          attempt: 1,
          correlationId,
          event: "acquisition.response",
          outcome: "failed",
          reasonCode: "transport",
        },
        {
          attempt: 1,
          correlationId,
          event: "acquisition.retry",
          outcome: "retrying",
          reasonCode: "transport",
        },
        {
          attempt: 2,
          correlationId,
          event: "acquisition.dispatch",
          outcome: "started",
        },
        {
          attempt: 2,
          correlationId,
          event: "acquisition.response",
          outcome: "failed",
          reasonCode: "transport",
        },
        {
          attempt: 2,
          correlationId,
          event: "acquisition.retry",
          outcome: "retrying",
          reasonCode: "transport",
        },
        {
          attempt: 3,
          correlationId,
          event: "acquisition.dispatch",
          outcome: "started",
        },
        {
          attempt: 3,
          correlationId,
          event: "acquisition.response",
          outcome: "failed",
          reasonCode: "transport",
        },
      ]);
      expect(
        events.every((event) => event.correlationId === correlationId)
      ).toBe(true);
      expect(JSON.stringify(events)).not.toMatch(
        /https?:|prompt|transcript|cookie|authorization|credential|media|payload|opaque-dns-failure-canary/iu
      );

      mode = "carousel";
      const replayed = await Effect.runPromise(
        execute().pipe(
          Effect.provideService(ImportObservabilityTraceStore, traceStore)
        )
      );
      expect(replayed).toEqual({
        _tag: "UnsupportedCarousel",
        code: "unsupported_carousel",
        generation: 4,
      });
      expect(metadataCalls).toBe(4);
      expect(resolveCalls).toBe(3);
    });
  }, 10_000);

  it("converges repeated installed source denials after fresh acquisition attempts", async () => {
    let allocations = 0;
    let metadataCalls = 0;
    let requestCalls = 0;
    const processRunner = makeProcessRunner(() => {
      metadataCalls += 1;
      return videoMetadata();
    });
    const downloadClient: SecureMediaDownloadClient = {
      request: () => {
        requestCalls += 1;
        return Promise.resolve(response(403));
      },
      resolve: () => Promise.resolve(["8.8.8.8"]),
    };
    const runtime = makeTikTokMediaContainerRuntime({
      acquirer: makeContainerMediaAcquirer(
        processRunner,
        makeSecureMediaDownloader(downloadClient)
      ),
      artifacts: makeTemporaryArtifactStore((artifactRoot) =>
        rm(artifactRoot, { force: true, recursive: true })
      ),
      processRunner,
      resolver: makeTikTokSourceResolver(processRunner),
    });

    await withInstalledAcquisitionBoundary(runtime, async (stub) => {
      const outcome = await Effect.runPromise(
        runAcquisitionTask(
          () =>
            Effect.sync(() => ({
              canonicalSourceId: identity.canonicalId,
              generation: Schema.decodeUnknownSync(AcquisitionGeneration)(
                (allocations += 1)
              ),
            })),
          (allocation) =>
            acquireStoreVerify(
              untouchedBucket(),
              makeAcquisitionMediaObject(stub),
              {
                canonicalId: allocation.canonicalSourceId,
                generation: allocation.generation,
                importId: identity.importId,
              }
            )
        )
      );

      expect(outcome).toEqual({
        _tag: "Unavailable",
        code: "private_or_unavailable",
        generation: 3,
      });
      expect(allocations).toBe(3);
      expect(metadataCalls).toBe(3);
      expect(requestCalls).toBe(3);
    });
  }, 10_000);
});
