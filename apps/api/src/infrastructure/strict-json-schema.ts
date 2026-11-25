import { Schema } from "effect";
import type { JsonSchema } from "effect";

/** Match closed provider contracts to their explicit decoder policy. */
export const toStrictJsonSchema = (schema: Schema.Constraint) => {
  const document = Schema.toJsonSchemaDocument(schema, {
    onExcessProperty: "error",
  });
  {
    const checkedResult: JsonSchema.JsonSchema =
      Object.keys(document.definitions).length === 0
        ? document.schema
        : { ...document.schema, $defs: document.definitions };
    return checkedResult;
  }
};
