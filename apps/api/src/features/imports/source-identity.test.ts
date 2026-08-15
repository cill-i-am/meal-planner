import { Cause, Effect, Exit, Fiber, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import { SourceDescriptor } from "./import.contracts.js";
import type { SourceIdentityError } from "./import.errors.js";
import { makeTikTokCanonicalSourceIdentityResolver } from "./source-identity.tiktok.js";

const source = (url: string) =>
  Schema.decodeUnknownSync(SourceDescriptor)({ kind: "tiktok", url });

const resolvedResponse = (response: Response): Promise<Response> =>
  Promise.resolve(response);

const hydrationScript = (canonical: string): string =>
  `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(
    {
      __DEFAULT_SCOPE__: {
        "seo.abtest": { canonical },
      },
    }
  )}</script>`;

const hydrationResponse = (canonical: string): Response =>
  new Response(
    `<!doctype html><html><body>${hydrationScript(canonical)}</body></html>`,
    {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 200,
    }
  );

const getFailure = async <A>(effect: Effect.Effect<A, SourceIdentityError>) => {
  const exit = await Effect.runPromiseExit(effect);

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected failure");
  }
  return Option.getOrThrow(Cause.findErrorOption(exit.cause));
};

const getFailureWithin = async <A>(
  effect: Effect.Effect<A, SourceIdentityError>
) => {
  const deadline = Promise.withResolvers<never>();
  const timeout = setTimeout(() => {
    deadline.reject(new Error("Expected a finite source-identity failure"));
  }, 250);

  try {
    return await Promise.race([getFailure(effect), deadline.promise]);
  } finally {
    clearTimeout(timeout);
  }
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

  it("resolves a TikTok-owned HTML handoff through the exact hydration schema", async () => {
    const seen: string[] = [];
    const resolver = makeTikTokCanonicalSourceIdentityResolver((input) => {
      seen.push(String(input));
      return resolvedResponse(
        seen.length === 1
          ? new Response(null, {
              headers: {
                location: "https://www.tiktok.com/t/Zsynthetic",
              },
              status: 302,
            })
          : hydrationResponse(
              "https://www.tiktok.com/@cook/video/7520000000000000000"
            )
      );
    });

    await expect(
      Effect.runPromise(
        resolver.resolve(source("https://vm.tiktok.com/abc123"))
      )
    ).resolves.toMatchObject({
      _tag: "VideoIdentity",
      identity: { canonicalId: "7520000000000000000", kind: "tiktok" },
      videoUrl: "https://www.tiktok.com/@cook/video/7520000000000000000",
    });
    expect(seen).toEqual([
      "https://vm.tiktok.com/abc123",
      "https://www.tiktok.com/t/Zsynthetic",
    ]);
  });

  it("does not trust a hydration script inside a self-closing template element", async () => {
    const script = hydrationScript(
      "https://www.tiktok.com/@cook/video/7520000000000000000"
    );
    const resolver = makeTikTokCanonicalSourceIdentityResolver((input) =>
      resolvedResponse(
        String(input).includes("vm.tiktok.com")
          ? new Response(null, {
              headers: {
                location: "https://www.tiktok.com/t/Zsynthetic",
              },
              status: 302,
            })
          : new Response(`<template/>${script}</template>`, {
              headers: { "content-type": "text/html; charset=utf-8" },
              status: 200,
            })
      )
    );

    const failure = await getFailure(
      resolver.resolve(source("https://vm.tiktok.com/abc123"))
    );

    expect(failure._tag).toBe("SourceIdentityUnavailable");
  });

  it.each([
    ["SVG", "svg"],
    ["MathML", "math"],
  ])(
    "does not trust an exact hydration script in the %s namespace",
    async (_label, container) => {
      const script = hydrationScript(
        "https://www.tiktok.com/@cook/video/7520000000000000000"
      );
      const resolver = makeTikTokCanonicalSourceIdentityResolver((input) =>
        resolvedResponse(
          String(input).includes("vm.tiktok.com")
            ? new Response(null, {
                headers: {
                  location: "https://www.tiktok.com/t/Zsynthetic",
                },
                status: 302,
              })
            : new Response(`<${container}>${script}</${container}>`, {
                headers: { "content-type": "text/html; charset=utf-8" },
                status: 200,
              })
        )
      );

      const failure = await getFailure(
        resolver.resolve(source("https://vm.tiktok.com/abc123"))
      );

      expect(failure._tag).toBe("SourceIdentityUnavailable");
    }
  );

  it.each([
    ["comment", (script: string) => `<!-- ${script} -->`],
    ["raw-text style element", (script: string) => `<style>${script}</style>`],
    ["textarea element", (script: string) => `<textarea>${script}</textarea>`],
    ["template element", (script: string) => `<template>${script}</template>`],
    ["unclosed comment", (script: string) => `<!-- ${script}`],
    ["unclosed raw-text element", (script: string) => `<style>${script}`],
    ["unclosed textarea element", (script: string) => `<textarea>${script}`],
    [
      "quoted attribute value",
      (script: string) => `<div data-value='${script}'></div>`,
    ],
    [
      "unclosed quoted attribute value",
      (script: string) => `<div data-value='${script}`,
    ],
  ])("does not trust hydration text inside a %s", async (_label, wrap) => {
    const script = hydrationScript(
      "https://www.tiktok.com/@cook/video/7520000000000000000"
    );
    const resolver = makeTikTokCanonicalSourceIdentityResolver((input) =>
      resolvedResponse(
        String(input).includes("vm.tiktok.com")
          ? new Response(null, {
              headers: {
                location: "https://www.tiktok.com/t/Zsynthetic",
              },
              status: 302,
            })
          : new Response(wrap(script), {
              headers: { "content-type": "text/html; charset=utf-8" },
              status: 200,
            })
      )
    );

    const failure = await getFailure(
      resolver.resolve(source("https://vm.tiktok.com/abc123"))
    );

    expect(failure._tag).toBe("SourceIdentityUnavailable");
  });

  it("classifies a photo HTML handoff as typed unsupported", async () => {
    const resolver = makeTikTokCanonicalSourceIdentityResolver((input) =>
      resolvedResponse(
        String(input).includes("vm.tiktok.com")
          ? new Response(null, {
              headers: {
                location: "https://www.tiktok.com/t/Zsynthetic",
              },
              status: 302,
            })
          : hydrationResponse(
              "https://www.tiktok.com/@cook/photo/7520000000000000000"
            )
      )
    );

    await expect(
      Effect.runPromise(
        resolver.resolve(source("https://vm.tiktok.com/abc123"))
      )
    ).resolves.toMatchObject({
      _tag: "UnsupportedIdentity",
      identity: { canonicalId: "7520000000000000000", kind: "tiktok" },
    });
  });

  it.each(["photo", "photos"])(
    "classifies an empty-placeholder %s HTML handoff as typed unsupported",
    async (pathSegment) => {
      const resolver = makeTikTokCanonicalSourceIdentityResolver((input) =>
        resolvedResponse(
          String(input).includes("vm.tiktok.com")
            ? new Response(null, {
                headers: {
                  location: "https://www.tiktok.com/t/Zsynthetic",
                },
                status: 302,
              })
            : hydrationResponse(
                `https://www.tiktok.com/@/${pathSegment}/7520000000000000000`
              )
        )
      );

      await expect(
        Effect.runPromise(
          resolver.resolve(source("https://vm.tiktok.com/placeholder-photo"))
        )
      ).resolves.toMatchObject({
        _tag: "UnsupportedIdentity",
        identity: { canonicalId: "7520000000000000000", kind: "tiktok" },
      });
    }
  );

  it.each([
    [
      "empty-placeholder video",
      "https://www.tiktok.com/@/video/7520000000000000000",
    ],
    [
      "non-numeric placeholder photo",
      "https://www.tiktok.com/@/photo/not-numeric",
    ],
    ["missing placeholder photo identity", "https://www.tiktok.com/@/photo/"],
  ])("keeps a %s HTML handoff transient", async (_label, canonical) => {
    let fetchCalls = 0;
    const resolver = makeTikTokCanonicalSourceIdentityResolver(() => {
      fetchCalls += 1;
      return resolvedResponse(
        fetchCalls === 1
          ? new Response(null, {
              headers: {
                location: "https://www.tiktok.com/t/Zsynthetic",
              },
              status: 302,
            })
          : hydrationResponse(canonical)
      );
    });

    const failure = await getFailure(
      resolver.resolve(source("https://vm.tiktok.com/invalid-placeholder"))
    );

    expect(failure._tag).toBe("SourceIdentityUnavailable");
    expect(fetchCalls).toBe(2);
  });

  it("rejects unsafe canonical metadata from a TikTok-owned HTML handoff", async () => {
    const resolver = makeTikTokCanonicalSourceIdentityResolver((input) =>
      resolvedResponse(
        String(input).includes("vm.tiktok.com")
          ? new Response(null, {
              headers: {
                location: "https://www.tiktok.com/t/Zsynthetic",
              },
              status: 302,
            })
          : hydrationResponse(
              "https://www.tiktok.com.evil.test/@cook/video/7520000000000000000"
            )
      )
    );

    const failure = await getFailure(
      resolver.resolve(source("https://vm.tiktok.com/abc123"))
    );

    expect(failure._tag).toBe("InvalidSource");
  });

  it.each([
    ["missing hydration", "<!doctype html><html></html>"],
    [
      "malformed hydration",
      '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{</script>',
    ],
    [
      "wrong schema",
      '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{"__DEFAULT_SCOPE__":{}}</script>',
    ],
  ])("keeps a %s HTML handoff transient", async (_label, body) => {
    const resolver = makeTikTokCanonicalSourceIdentityResolver((input) =>
      resolvedResponse(
        String(input).includes("vm.tiktok.com")
          ? new Response(null, {
              headers: {
                location: "https://www.tiktok.com/t/Zsynthetic",
              },
              status: 302,
            })
          : new Response(body, {
              headers: { "content-type": "text/html; charset=utf-8" },
              status: 200,
            })
      )
    );

    const failure = await getFailure(
      resolver.resolve(source("https://vm.tiktok.com/abc123"))
    );

    expect(failure._tag).toBe("SourceIdentityUnavailable");
  });

  it("bounds HTML handoff reads before parsing metadata", async () => {
    let cancelled = false;
    const resolver = makeTikTokCanonicalSourceIdentityResolver((input) =>
      resolvedResponse(
        String(input).includes("vm.tiktok.com")
          ? new Response(null, {
              headers: {
                location: "https://www.tiktok.com/t/Zsynthetic",
              },
              status: 302,
            })
          : new Response(
              new ReadableStream<Uint8Array>({
                cancel: () => {
                  cancelled = true;
                },
                start: (controller) => {
                  controller.enqueue(new Uint8Array(512 * 1024));
                  controller.enqueue(new Uint8Array([1]));
                },
              }),
              {
                headers: { "content-type": "text/html; charset=utf-8" },
                status: 200,
              }
            )
      )
    );

    const failure = await getFailure(
      resolver.resolve(source("https://vm.tiktok.com/abc123"))
    );

    expect(failure._tag).toBe("SourceIdentityUnavailable");
    expect(cancelled).toBe(true);
  });

  it.each(["declared", "streamed"])(
    "returns a finite typed failure when %s oversize-body cancellation never settles",
    async (oversizePath) => {
      let cancelCalls = 0;
      const neverSettlingCancellation = Promise.withResolvers<undefined>();
      const resolver = makeTikTokCanonicalSourceIdentityResolver((input) => {
        if (String(input).includes("vm.tiktok.com")) {
          return resolvedResponse(
            new Response(null, {
              headers: {
                location: "https://www.tiktok.com/t/Zsynthetic",
              },
              status: 302,
            })
          );
        }

        return resolvedResponse(
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: () => {
                cancelCalls += 1;
                return neverSettlingCancellation.promise;
              },
              ...(oversizePath === "streamed"
                ? {
                    start: (
                      controller: ReadableStreamDefaultController<Uint8Array>
                    ) => {
                      controller.enqueue(new Uint8Array(512 * 1024));
                      controller.enqueue(new Uint8Array([1]));
                    },
                  }
                : {}),
            }),
            {
              headers: {
                "content-length":
                  oversizePath === "declared" ? String(512 * 1024 + 1) : "0",
                "content-type": "text/html; charset=utf-8",
              },
              status: 200,
            }
          )
        );
      });

      const failure = await getFailureWithin(
        resolver.resolve(source("https://vm.tiktok.com/abc123"))
      );

      expect(failure._tag).toBe("SourceIdentityUnavailable");
      expect(cancelCalls).toBe(1);
    }
  );

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

  it("times out and aborts a pending redirect request with a typed failure", async () => {
    let aborted = false;
    const started = Promise.withResolvers<boolean>();
    const resolver = makeTikTokCanonicalSourceIdentityResolver(
      (_input, init) => {
        const pending = Promise.withResolvers<Response>();
        started.resolve(true);
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            pending.reject(new DOMException("aborted", "AbortError"));
          },
          { once: true }
        );
        return pending.promise;
      },
      { deadlineMilliseconds: 100 }
    );
    const exit = await Effect.runPromise(
      Effect.gen(function* timeoutRedirect() {
        const fiber = yield* Effect.forkChild(
          resolver.resolve(source("https://vm.tiktok.com/pending"))
        );
        yield* Effect.promise(() => started.promise);
        yield* TestClock.adjust("100 millis");
        return yield* Fiber.await(fiber);
      }).pipe(Effect.provide(TestClock.layer({ warningDelay: "10 seconds" })))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected identity timeout");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
      _tag: "SourceIdentityUnavailable",
    });
    expect(aborted).toBe(true);
  }, 1000);

  it("preserves caller interruption while a handoff body is pending", async () => {
    let cancelled = false;
    let calls = 0;
    const resolver = makeTikTokCanonicalSourceIdentityResolver(() => {
      calls += 1;
      if (calls === 1) {
        return resolvedResponse(
          new Response(null, {
            headers: {
              location: "https://www.tiktok.com/t/Zsynthetic",
            },
            status: 302,
          })
        );
      }
      const pendingPull = Promise.withResolvers<boolean>();
      return resolvedResponse(
        new Response(
          new ReadableStream<Uint8Array>({
            cancel: () => {
              cancelled = true;
              pendingPull.resolve(true);
            },
            pull: async () => {
              await pendingPull.promise;
            },
          }),
          {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 200,
          }
        )
      );
    });
    const exit = await Effect.runPromise(
      Effect.gen(function* exit() {
        const fiber = yield* Effect.forkChild(
          resolver.resolve(source("https://vm.tiktok.com/pending"))
        );
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      })
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(cancelled).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected interruption");
    }
    expect(Option.isNone(Cause.findErrorOption(exit.cause))).toBe(true);
  });

  it.each([400, 404, 429, 500])(
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

      expect(failure._tag).toBe("SourceIdentityUnavailable");
      expect(cancelled).toBe(true);
    }
  );

  it("classifies short-link transport rejection as identity unavailable", async () => {
    const resolver = makeTikTokCanonicalSourceIdentityResolver(() =>
      Promise.reject(new Error("private provider fragment"))
    );

    const failure = await getFailure(
      resolver.resolve(source("https://vm.tiktok.com/unresolved"))
    );

    expect(failure._tag).toBe("SourceIdentityUnavailable");
  });
});
