import * as Cloudflare from "alchemy/Cloudflare";
import { Cause, Effect } from "effect";
import { ClientAbort } from "effect/unstable/http/HttpServerError";

/** Minimal AbortSignal capability needed by the Worker request boundary. */
export interface RequestCancellationSignal {
  readonly aborted: boolean;
  readonly addEventListener: (
    type: "abort",
    listener: () => void,
    options: { readonly once: true }
  ) => void;
  readonly removeEventListener: (type: "abort", listener: () => void) => void;
}

const clientAbort = Effect.withFiber((fiber) =>
  Effect.failCause(
    Cause.annotate(Cause.interrupt(fiber.id), ClientAbort.annotation)
  )
);

/** Interrupts request work when the original caller-owned signal aborts. */
export const raceWithRequestSignal = <A, E, R>(
  signal: RequestCancellationSignal,
  requestEffect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    if (signal.aborted) {
      return clientAbort;
    }

    const requestAborted = Effect.callback<never>((resume) => {
      if (signal.aborted) {
        resume(clientAbort);
        return;
      }

      let removed = false;
      const onAbort = () => {
        if (removed) {
          return;
        }
        removed = true;
        signal.removeEventListener("abort", onAbort);
        resume(clientAbort);
      };
      const removeListener = () => {
        if (removed) {
          return;
        }
        removed = true;
        signal.removeEventListener("abort", onAbort);
      };

      signal.addEventListener("abort", onAbort, { once: true });
      return Effect.sync(removeListener);
    });

    return Effect.raceFirst(requestEffect, requestAborted);
  });

/** Runs request work against the original Request supplied by Alchemy. */
export const withCurrentRequestCancellation = <A, E, R>(
  requestEffect: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* currentRequestCancellation() {
    const request = yield* Cloudflare.Request;
    return yield* raceWithRequestSignal(request.signal, requestEffect);
  });
