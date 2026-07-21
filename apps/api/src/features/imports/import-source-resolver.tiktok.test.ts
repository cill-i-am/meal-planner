import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
// eslint-disable-next-line unicorn/import-style -- The root Alchemy TypeScript config disables synthetic default imports.
import { join } from "node:path";
import { Readable } from "node:stream";

import { Cause, Effect, Exit, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  isPublicMediaAddress,
  makeSecureMediaDownloader,
} from "./import-media-acquirer.container.js";
import type {
  SecureMediaDownloadClient,
  SecureMediaDownloadResponse,
} from "./import-media-acquirer.container.js";
import type { MediaProcessRunnerShape } from "./import-media-process.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import {
  isSafeTikTokMediaLocator,
  makeTikTokSourceResolver,
} from "./import-source-resolver.tiktok.js";
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

const makeRunner = (metadata: unknown) => {
  const calls: { args: readonly string[]; command: string }[] = [];
  const runner: MediaProcessRunnerShape = {
    run: (command, args) =>
      Effect.sync(() => {
        calls.push({ args, command });
        return {
          stderrBytes: 0,
          stdout: new TextEncoder().encode(JSON.stringify(metadata)),
        };
      }),
  };
  return { calls, resolver: makeTikTokSourceResolver(runner) };
};

describe("TikTok source resolver adapter", () => {
  it("resolves privacy-scoped metadata and one ephemeral media locator", async () => {
    const canary =
      "https://v16m.tiktokcdn.com/media.mp4?token=provider-secret-fragment";
    const fixture = makeRunner({
      description: "Pasta from scratch",
      duration: 12,
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
        "--dump-single-json",
        "--skip-download",
        "--no-playlist",
        "--concurrent-fragments",
        "1",
      ])
    );
    expect(fixture.calls[0]?.args.join(" ")).not.toMatch(
      /cookie|session|proxy/iu
    );
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
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual({
      _tag: "UnsupportedCarousel",
      code: "unsupported_carousel",
    });
  });

  it("classifies unavailable and malformed metadata without exposing provider data", async () => {
    await Promise.all(
      [
        { availability: "needs_auth", id: identity.canonicalId },
        { malformed: "provider-secret-fragment" },
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
    const root = await mkdtemp(join(tmpdir(), "meal-planner-download-policy-"));
    try {
      const privateDestination = join(root, "private.mp4");
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
      const redirectDestination = join(root, "redirect.mp4");
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

      const validDestination = join(root, "valid.mp4");
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
    const root = await mkdtemp(join(tmpdir(), "meal-planner-ipv6-policy-"));
    let requests = 0;
    try {
      const destination = join(root, "blocked.mp4");
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
