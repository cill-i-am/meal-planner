import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CallToolRequest,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Data, Effect, Schema } from "effect";

import {
  CatalogueProductResults,
  CatalogueSuggestions,
} from "../catalogue/catalogue.model.js";
import * as Shopping from "../shopping/shopping.model.js";
import {
  TescoMcpCapabilities,
  TescoMcpCategory,
  TescoMcpSearch,
  TescoMcpSuggestions,
  TescoMcpTools,
} from "./mcp.contract.js";
import type { TescoSessionFailure } from "./session.model.js";
import { TescoConnectionHealth } from "./session.model.js";

export class TescoMcpTransportFailure extends Data.TaggedError(
  "TescoMcpTransportFailure"
) {}

const toolFailure = (message: string): CallToolResult => ({
  content: [{ text: message, type: "text" }],
  isError: true,
});
const structuredResult = <S extends Schema.Top>(schema: S, value: S["Type"]) =>
  Schema.encodeEffect(schema)(value).pipe(
    Effect.map((encoded) => ({
      content: [{ text: JSON.stringify(encoded), type: "text" as const }],
      // Every output contract is an object; the SDK independently validates JSON-RPC envelopes.
      structuredContent: encoded,
    }))
  );

const callTool = (
  message: CallToolRequest
): Effect.Effect<CallToolResult, never, TescoMcpCapabilities> =>
  Effect.gen(function* dispatchToolRequest() {
    const service = yield* TescoMcpCapabilities;
    const { name } = message.params;
    const input = message.params.arguments ?? {};
    const invoke = <I extends Schema.Top, O extends Schema.Top>(
      inputSchema: I,
      outputSchema: O,
      run: (value: I["Type"]) => Effect.Effect<O["Type"], TescoSessionFailure>
    ) =>
      Schema.decodeUnknownEffect(inputSchema)(input, {
        onExcessProperty: "error",
      }).pipe(
        Effect.flatMap(run),
        Effect.flatMap((value) => structuredResult(outputSchema, value))
      );
    switch (name) {
      case "get_product_details": {
        return yield* invoke(
          Shopping.ProductDetailsInput,
          Shopping.ProductDetailsResult,
          service.productDetails
        );
      }
      case "list_favourites": {
        return yield* invoke(
          Shopping.ListShoppingInput,
          Shopping.FavouritesResult,
          service.favourites
        );
      }
      case "list_previous_orders": {
        return yield* invoke(
          Shopping.ListShoppingInput,
          Shopping.PreviousOrdersResult,
          service.previousOrders
        );
      }
      case "get_order_details": {
        return yield* invoke(
          Shopping.OrderDetailsInput,
          Shopping.OrderDetailsResult,
          service.orderDetails
        );
      }
      case "get_basket": {
        return yield* invoke(
          Shopping.EmptyInput,
          Shopping.BasketResult,
          () => service.basket
        );
      }
      case "list_delivery_slots": {
        return yield* invoke(
          Shopping.DeliverySlotsInput,
          Shopping.DeliverySlotsResult,
          service.deliverySlots
        );
      }
      case "set_basket_items": {
        return yield* invoke(
          Shopping.SetBasketItemsInput,
          Shopping.BasketCommandResult,
          service.setBasketItems
        );
      }
      case "reserve_delivery_slot": {
        return yield* invoke(
          Shopping.ReserveSlotInput,
          Shopping.BasketCommandResult,
          service.reserveSlot
        );
      }
      case "release_delivery_slot": {
        return yield* invoke(
          Shopping.ReleaseSlotInput,
          Shopping.BasketCommandResult,
          service.releaseSlot
        );
      }
      case "prepare_checkout": {
        return yield* invoke(
          Shopping.EmptyInput,
          Shopping.CheckoutReview,
          () => service.prepareCheckout
        );
      }
      case "approve_checkout_handoff": {
        return yield* invoke(
          Shopping.CheckoutHandoffInput,
          Shopping.CheckoutHandoffResult,
          service.checkoutHandoff
        );
      }
      case "search_products": {
        const request =
          yield* Schema.decodeUnknownEffect(TescoMcpSearch)(input);
        return yield* service
          .search(request)
          .pipe(
            Effect.flatMap((value) =>
              structuredResult(CatalogueProductResults, value)
            )
          );
      }
      case "list_category_products": {
        const request =
          yield* Schema.decodeUnknownEffect(TescoMcpCategory)(input);
        return yield* service
          .categoryProducts(request)
          .pipe(
            Effect.flatMap((value) =>
              structuredResult(CatalogueProductResults, value)
            )
          );
      }
      case "suggest_products": {
        const request =
          yield* Schema.decodeUnknownEffect(TescoMcpSuggestions)(input);
        return yield* service
          .suggestions(request)
          .pipe(
            Effect.flatMap((value) =>
              structuredResult(CatalogueSuggestions, value)
            )
          );
      }
      case "connection_status": {
        yield* Schema.decodeUnknownEffect(Schema.Struct({}))(input);
        return yield* service.connectionHealth.pipe(
          Effect.flatMap((value) =>
            structuredResult(TescoConnectionHealth, value)
          )
        );
      }
      default: {
        return toolFailure("Unknown Tesco tool.");
      }
    }
  }).pipe(
    Effect.orElseSucceed((failure) => {
      if (failure._tag === "SchemaError") {
        return toolFailure("Invalid Tesco tool input or response.");
      }
      if (failure.reason === "authentication") {
        return toolFailure(
          "Tesco needs an operator to sign in again. Check connection_status; agents cannot supply or read Tesco credentials."
        );
      }
      return toolFailure(
        failure.reason === "invalid_input"
          ? "Invalid Tesco tool input."
          : "Tesco is temporarily unavailable."
      );
    })
  );

