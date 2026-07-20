import { Cause, Effect, Exit, Fiber, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { SourceCanonicalId, SourceDescriptor } from "./import.contracts.js";
import type { ImportSourceError } from "./import.errors.js";
import { ValidatedVideoUrl } from "./source-resolver.js";
import {
  makeTikTokCanonicalSourceIdentityResolver,
  makeTikTokSourceAvailabilityValidator,
} from "./source-resolver.tiktok.js";

const source = (url: string) =>
  Schema.decodeUnknownSync(SourceDescriptor)({ kind: "tiktok", url });

const resolvedResponse = (response: Response): Promise<Response> =>
  Promise.resolve(response);

const getFailure = async <A>(effect: Effect.Effect<A, ImportSourceError>) => {
  const exit = await Effect.runPromiseExit(effect);

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected failure");
  }
  return Option.getOrThrow(Cause.findErrorOption(exit.cause));
};

describe("TikTok canonical identity", () => {
  it("normalizes direct equivalents without a provider call", async () => {
    let calls = 0;
    const resolver = makeTikTokCanonicalSourceIdentityResolver(() => {
      calls += 1;
      throw new Error("unexpected fetch");
    });

    const inputs = [
      "https://www.tiktok.com/@cook/video/7520000000000000000",
      "https://m.tiktok.com/@cook/video/7520000000000000000/?lang=en#comments",
      "https://tiktok.com/@different/video/7520000000000000000",
    ];
    const results = await Promise.all(
      inputs.map((url) => Effect.runPromise(resolver.resolve(source(url))))
    );

    expect(results.map((result) => result.identity.canonicalId)).toEqual([
      "7520000000000000000",
      "7520000000000000000",
      "7520000000000000000",
    ]);
    expect(results.every((result) => result._tag === "VideoIdentity")).toBe(
      true
    );
    expect(results[1]).toMatchObject({
      _tag: "VideoIdentity",
      videoUrl: "https://m.tiktok.com/@cook/video/7520000000000000000",
    });
    expect(calls).toBe(0);
  });

  it.each([
    "http://www.tiktok.com/@cook/video/7520000000000000000",
    "https://www.tiktok.com.evil.test/@cook/video/7520000000000000000",
    "https://user@www.tiktok.com/@cook/video/7520000000000000000",
    "https://www.tiktok.com:444/@cook/video/7520000000000000000",
    "https://example.test/@cook/video/7520000000000000000",
  ])("rejects an unsafe full origin: %s", async (url) => {
    const resolver = makeTikTokCanonicalSourceIdentityResolver(fetch);
    const failure = await getFailure(resolver.resolve(source(url)));

    expect(failure._tag).toBe("InvalidSource");
  });

  it("revalidates every short-link redirect before following it", async () => {
    const seen: string[] = [];
    const resolver = makeTikTokCanonicalSourceIdentityResolver(
      (input, init) => {
        seen.push(String(input));
        expect(init?.redirect).toBe("manual");
        return resolvedResponse(
          new Response(null, {
            headers: { location: "https://evil.test/escaped" },
            status: 302,
          })
        );
      }
    );

    const failure = await getFailure(
      resolver.resolve(source("https://vm.tiktok.com/abc123"))
    );

    expect(failure._tag).toBe("InvalidSource");
    expect(seen).toEqual(["https://vm.tiktok.com/abc123"]);
  });

  it("rejects a malformed short-link redirect without exposing a URL defect", async () => {
    const resolver = makeTikTokCanonicalSourceIdentityResolver(() =>
      resolvedResponse(
        new Response(null, {
          headers: { location: "http://[" },
          status: 302,
        })
      )
    );

    const failure = await getFailure(
      resolver.resolve(source("https://vm.tiktok.com/abc123"))
    );

    expect(failure._tag).toBe("InvalidSource");
  });

  it("returns the validated final video URL from a short-link resolution", async () => {
    const resolver = makeTikTokCanonicalSourceIdentityResolver((input) =>
      resolvedResponse(
        String(input).includes("vm.tiktok.com")
          ? new Response(null, {
              headers: {
                location:
                  "https://www.tiktok.com/@cook/video/7520000000000000000?share=1",
              },
              status: 302,
            })
          : new Response(null, { status: 200 })
      )
    );

    await expect(
      Effect.runPromise(
        resolver.resolve(source("https://vm.tiktok.com/abc123"))
      )
    ).resolves.toMatchObject({
      _tag: "VideoIdentity",
      identity: { canonicalId: "7520000000000000000", kind: "tiktok" },
      videoUrl: "https://www.tiktok.com/@cook/video/7520000000000000000",
    });
  });

  it("classifies explicit photo posts without invoking availability", async () => {
    let calls = 0;
    const resolver = makeTikTokCanonicalSourceIdentityResolver(() => {
      calls += 1;
      throw new Error("unexpected fetch");
    });

    await expect(
      Effect.runPromise(
        resolver.resolve(
          source("https://www.tiktok.com/@cook/photo/7520000000000000000")
        )
      )
    ).resolves.toMatchObject({
      _tag: "UnsupportedIdentity",
      identity: { canonicalId: "7520000000000000000", kind: "tiktok" },
    });
    expect(calls).toBe(0);
  });

  it("preserves caller interruption while a redirect request is pending", async () => {
    const resolver = makeTikTokCanonicalSourceIdentityResolver(
      (_input, init) => {
        const pending = Promise.withResolvers<Response>();
        init?.signal?.addEventListener("abort", () => {
          pending.reject(new DOMException("aborted", "AbortError"));
        });
        return pending.promise;
      }
    );
    const exit = await Effect.runPromise(
      Effect.gen(function* exit() {
        const fiber = yield* Effect.forkChild(
          resolver.resolve(source("https://vm.tiktok.com/pending"))
        );
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      })
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected interruption");
    }
    expect(Option.isNone(Cause.findErrorOption(exit.cause))).toBe(true);
  });

  it.each([200, 400, 404, 429, 500])(
    "keeps an unresolved short-link status %s transient",
    async (status) => {
      let cancelled = false;
      const resolver = makeTikTokCanonicalSourceIdentityResolver(() =>
        resolvedResponse(
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: () => {
                cancelled = true;
              },
            }),
            { status }
          )
        )
      );

      const failure = await getFailure(
        resolver.resolve(source("https://vm.tiktok.com/unresolved"))
      );

      expect(failure._tag).toBe("SourceValidationUnavailable");
      expect(cancelled).toBe(true);
    }
  );
});

