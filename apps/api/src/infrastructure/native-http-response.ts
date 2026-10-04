import type { Response as CloudflareResponse } from "@cloudflare/workers-types";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

/** Preserve WebSocket upgrades and copy ordinary headers across Cloudflare's Response types. */
export const fromNativeWebResponse = (
  response: Response | CloudflareResponse
) =>
  response.status === 101
    ? HttpServerResponse.raw(response, { status: 101 })
    : HttpServerResponse.fromWeb(response as Response);
