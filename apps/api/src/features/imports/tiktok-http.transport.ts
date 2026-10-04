import { Duration, Effect } from "effect";

export type TikTokFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface TikTokHttpPolicyOptions {
  readonly deadlineMilliseconds?: number;
}

export type TikTokTransportFailure =
  | { readonly _tag: "TikTokTransportInvalidTarget" }
  | { readonly _tag: "TikTokTransportUnavailable" };

type TikTokHandoff =
  | { readonly _tag: "CanonicalLocation"; readonly url: URL }
  | { readonly _tag: "HandoffHtml"; readonly body: string };

const DefaultDeadlineMilliseconds = 5000;
const MaximumHandoffBodyBytes = 512 * 1024;
const MaximumRedirects = 5;

const allowedTikTokHosts = new Set([
  "m.tiktok.com",
  "tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "www.tiktok.com",
]);

const unavailable = (): TikTokTransportFailure => ({
  _tag: "TikTokTransportUnavailable",
});

const invalidTarget = (): TikTokTransportFailure => ({
  _tag: "TikTokTransportInvalidTarget",
});

const finiteDeadline = (override: number | undefined) => {
  const duration = override ?? DefaultDeadlineMilliseconds;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("TikTok HTTP deadline must be a positive finite duration");
  }
  return duration;
};

export const parseTikTokHttpUrl = (input: string): URL | undefined => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  return url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    allowedTikTokHosts.has(url.hostname)
    ? url
    : undefined;
};

export const isTikTokShortLink = (url: URL) =>
  url.hostname === "vm.tiktok.com" || url.hostname === "vt.tiktok.com";

const resolveRedirect = (location: string, current: URL): URL | null => {
  try {
    return parseTikTokHttpUrl(new URL(location, current).toString()) ?? null;
  } catch {
    return null;
  }
};

const isCanonicalPostUrl = (url: URL) =>
  /^\/@[^/]+\/video\/\d+\/?$/u.test(url.pathname) ||
  /^\/@[^/]*\/(?:photo|photos)\/\d+\/?$/u.test(url.pathname);

const ignoreCancellation = async (cancellation: Promise<unknown>) => {
  try {
    await cancellation;
  } catch {
    // Best-effort cleanup failures remain private.
  }
};

const cancelBestEffort = (cancel: () => Promise<unknown>) => {
  try {
    void ignoreCancellation(cancel());
  } catch {
    // Cleanup must remain finite even when a stream implementation throws.
  }
};

const cancelResponseBody = (response: Response) =>
  Effect.sync(() => {
    const { body } = response;
    if (body !== null) {
      cancelBestEffort(() => body.cancel());
    }
  });

const cancelReader = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Effect.sync(() => {
    cancelBestEffort(() => reader.cancel());
  });

const readChunk = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Effect.tryPromise({
    catch: unavailable,
    try: () => reader.read(),
  });

const readBoundedBody = (response: Response, maximumBytes: number) => {
  const { body } = response;
  if (body === null) {
    return Effect.fail(unavailable());
  }

  return Effect.acquireUseRelease(
    Effect.sync(() => body.getReader()),
    (reader) =>
      Effect.gen(function* readBoundedResponseBody() {
        const contentLength = response.headers.get("content-length");
        if (
          contentLength !== null &&
          (!/^\d+$/u.test(contentLength) ||
            Number(contentLength) > maximumBytes)
        ) {
          return yield* Effect.fail(unavailable());
        }

        const decoder = new TextDecoder();
        let bytesRead = 0;
        let text = "";
        while (true) {
          const chunk = yield* readChunk(reader);
          if (chunk.done) {
            return text + decoder.decode();
          }
          bytesRead += chunk.value.byteLength;
          if (bytesRead > maximumBytes) {
            return yield* Effect.fail(unavailable());
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
      }),
    cancelReader
  );
};

const fetchManual = (fetcher: TikTokFetcher, input: URL) =>
  Effect.tryPromise({
    catch: unavailable,
    try: (signal) =>
      fetcher(input, { method: "GET", redirect: "manual", signal }),
  });

const withDeadline = <A>(
  effect: Effect.Effect<A, TikTokTransportFailure>,
  deadlineMilliseconds: number
) =>
  Effect.timeoutOrElse(effect, {
    duration: Duration.millis(deadlineMilliseconds),
    orElse: () => Effect.fail(unavailable()),
  });

export const makeTikTokHttpTransport = (
  fetcher: TikTokFetcher,
  options: TikTokHttpPolicyOptions = {}
) => {
  const deadlineMilliseconds = finiteDeadline(options.deadlineMilliseconds);

  const resolveHandoff = Effect.fn("TikTokHttpTransport.resolveHandoff")(
    function* resolveHandoff(initial: URL) {
      const parsedInitial = parseTikTokHttpUrl(initial.toString());
      if (parsedInitial === undefined) {
        return yield* Effect.fail(invalidTarget());
      }
      let current: URL = parsedInitial;

      for (let hop = 0; hop < MaximumRedirects; hop += 1) {
        const response: Response = yield* fetchManual(fetcher, current);
        if (response.status === 200) {
          const contentType = response.headers.get("content-type");
          if (
            contentType === null ||
            !/^text\/html(?:\s*;|$)/iu.test(contentType)
          ) {
            yield* cancelResponseBody(response);
            return yield* Effect.fail(unavailable());
          }
          return {
            _tag: "HandoffHtml" as const,
            body: yield* readBoundedBody(response, MaximumHandoffBodyBytes),
          };
        }
        if (response.status < 300 || response.status >= 400) {
          yield* cancelResponseBody(response);
          return yield* Effect.fail(unavailable());
        }

        yield* cancelResponseBody(response);
        const location: string | null = response.headers.get("location");
        const next =
          location === null ? null : resolveRedirect(location, current);
        if (next === null) {
          return yield* Effect.fail(invalidTarget());
        }
        current = next;
        if (isCanonicalPostUrl(current)) {
          return { _tag: "CanonicalLocation" as const, url: next };
        }
      }
      return yield* Effect.fail(unavailable());
    }
  );

  return {
    resolveHandoff: (
      initial: URL
    ): Effect.Effect<TikTokHandoff, TikTokTransportFailure> =>
      withDeadline(resolveHandoff(initial), deadlineMilliseconds),
  };
};
