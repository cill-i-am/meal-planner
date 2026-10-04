import {
  BrowserEvent,
  BrowserObservabilityApi,
  BrowserTelemetryPath,
} from "@meal-planner/browser-observability-api";
import type { BrowserArea } from "@meal-planner/browser-observability-api";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

export const browserArea = (pathname: string): BrowserArea => {
  const [, first] = pathname.split("/");
  if (!first) {
    return "home";
  }
  if (
    [
      "login",
      "signup",
      "forgot-password",
      "reset-password",
      "verify-email",
    ].includes(first)
  ) {
    return "auth";
  }
  if (first === "setup") {
    return "setup";
  }
  if (["recipes", "imports", "recipe-bank"].includes(first)) {
    return "recipes";
  }
  if (["profile", "people", "family"].includes(first)) {
    return "profile";
  }
  return "other";
};

/** Deliberately classify exceptions without reading messages, stacks or rejected values. */
export const parseBrowserError = (cause: unknown) => {
  if (cause instanceof TypeError) {
    return "TypeError";
  }
  if (cause instanceof RangeError) {
    return "RangeError";
  }
  if (cause instanceof SyntaxError) {
    return "SyntaxError";
  }
  if (cause instanceof DOMException) {
    return "DOMException";
  }
  if (cause instanceof Error) {
    return "Error";
  }
  return "Unknown";
};

export const createBrowserReporter = (options: {
  readonly origin: string;
  readonly pathname: () => string;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly send: (event: BrowserEvent) => Promise<void>;
}) => {
  let windowStart = options.now();
  let count = 0;
  const sendBestEffort = async (event: BrowserEvent) => {
    try {
      await options.send(event);
    } catch {
      /* Telemetry is best effort. */
    }
  };
  const report = (event: BrowserEvent) => {
    const now = options.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      count = 0;
    }
    if (count >= 30) {
      return;
    }
    count += 1;
    void sendBestEffort(event);
  };
  const duration = (start: number) =>
    Math.min(600_000, Math.max(0, options.now() - start));
  const monitoredFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      options.origin
    );
    if (
      url.origin !== options.origin ||
      url.pathname === BrowserTelemetryPath ||
      !(
        url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/auth/")
      )
    ) {
      return options.fetch(input, init);
    }
    const rawMethod = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const method = Schema.is(BrowserEvent.members[0].fields.method)(rawMethod)
      ? rawMethod
      : "OTHER";
    const first = url.pathname.startsWith("/api/auth/")
      ? "auth"
      : url.pathname.split("/")[2];
    const operation = Schema.is(BrowserEvent.members[0].fields.operation)(first)
      ? first
      : "other";
    const start = options.now();
    const area = browserArea(options.pathname());
    try {
      const response = await options.fetch(input, init);
      const requestId = response.headers.get("x-request-id");
      const event: Extract<BrowserEvent, { kind: "api" }> = {
        area,
        durationMs: duration(start),
        kind: "api",
        method,
        operation,
        outcome: response.ok ? "success" : "http_error",
        status: response.status,
      };
      if (
        requestId &&
        Schema.is(Schema.String.check(Schema.isUUID()))(requestId)
      ) {
        report({ ...event, requestId });
      } else {
        report(event);
      }
      return response;
    } catch (error) {
      report({
        area,
        durationMs: duration(start),
        kind: "api",
        method,
        operation,
        outcome:
          error instanceof DOMException && error.name === "AbortError"
            ? "cancelled"
            : "network_error",
        status: 0,
      });
      throw error;
    }
  };
  return {
    error: (
      source: "javascript" | "promise" | "react",
      parsedError: ReturnType<typeof parseBrowserError>
    ) =>
      report({
        area: browserArea(options.pathname()),
        errorType: parsedError,
        kind: "error",
        source,
      }),
    fetch: monitoredFetch,
    navigation: (start: number) =>
      report({
        area: browserArea(options.pathname()),
        durationMs: duration(start),
        kind: "navigation",
      }),
  };
};

const nativeFetch: typeof fetch = (input, init) => window.fetch(input, init);

let browserReporter: ReturnType<typeof createBrowserReporter> | undefined;
/** Browser-only facades share the active host reporter without creating one during tests/SSR. */
export const browserObservedFetch: typeof fetch = (input, init) =>
  browserReporter
    ? browserReporter.fetch(input, init)
    : globalThis.fetch(input, init);
export const getBrowserReporter = () => {
  if (browserReporter) {
    return browserReporter;
  }
  const client = HttpApiClient.make(BrowserObservabilityApi, {
    baseUrl: window.location.origin,
  }).pipe(
    Effect.provide(
      FetchHttpClient.layer.pipe(
        Layer.provide(
          Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
            nativeFetch(input, {
              ...init,
              credentials: "same-origin",
              keepalive: true,
            })
          )
        )
      )
    )
  );
  browserReporter = createBrowserReporter({
    fetch: nativeFetch,
    now: () => performance.now(),
    origin: window.location.origin,
    pathname: () => window.location.pathname,
    send: async (payload) => {
      const api = await Effect.runPromise(client);
      await Effect.runPromise(
        api.browserEvents.record({ payload: { event: payload } })
      );
    },
  });
  return browserReporter;
};

export const installBrowserErrorReporting = () => {
  const reporter = getBrowserReporter();
  const onError = (event: ErrorEvent) =>
    reporter.error("javascript", parseBrowserError(event.error));
  const onRejection = (event: PromiseRejectionEvent) =>
    reporter.error("promise", parseBrowserError(event.reason));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
};
