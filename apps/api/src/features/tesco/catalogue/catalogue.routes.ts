import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/http-api";

import type { TescoCatalogueError } from "./catalogue.errors.js";
import {
  CatalogueHttpFailures,
  CatalogueRequestGuard,
  TescoCatalogueApi,
} from "./catalogue.http.js";
import { TescoCatalogue } from "./catalogue.port.js";

const toHttpFailure = (error: TescoCatalogueError) => {
  switch (error._tag) {
    case "TescoCatalogueAuthenticationUnavailable": {
      return CatalogueHttpFailures.authentication.body;
    }
    case "TescoCatalogueUnavailable": {
      return CatalogueHttpFailures.unavailable.body;
    }
    case "TescoCatalogueRequestRejected": {
      return CatalogueHttpFailures.rejected.body;
    }
    case "TescoCatalogueResponseInvalid": {
      return CatalogueHttpFailures.response.body;
    }
    default: {
      return error satisfies never;
    }
  }
};

const CatalogueHandlers = HttpApiBuilder.group(
  TescoCatalogueApi,
  "catalogue",
  (handlers) =>
    Effect.gen(function* catalogueHandlers() {
      const catalogue = yield* TescoCatalogue;
      return handlers
        .handle("search", ({ query }) =>
          catalogue.search(query).pipe(Effect.mapError(toHttpFailure))
        )
        .handle("searchBody", ({ payload }) =>
          catalogue.search(payload).pipe(Effect.mapError(toHttpFailure))
        )
        .handle("categoryProducts", ({ params, query }) =>
          catalogue
            .categoryProducts({ ...params, ...query })
            .pipe(Effect.mapError(toHttpFailure))
        )
        .handle("categoryProductsBody", ({ params, payload }) =>
          catalogue
            .categoryProducts({ ...params, ...payload })
            .pipe(Effect.mapError(toHttpFailure))
        )
        .handle("suggestions", ({ query }) =>
          catalogue.suggestions(query).pipe(Effect.mapError(toHttpFailure))
        );
    })
);

export const TescoCatalogueRoutes = HttpApiBuilder.layer(
  TescoCatalogueApi
).pipe(
  Layer.provide(CatalogueHandlers),
  Layer.provide(
    HttpApiMiddleware.layerSchemaErrorTransform(
      CatalogueRequestGuard,
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect transforms a typed schema failure without creating a Promise boundary.
      (error) =>
        Effect.fail(
          error.kind === "Body" || error.kind === "ResponseHeaders"
            ? CatalogueHttpFailures.response.body
            : CatalogueHttpFailures.invalid.body
        )
    )
  )
);
