import { Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { browserObservedFetch } from "../observability/browser-observability.js";

/** A host supplies transport and origin; feature operations never read ambient location. */
export interface ApiRuntime {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
}

export const browserApiRuntime = (): ApiRuntime => ({
  baseUrl: window.location.origin,
  fetch: browserObservedFetch,
});

export const apiHttpLayer = (runtime: ApiRuntime) =>
  FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, runtime.fetch))
  );
