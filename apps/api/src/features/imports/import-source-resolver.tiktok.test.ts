import { randomUUID } from "node:crypto";
import {
  access,
  appendFile,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { Cause, Deferred, Effect, Exit, Fiber, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  isPublicMediaAddress,
  makeSecureMediaDownloader,
} from "./import-media-acquirer.container.js";
import type {
  SecureMediaDownloadClient,
  SecureMediaDownloadResponse,
} from "./import-media-acquirer.container.js";
import type { MediaProcessRunner } from "./import-media-process.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import {
  isSafeTikTokMediaLocator,
  makeTikTokSourceResolver,
} from "./import-source-resolver.tiktok.js";
import { decodeTikTokMediaSession } from "./import-source-session.js";
import { ImportId, SourceCanonicalId } from "./import.contracts.js";

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

const downloadResponse = ({
  body = [],
  location,
  statusCode,
}: {
  readonly body?: readonly Uint8Array[];
  readonly location?: string;
  readonly statusCode: number;
}): SecureMediaDownloadResponse => ({
  body: Readable.from(body),
  contentLength: null,
  destroy: () => null,
  location,
  statusCode,
});

const encodeCookieJar = (...records: readonly string[]) =>
  new TextEncoder().encode(
    ["# Netscape HTTP Cookie File", ...records, ""].join("\n")
  );

const sessionRecordForMode = (
  mode: "invalid" | "source-scoped" | "valid",
  canary: string
) =>
  ({
    invalid: "not-a-valid-cookie-record\n",
    "source-scoped": `www.tiktok.com\tFALSE\t/\tTRUE\t4102444800\tsynthetic_session\t${canary}\n`,
    valid: `.tiktokcdn.com\tTRUE\t/\tTRUE\t4102444800\tsynthetic_session\t${canary}\n`,
  })[mode];

const makeRunner = (
  metadata: Schema.Json,
  sessionMode: "invalid" | "missing" | "source-scoped" | "valid" = "valid"
) => {
  const calls: { args: readonly string[]; command: string }[] = [];
  const sessionFileAudits: {
    mode: number;
    ownedByProcess: boolean;
    removed: boolean;
  }[] = [];
  const sessionCanary = randomUUID();
  const runner: MediaProcessRunner = {
    run: (command, args) =>
      Effect.promise(async () => {
        calls.push({ args, command });
        const cookiesIndex = args.indexOf("--cookies");
        const sessionPath = args[cookiesIndex + 1];
        if (sessionPath === undefined) {
          throw new Error("Expected an ephemeral session file");
        }
        const sessionStats = await stat(sessionPath);
        const processUserId = process.getuid?.();
        const audit = {
          mode: sessionStats.mode % 0o1000,
          ownedByProcess:
            processUserId === undefined || sessionStats.uid === processUserId,
          removed: false,
        };
        sessionFileAudits.push(audit);
        await (sessionMode === "missing"
          ? rm(sessionPath)
          : appendFile(
              sessionPath,
              sessionRecordForMode(sessionMode, sessionCanary)
            ));
        return {
          stderrBytes: 0,
          stdout: new TextEncoder().encode(JSON.stringify(metadata)),
        };
      }),
  };
  const resolver = makeTikTokSourceResolver(runner);
  return {
    calls,
    resolver: {
      resolve: (sourceIdentity: typeof identity) =>
        Effect.acquireUseRelease(
          Effect.promise(() =>
            mkdtemp(path.join(tmpdir(), "meal-planner-resolver-session-"))
          ),
          (root) =>
            resolver.resolve(sourceIdentity, root).pipe(
              Effect.onExit(() =>
                Effect.promise(async () => {
                  const sessionPath = path.join(root, "yt-dlp-session.cookies");
                  let removed = false;
                  try {
                    await access(sessionPath);
                  } catch {
                    removed = true;
                  }
                  const audit = sessionFileAudits.at(-1);
                  if (audit !== undefined) {
                    audit.removed = removed;
                  }
                })
              )
            ),
          (root) =>
            Effect.promise(() => rm(root, { force: true, recursive: true }))
        ),
    },
    sessionCanary,
    sessionFileAudits,
  };
};

