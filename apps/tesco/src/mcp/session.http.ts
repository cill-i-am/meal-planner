import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

/** Preserve repeated Set-Cookie fields through Effect's string-valued Headers boundary. */
export const TescoSessionHttpLive = Layer.unwrap(
  Effect.gen(function* cookiePreservingHttpClient() {
    const fetch = yield* FetchHttpClient.Fetch;
    const preserveCookies: typeof globalThis.fetch = async (input, init) => {
      const response = await fetch(input, init);
      const cookies = response.headers.getSetCookie();
      if (cookies.length < 2) {
        return response;
      }
      const headers = new Headers(response.headers);

      headers.set("set-cookie", cookies.join(", "));
      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    };
    return FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, preserveCookies)),
      Layer.provide(
        Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })
      )
    );
  })
);
