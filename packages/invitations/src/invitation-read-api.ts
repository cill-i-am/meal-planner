import { InvitationId, InvitationView } from "@meal-planner/household-api";
import { Context, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";

import { InvitationResponse, InvitationResponseResult } from "./invitation.js";

export const InvitationReadInvalidRequest = Schema.TaggedStruct(
  "InvitationReadInvalidRequest",
  { message: Schema.String }
).pipe(HttpApiSchema.status(400));
export const InvitationReadUnauthorized = Schema.TaggedStruct(
  "InvitationReadUnauthorized",
  { message: Schema.String }
).pipe(HttpApiSchema.status(401));
export const InvitationReadForbidden = Schema.TaggedStruct(
  "InvitationReadForbidden",
  { message: Schema.String }
).pipe(HttpApiSchema.status(403));
export const InvitationReadNotFound = Schema.TaggedStruct(
  "InvitationReadNotFound",
  { message: Schema.String }
).pipe(HttpApiSchema.status(404));
export const InvitationReadRateLimited = Schema.TaggedStruct(
  "InvitationReadRateLimited",
  { message: Schema.String }
).pipe(HttpApiSchema.status(429));
export const InvitationReadUnavailable = Schema.TaggedStruct(
  "InvitationReadUnavailable",
  { message: Schema.String }
).pipe(HttpApiSchema.status(503));

export class InvitationReadSchemaErrors extends HttpApiMiddleware.Service<InvitationReadSchemaErrors>()(
  "InvitationReadSchemaErrors",
  { error: InvitationReadInvalidRequest }
) {}

const InvitationReadGroup = HttpApiGroup.make("invitationRead").add(
  HttpApiEndpoint.get("read", "/v1/invitations/:id", {
    error: [
      InvitationReadInvalidRequest,
      InvitationReadUnauthorized,
      InvitationReadForbidden,
      InvitationReadNotFound,
      InvitationReadRateLimited,
      InvitationReadUnavailable,
    ],
    params: { id: InvitationId },
    success: InvitationView,
  }),
  HttpApiEndpoint.post("respond", "/v1/invitations/:id/response", {
    error: [
      InvitationReadInvalidRequest,
      InvitationReadUnauthorized,
      InvitationReadForbidden,
      InvitationReadNotFound,
      InvitationReadRateLimited,
      InvitationReadUnavailable,
    ],
    params: { id: InvitationId },
    payload: InvitationResponse,
    success: InvitationResponseResult,
  })
);

export const InvitationReadApi = HttpApi.make("invitationReadApi")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .annotate(HttpApi.QueryParseOptions, { onExcessProperty: "error" })
  .add(InvitationReadGroup)
  .middleware(InvitationReadSchemaErrors);

export type InvitationReadApiClient = HttpApiClient.ForApi<
  typeof InvitationReadApi
>;
export const InvitationReadApiClient = Context.Service<InvitationReadApiClient>(
  "meal-planner/InvitationReadApiClient"
);

export const makeInvitationReadApiClientLayer = (options: {
  readonly baseUrl: string | URL;
  readonly headers: Readonly<Record<string, string>>;
}) =>
  Layer.effect(
    InvitationReadApiClient,
    HttpApiClient.make(InvitationReadApi, {
      baseUrl: options.baseUrl,
      transformClient: (client) =>
        HttpClient.mapRequest(
          client,
          HttpClientRequest.setHeaders(options.headers)
        ),
    })
  );

export { InvitationResponse, InvitationResponseResult } from "./invitation.js";
