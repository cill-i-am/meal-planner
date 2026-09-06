import * as Cloudflare from "alchemy/Cloudflare";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Deferred, Effect, Exit, Fiber, Scope, Stream } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { describe, expect, it } from "vitest";

import { makeAcquisitionLifetime } from "./import-media-acquisition-lifetime.js";

const fixture = (
  beforeRead: (key: string) => Promise<void> = () => Promise.resolve()
) => {
  const values = new Map<string, boolean>();
  const events: string[] = [];
  let alarmAt: number | undefined;
  const state = Cloudflare.fromDurableObjectState({
    storage: {
      deleteAlarm: () => {
        alarmAt = undefined;
        return Promise.resolve();
      },
      get: async (key: string) => {
        await beforeRead(key);
        return values.get(key);
      },
      put: (key: string, value: boolean) => {
        values.set(key, value);
        return Promise.resolve();
      },
      setAlarm: (at: number) => {
        alarmAt = at;
        return Promise.resolve();
      },
    },
  } as never);
  const create = (
    destroy = Effect.sync(() => {
      events.push("destroy");
    })
  ) =>
    Effect.runPromise(
      makeAcquisitionLifetime({ destroy: () => destroy }, 30).pipe(
        Effect.provideService(Cloudflare.DurableObjectState, state),
        Effect.provide(RuntimeContext.phantom)
      )
    );
  return { alarmAt: () => alarmAt, create, events };
};

const streamingBody = (response: HttpServerResponse.HttpServerResponse) => {
  if (response.body._tag !== "Stream") {
    throw new Error("Expected a stream");
  }
  return response.body.stream;
};

