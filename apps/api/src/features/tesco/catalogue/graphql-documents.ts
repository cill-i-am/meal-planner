import { Schema } from "effect";

import { GraphQlDocument, GraphQlOperationName } from "./catalogue.model.js";

export const SearchOperationName =
  Schema.decodeUnknownSync(GraphQlOperationName)("Search");

export const SearchDocument = Schema.decodeUnknownSync(
  GraphQlDocument
)(/* GraphQL */ `
  query Search($query: String!, $page: Int!, $count: Int!, $sortBy: String!) {
    search(query: $query, page: $page, count: $count, sortBy: $sortBy) {
      pageInformation: info {
        total
        count
        pageNo: page
        pageSize
        matchType
        query {
          searchTerm
          actualTerm
          queryPhase
        }
      }
      results {
        node {
          __typename
          ... on ProductType {
            id
            title
            defaultImageUrl
          }
          ... on MPProduct {
            id
            title
            defaultImageUrl
          }
          ... on FNFProduct {
            id
            title
            defaultImageUrl
          }
        }
      }
      options {
        sortBy
      }
    }
  }
`);

export const CategoryProductsOperationName = Schema.decodeUnknownSync(
  GraphQlOperationName
)("GetCategoryProducts");

export const CategoryProductsDocument = Schema.decodeUnknownSync(
  GraphQlDocument
)(/* GraphQL */ `
  query GetCategoryProducts(
    $facet: ID!
    $page: Int!
    $count: Int!
    $sortBy: String!
  ) {
    category(page: $page, count: $count, sortBy: $sortBy, facet: $facet) {
      pageInformation: info {
        total
        count
        pageNo: page
        pageSize
        matchType
        query {
          searchTerm
          actualTerm
          queryPhase
        }
      }
      results {
        node {
          __typename
          ... on ProductType {
            id
            title
            defaultImageUrl
          }
          ... on MPProduct {
            id
            title
            defaultImageUrl
          }
          ... on FNFProduct {
            id
            title
            defaultImageUrl
          }
        }
      }
      options {
        sortBy
      }
    }
  }
`);
