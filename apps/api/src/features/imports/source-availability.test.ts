import { Cause, Effect, Exit, Fiber, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import { SourceCanonicalId } from "./import.contracts.js";
import type { SourceAvailabilityError } from "./import.errors.js";
import { sourceValidationUnavailable } from "./import.errors.js";
import { makeTikTokSourceAvailabilityValidator } from "./source-availability.tiktok.js";
import { ValidatedVideoUrl } from "./source-identity.js";

const resolvedResponse = (response: Response): Promise<Response> =>
  Promise.resolve(response);

const getFailure = async <A>(
  effect: Effect.Effect<A, SourceAvailabilityError>
) => {
  const exit = await Effect.runPromiseExit(effect);

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected failure");
  }
  return Option.getOrThrow(Cause.findErrorOption(exit.cause));
};

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

  it.each([301, 302, 307, 308])(
    "classifies oEmbed %s as transient without following it",
    async (status) => {
      let calls = 0;
      const validator = makeTikTokSourceAvailabilityValidator(
        (_input, init) => {
          calls += 1;
          expect(init?.redirect).toBe("manual");
          return resolvedResponse(
            new Response(null, {
              headers: {
                location: "https://www.tiktok.com/oembed?redirected=true",
              },
              status,
            })
          );
        }
      );

      const failure = await getFailure(validator.validate(resolvedVideo));

      expect(failure._tag).toBe("SourceValidationUnavailable");
      expect(calls).toBe(1);
    }
  );

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
            { status }
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

  it("does not let a never-settling reader cancellation defeat the deadline", async () => {
    let cancelRequested = false;
    const reading = Promise.withResolvers<boolean>();
    const pendingRead = Promise.withResolvers<undefined>();
    const pendingCancel = Promise.withResolvers<undefined>();
    const validator = makeTikTokSourceAvailabilityValidator(() =>
      resolvedResponse(
        new Response(
          new ReadableStream<Uint8Array>({
            cancel: () => {
              cancelRequested = true;
              return pendingCancel.promise;
            },
            pull: () => {
              reading.resolve(true);
              return pendingRead.promise;
            },
          }),
          { status: 200 }
        )
      )
    );
    const exit = await Effect.runPromise(
      Effect.gen(function* deadline() {
        const fiber = yield* Effect.forkChild(
          validator.validate(resolvedVideo).pipe(
            Effect.timeoutOrElse({
              duration: "100 millis",
              orElse: () => Effect.fail(sourceValidationUnavailable()),
            })
          )
        );
        yield* Effect.promise(() => reading.promise);
        yield* TestClock.adjust("100 millis");
        return yield* Fiber.await(fiber);
      }).pipe(Effect.provide(TestClock.layer({ warningDelay: "10 seconds" })))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected availability timeout");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
      _tag: "SourceValidationUnavailable",
    });
    expect(cancelRequested).toBe(true);
  }, 1000);

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
