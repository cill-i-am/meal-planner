import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

import { ProductOperations } from "./product-api.contract.js";
import type { ProductOperation } from "./product-api.contract.js";

const UrlValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
const ToolArguments = Schema.Struct({
  familyId: Schema.optionalKey(HouseholdOrganizationId),
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  input: Schema.optionalKey(Schema.Json),
  path: Schema.optionalKey(Schema.Record(Schema.String, UrlValue)),
  query: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Union([UrlValue, Schema.Array(UrlValue)])
    )
  ),
});

const pathSegments = (path: string) => path.split("/");

export const matchProductOperation = (
  method: string,
  pathname: string
): ProductOperation | undefined =>
  ProductOperations.find(({ endpoint }) => {
    if (method !== endpoint.method) {
      return false;
    }
    const actual = pathSegments(pathname);
    const expected = pathSegments(endpoint.path);
    return (
      actual.length === expected.length &&
      expected.every((part, index) =>
        part.startsWith(":") ? actual[index] !== "" : actual[index] === part
      )
    );
  });

/** Only declared path/query/idempotency fields cross the MCP-to-HTTP boundary. */
export const productToolRequest = (
  operation: ProductOperation,
  raw: Schema.Json,
  parent: Request
) =>
  Schema.decodeUnknownEffect(operation.input)(raw, {
    onExcessProperty: "error",
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(ToolArguments, { onExcessProperty: "error" })
    ),
    Effect.map((input) => {
      const path = operation.endpoint.path.replaceAll(
        /:(?<parameter>[A-Za-z][A-Za-z0-9]*)/gu,
        (_, key: string) => encodeURIComponent(String(input.path?.[key]))
      );
      const url = new URL(path, parent.url);
      for (const [key, value] of Object.entries(input.query ?? {})) {
        for (const item of Array.isArray(value) ? value : [value]) {
          url.searchParams.append(key, String(item));
        }
      }
      const headers = new Headers({ accept: "application/json" });
      const authorization = parent.headers.get("authorization");
      if (authorization !== null) {
        headers.set("authorization", authorization);
      }
      const familyId = input.familyId ?? input.path?.["familyId"];
      if (familyId !== undefined) {
        headers.set("x-meal-planner-household", String(familyId));
      }
      // Public contract headers currently contain only the import idempotency key.
      const idempotencyKey = input.headers?.["idempotency-key"];
      if (idempotencyKey !== undefined) {
        headers.set("idempotency-key", idempotencyKey);
      }
      if (input.input !== undefined) {
        headers.set("content-type", "application/json");
      }
      const init: RequestInit = {
        headers,
        method: operation.endpoint.method,
        signal: parent.signal,
      };
      if (input.input !== undefined) {
        init.body = JSON.stringify(input.input);
      }
      return new Request(url, init);
    })
  );

export const productToolSchema = (operation: ProductOperation) => {
  const document = Schema.toJsonSchemaDocument(operation.input);
  return {
    ...document.schema,
    $defs: document.definitions,
    type: "object" as const,
  };
};
