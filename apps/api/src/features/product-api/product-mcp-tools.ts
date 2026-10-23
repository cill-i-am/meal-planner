import type { CallToolResult } from "@modelcontextprotocol/server";
import { Data, Effect, Schema, Stream } from "effect";

import { ProductOperations } from "./product-api.contract.js";
import type { ProductScope } from "./product-api.contract.js";
import {
  productToolRequest,
  productToolSchema,
} from "./product-api.transport.js";
import type { ProductMcpState } from "./product-mcp-state.js";

export class ProductMcpFailure extends Data.TaggedError("ProductMcpFailure") {}

export interface ProductMcpDispatch {
  readonly call: (
    request: Request,
    scopes: readonly ProductScope[]
  ) => Effect.Effect<Response>;
  readonly permits: (scopes: readonly ProductScope[]) => boolean;
  readonly state: ProductMcpState;
}

const toolFailure = (message: string): CallToolResult => ({
  content: [{ text: message, type: "text" }],
  isError: true,
});

export const toolDefinitions = (dispatch: ProductMcpDispatch) =>
  ProductOperations.filter((operation) =>
    dispatch.permits(operation.scopes)
  ).map((operation) => ({
    _meta: {
      securitySchemes: [{ scopes: [...operation.scopes], type: "oauth2" }],
    },
    annotations: {
      destructiveHint: operation.destructive,
      idempotentHint: operation.readOnly,
      openWorldHint: true,
      readOnlyHint: operation.readOnly,
    },
    description: operation.description,
    inputSchema: productToolSchema(operation),
    name: operation.name,
  }));

/** Stops consuming native or application response streams at the owned bound. */
export const readProductMcpBody = (response: Response, maxBytes: number) =>
  Effect.gen(function* readMcpResponseBytes() {
    let size = 0;
    const { body } = response;
    const chunks =
      body === null
        ? []
        : yield* Stream.fromReadableStream({
            evaluate: () => body,
            onError: () => new ProductMcpFailure(),
          }).pipe(
            Stream.mapEffect((chunk) => {
              size += chunk.byteLength;
              return size > maxBytes
                ? Effect.fail(new ProductMcpFailure())
                : Effect.succeed(chunk);
            }),
            Stream.runCollect
          );
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  });

const readToolResult = (response: Response) =>
  Effect.gen(function* readProductResponse() {
    const bytes = yield* readProductMcpBody(response, 1_048_576);
    const result =
      bytes.length === 0
        ? null
        : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(
            new TextDecoder().decode(bytes)
          );
    const structuredContent = {
      httpStatus: response.status,
      result,
      retryAfter: response.headers.get("retry-after"),
    };
    return {
      content: [
        { text: JSON.stringify(structuredContent), type: "text" as const },
      ],
      isError: !response.ok,
      structuredContent,
    } satisfies CallToolResult;
  });

export const callProductTool = (
  name: string,
  input: Schema.Json,
  request: Request,
  dispatch: ProductMcpDispatch
): Effect.Effect<CallToolResult> => {
  const operation = ProductOperations.find(
    (candidate) => candidate.name === name
  );
  if (operation === undefined) {
    return Effect.succeed(toolFailure("Unknown Meal Planner operation."));
  }
  if (!dispatch.permits(operation.scopes)) {
    return Effect.succeed({
      ...toolFailure(
        "This connection needs additional permission for this operation."
      ),
      _meta: {
        "mcp/www_authenticate": [
          `Bearer error="insufficient_scope", scope="${operation.scopes.join(" ")}"`,
        ],
      },
    });
  }
  return productToolRequest(operation, input, request).pipe(
    Effect.flatMap((applicationRequest) =>
      dispatch.call(applicationRequest, operation.scopes)
    ),
    Effect.flatMap(readToolResult),
    Effect.orElseSucceed(() =>
      toolFailure(
        "Invalid input or unavailable operation. Keep the original request identity if the outcome is uncertain."
      )
    )
  );
};
