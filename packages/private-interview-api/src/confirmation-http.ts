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

const ConfirmationId = Schema.String.check(Schema.isUUID());
export const PrivateConfirmationMetadata = Schema.Struct({
  generation: ConfirmationId.pipe(
    Schema.brand("PrivateConfirmationGeneration")
  ),
  mutationId: ConfirmationId.pipe(
    Schema.brand("PrivateConfirmationMutationId")
  ),
  sessionReference: ConfirmationId.pipe(
    Schema.brand("PrivateConfirmationSessionReference")
  ),
});
export type PrivateConfirmationMetadata =
  typeof PrivateConfirmationMetadata.Type;

export const PrivateConfirmationForbidden = Schema.TaggedStruct(
  "PrivateConfirmationForbidden",
  {}
);
export const PrivateConfirmationUnauthorized = Schema.TaggedStruct(
  "PrivateConfirmationUnauthorized",
  {}
);
export const PrivateConfirmationUnavailable = Schema.TaggedStruct(
  "PrivateConfirmationUnavailable",
  {}
);

const Forbidden = PrivateConfirmationForbidden.pipe(
  HttpApiSchema.asNoContent({
    decode: () => PrivateConfirmationForbidden.make({}),
  }),
  HttpApiSchema.status(403)
);
const Unauthorized = PrivateConfirmationUnauthorized.pipe(
  HttpApiSchema.asNoContent({
    decode: () => PrivateConfirmationUnauthorized.make({}),
  }),
  HttpApiSchema.status(401)
);
const Unavailable = PrivateConfirmationUnavailable.pipe(
  HttpApiSchema.asNoContent({
    decode: () => PrivateConfirmationUnavailable.make({}),
  }),
  HttpApiSchema.status(503)
);

/** Same-origin, empty-body and schema guards run before releasing a frozen command. */
export class PrivateConfirmationRequestGuard extends HttpApiMiddleware.Service<PrivateConfirmationRequestGuard>()(
  "PrivateConfirmationRequestGuard",
  { error: [Forbidden, Unavailable] }
) {}

/** Only opaque confirmation metadata crosses HTTP; every response is body-free. */
export const PrivateConfirmationApi = HttpApi.make("privateConfirmationApi")
  .add(
    HttpApiGroup.make("privateConfirmations").add(
      HttpApiEndpoint.post(
        "continue",
        "/v1/private-interviews/:sessionReference/confirmations/:mutationId",
        {
          error: [Forbidden, Unauthorized, Unavailable],
          headers: {
            "x-private-output-generation":
              PrivateConfirmationMetadata.fields.generation,
          },
          params: {
            mutationId: PrivateConfirmationMetadata.fields.mutationId,
            sessionReference:
              PrivateConfirmationMetadata.fields.sessionReference,
          },
          success: HttpApiSchema.NoContent,
        }
      )
    )
  )
  .middleware(PrivateConfirmationRequestGuard);

export type PrivateConfirmationApiClient = HttpApiClient.ForApi<
  typeof PrivateConfirmationApi
>;
export const PrivateConfirmationApiClient =
  Context.Service<PrivateConfirmationApiClient>(
    "meal-planner/PrivateConfirmationApiClient"
  );
export const makePrivateConfirmationApiClientLayer = (options: {
  readonly baseUrl: string | URL;
  readonly headers: Readonly<Record<string, string>>;
}) =>
  Layer.effect(
    PrivateConfirmationApiClient,
    HttpApiClient.make(PrivateConfirmationApi, {
      baseUrl: options.baseUrl,
      transformClient: (client) =>
        HttpClient.mapRequest(
          client,
          HttpClientRequest.setHeaders(options.headers)
        ),
    })
  );
