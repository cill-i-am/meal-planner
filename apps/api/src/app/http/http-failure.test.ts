import { describe, expect, it } from "vitest";

import {
  InvalidRequest,
  toHttpFailureResponse,
  UpstreamAuthenticationUnavailable,
  UpstreamInvalidResponse,
  UpstreamRequestRejected,
  UpstreamUnavailable,
} from "./http-failure.js";

describe("HTTP failure projection", () => {
  it.each([
    {
      expected: {
        body: {
          error: "invalid_request",
          message: "The request is invalid.",
        },
        status: 400,
      },
      failure: new InvalidRequest({ location: "body" }),
    },
    {
      expected: {
        body: {
          error: "upstream_authentication_unavailable",
          message: "The upstream service is not currently authenticated.",
        },
        status: 503,
      },
      failure: new UpstreamAuthenticationUnavailable({ upstream: "tesco" }),
    },
    {
      expected: {
        body: {
          error: "upstream_unavailable",
          message: "The upstream service is unavailable.",
        },
        status: 502,
      },
      failure: new UpstreamUnavailable({ upstream: "tesco" }),
    },
    {
      expected: {
        body: {
          error: "upstream_request_rejected",
          message: "The upstream service rejected the request.",
        },
        status: 502,
      },
      failure: new UpstreamRequestRejected({ upstream: "tesco" }),
    },
    {
      expected: {
        body: {
          error: "upstream_invalid_response",
          message: "The upstream service returned an invalid response.",
        },
        status: 502,
      },
      failure: new UpstreamInvalidResponse({ upstream: "tesco" }),
    },
  ])(
    "projects $failure._tag to a fixed safe response",
    ({ failure, expected }) => {
      expect(toHttpFailureResponse(failure)).toStrictEqual(expected);
    }
  );

  it("never projects an internal error message", () => {
    const failure = new UpstreamUnavailable({ upstream: "tesco" });
    Object.assign(failure, {
      message: "Bearer secret-token: provider said account unavailable",
    });

    const response = toHttpFailureResponse(failure);

    expect(response.body).toStrictEqual({
      error: "upstream_unavailable",
      message: "The upstream service is unavailable.",
    });
    expect(JSON.stringify(response)).not.toContain("secret-token");
    expect(JSON.stringify(response)).not.toContain("provider said");
  });
});
