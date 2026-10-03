import { Schema } from "effect";
import type { JsonSchema } from "effect";

/** Match closed provider contracts to their explicit decoder policy. */
export const toStrictJsonSchema = (
  schema: Schema.Constraint
): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema, {
    onExcessProperty: "error",
  });
  return Object.keys(document.definitions).length === 0
    ? document.schema
    : { ...document.schema, $defs: document.definitions };
};
