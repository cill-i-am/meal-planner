import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  CategoryProductsRequest,
  PageNumberFromString,
  RawGraphQlRequest,
  ResultCountFromString,
  SearchRequest,
  SuggestionRequest,
  SuggestionsResponse,
  TescoSearchGraphQlResponse,
  mapTescoListing,
} from "./catalogue.model.js";

describe("Tesco schemas", () => {
  it("decodes the public suggestions response shape", () => {
    const decoded = Schema.decodeUnknownSync(SuggestionsResponse)({
      config: "default",
      results: [{ query: "milk" }, { query: "oat milk" }],
    });

    expect(decoded.results.map((result) => result.query)).toStrictEqual([
      "milk",
      "oat milk",
    ]);
  });

  it("brands and validates outbound search request inputs", () => {
    const decoded = Schema.decodeUnknownSync(SearchRequest)({
      count: 24,
      page: 1,
      query: "milk",
      sortBy: "relevance",
    });

    expect(decoded).toStrictEqual({
      count: 24,
      page: 1,
      query: "milk",
      sortBy: "relevance",
    });
    expect(() =>
      Schema.decodeUnknownSync(SearchRequest)({ page: 1, query: " " })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(SearchRequest)({ page: 0, query: "milk" })
    ).toThrow();
  });

  it("applies request defaults from schemas", () => {
    expect(
      Schema.decodeUnknownSync(SearchRequest)({ query: "milk" })
    ).toStrictEqual({
      count: 24,
      page: 1,
      query: "milk",
      sortBy: "relevance",
    });
    expect(
      Schema.decodeUnknownSync(SuggestionRequest)({ query: "milk" })
    ).toStrictEqual({
      limit: 10,
      query: "milk",
    });
  });

  it("brands and validates category request inputs", () => {
    const decoded = Schema.decodeUnknownSync(CategoryProductsRequest)({
      count: 48,
      facet: "fresh-food",
      page: 2,
    });

    expect(decoded).toStrictEqual({
      count: 48,
      facet: "fresh-food",
      page: 2,
      sortBy: "relevance",
    });
    expect(() =>
      Schema.decodeUnknownSync(CategoryProductsRequest)({
        count: 24,
        facet: "",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CategoryProductsRequest)({
        count: -1,
        facet: "fresh-food",
      })
    ).toThrow();
  });

  it("decodes URL integer parameters as positive decimal integers only", () => {
    expect(Schema.decodeUnknownSync(PageNumberFromString)("12")).toBe(12);
    expect(Schema.decodeUnknownSync(ResultCountFromString)("24")).toBe(24);
    expect(() => Schema.decodeUnknownSync(PageNumberFromString)("0")).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PageNumberFromString)("0x10")
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(ResultCountFromString)("1.5")
    ).toThrow();
  });

  it("allows multiline GraphQL documents while rejecting blank documents", () => {
    const decoded = Schema.decodeUnknownSync(RawGraphQlRequest)({
      operationName: "Search",
      query: `
        query Search {
          search(query: "milk") {
            results { node { __typename } }
          }
        }
      `,
    });

    expect(decoded.operationName).toBe("Search");
    expect(decoded.variables).toStrictEqual({});
    expect(() =>
      Schema.decodeUnknownSync(RawGraphQlRequest)({
        operationName: "Search",
        query: "   \n\t",
      })
    ).toThrow();
  });

  it("normalizes the Tesco GraphQL search listing shape", () => {
    const decoded = Schema.decodeUnknownSync(TescoSearchGraphQlResponse)({
      data: {
        search: {
          options: {
            sortBy: "relevance",
          },
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
      status: 200,
    });

    expect(mapTescoListing(decoded.data.search)).toStrictEqual({
      pageInformation: decoded.data.search.pageInformation,
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
});
