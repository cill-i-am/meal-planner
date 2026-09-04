import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
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
});
