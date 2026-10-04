import { Effect, Schema, SchemaGetter } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";

import {
  CatalogueProductResults,
  CatalogueSuggestions,
  FacetId,
  PageNumber,
  ResultCount,
  SearchQuery,
  SortBy,
} from "./catalogue.model.js";

const PageNumberFromString = Schema.String.check(
  Schema.isPattern(/^[1-9]\d*$/u)
).pipe(
  Schema.decodeTo(PageNumber, {
    decode: SchemaGetter.transform(Number),
    encode: SchemaGetter.transform(String),
  })
);
const ResultCountFromString = Schema.String.check(
  Schema.isPattern(/^[1-9]\d*$/u)
).pipe(
  Schema.decodeTo(ResultCount, {
    decode: SchemaGetter.transform(Number),
    encode: SchemaGetter.transform(String),
  })
);
const defaultPage = Schema.decodeUnknownSync(PageNumber)(1);
const defaultCount = Schema.decodeUnknownSync(ResultCount)(24);
const defaultLimit = Schema.decodeUnknownSync(ResultCount)(10);
const defaultSort = Schema.decodeUnknownSync(SortBy)("relevance");

const ListingBody = {
  count: ResultCount.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(defaultCount))
  ),
  page: PageNumber.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(defaultPage))
  ),
  sortBy: SortBy.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(defaultSort))
  ),
};
const ListingQuery = {
  count: ResultCountFromString.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(defaultCount))
  ),
  page: PageNumberFromString.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(defaultPage))
  ),
  sortBy: ListingBody.sortBy,
};

/** The protocol exposes fixed messages, never provider or decoder diagnostics. */
const failure = <const Code extends string, const Message extends string>(
  error: Code,
  message: Message,
  status: number
) => ({
  body: { error, message },
  schema: Schema.Struct({
    error: Schema.Literal(error),
    message: Schema.Literal(message),
  }).pipe(HttpApiSchema.status(status)),
});
export const CatalogueHttpFailures = {
  authentication: failure(
    "upstream_authentication_unavailable",
    "The upstream service is not currently authenticated.",
    503
  ),
  invalid: failure("invalid_request", "The request is invalid.", 400),
  rejected: failure(
    "upstream_request_rejected",
    "The upstream service rejected the request.",
    502
  ),
  response: failure(
    "upstream_invalid_response",
    "The upstream service returned an invalid response.",
    502
  ),
  unavailable: failure(
    "upstream_unavailable",
    "The upstream service is unavailable.",
    502
  ),
};
const upstreamErrors = [
  CatalogueHttpFailures.authentication.schema,
  CatalogueHttpFailures.unavailable.schema,
  CatalogueHttpFailures.rejected.schema,
  CatalogueHttpFailures.response.schema,
];

export class CatalogueRequestGuard extends HttpApiMiddleware.Service<CatalogueRequestGuard>()(
  "CatalogueRequestGuard",
  {
    error: [
      CatalogueHttpFailures.invalid.schema,
      CatalogueHttpFailures.response.schema,
    ],
  }
) {}

/** Feature-owned contract for the Node host's bounded catalogue reads. */
export const TescoCatalogueApi = HttpApi.make("tescoCatalogueApi")
  .add(
    HttpApiGroup.make("catalogue").add(
      HttpApiEndpoint.get("search", "/tesco/search", {
        error: upstreamErrors,
        query: { ...ListingQuery, query: SearchQuery },
        success: CatalogueProductResults,
      }),
      HttpApiEndpoint.post("searchBody", "/tesco/search", {
        error: upstreamErrors,
        payload: Schema.Struct({ ...ListingBody, query: SearchQuery }),
        success: CatalogueProductResults,
      }),
      HttpApiEndpoint.get(
        "categoryProducts",
        "/tesco/categories/:facet/products",
        {
          error: upstreamErrors,
          params: { facet: FacetId },
          query: ListingQuery,
          success: CatalogueProductResults,
        }
      ),
      HttpApiEndpoint.post(
        "categoryProductsBody",
        "/tesco/categories/:facet/products",
        {
          error: upstreamErrors,
          params: { facet: FacetId },
          payload: Schema.Struct(ListingBody),
          success: CatalogueProductResults,
        }
      ),
      HttpApiEndpoint.get("suggestions", "/tesco/suggestions", {
        error: upstreamErrors,
        query: {
          limit: ResultCountFromString.pipe(
            Schema.withDecodingDefaultTypeKey(Effect.succeed(defaultLimit))
          ),
          query: SearchQuery,
        },
        success: CatalogueSuggestions,
      })
    )
  )
  .middleware(CatalogueRequestGuard);