const jsonSchema = (schema: Schema.Top) => {
  const document = Schema.toJsonSchemaDocument(schema);
  if (Object.keys(document.definitions).length === 0) {
    return document.schema;
  }
  return { ...document.schema, $defs: document.definitions };
};

/**
 * Official SDK transport for Executor's 2025 MCP protocol. Each HTTP request owns
 * its server and Effect callback scope; no session ID, background fiber or timer survives it.
 */
export const handleTescoMcp = (request: Request) =>
  Effect.gen(function* serveMcpProtocol() {
    const context = yield* Effect.context<TescoMcpCapabilities>();
    const owner = new AbortController();
    const server = new Server(
      { name: "Private Tesco", version: "1.0.0" },
      {
        capabilities: { tools: {} },
        instructions:
          "Private Irish Tesco catalogue, accessible through the owner's Executor. Shopping mutations require approval through Executor. Checkout requires explicit human approval of a saved review and completion on Tesco’s payment page; no tool places an order. Search results describe the catalogue; they do not promise current store stock. A reauthentication_required status needs the operator's secure session-enrollment flow. Never ask agents for Tesco cookies, tokens, API keys or passwords.",
      }
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: 65_536,
    });
    server.setRequestHandler(ListToolsRequestSchema, () =>
      Promise.resolve({
        tools: TescoMcpTools.map((tool) => ({
          annotations: {
            destructiveHint: "destructive" in tool,
            idempotentHint:
              !("mutation" in tool) ||
              [
                "set_basket_items",
                "reserve_delivery_slot",
                "release_delivery_slot",
              ].includes(tool.name),
            openWorldHint: true,
            readOnlyHint: !("mutation" in tool),
          },
          description: tool.description,
          inputSchema: { ...jsonSchema(tool.input), type: "object" as const },
          name: tool.name,
          outputSchema: { ...jsonSchema(tool.output), type: "object" as const },
        })),
      })
    );
    server.setRequestHandler(CallToolRequestSchema, (message, extra) =>
      Effect.runPromiseWith(context)(callTool(message).pipe(Effect.scoped), {
        signal: AbortSignal.any([owner.signal, request.signal, extra.signal]),
      })
    );
    yield* Effect.acquireRelease(
      Effect.tryPromise({
        catch: () => new TescoMcpTransportFailure(),
        try: () => server.connect(transport),
      }),
      () =>
        Effect.promise(async () => {
          owner.abort();
          await server.close();
        })
    );
    return yield* Effect.tryPromise({
      catch: () => new TescoMcpTransportFailure(),
      try: (signal) => {
        signal.addEventListener("abort", () => owner.abort(), { once: true });
        return transport.handleRequest(request);
      },
    });
  });
