import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  CategoryProductsInput,
  SearchCatalogueInput,
} from "./catalogue.model.js";
import {
  TescoCategoryProductsQuery,
  TescoSearchQuery,
  TescoSuggestionsEndpoint,
} from "./xapi.protocol.js";

const searchInput = Schema.decodeUnknownSync(SearchCatalogueInput)({
  count: 24,
  page: 1,
  query: "milk",
  sortBy: "relevance",
});

describe("Tesco XAPI catalogue protocol", () => {
  it("projects a Tesco search response into the stable catalogue result", async () => {
    const { operation } = TescoSearchQuery;
    const result = await Effect.runPromise(
      TescoSearchQuery.decode({
        data: {
          search: {
            options: { sortBy: "relevance" },
            pageInformation: {
              count: 1,
              matchType: "exact",
              pageNo: 1,
              pageSize: 24,
              query: {
                actualTerm: "milk",
                queryPhase: "primary",
                searchTerm: "milk",
              },
              total: 1,
            },
            results: [
              {
                node: {
                  __typename: "ProductType",
                  defaultImageUrl:
                    "https://digitalcontent.api.tesco.com/image.jpeg",
                  id: "250005606",
                  title: "Tesco Fresh Milk 2 Litre",
                },
              },
            ],
          },
        },
        ignoredProviderMetadata: { version: 2 },
      })
    );

    expect(operation.operationName).toBe("Search");
    expect(TescoSearchQuery.variables(searchInput)).toStrictEqual({
      count: 24,
      page: 1,
      query: "milk",
      sortBy: "relevance",
    });
    expect(result).toStrictEqual({
      pageInformation: {
        count: 1,
        matchType: "exact",
        pageNo: 1,
        pageSize: 24,
        query: {
          actualTerm: "milk",
          queryPhase: "primary",
          searchTerm: "milk",
        },
        total: 1,
      },
      results: [
        {
          defaultImageUrl: "https://digitalcontent.api.tesco.com/image.jpeg",
          id: "250005606",
          title: "Tesco Fresh Milk 2 Litre",
          type: "ProductType",
        },
      ],
      sortBy: "relevance",
    });
  });

  it("drops suggestions metadata at the provider projection", async () => {
    const result = await Effect.runPromise(
      TescoSuggestionsEndpoint.decode({
        config: { providerExperiment: "opaque" },
        results: [{ query: "milk" }, { query: "oat milk" }],
      })
    );

    expect(result).toStrictEqual({
      results: [{ query: "milk" }, { query: "oat milk" }],
    });
  });

  it("pairs the category document with its codec and stable projection", async () => {
    const input = Schema.decodeUnknownSync(CategoryProductsInput)({
      count: 24,
      facet: "fresh-food",
      page: 1,
      sortBy: "relevance",
    });
    const { operation } = TescoCategoryProductsQuery;
    const result = await Effect.runPromise(
      TescoCategoryProductsQuery.decode({
        data: {
          category: {
            pageInformation: {
              count: 0,
              pageNo: 1,
              pageSize: 24,
              total: 0,
            },
            results: [],
          },
        },
      })
    );

    expect(operation.operationName).toBe("GetCategoryProducts");
    expect(TescoCategoryProductsQuery.variables(input)).toStrictEqual({
      count: 24,
      facet: "fresh-food",
      page: 1,
      sortBy: "relevance",
    });
    expect(result).toStrictEqual({
      pageInformation: {
        count: 0,
        pageNo: 1,
        pageSize: 24,
        total: 0,
      },
      results: [],
    });
  });

  it("contains provider drift as a typed decode failure", async () => {
    const canary = "provider-secret-schema-detail";
    const failure: unknown = await Effect.runPromise(
      TescoSearchQuery.decode({
        data: { search: { providerDetail: canary, results: [] } },
      })
    ).then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toMatchObject({
      _tag: "TescoCatalogueResponseInvalid",
      operation: "search",
    });
    expect(JSON.stringify(failure)).not.toContain(canary);
    expect(failure).not.toHaveProperty("cause");
  });
});
