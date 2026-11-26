import { OpenApi } from "effect/http-api";

import { ProductApi, ProductOperations } from "./product-operations.js";

const DocumentedProductApi = ProductApi.annotateMerge(
  OpenApi.annotations({
    description:
      "Accounts and families, food profiles, planning, recipes and durable imports. Mutations preserve their existing request identities and version checks.",
    title: "Meal Planner API",
    version: "1.0.0",
  })
);

export const productOpenApi = (baseURL = "") => {
  const spec = structuredClone(OpenApi.fromApi(DocumentedProductApi));
  for (const path of Object.values(spec.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const operation = path[method];
      if (operation === undefined) {
        continue;
      }
      const policy = ProductOperations.find(
        ({ id }) => id === operation.operationId
      );
      if (policy === undefined) {
        throw new Error(
          `Missing documented operation: ${operation.operationId}`
        );
      }
      operation.description = policy.description;
      operation.security = [{ mealPlannerOAuth: [...policy.scopes] }];
      if (policy.familyContext) {
        operation.parameters.push({
          description:
            "Family ID from families.list. Delegated calls select the family explicitly and never change the browser session's active family.",
          in: "header",
          name: "x-meal-planner-household",
          required: true,
          schema: { minLength: 1, type: "string" },
        });
      }
      operation.responses[401] ??= {
        description:
          "Missing, expired or revoked access token. Follow the WWW-Authenticate protected-resource metadata.",
      };
      operation.responses[403] ??= {
        description: "Required scope or current family authority is missing.",
      };
      operation.responses[429] ??= {
        description:
          "Account rate limit exceeded. Retry after the Retry-After interval.",
      };
    }
  }
  if (baseURL !== "") {
    spec.servers = [{ url: baseURL }];
  }
  return {
    ...spec,
    components: {
      ...spec.components,
      securitySchemes: {
        mealPlannerOAuth: {
          description:
            "Authorization code with PKCE S256. Request the API resource audience ending in /v1; MCP tokens use the separate /mcp audience. Register through the issuer's dynamic client registration endpoint.",
          flows: {
            authorizationCode: {
              authorizationUrl: `${baseURL}/api/auth/oauth2/authorize`,
              refreshUrl: `${baseURL}/api/auth/oauth2/token`,
              scopes: {
                "meal-planner:account": "Read your account identity",
                "meal-planner:assistant":
                  "Use the application's assistant conversations",
                "meal-planner:private":
                  "Access your private interview and setup data",
                "meal-planner:read": "Read shared family data",
                "meal-planner:write":
                  "Change family data and start durable imports",
                offline_access:
                  "Refresh the connection while its consent and account session remain valid",
              },
              tokenUrl: `${baseURL}/api/auth/oauth2/token`,
            },
          },
          type: "oauth2" as const,
        },
      },
    },
  };
};
