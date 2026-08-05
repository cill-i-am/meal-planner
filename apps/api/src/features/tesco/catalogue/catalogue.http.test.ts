import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  CategoryProductsRequestBody,
  SearchRequestBody,
  categoryInputFromUrl,
  searchInputFromUrl,
  suggestionsInputFromUrl,
  toCatalogueSuggestionsResponse,
} from "./catalogue.http.js";
import { CatalogueSuggestions, FacetId } from "./catalogue.model.js";

describe("catalogue HTTP contracts", () => {
  it("applies HTTP defaults before invoking the stable catalogue service", async () => {
    const [search, suggestions] = await Effect.runPromise(
      Effect.all([
        searchInputFromUrl("https://meal-planner.test/tesco/search?query=milk"),
        suggestionsInputFromUrl(
          "https://meal-planner.test/tesco/suggestions?query=milk"
        ),
      ])
    );

    expect(search).toStrictEqual({
      count: 24,
      page: 1,
      query: "milk",
      sortBy: "relevance",
    });
    expect(suggestions).toStrictEqual({ limit: 10, query: "milk" });
    expect(
      toCatalogueSuggestionsResponse(
        Schema.decodeUnknownSync(CatalogueSuggestions)({
          results: [{ query: "milk" }],
        })
      )
    ).toStrictEqual({ results: [{ query: "milk" }] });
  });

  it("owns POST body defaults and category query decoding", async () => {
    const searchBody = Schema.decodeUnknownSync(SearchRequestBody)({
      query: "milk",
    });
    const categoryBody = Schema.decodeUnknownSync(CategoryProductsRequestBody)(
      {}
    );
    const facet = Schema.decodeUnknownSync(FacetId)("fresh-food");
    const category = await Effect.runPromise(
      categoryInputFromUrl(
        "https://meal-planner.test/tesco/categories/fresh-food/products",
        facet
      )
    );

    expect(searchBody).toStrictEqual({
      count: 24,
      page: 1,
      query: "milk",
      sortBy: "relevance",
    });
    expect(categoryBody).toStrictEqual({
      count: 24,
      page: 1,
      sortBy: "relevance",
    });
    expect(category).toStrictEqual({ facet, ...categoryBody });
  });

  it("rejects invalid URL-encoded counts at the HTTP boundary", async () => {
    await expect(
      Effect.runPromise(
        searchInputFromUrl(
          "https://meal-planner.test/tesco/search?query=milk&count=1.5"
        )
      )
    ).rejects.toMatchObject({ _tag: "BadRequestError" });
  });
});
