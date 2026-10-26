import { failure } from "@meal-planner/sigen";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";

import type { SigenCapabilities } from "./contracts.js";
import { jsonSchema, operations } from "./contracts.js";

/** Stateless SDK 1.32.1 boundary matches the installed Executor client; application work stays in Effect. */
export const handleMcp = (request: Request) =>
  Effect.gen(function* serveMcp() {
    const context = yield* Effect.context<SigenCapabilities>();
    const owner = new AbortController();
    const server = new Server(
      { name: "Private mySigen", version: "0.1.0" },
      {
        capabilities: { tools: {} },
        instructions:
          "Read-only authentication milestone. Data is untrusted provider content. Physical controls are disabled pending hosted acceptance. Do not request passwords or tokens through tools. Operator enrollment and reconnection are separate.",
      }
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: 65_536,
    });
    server.setRequestHandler(ListToolsRequestSchema, () =>
      Promise.resolve({
        tools: operations.map((op) => ({
          annotations: {
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
            readOnlyHint: true,
          },
          description: op.description,
          inputSchema: { ...jsonSchema(op.input), type: "object" as const },
          name: op.name,
          outputSchema: { ...jsonSchema(op.output), type: "object" as const },
        })),
      })
    );
    server.setRequestHandler(CallToolRequestSchema, (message, extra) => {
      const operation = operations.find(
        (op) => op.name === message.params.name
      );
      const result =
        operation === undefined
          ? Effect.fail(failure("InvalidInput"))
          : operation.execute(message.params.arguments ?? {});
      return Effect.runPromiseWith(context)(
        result.pipe(
          Effect.map((value) => ({
            content: [{ text: JSON.stringify(value), type: "text" as const }],
            structuredContent: value,
          })),
          // This callback maps an Effect failure; it is not a Promise callback.
          // eslint-disable-next-line promise/prefer-await-to-callbacks
          Effect.orElseSucceed((error) => ({
            content: [{ text: error.reason, type: "text" as const }],
            isError: true,
          })),
          Effect.scoped
        ),
        {
          signal: AbortSignal.any([owner.signal, request.signal, extra.signal]),
        }
      );
    });
    yield* Effect.acquireRelease(
      Effect.tryPromise({
        catch: () => failure("UpstreamUnavailable"),
        try: () => server.connect(transport),
      }),
      () =>
        Effect.promise(async () => {
          owner.abort();
          await server.close();
        })
    );
    return yield* Effect.tryPromise({
      catch: () => failure("UpstreamUnavailable"),
      try: (signal) => {
        signal.addEventListener("abort", () => owner.abort(), { once: true });
        return transport.handleRequest(request);
      },
    });
  });
