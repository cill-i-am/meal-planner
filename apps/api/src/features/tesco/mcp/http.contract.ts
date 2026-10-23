import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

import { TescoMcpTools } from "./mcp.contract.js";

const failure = (error: string, status: number) =>
  Schema.Struct({ error: Schema.Literal(error) }).pipe(
    HttpApiSchema.status(status)
  );
const errors = [
  failure("request_failed", 400),
  HttpApiSchema.Empty(401),
  failure("browser_origin_not_allowed", 403),
  failure("json_required", 415),
  HttpApiSchema.Empty(429),
  Schema.Struct({
    error: Schema.Literals([
      "request_failed",
      "tesco_reauthentication_required",
    ]),
  }).pipe(HttpApiSchema.status(503)),
];
const endpoint = (tool: (typeof TescoMcpTools)[number]) =>
  HttpApiEndpoint.post(tool.name, `/v1/${tool.name}`, {
    error: errors,
    payload: tool.input,
    success: tool.output,
  }).annotate(OpenApi.Description, tool.description);
const [firstTool, ...remainingTools] = TescoMcpTools;

/** Private owner-only HTTP aliases of the exact MCP operation registry. */
export const TescoPrivateHttpApi = HttpApi.make("privateTesco")
  .add(
    HttpApiGroup.make("tesco").add(
      endpoint(firstTool),
      ...remainingTools.map(endpoint)
    )
  )
  .annotate(OpenApi.Title, "Private Tesco API")
  .annotate(
    OpenApi.Description,
    "Owner-only Irish Tesco shopping. Uses the existing private Executor bearer credential and owner session. The operator enrollment credential and general Meal Planner OAuth tokens are not accepted. Callers must obtain human approval before checkout handoff; no operation pays or places an order."
  );

export const tescoPrivateOpenApi = (baseURL: string) => {
  const spec = structuredClone(OpenApi.fromApi(TescoPrivateHttpApi));
  for (const path of Object.values(spec.paths)) {
    if (path.post !== undefined) {
      path.post.security = [{ privateTescoBearer: [] }];
    }
  }
  spec.servers = [{ url: baseURL }];
  spec.components.securitySchemes["privateTescoBearer"] = {
    description:
      "Existing dedicated owner-scoped Executor credential: 64 lowercase hexadecimal characters. Never use a Tesco cookie, the operator credential, or a Meal Planner OAuth token. This credential grants the same private owner access as /mcp.",
    scheme: "bearer",
    type: "http",
  };
  return spec;
};
