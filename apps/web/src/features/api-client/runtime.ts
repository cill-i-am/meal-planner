import { Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

/** A host supplies transport and origin; feature operations never read ambient location. */
export interface ApiRuntime {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
}

export const browserApiRuntime = (): ApiRuntime => ({
  baseUrl: window.location.origin,
  fetch: (input, init) => globalThis.fetch(input, init),
});

export const apiHttpLayer = (runtime: ApiRuntime) =>
  FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, runtime.fetch))
  );
