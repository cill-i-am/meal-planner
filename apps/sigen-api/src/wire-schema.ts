import { Schema } from "effect";

export const jsonSchema = (schema: Schema.Top) => {
  const doc = Schema.toJsonSchemaDocument(schema);
  return { ...doc.schema, $defs: doc.definitions };
};
