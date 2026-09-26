import { Context, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import { SetupProgress, SetupProgressVersion } from "./onboarding.js";
import { HouseholdPersonMutationId } from "./people.js";

export const SaveSetupProgressRequest = Schema.Struct({
  expectedVersion: SetupProgressVersion.pipe(
    Schema.check(Schema.isLessThan(Number.MAX_SAFE_INTEGER))
  ),
  progress: SetupProgress,
  sourceCommandId: Schema.optional(HouseholdPersonMutationId),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

export const SavedSetupProgress = Schema.Struct({
  progress: SetupProgress,
  version: SetupProgressVersion,
});

export const SetupProgressUnauthorized = Schema.TaggedStruct(
  "SetupProgressUnauthorized",
  { message: Schema.String }
).pipe(HttpApiSchema.status(401));
export const SetupProgressForbidden = Schema.TaggedStruct(
  "SetupProgressForbidden",
  { message: Schema.String }
).pipe(HttpApiSchema.status(403));
export const SetupProgressInvalidRequest = Schema.TaggedStruct(
  "SetupProgressInvalidRequest",
  { message: Schema.String }
).pipe(HttpApiSchema.status(400));
export const SetupProgressConflict = Schema.TaggedStruct(
  "SetupProgressConflict",
  { message: Schema.String }
).pipe(HttpApiSchema.status(409));
export const SetupProgressRateLimited = Schema.TaggedStruct(
  "SetupProgressRateLimited",
  { message: Schema.String }
).pipe(HttpApiSchema.status(429));
export const SetupProgressUnavailable = Schema.TaggedStruct(
  "SetupProgressUnavailable",
  { message: Schema.String }
).pipe(HttpApiSchema.status(503));

export class SetupProgressSchemaErrors extends HttpApiMiddleware.Service<SetupProgressSchemaErrors>()(
  "SetupProgressSchemaErrors",
  { error: SetupProgressInvalidRequest }
) {}

const SetupProgressGroup = HttpApiGroup.make("setupProgress").add(
  HttpApiEndpoint.post("save", "/v1/setup/progress", {
    error: [
      SetupProgressUnauthorized,
      SetupProgressForbidden,
      SetupProgressInvalidRequest,
      SetupProgressConflict,
      SetupProgressRateLimited,
      SetupProgressUnavailable,
    ],
    payload: SaveSetupProgressRequest,
    success: SavedSetupProgress,
  })
);

export const SetupProgressApi = HttpApi.make("setupProgressApi")
  .add(SetupProgressGroup)
  .middleware(SetupProgressSchemaErrors);

export type SetupProgressApiClient = HttpApiClient.ForApi<
  typeof SetupProgressApi
>;
export const SetupProgressApiClient = Context.Service<SetupProgressApiClient>(
  "meal-planner/SetupProgressApiClient"
);

export const makeSetupProgressApiClientLayer = (options: {
  readonly baseUrl: string | URL;
  readonly headers: Readonly<Record<string, string>>;
}) =>
  Layer.effect(
    SetupProgressApiClient,
    HttpApiClient.make(SetupProgressApi, {
      baseUrl: options.baseUrl,
      transformClient: (client) =>
        HttpClient.mapRequest(
          client,
          HttpClientRequest.setHeaders(options.headers)
        ),
    })
  );
