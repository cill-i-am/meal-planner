import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  CatalogueProductResults,
  CatalogueSuggestions,
  CategoryProductsInput,
  SearchCatalogueInput,
} from "./catalogue.model.js";

describe("stable catalogue contracts", () => {
  it("requires fully populated provider-free command inputs", () => {
    expect(
      Schema.decodeUnknownSync(SearchCatalogueInput)({
        count: 24,
        page: 1,
        query: "milk",
        sortBy: "relevance",
      })
    ).toStrictEqual({
      count: 24,
      page: 1,
      query: "milk",
      sortBy: "relevance",
    });
    expect(() =>
      Schema.decodeUnknownSync(SearchCatalogueInput)({ query: "milk" })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CategoryProductsInput)({
        count: 24,
        facet: "",
        page: 1,
        sortBy: "relevance",
      })
    ).toThrow();
  });

  it("owns only stable catalogue listing values", () => {
    const result = Schema.decodeUnknownSync(CatalogueProductResults)({
      pageInformation: {
        count: 1,
        pageNo: 1,
        pageSize: 24,
        total: 1,
      },
      results: [
        {
          id: "250005606",
          title: "Tesco Fresh Milk 2 Litre",
          type: "ProductType",
        },
      ],
      sortBy: "relevance",
    });

    expect(result.results[0]?.id).toBe("250005606");
  });

  it("keeps provider metadata out of stable suggestions", () => {
    const suggestions = Schema.decodeUnknownSync(CatalogueSuggestions)({
      results: [{ query: "milk" }],
    });

    expect(suggestions).toStrictEqual({ results: [{ query: "milk" }] });
  });
});
