import {
  createIsomorphicFn,
  getGlobalStartContext,
} from "@tanstack/react-start";
import { Schema } from "effect";

import { getBrowserReporter } from "./browser-observability.js";
import type { parseBrowserError } from "./browser-observability.js";

const PublicAnalyticsContext = Schema.Struct({
  browserAnalyticsToken: Schema.String,
});

/** The beacon token is intentionally public; no provider credentials reach HTML. */
export const readBrowserAnalyticsToken = createIsomorphicFn()
  .server(
    () =>
      Schema.decodeUnknownSync(PublicAnalyticsContext)(getGlobalStartContext())
        .browserAnalyticsToken
  )
  .client(
    () =>
      document.querySelector<HTMLMetaElement>(
        'meta[name="cloudflare-rum-token"]'
      )?.content ?? ""
  );

export const reportReactError = createIsomorphicFn()
  .client((errorType: ReturnType<typeof parseBrowserError>) =>
    getBrowserReporter().error("react", errorType)
  )
  .server((_errorType: ReturnType<typeof parseBrowserError>) => null);
