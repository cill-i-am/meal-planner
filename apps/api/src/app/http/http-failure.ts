import { Data } from "effect";

export type RequestLocation = "body" | "path" | "query";
export type Upstream = "tesco";

export const InvalidRequest = Data.TaggedError("InvalidRequest")<{
  readonly location: RequestLocation;
}>;
export type InvalidRequest = InstanceType<typeof InvalidRequest>;

export const UpstreamAuthenticationUnavailable = Data.TaggedError(
  "UpstreamAuthenticationUnavailable"
)<{
  readonly upstream: Upstream;
}>;
export type UpstreamAuthenticationUnavailable = InstanceType<
  typeof UpstreamAuthenticationUnavailable
>;

export const UpstreamUnavailable = Data.TaggedError("UpstreamUnavailable")<{
  readonly upstream: Upstream;
}>;
export type UpstreamUnavailable = InstanceType<typeof UpstreamUnavailable>;

export const UpstreamRequestRejected = Data.TaggedError(
  "UpstreamRequestRejected"
)<{
  readonly upstream: Upstream;
}>;
export type UpstreamRequestRejected = InstanceType<
  typeof UpstreamRequestRejected
>;

export const UpstreamInvalidResponse = Data.TaggedError(
  "UpstreamInvalidResponse"
)<{
  readonly upstream: Upstream;
}>;
export type UpstreamInvalidResponse = InstanceType<
  typeof UpstreamInvalidResponse
>;

export type HttpFailure =
  | InvalidRequest
  | UpstreamAuthenticationUnavailable
  | UpstreamUnavailable
  | UpstreamRequestRejected
  | UpstreamInvalidResponse;

export interface HttpFailureSpec {
  readonly error: string;
  readonly message: string;
  readonly status: number;
}

const failureSpecs = {
  InvalidRequest: {
    error: "invalid_request",
    message: "The request is invalid.",
    status: 400,
  },
  UpstreamAuthenticationUnavailable: {
    error: "upstream_authentication_unavailable",
    message: "The upstream service is not currently authenticated.",
    status: 503,
  },
  UpstreamInvalidResponse: {
    error: "upstream_invalid_response",
    message: "The upstream service returned an invalid response.",
    status: 502,
  },
  UpstreamRequestRejected: {
    error: "upstream_request_rejected",
    message: "The upstream service rejected the request.",
    status: 502,
  },
  UpstreamUnavailable: {
    error: "upstream_unavailable",
    message: "The upstream service is unavailable.",
    status: 502,
  },
} as const satisfies Record<HttpFailure["_tag"], HttpFailureSpec>;

export const toHttpFailureResponse = (failure: HttpFailure) => {
  const spec = failureSpecs[failure._tag];
  return {
    body: {
      error: spec.error,
      message: spec.message,
    },
    status: spec.status,
  };
};
