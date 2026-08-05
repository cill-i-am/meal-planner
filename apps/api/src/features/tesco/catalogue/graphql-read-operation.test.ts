import { describe, expect, it } from "vitest";

import {
  InvalidReadOnlyGraphQlOperationError,
  defineReadOnlyGraphQlOperation,
} from "./graphql-read-operation.js";
import {
  TescoCategoryProductsQuery,
  TescoSearchQuery,
} from "./xapi.protocol.js";

const expectInvalidDefinition = (
  define: () => unknown,
  reason: InvalidReadOnlyGraphQlOperationError["reason"],
  operationName: string
): void => {
  try {
    define();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidReadOnlyGraphQlOperationError);
    expect(error).toMatchObject({ operationName, reason });
    return;
  }

  throw new Error("Expected an invalid read-only GraphQL operation defect");
};

describe("defineReadOnlyGraphQlOperation", () => {
  it("accepts one named query", () => {
    const operation = defineReadOnlyGraphQlOperation({
      document:
        'query Search { search(query: "milk") { results { node { id } } } }',
      operationName: "Search",
    });

    expect(operation.operationName).toBe("Search");
    expect(operation.document).toContain("query Search");
  });

  it("accepts fragments alongside one named query", () => {
    expect(
      defineReadOnlyGraphQlOperation({
        document: `
          query Search { search(query: "milk") { results { node { ...Product } } } }
          fragment Product on ProductType { id title }
        `,
        operationName: "Search",
      }).operationName
    ).toBe("Search");
  });

  it("proves the named catalogue documents at module construction", () => {
    expect(TescoSearchQuery.operation.operationName).toBe("Search");
    expect(TescoCategoryProductsQuery.operation.operationName).toBe(
      "GetCategoryProducts"
    );
  });

  it("rejects a mutation document", () => {
    expectInvalidDefinition(
      () =>
        defineReadOnlyGraphQlOperation({
          document: 'mutation AddToBasket { addToBasket(productId: "1") }',
          operationName: "AddToBasket",
        }),
      "MutationOperation",
      "AddToBasket"
    );
  });

  it("rejects a subscription document", () => {
    expectInvalidDefinition(
      () =>
        defineReadOnlyGraphQlOperation({
          document: "subscription BasketChanges { basketChanges { id } }",
          operationName: "BasketChanges",
        }),
      "SubscriptionOperation",
      "BasketChanges"
    );
  });

  it("rejects an anonymous operation", () => {
    expectInvalidDefinition(
      () =>
        defineReadOnlyGraphQlOperation({
          document: '{ search(query: "milk") { results { node { id } } } }',
          operationName: "Search",
        }),
      "AnonymousOperation",
      "Search"
    );
  });

  it("rejects a declared name that does not match", () => {
    expectInvalidDefinition(
      () =>
        defineReadOnlyGraphQlOperation({
          document:
            'query DifferentName { search(query: "milk") { results { node { id } } } }',
          operationName: "Search",
        }),
      "MismatchedOperationName",
      "Search"
    );
  });

  it("rejects a document without an operation", () => {
    expectInvalidDefinition(
      () =>
        defineReadOnlyGraphQlOperation({
          document: "fragment Product on ProductType { id title }",
          operationName: "Search",
        }),
      "NoOperation",
      "Search"
    );
  });

  it("rejects a document with multiple operations", () => {
    expectInvalidDefinition(
      () =>
        defineReadOnlyGraphQlOperation({
          document: `
            query Search { search(query: "milk") { results { node { id } } } }
            query Browse { category(facet: "fresh") { results { node { id } } } }
          `,
          operationName: "Search",
        }),
      "MultipleOperations",
      "Search"
    );
  });

  it("rejects non-executable definitions", () => {
    expectInvalidDefinition(
      () =>
        defineReadOnlyGraphQlOperation({
          document: `
            schema { query: Query }
            type Query { product: String }
            query Search { product }
          `,
          operationName: "Search",
        }),
      "UnexpectedDefinition",
      "Search"
    );
  });

  it("reports parse defects without retaining document contents", () => {
    const sensitiveDocument = "query Search { doNotExposeThis(";

    try {
      defineReadOnlyGraphQlOperation({
        document: sensitiveDocument,
        operationName: "Search",
      });
      throw new Error("Expected an invalid definition defect");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidReadOnlyGraphQlOperationError);
      expect(error).toMatchObject({
        message: "Invalid read-only GraphQL operation definition",
        operationName: "Search",
        reason: "InvalidDocument",
      });
      expect(String(error)).not.toContain(sensitiveDocument);
      expect(error).not.toHaveProperty("cause");
    }
  });
});