describe("TikTok source resolver adapter", () => {
  it("resolves privacy-scoped metadata and one ephemeral media locator", async () => {
    const canary =
      "https://v16m.tiktokcdn.com/media.mp4?token=provider-secret-fragment";
    const fixture = makeRunner({
      description: "Pasta from scratch",
      duration: 12,
      http_headers: {
        Accept: "video/mp4,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Authorization: "provider-secret-fragment",
        Cookie: "provider-secret-fragment",
        Referer: "https://www.tiktok.com/",
        "User-Agent": "Mozilla/5.0 synthetic-boundary",
      },
      id: identity.canonicalId,
      timestamp: 1_721_000_000,
      uploader: "Cook",
      uploader_id: "cook-id",
      uploader_url: "https://www.tiktok.com/@cook",
      url: canary,
      webpage_url: `https://www.tiktok.com/@cook/video/${identity.canonicalId}`,
    });

    const resolved = await Effect.runPromise(
      fixture.resolver.resolve(identity)
    );

    expect(resolved.mediaLocator).toBe(canary);
    expect(resolved.requestHeaders).toEqual({
      accept: "video/mp4,*/*;q=0.8",
      acceptLanguage: "en-US,en;q=0.9",
      referer: "https://www.tiktok.com/",
      userAgent: "Mozilla/5.0 synthetic-boundary",
    });
    expect(JSON.stringify(resolved.requestHeaders)).not.toContain(
      "provider-secret-fragment"
    );
    expect(resolved.metadata).toMatchObject({
      canonicalId: identity.canonicalId,
      canonicalUrl: `https://www.tiktok.com/@cook/video/${identity.canonicalId}`,
      caption: "Pasta from scratch",
      creator: {
        displayName: "Cook",
        handle: "cook",
        id: "cook-id",
      },
      provenance: {
        canonicalUrl: "provider_observed",
        caption: "creator_provided",
        creator: {
          displayName: "provider_observed",
          handle: "provider_observed",
          id: "provider_observed",
        },
        publishedAt: "provider_observed",
      },
    });
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]?.command).toBe("yt-dlp");
    expect(fixture.calls[0]?.args).toEqual(
      expect.arrayContaining([
        "--ignore-config",
        "--cookies",
        "--dump-single-json",
        "--skip-download",
        "--no-playlist",
        "--concurrent-fragments",
        "1",
      ])
    );
    expect(fixture.calls[0]?.args.join(" ")).not.toMatch(
      /cookies-from-browser|proxy|username|password/iu
    );
    expect(fixture.sessionFileAudits).toEqual([
      {
        mode: 0o600,
        ownedByProcess: true,
        removed: true,
      },
    ]);
    expect(Object.keys(resolved.session)).toEqual([]);
    expect(JSON.stringify(resolved.session)).toBe("{}");
    expect(JSON.stringify(resolved)).not.toContain(fixture.sessionCanary);
  });

  it.each(["missing", "invalid"] as const)(
    "fails closed when the ephemeral media session is %s",
    async (sessionMode) => {
      const fixture = makeRunner(
        {
          duration: 1,
          id: identity.canonicalId,
          url: "https://v16m.tiktokcdn.com/media.mp4",
          webpage_url: `https://www.tiktok.com/@cook/video/${identity.canonicalId}`,
        },
        sessionMode
      );
      const exit = await Effect.runPromiseExit(
        fixture.resolver.resolve(identity)
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected missing session failure");
      }
      expect(
        Option.getOrThrow(Cause.findErrorOption(exit.cause))
      ).toMatchObject({
        _tag: "RetryableAcquisitionFailure",
        reason: "media_session_invalid",
        stage: "resolve",
      });
      expect(JSON.stringify(exit)).not.toContain(fixture.sessionCanary);
      expect(fixture.sessionFileAudits).toEqual([
        {
          mode: 0o600,
          ownedByProcess: true,
          removed: true,
        },
      ]);
    }
  );

  it("accepts a valid source-scoped session when no cookie applies to the media host", async () => {
    const fixture = makeRunner(
      {
        duration: 1,
        id: identity.canonicalId,
        url: "https://v16m.tiktokcdn.com/media.mp4",
        webpage_url: `https://www.tiktok.com/@cook/video/${identity.canonicalId}`,
      },
      "source-scoped"
    );

    const resolved = await Effect.runPromise(
      fixture.resolver.resolve(identity)
    );

    expect(resolved.mediaLocator).toBe("https://v16m.tiktokcdn.com/media.mp4");
    expect(Object.keys(resolved.session)).toEqual([]);
    expect(JSON.stringify(resolved)).not.toContain(fixture.sessionCanary);
    expect(fixture.sessionFileAudits).toEqual([
      {
        mode: 0o600,
        ownedByProcess: true,
        removed: true,
      },
    ]);
  });

  it("keeps carousel as an explicit unsupported adapter branch", async () => {
    const fixture = makeRunner({
      _type: "playlist",
      entries: [{ id: "photo-1" }, { id: "photo-2" }],
      id: identity.canonicalId,
    });
    const exit = await Effect.runPromiseExit(
      fixture.resolver.resolve(identity)
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected unsupported carousel");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
      _tag: "UnsupportedCarousel",
      code: "unsupported_carousel",
    });
  });

  it("classifies unavailable and malformed metadata without exposing provider data", async () => {
    await Promise.all(
      [
        { availability: "needs_auth", id: identity.canonicalId },
        { malformed: "provider-secret-fragment" },
        null,
        ["provider-secret-fragment"],
        "provider-secret-fragment",
      ].map(async (metadata) => {
        const fixture = makeRunner(metadata);
        const exit = await Effect.runPromiseExit(
          fixture.resolver.resolve(identity)
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) {
          throw new Error("Expected source failure");
        }
        const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
        expect(error._tag).toMatch(/Unavailable|TerminalMedia/u);
        expect(JSON.stringify(error)).not.toContain("provider-secret-fragment");
      })
    );
  });

  it("rejects over-duration media and non-HTTPS locators before acquisition", async () => {
    await Promise.all(
      [
        {
          duration: 901,
          id: identity.canonicalId,
          url: "https://provider.invalid/media.mp4",
          webpage_url: `https://www.tiktok.com/@cook/video/${identity.canonicalId}`,
        },
        {
          duration: 1,
          id: identity.canonicalId,
          url: "file:///provider-secret-fragment",
          webpage_url: `https://www.tiktok.com/@cook/video/${identity.canonicalId}`,
        },
        {
          duration: 1,
          id: identity.canonicalId,
          url: "https://metadata.google.internal/latest/meta-data",
          webpage_url: `https://www.tiktok.com/@cook/video/${identity.canonicalId}`,
        },
        {
          duration: 1,
          id: identity.canonicalId,
          url: "https://v16m.tiktokcdn.com/media.mp4",
          webpage_url: `https://user:provider-secret@www.tiktok.com/@cook/video/${identity.canonicalId}?token=provider-secret#fragment`,
        },
      ].map(async (metadata) => {
        const fixture = makeRunner(metadata);
        const exit = await Effect.runPromiseExit(
          fixture.resolver.resolve(identity)
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) {
          throw new Error("Expected bounded source rejection");
        }
        const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
        expect(error).toMatchObject({
          _tag: "TerminalMedia",
          stage: "resolve",
        });
        expect(JSON.stringify(error)).not.toContain("provider-secret-fragment");
      })
    );
  });

  it("pins public DNS and rejects private resolution plus unsafe redirect hops", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "meal-planner-download-policy-")
    );
    try {
      const privateDestination = path.join(root, "private.mp4");
      const privateClient: SecureMediaDownloadClient = {
        request: () => Promise.reject(new Error("must not connect")),
        resolve: () => Promise.resolve(["169.254.169.254"]),
      };
      const privateExit = await Effect.runPromiseExit(
        makeSecureMediaDownloader(privateClient).download(
          "https://v16m.tiktokcdn.com/media.mp4",
          privateDestination,
          1024
        )
      );
      expect(Exit.isFailure(privateExit)).toBe(true);
      await expect(access(privateDestination)).rejects.toThrow();

      let requests = 0;
      const redirectDestination = path.join(root, "redirect.mp4");
      expect(isPublicMediaAddress("8.8.8.8")).toBe(true);
      expect(
        isSafeTikTokMediaLocator("https://v16m.tiktokcdn.com/media.mp4")
      ).toBe(true);
      const redirectClient: SecureMediaDownloadClient = {
        request: () => {
          requests += 1;
          return Promise.resolve(
            downloadResponse({
              location:
                "https://metadata.google.internal/latest/meta-data/provider-secret-fragment",
              statusCode: 302,
            })
          );
        },
        resolve: () => Promise.resolve(["8.8.8.8"]),
      };
      const redirectExit = await Effect.runPromiseExit(
        makeSecureMediaDownloader(redirectClient).download(
          "https://v16m.tiktokcdn.com/media.mp4",
          redirectDestination,
          1024
        )
      );
      expect(Exit.isFailure(redirectExit)).toBe(true);
      expect(requests).toBe(1);
      await expect(access(redirectDestination)).rejects.toThrow();

      const validDestination = path.join(root, "valid.mp4");
      const validClient: SecureMediaDownloadClient = {
        request: () =>
          Promise.resolve(
            downloadResponse({
              body: [new Uint8Array([1, 2, 3])],
              statusCode: 200,
            })
          ),
        resolve: () => Promise.resolve(["8.8.8.8"]),
      };
      await Effect.runPromise(
        makeSecureMediaDownloader(validClient).download(
          "https://v16m.tiktokcdn.com/media.mp4",
          validDestination,
          1024
        )
      );
      expect(await readFile(validDestination)).toEqual(Buffer.from([1, 2, 3]));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("carries only safe resolver headers through the pinned-IP request boundary", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "meal-planner-header-policy-")
    );
    const fixture = makeRunner({
      duration: 1,
      http_headers: {
        Accept: "video/mp4,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Authorization: "provider-secret-fragment",
        Cookie: "provider-secret-fragment",
        Referer: "https://www.tiktok.com/",
        "User-Agent": "Mozilla/5.0 synthetic-boundary",
      },
      id: identity.canonicalId,
      url: "https://v16m.tiktokcdn.com/media.mp4",
      webpage_url: `https://www.tiktok.com/@cook/video/${identity.canonicalId}`,
    });
    const resolved = await Effect.runPromise(
      fixture.resolver.resolve(identity)
    );
    const requests: {
      readonly accept?: string;
      readonly acceptLanguage?: string;
      readonly referer?: string;
      readonly sessionPresent: boolean;
      readonly userAgent?: string;
    }[] = [];
    const client: SecureMediaDownloadClient = {
      request: (_url, _address, _signal, headers) => {
        const { cookie, ...safeHeaders } = headers;
        requests.push({
          ...safeHeaders,
          sessionPresent:
            cookie === `synthetic_session=${fixture.sessionCanary}`,
        });
        return Promise.resolve(
          downloadResponse({
            body: [new Uint8Array([1, 2, 3])],
            statusCode: 200,
          })
        );
      },
      resolve: () => Promise.resolve(["8.8.8.8"]),
    };

    try {
      await Effect.runPromise(
        makeSecureMediaDownloader(client).download(
          resolved.mediaLocator,
          path.join(root, "safe.mp4"),
          1024,
          resolved.requestHeaders,
          resolved.session
        )
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        accept: "video/mp4,*/*;q=0.8",
        acceptLanguage: "en-US,en;q=0.9",
        referer: "https://www.tiktok.com/",
        sessionPresent: true,
        userAgent: "Mozilla/5.0 synthetic-boundary",
      });
      expect(JSON.stringify(requests)).not.toContain(
        "provider-secret-fragment"
      );
      expect(JSON.stringify(requests)).not.toContain(fixture.sessionCanary);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("revalidates redirects and scopes ephemeral cookies to each validated hop", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "meal-planner-session-policy-")
    );
    const requests: {
      firstHostCookie: boolean;
      secondHostCookie: boolean;
    }[] = [];
    const session = decodeTikTokMediaSession(
      encodeCookieJar(
        "v16m.tiktokcdn.com\tFALSE\t/\tTRUE\t4102444800\tfirst_host\tone",
        "v19.tiktokcdn.com\tFALSE\t/media\tTRUE\t4102444800\tsecond_host\ttwo",
        ".tiktokcdn.com\tTRUE\t/private\tTRUE\t4102444800\twrong_path\tthree",
        ".tiktokcdn.com\tTRUE\t/\tTRUE\t1\texpired\tfour"
      )
    );
    const client: SecureMediaDownloadClient = {
      request: (url, _address, _signal, headers) => {
        requests.push({
          firstHostCookie: headers.cookie === "first_host=one",
          secondHostCookie: headers.cookie === "second_host=two",
        });
        return Promise.resolve(
          url.hostname === "v16m.tiktokcdn.com"
            ? downloadResponse({
                location: "https://v19.tiktokcdn.com/media/video.mp4",
                statusCode: 302,
              })
            : downloadResponse({
                body: [new Uint8Array([1, 2, 3])],
                statusCode: 200,
              })
        );
      },
      resolve: () => Promise.resolve(["8.8.8.8"]),
    };

    try {
      await Effect.runPromise(
        makeSecureMediaDownloader(client).download(
          "https://v16m.tiktokcdn.com/media/video.mp4",
          path.join(root, "redirected.mp4"),
          1024,
          {},
          session
        )
      );
      expect(requests).toEqual([
        { firstHostCookie: true, secondHostCookie: false },
        { firstHostCookie: false, secondHostCookie: true },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("drops malformed or query-bearing request headers before acquisition", async () => {
    const fixture = makeRunner({
      duration: 1,
      http_headers: {
        Referer:
          "https://www.tiktok.com/?token=opaque-provider-secret-fragment",
        "User-Agent":
          "synthetic-agent\r\nCookie: opaque-provider-secret-fragment",
      },
      id: identity.canonicalId,
      url: "https://v16m.tiktokcdn.com/media.mp4",
      webpage_url: `https://www.tiktok.com/@cook/video/${identity.canonicalId}`,
    });

    const resolved = await Effect.runPromise(
      fixture.resolver.resolve(identity)
    );

    expect(resolved.requestHeaders).toEqual({});
    expect(JSON.stringify(resolved.requestHeaders)).not.toContain(
      "opaque-provider-secret-fragment"
    );
  });

  it.each(["cancellation", "timeout"] as const)(
    "removes the ephemeral session file after resolver %s",
    async (settlement) => {
      const root = await mkdtemp(
        path.join(tmpdir(), "meal-planner-session-interruption-")
      );
      const started = await Effect.runPromise(Deferred.make<true>());
      const resolver = makeTikTokSourceResolver({
        run: (_command, args) => {
          expect(args).toContain("--cookies");
          return Deferred.succeed(started, true).pipe(
            Effect.andThen(
              Effect.never as Effect.Effect<
                never,
                {
                  readonly _tag: "RetryableAcquisitionFailure";
                  readonly stage: "process";
                }
              >
            )
          );
        },
      });
      const sessionPath = path.join(root, "yt-dlp-session.cookies");

      try {
        if (settlement === "cancellation") {
          const fiber = Effect.runFork(resolver.resolve(identity, root));
          await Effect.runPromise(Deferred.await(started));
          await Effect.runPromise(Fiber.interrupt(fiber));
        } else {
          const exit = await Effect.runPromiseExit(
            resolver.resolve(identity, root).pipe(Effect.timeout("10 millis"))
          );
          expect(Exit.isFailure(exit)).toBe(true);
        }
        await expect(access(sessionPath)).rejects.toThrow();
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  );

  it.each([
    {
      expected: "download_dns",
      request: () => Promise.reject(new Error("must not connect")),
      resolve: () => Promise.reject(new Error("opaque dns failure")),
    },
    {
      expected: "download_source_unavailable",
      request: () => Promise.resolve(downloadResponse({ statusCode: 403 })),
      resolve: () => Promise.resolve(["8.8.8.8"]),
    },
    {
      expected: "download_http_response",
      request: () => Promise.resolve(downloadResponse({ statusCode: 500 })),
      resolve: () => Promise.resolve(["8.8.8.8"]),
    },
    {
      expected: "download_stream_or_tls",
      request: () => Promise.reject(new Error("opaque TLS failure")),
      resolve: () => Promise.resolve(["8.8.8.8"]),
    },
    {
      expected: "download_timeout",
      request: () => Promise.reject(new DOMException("aborted", "AbortError")),
      resolve: () => Promise.resolve(["8.8.8.8"]),
    },
  ] as const)(
    "classifies $expected without retaining provider detail",
    async ({ expected, request, resolve }) => {
      const root = await mkdtemp(
        path.join(tmpdir(), "meal-planner-failure-policy-")
      );
      const destination = path.join(root, "failed.mp4");
      try {
        const exit = await Effect.runPromiseExit(
          makeSecureMediaDownloader({ request, resolve }).download(
            "https://v16m.tiktokcdn.com/media.mp4",
            destination,
            1024
          )
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) {
          throw new Error("Expected classified download failure");
        }
        const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
        expect(error).toMatchObject({
          _tag: "RetryableAcquisitionFailure",
          reason: expected,
          stage: "container",
        });
        expect(JSON.stringify(error)).not.toMatch(/opaque|provider/iu);
        await expect(access(destination)).rejects.toThrow();
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  );

  it.each([
    "64:ff9b:1::1",
    "100::1",
    "100:0:0:1::1",
    "2001::1",
    "2001:2::1",
    "2001:db8::1",
    "2002::1",
    "3fff::1",
    "5f00::1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff00::1",
    "::ffff:127.0.0.1",
  ])("rejects special-use IPv6 %s before any request", async (address) => {
    const root = await mkdtemp(
      path.join(tmpdir(), "meal-planner-ipv6-policy-")
    );
    let requests = 0;
    try {
      const destination = path.join(root, "blocked.mp4");
      const client: SecureMediaDownloadClient = {
        request: () => {
          requests += 1;
          return Promise.reject(new Error("must not connect"));
        },
        resolve: () => Promise.resolve([address]),
      };

      expect(isPublicMediaAddress(address)).toBe(false);
      await expect(
        Effect.runPromise(
          makeSecureMediaDownloader(client).download(
            "https://v16m.tiktokcdn.com/media.mp4",
            destination,
            1024
          )
        )
      ).rejects.toMatchObject({
        _tag: "TerminalMedia",
        code: "invalid_media",
      });
      expect(requests).toBe(0);
      await expect(access(destination)).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each(["2001:4860:4860::8888", "2606:4700:4700::1111"])(
    "accepts global unicast IPv6 %s",
    (address) => {
      expect(isPublicMediaAddress(address)).toBe(true);
    }
  );
});