describe("generation process lifetime", () => {
  it("drains an open artifact before destroy and rejects readers once draining", async () => {
    const test = fixture();
    const lifetime = await test.create();
    const reading = Deferred.makeUnsafe<boolean>();
    const finish = Deferred.makeUnsafe<boolean>();
    const response = await Effect.runPromise(
      lifetime.fetch(
        crypto.randomUUID(),
        Effect.succeed(
          HttpServerResponse.stream(
            Stream.make(new Uint8Array([1])).pipe(
              Stream.tap(() => Deferred.succeed(reading, true)),
              Stream.concat(
                Stream.fromEffect(
                  Deferred.await(finish).pipe(Effect.as(new Uint8Array([2])))
                )
              ),
              Stream.ensuring(
                Effect.sync(() => {
                  test.events.push("body-closed");
                })
              )
            )
          )
        )
      )
    );
    const reader = Effect.runFork(Stream.runCollect(streamingBody(response)));
    await Effect.runPromise(Deferred.await(reading));
    const cleanup = Effect.runFork(lifetime.cleanup);
    await Effect.runPromise(Effect.yieldNow);
    expect(test.events).toEqual([]);
    const denied = await Effect.runPromiseExit(
      lifetime.use(Effect.die("must not execute"))
    );
    expect(Exit.isFailure(denied)).toBe(true);
    await Effect.runPromise(Deferred.succeed(finish, true));
    const bytes = await Effect.runPromise(Fiber.join(reader));
    await Effect.runPromise(Fiber.join(cleanup));
    expect(bytes).toEqual([new Uint8Array([1]), new Uint8Array([2])]);
    expect(test.events).toEqual(["body-closed", "destroy"]);
    expect(test.alarmAt()).toBeUndefined();
  });

  it("closes a cancelled reader before retiring the process", async () => {
    const test = fixture();
    const lifetime = await test.create();
    const started = Deferred.makeUnsafe<boolean>();
    const response = await Effect.runPromise(
      lifetime.fetch(
        crypto.randomUUID(),
        Effect.succeed(
          HttpServerResponse.stream(
            Stream.fromEffect(
              Deferred.succeed(started, true).pipe(Effect.andThen(Effect.never))
            ).pipe(
              Stream.ensuring(
                Effect.sync(() => {
                  test.events.push("body-cancelled");
                })
              )
            )
          )
        )
      )
    );
    const reader = Effect.runFork(Stream.runDrain(streamingBody(response)));
    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(Fiber.interrupt(reader));
    await Effect.runPromise(lifetime.cleanup);
    expect(test.events).toEqual(["body-cancelled", "destroy"]);
  });

  it("cancels a hung operation on expiry and never permits replay after reconstruction", async () => {
    const test = fixture();
    const lifetime = await test.create();
    const started = Deferred.makeUnsafe<boolean>();
    const operation = Effect.runFork(
      lifetime.use(
        Deferred.succeed(started, true).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Effect.sync(() => {
              test.events.push("operation-cancelled");
            })
          )
        )
      )
    );
    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(Effect.sleep(40));
    await Effect.runPromise(lifetime.alarm);
    expect(
      Exit.isFailure(await Effect.runPromise(Fiber.await(operation)))
    ).toBe(true);
    expect(test.events).toEqual(["operation-cancelled", "destroy"]);
    const reconstructed = await test.create();
    const replay = await Effect.runPromiseExit(
      reconstructed.use(
        Effect.sync(() => {
          test.events.push("restarted");
        })
      )
    );
    expect(Exit.isFailure(replay)).toBe(true);
    await Effect.runPromise(reconstructed.cleanup);
    expect(test.events).toEqual(["operation-cancelled", "destroy", "destroy"]);
  });

  it("waits for fetch setup finalization before acknowledging close or destroying", async () => {
    const test = fixture();
    const lifetime = await test.create();
    const readerId = crypto.randomUUID();
    const setupStarted = Deferred.makeUnsafe<boolean>();
    const finalizerStarted = Deferred.makeUnsafe<boolean>();
    const finishFinalizer = Deferred.makeUnsafe<boolean>();
    const fetching = Effect.runFork(
      lifetime.fetch(
        readerId,
        Deferred.succeed(setupStarted, true).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Deferred.succeed(finalizerStarted, true).pipe(
              Effect.andThen(Deferred.await(finishFinalizer)),
              Effect.andThen(
                Effect.sync(() => test.events.push("setup-closed"))
              )
            )
          )
        )
      )
    );
    await Effect.runPromise(Deferred.await(setupStarted));
    const closing = Effect.runFork(
      lifetime
        .closeReader(readerId)
        .pipe(
          Effect.andThen(
            Effect.sync(() => test.events.push("close-acknowledged"))
          )
        )
    );
    await Effect.runPromise(Deferred.await(finalizerStarted));
    const cleanup = Effect.runFork(lifetime.cleanup);
    await Effect.runPromise(Effect.yieldNow);
    expect(test.events).toEqual([]);

    await Effect.runPromise(Deferred.succeed(finishFinalizer, true));
    await Effect.runPromise(Fiber.join(closing));
    expect(Exit.isFailure(await Effect.runPromise(Fiber.await(fetching)))).toBe(
      true
    );
    await Effect.runPromise(Fiber.join(cleanup));
    expect(test.events[0]).toBe("setup-closed");
    expect(test.events).toContain("close-acknowledged");
    expect(test.events).toContain("destroy");
  });

  it("releases admission interrupted while storage is pending without starting fetch", async () => {
    const readerId = crypto.randomUUID();
    const storageStarted = Deferred.makeUnsafe<boolean>();
    const finishStorage = Deferred.makeUnsafe<boolean>();
    const test = fixture(async (key) => {
      if (key === `closedReader:${readerId}`) {
        await Effect.runPromise(Deferred.succeed(storageStarted, true));
        await Effect.runPromise(Deferred.await(finishStorage));
      }
    });
    const lifetime = await test.create();
    const fetching = Effect.runFork(
      lifetime.fetch(
        readerId,
        Effect.sync(() => {
          test.events.push("fetch-started");
          return HttpServerResponse.empty();
        })
      )
    );
    await Effect.runPromise(Deferred.await(storageStarted));
    const interruption = Effect.runFork(Fiber.interrupt(fetching));
    await Effect.runPromise(Effect.yieldNow);
    await Effect.runPromise(Deferred.succeed(finishStorage, true));
    await Effect.runPromise(Fiber.join(interruption));
    await Effect.runPromise(lifetime.closeReader(readerId));
    await Effect.runPromise(lifetime.cleanup);
    expect(Exit.isFailure(await Effect.runPromise(Fiber.await(fetching)))).toBe(
      true
    );
    expect(test.events).toEqual(["destroy"]);
  });

  it("keeps a sibling reader leased when one reader closes", async () => {
    const test = fixture();
    const lifetime = await test.create();
    const openReader = async (index: number) => {
      const readerId = crypto.randomUUID();
      const started = Deferred.makeUnsafe<boolean>();
      const response = await Effect.runPromise(
        lifetime.fetch(
          readerId,
          Effect.succeed(
            HttpServerResponse.stream(
              Stream.fromEffect(
                Deferred.succeed(started, true).pipe(
                  Effect.andThen(Effect.never)
                )
              ).pipe(
                Stream.ensuring(
                  Effect.sync(() => {
                    test.events.push(`reader-${index}-closed`);
                  })
                )
              )
            )
          )
        )
      );
      const fiber = Effect.runFork(Stream.runDrain(streamingBody(response)));
      await Effect.runPromise(Deferred.await(started));
      return { fiber, readerId };
    };
    const [first, second] = await Promise.all([openReader(0), openReader(1)]);

    await Effect.runPromise(lifetime.closeReader(first.readerId));
    await Effect.runPromise(Fiber.await(first.fiber));
    const cleanup = Effect.runFork(lifetime.cleanup);
    await Effect.runPromise(Effect.yieldNow);
    expect(test.events).toEqual(["reader-0-closed"]);

    await Effect.runPromise(lifetime.closeReader(second.readerId));
    await Effect.runPromise(Fiber.await(second.fiber));
    await Effect.runPromise(Fiber.join(cleanup));
    expect(test.events).toEqual([
      "reader-0-closed",
      "reader-1-closed",
      "destroy",
    ]);
  });

  it("persists a close before fetch across lifetime reconstruction", async () => {
    const test = fixture();
    const readerId = crypto.randomUUID();
    const lifetime = await test.create();
    await Effect.runPromise(lifetime.closeReader(readerId));

    const reconstructed = await test.create();
    const lateFetch = await Effect.runPromiseExit(
      reconstructed.fetch(
        readerId,
        Effect.sync(() => {
          test.events.push("late-fetch-started");
          return HttpServerResponse.empty();
        })
      )
    );
    expect(Exit.isFailure(lateFetch)).toBe(true);
    await Effect.runPromise(reconstructed.cleanup);
    expect(test.events).toEqual(["destroy"]);
  });

  it.each(["paused", "reading"] as const)(
    "waits for a %s source finalizer before acknowledging explicit close",
    async (readState) => {
      const test = fixture();
      const lifetime = await test.create();
      const readerId = crypto.randomUUID();
      const readingStarted = Deferred.makeUnsafe<boolean>();
      const finalizerStarted = Deferred.makeUnsafe<boolean>();
      const finishFinalizer = Deferred.makeUnsafe<boolean>();
      const response = await Effect.runPromise(
        lifetime.fetch(
          readerId,
          Effect.succeed(
            HttpServerResponse.stream(
              Stream.make(new Uint8Array([1])).pipe(
                Stream.concat(
                  Stream.fromEffect(
                    Deferred.succeed(readingStarted, true).pipe(
                      Effect.andThen(Effect.never)
                    )
                  )
                ),
                Stream.ensuring(
                  Deferred.succeed(finalizerStarted, true).pipe(
                    Effect.andThen(Deferred.await(finishFinalizer)),
                    Effect.andThen(
                      Effect.sync(() => test.events.push("source-closed"))
                    )
                  )
                )
              )
            )
          )
        )
      );
      const consumerScope = await Effect.runPromise(Scope.make());
      const pull = await Effect.runPromise(
        Stream.toPull(streamingBody(response)).pipe(
          Effect.provideService(Scope.Scope, consumerScope)
        )
      );
      await Effect.runPromise(pull);
      const reading =
        readState === "reading" ? Effect.runFork(pull) : undefined;
      if (reading !== undefined) {
        await Effect.runPromise(Deferred.await(readingStarted));
      }
      const closing = Effect.runFork(
        lifetime
          .closeReader(readerId)
          .pipe(
            Effect.andThen(
              Effect.sync(() => test.events.push("close-acknowledged"))
            )
          )
      );
      await Effect.runPromise(Deferred.await(finalizerStarted));
      const cleanup = Effect.runFork(lifetime.cleanup);
      await Effect.runPromise(Effect.yieldNow);
      expect(test.events).toEqual([]);
      await Effect.runPromise(Deferred.succeed(finishFinalizer, true));
      await Effect.runPromise(Fiber.join(closing));
      await Effect.runPromise(Fiber.join(cleanup));
      if (reading !== undefined) {
        await Effect.runPromise(Fiber.await(reading));
      }
      await Effect.runPromise(Scope.close(consumerScope, Exit.void));
      expect(test.events[0]).toBe("source-closed");
      expect(test.events).toContain("close-acknowledged");
      expect(test.events).toContain("destroy");
    }
  );

  it.each(["source", "setup"] as const)(
    "destroys within the terminal grace period even when a %s finalizer cannot settle",
    async (blockedPhase) => {
      const test = fixture();
      const lifetime = await test.create();
      const started = Deferred.makeUnsafe<boolean>();
      const finalizerStarted = Deferred.makeUnsafe<boolean>();
      const finishFinalizer = Deferred.makeUnsafe<boolean>();
      const finalizer = Deferred.succeed(finalizerStarted, true).pipe(
        Effect.andThen(Deferred.await(finishFinalizer)),
        Effect.andThen(
          Effect.sync(() => test.events.push("finalizer-finished"))
        )
      );
      const blocked = Deferred.succeed(started, true).pipe(
        Effect.andThen(Effect.never)
      );
      const readerId = crypto.randomUUID();
      let finishOperation: Effect.Effect<void>;
      if (blockedPhase === "setup") {
        const operation = Effect.runFork(
          lifetime.fetch(readerId, blocked.pipe(Effect.ensuring(finalizer)))
        );
        finishOperation = Fiber.await(operation).pipe(Effect.asVoid);
      } else {
        const response = await Effect.runPromise(
          lifetime.fetch(
            readerId,
            Effect.succeed(
              HttpServerResponse.stream(
                Stream.make(new Uint8Array([1])).pipe(
                  Stream.tap(() => Deferred.succeed(started, true)),
                  Stream.concat(Stream.never),
                  Stream.ensuring(finalizer)
                )
              )
            )
          )
        );
        const consumerScope = await Effect.runPromise(Scope.make());
        const pull = await Effect.runPromise(
          Stream.toPull(streamingBody(response)).pipe(
            Effect.provideService(Scope.Scope, consumerScope)
          )
        );
        await Effect.runPromise(pull);
        finishOperation = Scope.close(consumerScope, Exit.void);
      }
      await Effect.runPromise(Deferred.await(started));
      await Effect.runPromise(Effect.sleep(40));
      const alarmStarted = Date.now();
      const alarm = Effect.runFork(lifetime.alarm);
      await Effect.runPromise(Deferred.await(finalizerStarted));
      await Effect.runPromise(Fiber.join(alarm).pipe(Effect.timeout(2500)));
      const elapsed = Date.now() - alarmStarted;
      if (blockedPhase === "setup") {
        expect(elapsed).toBeGreaterThanOrEqual(900);
      }
      expect(elapsed).toBeLessThan(2500);
      expect(test.events).toEqual(["destroy"]);
      expect(test.alarmAt()).toBeUndefined();

      await Effect.runPromise(Deferred.succeed(finishFinalizer, true));
      await Effect.runPromise(finishOperation);
      expect(test.events).toEqual(["destroy", "finalizer-finished"]);
    }
  );

  it("keeps retirement and the fallback alarm when destroy fails", async () => {
    const test = fixture();
    let destroys = 0;
    const lifetime = await test.create(
      Effect.suspend(() => {
        destroys += 1;
        return destroys === 1 ? Effect.die("destroy failed") : Effect.void;
      })
    );
    await Effect.runPromise(lifetime.use(Effect.void));
    expect(Exit.isFailure(await Effect.runPromiseExit(lifetime.cleanup))).toBe(
      true
    );
    expect(test.alarmAt()).toBeDefined();
    expect(
      Exit.isFailure(await Effect.runPromiseExit(lifetime.use(Effect.void)))
    ).toBe(true);
    await Effect.runPromise(lifetime.alarm);
    expect(destroys).toBe(2);
    expect(test.alarmAt()).toBeUndefined();
  });

  it("releases failed RPC and failed response construction without blocking destroy", async () => {
    const test = fixture();
    const lifetime = await test.create();
    await Effect.runPromiseExit(lifetime.use(Effect.fail("RPC failed")));
    await Effect.runPromiseExit(
      lifetime.fetch(crypto.randomUUID(), Effect.fail("fetch failed"))
    );
    await Effect.runPromise(lifetime.cleanup);
    expect(test.events).toEqual(["destroy"]);
  });
});