describe("TikTok availability validation", () => {
  const resolvedVideo = {
    identity: {
      canonicalId: Schema.decodeUnknownSync(SourceCanonicalId)(
        "7520000000000000000"
      ),
      kind: "tiktok" as const,
    },
    videoUrl: Schema.decodeUnknownSync(ValidatedVideoUrl)(
      "https://m.tiktok.com/@cook/video/7520000000000000000"
    ),
  };

  it("uses the resolver-validated ephemeral video URL without synthesizing one", async () => {
    let requested = "";
    const validator = makeTikTokSourceAvailabilityValidator((input) => {
      requested = String(input);
      return resolvedResponse(
        Response.json({
          html: '<blockquote data-video-id="7520000000000000000"></blockquote>',
          type: "video",
          version: "1.0",
        })
      );
    });

    await expect(
      Effect.runPromise(validator.validate(resolvedVideo))
    ).resolves.toEqual({ _tag: "Available" });
    expect(new URL(requested).searchParams.get("url")).toBe(
      resolvedVideo.videoUrl
    );
  });

  it.each([401, 404])(
    "conservatively classifies oEmbed %s as private or unavailable",
    async (status) => {
      const validator = makeTikTokSourceAvailabilityValidator(() =>
        resolvedResponse(new Response(null, { status }))
      );

      await expect(
        Effect.runPromise(validator.validate(resolvedVideo))
      ).resolves.toEqual({ _tag: "PrivateOrUnavailable" });
    }
  );

  it.each([400, 403, 410, 429, 500, 501])(
    "keeps ambiguous oEmbed %s transient",
    async (status) => {
      const validator = makeTikTokSourceAvailabilityValidator(() =>
        resolvedResponse(new Response(null, { status }))
      );
      const failure = await getFailure(validator.validate(resolvedVideo));

      expect(failure._tag).toBe("SourceValidationUnavailable");
    }
  );

  it("rejects an oEmbed redirect outside the constrained origin", async () => {
    const validator = makeTikTokSourceAvailabilityValidator(() =>
      resolvedResponse(
        new Response(null, {
          headers: { location: "https://evil.test/provider-body" },
          status: 302,
        })
      )
    );
    const failure = await getFailure(validator.validate(resolvedVideo));

    expect(failure._tag).toBe("SourceValidationUnavailable");
  });

  it("maps a malformed oEmbed redirect to the safe transient error", async () => {
    const validator = makeTikTokSourceAvailabilityValidator(() =>
      resolvedResponse(
        new Response(null, {
          headers: { location: "http://[" },
          status: 302,
        })
      )
    );
    const failure = await getFailure(validator.validate(resolvedVideo));

    expect(failure._tag).toBe("SourceValidationUnavailable");
  });

  it.each([302, 401, 500])(
    "cancels an unused oEmbed response body for status %s",
    async (status) => {
      let cancelled = false;
      const validator = makeTikTokSourceAvailabilityValidator(() =>
        resolvedResponse(
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: () => {
                cancelled = true;
              },
            }),
            {
              ...(status === 302
                ? { headers: { location: "https://evil.test/escaped" } }
                : {}),
              status,
            }
          )
        )
      );

      await Effect.runPromiseExit(validator.validate(resolvedVideo));

      expect(cancelled).toBe(true);
    }
  );

  it("cancels a chunked oEmbed body as soon as it exceeds the byte limit", async () => {
    let pulls = 0;
    let cancelled = false;
    const validator = makeTikTokSourceAvailabilityValidator(() =>
      resolvedResponse(
        new Response(
          new ReadableStream<Uint8Array>(
            {
              cancel: () => {
                cancelled = true;
              },
              pull: (controller) => {
                pulls += 1;
                if (pulls > 20) {
                  controller.close();
                  return;
                }
                controller.enqueue(new Uint8Array(4096));
              },
            },
            { highWaterMark: 0 }
          ),
          { status: 200 }
        )
      )
    );

    const failure = await getFailure(validator.validate(resolvedVideo));

    expect(failure._tag).toBe("SourceValidationUnavailable");
    expect(pulls).toBeLessThanOrEqual(17);
    expect(cancelled).toBe(true);
  });

  it("cancels a pending oEmbed body when the caller interrupts", async () => {
    let cancelled = false;
    const reading = Promise.withResolvers<boolean>();
    const validator = makeTikTokSourceAvailabilityValidator(() =>
      resolvedResponse(
        new Response(
          new ReadableStream<Uint8Array>({
            cancel: () => {
              cancelled = true;
            },
            pull: () => {
              reading.resolve(true);
            },
          }),
          { status: 200 }
        )
      )
    );

    const exit = await Effect.runPromise(
      Effect.gen(function* interruptBodyRead() {
        const fiber = yield* Effect.forkChild(
          validator.validate(resolvedVideo)
        );
        yield* Effect.promise(() => reading.promise);
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      })
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(cancelled).toBe(true);
  });

  it("rejects malformed and identity-mismatched success bodies", async () => {
    const bodies = [
      "not-json",
      JSON.stringify({ html: "<blockquote>different</blockquote>" }),
      JSON.stringify({
        html: "<blockquote>7520000000000000000</blockquote>",
        type: "video",
        version: "1.0",
      }),
    ];

    await Promise.all(
      bodies.map(async (body) => {
        const validator = makeTikTokSourceAvailabilityValidator(() =>
          resolvedResponse(new Response(body, { status: 200 }))
        );
        const failure = await getFailure(validator.validate(resolvedVideo));

        expect(failure._tag).toBe("SourceValidationUnavailable");
      })
    );
  });
});
