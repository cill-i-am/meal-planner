import { operations } from "./contracts.js";
import { jsonSchema } from "./wire-schema.js";

export const openApi = {
  components: {
    securitySchemes: { owner: { scheme: "bearer", type: "http" } },
  },
  info: { title: "Private mySigen API", version: "0.1.0" },
  openapi: "3.1.0",
  paths: Object.fromEntries(
    operations.map((op) => [
      `/v1/${op.name}`,
      {
        post: {
          description: op.description,
          operationId: op.name,
          requestBody: {
            content: { "application/json": { schema: jsonSchema(op.input) } },
            required: true,
          },
          responses: {
            "200": {
              content: {
                "application/json": { schema: jsonSchema(op.output) },
              },
              description: "Verified response contract",
            },
            "400": { description: "Invalid input" },
            "401": { description: "Client authentication required" },
            "403": {
              description: "Permission denied or browser origin refused",
            },
            "409": {
              description: "Approval required or saved command conflict",
            },
            "429": { description: "Rate limited" },
            "503": {
              description: "Provider failure or reauthentication required",
            },
          },
        },
      },
    ])
  ),
  security: [{ owner: [] }],
};
